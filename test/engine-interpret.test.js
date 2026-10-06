'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, Engine, norm } = require('./helpers/engine.js');
const { interpret, parseSkinType } = require('../js/engine/interpret.js');
const D = require('../js/engine/data/indicators.js');

test('I1 les 15 indicateurs de skin-model.js sont interprétés, avec id, label, score, bande, domaine, actionnabilité, confiance', () => {
  const r = interpret(norm({ pores: 48 }));
  assert.deepEqual(r.indicators.map(i => i.id), M.METRIC_KEYS);
  for (const i of r.indicators) {
    for (const f of ['id', 'label', 'score', 'band', 'domain', 'actionability', 'confidence']) assert.ok(f in i, `${i.id}.${f}`);
    assert.ok(D.DOMAINS.includes(i.domain), i.id);
    assert.ok(['actionable', 'informative'].includes(i.actionability));
  }
  const p = r.indicators.find(i => i.id === 'pores');
  assert.deepEqual([p.score, p.band, p.domain, p.actionability, p.confidence], [48, 'mid', 'oil_pores', 'actionable', 'medium']);
});

test('I2 domaines : regroupements prévus, le contour des yeux est informatif, aucun score de domaine n\'existe', () => {
  const dom = Object.fromEntries(interpret(norm()).indicators.map(i => [i.id, i.domain]));
  assert.deepEqual(dom, { acne: 'blemishes', pores: 'oil_pores', oiliness: 'oil_pores', texture: 'texture', hydration: 'hydration', redness: 'redness_comfort',
    pigmentation: 'tone', wrinkles: 'aging', firmness: 'aging', radiance: 'tone', eyeBag: 'eye_contour', tearTrough: 'eye_contour', darkCircle: 'eye_contour',
    droopyUpperEyelid: 'eye_contour', droopyLowerEyelid: 'eye_contour' });
  for (const i of interpret(norm()).indicators) assert.equal(i.actionability, i.domain === 'eye_contour' ? 'informative' : 'actionable', i.id);
  const r = interpret(norm());
  for (const bad of ['domains', 'domainScore', 'average', 'min', 'max']) assert.equal(bad in r, false, bad);
});

test('I3 uiScore uniquement : rawScore n\'a aucun effet, un uiScore invalide ou hors plage donne « indisponible » (jamais 0)', () => {
  const a = interpret(norm({ acne: 40 }, { raw: 3 })), b = interpret(norm({ acne: 40 }, { raw: 97 }));
  assert.deepEqual(a, b);
  for (const bad of [null, undefined, 'x', NaN, -5, 140]) {
    const i = interpret(norm({ acne: bad })).indicators.find(x => x.id === 'acne');
    assert.deepEqual([i.score, i.band, i.available], [null, null, false], String(bad));
  }
  assert.equal(JSON.stringify(interpret(norm({ acne: null }))).includes('NaN'), false);
});

test('I4 type de peau : les 8 valeurs sont reconnues, base et mode « rougeurs » correctement lus, valeur inconnue → null', () => {
  const cases = { Normal: ['normal', false], Oily: ['oily', false], Dry: ['dry', false], Combination: ['combination', false], Redness: [null, true],
    'Dry & Redness': ['dry', true], 'Oily & Redness': ['oily', true], 'Combination & Redness': ['combination', true] };
  for (const [whole, [base, redness]] of Object.entries(cases)) {
    const s = parseSkinType(whole);
    assert.deepEqual([s.base, s.redness], [base, redness], whole);
    assert.ok(typeof s.label === 'string' && s.label.length > 0, whole);
  }
  for (const bad of ['Zorglub', '', null, undefined, 12]) assert.equal(parseSkinType(bad), null, String(bad));
  assert.equal(parseSkinType('  dry   &  redness ').base, 'dry');
});

test('I5 mode confort : type de peau avec « Redness » ou indicateur rougeurs « À surveiller » ; sinon inactif', () => {
  assert.equal(interpret(norm({}, { skin: 'Oily' })).context.comfortMode, false);
  for (const skin of ['Redness', 'Dry & Redness', 'Oily & Redness', 'Combination & Redness']) {
    const c = interpret(norm({}, { skin })).context;
    assert.deepEqual([c.comfortMode, c.comfortReasons], [true, ['skin_type_redness']], skin);
  }
  const low = interpret(norm({ redness: 20 })).context;
  assert.deepEqual([low.comfortMode, low.comfortReasons], [true, ['redness_low']]);
  assert.equal(interpret(norm({ redness: 45 })).context.comfortMode, false);          // « À soutenir » seul : pas de mode confort
  assert.equal(interpret(norm({ redness: 31 })).context.comfortMode, false);
  assert.equal(interpret(norm({ redness: 30 })).context.comfortMode, true);
  assert.deepEqual(interpret(norm({ redness: 20 }, { skin: 'Redness' })).context.comfortReasons, ['skin_type_redness', 'redness_low']);
});

test('I6 données absentes : global, âge et type de peau absents restent absents, sans NaN ni 0', () => {
  const r = interpret(norm({}, { global: null, skin: null, age: null }));
  assert.deepEqual(r.global, { score: null, band: null, bandLabel: null });
  assert.equal(r.skinType, null);
  assert.equal(r.skinAge, null);
  assert.equal(r.context.skinBase, null);
  const empty = interpret(null);
  assert.equal(empty.indicators.length, 15);
  assert.ok(empty.indicators.every(i => i.score === null && i.band === null));
  assert.equal(JSON.stringify(empty).includes('NaN'), false);
});

test('I7 âge cutané et score global : informatifs, valeurs validées comme à l\'écran Résultat', () => {
  assert.equal(interpret(norm({}, { age: 29.6 })).skinAge, 30);
  assert.equal(interpret(norm({}, { age: 0 })).skinAge, null);
  assert.equal(interpret(norm({}, { global: 140 })).global.score, null);
  assert.equal(interpret(norm({}, { global: 28.5 })).global.band, 'low');
});

test('I8 l\'interprétation ne modifie jamais normalized', () => {
  const n = norm({ acne: 40 }), before = JSON.stringify(n);
  Engine.run(n, { goals: ['hydration'], level: 'full', cats: ['spf'] });
  assert.equal(JSON.stringify(n), before);
});
