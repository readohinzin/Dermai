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
  assert.deepEqual(all.map(i => i.label), ['Tableau de bord', 'Analyser ma peau', 'Mes analyses', 'DERMAI Évolution', 'Programme de soins', 'Vérif\'Routine', 'Simulation cosmétique', 'Studio Beauté', 'Ma routine', 'Profil et paramètres']);
  for (const i of all) {
    assert.ok(SCREENS.has(i.go), `${i.label} : l'écran « ${i.go} » existe dans app.js`);
    assert.ok(RESTORABLE.has(i.go) || i.go === 'scan' || i.when, `${i.label} : l'adresse de « ${i.go} » est restaurable (sauf la simulation, qui exige le contexte d'une analyse)`);
    i.routes.forEach(r => assert.ok(SCREENS.has(r), `route ${r} connue`));
    assert.ok(i.routes.includes(i.go), `${i.label} : son écran fait partie de ses routes`);
    assert.ok(i.label.length <= 22, `libellé court : ${i.label}`);
  }
  assert.equal(new Set(all.map(i => i.id)).size, all.length); assert.equal(new Set(all.map(i => i.go)).size, all.length);
  assert.deepEqual(all.filter(i => i.when).map(i => i.id), ['simulation', 'studio'], 'seules la simulation et le Studio Beauté sont conditionnels');
  assert.ok(!/Studio/.test(mk().html()) && !/Studio/.test(mk('home', { studio: () => false }).html()) && !/Studio/.test(mk('home', { studio: () => { throw new Error('x'); } }).html()), 'Studio fermé, inconnu ou en erreur : aucune entrée');
  const st = mk('home', { studio: () => true }).html(); assert.match(st, /data-go="studio" data-reset="1"[^>]*>(?:(?!<\/button>).)*Studio Beauté/s); assert.deepEqual(labels(mk('home', { simulation: () => true, studio: () => true }).html()).map(decode).slice(4, 9), ['Programme de soins', 'Vérif\'Routine', 'Simulation cosmétique', 'Studio Beauté', 'Ma routine']);
  assert.ok(!/simulation/i.test(mk().html()), 'simulation fermée ou inconnue : aucune entrée');
  assert.ok(!/simulation/i.test(mk('home', { simulation: () => false }).html()));
  assert.ok(!/simulation/i.test(mk('home', { simulation: () => { throw new Error('x'); } }).html()), 'une erreur de vérification n\'ouvre jamais l\'entrée');
  const open = mk('home', { simulation: () => true }).html();
  assert.match(open, /data-go="simulation" data-reset="1"[^>]*>(?:(?!<\/button>).)*Simulation cosmétique/s);
  assert.deepEqual(labels(open).map(decode).slice(4, 8), ['Programme de soins', 'Vérif\'Routine', 'Simulation cosmétique', 'Ma routine']);
  assert.equal((open.match(/Nouveau/g) || []).length, 1, 'le badge reste réservé à Évolution');
  assert.deepEqual(SB.OTHERS.map(i => i.id), ['profile']);
});

test('SB2 DERMAI Évolution et le programme de soins sont dans les cinq premières entrées, avec les destinations « progress » et « program »', () => {
  const ids = SB.ITEMS.map(i => i.id);
  assert.ok(ids.indexOf('progress') < 5 && ids.indexOf('program') < 5);
  const h = mk().html();
  assert.match(h, /data-go="progress"[^>]*>(?:(?!<\/button>).)*DERMAI Évolution/s); assert.match(h, /data-go="program"[^>]*>(?:(?!<\/button>).)*Programme de soins/s);
  assert.match(h, /data-go="analyses"[^>]*>(?:(?!<\/button>).)*Mes analyses/s);
  assert.equal((h.match(/class="sidebar__link" data-go="[a-z]+" data-reset="1"/g) || []).length, 8, 'huit entrées, chacune avec le même mécanisme que la barre du bas (data-go + data-reset)');
});

