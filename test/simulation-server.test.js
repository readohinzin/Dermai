'use strict';
/* Simulation cosmétique avant/après : serveur (api/skin-simulation.js, server/perfectcorp-simulation.js), TOUT simulé.
   Aucun appel réel à Perfect Corp : globalThis.fetch est remplacé par un faux fournisseur qui enregistre chaque appel et REFUSE tout hôte inconnu
   et tout appel à l'API d'analyse (/skin-analysis). Aucune unité n'est consommée par ce fichier : le compteur d'appels « réels » reste à zéro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');

const auth = require('../server/auth');
const quota = require('../server/quota');
const config = require('../server/config');
const errors = require('../server/errors');
const sim = require('../server/perfectcorp-simulation');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'TEST_ONLY_KEY_NOT_REAL_9f3a';
const USER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc', TOKEN2 = 'dddddddd.eeeeeeee.ffffffff';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const SB = createFake();
auth.api.fetchImpl = SB.fetch; quota.api.fetchImpl = SB.fetch;
SB.users.set('a@exemple.com', { id: USER, email: 'a@exemple.com', password: 'x', confirmed: true });
SB.users.set('b@exemple.com', { id: OTHER, email: 'b@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER, exp: Number.MAX_SAFE_INTEGER });
SB.tokens.set(TOKEN2, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });

const ENV0 = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key', PERFECT_CORP_API_KEY: KEY };
const open = { DERMAI_SIMULATION_ENABLED: '1', DERMAI_SIMULATION_ALLOWED_USER_IDS: USER, DERMAI_MAX_SIMULATIONS_PER_PERIOD: '100', DERMAI_DEBUG_RAW: undefined };
Object.assign(process.env, ENV0);
const handler = require('../api/skin-simulation.js');

/* ───── Faux Perfect Corp : enregistre tout, refuse le reste ───── */
const BASE = config.PERFECT_CORP_BASE_URL;
const rec = { calls: [], unexpected: [], real: 0 };
const mock = { status: [{ data: { task_status: 'success', results: { url: 'https://cdn.example-pc.com/out/sim1.png' } } }], fileFail: false, taskBody: null, taskId: 't-sim-1', taskStatus: 200, noTaskId: false };
const reset = () => { rec.calls = []; rec.unexpected = []; mock.status = [{ data: { task_status: 'success', results: { url: 'https://cdn.example-pc.com/out/sim1.png' } } }]; mock.fileFail = false; mock.taskId = 't-sim-1'; mock.taskStatus = 200; mock.noTaskId = false; };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let polls = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init && init.method) || 'GET';
  rec.calls.push({ url: u, method, auth: init.headers && (init.headers.Authorization || init.headers.authorization), body: init.body });
  if (/skin-analysis/.test(u)) { rec.unexpected.push('ANALYSE ' + u); throw new Error('appel à l\'API d\'analyse interdit'); }
  if (u === BASE + '/s2s/v2.0/file') {
    if (mock.fileFail) return json(500, { error: 'boom' });
    return json(200, { data: { files: [{ file_id: 'file-1', requests: [{ url: 'https://upload.example-pc.com/put/abc', method: 'PUT', headers: {} }] }] } });
  }
  if (u === 'https://upload.example-pc.com/put/abc') return new Response('', { status: 200 });
  if (/cdn\.example-pc\.com/.test(u)) { rec.unexpected.push('TÉLÉCHARGEMENT du résultat par le serveur ' + u); throw new Error('le serveur ne télécharge pas l\'image (elle dépasse la limite de réponse)'); }
  if (u === BASE + config.SIM_PATHS.task && method === 'POST') { mock.taskBody = JSON.parse(init.body); return mock.noTaskId ? json(200, { data: {} }) : json(mock.taskStatus, { data: { task_id: mock.taskId } }); }
  if (u === BASE + config.SIM_PATHS.taskStatus(mock.taskId) && method === 'GET') { const r = mock.status[Math.min(polls++, mock.status.length - 1)]; return json(200, r); }
  rec.unexpected.push(method + ' ' + u); rec.real++; throw new Error('hôte ou chemin inattendu : ' + u);
};

