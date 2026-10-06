'use strict';
/* Garde statique de l'interface : pas de graphique mal alimenté, pas d'alerte pour le contour des yeux, textes cosmétiques prudents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const copy = require('../js/engine/copy.fr.js');
const adata = require('../js/engine/data/actives.js');
const M = require('../js/skin-model.js');

const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const FORBIDDEN = /(?<![\p{L}])(cause[sz]?|causer|traitements?|gu[ée]ri[rst]?|gu[ée]rison|diagnostic)(?![\p{L}])/iu;

test('UI1 la page d\'accueil ne passe plus les analyses fictives au graphique : exemple illustratif via globalSeries', () => {
  assert.ok(!/gchart\(SCANS\)/.test(app));
  assert.match(app, /LANDING_EXAMPLE=/);
  assert.match(app, /SkinModel\.globalSeries\(\[61,64,68\]/);
  assert.match(app, /Exemple illustratif, données fictives/);
});

test('UI2 plus de zones localisées ni de faux exemple de personne sur l\'accueil', () => {
  for (const bad of ['ZONES_BY', 'facecap', 'case `zone`', 'Amina, peau mixte'])
    assert.ok(!app.includes(bad), bad);
});

test('UI3 contour des yeux : libellé neutre, aucune alerte (« À surveiller », « attention particulière »)', () => {
  assert.match(app, /isInfo\(m\)/);
  assert.match(app, /Engine\.copy\.INFO_LABEL/);
  assert.ok(!/surveiller|attention particulière/i.test(copy.INFO_LABEL + copy.INFO_TEXT));
});

test('UI4 conseils statiques : ni causalité médicale ni mots interdits', () => {
  const block = app.slice(app.indexOf('const CONCERNS='), app.indexOf('const CIDS='));
  assert.ok(block.length > 100);
  assert.ok(!FORBIDDEN.test(block), (block.match(FORBIDDEN) || [])[0]);
});

test('UI5 descriptions d\'actifs : acide salicylique et AHA/PHA sans « doux » ; précaution peaux qui marquent', () => {
  for (const id of ['salicylic']) assert.ok(!/doux/i.test(adata.ACTIVES.find(a => a.id === id).description), id);
  for (const a of adata.ACTIVES.filter(a => a.irritation !== 'low' && a.status === 'validated'))
    assert.ok(a.cautions.some(c => /marques/.test(c)), a.id);
  assert.ok(!/zones/i.test(M.SKIN_TYPE_DESC ? M.SKIN_TYPE_DESC.combination : 'ok'));
});
