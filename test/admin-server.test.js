'use strict';
/* Page d'administration du fondateur : API (api/admin-stats.js, server/admin.js, server/perfectcorp-billing.js), TOUT simulé.
   Aucun appel réel à Perfect Corp : globalThis.fetch est remplacé par un faux fournisseur qui n'accepte QUE deux lectures (solde, coûts) et REFUSE tout le reste (toute écriture, toute tâche, tout autre hôte).
   Le compteur d'appels « interdits » doit rester à zéro : aucune unité n'est consommée par ce fichier. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../server/auth');
const config = require('../server/config');
const billing = require('../server/perfectcorp-billing');
const A = require('../server/admin');
const { createBudget } = require('../server/budget');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'TEST_ONLY_KEY_NOT_REAL_9f3a';
const FOUNDER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222', THIRD = '33333333-3333-4333-8333-333333333333';
const T_FOUNDER = 'aaaaaaaa.bbbbbbbb.cccccccc', T_OTHER = 'dddddddd.eeeeeeee.ffffffff';
const SB = createFake();
auth.api.fetchImpl = SB.fetch;
SB.users.set('f@exemple.com', { id: FOUNDER, email: 'f@exemple.com', password: 'x', confirmed: true });
SB.users.set('o@exemple.com', { id: OTHER, email: 'o@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(T_FOUNDER, { sub: FOUNDER, exp: Number.MAX_SAFE_INTEGER }); SB.tokens.set(T_OTHER, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });
Object.assign(process.env, { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key-xyz', PERFECT_CORP_API_KEY: KEY });
const handler = require('../api/admin-stats.js');

/* ───── Faux Perfect Corp : deux lectures seulement ───── */
const BASE = config.PERFECT_CORP_BASE_URL;
const rec = { calls: [], forbidden: [] };
const mock = {};
const reset = () => { rec.calls = []; rec.forbidden = []; Object.assign(mock, {
  balance: { status: 200, body: { results: [{ type: 'Api Purchased', amount: 120, expires: 'x' }, { type: 'Api Gift', amount: 30 }, { type: 'Web Trial', amount: 5 }] } },
  pages: [{ result: { skus: [{ description: 'Skin analysis SD', amount: 4, unit: 'unit', proc_unit: 'task', run_task_url: BASE + '/s2s/v2.1/task/skin-analysis' }, { description: 'Makeup', amount: 1, unit: 'unit', proc_unit: 'task', run_task_url: BASE + '/s2s/v2.0/task/makeup-vto' }], next_token: 'P2' } },
    { result: { skus: [{ description: 'Hair style', amount: 2, unit: 'unit', proc_unit: 'task', run_task_url: BASE + '/s2s/v2.1/task/hair-transfer' }, { description: 'Autre outil', amount: 3, unit: 'unit', proc_unit: 'task', run_task_url: BASE + '/s2s/v2.0/task/face-attr-analysis' }, { description: 'Sans montant', unit: 'unit', run_task_url: BASE + '/s2s/v2.0/task/hair-color' }], next_token: null } }], costStatus: 200, hang: false }); };
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init && init.method) || 'GET';
  rec.calls.push({ url: u, method, auth: init.headers && init.headers.Authorization, body: init.body });
  if (method !== 'GET' || !u.startsWith(BASE)) { rec.forbidden.push(method + ' ' + u); throw new Error('appel interdit'); }
  const rel = u.slice(BASE.length), p = rel.split('?')[0];
  if (mock.hang) return new Promise((res, rej) => { init.signal && init.signal.addEventListener('abort', () => rej(new Error('aborted'))); });
  if (p === '/s2s/v1.0/client/credit') return new Response(JSON.stringify(mock.balance.body), { status: mock.balance.status, headers: { 'Content-Type': 'application/json' } });
  if (p === '/s2s/v2.0/credit/feature-cost') {
    if (mock.costStatus !== 200) return new Response('{"error":"boom ACME-1234"}', { status: mock.costStatus });
    const tok = new URL(u).searchParams.get('starting_token'), i = tok ? Number(tok.replace('P', '')) - 1 : 0;
    return new Response(JSON.stringify(mock.pages[Math.min(i, mock.pages.length - 1)]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  rec.forbidden.push(method + ' ' + u); throw new Error('chemin interdit : ' + u);
};

function call(method, { token = T_FOUNDER, query = 'section=features' } = {}) {
  return new Promise(resolve => {
    const req = { method, url: '/api/admin-stats' + (query ? '?' + query : ''), headers: token ? { authorization: 'Bearer ' + token } : {} };
    const sent = {};
    const res = { statusCode: 0, setHeader(k, v) { sent[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: sent, raw: b === undefined ? '' : String(b), json: () => JSON.parse(b) }); } };
    handler(req, res);
  });
}
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
let logs = [];
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { Object.assign(console, o); } };
const ADMIN_ENV = { DERMAI_ADMIN_USER_IDS: FOUNDER };
const run = async (env, fn) => { reset(); handler._memo.clear(); SB.state.failAuthUser = false; SB.state.failNetwork = false; SB.state.rpcCalls = []; return withEnv(Object.assign({}, ADMIN_ENV, env), async () => { const [r, l] = await quiet(fn); logs = l; return r; }); };
const NOT_FOUND = { status: 404, ct: 'text/plain; charset=utf-8', body: 'Not found' };
const isNotFound = r => r.status === 404 && r.headers['content-type'] === NOT_FOUND.ct && r.raw === NOT_FOUND.body;