/* ───── Appel du handler ───── */
function call(method, { token = TOKEN, query = 'concern=wrinkle', headers = {}, data = JPEG } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.url = '/api/skin-simulation' + (query ? '?' + query : '');
    req.headers = Object.assign({ 'content-type': 'image/jpeg' }, token ? { authorization: 'Bearer ' + token } : {}, headers);
    const sent = {};
    const res = { setHeader(k, v) { sent[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: sent, raw: b }); } };
    handler(req, res);
  });
}
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { Object.assign(console, o); } };
const run = async (env, fn) => { reset(); polls = 0; SB.state.rpcCalls = []; SB.simUsage.clear(); SB.usage.clear(); SB.state.simQuotaMissing = false; SB.state.failQuota = false; return withEnv(Object.assign({}, open, env), async () => (await quiet(fn))[0]); };
const providerCalls = () => rec.calls.filter(c => !c.result);
const rpc = () => SB.state.rpcCalls || [];

test('SIM-S1 méthode : seuls GET et POST sont acceptés (405 avec Allow), rien n\'est appelé', async () => {
  const r = await run({}, () => call('DELETE'));
  assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, POST'); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
});

test('SIM-S2 authentification : sans session, session invalide, jeton mal formé → 401 AVANT tout (même verrou fermé), rien n\'est appelé', async () => {
  for (const env of [{}, { DERMAI_SIMULATION_ENABLED: undefined }]) {
    for (const t of [null, 'zzz', 'aaaaaaaa.bbbbbbbb.invalid0', 'bbbbbbbb.cccccccc.dddddddd']) {
      const r = await run(env, () => call('POST', { token: t }));
      assert.equal(r.status, 401, String(t)); assert.equal(r.headers['WWW-Authenticate'], 'Bearer');
      assert.equal(r.body.error, errors.toSimulationMessage('AUTH_REQUIRED'));
      assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
      const g = await run(env, () => call('GET', { token: t })); assert.equal(g.status, 401);
    }
  }
});

test('SIM-S3 GET « disponible ? » : propre à chaque compte, sans fournisseur ni quota', async () => {
  let r = await run({}, () => call('GET')); assert.deepEqual(r.body, { ok: true, available: true });
  r = await run({}, () => call('GET', { token: TOKEN2 })); assert.deepEqual(r.body, { ok: true, available: false }, 'compte non listé');
  r = await run({ DERMAI_SIMULATION_ENABLED: undefined }, () => call('GET')); assert.equal(r.body.available, false, 'verrou fermé');
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: undefined }, () => call('GET')); assert.equal(r.body.available, false, 'liste vide = personne');
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: ' , ,' }, () => call('GET')); assert.equal(r.body.available, false);
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: 'x,' + USER + ' , y' }, () => call('GET')); assert.equal(r.body.available, true, 'liste séparée par des virgules');
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  try { r = await run({}, () => call('GET')); assert.equal(r.body.available, false, 'clé non configurée'); } finally { process.env.PERFECT_CORP_API_KEY = saved; }
  assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
});

test('SIM-S4 verrou fermé par défaut : 503, la photo n\'est pas lue, rien n\'est appelé ni réservé', async () => {
  for (const v of [undefined, '', '0', 'false', 'non']) {
    const r = await run({ DERMAI_SIMULATION_ENABLED: v }, () => call('POST', { headers: { 'content-type': 'image/png' }, data: Buffer.from([1, 2, 3]) }));
    assert.equal(r.status, 503, String(v)); assert.equal(r.body.error, errors.MESSAGES.SIM_DISABLED);
    assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
});

test('SIM-S5 verrou ouvert mais compte non autorisé (ou liste absente/vide) : 403, rien n\'est appelé ni réservé', async () => {
  for (const list of [undefined, '', OTHER, 'tous', '**', '* ?', 'all', USER.slice(0, 20)]) {
    const r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: list }, () => call('POST'));
    assert.equal(r.status, 403, String(list)); assert.equal(r.body.error, errors.MESSAGES.SIM_DISABLED);
    assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
});

