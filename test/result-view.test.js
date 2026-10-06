'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/skin-model.js');
const FX = require('./fixtures/perfectcorp-json-response.json');

/* Modèle de score de l'interface : uiScore seul, 0 à 100, 100 = meilleur. Les valeurs attendues sont lues dans la fixture, jamais copiées. */
const OUT = FX.data.results.output;
const TYPE_OF = { acne: 'acne', pores: 'pore', oiliness: 'oiliness', texture: 'texture', hydration: 'moisture', redness: 'redness',
  pigmentation: 'age_spot', wrinkles: 'wrinkle', firmness: 'firmness', radiance: 'radiance', eyeBag: 'eye_bag', tearTrough: 'tear_trough',
  darkCircle: 'dark_circle_v2', droopyUpperEyelid: 'droopy_upper_eyelid', droopyLowerEyelid: 'droopy_lower_eyelid' };
const item = t => OUT.find(e => e.type === t);
const normalized = () => M.parseSkinResponse(FX).normalized;
const clone = o => JSON.parse(JSON.stringify(o));
const metric = (view, key) => [...view.priorities, ...view.others].find(m => m.key === key);

test('R1 le score affiché d\'une métrique est son ui_score (jamais raw_score, jamais 100 - raw_score)', () => {
  const v = M.toResultView(normalized());
  for (const [key, type] of Object.entries(TYPE_OF)) {
    const m = metric(v, key), e = item(type);
    assert.equal(m.score, Math.round(e.ui_score), key);
    assert.notEqual(m.score, Math.round(100 - e.raw_score), key + ' : pas 100 - raw');
  }
});

test('R2 raw_score n\'a aucune influence sur le résultat affiché', () => {
  const n = normalized(), before = JSON.stringify(M.toResultView(n));
  for (const k of M.METRIC_KEYS) n[k].rawScore = 1234;
  assert.equal(JSON.stringify(M.toResultView(n)), before);
  const n2 = normalized(); n2.acne.uiScore = 5;
  assert.equal(metric(M.toResultView(n2), 'acne').score, 5);
});

test('R3 ui_score absent, invalide ou hors 0-100 : indisponible, sans repli sur raw_score ni autre métrique', () => {
  for (const bad of [null, undefined, 'abc', NaN, Infinity, -1, 100.5, 250, true, {}, []]) {
    const n = normalized(); n.pores.uiScore = bad;                    // rawScore reste présent : il ne doit pas servir de repli
    const m = metric(M.toResultView(n), 'pores');
    assert.equal(m.score, null, String(bad));
    assert.equal(m.band, null);
    assert.equal(m.bandLabel, null);
  }
  const n = normalized(); n.pores.uiScore = null;
  const v = M.toResultView(n);
  assert.ok(!v.priorities.some(m => m.key === 'pores'), 'une métrique indisponible n\'entre jamais dans les priorités');
  assert.ok(v.others.some(m => m.key === 'pores'), 'elle reste listée comme indisponible');
});

test('R4 seuils : 0-30 À surveiller, 31-60 À soutenir, 61-100 Bien, sur l\'entier affiché', () => {
  const cases = [[0, 'low'], [30, 'low'], [30.4, 'low'], [30.5, 'mid'], [31, 'mid'], [60, 'mid'], [60.4, 'mid'], [60.5, 'good'], [61, 'good'], [100, 'good']];
  for (const [v, band] of cases) assert.equal(M.scoreBand(v).key, band, String(v));
  assert.equal(M.scoreBand(30).label, 'À surveiller');
  assert.equal(M.scoreBand(31).label, 'À soutenir');
  assert.equal(M.scoreBand(61).label, 'Bien');
  assert.equal(M.scoreBand(null), null);
  assert.equal(M.scoreBand(101), null);
});

