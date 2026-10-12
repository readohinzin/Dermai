'use strict';
/* Programme de 30 jours dans le VRAI js/app.js, dans Chromium, réseau entièrement simulé (voir test/helpers/browser-harness.js).
   On prouve ici, avec l'application réelle : le rapport affiche ses limites et précautions ; le programme se construit à partir de l'analyse déjà reçue
   (une seule requête payante pendant tout le parcours, simulée : aucun appel à Perfect Corp) ; le suivi survit au rechargement ; il est propre à chaque compte ;
   il ne part nulle part sur le réseau. Ignoré si Playwright / Chromium sont absents. */
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

const D0 = new Date('2026-10-12T09:00:00'), at = n => new Date(D0.getTime() + (n - 1) * 86400000);
const text = page => page.evaluate(() => document.getElementById('app').innerText);
const html = page => page.evaluate(() => document.getElementById('app').innerHTML);
const care = (page, uid) => page.evaluate(u => { const v = localStorage.getItem('dermai.care.' + u); return v ? JSON.parse(v) : null; }, uid);
async function analyse(env) {                                  // une analyse (simulée) pour disposer d'un résultat réel
  const { page } = env;
  await page.clock.setFixedTime(D0);
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
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce/i.test(u)));
};
const uidOf = page => page.evaluate(() => ACCOUNT.user.id);

test('PB1 rapport : « Limites et précautions » visible, lien vers la routine ; rien ne relance l\'analyse', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await analyse(env);
  const t = await text(env.page);
  assert.match(t, /Limites et précautions/); assert.match(t, /À savoir sur cette analyse/); assert.match(t, /une seule photo/); assert.match(t, /pas un diagnostic médical/); assert.match(t, /Aucun résultat n'est garanti/); assert.match(t, /professionnel de santé/);
  assert.equal(env.stats.skin.length, 1);
  await env.page.evaluate(() => go('analyses')); await env.page.evaluate(() => { state.view = 0; go('result'); });
  assert.match(await text(env.page), /Limites et précautions/);
  assert.equal(env.stats.skin.length, 1, 'aucune analyse déclenchée par la consultation');
  clean(env); await env.close();
});