test('SIM-S5b « * » : tout compte CONNECTÉ peut simuler (choix explicite) ; le verrou, la session et le quota PAR compte restent exigés', async () => {
  for (const list of ['*', ' * ', 'x, *', '*,' + OTHER]) {
    const a = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: list, DERMAI_MAX_SIMULATIONS_PER_PERIOD: '1' }, async () => [await call('POST'), await call('POST', { token: TOKEN2 }), await call('POST'), await call('GET', { token: TOKEN2 })]);
    assert.deepEqual(a.map(r => r.status), [200, 200, 429, 200], list + ' : chacun son quota, le troisième appel du premier compte est refusé');
    assert.deepEqual(a[3].body, { ok: true, available: true });
    assert.equal(SB.simUsage.get(USER).length, 1); assert.equal(SB.simUsage.get(OTHER).length, 1);
  }
  let r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: '*', DERMAI_SIMULATION_ENABLED: undefined }, () => call('POST')); assert.equal(r.status, 503, '« * » n\'ouvre rien sans le verrou');
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: '*' }, () => call('POST', { token: null })); assert.equal(r.status, 401, 'toujours une session valide');
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: '*' }, () => call('GET', { token: 'aaaaaaaa.bbbbbbbb.invalid0' })); assert.equal(r.status, 401);
  r = await run({ DERMAI_SIMULATION_ALLOWED_USER_IDS: '*' }, () => call('POST', { query: 'concern=oiliness' })); assert.equal(r.status, 400, 'la liste blanche des zones ne change pas');
  assert.equal(config.isSimulationAllowed('', { DERMAI_SIMULATION_ALLOWED_USER_IDS: '*' }), false, 'pas d\'identité = refus, même avec « * »');
  assert.equal(config.isSimulationAllowed(USER, { DERMAI_SIMULATION_ALLOWED_USER_IDS: '' }), false); assert.equal(config.isSimulationAllowed(USER, {}), false, 'défaut : personne');
});

test('SIM-S6 zone : une seule, dans la liste blanche ; « oiliness » et les noms piégés sont refusés avant la photo, le quota et le fournisseur', async () => {
  for (const q of ['', 'concern=', 'concern=oiliness', 'concern=wrinkle&concern=acne', 'concern=WRINKLE', 'concern=__proto__', 'concern=constructor', 'concern=toString', 'concern=skin_type', 'concern=wrinkle%00', 'x=wrinkle']) {
    const r = await run({}, () => call('POST', { query: q }));
    assert.equal(r.status, 400, q); assert.equal(r.body.error, errors.MESSAGES.SIM_INVALID_CONCERN);
    assert.equal(rec.calls.length, 0, q); assert.deepEqual(rpc(), [], q);
  }
  assert.ok(!('oiliness' in config.SIM_CONCERNS), '« oiliness » AJOUTE de la brillance : jamais proposée comme amélioration');
  assert.equal(sim.concernParam('constructor'), null); assert.equal(sim.concernParam(undefined), null);
});

test('SIM-S7 photo : absente, mauvais type, faux JPEG, trop lourde → refus sans quota ni fournisseur', async () => {
  const cases = [[{ data: null }, 400], [{ headers: { 'content-type': 'image/png' }, data: Buffer.from([0xff, 0xd8, 0xff, 1]) }, 415], [{ data: Buffer.from([1, 2, 3, 4]) }, 415], [{ headers: { 'content-length': String(5 * 1024 * 1024) } }, 413]];
  for (const [opt, status] of cases) {
    const r = await run({}, () => call('POST', opt));
    assert.equal(r.status, status); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
});

test('SIM-S8 clé fournisseur absente : 503 générique sans détail, aucun quota consommé', async () => {
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  try {
    const r = await run({}, () => call('POST'));
    assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.SIM_UNAVAILABLE); assert.ok(!/PERFECT|key|clé/i.test(r.raw));
    assert.deepEqual(rpc(), []); assert.equal(rec.calls.length, 0);
  } finally { process.env.PERFECT_CORP_API_KEY = saved; }
});

