'use strict';
/* Apparence : clair, sombre, automatique. Choix gardé sur l'appareil, posé avant l'affichage, suit le téléphone, barre du navigateur assortie. Icônes de l'en-tête (head). Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Th = require('../js/theme.js');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
function fakeDoc(metas = 2) {
  const attrs = {}, list = Array.from({ length: metas }, (_, i) => ({ attrs: { content: i ? '#171214' : '#FFF9FA', media: i ? '(prefers-color-scheme: dark)' : '(prefers-color-scheme: light)' }, removed: false, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, remove() { this.removed = true; } }));
  const clicks = [];
  return { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, attrs }, querySelectorAll: sel => (sel.includes('theme-color') ? list.filter(m => !m.removed) : []), addEventListener: (t, fn) => clicks.push([t, fn]), metas: list, clicks };
}
const win = dark => ({ matchMedia: () => ({ matches: dark, addEventListener() {} }) });

test('TH1 trois modes : automatique par défaut, clair et sombre gardés sur l\'appareil, valeur corrompue ou stockage refusé = automatique', () => {
  assert.deepEqual(Th.MODES, ['system', 'light', 'dark']); assert.equal(Th.read(store()), 'system');
  const s = store(); assert.equal(Th.write(s, 'dark'), true); assert.equal(s.m.get('dermai.theme'), 'dark'); assert.equal(Th.read(s), 'dark');
  assert.equal(Th.write(s, 'system'), true); assert.equal(s.m.has('dermai.theme'), false, 'automatique : rien n\'est gardé');
  for (const bad of ['', 'blue', 'DARK', '1']) assert.equal(Th.read(store({ 'dermai.theme': bad })), 'system', bad);
  assert.equal(Th.write(s, 'blue'), false);
  const refuse = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.equal(Th.read(refuse), 'system'); assert.equal(Th.write(refuse, 'dark'), false);
  const d = fakeDoc(); assert.equal(Th.set('dark', d, win(false), refuse), 'dark'); assert.equal(Th.get(refuse), 'dark', 'le choix vaut pour la visite'); Th.set('system', d, win(false), refuse); assert.equal(Th.get(refuse), 'system');
});

test('TH2 thème affiché : le choix l\'emporte, sinon le réglage du système ; attribut sur <html> et barre du navigateur assortie', () => {
  assert.equal(Th.effective('light', true), 'light'); assert.equal(Th.effective('dark', false), 'dark'); assert.equal(Th.effective('system', true), 'dark'); assert.equal(Th.effective('system', false), 'light');
  const d = fakeDoc();
  assert.equal(Th.apply(d, win(true), 'light'), 'light'); assert.equal(d.documentElement.attrs['data-theme'], 'light'); assert.equal(d.metas[0].attrs.content, '#FFF9FA'); assert.equal(d.metas[0].attrs.media, undefined); assert.equal(d.metas[1].removed, true);
  const e = fakeDoc(); assert.equal(Th.apply(e, win(false), 'dark'), 'dark'); assert.equal(e.documentElement.attrs['data-theme'], 'dark'); assert.equal(e.metas[0].attrs.content, '#171214');
  const f = fakeDoc(); assert.equal(Th.apply(f, win(true), 'system'), 'dark'); assert.equal('data-theme' in f.documentElement.attrs, false, 'automatique : aucun attribut, le CSS suit le système'); assert.equal(f.metas[0].attrs.content, '#171214');
  assert.equal(Th.BAR.light, '#FFF9FA'); assert.equal(Th.BAR.dark, '#171214');
  assert.match(read('css/tokens.css'), /--bg:#FFF9FA;/); assert.match(read('css/tokens.css'), /--bg:#171214;/);
});

test('TH3 sélecteur : trois boutons radio accessibles, choix marqué par aria-checked, variante compacte pour la barre latérale', () => {
  const h = Th.picker('dark'); assert.equal((h.match(/role="radio"/g) || []).length, 3); assert.equal((h.match(/aria-checked="true"/g) || []).length, 1);
  assert.match(h, /data-theme-set="dark"[^>]*>Sombre/); assert.match(h, /Automatique/); assert.match(h, /Clair/); assert.match(h, /role="radiogroup"/);
  const c = Th.compact('light'); assert.match(c, /c-theme--compact/); assert.equal((c.match(/role="radio"/g) || []).length, 3); assert.ok(!/[—–]/.test(h + c));
  const css = read('css/components/pwa.css'); assert.match(css, /\.c-theme__opt\[aria-checked="true"\]::before\{content:"\\2713/, 'le choix se voit aussi par une coche, pas seulement par la couleur'); assert.match(css, /\.c-theme__opt\{min-height:44px/);
});

test('TH4 câblage : script posé dans <head> avant l\'affichage, métadonnées de couleur, module avant app.js, sélecteur dans le profil et la barre latérale ; app.js inchangé en taille', () => {
  const h = read('index.html'); assert.ok(h.indexOf('dermai.theme') > 0 && h.indexOf('dermai.theme') < h.indexOf('<link rel="stylesheet" href="css/styles.css">'), 'posé avant la feuille de style : aucun éclair clair');
  assert.match(h, /<meta name="color-scheme" content="light dark">/); assert.match(h, /name="theme-color" content="#FFF9FA" media="\(prefers-color-scheme: light\)"/); assert.match(h, /name="theme-color" content="#171214" media="\(prefers-color-scheme: dark\)"/);
  assert.ok(h.indexOf('js/theme.js') < h.indexOf('js/app.js') && h.indexOf('js/theme.js') < h.indexOf('js/sidebar.js'));
  const app = read('js/app.js'); assert.match(app, /\$\{TN\.picker\(\)\}\$\{DermaiTheme\.picker\(\)\}\$\{marketSection\(\)\}/); assert.equal(Buffer.byteLength(app), 149502);
  assert.match(read('js/sidebar.js'), /DermaiTheme\.compact\(\)/);
  assert.doesNotMatch(read('js/theme.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|sendBeacon|sessionStorage|indexedDB|cookie/);
});

test('TH5 logo lisible en sombre : fin contour blanc qui suit le dessin (aucun fond) ; aucun contour en clair', () => {
  const css = read('css/tokens.css'); assert.match(css, /--logo-edge:none;/); assert.equal((css.match(/--logo-edge:drop-shadow\(1\.5px 0 0 #fff\) drop-shadow\(-1\.5px 0 0 #fff\) drop-shadow\(0 1\.5px 0 #fff\) drop-shadow\(0 -1\.5px 0 #fff\);/g) || []).length, 2, 'même contour dans les deux écritures du thème sombre');
  assert.ok(!/logo-plate|logo-pad/.test(css), 'plus de plaque blanche');
  assert.match(read('css/components/nav.css'), /\.brand \.brand-logo\{[^}]*filter:var\(--logo-edge\)/);
for (const f of ['img/brand/dermai-logo-360.webp', 'img/brand/dermai-mark-256.webp']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('TH6 icônes dans l\'en-tête du document : favicon multi-tailles, PNG 16, 32, 48, 192, 512, icône iPhone 180, tailles réelles = tailles déclarées', () => {
  const h = read('index.html'), links = [...h.matchAll(/<link rel="(icon|apple-touch-icon)"([^>]*)>/g)].map(m => m[2]);
  const want = { '16x16': 16, '32x32': 32, '48x48': 48, '192x192': 192, '512x512': 512 };
  for (const [size, px] of Object.entries(want)) { const l = links.find(x => x.includes('sizes="' + size + '"')); assert.ok(l, 'lien ' + size); const src = /href="\/([^"]+)"/.exec(l)[1]; assert.deepEqual(png(src), [px, px], src); }
  assert.ok(links.some(x => /href="\/favicon\.ico"/.test(x)) && links.some(x => /href="\/apple-touch-icon\.png"/.test(x)));
  assert.deepEqual(png('apple-touch-icon.png'), [180, 180]);
  const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico')); assert.equal(ico.readUInt16LE(2), 1); assert.ok(ico.readUInt16LE(4) >= 4, 'au moins 4 tailles dans le favicon');
});
