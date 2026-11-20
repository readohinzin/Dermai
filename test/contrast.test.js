'use strict';
/* Contrastes : jamais de blanc sur blanc, ni de foncé sur foncé. Chaque couple texte / fond des jetons (css/tokens.css) atteint WCAG AA (4,5 pour 1 pour le texte, 3 pour 1 pour les
   éléments d'interface) dans le thème clair ET dans le thème sombre, et un parcours dans Chromium vérifie chaque texte visible de chaque écran dans les deux thèmes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const H = require('./helpers/browser-harness.js');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const rgb = hex => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h; return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)); };
const lum = hex => { const c = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tokens = body => Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,6})\b/g)].map(m => [m[1], m[2]]));
const css = read('css/tokens.css');
const lightBody = /^:root\{([\s\S]*?)\n\}/m.exec(css)[1];
const darkAttr = /:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/.exec(css)[1];
const darkMedia = /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{([\s\S]*?)\n  \}\n\}/.exec(css)[1];
const LIGHT = tokens(lightBody), DARK = Object.assign({}, LIGHT, tokens(darkAttr));

/* [texte, fond, minimum, rôle] */
const PAIRS = [
  ['ink', 'bg', 4.5], ['ink', 'surface', 4.5], ['ink', 'tint', 4.5], ['ink', 'tint-strong', 4.5], ['ink', 'bg-soft', 4.5],
  ['ink-2', 'bg', 4.5], ['ink-2', 'surface', 4.5], ['ink-2', 'tint', 4.5], ['ink-3', 'bg', 4.5], ['ink-3', 'surface', 4.5], ['ink-3', 'tint', 4.5],
  ['accent', 'bg', 4.5], ['accent', 'surface', 4.5], ['accent', 'tint', 4.5], ['on-accent', 'accent', 4.5], ['on-accent', 'accent-hover', 4.5], ['on-accent', 'accent-pressed', 4.5],
  ['good-ink', 'good-bg', 4.5], ['mid-ink', 'mid-bg', 4.5], ['low-ink', 'low-bg', 4.5], ['error-ink', 'error-bg', 4.5], ['info-ink', 'info-bg', 4.5],
  ['good-ink', 'surface', 4.5], ['mid-ink', 'surface', 4.5], ['low-ink', 'surface', 4.5], ['error-ink', 'surface', 4.5],
  ['on-error', 'error', 4.5], ['inv-ink', 'inv-bg', 4.5],
  /* éléments d'interface : bordures de champs et de boutons, remplissages de barres, anneau de focus (3 pour 1) */
  ['line-strong', 'bg', 3], ['line-strong', 'surface', 3], ['good', 'surface', 3], ['mid', 'surface', 3], ['low', 'surface', 3], ['error', 'surface', 3], ['accent', 'bg', 3]
];

test('CT1 les deux blocs sombres (réglage du système et choix « Sombre ») sont identiques ; le clair et le sombre définissent les mêmes jetons', () => {
  const norm = b => b.replace(/\s+/g, ' ').replace(/color-scheme:dark;?/g, '').trim();
  assert.equal(norm(darkMedia), norm(darkAttr), 'même contenu dans les deux blocs');
  const names = b => [...b.matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]);
  const missing = names(darkAttr).filter(k => !names(lightBody).includes(k)); assert.deepEqual(missing, [], 'un jeton sombre sans équivalent clair : ' + missing);
  for (const k of ['bg', 'surface', 'ink', 'ink-2', 'ink-3', 'accent', 'on-accent', 'inv-bg', 'inv-ink', 'on-error', 'error', 'good-ink', 'mid-ink', 'low-ink']) assert.ok(tokens(darkAttr)[k] || k === 'on-accent', 'jeton sombre : ' + k);
  assert.match(css, /color-scheme:dark/); assert.match(read('index.html'), /<meta name="color-scheme" content="light dark">/);
});