test('AD-S1 TOUT refus renvoie la MÊME réponse 404 sans contenu : jeton absent, mal formé, invalide, Supabase en panne, compte non listé, liste absente, vide, mal formée, « * », pour toute méthode et toute section', async () => {
  const cases = [
    ['jeton absent', {}, { token: null }], ['jeton mal formé', {}, { token: 'zzz' }], ['jeton invalide', {}, { token: 'aaaaaaaa.bbbbbbbb.invalid0' }],
    ['compte valide non listé', {}, { token: T_OTHER }], ['liste absente', { DERMAI_ADMIN_USER_IDS: undefined }, {}], ['liste vide', { DERMAI_ADMIN_USER_IDS: ' , ' }, {}],
    ['« * » seul', { DERMAI_ADMIN_USER_IDS: '*' }, {}], ['« * » avec l\'identifiant', { DERMAI_ADMIN_USER_IDS: FOUNDER + ',*' }, {}], ['entrée invalide dans la liste', { DERMAI_ADMIN_USER_IDS: FOUNDER + ',pas-un-uuid' }, {}],
    ['autre compte listé seulement', { DERMAI_ADMIN_USER_IDS: OTHER }, {}]
  ];
  for (const [label, env, opt] of cases) for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) for (const query of ['section=features', 'section=credit', 'section=access', '', 'section=zzz']) {
    const r = await run(env, () => call(method, Object.assign({ query }, opt)));
    assert.ok(isNotFound(r), `${label} ${method} ${query} → ${r.status} ${r.raw.slice(0, 40)}`);
    assert.equal(rec.calls.length, 0, 'aucun appel fournisseur pour un refus');
  }
  const down = await run({}, async () => { SB.state.failAuthUser = true; return call('GET'); }); assert.ok(isNotFound(down), 'Supabase injoignable : même réponse');
  const net = await run({}, async () => { SB.state.failNetwork = true; return call('GET'); }); assert.ok(isNotFound(net));
  assert.ok(!/admin|founder|fondateur/i.test(NOT_FOUND.body), 'le corps du refus ne dit rien');
  const h = (await run({ DERMAI_ADMIN_USER_IDS: undefined }, () => call('GET'))).headers; assert.equal(h['cache-control'], 'private, no-store'); assert.equal(h.vary, 'Authorization'); assert.equal(h['x-robots-tag'], 'noindex');
  assert.ok(!('www-authenticate' in h) && !('allow' in h), 'aucun en-tête qui révèle la route');
});

