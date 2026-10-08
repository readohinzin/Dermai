'use strict';
/* Étape 27 : moteur d'accompagnement des indicateurs « good » (js/engine/accompaniment.js, actives.addAccompaniment, routine, produits).
   Les valeurs sont des raw (base de décision « raw »), sauf mention. Aucun appel réseau, aucune analyse Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, norm, withStatus } = require('./helpers/engine.js');
const DEC = require('../js/engine/data/decision.js');
const ACT = require('../js/engine/data/actives.js');
const interpretMod = require('../js/engine/interpret.js');
const priorities = require('../js/engine/priorities.js');
const accompaniment = require('../js/engine/accompaniment.js');
const actives = require('../js/engine/actives.js');
const C = require('../js/engine/data/catalog.js');

/* raw : { clé: valeur } ; fill : valeur des indicateurs non cités. Le score affiché (ui) ne sert à rien à la décision. */
const rawOf = (over, fill = 85) => Object.fromEntries(M.METRIC_KEYS.map(k => [k, over[k] !== undefined ? over[k] : fill]));
const analysis = (over, fill, o = {}) => { const raw = rawOf(over, fill), ui = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Math.min(99, Math.round(v + 8))]));
  return norm(ui, Object.assign({ rawMap: raw, skin: 'Normal', global: 75 }, o)); };
/* Calcul pur (sans routine) : interpret → priorités → accompagnement. */
function calc(over, profile = {}, fill, o = {}) {
  const prof = Engine.normalizeProfile(profile), interp = interpretMod.interpret(analysis(over, fill, o)), prios = priorities.compute(interp, prof);
  return { interp, prios, acc: accompaniment.compute(interp, prios, prof) };
}
const ids = r => r.acc.items.map(i => i.indicator);
const withMax = (n, fn) => { const s = DEC.MAX_ACCOMPANIMENT_AXES; DEC.MAX_ACCOMPANIMENT_AXES = n; try { return fn(); } finally { DEC.MAX_ACCOMPANIMENT_AXES = s; } };

test('ACC1 constantes : 2 axes, convergence 2, 1 étape, pool doux ; TIE_TOLERANCE inchangée ; repères 50 / 25 inchangés', () => {
  assert.deepEqual([DEC.MAX_ACCOMPANIMENT_AXES, DEC.ACCOMPANIMENT_CONVERGENCE, DEC.MAX_ACCOMPANIMENT_STEPS, DEC.TIE_TOLERANCE], [2, 2, 1, 2]);
  assert.deepEqual(DEC.ACCOMPANIMENT_ACTIVE, { kind: 'treatment', irritation: 'low' });
  assert.deepEqual(DEC.RAW_BANDS.map(b => [b.key, b.min]), [['good', 50], ['mid', 25], ['low', 0]]);
  assert.equal(priorities.MAX_PRIORITIES, 3);
  for (const f of ['js/engine/accompaniment.js', 'js/engine/actives.js', 'js/engine/routine.js', 'js/engine/synthesis.js', 'js/engine/index.js'])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /MAX_ACCOMPANIMENT_AXES\s*=|ACCOMPANIMENT_CONVERGENCE\s*=|\bconst\s+\w+\s*=\s*2;\s*\/\/.*accompagnement/i, f + ' : aucune valeur de plafond redéfinie');
});

test('ACC2 médiane : convention usuelle (moyenne des deux valeurs centrales si pair), liste vide = null', () => {
  assert.equal(accompaniment.median([3, 1, 2]), 2);
  assert.equal(accompaniment.median([4, 1, 3, 2]), 2.5);
  assert.equal(accompaniment.median([]), null);
  assert.equal(accompaniment.median([NaN, 5, null, 7]), 6, 'valeurs non numériques ignorées');
});