test('R5 score global : globalScore tel que reçu, jamais inversé ni recalculé à partir des métriques', () => {
  const v = M.toResultView(normalized());
  assert.equal(v.global.score, Math.round(item('all').score));
  const n = normalized(); n.globalScore = 77;
  assert.equal(M.toResultView(n).global.score, 77);
  for (const k of M.METRIC_KEYS) { n[k].uiScore = 1; n[k].rawScore = 1; }
  assert.equal(M.toResultView(n).global.score, 77, 'indépendant des 15 métriques');
});

test('R6 score global absent ou invalide : indisponible, jamais 0, 50 ou 100', () => {
  for (const bad of [null, undefined, 'x', NaN, -3, 140]) {
    const n = normalized(); n.globalScore = bad;
    const g = M.toResultView(n).global;
    assert.deepEqual(g, { score: null, band: null, bandLabel: null }, String(bad));
  }
});

test('R7 type de peau : les 8 valeurs documentées ont un libellé français, une description neutre ; inconnu ou absent → null', () => {
  const attendu = { Normal: 'Peau normale', Oily: 'Peau grasse', Dry: 'Peau sèche', Combination: 'Peau mixte', Redness: 'Tendance aux rougeurs',
    'Dry & Redness': 'Peau sèche avec tendance aux rougeurs', 'Oily & Redness': 'Peau grasse avec tendance aux rougeurs',
    'Combination & Redness': 'Peau mixte avec tendance aux rougeurs' };
  for (const [whole, label] of Object.entries(attendu)) {
    const n = normalized(); n.skinType = { whole, tZone: 'Oily', uZone: 'Dry' };
    const s = M.toResultView(n).skinType;
    assert.equal(s.label, label, whole);
    assert.ok(typeof s.description === 'string' && s.description.length > 0, whole);
  }
  for (const whole of ['Zorglub', '', null, undefined, 42]) {
    const n = normalized(); n.skinType = { whole, tZone: 'Oily', uZone: 'Dry' };       // t_zone et u_zone ne remplacent jamais whole
    assert.equal(M.toResultView(n).skinType, null, String(whole));
  }
  assert.equal(M.toResultView(normalized()).skinType.label, 'Peau mixte');
});

test('R8 âge cutané : affiché seulement si valide (1 à 120), sinon null', () => {
  assert.equal(M.toResultView(normalized()).skinAge, Math.round(item('skin_age').score));
  for (const bad of [null, undefined, 'x', NaN, 0, -4, 121, Infinity]) {
    const n = normalized(); n.skinAge = bad;
    assert.equal(M.toResultView(n).skinAge, null, String(bad));
  }
});

test('R9 priorités : les 3 plus bas ui_score, égalités départagées par l\'ordre fixe, aucun doublon avec les autres', () => {
  const v = M.toResultView(normalized());
  const scores = M.METRIC_KEYS.map(k => ({ k, s: Math.round(item(TYPE_OF[k]).ui_score) }));
  const lowest = [...scores].sort((a, b) => a.s - b.s || M.METRIC_KEYS.indexOf(a.k) - M.METRIC_KEYS.indexOf(b.k)).slice(0, 3).map(x => x.k);
  assert.deepEqual(v.priorities.map(m => m.key), lowest);
  assert.equal(v.priorities.length + v.others.length, 15);
  assert.equal(new Set([...v.priorities, ...v.others].map(m => m.key)).size, 15);
  const n = normalized();
  for (const k of M.METRIC_KEYS) n[k].uiScore = 50;                  // égalité totale : ordre fixe
  assert.deepEqual(M.toResultView(n).priorities.map(m => m.key), M.METRIC_KEYS.slice(0, 3));
});

test('R10 normalized vide ou invalide : aucune valeur inventée, aucune exception', () => {
  for (const bad of [null, undefined, {}, 'x', [], 5]) {
    const v = M.toResultView(bad);
    assert.equal(v.global.score, null);
    assert.equal(v.skinType, null);
    assert.equal(v.skinAge, null);
    assert.equal(v.priorities.length, 0);
    assert.equal(v.others.length, 15);
    assert.ok(v.others.every(m => m.score === null));
  }
});