test('AD-S2 fondateur autorisé : sections en lecture, méthodes autres que GET refusées (405 réservé au fondateur), section inconnue ou répétée → 400 ; identifiants insensibles à la casse', async () => {
  for (const s of ['access', 'features', 'quotas', 'credit', 'costs']) { const r = await run({}, () => call('GET', { query: 'section=' + s })); assert.equal(r.status, 200, s); assert.equal(r.json().ok, true); }
  assert.deepEqual((await run({}, () => call('GET', { query: 'section=access' }))).json(), { ok: true, admin: true });
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) { const r = await run({}, () => call(m)); assert.equal(r.status, 405, m); assert.equal(r.headers.allow, 'GET'); assert.equal(rec.calls.length, 0); assert.ok(!/section|features/.test(r.raw)); }
  for (const q of ['', 'section=', 'section=zzz', 'section=features&section=quotas', 'x=features', 'section=FEATURES', 'section=__proto__']) { const r = await run({}, () => call('GET', { query: q })); assert.equal(r.status, 400, q); assert.equal(rec.calls.length, 0); }
  const upper = await run({ DERMAI_ADMIN_USER_IDS: FOUNDER.toUpperCase() }, () => call('GET')); assert.equal(upper.status, 200, 'UUID : casse sans importance');
  const several = await run({ DERMAI_ADMIN_USER_IDS: `${THIRD}, ${FOUNDER}` }, () => call('GET')); assert.equal(several.status, 200, 'plusieurs fondateurs');
  for (const r of [await run({}, () => call('GET')), await run({}, () => call('POST')), await run({}, () => call('GET', { query: 'section=zzz' }))]) { assert.equal(r.headers['cache-control'], 'private, no-store'); assert.equal(r.headers.vary, 'Authorization'); }
  assert.equal(config.isAdminAllowed(FOUNDER, { DERMAI_ADMIN_USER_IDS: FOUNDER }), true); assert.equal(config.isAdminAllowed('', { DERMAI_ADMIN_USER_IDS: FOUNDER }), false); assert.equal(config.isAdminAllowed(null, { DERMAI_ADMIN_USER_IDS: FOUNDER }), false);
  assert.equal(config.adminAllowList({}).reason, 'empty'); assert.equal(config.adminAllowList({ DERMAI_ADMIN_USER_IDS: '*' }).reason, 'malformed');
});

test('AD-S3 aucune fuite : ni identifiant autorisé (fondateur ou autres listes), ni clé, ni jeton, ni clé anon, ni valeur brute de variable, dans AUCUNE section', async () => {
  const env = { DERMAI_ADMIN_USER_IDS: FOUNDER + ',' + THIRD, DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: `${OTHER},${THIRD}`, DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: `${OTHER},${THIRD},${FOUNDER}`, DERMAI_SIMULATION_ENABLED: '1', DERMAI_SIMULATION_ALLOWED_USER_IDS: '*' };
  for (const s of ['access', 'features', 'quotas', 'credit', 'costs']) {
    const r = await run(env, () => call('GET', { query: 'section=' + s }));
    for (const secret of [FOUNDER, OTHER, THIRD, KEY, T_FOUNDER, T_OTHER, 'public-anon-key-xyz', 'f@exemple.com', 'o@exemple.com', 'ACME-1234', 'demo.supabase.co']) assert.ok(!r.raw.toLowerCase().includes(secret.toLowerCase()), `${s} ne contient pas ${secret.slice(0, 8)}…`);
    assert.ok(!/DERMAI_ADMIN_USER_IDS/.test(r.raw), 'le nom de la variable d\'accès n\'est pas annoncé');
  }
  const f = (await run(env, () => call('GET', { query: 'section=features' }))).json().features;
  assert.equal(f.find(x => x.id === 'makeup').authorization.count, 2); assert.equal(f.find(x => x.id === 'makeup').authorization.mode, 'list'); assert.equal(f.find(x => x.id === 'simulation').authorization.mode, 'all');
  assert.ok(!logs.join('\n').match(new RegExp([FOUNDER, KEY, T_FOUNDER].join('|'))), 'rien de sensible dans les journaux');
});

