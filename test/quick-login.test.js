'use strict';
/* Lien magique (connexion par e-mail, sans mot de passe) : js/account.js (demande, retour du lien) et js/quick-login.js (lien sous le formulaire).
   Aucun réseau réel : Supabase est remplacé par le faux de test/helpers/fake-supabase.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const Quick = require('../js/quick-login.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SB = 'https://demo.supabase.co';
const mk = () => { const fake = createFake(); const acc = Account.create({ url: SB, anonKey: 'anon-key-for-tests', fetch: fake.fetch, storage: memoryStorage() }); return { fake, acc }; };

test('ML1 demande d\'un lien : même réponse que l\'adresse existe ou non, adresse invalide refusée, limites gérées, aucune session ouverte', async () => {
  const { acc, fake } = mk();
  await acc.signUp('connu@exemple.com', 'motdepasse1'); await acc.signOut();
  const ok1 = await acc.requestMagicLink('connu@exemple.com'), ok2 = await acc.requestMagicLink('inconnu@exemple.com');
  assert.deepEqual(ok1, ok2); assert.equal(ok1.ok, true); assert.equal(ok1.message, Account.MSG.magicLinkSent); assert.match(ok1.message, /Si cette adresse est valide/);
  assert.deepEqual(fake.state.otpRequests, ['connu@exemple.com', 'inconnu@exemple.com']);
  assert.equal(await acc.accessToken(), null, 'demander un lien n\'ouvre aucune session');
  for (const bad of ['', 'pas une adresse', null, undefined, 'a@b']) assert.deepEqual(await acc.requestMagicLink(bad), { ok: false, error: Account.MSG.emailInvalid }, String(bad));
  fake.state.rateLimit = true; assert.deepEqual(await acc.requestMagicLink('connu@exemple.com'), { ok: false, error: Account.MSG.rateLimited }); fake.state.rateLimit = false;
  fake.state.failNetwork = true; assert.deepEqual(await acc.requestMagicLink('connu@exemple.com'), { ok: false, error: Account.MSG.network }); fake.state.failNetwork = false;
  assert.deepEqual(await Account.create({ url: '', anonKey: '' }).requestMagicLink('a@b.co'), { ok: false, error: Account.MSG.unavailable });
});

test('ML2 retour du lien : type « magiclink » = simple connexion, vérifiée auprès de Supabase ; les autres types gardent leur sens ; lien expiré refusé', async () => {
  const { acc, fake } = mk();
  await acc.signUp('m@exemple.com', 'motdepasse1'); await acc.signOut();
  const parsed = Account.readAuthRedirect(fake.magicLink('m@exemple.com'));
  assert.deepEqual([parsed.kind, parsed.type], ['session', 'magic']);
  const r = await acc.acceptRedirect(parsed);
  assert.equal(r.ok, true); assert.equal(r.type, 'magic'); assert.equal(r.message, Account.MSG.magicDone); assert.equal(r.user.email, 'm@exemple.com');
  assert.equal(Account.readAuthRedirect('#access_token=a&refresh_token=b&type=signup').type, 'signup');
  assert.equal(Account.readAuthRedirect('#access_token=a&refresh_token=b&type=recovery').type, 'recovery');
  assert.equal(Account.readAuthRedirect('#access_token=a&refresh_token=b').type, 'signup', 'sans type : comportement d\'origine');
  assert.deepEqual(Account.readAuthRedirect(fake.magicLink('inconnu@exemple.com')), { kind: 'error' }, 'lien expiré ou inconnu : refusé');
  const forged = await mk().acc.acceptRedirect({ kind: 'session', type: 'magic', access_token: 'aaaaaaaa.bbbbbbbb.cccccccc', refresh_token: 'x', expires_in: 3600 });
  assert.deepEqual(forged, { ok: false, error: Account.MSG.linkInvalid });
  assert.equal(Account.MSG.emailConfirmed, 'Votre adresse e-mail est confirmée. Bienvenue !', 'le message des confirmations d\'inscription est inchangé');
});

test('ML3 écran : lien sous le formulaire seulement si les comptes sont disponibles ; une demande à la fois ; adresse conservée ; messages affichés', async () => {
  assert.equal(Quick.create({ account: () => ({ available: false, requestMagicLink() {} }) }).magicHtml(), '');
  assert.equal(Quick.create({ account: () => null }).magicHtml(), '');
  const calls = []; let release; const gate = new Promise(r => { release = r; });
  const st = { info: 'x', error: 'y', formEmail: '' }; let renders = 0;
  const q = Quick.create({ account: () => ({ available: true, requestMagicLink: async e => { calls.push(e); await gate; return { ok: true, message: 'Lien envoyé' }; } }), state: () => st, render: () => { renders++; }, email: () => '  a@exemple.com ' });
  assert.match(q.magicHtml(), /data-quick="magic"[^>]*>Recevoir un lien de connexion par e-mail/); assert.match(q.magicHtml(), /pas de mot de passe/i);
  const p1 = q.magic(), p2 = q.magic(), p3 = q.magic();
  assert.equal(await p2, false); assert.equal(await p3, false); release(); await p1;
  assert.deepEqual(calls, ['a@exemple.com'], 'une seule demande malgré trois clics'); assert.equal(renders, 1);
  assert.deepEqual(st, { info: 'Lien envoyé', error: '', formEmail: 'a@exemple.com' }, 'adresse conservée, ancien message remplacé');
  const bad = Quick.create({ account: () => ({ available: true, requestMagicLink: async () => ({ ok: false, error: 'Trop de tentatives.' }) }), state: () => st, render() {}, email: () => 'b@exemple.com' });
  await bad.magic(); assert.deepEqual(st, { info: '', error: 'Trop de tentatives.', formEmail: 'b@exemple.com' });
  const boom = Quick.create({ account: () => ({ available: true, requestMagicLink: async () => { throw new Error('x'); } }), state: () => st, render() {}, email: () => 'c@exemple.com' });
  await boom.magic(); assert.equal(st.error, 'Une erreur est survenue. Veuillez réessayer.'); assert.equal(await boom.magic(), true, 'le verrou est libéré après une erreur');
  let h; const q2 = Quick.create({ account: () => ({ available: true, requestMagicLink: async e => { calls.push('clic:' + e); return { ok: true, message: 'ok' }; } }), state: () => st, render() {}, email: () => 'd@exemple.com' });
  q2.attach({ addEventListener: (t, fn) => { h = fn; } });
  const btn = { disabled: false, getAttribute: k => (k === 'data-quick' ? 'magic' : null), closest(sel) { return sel === '[data-quick]' ? this : null; } };
  h({ target: btn }); await new Promise(r => setImmediate(r)); assert.ok(calls.includes('clic:d@exemple.com'));
  h({ target: { closest: () => null } });   // un clic ailleurs ne fait rien
});

test('ML4 source : aucun réseau ni stockage dans le module ; aucun reste de connexion Google ou Apple ; app.js sous la limite ; ordre des scripts', () => {
  const mod = read('js/quick-login.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(mod, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|location\.assign/);
  const all = read('js/quick-login.js') + read('js/account.js') + read('api/config-js.js') + read('server/config.js') + read('.env.example');
  assert.doesNotMatch(all, /oauthUrl|socialProviders|DERMAI_SOCIAL_PROVIDERS|data-social|googleusercontent|client_secret|GOOGLE_CLIENT/i);
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000);
  const h = read('index.html');
  assert.ok(h.indexOf('js/account.js') < h.indexOf('js/quick-login.js') && h.indexOf('js/quick-login.js') < h.indexOf('js/app.js'));
  assert.equal((h.match(/js\/quick-login\.js/g) || []).length, 1);
});
