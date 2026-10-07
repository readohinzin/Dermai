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
