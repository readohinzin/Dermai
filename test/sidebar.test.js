'use strict';
/* Barre latérale (js/sidebar.js) : contenu, destinations, état actif, indicateur « Nouveau », câblage dans l'application. Tests sans navigateur ;
   le comportement réel (ouverture, fermeture, clavier, 420 px) est dans test/sidebar-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const SB = require('../js/sidebar.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const app = read('js/app.js');
const SCREENS = new Set([...app.matchAll(/^V\.([a-z]+)=/gm)].map(m => m[1]));
const RESTORABLE = new Set([...app.match(/const RESTORABLE=new Set\(\[([^\]]*)\]/)[1].matchAll(/`([a-z]+)`/g)].map(m => m[1]));
const mk = (route = 'home', extra = {}) => SB.create(Object.assign({ route: () => route, ic: n => `<svg data-i="${n}"></svg>`, brand: h => `<button class="brand" data-go="landing" data-h="${h}"></button>`, initial: () => 'C', now: () => Date.parse('2026-10-20T00:00:00Z') }, extra));
const labels = html => [...html.matchAll(/<span class="sidebar__text">([^<]*)<\/span>/g)].map(m => m[1]);
const decode = s => s.replace(/&#39;/g, '\'').replace(/&amp;/g, '&');

test('SB1 entrées : uniquement des écrans qui existent, restaurables par l\'adresse, sans doublon ni lien inventé', () => {
  const all = SB.ITEMS.concat(SB.OTHERS);
  assert.deepEqual(all.map(i => i.label), ['Tableau de bord', 'Analyser ma peau', 'Mes analyses', 'DERMAI Évolution', 'Programme de soins', 'Ma routine', 'Profil et paramètres']);
  for (const i of all) {
    assert.ok(SCREENS.has(i.go), `${i.label} : l'écran « ${i.go} » existe dans app.js`);
    assert.ok(RESTORABLE.has(i.go) || i.go === 'scan', `${i.label} : l'adresse de « ${i.go} » est restaurable`);
    i.routes.forEach(r => assert.ok(SCREENS.has(r), `route ${r} connue`));
    assert.ok(i.routes.includes(i.go), `${i.label} : son écran fait partie de ses routes`);
    assert.ok(i.label.length <= 22, `libellé court : ${i.label}`);
  }
  assert.equal(new Set(all.map(i => i.id)).size, all.length); assert.equal(new Set(all.map(i => i.go)).size, all.length);
  assert.ok(!all.some(i => /simulation/i.test(i.go + i.label)), 'aucune entrée vers la simulation : son accès est ouvert par le serveur, compte par compte, depuis le résultat');
  assert.deepEqual(SB.OTHERS.map(i => i.id), ['profile']);
});

test('SB2 DERMAI Évolution et le programme de soins sont dans les cinq premières entrées, avec les destinations « progress » et « program »', () => {
  const ids = SB.ITEMS.map(i => i.id);
  assert.ok(ids.indexOf('progress') < 5 && ids.indexOf('program') < 5);
  const h = mk().html();
  assert.match(h, /data-go="progress"[^>]*>(?:(?!<\/button>).)*DERMAI Évolution/s); assert.match(h, /data-go="program"[^>]*>(?:(?!<\/button>).)*Programme de soins/s);
  assert.match(h, /data-go="analyses"[^>]*>(?:(?!<\/button>).)*Mes analyses/s);
  assert.equal((h.match(/class="sidebar__link" data-go="[a-z]+" data-reset="1"/g) || []).length, 7, 'sept entrées, chacune avec le même mécanisme que la barre du bas (data-go + data-reset)');
});

test('SB3 page active : exactement une entrée aria-current pour chaque écran connu, aucune pour un écran inconnu', () => {
  for (const i of SB.ITEMS.concat(SB.OTHERS)) for (const r of i.routes) {
    const h = mk(r).html(), cur = [...h.matchAll(/data-go="([a-z]+)"[^>]*aria-current="page"/g)].map(m => m[1]);
    assert.deepEqual(cur, [i.go], `écran ${r}`);
  }
  assert.ok(!/aria-current/.test(mk('landing').html())); assert.ok(!/aria-current/.test(mk('').html()));
  const routes = SB.ITEMS.concat(SB.OTHERS).flatMap(i => i.routes); assert.equal(new Set(routes).size, routes.length, 'un écran n\'appartient qu\'à une entrée');
  assert.match(mk('concern').html(), /data-go="home"[^>]*aria-current="page"/); assert.match(mk('privacy').html(), /data-go="profile"[^>]*aria-current="page"/); assert.match(mk('active').html(), /data-go="routine"[^>]*aria-current="page"/);
});

test('SB4 « Nouveau » : seulement sur DERMAI Évolution, limité dans le temps, sans stockage', () => {
  const h = mk().html();
  assert.equal((h.match(/Nouveau/g) || []).length, 1);
  assert.match(h, /data-go="progress"[^>]*>(?:(?!<\/button>).)*sidebar__badge">Nouveau/s);
  assert.ok(!/Nouveau/.test(mk('home', { now: () => SB.NEW_UNTIL + 1 }).html()), 'disparaît après la période d\'introduction');
  assert.ok(SB.NEW_UNTIL > Date.parse('2026-10-12T00:00:00Z') && SB.NEW_UNTIL - Date.parse('2026-10-12T00:00:00Z') < 90 * 86400000, 'quelques semaines');
});

test('SB5 structure : colonne latérale, séparation « Autres accès », profil en bas, panneau fermé par défaut, repères pour les technologies d\'assistance', () => {
  const s = mk(), h = s.html();
  assert.match(h, /^<aside class="rail sidebar" id="sidebar" aria-label="Barre latérale">/);
  assert.ok(!/data-open|role="dialog"|aria-modal/.test(h), 'fermé par défaut');
  assert.match(h, /<nav aria-label="Menu principal">/); assert.match(h, /<nav aria-label="Compte">/);
  const [top, foot] = h.split('<div class="sidebar__foot">');
  assert.deepEqual(labels(top).map(decode), ['Tableau de bord', 'Analyser ma peau', 'Mes analyses', 'DERMAI Évolution', 'Programme de soins', 'Ma routine']);
  assert.deepEqual(labels(foot).map(decode), ['Profil et paramètres']); assert.match(foot, /Autres accès/); assert.match(foot, /ne pose pas de diagnostic médical/);
  assert.match(foot, /sidebar__avatar[^>]*>C</, 'initiale du compte');
  assert.match(h, /data-h="52"/, 'logo DERMAI en haut'); assert.ok(h.indexOf('class="brand"') < h.indexOf('Menu principal'));
  assert.match(h, /<button type="button" class="sidebar__close" data-sb="close" aria-label="Fermer le menu">/); assert.match(h, /<div class="sidebar__scrim" data-sb="close" aria-hidden="true"><\/div>/);
  const t = s.toggle();
  assert.match(t, /^<button type="button" class="sidebar__toggle" data-sb="open" aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="false">/);
  assert.ok(!/<a /.test(h), 'des boutons comme dans le reste de la navigation, jamais de lien vide');
  for (const m of h.matchAll(/<button type="button" class="sidebar__link"[^>]*>/g)) assert.match(m[0], /data-go="[a-z]+" data-reset="1"/);
});

test('SB6 aucun accès réseau, stockage ni fournisseur dans le module ; boutons et libellés sans tiret cadratin', () => {
  const src = read('js/sidebar.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|skin-analysis|perfect|youcam|makeupar|supabase|innerHTML\s*=/i.test(src));
  const shown = [...SB.ITEMS, ...SB.OTHERS].map(i => i.label).join(' ') + ' ' + mk().html().replace(/<[^>]+>/g, ' ');
  assert.ok(!/ — | – /.test(shown));
});

test('SB7 câblage : module et feuille chargés une fois, avant l\'application ; ancien rail remplacé ; barre du bas conservée ; app.js sous son plafond', () => {
  const html = read('index.html'), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.equal((html.match(/js\/sidebar\.js/g) || []).length, 1); assert.ok(at('js/sidebar.js') > 0 && at('js/sidebar.js') < at('js/app.js'));
  assert.match(read('css/styles.css'), /@import url\("components\/sidebar\.css"\) layer\(components\);/);
  assert.match(app, /const SB=DermaiSidebar\.create\(\{ic,brand:h=>brandBtn\(h\),route:\(\)=>state\.route,initial:\(\)=>initial\(\)\}\);SB\.attach\(document\);/);
  const shell = app.slice(app.indexOf('function shell('), app.indexOf('const V={}'));
  assert.match(shell, /\$\{SB\.html\(\)\}/); assert.match(shell, /<div class="m-brand">\$\{SB\.toggle\(\)\}\$\{brandBtn\(44\)\}<\/div>/);
  assert.doesNotMatch(shell, /<aside class="rail">/, 'l\'ancien rail à cinq entrées est remplacé');
  assert.match(shell, /<nav class="nav c-bottomnav" aria-label="Navigation principale">\$\{navBtns\(`c-bottomnav__item`\)\}<\/nav>/, 'la barre du bas reste disponible sur mobile');
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000);
});

test('SB8 feuille de style : panneau coulissant sous 920 px, colonne dès 920 px, réduction des mouvements, jetons existants seulement', () => {
  const css = read('css/components/sidebar.css');
  assert.match(css, /\.sidebar\{position:fixed;/); assert.match(css, /transform:translateX\(-102%\);visibility:hidden/); assert.match(css, /\.sidebar\[data-open\]\{transform:none;visibility:visible/);
  assert.match(css, /@media \(min-width:920px\)\{[\s\S]*\.sidebar\{position:sticky;/); assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.sidebar,\.sidebar__scrim\{transition:none\}\}/);
  assert.match(css, /\.sidebar__link\[aria-current="page"\]\{background:var\(--tint\);color:var\(--accent\)/);
  const tokens = new Set([...read('css/tokens.css').matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(tokens.has(m[1]), `jeton ${m[1]} défini`);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'aucune couleur en dur : tout vient de la charte');
  assert.ok(!/@keyframes|animation:/.test(css), 'aucune animation d\'entrée ou de rebond');
});