test('SIM-S9 succès : image + zone + intensité seulement ; ni clé, ni task_id, ni URL du fournisseur, ni enveloppe ; la clé n\'est envoyée qu\'à Perfect Corp', async () => {
  const r = await run({}, () => call('POST', { query: 'concern=radiance' }));
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.deepEqual(Object.keys(r.body), ['ok', 'simulation']); assert.deepEqual(Object.keys(r.body.simulation), ['concern', 'intensity', 'image']);
  assert.equal(r.body.simulation.concern, 'radiance'); assert.equal(r.body.simulation.intensity, config.SIM_INTENSITY);
  assert.equal(r.body.simulation.image, 'https://cdn.example-pc.com/out/sim1.png', 'l\'URL temporaire du résultat (champ data.results.url, confirmé par le premier essai réel) est renvoyée telle quelle');
  assert.ok(!r.raw.includes(KEY) && !/t-sim-1|file-1|upload\.example-pc|Bearer|task_id/.test(r.raw), 'aucune fuite');
  assert.equal(r.raw.split('example-pc').length - 1, 1, 'la seule URL du fournisseur est celle de l\'image');
  assert.deepEqual(rec.unexpected, [], 'le serveur ne télécharge pas l\'image');
  const withKey = rec.calls.filter(c => c.auth); assert.ok(withKey.length >= 3);
  assert.ok(withKey.every(c => c.url.startsWith(BASE + '/')), 'la clé ne va qu\'à l\'hôte Perfect Corp');
  assert.ok(rec.calls.filter(c => !c.auth).every(c => /upload\.example-pc/.test(c.url)), 'URL présignée : sans clé');
  assert.deepEqual(rpc(), ['reserve_simulation']);
  assert.equal(SB.simUsage.get(USER).length, 1); assert.equal(SB.usage.size, 0, 'le quota d\'analyses n\'est pas touché');
});

test('SIM-S10 requête fournisseur : API fichier, UNE tâche de simulation avec UNE préoccupation, jamais l\'API d\'analyse', async () => {
  for (const c of Object.keys(config.SIM_CONCERNS)) {
    await run({}, () => call('POST', { query: 'concern=' + c }));
    assert.deepEqual(mock.taskBody, { src_file_id: 'file-1', [config.SIM_CONCERNS[c]]: config.SIM_INTENSITY }, c);
    const urls = providerCalls().map(x => x.method + ' ' + x.url.replace(BASE, ''));
    assert.deepEqual(urls.filter(u => u.startsWith('POST /') || u.startsWith('GET /')), ['POST /s2s/v2.0/file', 'POST ' + config.SIM_PATHS.task, 'GET ' + config.SIM_PATHS.taskStatus('t-sim-1')]);
    assert.equal(providerCalls().filter(x => x.method === 'POST' && x.url === BASE + config.SIM_PATHS.task).length, 1, 'une seule tâche');
    assert.deepEqual(rec.unexpected, []); assert.equal(rec.real, 0);
  }
  assert.ok(config.SIM_INTENSITY > 0 && config.SIM_INTENSITY <= 1);
});

test('SIM-S10b intensité : défaut 0,8 ; réglable par DERMAI_SIMULATION_INTENSITY (0,1 à 1) ; valeur invalide = défaut ; envoyée au fournisseur et renvoyée', async () => {
  assert.equal(config.SIM_INTENSITY, 0.8);
  for (const [v, want] of [[undefined, 0.8], ['', 0.8], ['abc', 0.8], ['0', 0.8], ['0.05', 0.8], ['1.5', 0.8], ['-1', 0.8], ['0.8; drop', 0.8], ['0.3', 0.3], ['1', 1], ['1.0', 1], ['0.55', 0.55], ['.7', 0.7], [' 0.9 ', 0.9]]) {
    assert.equal(config.simulationIntensity({ DERMAI_SIMULATION_INTENSITY: v }), want, String(v));
  }
  const r = await run({ DERMAI_SIMULATION_INTENSITY: '0.95' }, () => call('POST', { query: 'concern=acne' }));
  assert.equal(r.status, 200); assert.equal(r.body.simulation.intensity, 0.95); assert.deepEqual(mock.taskBody, { src_file_id: 'file-1', acne: 0.95 });
  const d = await run({ DERMAI_SIMULATION_INTENSITY: 'n\'importe quoi' }, () => call('POST', { query: 'concern=acne' }));
  assert.equal(d.body.simulation.intensity, 0.8); assert.deepEqual(mock.taskBody, { src_file_id: 'file-1', acne: 0.8 });
});