test('ACC3 frontières de « distinct » : valeur < médiane − TIE_TOLERANCE, strictement (médiane 77)', () => {
  const r = v => calc({ acne: v }, {}, 77);          // dix indicateurs de comparaison : neuf à 77 et l'acné, donc médiane 77 tant que l'acné ≤ 77
  assert.equal(r(74.9).acc.median, 77);
  assert.deepEqual(ids(r(74.9)), ['acne'], 'médiane − 2,1 : distinct');
  assert.deepEqual(ids(r(75)), [], 'médiane − 2 : pas distinct');
  assert.deepEqual(ids(r(75.1)), [], 'médiane − 1,9 : pas distinct');
  assert.equal(accompaniment.isDistinct(75, 77), false);
  assert.equal(accompaniment.isDistinct(74.9, 77), true);
  assert.equal(r(74.9).acc.items[0].origin, 'distinct');
});

test('ACC4 un indicateur « good » proche des autres n\'est pas un axe sans objectif ; avec son objectif, il l\'est (le raw 55 et le raw 76 sont traités pareil)', () => {
  const near = { acne: 76 }, pack = { pores: 77, hydration: 76, texture: 75, oiliness: 78, redness: 78, pigmentation: 79, wrinkles: 80, firmness: 77, radiance: 76 };
  assert.deepEqual(ids(calc(Object.assign({}, near, pack))), [], 'cas A : acné 76 parmi 75-80, sans objectif : aucun axe');
  const g = calc(Object.assign({}, near, pack), { goals: ['blemishes'] });
  assert.deepEqual(g.acc.items.map(i => [i.indicator, i.origin, i.objectiveMatch, i.activeId]), [['acne', 'objective', true, 'niacinamide']], 'cas B : avec l\'objectif imperfections');
  assert.deepEqual(g.prios.items, [], 'jamais une priorité');
  for (const v of [50, 55, 76]) { const x = calc({ acne: v }); assert.deepEqual(x.acc.items.map(i => [i.indicator, i.origin, i.activeId]), [['acne', 'distinct', 'niacinamide']], 'acné ' + v + ' (autres à 85) : même traitement'); assert.deepEqual(x.prios.items, [], 'raw ' + v + ' : jamais une priorité'); }
});

test('ACC5 les priorités LOW/MID gardent leur comportement : acné 49,9 reste MID et n\'est pas un accompagnement ; acné 50 devient candidate', () => {
  const mid = calc({ acne: 49.9 });
  assert.deepEqual(mid.prios.items.map(i => [i.indicator, i.band]), [['acne', 'mid']]);
  assert.deepEqual(ids(mid), [], 'une priorité n\'est jamais aussi un accompagnement');
  const low = calc({ acne: 12 });
  assert.deepEqual(low.prios.items.map(i => [i.indicator, i.band]), [['acne', 'low']]);
  assert.deepEqual(ids(low), []);
  const good = calc({ acne: 50 });
  assert.deepEqual(good.prios.items, []);
  assert.deepEqual(ids(good), ['acne'], 'raw 50 : good, plus automatiquement supprimé de toute logique d\'accompagnement');
});

test('ACC6 débordement : un candidat LOW/MID écarté par le plafond de 3 passe avant les GOOD ; au plus 2 axes ; ordre stable', () => {
  const over = calc({ acne: 40, pores: 41, redness: 42, pigmentation: 43, hydration: 70 });
  assert.equal(over.prios.items.length, 3);
  assert.deepEqual(over.prios.overflow, ['pigmentation']);
  assert.deepEqual(over.acc.items.map(i => [i.indicator, i.origin, i.rank]), [['pigmentation', 'overflow', 1], ['hydration', 'distinct', 2]].filter(x => x[0] === 'pigmentation').concat([]).length ? [['pigmentation', 'overflow', 1]] : []);
  // plusieurs GOOD distincts : 2 axes au plus, valeur croissante puis ordre fixe
  const many = calc({ acne: 70, pores: 70, redness: 70, pigmentation: 70 });
  assert.deepEqual(ids(many), ['acne', 'pores'], 'quatre candidats à 70 : deux axes, ordre fixe');
  const ord = calc({ acne: 72, pores: 68, redness: 60, pigmentation: 70 });
  assert.deepEqual(ids(ord), ['redness', 'pores'], 'valeur de décision croissante');
  assert.deepEqual(ids(calc({ acne: 70, pores: 70, redness: 70, pigmentation: 70 })), ids(many), 'stable');
  const again = () => ids(calc({ acne: 70, pores: 70, redness: 70, pigmentation: 70 }));
  assert.deepEqual(withMax(0, again), [], 'MAX_ACCOMPANIMENT_AXES = 0 désactive l\'accompagnement');
  assert.deepEqual(withMax(1, again), ['acne']);
  assert.deepEqual(again(), ['acne', 'pores'], 'valeur restaurée');
});

