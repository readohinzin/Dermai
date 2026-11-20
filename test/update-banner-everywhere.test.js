'use strict';
/* La bannière de mise à jour apparaît PARTOUT dans l'application (pas seulement sur l'accueil) : connecté, sur chaque écran, avec la barre latérale ou une feuille ouverte,
   dès qu'une nouvelle version est déployée, et elle reste au premier plan (rien ne la recouvre). Réseau simulé (test/helpers/browser-harness.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const SkinModel = require('../js/skin-model.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 180000 };
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (id, day) => {
  const metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 50 + day; });
  return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: 60, skin_type: 'dry', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'x' };
};
const ROUTES = ['home', 'scan', 'result', 'analyses', 'progress', 'routine', 'profile', 'products', 'program'];

test('UBE1 connecté : la bannière apparaît sur chaque écran de l\'application, au premier plan, et « Plus tard » la masque jusqu\'à la version suivante', opts, async () => {
  const stats = { serverApi: [], version: 'v1' }, server = await H.startServer(stats); server.stats = stats;
  const browser = await H.loadPlaywright().chromium.launch();
  try {
    const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
    const { page } = env, uid = env.stats.session.user.id;
    env.fake.analyses.set(uid, [row(ID(1), 1), row(ID(2), 5)].map(r => Object.assign({ user_id: uid }, r)));
    await page.goto('/');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
    await page.waitForFunction(() => window.__dermaiUpdate && window.__dermaiUpdate.state.baseline === 'v1', null, { timeout: 10000 });
    let n = 1;
    for (const r of ROUTES) {
      await page.evaluate(x => go(x), r); await page.waitForTimeout(200);
      n++; stats.version = 'v' + n;
      await page.evaluate(() => window.__dermaiUpdate.check(true));
      await page.waitForSelector('[data-update-banner]', { timeout: 5000 });
      const top = await page.evaluate(() => { const b = document.querySelector('[data-update-banner]'), r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + 6);
        const f = document.querySelector('.c-scanfab'), fr = f && getComputedStyle(f).display !== 'none' ? f.getBoundingClientRect() : null;
        return { inside: !!(e && b.contains(e)), y: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), w: Math.round(r.width), vw: innerWidth, vh: innerHeight, fabTop: fr ? Math.round(fr.top) : null }; });
      assert.ok(top.inside, r + ' : bannière recouverte : ' + JSON.stringify(top)); assert.ok(top.bottom <= top.vh && top.bottom > top.vh - 130 && top.y > 0 && top.w <= top.vw, r + ' : bannière en bas de l\'écran : ' + JSON.stringify(top));
      if (top.fabTop !== null) assert.ok(top.bottom <= top.fabTop, r + ' : la bannière ne recouvre pas le bouton rond d\'analyse : ' + JSON.stringify(top));
      await page.click('[data-update-later]'); assert.equal(await page.locator('[data-update-banner]').count(), 0, r + ' : masquée');
    }
    /* menu latéral ouvert, puis feuille ouverte : la bannière reste au premier plan */
    for (const open of ['sidebar', 'sheet']) {
      await page.evaluate(() => go('home')); await page.waitForTimeout(150);
      if (open === 'sidebar') await page.click('.sidebar__toggle'); else await page.evaluate(() => sheet('<h3>Test</h3><p>contenu</p>'));
      await page.waitForTimeout(250);
      n++; stats.version = 'v' + n; await page.evaluate(() => window.__dermaiUpdate.check(true));
      await page.waitForSelector('[data-update-banner]', { timeout: 5000 });
      const ok = await page.evaluate(() => { const b = document.querySelector('[data-update-banner]'), r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + 6); return !!(e && b.contains(e)); });
      assert.ok(ok, open + ' ouvert : la bannière doit rester au premier plan');
      await page.click('[data-update-later]');
      if (open === 'sidebar') await page.click('[data-sb=close]'); else await page.evaluate(() => closeSheet());
    }
    assert.deepEqual(stats.serverApi, []); await env.close();
  } finally { await browser.close(); server.close(); }
});

test('UBE2 sans rien forcer : une version publiée pendant que la personne est dans l\'application apparaît à son prochain toucher (et au plus tard au prochain contrôle automatique)', opts, async () => {
  const stats = { serverApi: [], version: 'a1' }, server = await H.startServer(stats); server.stats = stats;
  const browser = await H.loadPlaywright().chromium.launch();
  try {
    const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
    const { page } = env;
    await page.goto('/');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
    await page.waitForFunction(() => window.__dermaiUpdate && window.__dermaiUpdate.state.baseline === 'a1', null, { timeout: 10000 });
    await page.evaluate(() => go('profile')); await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-update-banner]').count(), 0);
    stats.version = 'a2'; await page.waitForTimeout(5600);
    await page.click('.sidebar__toggle');                                   // un simple toucher dans l'application
    await page.waitForSelector('[data-update-banner]', { timeout: 5000 });
    assert.match(await page.locator('[data-update-banner]').innerText(), /Nouvelle version disponible/);
    await env.close();
  } finally { await browser.close(); server.close(); }
});
