'use strict';
/* Administration, section « accounts » (adresses e-mail et présence « en ligne ») : api/admin-stats.js + server/admin-accounts.js, TOUT simulé.
   La fonction SQL admin_accounts est remplacée par un faux Supabase (test/helpers/fake-supabase.js). Aucun appel réel, aucune clé service_role, aucun appel Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('../server/auth');
const accounts = require('../server/admin-accounts');
const usage = require('../server/admin-usage');
const { createBudget } = require('../server/budget');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FOUNDER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const T_FOUNDER = 'aaaaaaaa.bbbbbbbb.cccccccc', T_OTHER = 'dddddddd.eeeeeeee.ffffffff';
const SB = createFake();
auth.api.fetchImpl = SB.fetch; accounts.api.fetchImpl = SB.fetch; usage.api.fetchImpl = SB.fetch;
SB.users.set('f@exemple.com', { id: FOUNDER, email: 'f@exemple.com', password: 'x', confirmed: true });
SB.users.set('o@exemple.com', { id: OTHER, email: 'o@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(T_FOUNDER, { sub: FOUNDER, exp: Number.MAX_SAFE_INTEGER }); SB.tokens.set(T_OTHER, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });
Object.assign(process.env, { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key-xyz', PERFECT_CORP_API_KEY: 'TEST_ONLY_KEY_NOT_REAL_9f3a', DERMAI_ADMIN_USER_IDS: FOUNDER });
const handler = require('../api/admin-stats.js');

const outside = [];
globalThis.fetch = async (url, init = {}) => { outside.push(((init && init.method) || 'GET') + ' ' + url); throw new Error('appel interdit'); };

function call(method, { token = T_FOUNDER, query = 'section=accounts' } = {}) {
  return new Promise(resolve => {
    const req = { method, url: '/api/admin-stats' + (query ? '?' + query : ''), headers: token ? { authorization: 'Bearer ' + token } : {} };
    const sent = {};
    const res = { statusCode: 0, setHeader(k, v) { sent[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: sent, raw: b === undefined ? '' : String(b), json: () => JSON.parse(b) }); } };
    handler(req, res);
  });
}
let logs = [];
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; logs = []; console.log = console.warn = console.error = (...a) => logs.push(a.join(' ')); try { return await fn(); } finally { Object.assign(console, o); } };
const run = async (setup, fn) => {
  handler._memo.clear(); outside.length = 0;
  Object.assign(SB.state, { failAuthUser: false, failNetwork: false, rpcCalls: [], adminCalls: [], adminAccountsMode: undefined, adminAccounts: undefined, adminDbAllowed: undefined });
  if (setup) setup(SB.state);
  return quiet(fn);
};
const adminCalls = () => SB.state.adminCalls || [];
const SAMPLE = { v: 1, generated_at: '2026-10-12T10:00:00Z', total: 3, truncated: false, accounts: [
  { email: 'en-ligne@exemple.com', created_at: '2026-10-01T08:00:00Z', last_sign_in_at: '2026-10-12T09:59:00Z', last_seen_at: '2026-10-12T09:59:50Z', online: true },
  { email: 'parti@exemple.com', created_at: '2026-09-20T08:00:00Z', last_sign_in_at: '2026-10-10T09:00:00Z', last_seen_at: '2026-10-10T09:05:00Z', online: false },
  { email: 'jamais@exemple.com', created_at: '2026-10-11T08:00:00Z', last_sign_in_at: null, last_seen_at: null, online: false }] };

test('AC1 le fondateur lit la liste : appel UNIQUE de admin_accounts avec SON jeton et la clé publique, forme reconstruite, aucun autre appel, jamais mis en cache par un intermédiaire', async () => {
  const r = await run(s => { s.adminAccounts = SAMPLE; }, () => call('GET')); assert.equal(r.status, 200);
  const a = r.json().accounts; assert.equal(a.status, 'ok'); assert.equal(a.cached, false); assert.match(a.fetchedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(a.accounts, [
    { email: 'en-ligne@exemple.com', createdAt: '2026-10-01T08:00:00.000Z', lastSignInAt: '2026-10-12T09:59:00.000Z', lastSeenAt: '2026-10-12T09:59:50.000Z', online: true },
    { email: 'parti@exemple.com', createdAt: '2026-09-20T08:00:00.000Z', lastSignInAt: '2026-10-10T09:00:00.000Z', lastSeenAt: '2026-10-10T09:05:00.000Z', online: false },
    { email: 'jamais@exemple.com', createdAt: '2026-10-11T08:00:00.000Z', lastSignInAt: null, lastSeenAt: null, online: false }]);
  assert.equal(a.total, 3); assert.equal(a.truncated, false);
  assert.equal(adminCalls().length, 1); const c = adminCalls()[0];
  assert.deepEqual([c.method, c.auth, c.apikey, c.body, c.fn], ['POST', 'Bearer ' + T_FOUNDER, 'public-anon-key-xyz', '{}', 'admin_accounts']);
  assert.deepEqual(SB.state.rpcCalls, ['admin_accounts']); assert.deepEqual(outside, []);
  assert.equal(r.headers['cache-control'], 'private, no-store'); assert.equal(r.headers.vary, 'Authorization'); assert.equal(r.headers['x-robots-tag'], 'noindex');
});

test('AC2 ACCÈS : compte non listé, jeton absent, invalide ou expiré, liste absente → même 404 SANS appel de la base ; listé côté serveur mais absent de admin_users → « non autorisé » sans aucune adresse', async () => {
  const isNotFound = x => x.status === 404 && x.headers['content-type'] === 'text/plain; charset=utf-8' && x.raw === 'Not found';
  const expired = 'gggggggg.hhhhhhhh.iiiiiiii'; SB.tokens.set(expired, { sub: FOUNDER, exp: 0 });
  for (const [label, token] of [['compte non listé', T_OTHER], ['jeton absent', null], ['jeton invalide', 'aaaaaaaa.bbbbbbbb.invalid0'], ['jeton expiré', expired]]) {
    const r = await run(null, () => call('GET', { token })); assert.ok(isNotFound(r), label); assert.equal(adminCalls().length, 0, label + ' : la base n\'est pas interrogée'); assert.ok(!r.raw.includes('@'), label);
  }
  const saved = process.env.DERMAI_ADMIN_USER_IDS; delete process.env.DERMAI_ADMIN_USER_IDS;
  try { const r = await run(null, () => call('GET')); assert.ok(isNotFound(r), 'liste absente'); assert.equal(adminCalls().length, 0); } finally { process.env.DERMAI_ADMIN_USER_IDS = saved; }
  const warm = await run(s => { s.adminAccounts = SAMPLE; }, async () => { await call('GET'); return call('GET', { token: T_OTHER }); }); assert.ok(isNotFound(warm), 'mémoire chaude : un compte non listé ne la lit jamais'); assert.ok(!warm.raw.includes('exemple.com'));
  for (const m of ['POST', 'PUT', 'DELETE']) { const r = await run(null, () => call(m)); assert.equal(r.status, 405); assert.equal(adminCalls().length, 0, m); }
  const denied = await run(s => { s.adminDbAllowed = []; }, () => call('GET')); assert.equal(denied.status, 200);
  const u = denied.json().accounts; assert.deepEqual(u, { status: 'unavailable', reason: 'not_authorized', fetchedAt: u.fetchedAt, cached: false }); assert.ok(!denied.raw.includes('@'));
});

test('AC3 la réponse SQL est RECONSTRUITE : adresse invalide ou absente → null, dates normalisées, « online » exactement true, identifiants et champs inconnus jamais relayés, au plus 500 comptes', async () => {
  const dirty = { v: 1, generated_at: 'pas une date', total: '3', truncated: 'oui', secret: 'ACME-9', accounts: [
    { email: 'ok@exemple.com', created_at: '2026-10-01', last_sign_in_at: 'x', last_seen_at: 12345, online: 'true', id: FOUNDER, user_id: OTHER, phone: '+33600000000' },
    { email: '<img src=x onerror=alert(1)>', created_at: '2026-10-01T08:00:00Z', online: true },
    { email: 'a b@exemple.com', online: 1 }, { email: '', online: true }, { email: 'x'.repeat(300) + '@exemple.com' }, { email: null }, null, 'x', 7, { email: 'dernier@exemple.com', online: true }] };
  const r = await run(s => { s.adminAccounts = dirty; }, () => call('GET')); const a = r.json().accounts;
  assert.deepEqual(a.accounts.map(x => x.email), ['ok@exemple.com', null, null, null, null, null, 'dernier@exemple.com']);
  assert.deepEqual(a.accounts[0], { email: 'ok@exemple.com', createdAt: '2026-10-01T00:00:00.000Z', lastSignInAt: null, lastSeenAt: null, online: false }, '« true » en chaîne n\'est pas true');
  assert.equal(a.accounts[1].online, true, 'une adresse piégée devient null mais le compte reste compté'); assert.equal(a.accounts[2].online, false, '1 n\'est pas true');
  assert.deepEqual([a.total, a.truncated, a.generatedAt], [null, false, null], 'total en chaîne, truncated autre que true, date invalide : null / false / null');
  for (const secret of [FOUNDER, OTHER, '+33600000000', 'ACME-9', 'user_id', 'secret', '<img', 'onerror']) assert.ok(!r.raw.includes(secret), 'ne contient pas ' + secret);
  const big = { v: 1, total: 900, truncated: true, accounts: Array.from({ length: 900 }, (_, i) => ({ email: `u${i}@exemple.com`, online: false })) };
  const b = (await run(s => { s.adminAccounts = big; }, () => call('GET'))).json().accounts; assert.equal(b.accounts.length, 500); assert.equal(b.total, 900); assert.equal(b.truncated, true);
  for (const bad of [{ v: 2, accounts: [] }, { accounts: [] }, { v: 1 }, { v: 1, accounts: 'x' }, [], 'x']) {
    const x = await run(s => { s.adminAccounts = bad; }, () => call('GET')); assert.deepEqual([x.status, x.json().accounts.status, x.json().accounts.reason], [200, 'unavailable', 'malformed'], JSON.stringify(bad)); assert.ok(!x.raw.includes('@'));
  }
});

test('AC4 PANNES : fonction absente → « non appliquée », rejet de la base → « non autorisé », 500 → erreur fournisseur sans détail, réponse illisible → forme inconnue, délai → timeout ; jamais de liste vide à la place d\'une panne', async () => {
  const seen = async setup => { const r = await run(setup, () => call('GET')); assert.equal(r.status, 200); const u = r.json().accounts; assert.equal(u.status, 'unavailable'); assert.ok(!('accounts' in u) && !('total' in u)); assert.ok(!/ACME|trace|PGRST|@/.test(r.raw)); return u.reason; };
  assert.equal(await seen(s => { s.adminAccountsMode = 'missing'; }), 'not_applied');
  assert.equal(await seen(s => { s.adminDbAllowed = []; }), 'not_authorized');
  assert.equal(await seen(s => { s.adminAccountsMode = 'fail'; }), 'provider_error');
  assert.equal(await seen(s => { s.adminAccountsMode = 'garbage'; }), 'malformed');
  const hang = await run(s => { s.adminAccountsMode = 'hang'; }, () => accounts.getAccounts(T_FOUNDER, process.env, { budget: createBudget({ totalMs: 80, minStepMs: 10 }) }).then(() => null, e => e));
  assert.ok(hang && hang.code === 'TIME_BUDGET'); assert.equal(handler._reasonOf(hang), 'timeout');
  const noCfg = await accounts.getAccounts('', process.env).then(() => null, e => e); assert.ok(noCfg && /jeton absent/.test(noCfg.detail));
});

test('AC5 « temps réel » : mémoire de 5 s seulement (le sondage de la page voit les changements), échecs 15 s, et après le contrôle d\'accès', async () => {
  handler._memo.clear(); outside.length = 0; Object.assign(SB.state, { adminCalls: [], adminAccountsMode: undefined, adminAccounts: SAMPLE, adminDbAllowed: undefined });
  const a = await quiet(() => call('GET')), b = await quiet(() => call('GET'));
  assert.equal(a.json().accounts.cached, false); assert.equal(b.json().accounts.cached, true); assert.equal(adminCalls().length, 1, 'deux affichages rapprochés : une seule lecture');
  handler._memo.get('accounts').at -= 6 * 1000;
  const c = await quiet(() => call('GET')); assert.equal(c.json().accounts.cached, false); assert.equal(adminCalls().length, 2, 'au-delà de 5 s : relu (pas 60 s)');
  SB.state.adminAccounts = Object.assign({}, SAMPLE, { accounts: SAMPLE.accounts.slice(1) }); handler._memo.get('accounts').at -= 6 * 1000;
  const d = await quiet(() => call('GET')); assert.equal(d.json().accounts.accounts.length, 2, 'un compte parti n\'est plus « en ligne » au sondage suivant');
  handler._memo.clear(); SB.state.adminAccountsMode = 'missing';
  const e = await quiet(() => call('GET')), f = await quiet(() => call('GET')); assert.equal(e.json().accounts.reason, 'not_applied'); assert.equal(f.json().accounts.cached, true);
});

test('AC6 DONNÉES PERSONNELLES : les adresses ne sortent que dans la réponse du fondateur ; jamais dans les journaux serveur, ni dans une réponse d\'échec ; ni jeton, clé publique, clé Perfect Corp, adresse du projet, identifiant', async () => {
  const ok = await run(s => { s.adminAccounts = SAMPLE; }, () => call('GET')); const okLogs = logs.join('\n');
  assert.ok(ok.raw.includes('en-ligne@exemple.com')); assert.ok(!/@exemple\.com/.test(okLogs), 'aucune adresse dans les journaux (succès)');
  for (const setup of [s => { s.adminAccountsMode = 'fail'; }, s => { s.adminAccountsMode = 'missing'; }, s => { s.adminDbAllowed = []; }, s => { s.adminAccountsMode = 'garbage'; }, s => { s.adminAccounts = Object.assign({ secret: 'x' }, SAMPLE, { v: 9 }); }]) {
    const r = await run(setup, () => call('GET')); const l = logs.join('\n');
    for (const secret of [FOUNDER, OTHER, T_FOUNDER, T_OTHER, 'public-anon-key-xyz', 'TEST_ONLY_KEY_NOT_REAL_9f3a', 'f@exemple.com', 'o@exemple.com', 'exemple.com', 'demo.supabase.co', 'ACME-8', 'DERMAI_ADMIN_USER_IDS', 'admin_users']) { assert.ok(!r.raw.includes(secret), 'réponse : pas ' + secret); assert.ok(!l.includes(secret), 'journaux : pas ' + secret); }
  }
  const refused = await run(s => { s.adminAccounts = SAMPLE; }, () => call('GET', { token: T_OTHER })); assert.ok(!/@|exemple/.test(refused.raw + logs.join('\n')));
});

test('AC7 LECTURE SEULE (code) : une seule fonction SQL appelée, aucune clé service_role, aucun SQL écrit côté serveur ; la proposition n\'est pas une migration', () => {
  const code = read('server/admin-accounts.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.deepEqual([...new Set(code.match(/\/rest\/v1\/[a-z_/]+/g))], ['/rest/v1/rpc/admin_accounts']);
  assert.ok(!/service_role|SERVICE_ROLE|\b(insert|update|delete|drop|alter)\b\s+(into|from|table|set)/i.test(code)); assert.equal((code.match(/method:/g) || []).length, 1);
  assert.ok(!/console\.(log|warn|error)/.test(code), 'ce module ne journalise rien');
  assert.ok(!fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(f => /admin|presence/.test(f)));
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase/proposals/20261015120000_admin_accounts_presence.sql')) && fs.existsSync(path.join(ROOT, 'supabase/proposals/20261015120000_admin_accounts_presence.rollback.sql')));
});
