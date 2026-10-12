'use strict';
/* Œil « afficher / masquer le mot de passe » dans le VRAI index.html et le VRAI js/app.js, dans Chromium, réseau simulé. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const ready = async page => { await page.goto('/'); await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'visitor'); };

test('PW1 connexion et inscription : masqué par défaut, un œil dans le champ ; un clic affiche, un second masque ; la valeur est conservée ; aucun envoi du formulaire', opts, async () => {
  const env = await H.open(browser, server);
  const { page } = env;
  await ready(page);
  for (const route of ['login', 'signup']) {
    await page.evaluate(r => go(r), route);
    await page.waitForSelector('#f-pw');
    assert.equal(await page.getAttribute('#f-pw', 'type'), 'password', route + ' : masqué par défaut');
    assert.equal(await page.locator('.c-pw #f-pw').count(), 1, 'le champ est dans son cadre');
    assert.equal(await page.locator('.c-pw [data-pw-toggle]').count(), 1, 'un seul œil');
    assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-label'), 'Afficher le mot de passe');
    assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-pressed'), 'false');
    assert.equal(await page.getAttribute('[data-pw-toggle]', 'type'), 'button', 'jamais un bouton d\'envoi');
    await page.fill('#f-pw', 'motdepasse1');
    const before = env.stats.supabase.length;
    await page.click('[data-pw-toggle]');
    assert.equal(await page.getAttribute('#f-pw', 'type'), 'text'); assert.equal(await page.inputValue('#f-pw'), 'motdepasse1', 'la valeur est conservée');
    assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-label'), 'Masquer le mot de passe'); assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-pressed'), 'true');
    await page.click('[data-pw-toggle]');
    assert.equal(await page.getAttribute('#f-pw', 'type'), 'password'); assert.equal(await page.inputValue('#f-pw'), 'motdepasse1');
    assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-label'), 'Afficher le mot de passe');
    assert.equal(env.stats.supabase.length, before, 'cliquer sur l\'œil ne contacte aucun serveur');
    assert.equal(await page.evaluate(() => state.route), route, 'cliquer sur l\'œil n\'envoie pas le formulaire');
  }
  assert.deepEqual(env.errors, []); await env.close();
});

test('PW2 le champ garde le focus au clic (clavier du téléphone) ; l\'œil s\'atteint au clavier ; le texte ne passe pas sous l\'œil', opts, async () => {
  const env = await H.open(browser, server);
  const { page } = env;
  await ready(page); await page.evaluate(() => go('login')); await page.waitForSelector('#f-pw');
  await page.focus('#f-pw');
  await page.dispatchEvent('[data-pw-toggle]', 'mousedown');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'f-pw', 'le focus reste dans le champ');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-pw-toggle')), '1', 'Tab mène à l\'œil');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('#f-pw', 'type'), 'text', 'Entrée sur l\'œil affiche');
  await page.keyboard.press('Space');
  assert.equal(await page.getAttribute('#f-pw', 'type'), 'password', 'Espace sur l\'œil masque');
  const pad = await page.$eval('#f-pw', el => parseFloat(getComputedStyle(el).paddingRight));
  assert.ok(pad >= 44, 'marge à droite du texte : ' + pad);
  const box = await page.$eval('[data-pw-toggle]', el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
  assert.ok(box[0] >= 44 && box[1] >= 44, 'zone tactile suffisante : ' + box);
  assert.deepEqual(env.errors, []); await env.close();
});

test('PW3 un mot de passe révélé est remasqué quand la page passe en arrière-plan, et à chaque réaffichage de l\'écran', opts, async () => {
  const env = await H.open(browser, server);
  const { page } = env;
  await ready(page); await page.evaluate(() => go('login')); await page.waitForSelector('#f-pw');
  await page.fill('#f-pw', 'secret-visible'); await page.click('[data-pw-toggle]');
  assert.equal(await page.getAttribute('#f-pw', 'type'), 'text');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.getAttribute('#f-pw', 'type'), 'password', 'remasqué en arrière-plan'); assert.equal(await page.getAttribute('[data-pw-toggle]', 'aria-pressed'), 'false');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
  await page.click('[data-pw-toggle]'); assert.equal(await page.getAttribute('#f-pw', 'type'), 'text');
  await page.evaluate(() => go('signup')); await page.waitForSelector('#f-pw');
  assert.equal(await page.getAttribute('#f-pw', 'type'), 'password', 'nouvel écran : masqué'); assert.equal(await page.locator('[data-pw-toggle]').count(), 1);
  assert.deepEqual(env.errors, []); await env.close();
});

test('PW4 nouveau mot de passe (après un lien de récupération) : les deux champs ont chacun leur œil, indépendants', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { fake });
  const { page } = env;
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'r@exemple.com', password: 'motdepasse1' }) });
  await page.goto('/' + fake.recoveryLink('r@exemple.com'));
  await page.waitForSelector('#f-npw', { timeout: 15000 });
  assert.equal(await page.locator('[data-pw-toggle]').count(), 2);
  await page.fill('#f-npw', 'abcdefgh1'); await page.fill('#f-npw2', 'abcdefgh1');
  await page.locator('[data-pw-toggle]').first().click();
  assert.equal(await page.getAttribute('#f-npw', 'type'), 'text'); assert.equal(await page.getAttribute('#f-npw2', 'type'), 'password', 'l\'autre champ reste masqué');
  assert.deepEqual(env.errors, []); await env.close();
});

test('PW5 source : aucun réseau, stockage ni lecture de valeur dans le module ; chargé avant app.js ; une seule fois', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/password-toggle.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|\.value\b|console\./);
  const h = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(h.indexOf('js/password-toggle.js') > 0 && h.indexOf('js/password-toggle.js') < h.indexOf('js/app.js'));
  assert.equal((h.match(/js\/password-toggle\.js/g) || []).length, 1);
  assert.ok(fs.statSync(path.join(__dirname, '../js/app.js')).size < 150000);
});
