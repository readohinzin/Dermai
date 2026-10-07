'use strict';
/* Quota d'analyses et protection du coût : /api/skin-analysis contre un faux Supabase en mémoire. Perfect Corp est TOUJOURS simulé
   (compteur ou réseau simulé) : aucun appel réel, aucune unité consommée. L'atomicité réelle est prouvée sur PostgreSQL dans quota-db.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');
const { createFake } = require('./helpers/fake-supabase.js');
const { toUserMessage, AnalysisError } = require('../server/errors');

const URL_SB = 'https://demo.supabase.co', ANON = 'public-anon-key';
process.env.SUPABASE_URL = URL_SB; process.env.SUPABASE_ANON_KEY = ANON; process.env.DERMAI_ANALYSIS_ENABLED = '1';
process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL';
delete process.env.DERMAI_MAX_ANALYSES_PER_PERIOD; delete process.env.DERMAI_ANALYSIS_PERIOD_HOURS;
const auth = require('../server/auth'), quota = require('../server/quota'), perfectcorp = require('../server/perfectcorp');
const config = require('../server/config');
const handler = require('../api/skin-analysis.js');
require('../server/masks').api.fetchImpl = async () => { throw new Error('hors ligne (test)'); };   // aucun téléchargement réseau de masque dans ces tests
const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const fake = createFake();
const rpcCalls = [];
auth.api.fetchImpl = (u, i) => fake.fetch(u, i);
quota.api.fetchImpl = (u, i) => { if (/reserve_analysis/.test(u)) rpcCalls.push(JSON.parse(i.body)); return fake.fetch(u, i); };
let pc = 0, net = [];
const realAnalyze = perfectcorp.analyzeSkin;
let providerBehaviour = () => JSON_RESP;
perfectcorp.analyzeSkin = async () => { pc++; return providerBehaviour(); };
const realFetch = global.fetch;
global.fetch = async u => { net.push(String(u)); throw new Error('réseau interdit dans ce test'); };
test.after(() => { global.fetch = realFetch; });

async function newUser(email) {
  const r = await fake.fetch(URL_SB + '/auth/v1/signup', { method: 'POST', headers: { apikey: ANON }, body: JSON.stringify({ email, password: 'motdepasse1' }) });
  return JSON.parse(await r.text());
}
function call(headers, data, method = 'POST', url = '/api/skin-analysis') {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []); req.method = method; req.headers = headers || {}; req.url = url;
    const h = {}, res = { setHeader(k, v) { h[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: h }); } };
    handler(req, res);
  });
}
const as = (u, extra) => Object.assign({ authorization: 'Bearer ' + u.access_token, 'content-type': 'image/jpeg' }, extra);
const reset = () => { pc = 0; net = []; rpcCalls.length = 0; fake.usage.clear(); };
const used = u => (fake.usage.get(u.user.id) || []).length;
const withEnv = async (vars, fn) => { const saved = {}; for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } } };
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { Object.assign(console, o); } };

test('Q1 configuration : valeurs prudentes par défaut, modifiables par variables d\'environnement, jamais « illimité »', () => {
  assert.deepEqual(config.analysisQuota({}), { limit: 3, windowSeconds: 86400 });
  assert.deepEqual(config.analysisQuota({ DERMAI_MAX_ANALYSES_PER_PERIOD: '10', DERMAI_ANALYSIS_PERIOD_HOURS: '168' }), { limit: 10, windowSeconds: 604800 });
  assert.equal(config.analysisQuota({ DERMAI_MAX_ANALYSES_PER_PERIOD: '0' }).limit, 0, '0 = aucune analyse');
  for (const bad of ['', ' ', 'abc', '-1', '1.5', '99999999', 'illimité', 'Infinity', '1e3']) {
    assert.deepEqual(config.analysisQuota({ DERMAI_MAX_ANALYSES_PER_PERIOD: bad, DERMAI_ANALYSIS_PERIOD_HOURS: bad }), { limit: 3, windowSeconds: 86400 }, `« ${bad} »`);
  }
  assert.equal(config.analysisQuota({ DERMAI_MAX_ANALYSES_PER_PERIOD: '1001' }).limit, 3, 'au-delà de 1000 : valeur par défaut');
  assert.equal(config.analysisQuota({ DERMAI_ANALYSIS_PERIOD_HOURS: '0' }).windowSeconds, 86400, 'période nulle : valeur par défaut');
  assert.equal(config.analysisQuota({ DERMAI_ANALYSIS_PERIOD_HOURS: '8761' }).windowSeconds, 86400, 'au-delà d\'un an : valeur par défaut');
});

test('Q2 quota respecté : au-delà de la limite, 429 + délai d\'attente, le fournisseur n\'est plus atteint', async () => {
  const u = await newUser('q2@exemple.com'); reset();
  await withEnv({ DERMAI_MAX_ANALYSES_PER_PERIOD: '2', DERMAI_ANALYSIS_PERIOD_HOURS: '24' }, async () => {
    for (let i = 0; i < 2; i++) assert.equal((await quiet(() => call(as(u), JPEG)))[0].status, 200);
    const [r] = await quiet(() => call(as(u), JPEG));
    assert.equal(r.status, 429); assert.equal(r.body.error, toUserMessage('QUOTA_EXCEEDED')); assert.equal(r.body.ok, false);
    assert.ok(Number(r.headers['retry-after']) > 0, 'Retry-After');
    assert.equal(pc, 2, 'le fournisseur n\'a été atteint que deux fois'); assert.equal(used(u), 2);
    fake.state.advance(24 * 3600 + 5);                          // la période passe : le quota se renouvelle (le jeton, lui, a expiré : nouvelle connexion)
    const again = JSON.parse(await (await fake.fetch(URL_SB + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: ANON }, body: JSON.stringify({ email: 'q2@exemple.com', password: 'motdepasse1' }) })).text());
    assert.equal((await quiet(() => call(as(again), JPEG)))[0].status, 200); assert.equal(pc, 3);
  });
});

test('Q3 CONCURRENCE : 8 requêtes simultanées d\'un même compte avec 1 analyse restante → une seule atteint le fournisseur', async () => {
  const u = await newUser('q3@exemple.com'); reset();
  await withEnv({ DERMAI_MAX_ANALYSES_PER_PERIOD: '1' }, async () => {
    const [rs] = await quiet(() => Promise.all(Array.from({ length: 8 }, () => call(as(u), JPEG))));
    assert.equal(rs.filter(r => r.status === 200).length, 1); assert.equal(rs.filter(r => r.status === 429).length, 7);
    assert.equal(pc, 1, 'une seule requête a atteint le fournisseur'); assert.equal(used(u), 1);
  });
});

test('Q4 les refus en amont ne consomment rien : non connecté, jeton falsifié, verrou fermé, photo invalide, clé fournisseur absente', async () => {
  const u = await newUser('q4@exemple.com'); reset();
  const cases = [
    ['sans Authorization', { 'content-type': 'image/jpeg' }, JPEG, 401],
    ['jeton falsifié', as({ access_token: 'aaaaaaaa.bbbbbbbb.cccccccc' }), JPEG, 401],
    ['sans photo', as(u), undefined, 400],
    ['mauvais MIME', as(u, { 'content-type': 'image/png' }), JPEG, 415],
    ['faux JPEG', as(u), Buffer.from([1, 2, 3, 4, 5]), 415],
    ['fichier vide avec content-type', as(u, { 'content-length': '0' }), undefined, 400],
    ['trop gros (déclaré)', as(u, { 'content-length': String(5 * 1024 * 1024) }), JPEG, 413]
  ];
  for (const [label, h, body, status] of cases) { const [r] = await quiet(() => call(h, body)); assert.equal(r.status, status, label); }
  await withEnv({ DERMAI_ANALYSIS_ENABLED: undefined }, async () => assert.equal((await quiet(() => call(as(u), JPEG)))[0].status, 503));
  await withEnv({ PERFECT_CORP_API_KEY: undefined }, async () => { const [r] = await quiet(() => call(as(u), JPEG)); assert.equal(r.status, 503); assert.equal(r.body.error, toUserMessage('SERVICE_UNAVAILABLE')); });
  assert.equal(used(u), 0, 'aucune analyse consommée'); assert.equal(rpcCalls.length, 0, 'la base de quota n\'est même pas interrogée'); assert.equal(pc, 0); assert.deepEqual(net, []);
});

test('Q5 échec du fournisseur : la réservation reste consommée (hypothèse la plus sûre pour le coût) et l\'utilisateur reçoit un message humain', async () => {
  const u = await newUser('q5@exemple.com'); reset();
  await withEnv({ DERMAI_MAX_ANALYSES_PER_PERIOD: '2' }, async () => {
    for (const err of [new AnalysisError('TIMEOUT', { status: 504 }), new AnalysisError('SERVICE_UNAVAILABLE', { status: 502, detail: 'secret interne' })]) {
      providerBehaviour = () => { throw err; };
      const [r] = await quiet(() => call(as(u), JPEG));
      assert.ok([502, 504].includes(r.status)); assert.doesNotMatch(JSON.stringify(r.body), /secret interne|TEST_ONLY_KEY|access|Bearer/);
    }
    providerBehaviour = () => JSON_RESP;
    assert.equal(used(u), 2); assert.equal(pc, 2);
    assert.equal((await quiet(() => call(as(u), JPEG)))[0].status, 429, 'les deux échecs ont consommé le quota');
  });
  providerBehaviour = () => JSON_RESP;
});

test('Q6 panne de la base de quota, fonction absente, jeton expiré entre-temps : échec fermé, jamais d\'analyse', async () => {
  const u = await newUser('q6@exemple.com'); reset();
  for (const [label, flip, status] of [['fonction absente (migration non appliquée)', s => { s.quotaMissing = true; }, 503], ['erreur serveur', s => { s.failQuota = true; }, 503]]) {
    flip(fake.state); const [r] = await quiet(() => call(as(u), JPEG)); fake.state.quotaMissing = false; fake.state.failQuota = false;
    assert.equal(r.status, status, label); assert.equal(r.body.error, toUserMessage('QUOTA_UNAVAILABLE')); assert.doesNotMatch(JSON.stringify(r.body), /rpc|reserve_analysis|PGRST|XX000|trace/i);
  }
  fake.state.failNetwork = true; const [n] = await quiet(() => call(as(u), JPEG)); fake.state.failNetwork = false;
  assert.ok([401, 503].includes(n.status));
  assert.equal(pc, 0); assert.deepEqual(net, []);
});

test('Q7 le client ne peut influencer ni la limite, ni la période, ni l\'identité : tout vient du serveur et du jeton vérifié', async () => {
  const a = await newUser('q7a@exemple.com'), b = await newUser('q7b@exemple.com'); reset();
  await withEnv({ DERMAI_MAX_ANALYSES_PER_PERIOD: '1', DERMAI_ANALYSIS_PERIOD_HOURS: '24' }, async () => {
    const sneaky = { 'x-quota-limit': '9999', 'x-window': '1', 'x-user-id': b.user.id, 'x-forwarded-user': b.user.id, cookie: 'user_id=' + b.user.id };
    assert.equal((await quiet(() => call(as(a, sneaky), JPEG, 'POST', '/api/skin-analysis?limit=9999&window=1&user_id=' + b.user.id + '&actions=hd_acne&model=hd')))[0].status, 200);
    const [again] = await quiet(() => call(as(a, sneaky), JPEG, 'POST', '/api/skin-analysis?limit=9999&p_limit=9999'));
    assert.equal(again.status, 429, 'les paramètres du client n\'ouvrent pas de quota supplémentaire');
    assert.deepEqual(rpcCalls.map(c => c), [{ p_limit: 1, p_window_seconds: 86400 }, { p_limit: 1, p_window_seconds: 86400 }], 'la base ne reçoit que la configuration du serveur');
    assert.equal(used(a), 1); assert.equal(used(b), 0, 'le quota de B n\'a pas été touché par les en-têtes de A');
    assert.equal((await quiet(() => call(as(b), JPEG)))[0].status, 200, 'B garde son propre quota intact');
  });
});

test('Q8 les paramètres envoyés à Perfect Corp sont fixés par le serveur : le client ne choisit ni action, ni modèle, ni fournisseur', async () => {
  const u = await newUser('q8@exemple.com'); reset();
  perfectcorp.analyzeSkin = realAnalyze;
  const seen = [];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  global.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init && init.method, body: init && init.body });
    if (/\/s2s\/v2\.0\/file$/.test(url)) return json(200, { data: { files: [{ file_id: 'F1', requests: [{ method: 'PUT', url: 'https://s3.example/up', headers: { 'Content-Type': 'image/jpeg' } }] }] } });
    if (/s3\.example/.test(url)) return json(200, {});
    if (/\/task\/skin-analysis$/.test(url)) return json(200, { data: { task_id: 'T1' } });
    if (/\/task\/skin-analysis\/T1$/.test(url)) return json(200, JSON_RESP);
    throw new Error('requête inattendue : ' + url);
  };
  try {
    const hostile = { 'x-actions': 'hd_acne,hd_wrinkle', 'x-model': 'hd', 'x-provider': 'https://evil.example', 'x-file-name': '../../etc/passwd' };
    const [r] = await quiet(() => call(as(u, hostile), JPEG, 'POST', '/api/skin-analysis?dst_actions=hd_skin_analysis&format=zip&model=hd&base=https://evil.example'));
    assert.equal(r.status, 200);
    const task = seen.find(s => /\/task\/skin-analysis$/.test(s.url));
    assert.deepEqual(JSON.parse(task.body), { src_file_id: 'F1', dst_actions: config.PERFECT_CORP_SKIN_ACTIONS, format: 'json' });
    assert.ok(config.PERFECT_CORP_SKIN_ACTIONS.every(a => !/^hd_/.test(a)), 'actions SD uniquement');
    assert.ok(seen.every(s => /^https:\/\/(yce-api-01\.makeupar\.com|s3\.example)\//.test(s.url)), 'seuls les hôtes prévus sont contactés');
    assert.equal(seen.filter(s => /\/task\/skin-analysis$/.test(s.url)).length, 1, 'une seule tâche créée par requête');
    assert.doesNotMatch(JSON.stringify(seen), /evil|passwd|hd_acne|hd_wrinkle/);
  } finally { global.fetch = async u => { net.push(String(u)); throw new Error('réseau interdit dans ce test'); }; perfectcorp.analyzeSkin = async () => { pc++; return providerBehaviour(); }; }
});

test('Q9 aucun secret dans les réponses ni les journaux : jeton, clé Perfect Corp, identifiants', async () => {
  const u = await newUser('q9@exemple.com'); reset();
  await withEnv({ DERMAI_MAX_ANALYSES_PER_PERIOD: '1' }, async () => {
    const [[ok, over], lines] = await quiet(async () => [await call(as(u), JPEG), await call(as(u), JPEG)]);
    const everything = JSON.stringify([ok.body, over.body, over.headers]) + lines.join('\n');
    assert.equal(ok.status, 200); assert.equal(over.status, 429);
    assert.ok(!everything.includes(u.access_token) && !everything.includes(u.refresh_token) && !everything.includes('TEST_ONLY_KEY_NOT_REAL') && !everything.includes(u.user.id) && !everything.includes('q9@exemple.com'), 'ni jeton, ni clé, ni identité, ni e-mail');
  });
});

test('Q10 source : le quota est calculé par la base, jamais en mémoire de la fonction ; la clé fournisseur reste côté serveur', () => {
  const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const q = src('server/quota.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(q, /rest\/v1\/rpc\/reserve_analysis/);
  assert.doesNotMatch(q, /new Map\(|new Set\(|let count|counter|Date\.now\(\)/i, 'aucun compteur en mémoire');
  assert.doesNotMatch((src('server/auth.js') + src('server/quota.js') + src('api/skin-analysis.js')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /service_role|SERVICE_ROLE/i);
  const handlerSrc = src('api/skin-analysis.js');
  assert.ok(handlerSrc.indexOf('quota.reserve') > handlerSrc.indexOf('validateImage') && handlerSrc.indexOf('quota.reserve') < handlerSrc.indexOf('perfectcorp.analyzeSkin'), 'ordre : validation de la photo, puis quota, puis fournisseur');
  assert.doesNotMatch(src('js/app.js') + src('js/account.js'), /reserve_analysis|PERFECT_CORP|DERMAI_MAX_ANALYSES/, 'rien du quota ni du fournisseur côté navigateur');
});
