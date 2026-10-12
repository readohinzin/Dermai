'use strict';
/* Page d'administration du fondateur dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (test/helpers/browser-harness.js) : /api/admin-stats est intercepté par le navigateur de
   test (404 uniforme pour tout compte non fondateur, comme le serveur) ; aucune requête ne part vers le serveur ni vers Perfect Corp. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const A = require('../server/admin.js');

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

const NOW = '2026-10-14T09:30:00.000Z';
const ENV = { PERFECT_CORP_API_KEY: 'k', SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'a', DERMAI_ANALYSIS_ENABLED: '1', DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: '*' };
const SECTIONS = {
  features: { ok: true, generatedAt: NOW, features: A.featureRows(ENV) }, quotas: { ok: true, generatedAt: NOW, quotas: A.quotaRows({}) },
  credit: { ok: true, credit: { status: 'ok', fetchedAt: NOW, cached: false, spendable: 150, categories: [{ type: 'Api Purchased', amount: 120, spendable: true }, { type: 'Api Gift', amount: 30, spendable: true }, { type: 'Web Trial', amount: 5, spendable: false }] } },
  usage: { ok: true, usage: { status: 'ok', fetchedAt: NOW, cached: false, accounts: { total: 42, new_7d: 5, new_30d: 17, signed_in_7d: 20, signed_in_30d: 31, active_7d: 12, active_30d: 25, returned_7d: 7, never_used: 9, inactive_30d: 11 }, functions: [{ key: 'analysis', name: 'Analyse de la peau', available: true, runs_7d: 30, runs_30d: 90, users_30d: 25 }, { key: 'simulation', name: 'Simulation cosmétique', available: true, runs_7d: 4, runs_30d: 10, users_30d: 6 }, { key: 'makeup', name: 'Studio Beauté : maquillage', available: false }, { key: 'hair', name: 'Studio Beauté : cheveux', available: true, runs_7d: 3, runs_30d: 8, users_30d: 4, units_7d: 5, units_30d: 14 }], savedAnalyses: { total: 120, last_30d: 40, users: 30 } } },
  costs: { ok: true, costs: Object.assign({ status: 'ok', fetchedAt: NOW, cached: false, total: 4, pages: 1, truncated: false }, A.matchCosts([{ description: 'Skin analysis', amount: 4, unit: 'unit', procUnit: 'task', slug: 'skin-analysis' }, { description: 'Makeup', amount: 1, unit: 'unit', procUnit: 'task', slug: 'makeup-vto' }, { description: 'Hair style', amount: 2, unit: 'unit', procUnit: 'task', slug: 'hair-transfer' }, { description: 'Autre outil', amount: 3, unit: 'unit', procUnit: 'task', slug: 'face-attr-analysis' }])) }
};
const founder = (over = {}) => ({ user: { email: 'f@exemple.com' }, admin: { access: 'yes', sections: Object.assign({}, SECTIONS, over) } });
const boot = async env => {
  await env.page.goto('/');
  await env.page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
  await env.page.evaluate(() => go('home'));
};
const text = page => page.evaluate(() => document.getElementById('app').innerText);
const hOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.equal(env.stats.skin.length, 0, 'aucune analyse'); assert.equal(env.stats.sim.length, 0); assert.equal(env.stats.mk.length, 0); assert.equal(env.stats.hr.length, 0);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []); assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u)));
  assert.ok(env.stats.adm.every(x => x.method === 'GET'), 'seulement des lectures');
};
const openAdmin = async env => {
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 900 });
  const entry = page.locator('#sidebar .sidebar__link', { hasText: 'Administration' });
  await entry.waitFor({ state: 'visible', timeout: 10000 });
  await entry.click(); await page.waitForFunction(() => state.route === 'admin');
  await page.waitForFunction(() => /Solde Perfect Corp/.test(document.getElementById('app').innerText) && !/Chargement…/.test(document.getElementById('app').innerText), null, { timeout: 15000 });
};

test('AB1 compte non fondateur (cas général) : aucune entrée de menu, une seule requête d\'accès (404), aucune section demandée ; la route tapée à la main est « introuvable » sans aucun indice', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  for (const w of [1280, 420]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150); assert.equal(await page.locator('#sidebar [data-go=admin]').count(), 0, `${w} px`); }
  await page.evaluate(() => go('analyses')); await page.evaluate(() => go('progress'));
  assert.deepEqual(env.stats.adm.map(x => x.section), ['access'], 'une requête d\'accès par session, aucune section'); assert.ok(env.stats.adm[0].auth);
  await page.evaluate(() => go('admin')); await page.waitForFunction(() => state.route === 'admin');
  const t = await text(page); assert.match(t, /Page introuvable/); assert.doesNotMatch(t, /Administration|Fondateur|Solde|Quotas|Perfect/); assert.equal(await page.locator('[data-ad]').count(), 0);
  assert.equal(env.stats.adm.length, 1, 'ouvrir la route ne demande toujours aucune section');
  clean(env); await env.close();
});

test('AB2 fondateur : entrée « Administration » (ordinateur et mobile), page à six blocs lus en GET, solde et coûts officiels, états et quotas, aucune action de modification, aucune analyse', opts, async () => {
  const env = await H.open(browser, server, founder());
  await boot(env); const { page } = env;
  await openAdmin(env);
  assert.deepEqual(await page.locator('#sidebar .sidebar__text').allInnerTexts().then(a => a.slice(-4)), ['Ma routine', 'Administration', 'Profil et paramètres', 'Se déconnecter']);
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Administration'));
  const t = await text(page);
  for (const l of ['Solde Perfect Corp', 'Coûts officiels annoncés', 'Fonctionnalités', 'Quotas configurés', 'Lecture seule']) assert.match(t, new RegExp(l));
  assert.match(t, /150\s*unités API/); assert.match(t, /Historique non disponible/); assert.match(t, /Api Purchased/); assert.match(t, /Ce n'est pas la consommation réelle observée/);
  assert.match(t, /Analyse cutanée/); assert.match(t, /Non rapprochés d'une fonction DERMAI \(1\)/); assert.match(t, /3 analyses \/ 24 h/); assert.match(t, /Tous les comptes connectés/);
  assert.deepEqual(env.stats.adm.map(x => x.section).sort(), ['access', 'costs', 'credit', 'features', 'quotas', 'usage']); assert.ok(env.stats.adm.every(x => x.auth && x.method === 'GET'));
  const inMain = await page.$$eval('.main [data-ad], .main form, .main input, .main select, .main textarea, .main [data-act], .main a[href]', els => els.length); assert.equal(inMain, 2, 'deux contrôles seulement dans la page : Actualiser et le titre « Comptes » qui se déploie');
  assert.deepEqual(await page.$$eval('.c-ad-card', els => els.map(e => e.id)), ['ad-credit', 'ad-accounts', 'ad-usage', 'ad-costs', 'ad-features', 'ad-quotas']);
  // mobile : même entrée dans le panneau
  await page.evaluate(() => go('home')); await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(150);
  await page.click('.sidebar__toggle'); await page.waitForTimeout(350); await page.locator('#sidebar .sidebar__link', { hasText: 'Administration' }).click(); await page.waitForFunction(() => state.route === 'admin'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), false); assert.equal(await hOverflow(page), 0, 'pas de défilement horizontal à 420 px');
  clean(env); await env.close();
});

test('AB3 données indisponibles : « Indisponible » avec la cause, jamais zéro ; un bloc en échec n\'efface pas les autres', opts, async () => {
  const env = await H.open(browser, server, founder({
    credit: { ok: true, credit: { status: 'unavailable', reason: 'key_missing', fetchedAt: NOW } }, costs: { ok: true, costs: { status: 'unavailable', reason: 'malformed', fetchedAt: NOW } }, quotas: { status: 500, body: { ok: false, error: 'x' } } }));
  await boot(env); const { page } = env; await openAdmin(env);
  const t = await text(page); assert.match(t, /Indisponible/); assert.match(t, /La clé Perfect Corp n'est pas configurée sur le serveur/); assert.match(t, /forme inconnue/); assert.match(t, /n'a pas pu être chargée/);
  assert.doesNotMatch(t.split('Coûts officiels')[0], /\b0\s*unités API/); assert.doesNotMatch(t, /unités API/, 'aucun chiffre de solde inventé'); assert.match(t, /Cheveux : Coiffures et perruques/, 'les fonctionnalités restent affichées');
  assert.equal(await page.locator('.c-ad-group').count(), 0, 'aucun groupe de coûts inventé');
  clean(env); await env.close();
});

test('AB4 actualiser et clavier : le bouton relit les cinq sources sans effet, une seule fois malgré un double clic, au clavier aussi ; rien n\'est stocké ; aucun appel d\'analyse', opts, async () => {
  const env = await H.open(browser, server, founder());
  await boot(env); const { page } = env; await openAdmin(env);
  const before = env.stats.adm.length; assert.equal(before, 6, 'un accès et cinq sections');
  await page.locator('[data-ad=refresh]').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('[data-ad=refresh]').disabled, null, { timeout: 10000 }); assert.equal(env.stats.adm.length, before + 5, 'cinq lectures, jamais plus');
  await page.evaluate(() => { const b = document.querySelector('[data-ad=refresh]'); b.click(); b.click(); b.click(); });
  await page.waitForFunction(() => !document.querySelector('[data-ad=refresh]').disabled, null, { timeout: 10000 }); assert.equal(env.stats.adm.length, before + 10, 'un double clic ne double pas les lectures (une seule relecture de cinq sections)');
  const dump = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])); assert.ok(!/admin|Api Purchased|150|credit/i.test(dump), 'rien de la page en stockage navigateur');
  clean(env); await env.close();
});

test('AB5 mise en page : une colonne à 420 px sans défilement horizontal, deux colonnes sur ordinateur ; cibles tactiles ; aucune valeur coupée', opts, async () => {
  const env = await H.open(browser, server, founder());
  await boot(env); const { page } = env; await openAdmin(env);
  const box = id => page.locator('#' + id).boundingBox();
  const wide = [await box('ad-credit'), await box('ad-accounts'), await box('ad-usage'), await box('ad-costs'), await box('ad-features'), await box('ad-quotas')];
  assert.ok(wide[0].y === wide[1].y && wide[1].x > wide[0].x + wide[0].width - 2, 'ordinateur : solde et comptes côte à côte : ' + JSON.stringify(wide.slice(0, 2)));
  await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(250);
  assert.equal(await hOverflow(page), 0); const narrow = [await box('ad-credit'), await box('ad-accounts')]; assert.ok(narrow[1].y > narrow[0].y + narrow[0].height - 2 && narrow[0].width <= 420, 'mobile : empilé : ' + JSON.stringify(narrow));
  const tooWide = await page.evaluate(() => [...document.querySelectorAll('.c-ad-card, .c-ad-row, .c-ad-list li, .c-ad-dl dd')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length); assert.equal(tooWide, 0, 'aucun élément ne dépasse');
  const btn = await page.locator('[data-ad=refresh]').boundingBox(); assert.ok(btn.height >= 40, 'cible tactile : ' + JSON.stringify(btn));
  clean(env); await env.close();
});

test('AB6 déconnexion : l\'entrée et les données disparaissent, rien ne reste en mémoire pour un autre compte ; la route redevient « introuvable »', opts, async () => {
  const env = await H.open(browser, server, founder());
  await boot(env); const { page } = env; await openAdmin(env);
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status !== 'signedIn');
  assert.equal(await page.locator('#sidebar [data-go=admin]').count(), 0);
  await page.evaluate(() => go('admin')).catch(() => {}); const t = await text(page).catch(() => ''); assert.ok(!/Solde Perfect Corp|150|Api Purchased/.test(t), 'plus aucune donnée du fondateur');
  assert.ok(!/Api Purchased|Solde Perfect Corp/.test(await page.content()), 'aucune donnée résiduelle dans la page');
  clean(env); await env.close();
});
