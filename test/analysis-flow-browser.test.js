'use strict';
/* Phase 1 : le VRAI js/app.js dans Chromium, réseau entièrement simulé (voir test/helpers/browser-harness.js).
   Ce qu'on prouve ici, avec l'application réelle : une analyse payante ne part que d'un clic explicite (jamais d'un rendu, d'un changement d'écran
   ou d'une reprise d'enregistrement), un résultat reçu n'est pas perdu, et un résultat reste lié à son compte.
   AUCUN appel à Perfect Corp : /api/skin-analysis est intercepté par le navigateur de test (compteur `stats.skin`), Supabase est un faux en mémoire,
   toute autre requête sortante est bloquée. Ignoré (skip) si Playwright / Chromium ne sont pas installés. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 90000 };
let browser, server;
const SKEW = () => { window.__skew = 0; const rn = Date.now.bind(Date); Date.now = () => rn() + window.__skew; };   // horloge décalable (le module lit Date.now)

test.before(async () => {
  if (!OK) return;
  const stats = { serverApi: [] };
  server = await H.startServer(stats); server.stats = stats;
  browser = await H.loadPlaywright().chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const rowsOf = fake => [...fake.analyses.values()].flat();
const pendingOf = page => page.evaluate(() => { const v = sessionStorage.getItem('dermai.pending'); return v ? JSON.parse(v) : null; });
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };
async function pickPhoto(env) {
  const { page } = env;
  await page.waitForSelector('[data-act=scan-start]', { timeout: 10000 });
  await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  await page.setInputFiles('#realGalleryInput', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) });
  await page.waitForSelector('[data-act=analyze]', { timeout: 10000 });
}
async function ready(browserOpts, { openScan = true } = {}) {
  const env = await H.open(browser, server, browserOpts);
  await env.page.goto('/scan');
  if (openScan) await pickPhoto(env);
  return env;
}
function checkClean(env) {   // rien n'a quitté le banc d'essai, rien n'a atteint un serveur DERMAI ni Perfect Corp
  const bad = env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u));
  assert.deepEqual(bad, [], 'aucune requête sortante');
  assert.deepEqual(env.stats.serverApi, [], 'aucune requête /api/ n\'a atteint le serveur local');
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce/i.test(u)));
  assert.deepEqual(env.errors, [], 'aucune exception dans la page');
}
const toastText = page => page.evaluate(() => document.getElementById('toast').textContent);
const SLOW = [{ status: 200, body: H.analysisPayload(), delay: 900 }];

test('B1 un clic = une seule requête : double déclenchement, rendus répétés et écran d\'analyse rouvert ne relancent rien', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' }, behaviors: SLOW });
  const { page } = env;
  await page.evaluate(() => { act('analyze'); act('analyze'); act('analyze'); });          // trois déclenchements dans le même instant
  await page.evaluate(() => { for (let i = 0; i < 40; i++) render(true); go('analyzing', null, { replace: true }); render(); });   // rendus et ré-entrées sur l'écran d'analyse
  await until(() => page.evaluate(() => state.route === 'result'));
  assert.equal(env.stats.skin.length, 1, 'une seule requête payante');
  assert.equal(await page.evaluate(() => state.route), 'result');
  assert.equal(await until(() => rowsOf(env.fake).length === 1), true);
  checkClean(env); await env.close();
});

test('B2 sans clic « Analyser », aucune analyse : /analyzing, go(analyzing), rendu et retour arrière ne lancent rien', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' } });
  const { page } = env;
  await page.evaluate(() => { go('analyzing'); });
  await page.waitForFunction(() => state.route === 'scan');                               // pas d'intention : retour à la photo
  await page.evaluate(() => { go('analyzing', null, { replace: true }); render(); render(true); });
  await page.goto('/analyzing');                                                         // adresse directe : accueil, jamais d'analyse
  await page.waitForFunction(() => state.account.status === 'signedIn');
  await page.waitForTimeout(400);
  assert.equal(env.stats.skin.length, 0, 'aucune requête payante');
  assert.notEqual(await page.evaluate(() => state.route), 'analyzing');
  checkClean(env); await env.close();
});

test('B3 changement d\'écran pendant l\'analyse : le résultat reçu est gardé, enregistré, sans forcer la navigation', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' }, behaviors: SLOW });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.evaluate(() => go('profile'));                                              // l'utilisatrice quitte l'écran d'analyse
  assert.equal(await until(() => rowsOf(env.fake).length === 1, 8000), true, 'enregistré malgré le changement d\'écran');
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => state.route), 'profile', 'pas de navigation forcée vers le résultat');
  assert.equal(await page.evaluate(() => SCANS.filter(s => s.real).length), 1);
  assert.match(await toastText(page), /Votre analyse est terminée/);
  assert.equal(env.stats.skin.length, 1);
  await page.evaluate(() => go('result'));
  assert.match(await page.content(), /Analyse enregistrée dans votre historique/);
  assert.equal(await pendingOf(page), null, 'tampon vidé après l\'enregistrement');
  checkClean(env); await env.close();
});

test('B4 une analyse en cours bloque un second lancement (autre photo, autre écran)', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' }, behaviors: [{ status: 200, body: H.analysisPayload(), delay: 1500 }] });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.evaluate(() => go('scan'));
  await pickPhoto(env);
  await page.click('[data-act=analyze]');                                                // 2e clic pendant que la 1re analyse tourne
  assert.match(await toastText(page), /déjà en cours/);
  assert.equal(await page.evaluate(() => state.route), 'scan', 'on reste sur l\'écran de la photo');
  await until(() => rowsOf(env.fake).length === 1);
  assert.equal(env.stats.skin.length, 1);
  checkClean(env); await env.close();
});

test('B5 enregistrement en échec : résultat conservé, tentatives bornées, reprise sans nouvelle analyse (même identifiant)', opts, async () => {
  const fake = H.createFake(); fake.state.failAnalyses = true;
  const env = await ready({ user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });              // 1 essai + 2 nouveaux essais automatiques, puis l'erreur
  const posts = () => env.stats.supabase.filter(s => s === 'POST /rest/v1/skin_analyses').length;
  assert.equal(posts(), 3, 'tentatives automatiques bornées (1 + 2)');
  assert.equal(rowsOf(fake).length, 0);
  const buf = await pendingOf(page);
  assert.equal(buf.items.length, 1);
  const id = buf.items[0].rec.id;
  assert.match(await page.content(), /conservé sur cet appareil/);
  fake.state.failAnalyses = false;
  await page.click('[data-act=retry-analysis]');
  assert.equal(await until(() => rowsOf(fake).length === 1), true);
  assert.equal(rowsOf(fake)[0].id, id, 'même identifiant : pas de doublon');
  await page.evaluate(() => { F.resume(true); F.resume(true); window.dispatchEvent(new Event('online')); });   // reprises répétées
  await page.waitForTimeout(400);
  assert.equal(rowsOf(fake).length, 1);
  assert.equal(await pendingOf(page), null);
  assert.equal(env.stats.skin.length, 1, 'aucune nouvelle analyse payante pendant les reprises');
  checkClean(env); await env.close();
});

test('B6 rechargement de l\'onglet avec un résultat non enregistré : repris à la reconnexion, sans nouvelle analyse', opts, async () => {
  const fake = H.createFake(); fake.state.failAnalyses = true;
  const env = await ready({ user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });
  fake.state.failAnalyses = false;
  await page.reload();
  assert.equal(await until(() => rowsOf(fake).length === 1, 10000), true, 'envoyé automatiquement après le rechargement');
  await page.waitForFunction(() => state.history.status === 'ready');
  assert.equal(await page.evaluate(() => SCANS.length), 1, 'visible dans l\'historique');
  assert.equal(await pendingOf(page), null);
  assert.equal(env.stats.skin.length, 1, 'le rechargement ne relance pas l\'analyse');
  checkClean(env); await env.close();
});

test('B7 issue ambiguë : message honnête, blocage 65 s (même après rechargement), puis confirmation explicite', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' }, behaviors: [{ abort: true }, { status: 200, body: H.analysisPayload() }], preload: SKEW });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForFunction(() => state.route === 'scan' && state.scanError);
  const err = await page.evaluate(() => state.scanError);
  assert.match(err, /aucune réponse/i); assert.match(err, /peut-être été réalisée/);
  assert.doesNotMatch(err, /échou|échec|n'a pas fonctionné/i, 'ne prétend jamais que l\'analyse a échoué');
  const screen = await page.evaluate(() => document.getElementById('app').innerText);
  assert.match(screen, /Réponse non reçue/); assert.doesNotMatch(screen, /Analyse impossible|échou|échec/i, 'l\'écran ne dit pas que l\'analyse a échoué');
  assert.equal(env.stats.skin.length, 1);
  await page.click('[data-act=analyze]');                                                // dans la fenêtre : refus, aucun envoi
  assert.match(await toastText(page), /incertaine/);
  assert.equal(await page.evaluate(() => state.route), 'scan');
  assert.equal(env.stats.skin.length, 1);
  await page.reload(); await pickPhoto(env);                                             // le blocage survit au rechargement
  await page.click('[data-act=analyze]');
  assert.match(await toastText(page), /patientez encore \d+ s/);
  assert.equal(env.stats.skin.length, 1);
  await page.evaluate(() => { window.__skew = 66000; });                                  // 66 s plus tard : plus bloqué, mais jamais automatique
  env.page.__dialogAnswer = false;
  await page.click('[data-act=analyze]');                                                // refus de la confirmation
  assert.equal(env.dialogs.length, 1); assert.match(env.dialogs[0], /reste incertaine/);
  assert.equal(await page.evaluate(() => state.route), 'scan');
  assert.equal(env.stats.skin.length, 1, 'aucune relance sans accord');
  env.page.__dialogAnswer = true;
  await page.click('[data-act=analyze]');                                                // accord explicite
  assert.equal(env.dialogs.length, 2);
  assert.equal(await until(() => rowsOf(env.fake).length === 1), true);
  assert.equal(env.stats.skin.length, 2);
  checkClean(env); await env.close();
});

test('B8 réponse sans verdict DERMAI (page d\'erreur de la plateforme) : traitée comme incertaine ; refus JSON du serveur : pas de blocage', opts, async () => {
  let env = await ready({ user: { email: 'a@exemple.com' }, behaviors: [{ status: 504, contentType: 'text/html', body: '<html>FUNCTION_INVOCATION_TIMEOUT</html>' }] });
  await env.page.click('[data-act=analyze]');
  await env.page.waitForFunction(() => state.route === 'scan' && state.scanError);
  assert.match(await env.page.evaluate(() => state.scanError), /aucune réponse/i);
  await env.page.click('[data-act=analyze]');
  assert.match(await toastText(env.page), /incertaine/);
  assert.equal(env.stats.skin.length, 1);
  checkClean(env); await env.close();
  env = await ready({ user: { email: 'a@exemple.com' }, behaviors: [{ status: 502, body: { ok: false, error: 'Le service d\'analyse est momentanément indisponible.' } }, { status: 200, body: H.analysisPayload() }] });
  await env.page.click('[data-act=analyze]');
  await env.page.waitForFunction(() => state.route === 'scan' && state.scanError);
  assert.match(await env.page.evaluate(() => state.scanError), /momentanément indisponible/);
  await env.page.click('[data-act=analyze]');                                            // verdict connu (refus) : pas de blocage
  assert.equal(await until(() => rowsOf(env.fake).length === 1), true);
  assert.equal(env.stats.skin.length, 2);
  checkClean(env); await env.close();
});

test('B9 changement de compte sans déconnexion : l\'analyse en attente de A n\'est jamais envoyée ni montrée à B', opts, async () => {
  const fake = H.createFake(); fake.state.failAnalyses = true;
  const env = await ready({ user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });
  const idA = (await pendingOf(page)).items[0].rec.id;
  fake.state.failAnalyses = false;
  const b = await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  assert.equal(b.status, 200);
  const posts0 = env.stats.supabase.filter(s => s === 'POST /rest/v1/skin_analyses').length;
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com');
  await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  assert.equal(await page.evaluate(() => SCANS.length), 0, 'rien de A chez B');
  assert.equal(await pendingOf(page), null, 'entrée de A effacée');
  assert.equal(rowsOf(fake).length, 0, 'ni chez A ni chez B');
  assert.equal(env.stats.supabase.filter(s => s === 'POST /rest/v1/skin_analyses').length, posts0, 'aucun envoi sous la session de B');
  assert.match(await toastText(page), /autre compte/);
  assert.ok(!(await page.content()).includes(idA));
  assert.equal(env.stats.skin.length, 1);
  checkClean(env); await env.close();
});

test('B10 session expirée : l\'analyse reste liée à son compte, reprise à la reconnexion du MÊME compte, abandonnée pour un autre', opts, async () => {
  for (const same of [true, false]) {
    const fake = H.createFake();
    const env = await ready({ user: { email: 'a@exemple.com' }, fake });
    const { page } = env;
    fake.tokens.clear(); fake.refresh.clear();                                           // le serveur n'accepte plus la session
    await page.click('[data-act=analyze]');
    await page.waitForFunction(() => state.route === 'login', null, { timeout: 15000 });
    assert.match(await page.evaluate(() => state.account.info), /session a expiré/);
    assert.match(await page.evaluate(() => state.account.info), /conservée sur cet appareil/);
    assert.equal((await pendingOf(page)).items.length, 1, 'gardée pour son compte');
    assert.equal(rowsOf(fake).length, 0);
    if (!same) await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
    await page.fill('form[data-form=login] [name=email]', same ? 'a@exemple.com' : 'b@exemple.com');
    await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
    await page.click('form[data-form=login] button[type=submit]');
    await page.waitForFunction(() => state.history.status === 'ready');
    assert.equal(rowsOf(fake).length, same ? 1 : 0);
    assert.equal(await pendingOf(page), null);
    assert.equal(await page.evaluate(() => SCANS.length), same ? 1 : 0);
    assert.equal(env.stats.skin.length, 1);
    checkClean(env); await env.close();
  }
});

test('B11 déconnexion : confirmation si une analyse n\'est pas enregistrée ; refus = on reste connecté, accord = tampon effacé', opts, async () => {
  const fake = H.createFake(); fake.state.failAnalyses = true;
  const env = await ready({ user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });
  page.__dialogAnswer = false;
  await page.evaluate(() => logout());
  assert.equal(env.dialogs.length, 1); assert.match(env.dialogs[0], /sera perdue/);
  assert.equal(await page.evaluate(() => state.account.status), 'signedIn');
  assert.equal((await pendingOf(page)).items.length, 1);
  page.__dialogAnswer = true;
  await page.evaluate(() => logout());
  assert.equal(await page.evaluate(() => state.account.status), 'visitor');
  assert.equal(await pendingOf(page), null);
  assert.equal(await page.evaluate(() => SCANS.length), 0);
  assert.equal(env.stats.skin.length, 1);
  checkClean(env); await env.close();
});

test('B12 résultat qui arrive après un changement de compte : abandonné avec un message, jamais rattaché à l\'autre compte', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' }, behaviors: [{ status: 200, body: H.analysisPayload(), delay: 1200 }] });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.evaluate(() => logout());                                                    // rien à confirmer : pas d'analyse en attente
  await page.waitForFunction(() => /compte a changé/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => SCANS.length), 0);
  assert.equal(await pendingOf(page), null);
  assert.equal(rowsOf(env.fake).length, 0);
  assert.equal(env.stats.skin.length, 1);
  checkClean(env); await env.close();
});

test('B13 suppression de l\'historique et du compte : le tampon est effacé aussi', opts, async () => {
  for (const what of ['history', 'account']) {
    const fake = H.createFake(); fake.state.failAnalyses = true;
    const env = await ready({ user: { email: 'a@exemple.com' }, fake });
    const { page } = env;
    await page.click('[data-act=analyze]');
    await page.waitForSelector('[data-act=retry-analysis]', { timeout: 15000 });
    fake.state.failAnalyses = false;
    await page.evaluate(w => (w === 'history' ? deleteHistory() : deleteMyAccount()), what);
    await until(async () => (await pendingOf(page)) === null, 5000);
    assert.equal(await pendingOf(page), null);
    await page.waitForTimeout(300);
    assert.equal(rowsOf(fake).length, 0, 'rien n\'est renvoyé après la suppression');
    checkClean(env); await env.close();
  }
});

test('B14 un rendu dans la demi-seconde qui suit le succès ne relance rien et ne renvoie pas à la photo', opts, async () => {
  const env = await ready({ user: { email: 'a@exemple.com' } });
  const { page } = env;
  await page.click('[data-act=analyze]');
  await page.waitForFunction(() => state.scanStatus === 'success');
  await page.evaluate(() => { render(true); render(); render(true); });
  await page.waitForFunction(() => state.route === 'result', null, { timeout: 5000 });
  assert.equal(env.stats.skin.length, 1);
  assert.equal(await page.evaluate(() => SCANS.filter(s => s.real).length), 1);
  checkClean(env); await env.close();
});

test('B15 mode démonstration inchangé : trois photos simulées, analyse fictive, aucun sessionStorage, aucune requête payante', opts, async () => {
  const env = await H.open(browser, server, {});
  const { page } = env;
  await page.route('**/api/config-js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.DERMAI_CONFIG={demoMode:true};' }));
  await page.goto('/scan');
  await page.waitForSelector('[data-act=scan-start]');
  await page.click('[data-act=scan-start]');
  for (let i = 0; i < 3; i++) { await page.click('[data-act=shutter]'); await page.waitForTimeout(700); }
  await page.waitForSelector('[data-act=analyze]');
  await page.click('[data-act=analyze]');
  await page.waitForFunction(() => state.route === 'result', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => DEMO_MODE), true);
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), []);
  assert.equal(env.stats.skin.length, 0);
  checkClean(env); await env.close();
});