test('SIM-S11 quota PROPRE : le second appel est refusé (429, Retry-After), un seul crédit chez le fournisseur ; les analyses n\'y comptent pas', async () => {
  const [a, b] = await run({ DERMAI_MAX_SIMULATIONS_PER_PERIOD: '1' }, async () => [await call('POST'), await call('POST')]);
  assert.equal(a.status, 200); assert.equal(b.status, 429); assert.equal(b.body.error, errors.MESSAGES.SIM_QUOTA_EXCEEDED); assert.ok(Number(b.headers['Retry-After']) >= 1);
  assert.equal(providerCalls().filter(x => x.url === BASE + config.SIM_PATHS.task).length, 1);
  assert.deepEqual(rpc(), ['reserve_simulation', 'reserve_simulation'], 'jamais reserve_analysis');
  // des analyses déjà consommées ne bloquent pas la simulation
  const r = await run({ DERMAI_MAX_SIMULATIONS_PER_PERIOD: '1' }, async () => { SB.usage.set(USER, Array(50).fill(SB.state.now())); return call('POST'); });
  assert.equal(r.status, 200);
  assert.equal((await run({ DERMAI_MAX_SIMULATIONS_PER_PERIOD: '0' }, () => call('POST'))).status, 429, 'limite 0 = aucune');
});

test('SIM-S12 requêtes simultanées : une seule passe le quota, un seul appel fournisseur', async () => {
  const rs = await run({ DERMAI_MAX_SIMULATIONS_PER_PERIOD: '1' }, () => Promise.all([call('POST'), call('POST'), call('POST')]));
  assert.deepEqual(rs.map(r => r.status).sort(), [200, 429, 429]);
  assert.equal(providerCalls().filter(x => x.url === BASE + config.SIM_PATHS.task).length, 1);
});

test('SIM-S13 quota indisponible (fonction absente, base en erreur) : ÉCHEC FERMÉ, aucun appel fournisseur', async () => {
  let r = await run({}, async () => { SB.state.simQuotaMissing = true; return call('POST'); });
  assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.SIM_QUOTA_UNAVAILABLE); assert.equal(rec.calls.length, 0);
  r = await run({}, async () => { SB.state.failQuota = true; return call('POST'); });
  assert.equal(r.status, 503); assert.equal(rec.calls.length, 0); assert.ok(!/trace|XX000/.test(r.raw));
  SB.state.failQuota = false;
});

test('SIM-S14 erreurs du fournisseur : messages de simulation, sans détail, état de la tâche respecté', async () => {
  let r = await run({}, async () => { mock.fileFail = true; return call('POST'); });
  assert.equal(r.status, 502); assert.equal(r.body.error, errors.MESSAGES.SIM_UNAVAILABLE); assert.ok(!/analys/i.test(r.body.error));
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'exceed_max_filesize', error_message: 'secret detail' } }]; return call('POST'); });
  assert.equal(r.status, 422); assert.equal(r.body.error, errors.MESSAGES.SIM_RESULT_INVALID); assert.ok(!/secret/.test(r.raw));
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'no_face_detected' } }]; return call('POST'); });
  assert.equal(r.status, 422); assert.equal(r.body.error, errors.MESSAGES.NO_FACE, 'visage non détecté : message utile conservé');
  r = await run({}, async () => { mock.noTaskId = true; return call('POST'); });
  assert.equal(r.status, 502); assert.equal(r.body.error, errors.MESSAGES.SIM_RESULT_INVALID);
  r = await run({}, async () => { mock.taskStatus = 400; return call('POST'); });
  assert.ok(r.status >= 400 && !/analys/i.test(r.body.error));
  assert.equal(rec.real, 0);
});