test('AD-S4 fonctionnalités : activation, mode d\'autorisation, nombre de comptes, prérequis ; jamais « disponible » (la fonction SQL n\'est pas vérifiable) ; fermetures expliquées', async () => {
  const rows = e => A.featureRows(Object.assign({ PERFECT_CORP_API_KEY: KEY, SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'k' }, e));
  const by = (r, id) => r.find(x => x.id === id);
  let r = rows({}); assert.deepEqual(r.map(x => x.id), ['analysis', 'simulation', 'makeup', 'hair.hairstyle', 'hair.haircolor', 'hair.extensions', 'hair.bangs', 'hair.wavy', 'hair.volume']); assert.ok(r.every(x => x.state === 'closed'), 'tout fermé par défaut');
  r = rows({ DERMAI_ANALYSIS_ENABLED: '1' }); assert.equal(by(r, 'analysis').state, 'configured'); assert.equal(by(r, 'analysis').authorization.label, 'Tous les comptes connectés'); assert.equal(by(r, 'analysis').enabledSource, 'DERMAI_ANALYSIS_ENABLED');
  assert.ok(by(r, 'analysis').prerequisites.find(p => p.id === 'sql').state === 'unverifiable', 'fonction SQL : non vérifiable'); assert.ok(r.every(x => x.state !== 'available'));
  r = rows({ DERMAI_MAKEUP_ENABLED: '1' }); assert.equal(by(r, 'makeup').state, 'blocked', 'activé mais liste vide = personne'); assert.equal(by(r, 'makeup').authorization.mode, 'none'); assert.equal(by(r, 'makeup').authorization.label, 'Personne');
  r = rows({ DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: `${OTHER}, ${THIRD}` }); assert.equal(by(r, 'makeup').state, 'configured'); assert.deepEqual([by(r, 'makeup').authorization.label, by(r, 'makeup').authorization.count], ['Liste restreinte', 2]);
  r = rows({ DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: '*' }); assert.equal(by(r, 'makeup').authorization.label, 'Tous les utilisateurs'); assert.equal(config.isMakeupAllowed(OTHER, { DERMAI_MAKEUP_ALLOWED_USER_IDS: '*' }), true, 'le libellé « Tous » correspond au comportement réel du code');
  r = rows({ DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: '*', PERFECT_CORP_API_KEY: '' }); assert.equal(by(r, 'makeup').state, 'blocked', 'clé manquante'); assert.equal(by(r, 'makeup').prerequisites.find(p => p.id === 'perfectcorp_key').state, 'missing');
  r = rows({ DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: '*', SUPABASE_URL: '' }); assert.equal(by(r, 'makeup').state, 'blocked'); assert.equal(by(r, 'makeup').prerequisites.find(p => p.id === 'supabase').state, 'missing');
  r = rows({ DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: '*' });
  assert.deepEqual(r.filter(x => x.id.startsWith('hair.')).map(x => [x.id, x.state]), [['hair.hairstyle', 'configured'], ['hair.haircolor', 'configured'], ['hair.extensions', 'closed'], ['hair.bangs', 'closed'], ['hair.wavy', 'closed'], ['hair.volume', 'closed']]);
  assert.match(by(r, 'hair.extensions').closedReason, /non confirmé/); assert.equal(by(r, 'hair.hairstyle').units, 2); assert.equal(by(r, 'hair.haircolor').units, 1);
  r = rows({ DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: '*', DERMAI_HAIR_ALLOW_UNCONFIRMED: '1', DERMAI_HAIR_FEATURES: 'haircolor,wavy' });
  assert.deepEqual(r.filter(x => x.id.startsWith('hair.') && x.state !== 'closed').map(x => x.id), ['hair.haircolor', 'hair.wavy']); assert.match(by(r, 'hair.hairstyle').closedReason, /DERMAI_HAIR_FEATURES/);
  r = rows({ DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: '*', DERMAI_HAIR_PATH_BANGS: '/s2s/v2.0/task/custom-bangs' }); assert.equal(by(r, 'hair.bangs').state, 'configured', 'chemin corrigé et valide : ouverte'); assert.equal(by(r, 'hair.bangs').pathConfirmed, true);
  for (const e of [{ DERMAI_HAIR_ENABLED: '1' }, {}]) assert.ok(rows(e).filter(x => x.id.startsWith('hair.')).every(x => x.state !== 'configured'));
});

