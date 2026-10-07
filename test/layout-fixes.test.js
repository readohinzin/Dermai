'use strict';
/* Correctifs d'affichage : logo mobile entier sous l'en-tête « retour » ; aucune promesse de photo quand elle n'est jamais conservée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('LF1 logo mobile : l\'en-tête « retour » ne recouvre plus le bas du logo (sa marge haute de -20 px est annulée sous .m-brand)', () => {
  const nav = read('css/components/nav.css'), legacy = read('css/legacy.css');
  assert.match(nav, /\.m-brand\+\.top\{margin-top:0\}/);
  assert.match(legacy, /\.top\{position:sticky;[^}]*margin:-20px -20px 12px/, 'la marge négative historique reste valable partout ailleurs (sans logo au-dessus)');
  assert.match(nav, /@media \(min-width:920px\)\{\.m-brand\{display:none\}\}/);
  assert.ok(read('css/styles.css').indexOf('layer(components)') > 0 && /@import url\("components\/nav\.css"\) layer\(components\)/.test(read('css/styles.css')), 'la règle est dans la couche components, qui l\'emporte sur legacy');
});

test('LF2 mode réel : sans photo (analyse retrouvée, la photo n\'étant jamais conservée), aucun cadre « Votre photo apparaîtra ici » sur l\'accueil, la préoccupation ni le résultat', () => {
  const app = read('js/app.js'), nav = read('css/components/nav.css');
  assert.match(app, /<section class="skin-now\$\{!DEMO_MODE&&!s\.photo\?` nophoto`:``\}">\$\{!DEMO_MODE&&!s\.photo\?``:`<div class="mf">/);
  assert.match(app, /\$\{!DEMO_MODE&&!s\.photo\?``:`<section class="facebox">\$\{portrait\(\{photo:s\.photo\}\)\}<\/section>`\}/);
  assert.match(app, /noPhoto=!DEMO_MODE&&!s\.photo/); assert.match(app, /\$\{noPhoto\?``:`<div class="c-result__photo">/);
  assert.match(nav, /\.skin-now\.nophoto \.txt\{max-width:none\}/);
  // le cadre vide ne subsiste que pour l'écran de scan et d'analyse (photo en attente), jamais pour une analyse enregistrée
  assert.equal((app.match(/Votre photo apparaîtra ici/g) || []).length, 1);
  assert.match(app, /state\.route===`scan`\|\|state\.route===`analyzing`\?state\.realPreview/);
});

test('LF3 barre du bas (téléphone) : le libellé « Progression » ne déborde plus de sa pastille ; la police suit la largeur, les onglets restent ≥ 44 px', () => {
  const nav = read('css/components/nav.css');
  const block = nav.slice(nav.indexOf('@media (max-width:480px){\n  .nav.c-bottomnav'));
  assert.match(block, /\.nav\.c-bottomnav\{left:8px;right:8px;padding:4px;gap:2px\}/);
  assert.match(block, /\.c-bottomnav__item\{padding-inline:0;font-size:clamp\(9\.2px,calc\(\(100vw - 82px\) \/ 29\.5\),12px\)\}/);
  // la règle suit la définition de base de l'onglet (même spécificité : la dernière l'emporte) et garde sa hauteur tactile
  assert.ok(nav.indexOf('.c-bottomnav__item{display:flex') < nav.indexOf('clamp(9.2px'));
  assert.match(nav, /\.c-bottomnav__item\{[^}]*min-height:52px;min-width:var\(--tap\)/);
  // calcul : pour chaque largeur de téléphone, le libellé actif (≈ 5,9 × taille, Manrope 700) tient dans l'onglet avec une marge
  for (const w of [320, 360, 375, 390, 414, 430, 480]) {
    const f = Math.min(12, Math.max(9.2, (w - 82) / 29.5)), item = (w - 16 - 8 - 8) / 5, label = 5.86 * f;
    assert.ok(item - label >= (w <= 320 ? 3 : 8), w + ' px : onglet ' + item.toFixed(1) + ' px pour un libellé de ' + label.toFixed(1) + ' px');
  }
});
