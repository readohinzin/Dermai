'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* Garde-fou : l'ancien système de score (rawScore → 100 − raw, niveaux Élevé / Modéré / Faible, note sur 10) ne doit pas revenir dans
   le CHEMIN D'AFFICHAGE : js/app.js (interface) et les feuilles CSS. Les commentaires sont ignorés. js/skin-model.js garde légitimement
   rawScore dans normalized (donnée technique) : seul le retour des anciennes fonctions de dérivation y est interdit. */
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripJs = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const stripCss = src => src.replace(/\/\*[\s\S]*?\*\//g, '');
const APP = stripJs(read('js/app.js'));
const MODEL = stripJs(read('js/skin-model.js'));

test('N1 js/app.js : rawScore jamais lu pour l\'affichage (seulement transmis à l\'historique), aucune formule 100 − score, aucune note sur 10', () => {
  /* Étape 25 : rawScore est enregistré (recordOfScan) et relu (scanOfRecord) pour que le moteur décide comme le jour de l'analyse.
     Nulle part ailleurs dans l'interface : il n'est jamais affiché. */
  const cut = (src, a, b) => src.slice(0, src.indexOf(a)) + src.slice(src.indexOf(b));
  const display = cut(cut(APP, 'function scanOfRecord', 'const reindex='), 'function recordOfScan', 'function isRecordable');
  assert.doesNotMatch(display, /\brawScore\b|\braw_score\b|rawMetrics/);
  assert.equal((APP.match(/\brawScore\b/g) || []).length, 2, 'exactement : enregistrement et relecture');
  assert.doesNotMatch(APP, /\b100\s*-\s*(?:s\b|s\[|v\b|a\b|raw|x\b|m\b|score)/i, '100 - <score>');
  assert.doesNotMatch(APP, /\(\s*\w+\s*\/\s*10\s*\)\s*\.toFixed|\/10\b/, 'note sur 10');
});

test('N2 js/app.js : plus d\'ancien niveau ni d\'ancienne aide de classement', () => {
  assert.doesNotMatch(APP, /Élevé|Modéré|Faible/);
  assert.doesNotMatch(APP, /\btierOf\b|\bamount\s*\(|\bverdict\s*\(|\branked\s*\(|\blvl\s*\(|\blbar\b|\bLV\b/);
  assert.doesNotMatch(APP, /concernScore|deriveConcern|toDisplay|demoNormalized/);
});

test('N3 js/app.js : les scores affichés viennent de SkinModel (toResultView, compareScans, globalSeries)', () => {
  assert.match(APP, /SkinModel\.toResultView\(/);
  assert.match(APP, /SkinModel\.compareScans\(/);
  assert.match(APP, /SkinModel\.globalSeries\(/);
});

test('N4 démo : les analyses fictives passent par le même chemin que les réelles (uiScore → sanitizeNormalized → normalized)', () => {
  assert.match(APP, /const demoScan=/);
  assert.match(APP, /SkinModel\.sanitizeNormalized\(/);
  const demo = APP.slice(APP.indexOf('const demoScan='), APP.indexOf('const CONCERNS='));
  assert.match(demo, /uiScore/);
  assert.doesNotMatch(demo, /100\s*-/, 'aucune transformation 100 - ancienneValeur');
});

test('N5 js/skin-model.js : les anciennes fonctions de dérivation ne reviennent pas', () => {
  assert.doesNotMatch(MODEL, /concernScore|deriveConcern|toDisplay|\bUI_KEYS\b/);
});

test('N6 CSS : les classes de l\'ancien système de niveaux n\'existent plus', () => {
  for (const f of ['css/legacy.css', 'css/styles.css', ...fs.readdirSync(path.join(ROOT, 'css/components')).map(x => 'css/components/' + x)]) {
    const css = stripCss(read(f));
    assert.doesNotMatch(css, /\.(?:lvl|lb|prio|prio-top|prio-sub|mini|ex|lv-change|dbl)(?![\w-])/, f);
  }
});
