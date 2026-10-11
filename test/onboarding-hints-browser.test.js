'use strict';
/* Questionnaire (étape « objectifs ») dans le VRAI js/app.js, dans Chromium, réseau simulé : chaque choix porte une ligne en mots simples,
   le choix de l'acné s'appelle « Acné et imperfections ». Ignoré si Playwright / Chromium sont absents. */
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

test('OH1 étape « objectifs » : « Acné et imperfections » avec sa ligne explicative, les 8 choix expliqués, choix et limite de 3 inchangés', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await page.goto('/accueil');
  await page.waitForFunction(() => typeof go === 'function' && state.account.status === 'signedIn');
  await page.evaluate(() => go('onb', '1'));
  const t = await page.evaluate(() => document.getElementById('app').innerText);
  assert.match(t, /Quels sont vos objectifs \?/); assert.match(t, /Facultatif/);
  assert.match(t, /Acné et imperfections\s*\n\s*Boutons, points noirs, marques qui restent après un bouton\./);
  const opts8 = await page.$$eval('button.opt[data-act=goal]:not([data-v=none])', els => els.map(e => ({ v: e.dataset.v, hint: (e.querySelector('.s') || {}).textContent })));
  assert.deepEqual(opts8.map(o => o.v), ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance']);
  assert.ok(opts8.every(o => o.hint && o.hint.length > 10), 'une ligne explicative par choix');
  for (const v of ['blemishes', 'hydration', 'tone']) await page.click(`button.opt[data-v=${v}]`);
  assert.equal(await page.getAttribute('button.opt[data-v=blemishes]', 'aria-pressed'), 'true');
  await page.click('button.opt[data-v=aging]');
  assert.equal(await page.getAttribute('button.opt[data-v=aging]', 'aria-pressed'), 'false', 'trois au maximum');
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  await env.close();
});
