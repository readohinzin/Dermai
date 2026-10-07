'use strict';
/* /api/skin-analysis : seule une session Supabase valide, vérifiée côté serveur, peut déclencher une analyse.
   Perfect Corp est remplacé par un compteur (jamais appelé pour de vrai) ; le réseau global est coupé pour tout hôte autre que le faux Supabase. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');
const { createFake } = require('./helpers/fake-supabase.js');
const { toUserMessage } = require('../server/errors');

const URL_SB = 'https://demo.supabase.co', ANON = 'public-anon-key';
process.env.SUPABASE_URL = URL_SB; process.env.SUPABASE_ANON_KEY = ANON; process.env.DERMAI_ANALYSIS_ENABLED = '1';
const auth = require('../server/auth');
const perfectcorp = require('../server/perfectcorp');
const handler = require('../api/skin-analysis.js');
require('../server/masks').api.fetchImpl = async () => { throw new Error('hors ligne (test)'); };   // aucun téléchargement réseau de masque dans ces tests
const skinModel = require('../js/skin-model.js');
const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const fake = createFake();
const supabaseCalls = [];
auth.api.fetchImpl = (url, init) => { supabaseCalls.push({ url, headers: init.headers }); return fake.fetch(url, init); };
require('../server/quota').api.fetchImpl = (url, init) => fake.fetch(url, init);   // quota simulé (jamais de réseau)
process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL'; process.env.DERMAI_MAX_ANALYSES_PER_PERIOD = '1000';
let pcCalls = 0, netCalls = [];
const realAnalyze = perfectcorp.analyzeSkin;
perfectcorp.analyzeSkin = async () => { pcCalls++; return JSON_RESP; };                       // aucun appel réel
const realFetch = global.fetch;
global.fetch = async url => { netCalls.push(String(url)); throw new Error('réseau interdit dans ce test'); };   // filet : rien ne sort vers l'extérieur
test.after(() => { global.fetch = realFetch; });

async function newUser(email) {
  const r = await (await fake.fetch(URL_SB + '/auth/v1/signup', { method: 'POST', headers: { apikey: ANON }, body: JSON.stringify({ email, password: 'motdepasse1' }) })).text();
  return JSON.parse(r);
}
function call(headers, data, method = 'POST') {
  let readStarted = false;
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.headers = headers || {};
    req.on('data', () => { readStarted = true; });
    const h = {}, res = { setHeader(k, v) { h[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: h, readStarted }); } };
    handler(req, res);
  });
}
const reset = () => { pcCalls = 0; netCalls = []; supabaseCalls.length = 0; };
const bearer = t => ({ authorization: 'Bearer ' + t, 'content-type': 'image/jpeg' });
const tamper = t => { const [a, b, c] = t.split('.'); return [a, b, c.slice(0, -2) + (c.endsWith('xx') ? 'yy' : 'xx')].join('.'); };
const noProvider = () => { assert.equal(pcCalls, 0, 'Perfect Corp ne doit jamais être atteint'); assert.deepEqual(netCalls, [], 'aucune requête sortante'); };

test('SA-A sans Authorization : 401, photo non lue, 0 appel Perfect Corp, Supabase non interrogé', async () => {
  reset();
  const r = await call({ 'content-type': 'image/jpeg' }, JPEG);
  assert.equal(r.status, 401); assert.equal(r.body.ok, false);
  assert.equal(r.body.error, toUserMessage('AUTH_REQUIRED')); assert.equal(r.body.error, 'Connectez-vous pour analyser votre peau.');
  assert.equal(r.headers['www-authenticate'], 'Bearer');
  assert.equal(r.readStarted, false, 'le corps (la photo) n\'est même pas lu');
  noProvider(); assert.equal(supabaseCalls.length, 0);
});

test('SA-A2 en-têtes mal formés ou sans jeton réel : 401, aucune requête à Supabase, 0 appel Perfect Corp', async () => {
  for (const authorization of ['', 'Bearer', 'Bearer ', 'Bearer abc', 'Basic dXNlcjpwYXNz', 'Bearer a.b.c', 'Token aaaaaaaa.bbbbbbbb.cccccccc', 'Bearer aaaaaaaa.bbbbbbbb.cccccccc extra', 'Bearer ' + 'a'.repeat(5000) + '.bbbbbbbb.cccccccc', 'Bearer null', 'Bearer undefined']) {
    reset();
    const r = await call({ authorization, 'content-type': 'image/jpeg' }, JPEG);
    assert.equal(r.status, 401, authorization.slice(0, 40)); noProvider(); assert.equal(supabaseCalls.length, 0);
  }
});

test('SA-B token invalide (bien formé mais inconnu de Supabase) : 401, 0 appel Perfect Corp', async () => {
  reset();
  const r = await call(bearer('aaaaaaaa.bbbbbbbb.cccccccc'), JPEG);
  assert.equal(r.status, 401); assert.equal(r.body.error, toUserMessage('AUTH_REQUIRED'));
  assert.equal(supabaseCalls.length, 1, 'la vérification se fait réellement auprès de Supabase'); noProvider();
});

test('SA-C token expiré : 401, 0 appel Perfect Corp', async () => {
  const u = await newUser('exp@exemple.com');
  const ok = await call(bearer(u.access_token), JPEG); assert.equal(ok.status, 200);      // valide d'abord
  fake.state.advance(7200);                                                                  // l'heure passe : le jeton expire
  reset();
  const r = await call(bearer(u.access_token), JPEG);
  assert.equal(r.status, 401); noProvider();
});

test('SA-D token falsifié (signature altérée) : 401, 0 appel Perfect Corp', async () => {
  const u = await newUser('forge@exemple.com'); reset();
  const r = await call(bearer(tamper(u.access_token)), JPEG);
  assert.equal(r.status, 401); noProvider();
});

test('SA-D2 la clé publique « anon » (connue de tous) n\'ouvre pas l\'analyse', async () => {
  reset();
  const r = await call(bearer('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJl'), JPEG);
  assert.equal(r.status, 401); noProvider();
});

test('SA-D3 aucun identifiant fourni par le navigateur n\'est cru : en-têtes, corps et paramètres sont ignorés', async () => {
  const u = await newUser('victim@exemple.com'); reset();
  const r = await call({ 'content-type': 'image/jpeg', 'x-user-id': u.user.id, 'x-supabase-user': u.user.id, cookie: 'sb-user=' + u.user.id }, JPEG);
  assert.equal(r.status, 401); noProvider();
  const r2 = await call({ 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ user_id: u.user.id, userId: u.user.id })));
  assert.equal(r2.status, 401); noProvider();
});

test('SA-E authentifié sans photo : 400 de validation, 0 appel Perfect Corp', async () => {
  const u = await newUser('nophoto@exemple.com'); reset();
  const r = await call(bearer(u.access_token), undefined);
  assert.equal(r.status, 400); assert.equal(r.body.error, toUserMessage('NO_IMAGE')); noProvider();
  const bad = await call({ authorization: 'Bearer ' + u.access_token, 'content-type': 'image/png' }, Buffer.from([1, 2, 3, 4]));
  assert.equal(bad.status, 415); noProvider();
});

test('SA-F authentifié + verrou fermé : 503, photo non lue, 0 appel Perfect Corp ; un anonyme ne voit même pas le verrou', async () => {
  const u = await newUser('gate@exemple.com'); reset();
  const saved = process.env.DERMAI_ANALYSIS_ENABLED; delete process.env.DERMAI_ANALYSIS_ENABLED;
  try {
    const r = await call(bearer(u.access_token), JPEG);
    assert.equal(r.status, 503); assert.equal(r.body.error, toUserMessage('ANALYSIS_DISABLED')); assert.equal(r.readStarted, false); noProvider();
    const anon = await call({ 'content-type': 'image/jpeg' }, JPEG);
    assert.equal(anon.status, 401, 'anonyme, verrou fermé : 401 et non 503 (état du verrou non révélé)'); noProvider();
  } finally { process.env.DERMAI_ANALYSIS_ENABLED = saved; }
});

test('SA-G authentifié + requête valide : le pipeline atteint le fournisseur (simulé) et ne renvoie que le résultat normalisé', async () => {
  const u = await newUser('ok@exemple.com'); reset();
  const r = await call(bearer(u.access_token), JPEG);
  assert.equal(r.status, 200); assert.equal(pcCalls, 1, 'le fournisseur simulé est atteint exactement une fois'); assert.deepEqual(netCalls, []);
  assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: skinModel.parseSkinResponse(JSON_RESP).normalized } });
  assert.doesNotMatch(JSON.stringify(r.body), /task_id|mask|https?:|access_token|user/i);
});

test('SA-H panne de Supabase ou configuration absente : échec fermé (503), jamais d\'analyse', async () => {
  const u = await newUser('down@exemple.com');
  reset(); fake.state.failAuthUser = true;
  let r = await call(bearer(u.access_token), JPEG); assert.equal(r.status, 503); assert.equal(r.body.error, toUserMessage('AUTH_UNAVAILABLE')); noProvider();
  fake.state.failAuthUser = false; reset(); fake.state.failNetwork = true;
  r = await call(bearer(u.access_token), JPEG); assert.equal(r.status, 503); noProvider();
  fake.state.failNetwork = false; reset();
  const url = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL;
  try { r = await call(bearer(u.access_token), JPEG); assert.equal(r.status, 503); noProvider(); } finally { process.env.SUPABASE_URL = url; }
  const slow = auth.api.fetchImpl; auth.api.fetchImpl = (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))));
  const t0 = Date.now(); try { r = await call(bearer(u.access_token), JPEG); } finally { auth.api.fetchImpl = slow; }
  assert.equal(r.status, 503); assert.ok(Date.now() - t0 < 8000, 'délai de vérification borné'); noProvider();
});

test('SA-I la vérification n\'utilise que la clé publique, n\'enregistre jamais le jeton et ne révèle aucun détail', async () => {
  const u = await newUser('log@exemple.com'); reset();
  const logs = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => logs.push(a.join(' '));
  let ok, bad;
  try { ok = await call(bearer(u.access_token), JPEG); bad = await call(bearer(tamper(u.access_token)), JPEG); } finally { Object.assign(console, o); }
  assert.equal(supabaseCalls[0].headers.apikey, ANON);
  assert.doesNotMatch(JSON.stringify(supabaseCalls), /service_role/i);
  assert.ok(!logs.join('\n').includes(u.access_token) && !logs.join('\n').includes(tamper(u.access_token)), 'le jeton n\'apparaît jamais dans les journaux');
  assert.doesNotMatch(JSON.stringify(bad.body), /jwt|bad_jwt|supabase|token|signature/i);
  assert.ok(ok.status === 200 && bad.status === 401);
});

test('SA-J GET toujours 405 ; aucun appel Perfect Corp au chargement des modules', async () => {
  reset();
  const r = await call({}, undefined, 'GET'); assert.equal(r.status, 405); noProvider();
});

test('SA-K source : aucune clé service_role, la clé Perfect Corp reste côté serveur, le navigateur envoie le jeton de session', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['server/auth.js', 'api/skin-analysis.js', 'api/config-js.js', 'js/app.js', 'js/account.js', 'index.html']) assert.doesNotMatch(read(f), /SERVICE_ROLE_KEY|process\.env\.SUPABASE_SERVICE|sb_secret|eyJ[A-Za-z0-9_-]{30,}\.eyJ/, f);
  assert.doesNotMatch(read('js/app.js') + read('js/account.js') + read('index.html'), /PERFECT_CORP_API_KEY|makeupar\.com/);
  assert.match(read('js/app.js'), /setRequestHeader\(`Authorization`,`Bearer \$\{token\}`\)/);
  assert.match(read('api/skin-analysis.js'), /await auth\.verifyUser\(req\)[\s\S]*isAnalysisEnabled\(\)[\s\S]*readBody\(req\)[\s\S]*perfectcorp\.analyzeSkin/);
});

/* Fournisseur SIMULÉ au niveau réseau (jamais un vrai appel) : on exécute le VRAI module server/perfectcorp.js, dont le fetch est remplacé. */
const PROVIDER_HOST = /youcam|makeupar|perfectcorp|s3\.example/i;
function simulatedProvider(log) {
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  return async (url, init) => {
    log.push({ url: String(url), method: init && init.method, auth: init && init.headers && init.headers.Authorization });
    if (/\/s2s\/v2\.0\/file$/.test(url)) return json(200, { data: { files: [{ file_id: 'F1', requests: [{ method: 'PUT', url: 'https://s3.example/up?sig=1', headers: { 'Content-Type': 'image/jpeg' } }] }] } });
    if (/s3\.example/.test(url)) return json(200, {});
    if (/\/task\/skin-analysis$/.test(url)) return json(200, { data: { task_id: 'T1' } });
    if (/\/task\/skin-analysis\/T1$/.test(url)) return json(200, JSON_RESP);
    throw new Error('requête inattendue : ' + url);
  };
}

