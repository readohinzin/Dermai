'use strict';
/* Garde-fous 6C : règles que les audits 6A, 6B-2 et 6B-3 interdisent d'automatiser tant que la sémantique Perfect Corp n'est pas confirmée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, norm, run, randomCase, withStatus, withRetinoidFirst } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const actives = require('../js/engine/actives.js');
const indicators = require('../js/engine/data/indicators.js');

const tids = r => r.activePlan.treatments.map(t => t.activeId);
const allIds = r => [...r.activePlan.treatments, ...r.activePlan.supports].map(t => t.activeId);
const only = (key, v, o, profile) => run({ [key]: v }, o, profile);

test('G1 oiliness seul : jamais de salicylique ; la règle oiliness → salicylique n\'existe plus (structurel)', () => {
  assert.ok(!data.PREFERENCE.oiliness.includes('salicylic'));
  assert.ok(!actives.byId('salicylic').targets.includes('oiliness'));
  for (const v of [0, 10, 25, 40, 55]) for (const level of ['none', 'simple', 'full'])
    for (const skin of ['Normal', 'Oily', 'Dry', 'Combination', 'Redness']) assert.ok(!tids(only('oiliness', v, { skin }, { level })).includes('salicylic'));
});

test('G2 texture faible : jamais de salicylique automatique', () => {
  assert.ok(!data.PREFERENCE.texture.includes('salicylic'));
  for (const v of [0, 20, 40, 55]) for (const level of ['none', 'simple', 'full']) assert.ok(!tids(only('texture', v, {}, { level })).includes('salicylic'));
});

test('G3 radiance faible : information seulement sans objectif ; avec l\'objectif teint, jamais de niacinamide, vitamine C possible', () => {
  assert.ok(!data.PREFERENCE.radiance.includes('niacinamide'));
  for (const v of [0, 30, 55]) assert.deepEqual(tids(only('radiance', v)), [], 'sans objectif : aucun actif (étape 25)');
  for (const v of [0, 30, 55]) assert.ok(!tids(only('radiance', v, {}, { goals: ['tone'] })).includes('niacinamide'));
  assert.deepEqual(tids(only('radiance', 30, {}, { goals: ['tone'] })), ['vitamin_c']);
  assert.ok(data.PREFERENCE.radiance.includes('aha_pha'));
  assert.ok(actives.byId('niacinamide'), 'niacinamide reste au catalogue');
});

test('G4 routine minimale (none) : jamais de rétinoïde (aujourd\'hui « à_valider » ; garde-fou conservé si validé)', () => {
  const aging = { goals: ['aging'] };   // rides : soumis à l'objectif « rides et fermeté » (étape 25) ; fermeté et texture : descriptifs
  for (const ind of ['wrinkles', 'firmness', 'texture']) assert.ok(!tids(only(ind, 10, {}, { level: 'none', ...aging })).includes('retinoid'), ind);
  withRetinoidFirst(() => {
    for (const ind of ['wrinkles', 'firmness']) assert.ok(!tids(only(ind, 10, {}, { level: 'none', ...aging })).includes('retinoid'), ind);
    const r = only('wrinkles', 10, {}, { level: 'none', ...aging });
    assert.ok(r.activePlan.deferred.some(d => d.activeId === 'retinoid' && d.kind === 'minimal'));
    assert.match(r.explanations.map(e => e.text).join(' '), /volontairement minimale/);
    assert.ok(tids(only('wrinkles', 10, {}, { level: 'simple', ...aging })).includes('retinoid'), 'disponible aux autres niveaux');
  });
});

test('G5 confort + rougeurs : jamais de rétinoïde ; actif exigeant : repli vers du plus doux', () => {
  const check = () => {
    for (const ind of ['wrinkles', 'firmness', 'texture']) for (const skin of ['Redness', 'Dry & Redness', 'Oily & Redness'])
      for (const level of ['none', 'simple', 'full']) assert.ok(!tids(only(ind, 15, { skin }, { level })).includes('retinoid'));
  };
  check();
  withRetinoidFirst(check);
  const acne = only('acne', 30, { skin: 'Redness' });
  assert.deepEqual(tids(acne), ['niacinamide']);
  assert.ok(acne.activePlan.deferred.some(d => d.activeId === 'salicylic' && d.kind === 'comfort'));
});

test('G6 azélaïque : ni exfoliant ni rétinoïde (hors groupe evening_strong), conflits non exécutés retirés', () => {
  assert.deepEqual(actives.byId('azelaic').groups, []);
  assert.notEqual(actives.byId('azelaic').role, 'exfoliation');
  for (const id of ['salicylic', 'aha_pha', 'retinoid']) assert.deepEqual(actives.byId(id).groups, ['evening_strong'], id);
  for (const a of data.ACTIVES) assert.ok(!('conflicts' in a) && !('pairsWith' in a), a.id);
});

test('G7 seuils : 61 Bien, 60 À soutenir, 31 À soutenir, 30 À surveiller (éditoriaux DERMAI)', () => {
  const band = v => M.scoreBand(v).label;
  assert.deepEqual([61, 60, 31, 30].map(band), ['Bien', 'À soutenir', 'À soutenir', 'À surveiller']);
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../js/skin-model.js'), 'utf8');
  assert.match(src, /Editorial DERMAI thresholds .* NOT supplied by Perfect Corp/);
});

test('G8 contour des yeux : informatif, jamais une priorité ni un actif', () => {
  for (const k of ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid']) {
    assert.equal(indicators.INDICATORS[k].actionability, 'informative', k);
    const r = only(k, 5);
    assert.deepEqual(r.priorities.items, []);
    assert.deepEqual(allIds(r).filter(id => !['hyaluronic', 'ceramides', 'glycerin', 'panthenol', 'squalane'].includes(id)), [], k);
  }
});

test('G9 rawScore complet : il décide seul ; le score affiché ne change aucune décision', () => {
  /* Étape 25 : quand chaque indicateur a un rawScore, les décisions lisent le rawScore (repères DERMAI provisoires) ; le ui_score ne sert
     plus qu'à l'affichage. Même raw, ui très différents → mêmes décisions. */
  const raw = { acne: 30, hydration: 40 };
  const a = run({ acne: 95, hydration: 90 }, { rawMap: raw, rawFill: 80 }), b = run({ acne: 20, hydration: 10 }, { rawMap: raw, rawFill: 80 });
  const dec = r => r.priorities.items.map(i => [i.indicator, i.band, i.value]);
  assert.deepEqual(dec(a), [['acne', 'mid', 30], ['hydration', 'mid', 40]]);
  assert.deepEqual(dec(a), dec(b));
  assert.deepEqual(a.activePlan, b.activePlan);
  assert.deepEqual(a.priorities.items.map(i => i.score), [95, 90], 'le score affiché reste le ui_score');
});

