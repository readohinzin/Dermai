'use strict';
/* En-tête des pages (téléphone) figé pendant le défilement : logo et bouton du menu toujours visibles ; l'en-tête « retour » se fige juste en dessous.
   Dans le VRAI js/app.js, dans Chromium, réseau simulé. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
const row = (id, day) => { const metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 50 + day; }); return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: 60, skin_type: 'combination', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' }; };
const seed = env => { const uid = env.stats.session.user.id; env.fake.analyses.set(uid, [row(ID(1), 1), row(ID(2), 5)].map(r => Object.assign({ user_id: uid }, r))); };
const boot = async env => {
  await env.page.goto('/');
  await env.page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
};
const clean = env => { assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []); };
const rects = page => page.evaluate(() => {
  const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
  return { brand: r('.m-brand'), logo: r('.m-brand .brand'), toggle: r('.sidebar__toggle'), top: r('.top'), content: r('.main > :not(.m-brand):not(.top)'), scrollY: window.scrollY, docH: document.documentElement.scrollHeight, vh: window.innerHeight };
});

test('SH1 l\'en-tête de la page (logo et bouton du menu) reste en haut pendant le défilement, sur chaque écran à menu, à 320, 390 et 420 px', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env); const { page } = env;
  let scrolled = 0;
  for (const w of [320, 390, 420]) {
    await page.setViewportSize({ width: w, height: 760 });
    for (const r of ['profile', 'home', 'routine', 'analyses', 'progress']) {
      await page.evaluate(x => go(x), r); await page.waitForTimeout(120);
      await page.evaluate(() => window.scrollTo(0, 0)); const top0 = await rects(page);
      assert.ok(top0.brand && Math.abs(top0.brand.y) <= 1 && Math.abs(top0.brand.h - 56) <= 0.5 && top0.brand.w >= w - 1, `${r} ${w}px haut de page : ${JSON.stringify(top0.brand)}`);
      assert.ok(Math.abs(top0.logo.x + top0.logo.w / 2 - w / 2) <= 1, 'logo centré');
      assert.ok(top0.toggle.x + top0.toggle.w <= w - 16 && top0.toggle.x + top0.toggle.w >= w - 24, 'bouton du menu à 20 px du bord droit : ' + JSON.stringify(top0.toggle));
      assert.ok(top0.toggle.y >= 0 && top0.toggle.y + top0.toggle.h <= 56, 'bouton dans l\'en-tête');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const t = await rects(page);
      if (t.docH > t.vh + 200) {
        scrolled++;
        assert.ok(t.scrollY > 100, `${r} ${w}px : la page a bien défilé (${t.scrollY})`);
        assert.ok(Math.abs(t.brand.y) <= 1, `${r} ${w}px : en-tête figé en haut après défilement : ${JSON.stringify(t.brand)}`);
        assert.ok(Math.abs(t.toggle.y - top0.toggle.y) <= 1 && Math.abs(t.logo.y - top0.logo.y) <= 1, 'logo et bouton n\'ont pas bougé');
        const hit = await page.evaluate(() => { const e = document.elementFromPoint(window.innerWidth / 2, 28); return !!(e && e.closest('.m-brand')); });
        assert.ok(hit, `${r} ${w}px : rien du contenu ne passe devant l'en-tête`);
      }
    }
  }
  assert.ok(scrolled >= 6, 'au moins six pages assez longues pour défiler ont été examinées : ' + scrolled);
  clean(env); await env.close();
});

test('SH2 en-tête « retour » : il se fige juste sous l\'en-tête de la page, sans trou ni recouvrement, sur les écrans qui en ont un', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env); const { page } = env; await page.setViewportSize({ width: 390, height: 700 });
  let seen = 0;
  for (const [r, p] of [['result', null], ['concern', 'hydration'], ['actives', null], ['program', null]]) {
    await page.evaluate(([a, b]) => go(a, b), [r, p]); await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 0)); const t0 = await rects(page);
    if (!t0.top) continue; seen++;
    assert.ok(t0.top.y >= t0.brand.y + t0.brand.h - 1 - 12 && t0.top.y <= t0.brand.y + t0.brand.h + 1, `${r} : l'en-tête retour suit celui de la page de près : ${JSON.stringify([t0.brand, t0.top])}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); const t = await rects(page);
    if (t.docH > t.vh + 200) {
      assert.ok(Math.abs(t.brand.y) <= 1, r + ' : en-tête de la page figé');
      assert.ok(Math.abs(t.top.y - 56) <= 1, `${r} : en-tête retour figé à 56 px, juste dessous : ${JSON.stringify(t.top)}`);
    }
    const back = await page.evaluate(() => { const b = document.querySelector('.top [data-act=back]').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!(e && e.closest('[data-act=back]')); });
    assert.ok(back, r + ' : le bouton retour reste atteignable');
  }
  assert.ok(seen >= 2, 'au moins deux écrans à en-tête « retour » examinés : ' + seen);
  clean(env); await env.close();
});

test('SH3 le bouton du menu et le logo restent utilisables page défilée : le menu s\'ouvre, se referme, le logo ramène à l\'accueil du site', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env); const { page } = env; await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => go('profile')); await page.waitForTimeout(150);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); assert.ok((await rects(page)).scrollY > 100);
  await page.click('.sidebar__toggle'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), true, 'menu ouvert page défilée');
  const above = await page.evaluate(() => { const s = document.querySelector('#sidebar').getBoundingClientRect(), e = document.elementFromPoint(s.x + 20, 28); return !!(e && e.closest('#sidebar')); });
  assert.ok(above, 'le panneau passe devant l\'en-tête figé');
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  await page.click('.m-brand .brand'); await page.waitForFunction(() => state.route === 'landing', null, { timeout: 5000 });
  clean(env); await env.close();
});

test('SH4 ordinateur (≥ 920 px) : pas d\'en-tête mobile, la colonne latérale reste figée ; rien de l\'en-tête « retour » ne change', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env); const { page } = env; await page.setViewportSize({ width: 1280, height: 600 });
  await page.evaluate(() => go('profile')); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.m-brand')).display), 'none');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); const y = (await rects(page)).scrollY;
  const side = await page.evaluate(() => { const b = document.querySelector('#sidebar').getBoundingClientRect(); return { y: b.y, h: b.height, vh: innerHeight }; });
  if (y > 50) assert.ok(Math.abs(side.y) <= 1, 'colonne latérale figée : ' + JSON.stringify(side));
  await page.evaluate(() => go('result')); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.top')).position), 'static', 'bureau : l\'en-tête « retour » reste dans le flux, comme avant');
  clean(env); await env.close();
});

test('SH5 source : en-tête figé (sticky) dans nav.css, sous la zone sûre, au-dessus du contenu et sous le menu ; plus de position:relative concurrente ; app.js inchangé', () => {
  const nav = fs.readFileSync(path.join(__dirname, '../css/components/nav.css'), 'utf8'), sb = fs.readFileSync(path.join(__dirname, '../css/components/sidebar.css'), 'utf8');
  const rule = nav.match(/\.m-brand\{position:sticky[^}]*\}/)[0];
  assert.match(rule, /top:env\(safe-area-inset-top,0px\)/); assert.match(rule, /z-index:var\(--z-header\)/); assert.match(rule, /height:var\(--mbrand-h\)/); assert.match(rule, /margin:-20px -20px 12px/); assert.match(rule, /backdrop-filter:blur\(14px\)/);
  assert.match(nav, /:root\{--mbrand-h:56px\}/); assert.match(nav, /\.m-brand\+\.top\{margin-top:-12px;top:calc\(env\(safe-area-inset-top,0px\) \+ var\(--mbrand-h\)\)\}/);
  assert.match(nav, /@media \(min-width:920px\)\{\.m-brand\{display:none\}\}/);
  assert.ok(!/\.m-brand\{position:relative\}/.test(sb), 'plus de position:relative qui annulerait le sticky (même couche, chargée après)');
  assert.match(sb, /\.sidebar__toggle\{position:absolute;right:20px;top:50%/);
  const z = fs.readFileSync(path.join(__dirname, '../css/tokens.css'), 'utf8'); assert.match(z, /--z-header:10;/); assert.match(z, /--z-sheet:50;/);
});