test('SA-L G complet : utilisateur authentifié → validation → fournisseur SIMULÉ (vrai module, réseau simulé) → normalisation → résultat', async () => {
  const u = await newUser('pipeline@exemple.com'); reset();
  const savedKey = process.env.PERFECT_CORP_API_KEY; process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL';
  const log = []; const trap = global.fetch; global.fetch = simulatedProvider(log); perfectcorp.analyzeSkin = realAnalyze;
  try {
    const r = await call(bearer(u.access_token), JPEG);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: skinModel.parseSkinResponse(JSON_RESP).normalized } });
    assert.deepEqual(log.map(l => l.method + ' ' + new URL(l.url).pathname), ['POST /s2s/v2.0/file', 'PUT /up', 'POST /s2s/v2.1/task/skin-analysis', 'GET /s2s/v2.1/task/skin-analysis/T1']);
    assert.ok(log.every(l => /^(https:\/\/yce-api-01\.makeupar\.com|https:\/\/s3\.example)/.test(l.url)), 'seulement les hôtes simulés');
    assert.equal(JSON.stringify(r.body).includes('TEST_ONLY_KEY_NOT_REAL'), false, 'la clé reste côté serveur');
  } finally { global.fetch = trap; perfectcorp.analyzeSkin = async () => { pcCalls++; return JSON_RESP; }; if (savedKey === undefined) delete process.env.PERFECT_CORP_API_KEY; else process.env.PERFECT_CORP_API_KEY = savedKey; }
});

