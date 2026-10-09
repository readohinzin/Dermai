'use strict';
/* Logo DERMAI : fichiers du projet (fond transparent, WebP), intégration accessible, favicon et icône iOS. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const buf = f => fs.readFileSync(path.join(root, f));

/* Dimensions et transparence lues dans l'en-tête du fichier (RIFF/WEBP VP8X : bit alpha, taille du canevas). */
function webp(f) {
  const b = buf(f);
  assert.equal(b.slice(0, 4).toString('latin1'), 'RIFF', f); assert.equal(b.slice(8, 12).toString('latin1'), 'WEBP', f);
  const kind = b.slice(12, 16).toString('latin1');
  if (kind === 'VP8X') return { alpha: (b[20] & 0x10) !== 0, w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), size: b.length };
  return { alpha: kind === 'VP8L', w: 0, h: 0, size: b.length };
}
function png(f) { const b = buf(f); assert.equal(b.slice(1, 4).toString('latin1'), 'PNG', f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length }; }

test('B1 logo : mot « dermai. » et « d » seul, WebP à fond transparent, recadrés, légers', () => {
  const logo = webp('img/brand/dermai-logo-360.webp'), mark = webp('img/brand/dermai-mark-256.webp');
  assert.ok(logo.alpha && mark.alpha, 'fond transparent');
  assert.equal(logo.w, 360); assert.ok(Math.abs(logo.w / logo.h - 360 / 125) < 0.02, 'proportions du mot');
  assert.ok(Math.abs(mark.w / mark.h - 261 / 320) < 0.01, 'proportions du « d »');
  assert.ok(logo.size < 30000 && mark.size < 30000, 'poids léger');
});

test('B2 icônes : favicon (ico et png 32), icône iOS 180 px, déclarées dans index.html', () => {
  const ico = buf('favicon.ico'); assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1); assert.ok(ico.readUInt16LE(4) >= 2, 'plusieurs tailles');
  const f32 = png('img/brand/favicon-32.png'); assert.deepEqual([f32.w, f32.h], [32, 32]);
  const ios = png('apple-touch-icon.png'); assert.deepEqual([ios.w, ios.h], [180, 180]);
  const html = read('index.html');
  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\/img\/brand\/favicon-32\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="theme-color" content="#FFF9FA">/);
});

test('B3 intégration : bouton accessible, image décorative aux dimensions fixes, aucun logo en texte, aucune ressource distante', () => {
  const app = read('js/app.js'), css = read('css/components/nav.css');
  assert.match(app, /const brandBtn=h=>`<button class="brand" type="button" data-go="landing" data-reset="1" aria-label="DERMAI, page d'accueil"><img class="brand-logo" src="img\/brand\/dermai-logo-360\.webp" width="\$\{Math\.round\(h\*BRAND_AR\)\}" height="\$\{h\}" alt="" decoding="async"><\/button>`/);
  assert.match(app, /src="img\/brand\/dermai-mark-256\.webp"/);
  assert.doesNotMatch(app, />DERMAI<\/button>/);
  assert.match(css, /\.brand \.brand-logo\{[^}]*max-width:100%[^}]*height:auto\}/);
  assert.doesNotMatch(css.match(/\.brand \.brand-logo\{[^}]*\}/)[0], /width:auto/, 'ne pas écraser la largeur déclarée');
  assert.match(css, /button\.brand\{[^}]*min-height:var\(--tap\)/, 'zone de toucher conservée');
  assert.ok(!/https?:\/\/[^"'\s)]*dermai[^"'\s)]*\.(webp|png)/i.test(app), 'logo servi par le projet');
});

test('B4 titre et aperçu de lien : plus de « maquette », description, Open Graph avec une image de partage CARRÉE (le D seul, vignette compacte dans WhatsApp)', () => {
  const html = read('index.html');
  assert.match(html, /<title>DERMAI, analyse de peau et routine personnalisée<\/title>/);
  assert.doesNotMatch(html, /maquette/i);
  assert.match(html, /<meta name="description" content="[^"]{60,200}">/);
  for (const re of [/property="og:title"/, /property="og:description"/, /property="og:type" content="website"/, /property="og:locale" content="fr_FR"/, /name="twitter:card" content="summary">/]) assert.match(html, re);
  assert.doesNotMatch(html, /summary_large_image/, 'plus de grande carte : le logo complet en bandeau n\'est plus l\'image de partage');
  const img = html.match(/property="og:image" content="(https:\/\/[^"]+)"/)[1];
  assert.equal(new URL(img).pathname, '/img/brand/og-square-512.jpg');
  const jpg = buf('img/brand/og-square-512.jpg');
  assert.equal(jpg[0], 0xff); assert.equal(jpg[1], 0xd8);
  assert.ok(jpg.length < 300000, 'léger (< 300 Ko) pour les aperçus de messagerie');
  // dimensions réelles lues dans le fichier : carrées, et identiques à celles déclarées
  let i = 2, w = 0, h = 0;
  while (i < jpg.length) { if (jpg[i] !== 0xff) { i++; continue; } const m = jpg[i + 1]; if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { h = jpg.readUInt16BE(i + 5); w = jpg.readUInt16BE(i + 7); break; } i += 2 + jpg.readUInt16BE(i + 2); }
  assert.equal(w, h, 'image carrée : ' + w + 'x' + h); assert.ok(w >= 300 && w <= 1200, 'assez grande pour être nette, assez petite pour la vignette : ' + w);
  assert.match(html, new RegExp('property="og:image:width" content="' + w + '"')); assert.match(html, new RegExp('property="og:image:height" content="' + h + '"'));
  assert.match(html, /property="og:image:type" content="image\/jpeg"/);
  // aucun texte visible « maquette » dans l'application, ni dans le README
  assert.doesNotMatch(read('js/app.js').replace(/\/\*[\s\S]*?\*\//g, ''), /maquette/i);
  assert.doesNotMatch(read('README.md').split('\n').slice(0, 5).join('\n'), /maquette/i);
});
