'use strict';
/* Bouton clair / sombre de l'en-tête (mobile) : posé juste avant le bouton du menu, couleur d'accent du thème, dessin de l'action possible.
   Partie statique + partie Chromium (réseau simulé, test/helpers/browser-harness.js ; ignorée si Playwright est absent). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Th = require('../js/theme.js');
const H = require('./helpers/browser-harness.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('TT1 bouton : libellé accessible, lune et soleil, aucun tiret cadratin ; placé juste avant le bouton du menu dans l\'en-tête', () => {
  const b = Th.toggle();
  assert.match(b, /^<button type="button" class="c-themebtn" data-theme-toggle aria-label="Changer le mode d&#39;affichage \(clair ou sombre\)">/);
  assert.match(b, /c-themebtn__moon/); assert.match(b, /c-themebtn__sun/); assert.ok(!/[—–]/.test(b));
  assert.match(read('js/app.js'), /<div class="m-brand">\$\{DermaiTheme\.toggle\(\)\}\$\{SB\.toggle\(\)\}\$\{brandBtn\(44\)\}<\/div>/);
  assert.equal(Buffer.byteLength(read('js/app.js')), 149502, 'app.js : taille fixée, plafond non relevé');
});

test('TT2 style : même gabarit que le bouton du menu, collé à sa gauche, logo à l\'extrême droite, couleur d\'accent (violet en clair, rose en sombre), jamais sur le bureau', () => {
  const css = read('css/components/pwa.css');
  assert.match(css, /\.c-themebtn\{position:absolute;left:20px/);
  assert.match(css, /width:var\(--tap\);height:var\(--tap\)/); assert.match(css, /color:var\(--accent\)/);
  assert.match(css, /:root\[data-theme="dark"\] \.c-themebtn__sun\{display:block\}/); assert.match(css, /:root:not\(\[data-theme="light"\]\) \.c-themebtn__sun\{display:block\}/);
  assert.match(css, /@media \(min-width:920px\)\{\.c-themebtn\{display:none\}\}/);
});

const OK = H.available();
test('TT3 clic : passe de clair à sombre et inverse, choix gardé sur l\'appareil, le dessin et la couleur suivent, aucune requête', { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 }, async () => {
  const stats = { serverApi: [] }, server = await H.startServer(stats); server.stats = stats;
  const browser = await H.loadPlaywright().chromium.launch();
  try {
    const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
    const { page } = env;
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
    await page.setViewportSize({ width: 390, height: 800 });
    const btn = page.locator('.m-brand .c-themebtn'), menu = page.locator('.m-brand .sidebar__toggle');
    const snap = () => page.evaluate(() => {
      const b = document.querySelector('.m-brand .c-themebtn'), m = document.querySelector('.m-brand .sidebar__toggle'), vis = s => getComputedStyle(b.querySelector(s)).display !== 'none';
      return { theme: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('dermai.theme'), moon: vis('.c-themebtn__moon'), sun: vis('.c-themebtn__sun'), color: getComputedStyle(b).color,
        gap: Math.round(m.getBoundingClientRect().left - b.getBoundingClientRect().right), before: b.getBoundingClientRect().right <= m.getBoundingClientRect().left,
        logoRight: Math.round(innerWidth - document.querySelector('.m-brand .brand-logo').getBoundingClientRect().right), menuRight: Math.round(m.getBoundingClientRect().right), logoLeft: Math.round(document.querySelector('.m-brand .brand-logo').getBoundingClientRect().left) };
    });
    const a = await snap();
    assert.deepEqual([a.moon, a.sun, a.before, a.gap], [true, false, true, 8], 'en clair : lune, juste avant le menu');
    assert.equal(a.logoRight, 20, 'logo à l\'extrême droite (marge de la page)'); assert.ok(a.logoLeft > a.menuRight, 'les deux boutons à gauche, le logo à droite');
    await btn.click(); const d = await snap();
    assert.deepEqual([d.theme, d.stored, d.moon, d.sun], ['dark', 'dark', false, true], 'en sombre : soleil');
    assert.notEqual(d.color, a.color, 'la couleur suit le thème');
    await btn.click(); const l = await snap();
    assert.deepEqual([l.theme, l.stored, l.moon, l.sun], ['light', 'light', true, false]);
    assert.ok(await menu.isVisible()); assert.deepEqual(stats.serverApi, [], 'aucune requête serveur');
    await env.close();
  } finally { await browser.close(); server.close(); }
});
