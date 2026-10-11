'use strict';
/* Course renouvellement de session / déconnexion, avec le VRAI js/app.js dans Chromium (réseau simulé, voir test/helpers/browser-harness.js).
   La requête de renouvellement est retenue par une promesse contrôlable pendant que l'utilisateur se déconnecte (ou qu'un autre compte se connecte),
   puis relâchée : on vérifie que la réponse tardive ne rétablit rien, y compris après un rechargement de la page.
   Aucun appel à Perfect Corp : /api/skin-analysis est intercepté. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 90000 };
let browser, server;
test.before(async () => {
  if (!OK) return;
  const stats = { serverApi: [] };
  server = await H.startServer(stats); server.stats = stats;
  browser = await H.loadPlaywright().chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const rowsOf = fake => [...fake.analyses.values()].flat();
const posts = env => env.stats.supabase.filter(s => s === 'POST /rest/v1/skin_analyses').length;

/* A connecté avec une analyse reçue mais pas enregistrée (le service d'enregistrement est en panne), puis jeton d'accès expiré côté serveur,
   service rétabli, et renouvellement des jetons retenu par une promesse. Rend la main quand la reprise attend la réponse du renouvellement. */
async function pendingWithHeldRenewal() {
  const fake = H.createFake(); fake.state.failAnalyses = true;
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await page.goto('/scan');
  await page.waitForSelector('[data-act=scan-start]'); await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  await page.setInputFiles('#realGalleryInput', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) });
  await page.waitForSelector('[data-act=analyze]'); await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });
  assert.equal((await page.evaluate(() => JSON.parse(sessionStorage.getItem('dermai.pending')).items.length)), 1);
  fake.tokens.clear(); fake.state.failAnalyses = false;
  let release, arrive; const gate = new Promise(r => { release = r; }), arrived = new Promise(r => { arrive = r; });
  await page.route('**/auth/v1/token*', async route => {
    if (new URL(route.request().url()).searchParams.get('grant_type') === 'refresh_token') { arrive(); await gate; }
    await route.fallback();
  });
  page.__dialogAnswer = true;
  await page.evaluate(() => { F.resume(true); });
  await arrived;
  return { env, fake, page, release, posts0: posts(env) };
}
const sessionState = page => page.evaluate(() => ({ status: state.account.status, user: ACCOUNT.user && ACCOUNT.user.email, stored: localStorage.getItem('dermai.session'), pending: sessionStorage.getItem('dermai.pending') }));

test('SB1 déconnexion pendant un renouvellement : après rechargement, l\'état reste visiteur, rien n\'est envoyé ni rétabli', opts, async () => {
  const { env, fake, page, release, posts0 } = await pendingWithHeldRenewal();
  await page.evaluate(() => logout());                                  // confirmation acceptée : l'analyse non enregistrée est abandonnée
  assert.equal(env.dialogs.length, 1);
  let s = await sessionState(page);
  assert.equal(s.status, 'visitor'); assert.equal(s.stored, null); assert.equal(s.pending, null);
  release();                                                           // la réponse du renouvellement arrive APRÈS la déconnexion
  await page.waitForTimeout(800);
  s = await sessionState(page);
  assert.deepEqual(s, { status: 'visitor', user: null, stored: null, pending: null }, 'aucune session rétablie');
  assert.equal(posts(env), posts0, 'aucun envoi après la déconnexion');
  assert.equal(rowsOf(fake).length, 0);
  await page.reload();
  await page.waitForFunction(() => state.account.status !== 'checking');
  s = await sessionState(page);
  assert.equal(s.status, 'visitor', 'après rechargement : toujours visiteur');
  assert.equal(s.stored, null); assert.equal(s.user, null);
  assert.equal(env.stats.skin.length, 1, 'une seule analyse payante pendant tout le scénario');
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  await env.close();
});