test('R11 le modèle de score ne modifie pas normalized', () => {
  const n = normalized(), before = JSON.stringify(n);
  M.toResultView(n);
  assert.equal(JSON.stringify(n), before);
  assert.equal(JSON.stringify(clone(n)), before);
});

/* ================= Évolution entre deux analyses (Progression) ================= */
test('P1 évolution : > +2 Amélioration, de -2 à +2 Stable, < -2 Baisse (convention d\'interface, 100 = meilleur)', () => {
  const cases = [[50, 53, 'up', 'Amélioration', 3], [50, 52, 'same', 'Stable', 2], [50, 50, 'same', 'Stable', 0], [50, 48, 'same', 'Stable', -2],
    [50, 47, 'down', 'Baisse', -3], [40, 46, 'up', 'Amélioration', 6], [60, 54, 'down', 'Baisse', -6]];
  for (const [before, after, trend, label, delta] of cases) {
    const c = M.compareScores(before, after);
    assert.deepEqual([c.available, c.trend, c.trendLabel, c.delta], [true, trend, label, delta], `${before} → ${after}`);
  }
});

test('P2 évolution : un score absent ou invalide d\'un côté ou de l\'autre → indisponible, jamais 0', () => {
  for (const bad of [null, undefined, 'x', NaN, -1, 101]) {
    for (const [a, b] of [[bad, 60], [60, bad], [bad, bad]]) {
      const c = M.compareScores(a, b);
      assert.equal(c.available, false);
      assert.equal(c.delta, null);
      assert.equal(c.trend, null);
      assert.equal(c.trendLabel, null);
    }
  }
});

test('P3 compareScans : 15 métriques lues dans uiScore, jamais dans rawScore ; global comparé sur globalScore', () => {
  const a = normalized(), b = normalized();
  for (const k of M.METRIC_KEYS) { b[k].uiScore = a[k].uiScore + 10; b[k].rawScore = 0; a[k].rawScore = 100; }   // le raw dit « baisse », l'ui dit « mieux »
  b.globalScore = a.globalScore - 20;
  const c = M.compareScans(a, b);
  assert.equal(c.metrics.length, 15);
  for (const m of c.metrics) {
    if (a[m.key].uiScore + 10 > 100) assert.equal(m.available, false, m.key + ' : 100+ est hors plage, donc indisponible');
    else assert.deepEqual([m.available, m.trend, m.delta], [true, 'up', 10], m.key);
  }
  assert.equal(c.global.trend, 'down');
  assert.deepEqual(c.metrics.map(m => m.key), M.METRIC_KEYS);
});

test('P4 compareScans : métrique absente avant ou après → indisponible, sans influencer les autres', () => {
  const a = normalized(), b = normalized();
  a.pores.uiScore = null; b.acne.uiScore = null;
  const c = M.compareScans(a, b), by = k => c.metrics.find(m => m.key === k);
  assert.equal(by('pores').available, false);
  assert.equal(by('acne').available, false);
  assert.equal(by('texture').available, true);
  assert.equal(by('texture').trend, 'same');
  assert.equal(M.compareScans(null, undefined).metrics.every(m => !m.available), true);
  assert.deepEqual(c.metrics.map(m => m.label), M.METRIC_KEYS.map(k => M.METRIC_LABELS[k]), 'le nom de la métrique n\'est jamais écrasé par le libellé d\'évolution');
});

test('P5 série du score global : un global absent ou invalide reste null (jamais 0), les autres sont inchangés', () => {
  const ok = normalized(), no = normalized(), bad = normalized(), over = normalized();
  no.globalScore = null; bad.globalScore = 'x'; over.globalScore = 140; ok.globalScore = 62.4;
  assert.deepEqual(M.globalSeries([ok, no, bad, over, ok]), [62, null, null, null, 62]);
  assert.deepEqual(M.globalSeries(null), []);
  assert.deepEqual(M.globalSeries([null, {}]), [null, null]);
});