test('CT2 chaque couple texte / fond des jetons atteint WCAG AA dans le thème clair', () => {
  for (const [fg, bg, min] of PAIRS) { const r = ratio(LIGHT[fg], LIGHT[bg]); assert.ok(r >= min, `clair : --${fg} ${LIGHT[fg]} sur --${bg} ${LIGHT[bg]} = ${r.toFixed(2)} (minimum ${min})`); }
});

test('CT3 chaque couple texte / fond des jetons atteint WCAG AA dans le thème sombre : jamais de clair sur clair', () => {
  for (const [fg, bg, min] of PAIRS) { const r = ratio(DARK[fg], DARK[bg]); assert.ok(r >= min, `sombre : --${fg} ${DARK[fg]} sur --${bg} ${DARK[bg]} = ${r.toFixed(2)} (minimum ${min})`); }
  assert.ok(ratio(DARK.ink, DARK.bg) > 12, 'texte principal très lisible sur le fond');
  assert.notEqual(DARK.bg.toLowerCase(), LIGHT.bg.toLowerCase());
});

test('CT4 composants à couleurs propres : bannière claire sous toutes les couleurs de fond, pastilles de teint, bulles de la bannière, étiquette de l\'appareil photo', () => {
  const T = require('../js/skin-tone.js');
  for (const m of T.MONK) assert.ok(T.contrast(m.hex, T.inkOn(m.hex)) >= 4.5, 'pastille ' + m.id);
  const hero = read('css/components/hero.css');
  for (const cls of ['', '--mid', '--low']) { const c = new RegExp('\\.hc-b' + cls + '\\{[^}]*--c:(#[0-9A-Fa-f]{6})').exec(hero)[1]; assert.ok(ratio(c, '#FFFFFF') >= 4.5, 'bulle ' + (cls || 'bon') + ' ' + c); }
  const inkHero = /\.hc\{color-scheme:light;[^}]*--ink:(#[0-9A-Fa-f]{6});[^}]*--ink-2:(#[0-9A-Fa-f]{6});[^}]*--ink-3:(#[0-9A-Fa-f]{6})/.exec(hero);
  assert.ok(inkHero, 'la bannière d\'accueil garde ses jetons clairs locaux');
  for (const m of hero.matchAll(/\.hc-t-\w+\{--g1:(#[0-9A-Fa-f]{6});--g2:(#[0-9A-Fa-f]{6});--g3:(#[0-9A-Fa-f]{6})\}/g)) for (const g of m.slice(1)) for (const k of inkHero.slice(1)) assert.ok(ratio(k, g) >= 4.5, `bannière : ${k} sur ${g}`);
  const label = /\.cam \.label span\{[^}]*background:rgba\(22,21,20,\.(\d+)\)/.exec(read('css/legacy.css'));
  const a = Number('0.' + label[1]), worst = Math.round(22 * a + 255 * (1 - a)), hex = '#' + [worst, worst, worst].map(v => v.toString(16).padStart(2, '0')).join('');
  assert.ok(ratio('#F6F3EE', hex) >= 4.5, 'étiquette sur la photo la plus claire : ' + hex);
});

test('CT5 aucune couleur de texte blanche ou noire en dur dans un composant, sauf sur un fond sombre propre (voile) ; couleurs de l\'application passées par les jetons', () => {
  const files = ['css/legacy.css', ...fs.readdirSync(path.join(ROOT, 'css/components')).map(f => 'css/components/' + f)];
  const ALLOWED = [/^\.c-ms-tag\{[^}]*background:rgba\(0,0,0,\.6\)/, /^\.c-photo__caption\{[^}]*background:rgba\(33/, /^\.cam /];   // voiles sombres : le texte clair est lu sur un fond sombre fixe
  for (const f of files) for (const rule of read(f).replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const m = /color\s*:\s*(#fff(?:fff)?|white|#000(?:000)?|black)\b/i.exec(rule.replace(/(background|border|outline|box-shadow)[^;]*/gi, ''));
    if (m && !ALLOWED.some(a => a.test(rule.trim()))) assert.fail(f + ' : couleur de texte en dur « ' + m[1] + ' » dans « ' + rule.trim().slice(0, 80) + ' »');
  }
  assert.doesNotMatch(read('css/components/pwa.css').replace(/\/\*[\s\S]*?\*\//g, ''), /#fff|#2b2118|#ffffff/i, 'bandeaux : jetons seulement');
});

/* ---- Chromium : chaque texte visible, chaque écran, les deux thèmes ---- */
const OK = H.available();
/* la bannière d'accueil est animée (fondus de 1,2 s, apparitions en cascade) : on attend la fin des animations avant de mesurer, sinon un texte à moitié transparent fausse le contraste */
const SCENARIOS = [
  ['landing', 'go("landing")', 3200], ['landing-2', 'go("landing"); setTimeout(() => { const d = document.querySelectorAll("[data-hc-go]"); if (d[1]) d[1].click(); }, 600)', 4200], ['landing-3', 'go("landing"); setTimeout(() => { const d = document.querySelectorAll("[data-hc-go]"); if (d[2]) d[2].click(); }, 600)', 4200],
  ['landing-4', 'go("landing"); setTimeout(() => { const d = document.querySelectorAll("[data-hc-go]"); if (d[3]) d[3].click(); }, 600)', 4200],
  ['home', 'go("home")'], ['result', 'go("result"); setTimeout(() => document.querySelectorAll("details").forEach(d => d.open = true), 900)'], ['concern', 'go("concern", "acne")'], ['actives', 'go("actives")'],
  ['scan', 'state.scanStep = 0; go("scan")'], ['scan1', 'state.scanStep = 1; go("scan")'], ['routine', 'go("routine")'], ['products', 'go("products")'],
  ['program', 'go("program"); setTimeout(() => document.querySelectorAll("details").forEach(d => d.open = true), 900)'], ['verif', 'go("verif")'], ['profile', 'go("profile")'],
  ['analyses', 'go("analyses")'], ['progress', 'go("progress")'], ['privacy', 'go("privacy")'], ['login', 'go("login")'], ['signup', 'go("signup")'],
  ['banners', 'go("home"); document.body.insertAdjacentHTML("beforeend", DermaiUpdate.bannerHtml() + DermaiPwa.bannerHtml("ios"))']
];
test('CTB1 Chromium : tous les textes visibles de tous les écrans atteignent le contraste AA, en clair et en sombre', { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 280000 }, async () => {
  const crawl = require('./helpers/contrast-crawl.js');
  const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x').pathname;
    if (u.startsWith('/api/')) { r.writeHead(u === '/api/config-js' ? 200 : 404, { 'Content-Type': 'text/javascript' }); return r.end(u === '/api/config-js' ? 'window.DERMAI_CONFIG={};' : ''); }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    const ext = path.extname(f).slice(1), types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', ico: 'image/x-icon', svg: 'image/svg+xml' };
    r.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await H.loadPlaywright().chromium.launch(), failures = [];
  try {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' }), page = await ctx.newPage();
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base + '/'); await page.addStyleTag({ content: '*{pointer-events:auto!important}' }); await page.waitForSelector('#app'); await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), scheme === 'dark' ? 'rgb(23, 18, 20)' : 'rgb(255, 249, 250)', 'le thème ' + scheme + ' est appliqué');
      for (const [name, code, wait] of SCENARIOS) {
        await page.evaluate(c => { try { (0, eval)(c); } catch (e) { /* écran indisponible hors compte */ } }, code);
        await page.waitForTimeout(wait || 1300);
        const found = await page.evaluate(crawl.fn);
        for (const f of found.filter(x => !x.skip)) failures.push(`${scheme}:${name} ${f.ratio}/${f.need} ${f.fg} sur ${f.bg} | ${f.path} | « ${f.t} »`);
      }
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  assert.deepEqual([...new Set(failures)], [], 'contrastes insuffisants');
});
