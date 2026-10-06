'use strict';
/* Compte et profil persistant : client js/account.js contre un faux Supabase (aucun réseau). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const Engine = require('../js/engine/index.js');
const { createFake, memoryStorage, GOALS } = require('./helpers/fake-supabase.js');

const URL = 'https://demo.supabase.co', KEY = 'public-anon-key';
function setup(opts) {
  const fake = createFake(opts), storage = memoryStorage();
  const mk = st => Account.create({ url: URL, anonKey: KEY, fetch: fake.fetch, storage: st || storage, now: fake.state.now });
  return { fake, storage, mk, acc: mk() };
}
const profileOf = (goals, level, gentle, exclusions) => ({ goals, level, comfort: { preferGentle: !!gentle }, exclusions: exclusions || [] });

test('A1 inscription : compte créé, session ouverte, profil créé avec des valeurs neutres (aucun objectif)', async () => {
  const { acc, fake } = setup();
  const r = await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.equal(r.ok, true);
  assert.equal(acc.user.email, 'a@exemple.com');
  const p = await acc.loadProfile();
  assert.deepEqual(p, { ok: true, profile: { goals: [], level: '', comfort: { preferGentle: false }, exclusions: [] } });
  assert.equal(fake.profiles.size, 1);
});

test('A2 lecture, modification et relecture de son propre profil', async () => {
  const { acc } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.deepEqual(await acc.saveProfile(profileOf(['hydration', 'tone'], 'simple', true)), { ok: true });
  assert.deepEqual((await acc.loadProfile()).profile, profileOf(['hydration', 'tone'], 'simple', true));
  await acc.saveProfile(profileOf(['hydration'], 'simple', true));          // objectif retiré : il reste retiré
  assert.deepEqual((await acc.loadProfile()).profile.goals, ['hydration']);
});

test('A3 le navigateur n\'envoie jamais user_id, ni rôle, ni identifiant : la base déduit l\'identité du jeton', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.saveProfile(profileOf(['tone'], 'none', false));
  const writes = fake.log.filter(l => l.path.startsWith('/rest') && l.body);
  assert.ok(writes.length > 0);
  for (const w of writes) assert.deepEqual(Object.keys(w.body).sort(), ['exclusions', 'goals', 'prefer_gentle', 'routine_level'], JSON.stringify(w.body));
  for (const l of fake.log) { assert.doesNotMatch(l.path, /user_id/); assert.ok(!/service_role/i.test(JSON.stringify(l.headers))); assert.equal(l.headers.apikey, KEY); }
});

test('A4 profil absent (ancien compte) : la sauvegarde le crée sans identifiant fourni', async () => {
  const { acc, fake } = setup();
  const r = await acc.signUp('a@exemple.com', 'motdepasse1');
  fake.removeProfile(acc.user.id);
  assert.equal((await acc.loadProfile()).profile, null);
  assert.deepEqual(await acc.saveProfile(profileOf(['aging'], 'full', false)), { ok: true });
  assert.deepEqual((await acc.loadProfile()).profile.goals, ['aging']);
});

test('A5 compte B ne voit jamais le profil de A (déconnexion, changement de compte)', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.saveProfile(profileOf(['hydration', 'tone', 'aging'], 'full', true, ['salicylic']));
  await acc.signOut();
  assert.equal(acc.user, null);
  assert.equal((await acc.loadProfile()).ok, false, 'plus de session : aucune lecture');
  await acc.signUp('b@exemple.com', 'motdepasse2');
  assert.deepEqual((await acc.loadProfile()).profile, profileOf([], '', false, []));
  const a = [...fake.profiles.values()].find(p => p.goals.length === 3);
  assert.ok(a, 'les données de A existent toujours, sous le compte A');
  await acc.signOut();
  await acc.signIn('a@exemple.com', 'motdepasse1');
  assert.deepEqual((await acc.loadProfile()).profile.goals, ['hydration', 'tone', 'aging']);
});

test('A6 deux clients simultanés : chacun ne voit que son profil', async () => {
  const { mk, fake } = setup();
  const a = mk(memoryStorage()), b = mk(memoryStorage());
  await a.signUp('a@exemple.com', 'motdepasse1'); await b.signUp('b@exemple.com', 'motdepasse2');
  await a.saveProfile(profileOf(['tone'], 'simple', false));
  await b.saveProfile(profileOf(['texture'], 'none', true));
  assert.deepEqual((await a.loadProfile()).profile.goals, ['tone']);
  assert.deepEqual((await b.loadProfile()).profile.goals, ['texture']);
  assert.equal(fake.log.filter(l => l.path.startsWith('/rest') && l.method === 'GET').length, 2);
});

test('A7 session : survit à un rechargement, rafraîchie à l\'expiration, supprimée à la déconnexion ; aucun mot de passe stocké', async () => {
  const { mk, storage, fake } = setup();
  const a = mk();
  await a.signIn('x@exemple.com', 'pas-inscrit').catch(() => {});
  await a.signUp('a@exemple.com', 'motdepasse1');
  await a.saveProfile(profileOf(['hydration'], 'simple', true));
  const stored = storage.dump();
  assert.deepEqual(Object.keys(stored), [Account.SESSION_KEY]);
  assert.doesNotMatch(stored[Account.SESSION_KEY], /motdepasse1|goals|hydration|prefer_gentle/);
  const b = mk();                                                  // « rechargement »
  assert.deepEqual(await b.restoreSession(), { id: a.user.id, email: 'a@exemple.com' });
  assert.deepEqual((await b.loadProfile()).profile.goals, ['hydration']);
  fake.state.advance(4000);                                         // jeton expiré
  const c = mk();
  assert.ok(await c.restoreSession());
  assert.deepEqual((await c.loadProfile()).profile.goals, ['hydration']);
  await c.signOut();
  assert.equal(storage.getItem(Account.SESSION_KEY), null);
  assert.equal(await mk().restoreSession(), null);
});

test('A8 jeton expiré en cours d\'usage : un rafraîchissement, puis la requête réussit', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  fake.state.advance(4000);
  assert.deepEqual(await acc.saveProfile(profileOf(['tone'], 'simple', false)), { ok: true });
  assert.ok(fake.log.some(l => l.path.includes('grant_type=refresh_token')));
});

test('A9 erreurs : messages humains, jamais de code, de JSON, de table ni de SQL', async () => {
  const { acc, fake } = setup();
  const bad = [];
  const collect = r => { if (r && r.error) bad.push(r.error); if (r && r.message) bad.push(r.message); };
  collect(await acc.signUp('pas-un-mail', 'motdepasse1'));
  collect(await acc.signUp('a@exemple.com', 'court'));
  await acc.signUp('a@exemple.com', 'motdepasse1'); await acc.signOut();
  collect(await acc.signUp('a@exemple.com', 'motdepasse1'));
  collect(await acc.signIn('a@exemple.com', 'mauvais-mot-de-passe'));
  fake.state.failNetwork = true; collect(await acc.signIn('a@exemple.com', 'motdepasse1')); fake.state.failNetwork = false;
  fake.state.failAuth = true; collect(await acc.signIn('a@exemple.com', 'motdepasse1')); fake.state.failAuth = false;
  await acc.signIn('a@exemple.com', 'motdepasse1');
  fake.state.failRest = true; collect(await acc.saveProfile(profileOf([], '', false))); collect(await acc.loadProfile()); fake.state.failRest = false;
  fake.state.failNetwork = true; collect(await acc.saveProfile(profileOf([], '', false))); fake.state.failNetwork = false;
  assert.ok(bad.length >= 9, String(bad.length));
  for (const m of bad) assert.doesNotMatch(m, /\b[45]\d\d\b|JSON|SQL|profiles|relation|supabase|PGRST|42\d\d\d|jwt|stack|undefined|internal|TypeError/i, m);
  assert.ok(bad.includes(Account.MSG.saveFailed) && bad.includes(Account.MSG.invalidCredentials) && bad.includes(Account.MSG.exists) && bad.includes(Account.MSG.network));
  assert.equal(Account.MSG.saveFailed, 'Vos modifications n\'ont pas pu être enregistrées. Réessayez.');
});

test('A10 confirmation par e-mail : pas de session, message clair ; connexion refusée tant que non confirmé', async () => {
  const { acc } = setup({ confirmEmails: true });
  const r = await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.equal(r.ok, true); assert.equal(r.needsConfirmation, true); assert.equal(acc.user, null);
  assert.match(r.message, /e-mail de confirmation/);
  assert.equal((await acc.signIn('a@exemple.com', 'motdepasse1')).error, Account.MSG.notConfirmed);
});

test('A11 comptes indisponibles (configuration absente ou invalide) : aucune requête, message humain', async () => {
  for (const o of [{}, { url: 'http://insecure.example', anonKey: 'k' }, { url: URL }, { url: URL, anonKey: '' }]) {
    const c = Account.create(Object.assign({ fetch: () => { throw new Error('ne doit pas être appelé'); } }, o));
    assert.equal(c.available, false);
    assert.equal((await c.signIn('a@exemple.com', 'motdepasse1')).ok, false);
    assert.equal(await c.restoreSession(), null);
  }
});

test('A12 simulation 6000 profils : ≤ 3 objectifs, objectifs et niveaux valides, aucune fuite entre utilisateurs simulés', async () => {
  const { mk, fake } = setup();
  let s = 777;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const clients = [];
  for (let i = 0; i < 6; i++) { const c = mk(memoryStorage()); await c.signUp(`u${i}@exemple.com`, 'motdepasse1'); clients.push({ c, expected: null }); }
  const sanitize = raw => { const n = Engine.normalizeProfile(raw); return { goals: n.goals, level: ['none', 'simple', 'full'].includes(raw.level) ? raw.level : '', comfort: n.comfort, exclusions: n.exclusions }; };
  for (let i = 0; i < 6000; i++) {
    const k = clients[Math.floor(rnd() * clients.length)];
    const raw = { goals: Array.from({ length: Math.floor(rnd() * 6) }, () => (rnd() < 0.15 ? 'inconnu' : GOALS[Math.floor(rnd() * GOALS.length)])),
      level: ['none', 'simple', 'full', 'zzz', '', null][Math.floor(rnd() * 6)], comfort: { preferGentle: rnd() < 0.4 }, exclusions: rnd() < 0.2 ? ['salicylic', 'bogus'] : [] };
    const clean = sanitize(raw);
    assert.ok(clean.goals.length <= 3 && clean.goals.every(g => GOALS.includes(g)), 'objectifs');
    assert.ok(['', 'none', 'simple', 'full'].includes(clean.level), 'niveau');
    assert.deepEqual(await k.c.saveProfile(clean), { ok: true });
    k.expected = clean;
    if (i % 50 === 0) for (const o of clients) if (o.expected) assert.deepEqual((await o.c.loadProfile()).profile, o.expected, 'fuite entre utilisateurs');
  }
  for (const o of clients) if (o.expected) assert.deepEqual((await o.c.loadProfile()).profile, o.expected);
  assert.equal(fake.profiles.size, 6);
});

test('A13 aucune photo, masque, task_id ni donnée brute dans le profil ou la session ; aucun secret côté client', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/account.js'), 'utf8');
  const row = Account.toRow({ goals: ['tone'], level: 'simple', comfort: { preferGentle: true }, exclusions: [], photo: 'data:image/jpeg;base64,xx', task_id: 't1', mask_urls: ['u'], normalized: {}, user_id: 'x' });
  assert.deepEqual(Object.keys(row).sort(), ['exclusions', 'goals', 'prefer_gentle', 'routine_level']);
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /service_role|task_id|mask|photo|password\s*:\s*['"`]/i);
});