test('SIM-S15 résultat incomplet ou hostile : jamais une URL devinée ou dangereuse', async () => {
  const bad = [
    { data: { task_status: 'success' } },
    { data: { task_status: 'success', results: {} } },
    { data: { task_status: 'success', results: { url: 'http://cdn.example-pc.com/a.png' } } },
    { data: { task_status: 'success', results: { url: 'https://127.0.0.1/a.png' } } },
    { data: { task_status: 'success', results: { url: 'https://localhost/a.png' } } },
    { data: { task_status: 'success', results: { url: 'https://user:pw@cdn.example-pc.com/a.png' } } },
    { data: { task_status: 'success', results: { url: 'https://cdn.example-pc.com:8443/a.png' } } },
    { data: { task_status: 'success', results: { url: 'javascript:alert(1)' } } },
    { data: { task_status: 'success', other: 'https://cdn.example-pc.com/not-a-known-path.png' } }
  ];
  for (const s of bad) {
    const r = await run({}, async () => { mock.status = [s]; return call('POST'); });
    assert.equal(r.status, 502, JSON.stringify(s)); assert.equal(r.body.error, errors.MESSAGES.SIM_RESULT_INVALID);
  }
  // chemins de résultat connus (liste fermée) : tableau results[0].url accepté
  const ok = await run({}, async () => { mock.status = [{ data: { task_status: 'success', results: [{ url: 'https://cdn.example-pc.com/x.jpg' }] } }]; return call('POST'); });
  assert.equal(ok.status, 200); assert.equal(ok.body.simulation.image, 'https://cdn.example-pc.com/x.jpg');
});

test('SIM-S16 délais : polling borné → 504 (message de simulation) ; budget épuisé → 504 sans nouvelle opération ; la tâche n\'est jamais recréée', async () => {
  reset(); polls = 0; mock.status = [{ data: { task_status: 'running' } }];
  let slept = 0;
  await withEnv(open, async () => {
    const [res] = await quiet(() => sim.simulate({ buffer: JPEG, mime: 'image/jpeg', concern: 'acne' }, { sleep: async () => { slept++; }, polling: { intervalMs: 1, maxAttempts: 4, totalTimeoutMs: 100000 } }).then(() => null, e => e));
    assert.equal(res.code, 'TIMEOUT'); assert.equal(res.status, 504);
  });
  assert.equal(slept, 3); assert.equal(providerCalls().filter(c => c.url === BASE + config.SIM_PATHS.task).length, 1);
  assert.equal(errors.toSimulationMessage('TIMEOUT'), errors.MESSAGES.SIM_TIMEOUT); assert.ok(!/analys/i.test(errors.MESSAGES.SIM_TIMEOUT));
  // budget : horloge simulée déjà au bout dès l'envoi du fichier
  reset(); polls = 0; let t = 0;
  const { createBudget } = require('../server/budget');
  const budget = createBudget({ now: () => t });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (u, i) => { const r = await origFetch(u, i); if (String(u).includes('/s2s/v2.0/file') && !String(u).includes('put')) t = 60000; return r; };
  try {
    const [e] = await quiet(() => sim.simulate({ buffer: JPEG, mime: 'image/jpeg', concern: 'acne' }, { budget }).then(() => null, e => e));
    assert.equal(e.code, 'TIME_BUDGET'); assert.equal(e.status, 504);
  } finally { globalThis.fetch = origFetch; }
  assert.ok(!providerCalls().some(c => c.url === BASE + config.SIM_PATHS.task), 'aucune tâche créée sans le temps de la suivre');
  assert.equal(errors.toSimulationMessage('TIME_BUDGET'), errors.MESSAGES.SIM_TIMEOUT);
});

test('SIM-S17 diagnostic : l\'enveloppe brute n\'est renvoyée que sur DERMAI_DEBUG_RAW', async () => {
  let r = await run({}, () => call('POST')); assert.ok(!('raw' in r.body));
  r = await run({ DERMAI_DEBUG_RAW: '1' }, () => call('POST')); assert.ok(r.body.raw && r.body.raw.data);
});