test('AD-S5 quotas configurés : limite, unité, fenêtre, source (variable / défaut / invalide) ; hors consommation réelle ; cheveux en unités', () => {
  const q = (e, id) => A.quotaRows(e).find(x => x.id === id);
  let r = A.quotaRows({}); assert.deepEqual(r.map(x => [x.id, x.limit, x.unit, x.windowHours]), [['analysis', 3, 'analyses', 24], ['simulation', 1, 'simulations', 24], ['makeup', 3, 'essayages', 24], ['hair', 6, 'unités', 24]]);
  assert.ok(r.every(x => x.limitSource === 'valeur par défaut du code' && x.windowSource === 'valeur par défaut du code'), 'variables absentes : défaut annoncé comme tel, pas comme valeur Vercel');
  assert.match(q({}, 'hair').note, /unités Perfect Corp documentées/); assert.match(q({}, 'hair').note, /Coiffures et perruques 2/); assert.match(q({}, 'hair').note, /Volume 2/);
  const e = { DERMAI_MAX_ANALYSES_PER_PERIOD: '10', DERMAI_ANALYSIS_PERIOD_HOURS: '12', DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '20', DERMAI_HAIR_PERIOD_HOURS: '48' };
  assert.deepEqual([q(e, 'analysis').limit, q(e, 'analysis').windowHours, q(e, 'analysis').limitSource], [10, 12, 'variable d\'environnement']); assert.deepEqual([q(e, 'hair').limit, q(e, 'hair').windowHours], [20, 48]);
  for (const bad of ['abc', '-1', '1.5', '5000', '']) { const x = q({ DERMAI_MAX_MAKEUP_PER_PERIOD: bad }, 'makeup'); assert.equal(x.limit, 3, bad); assert.equal(x.limitSource, bad === '' ? 'valeur par défaut du code' : 'variable invalide ignorée : valeur par défaut du code', bad); }
  assert.equal(q({ DERMAI_MAX_MAKEUP_PER_PERIOD: '0' }, 'makeup').limit, 0, '0 = aucune opération, valeur valide');
  for (const x of r) { assert.ok(!('used' in x) && !('consumed' in x) && !('remaining' in x), 'limite configurée, jamais consommation'); assert.ok(x.limitVariable && x.windowVariable && x.defaults); }
  /* cohérence avec la règle réellement appliquée côté serveur */
  for (const [v, id, fn] of [['7', 'analysis', config.analysisQuota], ['zz', 'simulation', config.simulationQuota], ['9', 'makeup', config.makeupQuota], ['4', 'hair', config.hairQuota]]) {
    const name = { analysis: 'DERMAI_MAX_ANALYSES_PER_PERIOD', simulation: 'DERMAI_MAX_SIMULATIONS_PER_PERIOD', makeup: 'DERMAI_MAX_MAKEUP_PER_PERIOD', hair: 'DERMAI_MAX_HAIR_UNITS_PER_PERIOD' }[id];
    assert.equal(q({ [name]: v }, id).limit, fn({ [name]: v }).limit, id);
  }
});