test('SB2 un autre compte se connecte pendant le renouvellement de A : B reste connecté, aussi après rechargement', opts, async () => {
  const { env, fake, page, release } = await pendingWithHeldRenewal();
  const b = await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  assert.equal(b.status, 200);
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com');
  await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const posts1 = posts(env);
  release();                                                           // le renouvellement de A se termine après la connexion de B
  await page.waitForTimeout(800);
  let s = await sessionState(page);
  assert.equal(s.status, 'signedIn'); assert.equal(s.user, 'b@exemple.com');
  assert.equal(JSON.parse(s.stored).user.email, 'b@exemple.com', 'la session stockée est celle de B');
  assert.equal(posts(env), posts1, 'rien de A n\'est envoyé');
  assert.equal(rowsOf(fake).length, 0);
  await page.reload();
  await page.waitForFunction(() => state.account.status === 'signedIn');
  s = await sessionState(page);
  assert.equal(s.user, 'b@exemple.com', 'après rechargement : B');
  assert.equal(rowsOf(fake).length, 0);
  assert.equal(env.stats.skin.length, 1);
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  await env.close();
});

/* Déconnexion volontaire : la session locale est effacée tout de suite, la requête réseau de déconnexion peut durer. Pendant ce temps, rien de ce qui
   appartient à l'ancien compte ne doit passer pour valide (authEpoch change dans le même instant que la session). */
const gateRoute = async (page, pattern, filter) => {
  let release, arrive; const gate = new Promise(r => { release = r; }), arrived = new Promise(r => { arrive = r; });
  await page.route(pattern, async route => { if (!filter || filter(route.request())) { arrive(); await gate; } await route.fallback(); });
  return { release, arrived };
};
async function signedInHome(fake) {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  await env.page.goto('/home');
  await env.page.waitForFunction(() => state.account.status === 'signedIn' && state.history.status === 'ready');
  return env;
}

test('SB3 réponse de profil de A (401) qui revient pendant la déconnexion : ni « session expirée », ni double navigation, état propre', opts, async () => {
  const fake = H.createFake();
  const env = await signedInHome(fake); const { page } = env;
  fake.tokens.clear();                                                      // le serveur refuse maintenant le jeton d'accès de A
  const prof = await gateRoute(page, '**/rest/v1/profiles*', r => r.method() !== 'GET');
  const out = await gateRoute(page, '**/auth/v1/logout');
  await page.evaluate(() => { window.__routes = []; const g = go; go = (r, ...a) => { window.__routes.push(r); return g(r, ...a); }; });   // trace des navigations
  await page.evaluate(() => { act('goal', 'hydration'); });                // enregistrement du profil de A en cours
  await prof.arrived;
  await page.evaluate(() => { window.__lo = logout(); });                  // déconnexion volontaire : requête réseau retenue
  await out.arrived;
  prof.release();                                                          // la réponse 401 de A arrive pendant la déconnexion
  await page.waitForTimeout(500);
  out.release();
  await page.evaluate(() => window.__lo);
  const end = await page.evaluate(() => ({ route: state.route, status: state.account.status, info: state.account.info, error: state.account.error, user: ACCOUNT.user, stored: localStorage.getItem('dermai.session'), routes: window.__routes }));
  assert.deepEqual(end, { route: 'landing', status: 'visitor', info: '', error: '', user: null, stored: null, routes: ['landing'] }, 'déconnecté, jamais « session expirée », une seule navigation');
  assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.serverApi, []);
  await env.close();
});

test('SB4 un autre compte se connecte pendant la requête de déconnexion de A : la fin de cette requête n\'efface pas la session de B', opts, async () => {
  const fake = H.createFake();
  const env = await signedInHome(fake); const { page } = env;
  const b = await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  assert.equal(b.status, 200);
  const out = await gateRoute(page, '**/auth/v1/logout');
  await page.evaluate(() => { window.__lo = logout(); });
  await out.arrived;
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com');
  await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const route0 = await page.evaluate(() => state.route);
  out.release();                                                           // la déconnexion de A se termine côté réseau APRÈS la connexion de B
  await page.evaluate(() => window.__lo);
  await page.waitForTimeout(300);
  const end = await page.evaluate(() => ({ route: state.route, status: state.account.status, email: state.account.email, user: ACCOUNT.user && ACCOUNT.user.email, stored: !!localStorage.getItem('dermai.session') }));
  assert.deepEqual(end, { route: route0, status: 'signedIn', email: 'b@exemple.com', user: 'b@exemple.com', stored: true }, 'B reste connecté, état de l\'application cohérent avec la session');
  await page.reload();
  await page.waitForFunction(() => state.account.status === 'signedIn');
  assert.equal(await page.evaluate(() => state.account.email), 'b@exemple.com');
  assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.serverApi, []);
  await env.close();
});