test('SIM-S18 journal : structure seulement — ni jeton, ni clé, ni URL, ni identifiant de tâche', async () => {
  reset(); polls = 0;
  const logs = await withEnv(open, async () => (await quiet(() => call('POST')))[1]);
  const text = logs.join('\n');
  assert.ok(text.length > 0); assert.ok(!text.includes(KEY) && !text.includes(TOKEN) && !/https?:\/\//.test(text) && !/t-sim-1|file-1/.test(text));
});

test('SIM-S18b chemin du résultat inconnu : la STRUCTURE de la réponse est journalisée (jamais une valeur ni une URL), pour ne pas devoir refaire un essai payant', async () => {
  reset(); polls = 0;
  const logs = await withEnv(open, async () => {
    mock.status = [{ data: { task_status: 'success', task_id: 'secret-task', weird_place: { link: 'https://cdn.example-pc.com/secret.png', n: 3 } } }];
    const [r, lines] = await quiet(() => call('POST')); assert.equal(r.status, 502); return lines;
  });
  const text = logs.join('\n');
  assert.match(text, /data\.weird_place\.link: string/); assert.match(text, /data\.task_status: string/);
  assert.ok(!/secret|example-pc|https?:\/\//.test(text), 'aucune valeur dans le journal');
});

test('SIM-S19 configuration : liste blanche exacte, intensité fixe, quota par défaut prudent, aucun contournement', () => {
  assert.deepEqual(Object.keys(config.SIM_CONCERNS).sort(), ['acne', 'dark_circle', 'eye_bags', 'pores', 'radiance', 'redness', 'spots', 'texture', 'wrinkle']);
  assert.deepEqual(Object.keys(config.SIM_CONCERNS).sort(), require('../js/simulation.js').CONCERNS.map(c => c[0]).sort(), 'serveur et navigateur proposent les mêmes zones');
  assert.equal(config.isSimulationEnabled({}), false); assert.equal(config.isSimulationAllowed(USER, {}), false); assert.equal(config.isSimulationAllowed('', { DERMAI_SIMULATION_ALLOWED_USER_IDS: ',' }), false);
  assert.deepEqual(config.simulationQuota({}), { limit: 1, windowSeconds: 24 * 3600 });
  assert.deepEqual(config.simulationQuota({ DERMAI_MAX_SIMULATIONS_PER_PERIOD: 'abc', DERMAI_SIMULATION_PERIOD_HOURS: '-3' }), { limit: 1, windowSeconds: 86400 }, 'valeurs invalides : défaut prudent');
  assert.deepEqual(config.analysisQuota({}), { limit: 3, windowSeconds: 86400 }, 'le quota d\'analyses est inchangé');
  const all = read('server/config.js') + read('api/skin-simulation.js') + read('server/perfectcorp-simulation.js');
  assert.doesNotMatch(all.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /BYPASS|SKIP_QUOTA|DERMAI_SIMULATION_ALL\b|service_role/i);
});

test('SIM-S20 source : ordre des garde-fous, aucune référence à l\'analyse de peau, rien du fournisseur côté navigateur', () => {
  const h = read('api/skin-simulation.js');
  const at = s => { const i = h.indexOf(s); assert.ok(i > 0, s); return i; };
  assert.ok(at('auth.verifyUser') < at('if (!isSimulationEnabled())') && at('if (!isSimulationEnabled())') < at('if (!isSimulationAllowed(user.id))'));
  assert.ok(at('if (!isSimulationAllowed(user.id))') < at('simulation.concernParam(concern)') && at('simulation.concernParam(concern)') < at('await readBody('));
  assert.ok(at('await readBody(') < at('validateImage(body') && at('validateImage(body') < at('quota.reserveSimulation') && at('quota.reserveSimulation') < at('simulation.simulate('));
  const code = (h + read('server/perfectcorp-simulation.js')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /analyzeSkin|createSkinAnalysisTask|pollSkinAnalysisTask|skinTask|PERFECT_CORP_PATHS\.skin|quota\.reserve\(|reserve_analysis/, 'jamais l\'API d\'analyse ni le quota d\'analyses');
  assert.doesNotMatch(read('js/simulation.js') + read('index.html').replace(/<script src="js\/makeup-(data|studio)\.js"><\/script>\n/g, ''), /PERFECT_CORP|makeup|youcam|yce-api|perfectcorp/i, 'rien du fournisseur côté navigateur');
  assert.doesNotMatch(read('js/app.js') + read('js/account.js'), /PERFECT_CORP|makeupar|yce-api|skin-simulation\/|DERMAI_SIMULATION/, 'ni clé, ni hôte, ni réglage serveur côté navigateur');
  assert.doesNotMatch(read('js/simulation.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /skin-analysis|analyzeSkin|postJpeg/, 'le module de simulation ne lance jamais d\'analyse');
});

test('SIM-S21 aucun appel réel pendant tout ce fichier : aucun hôte inconnu, aucune API d\'analyse, aucun compteur « réel »', () => {
  assert.deepEqual(rec.unexpected, []); assert.equal(rec.real, 0);
});
