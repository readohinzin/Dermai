'use strict';
/* Confirmation d'adresse, mot de passe oublié, changement de mot de passe, suppression de compte : client js/account.js contre un faux Supabase.
   Les mails ne sont jamais envoyés (aucun réseau). Les mots de passe ne vont que vers Supabase Auth et ne sont jamais conservés. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Account = require('../js/account.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const URL = 'https://demo.supabase.co', KEY = 'public-anon-key';
function setup(opts) {
  const fake = createFake(opts), storage = memoryStorage();
  const mk = st => Account.create({ url: URL, anonKey: KEY, fetch: fake.fetch, storage: st || storage, now: fake.state.now });
  return { fake, storage, mk, acc: mk() };
}

test('R1 mot de passe oublié : même réponse que l\'adresse existe ou non, sans session ni mot de passe envoyé', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1'); await acc.signOut();
  const known = await acc.requestPasswordReset('a@exemple.com'), unknown = await acc.requestPasswordReset('inconnu@exemple.com');
  assert.deepEqual(known, unknown);
  assert.equal(known.ok, true); assert.equal(known.message, Account.MSG.recoverySent); assert.doesNotMatch(known.message, /existe pas|introuvable|inconnu/i);
  const calls = fake.log.filter(l => l.path === '/auth/v1/recover');
  assert.equal(calls.length, 2);
  for (const c of calls) { assert.deepEqual(Object.keys(c.body), ['email']); assert.equal(c.headers.apikey, KEY); assert.equal(c.headers.authorization, 'Bearer ' + KEY, 'aucune session utilisée'); }
});

test('R2 mot de passe oublié et renvoi de confirmation : adresse invalide, limite d\'envoi, panne réseau : messages humains', async () => {
  const { acc, fake } = setup();
  for (const fn of ['requestPasswordReset', 'resendConfirmation']) {
    assert.deepEqual(await acc[fn]('pas-une-adresse'), { ok: false, error: Account.MSG.emailInvalid });
    fake.state.rateLimit = true; assert.deepEqual(await acc[fn]('a@exemple.com'), { ok: false, error: Account.MSG.rateLimited }); fake.state.rateLimit = false;
    fake.state.failNetwork = true; assert.deepEqual(await acc[fn]('a@exemple.com'), { ok: false, error: Account.MSG.network }); fake.state.failNetwork = false;
  }
  assert.equal((await acc.resendConfirmation('a@exemple.com')).ok, true);
  assert.deepEqual(fake.log.filter(l => l.path === '/auth/v1/resend').pop().body, { type: 'signup', email: 'a@exemple.com' });
});

test('R3 confirmation d\'adresse : inscription sans session, connexion refusée tant que non confirmé, puis lien de confirmation', async () => {
  const { acc, fake, storage, mk } = setup({ confirmEmails: true });
  const su = await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.deepEqual(su, { ok: true, needsConfirmation: true, message: Account.MSG.needsConfirmation });
  assert.equal(storage.getItem(Account.SESSION_KEY), null, 'aucune session avant confirmation');
  assert.deepEqual(await acc.signIn('a@exemple.com', 'motdepasse1'), { ok: false, error: Account.MSG.notConfirmed });
  assert.equal(acc.user, null);
  // sans session, ni historique, ni analyse, ni jeton
  assert.equal(await acc.accessToken(), null); assert.equal((await acc.saveAnalysis({ metrics: {}, engineVersion: 'v' })).ok, false);
  const parsed = Account.readAuthRedirect(fake.confirmLink('a@exemple.com'));
  assert.equal(parsed.kind, 'session'); assert.equal(parsed.type, 'signup');
  const r = await acc.acceptRedirect(parsed);
  assert.equal(r.ok, true); assert.equal(r.user.email, 'a@exemple.com'); assert.equal(r.type, 'signup');
  assert.deepEqual((await acc.loadProfile()).profile, { goals: [], level: '', comfort: { preferGentle: false }, exclusions: [] });
  assert.equal((await mk(storage).signIn('a@exemple.com', 'motdepasse1')).ok, true, 'connexion normale ensuite');
});

test('R4 lien expiré, falsifié ou déjà utilisé : aucune session, message clair', async () => {
  const { acc, fake, storage } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1'); await acc.signOut();
  assert.deepEqual(Account.readAuthRedirect(fake.recoveryLink('inconnu@exemple.com')), { kind: 'error' });
  assert.deepEqual(await acc.acceptRedirect({ kind: 'error' }), { ok: false, error: Account.MSG.linkInvalid });
  const forged = { kind: 'session', type: 'recovery', access_token: 'aaaaaaaa.bbbbbbbb.cccccccc', refresh_token: 'x', expires_in: 3600 };
  assert.deepEqual(await acc.acceptRedirect(forged), { ok: false, error: Account.MSG.linkInvalid });
  assert.equal(storage.getItem(Account.SESSION_KEY), null); assert.equal(acc.user, null);
  fake.state.failNetwork = true; assert.equal((await acc.acceptRedirect(forged)).ok, false); fake.state.failNetwork = false;
});

test('R5 récupération : lien → session → nouveau mot de passe ; l\'ancien ne fonctionne plus ; jamais de mot de passe conservé', async () => {
  const { acc, fake, storage, mk } = setup();
  await acc.signUp('a@exemple.com', 'ancien-mdp-1'); await acc.signOut();
  const r = await acc.acceptRedirect(Account.readAuthRedirect(fake.recoveryLink('a@exemple.com')));
  assert.equal(r.ok, true); assert.equal(r.type, 'recovery');
  assert.deepEqual(await acc.updatePassword('court'), { ok: false, error: Account.MSG.passwordShort });
  assert.deepEqual(await acc.updatePassword('ancien-mdp-1'), { ok: false, error: Account.MSG.passwordSame });
  assert.deepEqual(await acc.updatePassword('nouveau-mdp-2'), { ok: true, message: Account.MSG.passwordUpdated });
  await acc.signOut();
  assert.equal((await mk(memoryStorage()).signIn('a@exemple.com', 'ancien-mdp-1')).ok, false);
  assert.equal((await mk(memoryStorage()).signIn('a@exemple.com', 'nouveau-mdp-2')).ok, true);
  assert.doesNotMatch(JSON.stringify(storage.dump()), /mdp/, 'aucun mot de passe dans le stockage du navigateur');
  const pw = fake.log.filter(l => l.body && 'password' in l.body).map(l => l.path.split('?')[0]);
  assert.ok(pw.every(p => ['/auth/v1/signup', '/auth/v1/token', '/auth/v1/user'].includes(p)), 'le mot de passe ne va que vers Supabase Auth : ' + pw.join());
  const noSession = mk(memoryStorage()); assert.deepEqual(await noSession.updatePassword('nouveau-mdp-3'), { ok: false, error: Account.MSG.sessionExpired });
});

test('R6 lecture d\'un lien : seuls les retours de Supabase sont reconnus, jamais une route de l\'application', () => {
  assert.equal(Account.readAuthRedirect(''), null); assert.equal(Account.readAuthRedirect('#scan'), null); assert.equal(Account.readAuthRedirect('#profile'), null);
  assert.deepEqual(Account.readAuthRedirect('#access_token=aaaa.bbbb.cccc&refresh_token=r&expires_in=60&type=recovery'), { kind: 'session', type: 'recovery', access_token: 'aaaa.bbbb.cccc', refresh_token: 'r', expires_in: 60 });
  assert.equal(Account.readAuthRedirect('#access_token=aaaa.bbbb.cccc&refresh_token=r&type=signup').type, 'signup');
  assert.equal(Account.readAuthRedirect('#access_token=aaaa.bbbb.cccc&refresh_token=r&type=magiclink').type, 'signup', 'tout type inconnu est traité comme une simple ouverture de session');
  assert.deepEqual(Account.readAuthRedirect('#error=access_denied&error_code=otp_expired'), { kind: 'error' });
  assert.deepEqual(Account.readAuthRedirect('#access_token=sansrefresh'), { kind: 'error' });
});

test('R7 suppression de compte : l\'appelant seulement ; profil, analyses et quota partent ; les autres comptes sont intacts ; le jeton ne sert plus', async () => {
  const { fake, mk } = setup();
  const a = mk(memoryStorage()), b = mk(memoryStorage());
  await a.signUp('a@exemple.com', 'motdepasse1'); await b.signUp('b@exemple.com', 'motdepasse1');
  const uidA = a.user.id, uidB = b.user.id, tokA = await a.accessToken();
  await a.saveAnalysis({ id: '00000000-0000-4000-8000-000000000001', metrics: { acne: 50 }, engineVersion: '1.0.0' }); await b.saveAnalysis({ id: '00000000-0000-4000-8000-000000000002', metrics: { acne: 60 }, engineVersion: '1.0.0' });
  await a.saveProfile({ goals: ['tone'], level: 'simple', comfort: { preferGentle: true }, exclusions: [] });
  fake.usage.set(uidA, [1, 2]); fake.usage.set(uidB, [3]);
  const r = await a.deleteAccount();
  assert.deepEqual(r, { ok: true });
  assert.equal(a.user, null, 'session locale supprimée');
  assert.ok(!fake.users.has('a@exemple.com') && !fake.profiles.has(uidA) && !fake.analyses.has(uidA) && !fake.usage.has(uidA), 'tout ce qui appartenait au compte est supprimé');
  assert.ok(fake.users.has('b@exemple.com') && fake.profiles.has(uidB) && fake.analyses.get(uidB).length === 1 && fake.usage.get(uidB).length === 1, 'les données de B sont intactes');
  const call = fake.log.find(l => l.path === '/rest/v1/rpc/delete_my_account');
  assert.equal(JSON.stringify(call.body), '{}', 'aucun identifiant envoyé'); assert.ok(!call.path.includes(uidA) && !call.path.includes(uidB));
  assert.equal(JSON.stringify(call.headers).includes('service_role'), false);
  const old = await fake.fetch(URL + '/auth/v1/user', { headers: { apikey: KEY, authorization: 'Bearer ' + tokA } });
  assert.equal(old.status, 403, 'le jeton d\'un compte supprimé est refusé par la vérification serveur');
  assert.equal((await mk(memoryStorage()).signIn('a@exemple.com', 'motdepasse1')).ok, false, 'reconnexion impossible');
});

test('R8 suppression de compte : sans session, jeton refusé, panne : messages humains, rien n\'est supprimé', async () => {
  const { acc, fake } = setup();
  assert.deepEqual(await acc.deleteAccount(), { ok: false, error: Account.MSG.sessionExpired });
  await acc.signUp('a@exemple.com', 'motdepasse1');
  fake.state.failDelete = true; const f = await acc.deleteAccount(); fake.state.failDelete = false;
  assert.deepEqual(f, { ok: false, error: Account.MSG.deleteFailed }); assert.doesNotMatch(f.error, /XX000|rpc|trace|delete_my_account/);
  fake.state.failNetwork = true; assert.deepEqual(await acc.deleteAccount(), { ok: false, error: Account.MSG.deleteFailed }); fake.state.failNetwork = false;
  assert.ok(fake.users.has('a@exemple.com') && acc.user, 'compte et session intacts après les échecs');
  fake.tokens.clear(); fake.refresh.clear();
  assert.deepEqual(await acc.deleteAccount(), { ok: false, error: Account.MSG.sessionExpired });
  assert.ok(fake.users.has('a@exemple.com'));
});