test('SB3 page active : exactement une entrée aria-current pour chaque écran connu, aucune pour un écran inconnu', () => {
  for (const i of SB.ITEMS.concat(SB.OTHERS)) for (const r of i.routes) {
    const h = mk(r, { simulation: () => true, studio: () => true }).html(), cur = [...h.matchAll(/data-go="([a-z]+)"[^>]*aria-current="page"/g)].map(m => m[1]);
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
  assert.deepEqual(labels(top).map(decode), ['Tableau de bord', 'Analyser ma peau', 'Mes analyses', 'DERMAI Évolution', 'Programme de soins', 'Vérif\'Routine', 'Ma routine']);
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
  assert.match(app, /const SB=DermaiSidebar\.create\(\{ic,brand:h=>brandBtn\(h\),route:\(\)=>state\.route,initial:\(\)=>initial\(\),signedIn:\(\)=>signedIn\(\),simulation:\(\)=>\{SIM\.probe\(\);return SIM\.state\(\)\.avail===`yes`&&!noReal\(\)\},studio:\(\)=>ST\.ready\(\)\}\);SB\.attach\(document\);/);
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

test('SB9 « Se déconnecter » : sous « Autres accès », après le profil, pour un compte connecté seulement, avec l\'action de déconnexion existante', () => {
  const closed = mk().html();
  assert.ok(!/Se déconnecter|data-act="logout"/.test(closed), 'visiteur, démonstration ou vérification en cours : aucune entrée');
  assert.ok(!/Se déconnecter/.test(mk('home', { signedIn: () => false }).html()));
  assert.ok(!/Se déconnecter/.test(mk('home', { signedIn: () => { throw new Error('x'); } }).html()), 'une erreur n\'affiche jamais l\'entrée');
  const h = mk('home', { signedIn: () => true }).html(), [top, foot] = h.split('<div class="sidebar__foot">');
  assert.ok(!/Se déconnecter/.test(top), 'pas dans la navigation principale');
  assert.deepEqual(labels(foot).map(decode), ['Profil et paramètres', 'Se déconnecter']);
  assert.match(foot, /Autres accès/); assert.ok(foot.indexOf('Autres accès') < foot.indexOf('Profil et paramètres') && foot.indexOf('Profil et paramètres') < foot.indexOf('Se déconnecter'));
  assert.match(foot, /<button type="button" class="sidebar__link" data-act="logout"><svg data-i="out"><\/svg><span class="sidebar__text">Se déconnecter<\/span><\/button>/);
  assert.ok(!/data-act="logout"[^>]*data-go|data-go[^>]*data-act="logout"/.test(h), 'une action, pas une navigation');
  assert.equal((h.match(/data-act="logout"/g) || []).length, 1);
  assert.ok(!/aria-current/.test(mk('profile', { signedIn: () => true }).html().split('data-act="logout"')[1].split('</button>')[0]), 'jamais marquée comme page active');
  const src = read('js/sidebar.js'); assert.match(src, /#sidebar \[data-act\]/, 'le panneau mobile se referme aussi après cette action');
  assert.match(app, /case `logout`:logout\(\);break;/, 'l\'action existe dans l\'application');
});

test('SB9 bouton d\'ouverture : icône « panneau latéral » (cadre arrondi dont la partie gauche est pleine) dans un carré aux coins arrondis, à la couleur d\'accent ; plus les trois traits', () => {
  const t = mk('home').toggle();
  assert.match(t, /<rect x="3" y="5" width="18" height="14" rx="3.5"\/>/); assert.match(t, /<path d="M3 8\.5A3\.5 3\.5 0 0 1 6\.5 5H11v14H6\.5A3\.5 3\.5 0 0 1 3 15\.5z" fill="currentColor" stroke="none"\/>/);
  assert.ok(!/M4 7h16M4 12h16M4 17h16/.test(t), 'plus de menu à trois traits');
  assert.match(t, /aria-label="Ouvrir le menu"/); assert.match(t, /aria-controls="sidebar"/); assert.match(t, /data-sb="open"/);
  const css = read('css/components/sidebar.css');
  assert.match(css, /\.sidebar__toggle\{border:1\.5px solid color-mix\(in srgb,var\(--accent\) 45%,transparent\);border-radius:var\(--r-sm\);color:var\(--accent\)\}/);
});