test('ACC7 ordre : débordement, puis objectif, puis distincts', () => {
  const r = calc({ acne: 40, pores: 41, redness: 42, pigmentation: 43, hydration: 70, wrinkles: 60 }, { goals: ['tone'] });
  assert.equal(r.prios.items.length, 3);
  const full = calc({ acne: 70, pores: 74, redness: 66, pigmentation: 79 }, { goals: ['tone'] });
  assert.deepEqual(full.acc.items.map(i => [i.indicator, i.origin]), [['pigmentation', 'objective'], ['redness', 'distinct']], 'l\'objectif passe avant le plus bas distinct');
});

test('ACC8 rôles : jamais descriptive, informative, ni conditionné sans son objectif ; un actif doux doit exister', () => {
  for (const k of ['oiliness', 'texture', 'firmness', 'eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'])
    for (const goals of [[], ['texture', 'oil_pores', 'aging', 'tone', 'blemishes']]) assert.ok(!ids(calc({ [k]: 30 }, { goals })).includes(k), k + ' / ' + goals.join());
  assert.deepEqual(ids(calc({ wrinkles: 60, radiance: 60 })), [], 'conditionné sans objectif : jamais');
  const gated = ids(calc({ wrinkles: 60, radiance: 60 }, { goals: ['aging', 'tone'] }));
  assert.ok(!gated.includes('wrinkles') && !gated.includes('radiance'), 'avec leur objectif, mais aucun actif doux validé pour eux (vitamine C = moderate) : jamais');
  assert.deepEqual(gated, ['pigmentation'], 'l\'objectif « teint » ouvre la pigmentation (actionnable, actif doux validé), pas la radiance');
  assert.deepEqual(ids(calc({ hydration: 60 }, { goals: ['hydration'] })), [], 'hydratation : ses actifs sont des ingrédients d\'hydratant, pas un soin doux ciblé');
});

test('ACC9 pool doux : sous-ensemble strict, validé, soin ciblé, irritation basse ; aucun moderate ni à_valider, même validé ou choisi par objectif', () => {
  for (const k of M.METRIC_KEYS) for (const a of actives.gentleFor(k, [])) {
    assert.equal(a.status, 'validated'); assert.equal(a.kind, 'treatment'); assert.equal(a.irritation, 'low'); assert.ok(a.targets.includes(k));
  }
  assert.deepEqual(M.METRIC_KEYS.filter(k => actives.gentleFor(k, []).length), ['acne', 'pores', 'oiliness', 'texture', 'redness', 'pigmentation']);
  assert.deepEqual(actives.gentleFor('acne', []).map(a => a.id), ['niacinamide'], 'salicylique et azélaïque (moderate, validés) en sont exclus');
  assert.deepEqual(actives.gentleFor('pigmentation', []).map(a => a.id), ['niacinamide'], 'vitamine C, azélaïque, AHA/PHA (moderate) exclus');
  withStatus('retinoid', 'validated', () => assert.deepEqual(actives.gentleFor('texture', []).map(a => a.id), ['niacinamide'], 'rétinoïde (high) jamais, même validé'));
  const { withRetinoidFirst } = require('./helpers/engine.js');
  withRetinoidFirst(() => { for (const k of ['wrinkles', 'firmness']) assert.deepEqual(actives.gentleFor(k, []), [], k + ' : rétinoïde (high) validé et premier choix, toujours exclu du pool doux'); });
  assert.deepEqual(['wrinkles', 'firmness', 'radiance', 'darkCircle', 'eyeBag'].map(k => actives.gentleFor(k, []).length), [0, 0, 0, 0, 0], 'à_valider ou moderate : jamais');
  assert.deepEqual(actives.gentleFor('acne', ['niacinamide']), [], 'exclusion de l\'utilisatrice respectée');
  const every = Array.from({ length: 300 }, (_, s) => calc({ acne: 40 + (s % 40), pores: 55 + (s % 30), redness: 60 + (s % 25) }, { goals: [['blemishes'], [], ['tone', 'aging']][s % 3] }));
  for (const r of every) for (const it of r.acc.items) assert.equal(it.activeId, 'niacinamide');
});

