'use strict';
/* Administration, section « usage » (comptes et utilisation par fonction) : api/admin-stats.js + server/admin-usage.js, TOUT simulé.
   La fonction SQL admin_overview est remplacée par un faux Supabase (test/helpers/fake-supabase.js). Aucun appel réel, aucune clé service_role,
   aucun appel Perfect Corp : globalThis.fetch refuse tout et le compteur d'appels doit rester à zéro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../server/auth');
const usage = require('../server/admin-usage');
const { createBudget } = require('../server/budget');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FOUNDER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const T_FOUNDER = 'aaaaaaaa.bbbbbbbb.cccccccc', T_OTHER = 'dddddddd.eeeeeeee.ffffffff';
const SB = createFake();
auth.api.fetchImpl = SB.fetch; usage.api.fetchImpl = SB.fetch;
SB.users.set('f@exemple.com', { id: FOUNDER, email: 'f@exemple.com', password: 'x', confirmed: true });
SB.users.set('o@exemple.com', { id: OTHER, email: 'o@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(T_FOUNDER, { sub: FOUNDER, exp: Number.MAX_SAFE_INTEGER }); SB.tokens.set(T_OTHER, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });
Object.assign(process.env, { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key-xyz', PERFECT_CORP_API_KEY: 'TEST_ONLY_KEY_NOT_REAL_9f3a', DERMAI_ADMIN_USER_IDS: FOUNDER });
const handler = require('../api/admin-stats.js');

const outside = [];
globalThis.fetch = async (url, init = {}) => { outside.push(((init && init.method) || 'GET') + ' ' + url); throw new Error('appel interdit'); };

function call(method, { token = T_FOUNDER, query = 'section=usage' } = {}) {
  return new Promise(resolve => {
    const req = { method, url: '/api/admin-stats' + (query ? '?' + query : ''), headers: token ? { authorization: 'Bearer ' + token } : {} };
    const sent = {};
    const res = { statusCode: 0, setHeader(k, v) { sent[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: sent, raw: b === undefined ? '' : String(b), json: () => JSON.parse(b) }); } };
    handler(req, res);
  });
}
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; console.log = console.warn = console.error = () => {}; try { return await fn(); } finally { Object.assign(console, o); } };
const run = async (setup, fn) => {
  handler._memo.clear(); outside.length = 0;
  Object.assign(SB.state, { failAuthUser: false, failNetwork: false, rpcCalls: [], adminCalls: [], adminOverviewMode: undefined, adminOverview: undefined, adminDbAllowed: undefined });
  if (setup) setup(SB.state);
  return quiet(fn);
};
const adminCalls = () => SB.state.adminCalls || [];

test('AU1 le fondateur lit les agrégats : appel UNIQUE de la fonction SQL avec SON jeton et la clé publique, forme reconstruite champ par champ, aucun autre appel', async () => {
  const r = await run(null, () => call('GET')); assert.equal(r.status, 200);
  const u = r.json().usage; assert.equal(u.status, 'ok'); assert.equal(u.cached, false); assert.match(u.fetchedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(u.accounts, { total: 42, new_7d: 5, new_30d: 17, signed_in_7d: 20, signed_in_30d: 31, active_7d: 12, active_30d: 25, returned_7d: 7, never_used: 9, inactive_30d: 11 });
  assert.deepEqual(u.functions.map(f => [f.key, f.available]), [['analysis', true], ['simulation', true], ['makeup', false], ['hair', true]]);
  assert.deepEqual(u.functions.find(f => f.key === 'hair'), { key: 'hair', name: 'Studio Beauté : cheveux', available: true, runs_7d: 3, runs_30d: 8, users_30d: 4, units_7d: 5, units_30d: 14 });
  assert.deepEqual(u.functions.find(f => f.key === 'makeup'), { key: 'makeup', name: 'Studio Beauté : maquillage', available: false }, 'table absente : aucun nombre, surtout pas zéro');
  assert.ok(!('units_7d' in u.functions.find(f => f.key === 'analysis')), 'les unités ne concernent que les cheveux');
  assert.deepEqual(u.savedAnalyses, { total: 120, last_30d: 40, users: 30 });
  assert.equal(adminCalls().length, 1); const c = adminCalls()[0];
  assert.equal(c.method, 'POST'); assert.equal(c.auth, 'Bearer ' + T_FOUNDER); assert.equal(c.apikey, 'public-anon-key-xyz'); assert.equal(c.body, '{}');
  assert.deepEqual(SB.state.rpcCalls, ['admin_overview'], 'aucune réservation de quota, aucune autre fonction');
  assert.deepEqual(outside, [], 'aucun appel Perfect Corp ni autre hôte');
  assert.equal(r.headers['cache-control'], 'private, no-store');
});

test('AU2 ACCÈS : compte non listé, jeton absent ou invalide, liste absente → même 404 SANS appel de la fonction SQL ; listé côté serveur mais absent de admin_users → « non autorisé » sans aucun chiffre', async () => {
  const isNotFound = x => x.status === 404 && x.headers['content-type'] === 'text/plain; charset=utf-8' && x.raw === 'Not found';
  for (const [label, token] of [['compte non listé', T_OTHER], ['jeton absent', null], ['jeton invalide', 'aaaaaaaa.bbbbbbbb.invalid0']]) {
    const r = await run(null, () => call('GET', { token })); assert.ok(isNotFound(r), label); assert.equal(adminCalls().length, 0, label + ' : la base n\'est pas interrogée');
  }
  const saved = process.env.DERMAI_ADMIN_USER_IDS; delete process.env.DERMAI_ADMIN_USER_IDS;
  try { const r = await run(null, () => call('GET')); assert.ok(isNotFound(r), 'liste absente'); assert.equal(adminCalls().length, 0); } finally { process.env.DERMAI_ADMIN_USER_IDS = saved; }
  const warm = await run(null, async () => { await call('GET'); return call('GET', { token: T_OTHER }); }); assert.ok(isNotFound(warm), 'mémoire chaude : un compte non listé ne la lit jamais');
  for (const m of ['POST', 'PUT', 'DELETE']) { const r = await run(null, () => call(m)); assert.equal(r.status, 405); assert.equal(adminCalls().length, 0, m + ' : jamais d\'appel'); }
  const denied = await run(s => { s.adminDbAllowed = []; }, () => call('GET')); assert.equal(denied.status, 200);
  const u = denied.json().usage; assert.deepEqual(u, { status: 'unavailable', reason: 'not_authorized', fetchedAt: u.fetchedAt, cached: false });
  assert.ok(!/accounts|functions|total/.test(denied.raw), 'aucun chiffre');
});

test('AU3 la réponse SQL est RECONSTRUITE : champs inconnus, identifiants, e-mails et valeurs invalides ne passent pas ; valeur invalide ou absente = null, jamais zéro', async () => {
  const dirty = { v: 1, generated_at: 'x', user_ids: [FOUNDER, OTHER], email: 'f@exemple.com', secret: 'ACME-9',
    accounts: { total: 42.5, new_7d: -1, new_30d: '17', signed_in_7d: null, active_7d: 12, active_30d: 1e400, extra: FOUNDER, returned_7d: 7, never_used: 9 },
    functions: { analysis: { available: true, runs_7d: 1, runs_30d: 'x', users_30d: 2, email: 'f@exemple.com' }, simulation: { available: 'oui' }, hair: { available: true, runs_7d: 1, runs_30d: 2, users_30d: 1, units_7d: 4 }, autre: { available: true, runs_7d: 9 } },
    saved_analyses: { total: 3, users: 2, last_30d: false, ids: [FOUNDER] } };
  const r = await run(s => { s.adminOverview = dirty; }, () => call('GET')); const u = r.json().usage;
  assert.deepEqual(u.accounts, { total: null, new_7d: null, new_30d: null, signed_in_7d: null, signed_in_30d: null, active_7d: 12, active_30d: null, returned_7d: 7, never_used: 9, inactive_30d: null });
  assert.deepEqual(u.functions.find(f => f.key === 'analysis'), { key: 'analysis', name: 'Analyse de la peau', available: true, runs_7d: 1, runs_30d: null, users_30d: 2 });
  assert.equal(u.functions.find(f => f.key === 'simulation').available, false, 'available doit être exactement true');
  assert.equal(u.functions.find(f => f.key === 'makeup').available, false, 'fonction absente de la réponse : non disponible');
  assert.deepEqual(u.functions.find(f => f.key === 'hair'), { key: 'hair', name: 'Studio Beauté : cheveux', available: true, runs_7d: 1, runs_30d: 2, users_30d: 1, units_7d: 4, units_30d: null });
  assert.ok(!u.functions.some(f => f.key === 'autre'), 'une fonction inconnue n\'est pas relayée');
  assert.deepEqual(u.savedAnalyses, { total: 3, last_30d: null, users: 2 });
  for (const secret of [FOUNDER, OTHER, 'f@exemple.com', 'ACME-9', 'user_ids', 'secret', 'extra']) assert.ok(!r.raw.includes(secret), 'ne contient pas ' + secret);
  for (const bad of [{ v: 2, accounts: {}, functions: {} }, { accounts: {}, functions: {} }, { v: 1, functions: {} }, { v: 1, accounts: {} }, { v: 1, accounts: 'x', functions: {} }, [], 'x']) {
    const x = await run(s => { s.adminOverview = bad; }, () => call('GET')); assert.deepEqual([x.status, x.json().usage.status, x.json().usage.reason], [200, 'unavailable', 'malformed'], JSON.stringify(bad));
    assert.ok(!('accounts' in x.json().usage));
  }
});

test('AU4 PANNES : fonction absente → « non appliquée », rejet de la base → « non autorisé », 500 → erreur fournisseur sans détail, réponse illisible → forme inconnue, délai → timeout ; jamais de zéro', async () => {
  const seen = async (setup, call2 = () => call('GET')) => { const r = await run(setup, call2); assert.equal(r.status, 200); const u = r.json().usage; assert.equal(u.status, 'unavailable'); assert.ok(!('accounts' in u) && !('functions' in u)); assert.ok(!/ACME|trace|PGRST/.test(r.raw), 'aucun détail de la base'); return u.reason; };
  assert.equal(await seen(s => { s.adminOverviewMode = 'missing'; }), 'not_applied');
  assert.equal(await seen(s => { s.adminDbAllowed = []; }), 'not_authorized');
  assert.equal(await seen(s => { s.adminOverviewMode = 'fail'; }), 'provider_error');
  assert.equal(await seen(s => { s.adminOverviewMode = 'garbage'; }), 'malformed');
  const expired = 'gggggggg.hhhhhhhh.iiiiiiii'; SB.tokens.set(expired, { sub: FOUNDER, exp: 0 });
  const old = await run(null, () => call('GET', { token: expired })); assert.deepEqual([old.status, old.raw], [404, 'Not found'], 'jeton expiré : refusé comme tout refus, aucun chiffre'); assert.equal(adminCalls().length, 0);
  const hang = await run(s => { s.adminOverviewMode = 'hang'; }, () => usage.getOverview(T_FOUNDER, process.env, { budget: createBudget({ totalMs: 80, minStepMs: 10 }) }).then(() => null, e => e));
  assert.ok(hang && hang.code === 'TIME_BUDGET', 'délai : TIME_BUDGET'); assert.equal(handler._reasonOf(hang), 'timeout');
  const noCfg = await usage.getOverview('', process.env).then(() => null, e => e); assert.ok(noCfg && /jeton absent/.test(noCfg.detail), 'jeton absent : aucune requête');
});

test('AU5 MÉMOIRE : 60 s côté serveur après le contrôle d\'accès, échecs 15 s ; un échec n\'est jamais rejoué avant son délai et n\'efface pas un succès', async () => {
  handler._memo.clear(); outside.length = 0; Object.assign(SB.state, { adminCalls: [], adminOverviewMode: undefined, adminOverview: undefined, adminDbAllowed: undefined });
  const a = await quiet(() => call('GET')), b = await quiet(() => call('GET'));
  assert.equal(a.json().usage.cached, false); assert.equal(b.json().usage.cached, true); assert.equal(adminCalls().length, 1, 'une seule lecture de la base pour deux affichages');
  const entry = handler._memo.get('usage'); entry.at -= 61 * 1000;
  const c = await quiet(() => call('GET')); assert.equal(c.json().usage.cached, false); assert.equal(adminCalls().length, 2, 'au-delà de 60 s : relu');
  handler._memo.clear(); SB.state.adminOverviewMode = 'missing';
  const d = await quiet(() => call('GET')), e = await quiet(() => call('GET')); assert.equal(d.json().usage.reason, 'not_applied'); assert.equal(e.json().usage.cached, true); assert.equal(adminCalls().length, 3, 'échec mémorisé 15 s');
  handler._memo.get('usage').at -= 16 * 1000; SB.state.adminOverviewMode = undefined;
  const f = await quiet(() => call('GET')); assert.equal(f.json().usage.status, 'ok', 'après 15 s : relu, et le succès est rendu');
});

test('AU6 aucune fuite : ni jeton, ni clé publique, ni clé Perfect Corp, ni identifiant, ni e-mail, ni adresse du projet dans la section « usage », réponse OU échec', async () => {
  for (const setup of [null, s => { s.adminOverviewMode = 'fail'; }, s => { s.adminOverviewMode = 'missing'; }, s => { s.adminDbAllowed = []; }]) {
    const r = await run(setup, () => call('GET'));
    for (const secret of [FOUNDER, OTHER, T_FOUNDER, T_OTHER, 'public-anon-key-xyz', 'TEST_ONLY_KEY_NOT_REAL_9f3a', 'f@exemple.com', 'o@exemple.com', 'demo.supabase.co', 'ACME-9', 'DERMAI_ADMIN_USER_IDS', 'admin_users']) assert.ok(!r.raw.includes(secret), 'ne contient pas ' + secret);
  }
});

test('AU7 LECTURE SEULE (code) : une seule fonction SQL appelée, aucune clé service_role, aucun SQL écrit côté serveur, aucune écriture', () => {
  const src = read('server/admin-usage.js'), code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...new Set(code.match(/\/rest\/v1\/[a-z_/]+/g))], ['/rest/v1/rpc/admin_overview']);
  assert.ok(!/service_role|SERVICE_ROLE|\b(insert|update|delete|drop|alter)\b\s+(into|from|table|set)/i.test(code), 'ni service_role ni SQL');
  assert.equal((code.match(/method:/g) || []).length, 1); assert.match(code, /method: 'POST'/, 'POST est la seule forme d\'appel d\'une fonction PostgREST ; elle ne fait que lire');
  assert.ok(!/process\.env\.[A-Z_]*(SERVICE|SECRET)/.test(code));
  const sql = read('supabase/proposals/20261014120000_admin_overview.sql'); assert.ok(/stable security definer/.test(sql), 'fonction déclarée stable (lecture)');
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(f => /admin/.test(f)), 'aucune migration d\'administration : la proposition reste une proposition');
});
