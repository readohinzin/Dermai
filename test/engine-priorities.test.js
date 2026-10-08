'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, norm, run, ids, randomCase } = require('./helpers/engine.js');

test('PR1 aucun score valide : mode maintenance, aucune priorité', () => {
  const r = run(Object.fromEntries(M.METRIC_KEYS.map(k => [k, null])));
  assert.deepEqual([r.priorities.mode, r.priorities.items.length], ['maintenance', 0]);
  const empty = require('./helpers/engine.js').Engine.run(null, null);
  assert.equal(empty.priorities.mode, 'maintenance');
});

test('PR2 un seul score faible : une seule priorité, avec sa raison et son explication', () => {
  const r = run({ pores: 40 });
  assert.deepEqual(ids(r.priorities.items), ['pores']);
  const it = r.priorities.items[0];
  assert.deepEqual([it.score, it.band, it.domain, it.objectiveMatch, it.actionability, it.confidence, it.rank], [40, 'mid', 'oil_pores', false, 'actionable', 'medium', 1]);
  assert.match(it.reason, /sous les repères DERMAI : DERMAI le retient comme besoin à soutenir\./);
  assert.equal(r.priorities.mode, 'action');
});

test('PR3 plusieurs scores faibles : bande la plus basse d\'abord, puis score le plus bas', () => {
  const r = run({ hydration: 20, pores: 45, acne: 50, texture: 55 });
  assert.deepEqual(ids(r.priorities.items), ['hydration', 'pores', 'acne']);
  assert.equal(r.priorities.items[0].band, 'low');
});

test('PR4 scores égaux : ordre fixe des indicateurs (déterministe) ; un indicateur descriptif (texture) n\'entre jamais', () => {
  const r = run({ pores: 45, acne: 45, texture: 45, hydration: 45 });
  assert.deepEqual(ids(r.priorities.items), ['acne', 'pores', 'hydration']);
});

test('PR5 stabilité : un écart de 2 points ou moins ne change pas le classement ; au-delà, le score le plus bas passe devant', () => {
  assert.deepEqual(ids(run({ pores: 44, acne: 46 }).priorities.items), ['acne', 'pores']);   // écart 2 : ordre fixe
  assert.deepEqual(ids(run({ pores: 46, acne: 44 }).priorities.items), ['acne', 'pores']);
  assert.deepEqual(ids(run({ pores: 43, acne: 46 }).priorities.items), ['pores', 'acne']);   // écart 3 : le plus bas d'abord
});

test('PR6 objectif : favorise un indicateur dans sa propre bande, jamais au-dessus d\'une bande plus faible', () => {
  const sans = run({ pores: 55, acne: 40 });
  assert.deepEqual(ids(sans.priorities.items), ['acne', 'pores']);
  const avec = run({ pores: 55, acne: 40 }, {}, { goals: ['oil_pores'] });
  assert.deepEqual(ids(avec.priorities.items), ['pores', 'acne']);
  assert.equal(avec.priorities.items[0].objectiveMatch, true);
  const bande = run({ radiance: 48, hydration: 28 }, {}, { goals: ['tone'] });              // exemple du cahier des charges
  assert.deepEqual(ids(bande.priorities.items), ['hydration', 'radiance']);
  assert.equal(bande.priorities.items[1].objectiveMatch, true);
});

test('PR7 objectif : ne transforme jamais un score « Bien » en priorité et n\'invente rien', () => {
  const r = run({ pores: 90 }, {}, { goals: ['oil_pores', 'tone', 'hydration'] });
  assert.deepEqual(r.priorities.items, []);
  assert.equal(r.priorities.mode, 'maintenance');
  assert.deepEqual(ids(run({ pores: 45 }, {}, { goals: ['bogus', 'maintenance'] }).priorities.items), ['pores']);   // inconnu et « entretien » : aucun effet
  assert.equal(run({ pores: 45 }, {}, { goals: ['maintenance'] }).priorities.items[0].objectiveMatch, false);
});

test('PR8 objectif absent : aucun effet, ce n\'est jamais une information négative', () => {
  const a = run({ pores: 55, acne: 40 }, {}, { goals: [] }), b = run({ pores: 55, acne: 40 }, {}, {});
  assert.deepEqual(a.priorities, b.priorities);
  assert.ok(a.priorities.items.every(i => i.objectiveMatch === false));
});