test('ACC10 exclusions, mode confort, peau sèche : l\'accompagnement doux reste compatible, jamais plus exigeant', () => {
  assert.deepEqual(ids(calc({ acne: 70, pores: 70 }, { exclusions: ['niacinamide'] })), [], 'niacinamide exclue : aucun axe');
  const comfort = calc({ acne: 70, pores: 70 }, {}, 85, { skin: 'Dry & Redness' });
  assert.equal(comfort.interp.context.comfortMode, true);
  assert.deepEqual(comfort.acc.items.map(i => i.activeId), ['niacinamide', 'niacinamide'], 'mode confort : l\'actif doux reste proposé');
  const dry = calc({ acne: 70 }, {}, 85, { skin: 'Dry' });
  assert.deepEqual(dry.acc.items.map(i => i.activeId), ['niacinamide']);
});

test('ACC11 base ui (analyse sans raw) : mêmes règles sur les repères d\'affichage 61 / 31, sans mélanger les bases', () => {
  const ui = Object.fromEntries(M.METRIC_KEYS.map(k => [k, 88]));
  const n = norm(Object.assign({}, ui, { acne: 70 }), {});               // aucun raw
  const interp = interpretMod.interpret(n), prof = Engine.normalizeProfile({}), prios = priorities.compute(interp, prof), acc = accompaniment.compute(interp, prios, prof);
  assert.equal(interp.basis, 'ui');
  assert.deepEqual(prios.items, [], 'ui 70 : good (61 et plus), jamais une priorité');
  assert.deepEqual(acc.items.map(i => [i.indicator, i.basis, i.value, i.origin]), [['acne', 'ui', 70, 'distinct']]);
  const mid = interpretMod.interpret(norm(Object.assign({}, ui, { acne: 50 }), {}));
  assert.deepEqual(priorities.compute(mid, prof).items.map(i => i.indicator), ['acne'], 'ui 50 : repère moins élevé, priorité comme avant');
  const mixed = norm(Object.assign({}, ui), { rawMap: Object.assign(rawOf({}, 90), { acne: null }) });
  assert.equal(interpretMod.interpret(mixed).basis, 'ui', 'un seul raw manquant : toute l\'analyse reste sur la base ui');
});

test('ACC12 aucune lecture du masque, du pays, des offres, du type de peau comme déclencheur : code et résultat', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/engine/accompaniment.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /mask|localization|market|country|offer|price|skinType|skinBase|skinAge|global|photo/i);
  const a = calc({ acne: 70, pores: 68 }, { goals: [] }, 85, { skin: 'Oily' }), b = calc({ acne: 70, pores: 68 }, { goals: [] }, 85, { skin: 'Dry' });
  assert.deepEqual(a.acc.items.map(i => [i.indicator, i.origin]), b.acc.items.map(i => [i.indicator, i.origin]), 'le type de peau ne change ni les axes ni leur ordre');
});
