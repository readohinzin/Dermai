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

test('LF3 bouton d\'analyse (téléphone) : cercle de 60 px centré en bas au-dessus de la zone sûre, icône sans texte, absent dès 920 px ; plus aucune règle de l\'ancienne barre à cinq onglets', () => {
  const nav = read('css/components/nav.css'), legacy = read('css/legacy.css');
  const rule = nav.match(/\.c-scanfab\{[^}]*\}/)[0];
  assert.match(rule, /position:fixed;left:50%;bottom:calc\(16px \+ env\(safe-area-inset-bottom,0px\)\)/); assert.match(rule, /width:60px;height:60px/); assert.match(rule, /border-radius:50%/); assert.match(rule, /transform:translateX\(-50%\)/);
  assert.match(rule, /z-index:var\(--z-nav\)/, 'sous le menu (z-sheet) et le message (z-toast)');
  assert.match(nav, /@media \(min-width:920px\)\{\.c-scanfab\{display:none\}\}/);
  assert.match(nav, /\.c-scanfab:focus-visible\{outline:none;box-shadow:var\(--focus-ring\)\}/, 'anneau de focus conservé');
  assert.ok(!/bottomnav/.test(nav) && !/\.nav\b/.test(nav + legacy), 'aucune règle .nav / .c-bottomnav restante');
  assert.match(legacy, /@media \(max-width:919px\)\{\n  \.main\{padding-bottom:136px\}/, 'le contenu garde la place sous le bouton');
  assert.match(legacy, /#toast\{position:fixed;left:50%;bottom:calc\(96px \+ env\(safe-area-inset-bottom,0px\)\)/, 'le message s\'affiche au-dessus du bouton (60 + 16 < 96)');
});