test('AD-S6 solde Perfect Corp : lecture GET authentifiée côté serveur, catégories telles que retournées, total « Api » annoncé avec sa source, jamais zéro pour masquer un échec', async () => {
  const r = await run({}, () => call('GET', { query: 'section=credit' })); assert.equal(r.status, 200);
  const c = r.json().credit; assert.equal(c.status, 'ok'); assert.equal(c.cached, false); assert.match(c.fetchedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(c.categories, [{ type: 'Api Purchased', amount: 120, spendable: true }, { type: 'Api Gift', amount: 30, spendable: true }, { type: 'Web Trial', amount: 5, spendable: false }]);
  assert.equal(c.spendable, 150, 'Api seulement : « Web Trial » n\'est PAS additionné'); assert.ok(!('expires' in c.categories[0]), 'champs inconnus non relayés');
  assert.deepEqual(rec.calls.map(x => x.method + ' ' + x.url.replace(BASE, '')), ['GET /s2s/v1.0/client/credit']); assert.equal(rec.calls[0].auth, 'Bearer ' + KEY); assert.deepEqual(rec.forbidden, []);
  /* même type répété : sommé comme le code officiel ; montants invalides ignorés */
  let x = await run({}, async () => { mock.balance.body = { results: [{ type: 'Api A', amount: 10 }, { type: 'Api A', amount: 5 }, { type: 'Api B', amount: '7' }, { type: '', amount: 3 }, null, 'x', { type: 'Api C', amount: NaN }] }; return call('GET', { query: 'section=credit' }); });
  assert.deepEqual(x.json().credit.categories, [{ type: 'Api A', amount: 15, spendable: true }]); assert.equal(x.json().credit.spendable, 15);
  x = await run({}, async () => { mock.balance.body = { results: [] }; return call('GET', { query: 'section=credit' }); }); const e = x.json().credit;
  assert.equal(e.status, 'ok'); assert.deepEqual(e.categories, []); assert.equal(e.spendable, null, 'aucun lot « Api » : total indisponible (null), pas 0');
  x = await run({}, async () => { mock.balance.body = { results: [{ type: 'Web Trial', amount: 5 }] }; return call('GET', { query: 'section=credit' }); }); assert.equal(x.json().credit.spendable, null);
  /* échecs : « indisponible » avec une cause courte, sans champ de montant */
  for (const [label, setup, reason] of [['réponse sans liste', () => { mock.balance.body = { data: 1 }; }, 'malformed'], ['results non liste', () => { mock.balance.body = { results: 'x' }; }, 'malformed'], ['corps vide', () => { mock.balance.body = null; }, 'malformed'],
    ['HTTP 500', () => { mock.balance.status = 500; mock.balance.body = { error: 'boom ACME-1234' }; }, 'provider_error'], ['HTTP 401', () => { mock.balance.status = 401; mock.balance.body = { error: 'bad key' }; }, 'provider_error']]) {
    x = await run({}, async () => { setup(); return call('GET', { query: 'section=credit' }); }); const u = x.json().credit;
    assert.equal(x.status, 200, label); assert.equal(u.status, 'unavailable', label); assert.equal(u.reason, reason, label); assert.ok(!('spendable' in u) && !('categories' in u), label + ' : aucun montant inventé'); assert.ok(!/ACME|bad key|boom/.test(x.raw), label + ' : détail du fournisseur non relayé');
  }
  const none = await withEnv({ PERFECT_CORP_API_KEY: undefined }, () => run({ PERFECT_CORP_API_KEY: undefined }, () => call('GET', { query: 'section=credit' }))); assert.equal(none.json().credit.reason, 'key_missing'); assert.equal(rec.calls.length, 0, 'sans clé : aucun appel');
});

test('AD-S7 délais et réseau : budget épuisé, réponse qui ne vient pas, réseau coupé → « indisponible » avec cause ; jamais de zéro', async () => {
  const env = { budget: createBudget({ totalMs: 80, minStepMs: 10 }), fetch: () => new Promise((res, rej) => setTimeout(() => rej(new Error('x')), 5000)) };
  const hang = await billing.getBalance(env).then(() => null, e => e); assert.ok(hang && hang.code === 'TIME_BUDGET', 'délai : TIME_BUDGET');
  const net = await billing.getBalance({ budget: createBudget(), fetch: async () => { throw new TypeError('network'); } }).then(() => null, e => e); assert.ok(net && /réseau/.test(net.detail));
  const { _reasonOf } = handler; assert.equal(_reasonOf(hang), 'timeout'); assert.equal(_reasonOf(net), 'network'); assert.equal(_reasonOf(new Error('x')), 'unavailable');
});

test('AD-S8 coûts officiels : pagination complète, rapprochement EXACT par identifiant technique, non rapprochés séparés, montant absent = indisponible, aucun coût unique par catégorie', async () => {
  const r = await run({}, () => call('GET', { query: 'section=costs' })); assert.equal(r.status, 200);
  const c = r.json().costs; assert.equal(c.status, 'ok'); assert.equal(c.total, 5); assert.equal(c.pages, 2); assert.equal(c.truncated, false);
  assert.deepEqual(rec.calls.map(x => x.url.replace(BASE, '')), ['/s2s/v2.0/credit/feature-cost?page_size=20', '/s2s/v2.0/credit/feature-cost?page_size=20&starting_token=P2']); assert.ok(rec.calls.every(x => x.method === 'GET' && x.auth === 'Bearer ' + KEY)); assert.deepEqual(rec.forbidden, []);
  const g = Object.fromEntries(c.groups.map(x => [x.category, x.items]));
  assert.deepEqual(Object.keys(g), ['Analyse cutanée', 'Simulation', 'Maquillage', 'Coiffure et couleur de cheveux']);
  assert.deepEqual(g['Analyse cutanée'].map(x => [x.description, x.amount, x.unit, x.procUnit, x.slug]), [['Skin analysis SD', 4, 'unit', 'task', 'skin-analysis']]); assert.deepEqual(g['Maquillage'].map(x => x.amount), [1]); assert.deepEqual(g['Simulation'], [], 'aucun SKU : rien d\'inventé');
  assert.deepEqual(g['Coiffure et couleur de cheveux'].map(x => [x.slug, x.amount]), [['hair-transfer', 2], ['hair-color', null]], 'plusieurs SKU conservés, montant absent = null (jamais 0)');
  assert.deepEqual(c.unmatched.map(x => x.slug), ['face-attr-analysis'], 'non rapproché : listé à part, jamais attribué à une catégorie'); assert.ok(c.expected.find(x => x.category === 'Simulation').slugs.includes('skin-simulation'));
  assert.ok(c.groups.every(x => !('cost' in x) && !('amount' in x) && !('average' in x)), 'aucun coût unique par catégorie');
  assert.ok(!r.raw.includes(BASE) && !/run_task_url|https:\/\//.test(r.raw), 'ni l\'URL ni l\'hôte du fournisseur');
  /* cas limites */
  const odd = await run({}, async () => { mock.pages = [{ result: { skus: [{ description: '<b>x</b>', amount: '5', unit: 7, run_task_url: 'https://x.example/s2s/v2.0/task/../../etc' }, { description: 'ok', amount: 2, unit: 'unit', run_task_url: 'sans-chemin' }, null, 3], next_token: null } }]; return call('GET', { query: 'section=costs' }); });
  const o = odd.json().costs; assert.equal(o.total, 2); assert.equal(o.unmatched[0].amount, null, 'montant en chaîne : indisponible'); assert.equal(o.unmatched[0].unit, null); assert.ok(!/<b>/.test(odd.raw)); assert.deepEqual(o.unmatched.map(x => x.slug), [null, null]);
  const empty = await run({}, async () => { mock.pages = [{ result: { skus: [], next_token: null } }]; return call('GET', { query: 'section=costs' }); }); assert.equal(empty.json().costs.status, 'ok'); assert.equal(empty.json().costs.total, 0);
  for (const [label, pages, reason] of [['sans result', [{ data: 1 }], 'malformed'], ['skus non liste', [{ result: { skus: 'x' } }], 'malformed'], ['corps vide', [null], 'malformed']]) {
    const u = (await run({}, async () => { mock.pages = pages; return call('GET', { query: 'section=costs' }); })).json().costs; assert.equal(u.status, 'unavailable', label); assert.equal(u.reason, reason, label); assert.ok(!('groups' in u) && !('total' in u), label);
  }
  const http = (await run({}, async () => { mock.costStatus = 503; return call('GET', { query: 'section=costs' }); })); assert.equal(http.json().costs.reason, 'provider_error'); assert.ok(!/ACME|boom/.test(http.raw));
  const endless = await run({}, async () => { mock.pages = [{ result: { skus: [{ description: 'a', amount: 1, unit: 'unit', run_task_url: BASE + '/s2s/v2.0/task/makeup-vto' }], next_token: 'P1' } }]; return call('GET', { query: 'section=costs' }); });
  assert.equal(endless.json().costs.truncated, true, 'pagination sans fin : plafonnée et signalée'); assert.equal(rec.calls.length, 10);
});

test('AD-S9 mémoire de lecture : une seule lecture fournisseur par fenêtre (solde 60 s, coûts 10 min), indiquée « cached » ; erreurs mémorisées brièvement ; le contrôle d\'accès précède toujours la mémoire', async () => {
  const two = await run({}, async () => [await call('GET', { query: 'section=credit' }), await call('GET', { query: 'section=credit' })]);
  assert.equal(two[0].json().credit.cached, false); assert.equal(two[1].json().credit.cached, true); assert.equal(two[0].json().credit.fetchedAt, two[1].json().credit.fetchedAt, 'même relevé, même date'); assert.equal(rec.calls.length, 1);
  reset(); const stranger = await withEnv(ADMIN_ENV, async () => (await quiet(() => call('GET', { query: 'section=credit', token: T_OTHER })))[0]); assert.ok(isNotFound(stranger), 'la mémoire d\'un fondateur n\'est jamais servie à un autre compte'); assert.equal(rec.calls.length, 0);
  const err = await run({}, async () => { mock.balance.status = 500; const a = await call('GET', { query: 'section=credit' }); mock.balance.status = 200; const b = await call('GET', { query: 'section=credit' }); return [a, b]; });
  assert.equal(err[0].json().credit.status, 'unavailable'); assert.equal(err[1].json().credit.status, 'unavailable', 'erreur mémorisée 15 s : pas de rafale vers le fournisseur'); assert.equal(rec.calls.length, 1);
});

test('AD-S10 AUCUN appel payant ni écriture : seulement deux GET de lecture ; ni tâche, ni POST, ni RPC de quota, ni appel Supabase autre que la vérification de session ; configuration et quotas sans réseau', async () => {
  for (const s of ['access', 'features', 'quotas', 'credit', 'costs']) await run({}, () => call('GET', { query: 'section=' + s }));
  assert.deepEqual(rec.forbidden, []);
  const r = await run({}, async () => { for (const s of ['access', 'features', 'quotas', 'credit', 'costs']) await call('GET', { query: 'section=' + s }); });
  assert.ok(rec.calls.every(c => c.method === 'GET' && /\/s2s\/v1\.0\/client\/credit$|\/s2s\/v2\.0\/credit\/feature-cost/.test(c.url.split('?')[0])), JSON.stringify(rec.calls.map(c => c.method + c.url.replace(BASE, ''))));
  assert.ok(!rec.calls.some(c => /\/task\//.test(c.url) || /\/file/.test(c.url)), 'aucune tâche, aucun envoi de fichier'); assert.deepEqual(SB.state.rpcCalls || [], [], 'aucune réservation de quota');
  const cfg = await run({}, async () => { await call('GET', { query: 'section=features' }); await call('GET', { query: 'section=quotas' }); return rec.calls.length; }); assert.equal(cfg, 0, 'fonctionnalités et quotas : aucun appel externe');
  assert.equal(r, undefined);
});

test('AD-S11 source : lecture seule, aucune clé de service, aucune écriture ; seules les variables et fichiers prévus ; variable documentée vide ; fonction à durée bornée', () => {
  const code = ['api/admin-stats.js', 'server/admin.js', 'server/perfectcorp-billing.js'].map(f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).join('\n');
  assert.ok(!/service_role|serviceKey|SERVICE_ROLE|method:\s*['"](POST|PUT|PATCH|DELETE)|\.rpc\(|quota\.reserve|reserveVia|\/rest\/v1|auth\.users|storage\.objects|createSkinAnalysisTask|requestUploadUrl|uploadFile/.test(code), 'aucune écriture, aucun quota, aucune donnée de compte');
  assert.ok(!/console\.(log|warn|error)\([^)]*(user\.id|token|PERFECT_CORP_API_KEY|req\.headers)/.test(code), 'journaux sans identifiant ni secret');
  assert.deepEqual(code.match(/process\.env\.[A-Z_]+/g) || [], [], 'aucune lecture directe de variable : tout passe par config.js et les helpers existants');
  const v = JSON.parse(read('vercel.json')); assert.equal(v.functions['api/admin-stats.js'].maxDuration, 30);
  const envs = read('.env.example'); assert.match(envs, /DERMAI_ADMIN_USER_IDS=\s*(#.*)?$/m, 'documentée et VIDE'); assert.ok(!new RegExp(FOUNDER + '|' + OTHER).test(envs));
  for (const f of ['js/app.js', 'js/admin-dashboard.js', 'index.html']) assert.ok(!/PERFECT_CORP_API_KEY|yce-api|makeupar|s2s\/v\d/i.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), f + ' : ni clé ni hôte du fournisseur');
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /admin/i.test(f)), [], 'aucune migration'); assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/proposals')).filter(f => /admin/i.test(f)).sort(), ['20261014120000_admin_overview.rollback.sql', '20261014120000_admin_overview.sql', '20261015120000_admin_accounts_presence.rollback.sql', '20261015120000_admin_accounts_presence.sql'], 'propositions SQL d\'administration : la lecture agrégée (chiffres), puis les comptes et la présence, chacune avec son retour arrière, jamais appliquées par ce dépôt');
});
