'use strict';
/* Course entre le renouvellement des jetons et un changement de session (déconnexion, autre compte).
   Réseau simulé avec des promesses contrôlables : une requête de renouvellement peut être « retenue » le temps qu'un autre événement se produise,
   puis relâchée, ce qui reproduit exactement l'ordre des événements. Aucun appel externe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Account = require('../js/account.js');
const Flow = require('../js/analysis-flow.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const METRICS = Account.METRIC_KEYS;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sample = n => ({ id: uuid(n), analyzedAt: new Date(1_800_000_000_000).toISOString(), globalScore: 70, skinType: 'dry', skinAge: 30, metrics: Object.fromEntries(METRICS.map(k => [k, 60])), priorities: [], goals: [], engineVersion: '1.0.0' });
const tick = () => new Promise(r => setImmediate(r));
const SB = 'https://demo.supabase.co';
const isPost = e => e.method === 'POST' && e.path === '/rest/v1/skin_analyses';

function harness({ ttl = 100 } = {}) {
  const fake = createFake({ ttl }), storage = memoryStorage(), log = [], gates = [], net = { refresh: null, respond: null };
  const f = async (url, init = {}) => {
    const u = new URL(url), headers = init.headers || {};
    const entry = { method: init.method || 'GET', path: u.pathname, grant: u.searchParams.get('grant_type'), auth: headers.Authorization || null };
    log.push(entry);
    const gate = gates.find(g => !g.used && g.match(entry));
    if (gate) { gate.used = true; gate.arrive(); await gate.wait; }           // la requête est retenue jusqu'à release()
    if (entry.grant === 'refresh_token' && net.respond) return net.respond();
    if (entry.grant === 'refresh_token' && net.refresh) {
      if (net.refresh === 'network') throw new TypeError('network');
      return { ok: false, status: net.refresh, text: async () => '{"message":"x"}' };
    }
    return fake.fetch(url, init);
  };
  const acc = Account.create({ url: SB, anonKey: 'k', fetch: f, storage, now: fake.state.now });
  const gate = match => {
    let arrive, release; const arrived = new Promise(r => { arrive = r; }), wait = new Promise(r => { release = r; });
    gates.push({ match, arrive, wait, used: false });
    return { arrived, release };
  };
  const subOf = auth => { const t = fake.tokens.get(String(auth || '').replace('Bearer ', '')); return t ? t.sub : null; };
  const stored = () => storage.getItem(Account.SESSION_KEY);
  const rows = () => [...fake.analyses.values()].flat().length;
  const refreshGate = () => gate(e => e.grant === 'refresh_token');
  return { fake, storage, log, acc, net, gate, refreshGate, subOf, stored, rows };
}
const signUpB = h => h.fake.fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'k' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });

test('S1 déconnexion pendant un renouvellement : aucune session n\'est rétablie, ni en mémoire ni dans le stockage, aucune requête ensuite', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  h.fake.state.advance(500);                                       // le jeton d'accès de A est expiré côté serveur
  const g = h.refreshGate();
  const save = h.acc.saveAnalysis(sample(1), a.id);
  await g.arrived;                                                 // la requête de renouvellement est partie, sa réponse n'est pas revenue
  await h.acc.signOut();                                           // A se déconnecte volontairement
  const before = h.log.length;
  g.release();
  const r = await save;
  await tick();
  assert.deepEqual(r, { ok: false, error: Account.MSG.analysisSaveFailed, foreign: true }, 'ni « expirée » (pas de faux message), ni réessayable sous une autre session');
  assert.equal(h.acc.user, null, 'aucune session en mémoire');
  assert.equal(h.stored(), null, 'aucune session dans le stockage');
  assert.equal(h.log.slice(before).length, 0, 'aucune requête après la réponse tardive');
  assert.equal(await h.acc.accessToken(), null);
  assert.equal(h.rows(), 0);
  const again = await h.acc.restoreSession();
  assert.equal(again, null, 'et un rechargement ne retrouve rien');
});

test('S2 connexion de B pendant le renouvellement de A : B reste connecté, aucune requête ultérieure n\'utilise la session de A', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  await signUpB(h);
  h.fake.state.advance(500);
  const g = h.refreshGate();
  const save = h.acc.saveAnalysis(sample(1), a.id);
  await g.arrived;
  const b = await h.acc.signIn('b@exemple.com', 'motdepasse1');    // B se connecte (remplace la session de A)
  assert.equal(b.ok, true);
  const bToken = JSON.parse(h.stored()).access_token;
  const before = h.log.length;
  g.release();
  const r = await save;
  await tick();
  assert.equal(r.foreign, true); assert.equal(r.ok, false);
  assert.equal(h.acc.user.email, 'b@exemple.com', 'B reste connecté');
  const s = JSON.parse(h.stored());
  assert.equal(s.user.email, 'b@exemple.com'); assert.equal(s.access_token, bToken, 'le stockage n\'a pas été écrasé');
  assert.equal(h.fake.refresh.get(s.refresh_token), b.user.id, 'le jeton de renouvellement stocké est celui de B');
  assert.equal(h.log.slice(before).length, 0, 'aucune requête de A après la connexion de B');
  assert.equal((await h.acc.loadProfile()).ok, true);              // une requête ultérieure part avec la session de B
  const after = h.log.slice(before).filter(e => e.auth);
  assert.ok(after.length >= 1 && after.every(e => h.subOf(e.auth) === b.user.id), 'toutes avec le jeton de B');
  assert.equal(h.rows(), 0, 'la ligne de A n\'est enregistrée sous aucun compte');
});

test('S3 renouvellement indisponible (réseau, délai, 408, 429, 5xx) : erreur réessayable, la session valide est conservée, la reprise aboutit ensuite', async () => {
  for (const mode of ['network', 408, 429, 500, 502, 503, 504]) {
    const h = harness();
    const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
    h.fake.state.advance(500);
    h.net.refresh = mode;
    const r = await h.acc.saveAnalysis(sample(1), a.id);
    assert.deepEqual(r, { ok: false, error: Account.MSG.analysisSaveFailed, retryable: true }, String(mode));
    assert.notEqual(r.error, Account.MSG.sessionExpired);
    assert.equal(h.acc.user.id, a.id, 'pas de déconnexion injustifiée');
    assert.ok(h.stored(), 'session toujours dans le stockage');
    h.net.refresh = null;                                          // le réseau revient
    assert.deepEqual(await h.acc.saveAnalysis(sample(1), a.id), { ok: true });
    assert.equal(h.rows(), 1, String(mode));
    assert.equal((await h.acc.saveAnalysis(sample(1), a.id)).ok, true); assert.equal(h.rows(), 1, 'même identifiant : pas de doublon');
  }
});

test('S4 renouvellement réellement refusé (400, 401, 403) : session fermée, « session expirée » (seul cas)', async () => {
  for (const mode of [400, 401, 403]) {
    const h = harness();
    const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
    h.fake.state.advance(500);
    h.net.refresh = mode;
    const r = await h.acc.saveAnalysis(sample(1), a.id);
    assert.deepEqual(r, { ok: false, error: Account.MSG.sessionExpired, expired: true }, String(mode));
    assert.equal(h.acc.user, null); assert.equal(h.stored(), null);
  }
});

test('S5 reprise de sauvegarde en cours puis déconnexion : rien n\'est envoyé après la déconnexion, ni sous une session devenue invalide', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  const store = new Map(), saved = [];
  const flow = Flow.create({
    storage: () => ({ getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }),
    userId: () => (h.acc.user ? h.acc.user.id : null), save: (r, owner) => h.acc.saveAnalysis(r, owner), confirm: () => true, toast() {},
    onSaved: id => saved.push(id), now: () => Date.now()
  });
  const rec = Object.assign(sample(1), { analyzedAt: new Date().toISOString() });
  h.fake.state.failAnalyses = true;                                // l'enregistrement échoue d'abord (sans nouvel essai automatique : pas de minuteur injecté)
  flow.add(rec, { recordable: true, signedIn: true });
  await tick(); await tick();
  assert.equal(flow.pending(), 1); assert.equal(h.rows(), 0);
  h.fake.state.failAnalyses = false;
  h.fake.state.advance(500);                                       // jeton expiré : la prochaine tentative passe par un renouvellement
  const g = h.refreshGate();
  flow.resume(true);                                               // reprise « Réessayer » : POST (401) puis renouvellement retenu
  await g.arrived;
  const posts = h.log.filter(isPost).length;
  assert.equal(flow.leave(), true);                                // l'utilisateur se déconnecte et confirme
  await h.acc.signOut();
  const before = h.log.length;
  g.release();
  await tick(); await tick(); await tick();
  assert.equal(h.log.filter(isPost).length, posts, 'aucun nouvel envoi après la déconnexion');
  assert.equal(h.log.slice(before).length, 0, 'aucune requête du tout');
  assert.equal(h.rows(), 0); assert.deepEqual(saved, []);
  assert.equal(h.acc.user, null); assert.equal(h.stored(), null);
  assert.equal(store.has(Flow.PENDING_KEY), false); assert.equal(flow.pending(), 0);
});

test('S6 deux requêtes en même temps avec un jeton expiré : un seul renouvellement partagé (le jeton de renouvellement ne sert qu\'une fois)', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  h.fake.state.advance(500);
  const g = h.refreshGate();
  const p1 = h.acc.saveAnalysis(sample(1), a.id), p2 = h.acc.saveAnalysis(sample(2), a.id);
  await g.arrived; await tick();
  g.release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(h.log.filter(e => e.grant === 'refresh_token').length, 1);
  assert.equal(r1.ok, true); assert.equal(r2.ok, true); assert.equal(h.rows(), 2);
  assert.ok(h.acc.user, 'session conservée');
});

test('S7 le jeton d\'accès demandé par A n\'est jamais celui de B (analyse lancée, B se connecte pendant le renouvellement)', async () => {
  const h = harness();
  await h.acc.signUp('a@exemple.com', 'motdepasse1');
  await signUpB(h);
  h.fake.state.advance(50);                                        // dans la marge de renouvellement (60 s), jeton encore valable
  const g = h.refreshGate();
  const tokenP = h.acc.accessToken();
  await g.arrived;
  await h.acc.signIn('b@exemple.com', 'motdepasse1');
  g.release();
  assert.equal(await tokenP, null, 'pas de jeton : la requête partirait sinon sous le compte de B');
  assert.equal(h.acc.user.email, 'b@exemple.com');
  assert.ok(await h.acc.accessToken(), 'B obtient le sien');
});

test('S8 déconnexion pendant le renouvellement lancé au démarrage : aucune session retrouvée', async () => {
  const h = harness();
  await h.acc.signUp('a@exemple.com', 'motdepasse1');
  const saved = h.stored();
  h.fake.state.advance(500);
  const h2 = (() => { const st = memoryStorage(); st.setItem(Account.SESSION_KEY, saved); return st; })();
  const log = []; let release; const wait = new Promise(r => { release = r; });
  const f = async (url, init = {}) => { log.push(url); if (/refresh_token/.test(url)) await wait; return h.fake.fetch(url, init); };
  const acc = Account.create({ url: SB, anonKey: 'k', fetch: f, storage: h2, now: h.fake.state.now });
  const restoring = acc.restoreSession();
  await tick();
  await acc.signOut();
  release();
  assert.equal(await restoring, null);
  assert.equal(acc.user, null); assert.equal(h2.getItem(Account.SESSION_KEY), null);
});

test('S9 contrôle du propriétaire conservé : une analyse de A ne part jamais sous la session de B', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  await h.acc.signOut(); await signUpB(h);
  const b = (await h.acc.signIn('b@exemple.com', 'motdepasse1')).user;
  const n = h.log.length;
  assert.deepEqual(await h.acc.saveAnalysis(sample(1), a.id), { ok: false, error: Account.MSG.analysisSaveFailed, foreign: true });
  assert.equal(h.log.slice(n).length, 0, 'aucune requête');
  assert.equal((await h.acc.saveAnalysis(sample(1), b.id)).ok, true);
  assert.equal(h.rows(), 1); assert.equal((h.fake.analyses.get(a.id) || []).length, 0);
});

test('S10 la session change PENDANT la requête d\'enregistrement elle-même : la réponse 401 ne déclenche ni renouvellement ni nouvel envoi sous la nouvelle session', async () => {
  for (const change of ['logout', 'autre compte']) {
    const h = harness();
    const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
    await signUpB(h);
    h.fake.state.advance(500);                                     // le jeton de A est expiré : le serveur répondra 401
    const g = h.gate(isPost);
    const save = h.acc.saveAnalysis(sample(1), a.id);
    await g.arrived;                                               // la requête de A est partie, sa réponse est retenue
    if (change === 'logout') await h.acc.signOut(); else await h.acc.signIn('b@exemple.com', 'motdepasse1');
    const before = h.log.length, who = h.acc.user && h.acc.user.email;
    g.release();
    const r = await save;
    await tick();
    assert.deepEqual(r, { ok: false, error: Account.MSG.analysisSaveFailed, foreign: true }, change);
    assert.equal(h.log.length, before, 'ni renouvellement, ni nouvel envoi après le changement de session (' + change + ')');
    assert.equal(h.acc.user && h.acc.user.email, who);
    assert.equal(h.rows(), 0);
    if (change === 'logout') assert.equal(h.stored(), null); else assert.equal(JSON.parse(h.stored()).user.email, 'b@exemple.com');
  }
});

test('S11 une réponse de renouvellement qui désigne un autre compte n\'est jamais appliquée : la session est fermée, rien n\'est envoyé', async () => {
  const h = harness();
  const a = (await h.acc.signUp('a@exemple.com', 'motdepasse1')).user;
  await signUpB(h);
  h.fake.state.advance(500);
  h.net.respond = () => h.fake.fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: 'k' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  const r = await h.acc.saveAnalysis(sample(1), a.id);
  assert.deepEqual(r, { ok: false, error: Account.MSG.sessionExpired, expired: true });
  assert.equal(h.acc.user, null); assert.equal(h.stored(), null);
  assert.equal(h.log.filter(isPost).length, 1, 'un seul envoi : celui qui a reçu le 401');
  assert.equal(h.rows(), 0);
});

test('S12 connexion de B pendant le renouvellement lancé au démarrage : la session retrouvée ne remplace pas celle de B', async () => {
  const h = harness();
  await h.acc.signUp('a@exemple.com', 'motdepasse1');
  await signUpB(h);
  const savedA = h.stored();
  h.fake.state.advance(500);
  const st = memoryStorage(); st.setItem(Account.SESSION_KEY, savedA);
  const log = []; const g = { release: null }; const wait = new Promise(r => { g.release = r; }); let arrive; const arrived = new Promise(r => { arrive = r; });
  const f = async (url, init = {}) => { log.push(url); if (/refresh_token/.test(url)) { arrive(); await wait; } return h.fake.fetch(url, init); };
  const acc = Account.create({ url: SB, anonKey: 'k', fetch: f, storage: st, now: h.fake.state.now });
  const restoring = acc.restoreSession();
  await arrived;
  await acc.signIn('b@exemple.com', 'motdepasse1');
  g.release();
  const u = await restoring;
  assert.equal(acc.user.email, 'b@exemple.com');
  assert.equal(JSON.parse(st.getItem(Account.SESSION_KEY)).user.email, 'b@exemple.com');
  assert.equal(u.email, 'b@exemple.com', 'la session retrouvée est celle qui existe maintenant, jamais celle de A');
});
