'use strict';
/* Simulation avant/après dans le VRAI js/app.js, dans Chromium, réseau entièrement simulé (test/helpers/browser-harness.js) :
   /api/skin-simulation est intercepté par le navigateur de test (aucune requête ne part vers le serveur, encore moins vers Perfect Corp).
   Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 };
let browser, server;
test.before(async () => {
  if (!OK) return;
  const stats = { serverApi: [] };
  server = await H.startServer(stats); server.stats = stats;
  browser = await H.loadPlaywright().chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const good = (concern = 'wrinkle') => ({ status: 200, body: { ok: true, simulation: { concern, intensity: 0.5, image: PNG } } });
const GOOD = good();
const text = page => page.evaluate(() => document.getElementById('app').innerText);
async function analyse(env) {
  const { page } = env;
  await page.goto('/scan');
  await page.waitForSelector('[data-act=scan-start]'); await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  await page.setInputFiles('#realGalleryInput', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) });
  await page.waitForSelector('[data-act=analyze]'); await page.click('[data-act=analyze]');
  await page.waitForFunction(() => state.route === 'result', null, { timeout: 15000 });
}
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeup/i.test(u)));
};
const openSim = page => page.waitForSelector('[data-sim=open]').then(() => page.click('[data-sim=open]')).then(() => page.waitForFunction(() => state.route === 'simulation'));

test('SB1 simulation fermée (défaut) : aucun bouton, aucune demande de simulation, l\'analyse reste intacte', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await analyse(env);
  await env.page.waitForFunction(() => true); await env.page.waitForTimeout(300);
  assert.ok(env.stats.simProbe.length >= 1, 'la disponibilité est demandée (GET, sans effet)'); assert.ok(env.stats.simProbe.every(p => p.auth));
  assert.doesNotMatch(await text(env.page), /Simuler une amélioration|Simulation cosmétique/);
  assert.equal(await env.page.locator('[data-sim=open]').count(), 0);
  assert.equal(env.stats.sim.length, 0); assert.equal(env.stats.skin.length, 1);
  clean(env); await env.close();
});

test('SB2 parcours complet (analyse en mémoire) : bouton, zone, photo réutilisée, une demande, avant/après, mentions, aucune nouvelle analyse', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [GOOD] } });
  const { page } = env;
  await analyse(env);
  await page.waitForSelector('[data-sim=open]');
  assert.match(await text(page), /Simuler une amélioration/);
  await openSim(page);
  let t = await text(page);
  assert.match(t, /Une illustration, pas une prédiction/); assert.match(t, /ne promet aucun résultat/); assert.match(t, /aucune valeur médicale/);
  assert.match(t, /compte dans votre quota de simulations/); assert.match(t, /n'est pas conservée/);
  for (const l of ['Rides', 'Radiance', 'Acné', 'Poches', 'Cernes', 'Taches', 'Pores', 'Texture', 'Rougeurs']) assert.match(t, new RegExp(l));
  assert.doesNotMatch(t, /Brillance|Sébum|oiliness/i, 'aucune zone dont l\'effet serait inversé');
  assert.doesNotMatch(t, /Une photo est nécessaire/, 'la photo de l\'analyse en cours est réutilisée');
  assert.equal(await page.isDisabled('[data-sim=run]'), true, 'rien ne part sans zone choisie');
  await page.click('[data-sim=pick][data-c=wrinkle]');
  assert.equal(await page.getAttribute('[data-sim=pick][data-c=wrinkle]', 'aria-pressed'), 'true');
  assert.equal(await page.isDisabled('[data-sim=run]'), false);
  assert.equal(env.stats.sim.length, 0, 'choisir ne déclenche rien');
  await page.click('[data-sim=run]');
  await page.waitForSelector('[data-sim=after]');
  assert.equal(env.stats.sim.length, 1); const q = env.stats.sim[0];
  assert.match(q.url, /\/api\/skin-simulation\?concern=wrinkle$/); assert.equal(q.type, 'image/jpeg'); assert.ok(q.auth); assert.ok(q.size > 1000);
  t = await text(page);
  assert.match(t, /Avant \/ après simulation : Rides/); assert.match(t, /Simulation cosmétique générée par ordinateur, à titre d'illustration seulement/); assert.match(t, /ni une promesse de résultat ni un avis médical/);
  assert.equal(await page.getAttribute('[data-sim=after]', 'src'), PNG);
  await page.fill('[data-sim=range]', '20').catch(() => {}); await page.$eval('[data-sim=range]', el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await page.$eval('[data-sim=after]', el => el.style.clipPath), /20%/);
  assert.equal(env.stats.skin.length, 1, 'aucune nouvelle analyse');
  assert.equal(await page.evaluate(() => JSON.stringify(Object.keys(localStorage)).includes('data:image') || Object.values(localStorage).some(v => String(v).includes('data:image'))), false, 'l\'image simulée n\'est jamais stockée');
  assert.equal(await page.evaluate(() => sessionStorage.length && Object.keys(sessionStorage).filter(k => /dermai\.sim\.pending/.test(k)).length), 0, 'réponse reçue : aucune demande « sans réponse »');
  clean(env); await env.close();
});

test('SB3 double clic et clics répétés : une seule demande, bouton occupé pendant l\'attente', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [Object.assign({ delay: 1200 }, GOOD)] } });
  const { page } = env;
  await analyse(env); await openSim(page);
  await page.click('[data-sim=pick][data-c=wrinkle]');
  await page.evaluate(() => { const b = document.querySelector('[data-sim=run]'); b.click(); b.click(); b.click(); });
  await page.waitForFunction(() => /Simulation en cours/.test(document.getElementById('app').innerText));
  assert.equal(await page.isDisabled('[data-sim=run]'), true);
  await page.evaluate(() => document.querySelector('[data-sim=run]').click());
  await page.waitForSelector('[data-sim=after]');
  assert.equal(env.stats.sim.length, 1, 'une seule requête malgré les clics répétés');
  clean(env); await env.close();
});

test('SB4 refus du serveur (quota atteint) : message clair, aucune image, pas de « réponse manquante », réessai possible seulement par un nouveau clic', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [{ status: 429, body: { ok: false, error: 'Le nombre de simulations disponibles est atteint pour le moment. Réessayez plus tard.' } }] } });
  const { page } = env;
  await analyse(env); await openSim(page);
  await page.click('[data-sim=pick][data-c=acne]'); await page.click('[data-sim=run]');
  await page.waitForFunction(() => /nombre de simulations disponibles/.test(document.getElementById('app').innerText));
  assert.equal(await page.locator('[data-sim=after]').count(), 0);
  assert.doesNotMatch(await text(page), /Réponse non reçue|Je comprends/);
  assert.equal(env.stats.sim.length, 1); await page.waitForTimeout(600); assert.equal(env.stats.sim.length, 1, 'aucune relance automatique');
  clean(env); await env.close();
});

test('SB5 réponse perdue (réseau coupé) : « réponse non reçue », trace de session, la relance demande une confirmation explicite', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [{ abort: true }, good('pores')] } });
  const { page } = env;
  await analyse(env); await openSim(page);
  await page.click('[data-sim=pick][data-c=pores]'); await page.click('[data-sim=run]');
  await page.waitForFunction(() => /Réponse non reçue/.test(document.getElementById('app').innerText));
  assert.match(await text(page), /a peut-être été comptée/);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.sim\.pending/.test(k)).length), 1);
  assert.equal(await page.locator('[data-sim=ack]').count(), 1, 'confirmation demandée avant toute relance');
  assert.equal(await page.isDisabled('[data-sim=run]'), true);
  assert.equal(env.stats.sim.length, 1);
  await page.click('[data-sim=ack]'); assert.equal(await page.isDisabled('[data-sim=run]'), false);
  assert.equal(env.stats.sim.length, 1, 'confirmer ne relance rien');
  await page.click('[data-sim=run]'); await page.waitForSelector('[data-sim=after]');
  assert.equal(env.stats.sim.length, 2);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.sim\.pending/.test(k)).length), 0, 'réponse reçue : trace effacée');
  assert.equal(env.stats.skin.length, 1);
  clean(env); await env.close();
});

test('SB6 réponse incomplète (ok sans image, image non conforme) : erreur claire, aucune image affichée', opts, async () => {
  for (const body of [{ ok: true, simulation: { concern: 'wrinkle', intensity: 0.5 } }, { ok: true, simulation: { concern: 'wrinkle', image: 'http://evil.example/x.png' } }, { ok: true, simulation: { concern: 'wrinkle', image: 'https://127.0.0.1/x.png' } }, { ok: true, simulation: { concern: 'wrinkle', image: 'javascript:alert(1)' } }, { ok: true, simulation: { concern: 'acne', image: PNG } }, { ok: true }]) {
    const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [{ status: 200, body }] } });
    const { page } = env;
    await analyse(env); await openSim(page);
    await page.click('[data-sim=pick][data-c=wrinkle]'); await page.click('[data-sim=run]');
    await page.waitForFunction(() => /n'est pas utilisable/.test(document.getElementById('app').innerText));
    assert.equal(await page.locator('[data-sim=after]').count(), 0); assert.equal(await page.locator('img[src^="http://evil"], img[src^="https://127"], img[src^="javascript"]').count(), 0);
    clean(env); await env.close();
  }
});

test('SB7 photo d\'origine indisponible (rechargement, photos non gardées) : on explique pourquoi, on demande une photo, AUCUNE nouvelle analyse', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [good('redness')] } });
  const { page } = env;
  await analyse(env);
  await page.reload();
  await page.waitForFunction(() => state.account.status === 'signedIn' && state.history.status === 'ready');
  await page.evaluate(() => { state.view = 0; go('result'); });
  await openSim(page);
  let t = await text(page);
  assert.match(t, /Une photo est nécessaire/); assert.match(t, /La photo de cette analyse n'est plus disponible dans DERMAI/); assert.match(t, /Aucune nouvelle analyse n'est lancée/);
  await page.click('[data-sim=pick][data-c=redness]');
  assert.equal(await page.isDisabled('[data-sim=run]'), true, 'pas de simulation sans photo');
  await page.setInputFiles('[data-sim=file]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) });
  await page.waitForFunction(() => /Photo prête/.test(document.getElementById('app').innerText));
  assert.equal(env.stats.sim.length, 0, 'choisir une photo ne lance rien');
  await page.click('[data-sim=run]'); await page.waitForSelector('[data-sim=after]');
  assert.equal(env.stats.sim.length, 1); assert.ok(env.stats.sim[0].size > 1000);
  assert.equal(env.stats.skin.length, 1, 'une seule analyse (celle d\'avant le rechargement) : la simulation n\'en lance aucune');
  clean(env); await env.close();
});

test('SB8 fichier choisi illisible : message, aucune demande', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [GOOD] } });
  const { page } = env;
  await analyse(env);
  await page.reload();
  await page.waitForFunction(() => state.account.status === 'signedIn' && state.history.status === 'ready');
  await page.evaluate(() => { state.view = 0; go('result'); }); await openSim(page);
  await page.setInputFiles('[data-sim=file]', { name: 'x.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('pas une image') });
  await page.waitForFunction(() => /Impossible de lire cette photo/.test(document.getElementById('app').innerText));
  await page.click('[data-sim=pick][data-c=acne]'); assert.equal(await page.isDisabled('[data-sim=run]'), true);
  assert.equal(env.stats.sim.length, 0);
  clean(env); await env.close();
});

test('SB9 analyse ancienne (historique) : aucun bouton ; changement de compte : plus rien ne se transmet', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake, sim: { available: true, behaviors: [GOOD] } });
  const { page } = env;
  await analyse(env);
  await openSim(page); await page.click('[data-sim=pick][data-c=wrinkle]'); await page.click('[data-sim=run]'); await page.waitForSelector('[data-sim=after]');
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => logout()); await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  await page.evaluate(() => go('simulation'));
  const t = await text(page);
  assert.doesNotMatch(t, /Avant \/ après/); assert.equal(await page.locator('[data-sim=after]').count(), 0, 'l\'image simulée de A n\'est pas montrée à B');
  clean(env); await env.close();
});

test('SB10 image simulée renvoyée par une URL https temporaire (cas réel) : affichée telle quelle ; si elle ne se charge pas, message clair et aucune image cassée', opts, async () => {
  const URL_IMG = 'https://results.example-pc.com/out/sim.png';
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true, behaviors: [{ status: 200, body: { ok: true, simulation: { concern: 'acne', intensity: 0.5, image: URL_IMG } } }] } });
  const { page } = env;
  await analyse(env); await openSim(page);
  await page.click('[data-sim=pick][data-c=acne]'); await page.click('[data-sim=run]');
  await page.waitForFunction(() => /n'a pas pu être chargée/.test(document.getElementById('app').innerText));   // le banc d'essai bloque tout hôte externe : le chargement échoue
  assert.equal(await page.locator('[data-sim=after]').count(), 0, 'aucune image cassée affichée');
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), [URL_IMG], 'la seule requête externe est l\'image elle-même, demandée par le navigateur');
  assert.equal(env.stats.sim.length, 1, 'aucune relance');
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  await env.close();
});
