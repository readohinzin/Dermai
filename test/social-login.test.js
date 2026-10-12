'use strict';
/* Connexion Google / Apple : js/account.js (adresse de départ, retour du fournisseur), js/social-auth.js (boutons), api/config-js.js (fournisseurs ouverts).
   Aucun réseau réel : aucun fournisseur n'est contacté, la navigation est simulée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const Social = require('../js/social-auth.js');
const config = require('../server/config');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SB = 'https://demo.supabase.co';
const mk = (extra = {}) => { const fake = createFake(); const acc = Account.create(Object.assign({ url: SB, anonKey: 'anon-key-for-tests', fetch: fake.fetch, storage: memoryStorage(), origin: 'https://dermai-afric.vercel.app' }, extra)); return { fake, acc }; };

test('SL1 adresse de départ : Supabase /authorize, fournisseur de la liste, retour sur le site ; sinon rien', () => {
  const { acc } = mk();
  const u = new URL(acc.oauthUrl('google'));
  assert.equal(u.origin + u.pathname, SB + '/auth/v1/authorize'); assert.equal(u.searchParams.get('provider'), 'google'); assert.equal(u.searchParams.get('redirect_to'), 'https://dermai-afric.vercel.app/');
  assert.equal(new URL(acc.oauthUrl('apple')).searchParams.get('provider'), 'apple');
  for (const bad of ['facebook', 'GOOGLE', 'google&x=1', '', undefined, null, '../x', 'github']) assert.equal(acc.oauthUrl(bad), '', String(bad));
  assert.equal(mk({ origin: '' }).acc.oauthUrl('google'), '', 'site sans adresse : rien');
  assert.equal(mk({ origin: 'javascript:alert(1)' }).acc.oauthUrl('google'), '');
  assert.equal(mk({ origin: 'https://a.b/c?x=1' }).acc.oauthUrl('google'), '', 'une adresse de site seulement, sans chemin');
  assert.equal(Account.create({ url: '', anonKey: '' }).oauthUrl('google'), '', 'comptes indisponibles : rien');
  assert.ok(!/anon-key|apikey/i.test(acc.oauthUrl('google')), 'aucune clé dans l\'adresse');
});

test('SL2 retour du fournisseur : jetons sans type = « oauth » ; les liens e-mail gardent leur type ; refus = message propre', () => {
  const frag = h => Account.readAuthRedirect(h);
  const oauth = frag('#access_token=aaaaaaaa.bbbbbbbb.cccccccc&expires_in=3600&provider_token=ya29.x&refresh_token=r1&token_type=bearer');
  assert.deepEqual([oauth.kind, oauth.type], ['session', 'oauth']);
  assert.equal(frag('#access_token=a&refresh_token=b&type=signup').type, 'signup'); assert.equal(frag('#access_token=a&refresh_token=b&type=recovery').type, 'recovery');
  assert.equal(frag('#access_token=a&refresh_token=b&type=magiclink').type, 'signup');
  assert.deepEqual(frag('#error=access_denied&error_code=access_denied&error_description=User+denied'), { kind: 'error', denied: true });
  assert.deepEqual(frag('#error=server_error&error_code=unexpected_failure'), { kind: 'error' });
  assert.deepEqual(frag('#error_code=otp_expired&error=access_denied'), { kind: 'error' }, 'lien d\'e-mail expiré : pas un refus de connexion');
  assert.deepEqual(frag('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { kind: 'error' });
  assert.equal(frag('#scan'), null); assert.equal(frag(''), null);
});

test('SL3 la session est ouverte APRÈS vérification auprès de Supabase ; message de bienvenue propre à ce mode ; jeton falsifié refusé', async () => {
  const { acc, fake } = mk();
  const su = JSON.parse(await (await fake.fetch(SB + '/auth/v1/signup', { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'g@exemple.com', password: 'motdepasse1' }) })).text());
  const parsed = Account.readAuthRedirect('#access_token=' + su.access_token + '&refresh_token=' + su.refresh_token + '&expires_in=3600&provider_token=x');
  const r = await acc.acceptRedirect(parsed);
  assert.equal(r.ok, true); assert.equal(r.type, 'oauth'); assert.equal(r.message, Account.MSG.oauthDone); assert.equal(r.user.email, 'g@exemple.com');
  const other = mk();
  const forged = await other.acc.acceptRedirect({ kind: 'session', type: 'oauth', access_token: 'aaaaaaaa.bbbbbbbb.cccccccc', refresh_token: 'x', expires_in: 3600 });
  assert.deepEqual(forged, { ok: false, error: Account.MSG.linkInvalid });
  assert.equal((await mk().acc.acceptRedirect({ kind: 'error', denied: true })).ok, false);
  const email = await mk().acc.acceptRedirect(Account.readAuthRedirect(mk().fake.confirmLink('x@exemple.com')));
  assert.equal(email.ok, false);   // lien d'un autre faux Supabase : refusé, comme avant
});

test('SL4 boutons : aucun par défaut ; seulement les fournisseurs du serveur ET pris en charge ; rien si les comptes sont indisponibles', () => {
  const url = p => 'https://x.supabase.co/auth/v1/authorize?provider=' + p;
  assert.equal(Social.create({ url, providers: () => [] }).html(), ''); assert.equal(Social.create({ url, providers: () => undefined }).html(), '');
  assert.equal(Social.create({ url }).html(), '', 'sans configuration : aucun bouton');
  const g = Social.create({ url, providers: () => ['google'] }).html();
  assert.match(g, /data-social="google"[^>]*>[\s\S]*Continuer avec Google/); assert.doesNotMatch(g, /Apple/); assert.match(g, /ou avec votre adresse e-mail/);
  const both = Social.create({ url, providers: () => ['apple', 'google', 'facebook', '<img>'] }).html();
  assert.match(both, /Continuer avec Google/); assert.match(both, /Continuer avec Apple/); assert.doesNotMatch(both, /facebook|<img>/i);
  assert.ok(both.indexOf('data-social="google"') < both.indexOf('data-social="apple"'), 'ordre fixe : Google puis Apple');
  assert.equal(Social.create({ url: () => '', providers: () => ['google'] }).html(), '', 'comptes indisponibles : pas de bouton qui ne mènerait nulle part');
});

test('SL5 départ : une seule navigation, vers l\'adresse de Supabase ; fournisseur non listé ou inconnu ignoré ; aucun réseau', () => {
  const trap = []; const f = globalThis.fetch; globalThis.fetch = (...a) => { trap.push(a[0]); throw new Error('réseau interdit'); };
  try {
    const gone = [];
    const s = Social.create({ url: p => 'https://x.supabase.co/auth/v1/authorize?provider=' + p, go: a => gone.push(a), providers: () => ['google'] });
    assert.equal(s.start('apple'), false); assert.equal(s.start('facebook'), false); assert.equal(s.start(undefined), false); assert.deepEqual(gone, []);
    assert.equal(s.start('google'), true); assert.equal(s.start('google'), false, 'second clic ignoré'); assert.deepEqual(gone, ['https://x.supabase.co/auth/v1/authorize?provider=google']);
    const handlers = []; s.attach({ addEventListener: (t, fn) => handlers.push([t, fn]) });
    assert.equal(handlers.length, 1); assert.equal(handlers[0][0], 'click');
    const s2 = Social.create({ url: p => 'https://x.supabase.co/a?provider=' + p, go: a => gone.push(a), providers: () => ['google'] });
    const btn = { disabled: false, getAttribute: () => 'google', closest() { return this; } }; let h2; s2.attach({ addEventListener: (t, fn) => { h2 = fn; } });
    h2({ target: btn }); h2({ target: btn }); assert.equal(btn.disabled, true); assert.equal(gone.length, 2, 'un seul départ malgré deux clics');
    assert.deepEqual(trap, []);
  } finally { globalThis.fetch = f; }
});

test('SL6 /api/config-js : fournisseurs ouverts seulement si DERMAI_SOCIAL_PROVIDERS ; valeurs inconnues écartées ; aucun secret', () => {
  assert.deepEqual(config.socialProviders({}), []); assert.deepEqual(config.socialProviders({ DERMAI_SOCIAL_PROVIDERS: '' }), []);
  assert.deepEqual(config.socialProviders({ DERMAI_SOCIAL_PROVIDERS: 'google' }), ['google']);
  assert.deepEqual(config.socialProviders({ DERMAI_SOCIAL_PROVIDERS: ' Google , APPLE,google,facebook,github, ' }), ['google', 'apple']);
  assert.deepEqual(config.socialProviders({ DERMAI_SOCIAL_PROVIDERS: '*' }), [], 'pas de joker');
  const handler = require('../api/config-js.js');
  const run = env => { const saved = process.env.DERMAI_SOCIAL_PROVIDERS; if (env === undefined) delete process.env.DERMAI_SOCIAL_PROVIDERS; else process.env.DERMAI_SOCIAL_PROVIDERS = env; let out; try { handler({ method: 'GET' }, { setHeader() {}, end(b) { out = b; }, statusCode: 0 }); } finally { if (saved === undefined) delete process.env.DERMAI_SOCIAL_PROVIDERS; else process.env.DERMAI_SOCIAL_PROVIDERS = saved; } return out; };
  assert.ok(!/socialProviders/.test(run(undefined)), 'par défaut : la clé n\'existe pas (sortie identique à avant)');
  assert.match(run('google'), /"socialProviders":\["google"\]/);
  assert.ok(!/KEY|SECRET|CLIENT/i.test(run('google,apple').replace(/supabaseAnonKey/g, '')));
});

test('SL7 source : le client ne contient ni secret fournisseur, ni identifiant client ; app.js reste sous la limite', () => {
  const code = read('js/social-auth.js') + read('js/account.js');
  assert.doesNotMatch(code, /client_secret|GOOGLE_CLIENT|apps\.googleusercontent\.com|-----BEGIN|service_role/i);
  assert.doesNotMatch(read('js/social-auth.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000);
  assert.ok(read('index.html').indexOf('js/account.js') < read('index.html').indexOf('js/social-auth.js') && read('index.html').indexOf('js/social-auth.js') < read('index.html').indexOf('js/app.js'));
});