test('SA-M aucun chemin refusé n\'atteint le réseau du fournisseur, même avec une clé Perfect Corp présente et le vrai module', async () => {
  const u = await newUser('matrix@exemple.com');
  const savedKey = process.env.PERFECT_CORP_API_KEY; process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL';
  const log = []; const trap = global.fetch; global.fetch = simulatedProvider(log); perfectcorp.analyzeSkin = realAnalyze; reset();
  try {
    const expired = await newUser('matrix-exp@exemple.com'); fake.state.advance(7200);                 // expire tous les jetons créés jusqu'ici
    const fresh = await newUser('matrix-fresh@exemple.com');
    const cases = [
      ['sans Authorization', { 'content-type': 'image/jpeg' }, JPEG, 401],
      ['jeton invalide', bearer('aaaaaaaa.bbbbbbbb.cccccccc'), JPEG, 401],
      ['jeton expiré', bearer(expired.access_token), JPEG, 401],
      ['jeton falsifié', bearer(tamper(fresh.access_token)), JPEG, 401],
      ['clé anon', bearer(ANON.padEnd(12, 'x') + '.' + 'payload12.' + 'sig12345'), JPEG, 401],
      ['authentifié, sans photo', bearer(fresh.access_token), undefined, 400],
      ['authentifié, mauvais format', { authorization: 'Bearer ' + fresh.access_token, 'content-type': 'image/png' }, JPEG, 415],
      ['authentifié, faux JPEG', bearer(fresh.access_token), Buffer.from([1, 2, 3, 4, 5]), 415]
    ];
    for (const [label, h, body, status] of cases) { const r = await call(h, body); assert.equal(r.status, status, label); }
    const saved = process.env.DERMAI_ANALYSIS_ENABLED; delete process.env.DERMAI_ANALYSIS_ENABLED;
    try { const r = await call(bearer(fresh.access_token), JPEG); assert.equal(r.status, 503, 'verrou fermé'); } finally { process.env.DERMAI_ANALYSIS_ENABLED = saved; }
    assert.deepEqual(log.filter(l => PROVIDER_HOST.test(l.url)), [], 'aucune requête vers youcam / makeupar / perfectcorp');
    assert.deepEqual(netCalls, []);
  } finally { global.fetch = trap; perfectcorp.analyzeSkin = async () => { pcCalls++; return JSON_RESP; }; if (savedKey === undefined) delete process.env.PERFECT_CORP_API_KEY; else process.env.PERFECT_CORP_API_KEY = savedKey; }
});

test('SA-N aucun test n\'appelle directement le fournisseur : aucun fetch réel vers youcam / makeupar / perfectcorp', () => {
  for (const f of fs.readdirSync(__dirname).filter(x => x.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.doesNotMatch(src, /(?<![.\w])fetch\(\s*[`'"][^)]*(youcam|makeupar|perfectcorp)/i, f + ' : appel direct au fournisseur');
    assert.doesNotMatch(src, /(?<![.\w])fetch\(\s*(?:BASE|PERFECT_CORP_BASE_URL)/, f);
  }
  const perf = fs.readFileSync(path.join(__dirname, 'perfectcorp.test.js'), 'utf8');
  assert.match(perf, /function mockFetch/);          // la couche fournisseur n'est testée qu'avec un fetch simulé
  assert.doesNotMatch(perf, /globalThis\.fetch|global\.fetch/);
});
