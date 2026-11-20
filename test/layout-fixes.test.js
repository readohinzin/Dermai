'use strict';
/* Correctifs d'affichage : logo mobile entier sous l'en-tête « retour » ; aucune promesse de photo quand elle n'est jamais conservée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('LF1 logo mobile : l\'en-tête « retour » ne recouvre plus le bas du logo (sa marge haute de -20 px est annulée sous .m-brand)', () => {
  const nav = read('css/components/nav.css'), legacy = read('css/legacy.css');
  assert.match(nav, /\.m-brand\+\.top\{margin-top:-12px;top:calc\(env\(safe-area-inset-top,0px\) \+ var\(--mbrand-h\)\)\}/, 'sous le logo, la marge haute de -20 px est annulée (la marge basse de 12 px du logo la remplace) et l\'en-tête retour se fige sous le logo');
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

test('LF3 plus de bouton d\'analyse flottant : ni dans l\'application, ni dans les feuilles de style ; le contenu et le message ne gardent plus de place sous lui', () => {
  const nav = read('css/components/nav.css'), legacy = read('css/legacy.css');
  assert.ok(!/scanfab/.test(read('js/app.js') + nav + legacy + read('css/components/pwa.css')), 'aucune trace du bouton rond');
  assert.ok(!/bottomnav/.test(nav) && !/\.nav\b/.test(nav + legacy), 'aucune règle .nav / .c-bottomnav restante');
  assert.match(legacy, /@media \(max-width:919px\)\{\n  \.main\{padding-bottom:calc\(48px \+ env\(safe-area-inset-bottom,0px\)\)\}/, 'le contenu s\'arrête au bord, au-dessus de la barre d\'accueil');
  assert.match(legacy, /#toast\{position:fixed;left:50%;bottom:calc\(32px \+ env\(safe-area-inset-bottom,0px\)\)/);
});