test('G10 uiScore absent : indicateur indisponible, aucune recommandation fondée dessus', () => {
  const r = run({ acne: null, pores: null, wrinkles: null });
  assert.deepEqual(r.priorities.items, []);
  assert.deepEqual(tids(r), []);
});

test('G11 le score global all ne change jamais les priorités ni les actifs', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const c = randomCase(seed);
    const a = run(c.ui, { ...c.o, global: 5 }, c.profile), b = run(c.ui, { ...c.o, global: 98 }, c.profile);
    assert.deepEqual(a.priorities, b.priorities);
    assert.deepEqual(a.activePlan, b.activePlan);
  }
});

test('G12 simulation : 6000 profils synthétiques, aucune règle interdite n\'apparaît', () => {
  const keys = M.METRIC_KEYS, eyes = ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
  let n = 0;
  for (let seed = 1; seed <= 6000; seed++) {
    const c = randomCase(seed * 7 + 3), r = run(c.ui, c.o, c.profile);
    n++;
    const t = r.activePlan.treatments, level = ['none', 'simple', 'full'].includes(c.profile.level) ? c.profile.level : 'simple';
    for (const x of t) {
      assert.equal(actives.byId(x.activeId).status, 'validated', `seed ${seed} à_valider`);
      if (x.activeId === 'salicylic') assert.ok(x.indicators.some(i => i === 'acne' || i === 'pores'), `seed ${seed} salicylique sans acne/pores`);
      if (x.activeId === 'niacinamide') assert.ok(x.indicators.some(i => i !== 'radiance'), `seed ${seed} niacinamide pour radiance seule`);
      assert.notEqual(x.activeId, 'retinoid', `seed ${seed} rétinoïde auto-sélectionné`);
      assert.ok(x.indicators.every(i => !eyes.includes(i)), `seed ${seed} actif pour le contour des yeux`);
    }
    for (const p of r.priorities.items) assert.ok(!eyes.includes(p.indicator), `seed ${seed} priorité yeux`);
    assert.equal(t.filter(x => actives.byId(x.activeId).groups.includes('evening_strong')).length <= 1, true);
  }
  assert.equal(n, 6000);
});