test('PB2 parcours : routine → programme → commencer → cocher → rechargement → jours suivants → tolérance → bilan, sans nouvelle analyse', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await analyse(env);
  const uid = await uidOf(page);
  await page.evaluate(() => go('routine'));
  assert.match(await text(page), /Programme de 30 jours/); assert.match(await text(page), /sans nouvelle analyse/);
  await page.click('main [data-go=program]');
  await page.waitForFunction(() => state.route === 'program');
  let t = await text(page);
  assert.match(t, /Mon programme de 30 jours/); assert.match(t, /aucune nouvelle analyse n'est lancée, jamais automatiquement/); assert.match(t, /Quand demander un avis professionnel/); assert.match(t, /Rester raisonnable côté budget/);
  assert.equal(await care(page, uid), null, 'consulter ne crée rien');
  await page.click('[data-cp=start]');
  t = await text(page); assert.match(t, /Jour 1 sur 30/); assert.match(t, /Matin/); assert.match(t, /Soir/);
  const st = await care(page, uid); assert.equal(st.v, 1); assert.ok(st.plan.steps.some(s => s.kind === 'treatment'), 'un soin ciblé dans le plan');
  assert.match(st.start, /^2026-10-12$/);
  const cleanse = '[data-cp=tick][data-s="morning:cleanse"]';
  await page.click(cleanse);
  assert.equal(await page.getAttribute(cleanse, 'aria-pressed'), 'true');
  assert.deepEqual((await care(page, uid)).checks, { 1: ['morning:cleanse'] });
  await page.reload();
  await page.waitForFunction(() => state.account.status === 'signedIn' && state.history.status === 'ready');
  await page.evaluate(() => go('program'));
  assert.equal(await page.getAttribute(cleanse, 'aria-pressed'), 'true', 'la case reste cochée après rechargement');
  // jour 3 : le jour 1 reste consultable, le programme avance
  await page.clock.setFixedTime(at(3));
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready'); await page.evaluate(() => go('program'));
  t = await text(page); assert.match(t, /Jour 3 sur 30/); assert.match(t, /Bilan de la semaine 1 \(en cours\)/);
  await page.click('[data-cp=day][data-d="1"]');
  assert.equal(await page.getAttribute(cleanse, 'aria-pressed'), 'true'); assert.match(await text(page), /Jour 1 : 1 sur/);
  await page.click('[data-cp=day][data-d="3"]');
  // tolérance : gêne modérée → quel soin ? → pause
  await page.click('[data-cp=tol][data-l=moderate]');
  assert.match(await text(page), /Quel soin pensez-vous concerné/);
  const first = (await care(page, uid)).plan.steps.find(s => s.kind === 'treatment' && s.first === 1);
  await page.click(`[data-cp=tolstep][data-s="${first.id}"]`);
  t = await text(page); assert.match(t, /mis en pause 3 jours/);
  assert.deepEqual((await care(page, uid)).logs, [{ d: 3, l: 'moderate', s: first.id }]);
  await page.click('[data-cp=day][data-d="3"]');
  assert.match(await text(page), /En pause après une gêne notée\. Reprise possible au jour 7, seulement si la peau est apaisée/);
  // réaction importante : suspension + orientation, reprise explicite
  await page.click('[data-cp=tol][data-l=strong]'); await page.click('[data-cp=tolstep][data-s=none]');
  t = await text(page); assert.match(t, /Suspendu : réaction importante notée/); assert.match(t, /demandez conseil à un professionnel de santé/); assert.match(t, /consultez en urgence/);
  await page.click('[data-cp=resume]');
  assert.doesNotMatch(await text(page), /Suspendu : réaction importante notée/);
  // fin de programme
  await page.clock.setFixedTime(at(40));
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready'); await page.evaluate(() => go('program'));
  t = await text(page); assert.match(t, /Programme terminé/); assert.match(t, /Bilan des jours 29 et 30/); assert.match(t, /DERMAI n'en lance jamais automatiquement/);
  assert.equal(env.stats.skin.length, 1, 'une seule analyse (simulée) pendant tout le parcours');
  assert.ok(!env.stats.supabase.some(s => /care|program/i.test(s)), 'le suivi ne part pas vers le serveur');
  const bodies = await page.evaluate(() => performance.getEntriesByType('resource').map(r => r.name).filter(n => /care|program/i.test(n) && !/\.js(\?|$)/.test(n)));
  assert.deepEqual(bodies, []);
  clean(env); await env.close();
});

test('PB3 chaque compte son suivi : B ne voit pas celui de A, A le retrouve ; effacement explicite en deux temps', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  await analyse(env);
  const a = await uidOf(page);
  await page.evaluate(() => go('program')); await page.click('[data-cp=start]'); await page.click('[data-cp=tick][data-s="morning:cleanse"]');
  assert.ok(await care(page, a));
  // B se connecte sur le même navigateur
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => logout());
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const b = await uidOf(page); assert.notEqual(a, b);
  await page.evaluate(() => go('program'));
  assert.match(await text(page), /Aucune analyse|Faites votre première analyse|première analyse/i, 'B n\'a pas d\'analyse : pas de programme');
  assert.doesNotMatch(await html(page), /Jour 1 sur 30|morning:cleanse/);
  assert.equal(await care(page, b), null); assert.ok(await care(page, a), 'le suivi de A reste sur l\'appareil, sous sa clé');
  // A revient
  await page.evaluate(() => logout());
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'a@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'a@exemple.com' && state.history.status === 'ready');
  await page.evaluate(() => go('program'));
  assert.match(await text(page), /Jour 1 sur 30/);
  assert.equal(await page.getAttribute('[data-cp=tick][data-s="morning:cleanse"]', 'aria-pressed'), 'true');
  // effacement en deux temps
  await page.click('[data-cp=erase]');
  assert.match(await text(page), /Effacer supprime de cet appareil/); assert.ok(await care(page, a), 'rien n\'est effacé avant confirmation');
  await page.click('[data-cp=cancel]'); assert.ok(await care(page, a));
  await page.click('[data-cp=erase]'); await page.click('[data-cp=erase-yes]');
  assert.equal(await care(page, a), null); assert.match(await text(page), /Commencer aujourd'hui/);
  assert.equal(env.stats.skin.length, 1);
  clean(env); await env.close();
});

test('PB4 suppression du compte : le suivi local du compte est effacé aussi', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await analyse(env);
  const a = await uidOf(page);
  await page.evaluate(() => go('program')); await page.click('[data-cp=start]');
  assert.ok(await care(page, a));
  await page.evaluate(() => deleteMyAccount());
  await page.waitForFunction(() => state.account.status === 'visitor', null, { timeout: 10000 });
  assert.equal(await care(page, a), null);
  clean(env); await env.close();
});

test('PB-reload rechargement sur /program : l\'écran se réaffiche une fois la session restaurée (il ne reste pas sur « Chargement de votre historique… »)', opts, async () => {
  const SkinModel = require('../js/skin-model.js');
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const uid = env.stats.session.user.id, metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 55; });
  env.fake.analyses.set(uid, [{ id: '00000000-0000-4000-8000-000000000001', user_id: uid, analyzed_at: '2026-10-05T08:00:00.000Z', global_score: 60, skin_type: 'combination', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' }]);
  const { page } = env;
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  await page.evaluate(() => go('program'));
  await page.reload();
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready' && state.route === 'program', null, { timeout: 15000 });
  await page.waitForSelector('[data-cp=start]', { timeout: 10000 });
  const t = await text(page);
  assert.match(t, /Mon programme de 30 jours/); assert.doesNotMatch(t, /Chargement de votre historique/);
  assert.equal(env.stats.skin.length, 0, 'aucune analyse lancée par le rechargement');
  clean(env); await env.close();
});