test('PR9 plafond : 3 priorités d\'action au maximum', () => {
  const r = run({ acne: 20, pores: 25, oiliness: 30, texture: 35, hydration: 40, redness: 50, wrinkles: 55 });
  assert.equal(r.priorities.items.length, 3);
  assert.deepEqual(r.priorities.items.map(i => i.rank), [1, 2, 3]);
});

test('PR10 aucun indicateur actionnable sous « Bien » : mode maintenance, jamais « problèmes détectés »', () => {
  const r = run({ acne: 61, pores: 90, hydration: 100 });
  assert.equal(r.priorities.mode, 'maintenance');
  assert.deepEqual(r.priorities.items, []);
  assert.ok(r.explanations.some(e => e.kind === 'mode' && /DERMAI ne retient aucun besoin particulier/.test(e.text)));
  assert.equal(run({ acne: 60 }).priorities.mode, 'action');                                  // 60 : « À soutenir »
});

test('PR11 contour des yeux : information seulement, jamais une priorité d\'action ni un actif', () => {
  const r = run({ darkCircle: 10, eyeBag: 20, tearTrough: 45, droopyUpperEyelid: 30, droopyLowerEyelid: 25 });
  assert.deepEqual(r.priorities.items, []);
  assert.equal(r.priorities.mode, 'maintenance');
  assert.deepEqual(ids(r.priorities.informational).sort(), ['darkCircle', 'droopyLowerEyelid', 'droopyUpperEyelid', 'eyeBag', 'tearTrough']);
  assert.match(r.priorities.eyeInfo, /contour des yeux/);
  assert.match(r.priorities.eyeInfo, /aucun actif n'est proposé automatiquement/);
  assert.deepEqual(r.activePlan.treatments, []);
  const mixte = run({ darkCircle: 10, pores: 45 });
  assert.deepEqual(ids(mixte.priorities.items), ['pores']);
  assert.deepEqual(ids(mixte.priorities.informational), ['darkCircle']);
});

test('PR12 données absentes : un score absent n\'est jamais une priorité, jamais 0', () => {
  const r = run({ acne: null, pores: undefined, hydration: 40 });
  assert.deepEqual(ids(r.priorities.items), ['hydration']);
  assert.ok(r.interpretation.indicators.filter(i => i.id === 'acne' || i.id === 'pores').every(i => i.score === null));
});

test('PR13 bandes : 61 « Bien » (non éligible), 60 « À soutenir », 30 « À surveiller »', () => {
  assert.deepEqual(run({ acne: 61 }).priorities.items, []);
  assert.equal(run({ acne: 60 }).priorities.items[0].band, 'mid');
  assert.equal(run({ acne: 30 }).priorities.items[0].band, 'low');
  assert.equal(run({ acne: 31 }).priorities.items[0].band, 'mid');
});

test('PR14 priorités indépendantes du score global, de l\'âge cutané et du type de peau (ordre)', () => {
  /* rawScore n'est plus dans cette liste : depuis l'étape 25, c'est lui qui décide quand il est complet (voir R1 à R14). */
  const ui = { acne: 45, pores: 30, hydration: 55 };
  const base = run(ui, { global: 10, age: 60 });
  for (const o of [{ global: 95, age: 20 }, { global: null, age: null }, { skin: 'Dry' }, { skin: 'Oily' }]) {
    assert.deepEqual(ids(run(ui, o).priorities.items), ids(base.priorities.items), JSON.stringify(o));
  }
});

test('PR15 déterminisme : mêmes entrées, même sortie (50 jeux), et la sortie est toujours explicable', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const c = randomCase(seed), a = run(c.ui, c.o, c.profile), b = run(c.ui, c.o, c.profile);
    assert.deepEqual(a, b, 'seed ' + seed);
    assert.ok(a.priorities.items.length <= 3);
    for (const it of a.priorities.items) {
      assert.ok(it.band === 'low' || it.band === 'mid');
      assert.equal(it.actionability, 'actionable');
      assert.ok(typeof it.reason === 'string' && it.reason.length > 0);
    }
  }
});
