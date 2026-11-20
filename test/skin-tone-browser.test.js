'use strict';
/* Choix du teint dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (test/helpers/browser-harness.js).
   Prouve : sélecteur avant le scan et dans le profil, choix gardé sur l'appareil seulement (aucune requête), rougeur masquée pour un teint foncé
   à l'écran SANS toucher la donnée enregistrée, note simple pour un teint clair. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const SkinModel = require('../js/skin-model.js');

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

const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-12T09:00:00');
const row = (id, day) => {
  const metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 50 + day; }); metrics.redness = 42;
  return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: 60, skin_type: 'dry & redness', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' };
};
async function boot(env, route) {
  const { page } = env, uid = env.stats.session.user.id;
  env.fake.analyses.set(uid, [row(ID(1), 1), row(ID(2), 5)].map(r => Object.assign({ user_id: uid }, r)));
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  await page.evaluate(r => go(r), route);
}
const stored = page => page.evaluate(() => localStorage.getItem('dermai.skinTone'));

test('TB1 avant le scan et dans le profil : dix pastilles, estimation, choix gardé sur l\'appareil, aucune requête', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await boot(env, 'scan');
  assert.equal(await page.locator('[data-tone-picker] [data-tone]').count(), 10, 'sélecteur avant le scan');
  assert.match(await page.locator('[data-tone-picker]').innerText(), /l'écran de votre téléphone peut fausser les couleurs/);
  assert.equal(await stored(page), null, 'rien n\'est choisi d\'office');
  const before = [...env.stats.supabase];
  await page.locator('[data-tone="7"]').click();
  assert.equal(await stored(page), '7');
  assert.equal(await page.locator('[data-tone="7"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-tone="3"]').getAttribute('aria-checked'), 'false');
  assert.match(await page.locator('[data-tone-status]').innerText(), /Teint 7 sur 10 choisi/);
  const box = await page.locator('[data-tone="7"]').boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, 'zone tactile : ' + box.width + 'x' + box.height);
  assert.deepEqual(env.stats.supabase, before, 'choisir un teint ne provoque aucune requête');
  assert.deepEqual(env.stats.serverApi, []); assert.equal(env.stats.skin.length, 0);
  await page.evaluate(() => go('profile'));
  assert.equal(await page.locator('[data-tone-picker] [data-tone="7"]').getAttribute('aria-checked'), 'true', 'le profil montre le même choix');
  await page.locator('[data-tone-clear]').click();
  assert.equal(await stored(page), null, 'retirer efface le choix');
  assert.ok(!env.stats.supabase.some(r => /tone|teint/i.test(r)));
  assert.deepEqual(env.errors, []);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  await env.close();
});

test('TB2 teint foncé : rougeur masquée à l\'écran, avertissement, donnée enregistrée intacte ; teint clair : note simple', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await boot(env, 'profile');
  await page.locator('[data-tone="8"]').click();
  await page.evaluate(() => go('result'));
  await page.waitForSelector('[data-redness-masked]');
  assert.ok(await page.locator('[data-tone-alert]').count() === 1, 'avertissement « peau qui marque »');
  assert.equal(await page.locator('[data-redness-note]').count(), 0, 'pas de note simple quand la mesure est masquée');
  const li = await page.locator('#indicateurs li', { hasText: 'Rougeurs' }).innerText();
  assert.match(li, /Donnée indisponible/, 'la ligne Rougeurs est indisponible, pas un chiffre');
  assert.doesNotMatch(li, /\/\s*100/, 'aucun score sur la ligne Rougeurs');
  const raw = await page.evaluate(() => SCANS[state.latest].normalized.redness.uiScore);
  assert.equal(raw, 42, 'la donnée enregistrée garde la valeur reçue');
  assert.doesNotMatch(await page.locator('body').innerText(), /avec tendance aux rougeurs|Tendance aux rougeurs/, 'type de peau sans composante rougeur');
  await page.evaluate(() => go('profile'));
  await page.locator('[data-tone="3"]').click();
  await page.evaluate(() => go('result'));
  await page.waitForSelector('[data-redness-note]');
  assert.equal(await page.locator('[data-redness-masked]').count(), 0); assert.equal(await page.locator('[data-tone-alert]').count(), 0);
  assert.equal(await page.evaluate(() => SCANS[state.latest].normalized.redness.uiScore), 42);
  assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.serverApi, []);
  await env.close();
});
