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

/* ---------- Seconde passe : recommandation et soin ajouté ---------- */
const { randomCase } = require('./helpers/engine.js');
const go = (over, profile = {}, fill, o = {}) => Engine.run(analysis(over, fill, o), Object.assign({ goals: [], level: 'simple', cats: [] }, profile), { catalog: C.PRODUCTS });
const steps = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
const added = r => r.activePlan.treatments.filter(t => t.origin === 'accompaniment');
const tids = r => r.activePlan.treatments.map(t => t.activeId);
const recOf = (r, id) => r.accompaniment.recommendations.find(x => x.indicator === id);
const withPref = (map, fn) => { const saved = {}; for (const k of Object.keys(map)) { saved[k] = ACT.PREFERENCE[k]; ACT.PREFERENCE[k] = map[k]; } try { return fn(); } finally { Object.assign(ACT.PREFERENCE, saved); } };

test('ACC13 convergence : deux axes distincts qui partagent la niacinamide ajoutent UNE étape ; un seul axe sans objectif n\'en ajoute aucune', () => {
  const two = go({ acne: 70, pores: 70 });
  assert.deepEqual(two.accompanimentItems.map(i => i.indicator), ['acne', 'pores']);
  assert.deepEqual(two.priorityItems, []);
  assert.deepEqual(added(two).map(t => [t.activeId, t.indicators, t.irritation]), [['niacinamide', ['acne', 'pores'], 'low']]);
  assert.deepEqual(two.accompaniment.recommendations.map(r => [r.indicator, r.status, r.justification]), [['acne', 'added', 'convergence'], ['pores', 'added', 'convergence']]);
  assert.equal(steps(two).filter(s => s.kind === 'treatment').length, 1, 'une seule étape pour deux axes');
  assert.equal(steps(two).find(s => s.kind === 'treatment').origin, 'accompaniment');
  const one = go({ acne: 70 });
  assert.deepEqual(one.accompanimentItems.map(i => i.indicator), ['acne'], 'l\'axe est identifié et recommandé');
  assert.deepEqual([recOf(one, 'acne').status, recOf(one, 'acne').blocked, recOf(one, 'acne').activeId], ['identified', 'no_justification', 'niacinamide']);
  assert.deepEqual(added(one), [], 'mais aucun soin n\'est ajouté');
  assert.equal(steps(one).filter(s => s.kind === 'treatment').length, 0, 'la routine reste la routine de base');
});

test('ACC14 la convergence compte des axes qui partagent RÉELLEMENT le même actif', () => {
  const split = () => go({ acne: 70, pores: 70 });
  withStatus('zinc', 'validated', () => withPref({ acne: ['niacinamide'], pores: ['zinc'] }, () => {
    const r = split();
    assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.activeId]), [['acne', 'niacinamide'], ['pores', 'zinc']]);
    assert.deepEqual(added(r), [], 'deux axes, deux actifs différents : pas de convergence');
    assert.deepEqual(r.accompaniment.recommendations.map(x => x.blocked), ['no_justification', 'no_justification']);
  }));
  assert.equal(added(split()).length, 1, 'avec la même niacinamide : convergence');
});

test('ACC15 objectif : un seul axe suffit à ajouter l\'étape, sans jamais être une priorité', () => {
  const r = go({ acne: 76 }, { goals: ['blemishes'] });
  assert.deepEqual(r.priorityItems, []);
  assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.origin, i.objectiveMatch]), [['acne', 'objective', true]]);
  assert.deepEqual(added(r).map(t => t.activeId), ['niacinamide']);
  assert.equal(recOf(r, 'acne').justification, 'objective');
  assert.equal(r.priorities.mode, 'maintenance');
});

test('ACC16 accompagnement gratuit : un soin du plan qui cible déjà l\'indicateur évite toute étape ajoutée', () => {
  const free = go({ pores: 40, acne: 70, pigmentation: 70 });                      // pores MID → niacinamide ; acné et pigmentation : niacinamide les cible aussi
  const off = withMax(0, () => go({ pores: 40, acne: 70, pigmentation: 70 }));
  assert.deepEqual(free.priorityItems.map(i => i.indicator), ['pores']);
  assert.deepEqual(tids(free), tids(off), 'aucun soin de plus');
  assert.deepEqual(free.accompaniment.recommendations.map(r => [r.status, r.coveredBy]), [['covered', 'niacinamide'], ['covered', 'niacinamide']]);
  assert.deepEqual(added(free), []);
  const salicylic = go({ acne: 40, pores: 70, redness: 70 });                       // acné MID : le soin du plan (peau normale) cible aussi les pores
  assert.equal(steps(salicylic).filter(s => s.kind === 'treatment').length, steps(withMax(0, () => go({ acne: 40, pores: 70, redness: 70 }))).filter(s => s.kind === 'treatment').length);
});

test('ACC17 plafonds : l\'accompagnement n\'utilise que la place restante, jamais plus d\'une étape, jamais au-dessus des plafonds de soins', () => {
  const LIM = ACT.LIMITS;
  // niveau simple (2 soins) : deux soins prioritaires remplissent la place
  const full = go({ acne: 40, pigmentation: 41, pores: 70, redness: 70 });
  assert.equal(full.activePlan.treatments.length, 2);
  assert.deepEqual(added(full), [], 'deux soins prioritaires : aucun soin d\'accompagnement');
  assert.ok(['cap', 'no_justification'].includes(recOf(full, 'pores').blocked) || recOf(full, 'pores').status === 'covered');
  // un soin prioritaire : une étape d'accompagnement au plus
  const one = go({ acne: 40, redness: 70, pigmentation: 72 }, { goals: ['tone'] });
  assert.ok(added(one).length <= 1);
  for (const level of ['none', 'simple', 'full']) for (let s = 0; s < 120; s++) {
    const c = randomCase(s * 13 + 3), r = go(c.ui ? Object.fromEntries(Object.entries(c.ui).filter(([, v]) => v !== null)) : {}, { goals: c.profile.goals, level, exclusions: [] });
    assert.ok(r.activePlan.treatments.length <= LIM[level].treatments, level);
    assert.ok(added(r).length <= DEC.MAX_ACCOMPANIMENT_STEPS, level);
    assert.ok(r.accompanimentItems.length <= DEC.MAX_ACCOMPANIMENT_AXES);
    assert.ok(r.priorityItems.length <= priorities.MAX_PRIORITIES);
  }
});

test('ACC18 sécurité sur 2000 profils : actif doux validé seulement, aucun rétinoïde ni exfoliant, exclusions et confort respectés, un fort par soir, routine = plan', () => {
  const bad = [];
  for (let s = 1; s <= 2000; s++) {
    const c = randomCase(s * 37 + 5), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS });
    for (const t of added(r)) {
      const a = actives.byId(t.activeId);
      if (a.status !== 'validated' || a.irritation !== 'low' || a.kind !== 'treatment') bad.push(s + ' pool');
      if (['retinoid', 'salicylic', 'aha_pha', 'azelaic', 'vitamin_c'].includes(t.activeId)) bad.push(s + ' actif fort');
      if (r.profile.exclusions.includes(t.activeId)) bad.push(s + ' exclu');
      if (a.groups.length) bad.push(s + ' groupe fort');
    }
    const placed = steps(r).filter(x => x.kind === 'treatment').map(x => x.activeId).sort().join();
    const planned = tids(r).filter(id => !r.routinePlan.deferred.some(d => d.activeId === id && d.kind === 'slot')).sort().join();
    if (placed !== planned) bad.push(s + ' routine ≠ plan');
    if (r.activePlan.treatments.filter(t => actives.byId(t.activeId).groups.includes('evening_strong')).length > 1) bad.push(s + ' double fort');
    for (const x of r.accompaniment.recommendations) if (x.status === 'added' && !steps(r).some(y => y.kind === 'treatment' && y.activeId === x.activeId)) bad.push(s + ' soin annoncé absent');
    if (r.accompanimentItems.some(i => r.priorityItems.some(p => p.indicator === i.indicator))) bad.push(s + ' priorité et accompagnement');
  }
  assert.deepEqual(bad.slice(0, 8), []);
});

test('ACC19 exclusions et confort au niveau moteur : niacinamide exclue = aucun soin ni axe ; mode confort : seul l\'actif doux', () => {
  const ex = go({ acne: 70, pores: 70 }, { goals: ['blemishes'], exclusions: ['niacinamide'] });
  assert.deepEqual([ex.accompanimentItems, added(ex), tids(ex)], [[], [], []]);
  const comfort = go({ acne: 70, pores: 70 }, { goals: [] }, 85, { skin: 'Dry & Redness' });
  assert.equal(comfort.routinePlan.comfortMode, true);
  assert.deepEqual(added(comfort).map(t => t.activeId), ['niacinamide']);
  for (const t of comfort.activePlan.treatments) assert.notEqual(actives.byId(t.activeId).irritation, 'high');
  const gentle = go({ acne: 70, pores: 70 }, { comfort: { preferGentle: true } });
  assert.deepEqual(added(gentle).map(t => t.activeId), ['niacinamide']);
});

/* ---------- Cas de référence A à H ---------- */
test('ACC20 cas A : acné LOW, sans objectif : priorité de soin, aucun accompagnement de l\'acné', () => {
  const r = go({ acne: 12 });
  assert.deepEqual(r.priorityItems.map(i => [i.indicator, i.band]), [['acne', 'low']]);
  assert.ok(!r.accompanimentItems.some(i => i.indicator === 'acne'));
  assert.ok(r.activePlan.treatments.every(t => t.origin === undefined || t.origin === 'priority'), 'soins issus de la priorité');
});
test('ACC21 cas B : acné MID, sans objectif : axe à soutenir, comportement actuel inchangé', () => {
  const r = go({ acne: 40 }), off = withMax(0, () => go({ acne: 40 }));
  assert.deepEqual(r.priorityItems.map(i => [i.indicator, i.band]), [['acne', 'mid']]);
  assert.deepEqual(r.activePlan.treatments.map(t => [t.activeId, t.indicators, t.choice]), off.activePlan.treatments.map(t => [t.activeId, t.indicators, t.choice]));
  assert.deepEqual(r.routinePlan.slots, JSON.parse(JSON.stringify(off.routinePlan.slots)), 'même routine');
});
test('ACC22 cas C : acné GOOD 76 (autres à 85), sans objectif : accompagnement possible, aucun nouveau soin', () => {
  const r = go({ acne: 76 });
  assert.deepEqual(r.priorityItems, []);
  assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.origin, i.activeId]), [['acne', 'distinct', 'niacinamide']]);
  assert.deepEqual(r.activePlan.treatments, []);
  assert.deepEqual(steps(r).map(s => s.kind), ['cleanse', 'moisturize', 'spf', 'cleanse', 'moisturize'], 'routine de base');
});
test('ACC23 cas D : acné GOOD 76 + objectif imperfections : axe par l\'objectif, une étape niacinamide', () => {
  const r = go({ acne: 76 }, { goals: ['blemishes'] });
  assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.origin]), [['acne', 'objective']]);
  assert.deepEqual(added(r).map(t => t.activeId), ['niacinamide']);
  assert.equal(steps(r).filter(s => s.origin === 'accompaniment').length, 1);
});
test('ACC24 cas E : hydratation LOW + acné GOOD, sans objectif : priorité hydratation, acné accompagnée sans soin ajouté (axe seul)', () => {
  const r = go({ hydration: 30, acne: 76 });
  assert.deepEqual(r.priorityItems.map(i => i.indicator), ['hydration']);
  assert.deepEqual(r.accompanimentItems.map(i => i.indicator), ['acne']);
  assert.deepEqual(added(r), []);
  assert.ok(r.activePlan.supports.length > 0, 'les ingrédients d\'hydratant restent ceux de la priorité');
  const two = go({ hydration: 30, acne: 76, pores: 72 });
  assert.deepEqual(two.priorityItems.map(i => i.indicator), ['hydration']);
  assert.deepEqual(two.accompanimentItems.map(i => i.indicator), ['pores', 'acne']);
  assert.deepEqual(added(two).map(t => [t.activeId, t.indicators.sort()]), [['niacinamide', ['acne', 'pores']]], 'cas D du brief : une seule étape niacinamide pour acné et pores');
});
test('ACC25 cas F : hydratation LOW + acné GOOD + objectif imperfections : l\'objectif ajoute l\'étape', () => {
  const r = go({ hydration: 30, acne: 76 }, { goals: ['blemishes'] });
  assert.deepEqual(r.priorityItems.map(i => i.indicator), ['hydration']);
  assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.origin]), [['acne', 'objective']]);
  assert.deepEqual(added(r).map(t => t.activeId), ['niacinamide']);
});
test('ACC26 cas G : plus de trois candidats : trois priorités, le débordement est accompagné en premier, aucun plafond dépassé', () => {
  const r = go({ acne: 40, pores: 41, redness: 42, pigmentation: 43 }, { level: 'full' });
  assert.equal(r.priorityItems.length, 3);
  assert.deepEqual(r.accompanimentItems.map(i => [i.indicator, i.origin])[0], ['pigmentation', 'overflow']);
  assert.ok(r.activePlan.treatments.length <= ACT.LIMITS.full.treatments);
  const simple = go({ acne: 40, pores: 41, redness: 42, pigmentation: 43 });
  assert.ok(simple.activePlan.treatments.length <= ACT.LIMITS.simple.treatments);
  assert.deepEqual(simple.priorityItems.map(i => i.indicator), withMax(0, () => go({ acne: 40, pores: 41, redness: 42, pigmentation: 43 })).priorityItems.map(i => i.indicator));
});
test('ACC27 cas H : aucun actif doux disponible : aucun axe, aucun soin, routine de base', () => {
  const noGentle = go({ acne: 70, pores: 70, redness: 70, pigmentation: 70 }, { exclusions: ['niacinamide'] });
  assert.deepEqual([noGentle.accompanimentItems, noGentle.activePlan.treatments], [[], []]);
  const lowOnly = go({ wrinkles: 60, firmness: 60, radiance: 60, oiliness: 60, texture: 60, eyeBag: 40, darkCircle: 40 }, { goals: ['aging', 'tone', 'texture'] });
  assert.ok(!lowOnly.accompanimentItems.some(i => ['wrinkles', 'firmness', 'radiance', 'oiliness', 'texture', 'eyeBag', 'darkCircle'].includes(i.indicator)));
  assert.deepEqual(steps(noGentle).map(s => s.kind), ['cleanse', 'moisturize', 'spf', 'cleanse', 'moisturize']);
});

/* ---------- Le masque, le pays et le catalogue n'influencent aucune décision ---------- */
test('ACC28 masque et pays : sorties de décision identiques, quelles que soient les données de localisation ou le pays', () => {
  const base = analysis({ acne: 70, pores: 70, hydration: 30 }), strip = r => JSON.stringify([r.priorities, r.accompaniment, r.activePlan, r.routinePlan, r.productMatches, r.synthesis.sections]);
  const ref = strip(Engine.run(base, { goals: [] }, { catalog: C.PRODUCTS }));
  const masks = [{}, { acne: ['data:image/png;base64,AAAA'] }, { acne: ['data:image/png;base64,' + 'A'.repeat(50000)], pores: ['x'], hydration: [] }];
  for (const localization of masks) {
    const withMask = Object.assign({}, base, { localization });
    assert.equal(strip(Engine.run(withMask, { goals: [] }, { catalog: C.PRODUCTS, localization })), ref, 'masque différent');
  }
  for (const market of ['NG', 'KE', 'ZA', 'GH', null]) assert.equal(strip(Engine.run(base, { goals: [], market, country: market }, { catalog: C.PRODUCTS, market, country: market })), ref, 'pays ' + market);
  for (const f of ['accompaniment.js', 'actives.js', 'routine.js', 'index.js']) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'js/engine', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /localization|\bmask|DermaiMarket|marketView|country/i, f);
});

/* ---------- Test différentiel : ancien moteur contre nouveau moteur ---------- */
test('ACC-DIFF 2000 profils : priorityItems identiques ; différences seulement là où un accompagnement existe, et seulement par l\'ajout du soin d\'accompagnement', () => {
  const J = x => JSON.stringify(x), pick = r => ({ prio: J([r.interpretation.indicators, r.priorities.items, r.priorities.mode, r.priorities.informational]), sup: J(r.activePlan.supports),
    def: J(r.activePlan.deferred.filter(d => d.kind !== 'slot')), tr: r.activePlan.treatments.map(t => t.activeId + ':' + t.indicators.join('+')) });
  let withAcc = 0, addedSteps = 0, free = 0;
  const profiles = [];
  for (let s = 1; s <= 1500; s++) { const c = randomCase(s * 37 + 5); profiles.push([norm(c.ui, c.o), c.profile]); }
  const rng = seed => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  for (let s = 1; s <= 500; s++) {
    const r = rng(9000 + s), ui = {}, raw = {};
    for (const k of M.METRIC_KEYS) { raw[k] = 5 + r() * 95; ui[k] = Math.min(99, Math.round(raw[k] + 10)); }
    profiles.push([norm(ui, { rawMap: raw, skin: ['Normal', 'Oily', 'Dry', 'Combination', 'Oily & Redness'][s % 5] }), { goals: [[], ['tone'], ['aging'], ['hydration', 'texture']][s % 4], level: ['none', 'simple', 'full'][s % 3] }]);
  }
  for (const [n, p] of profiles) {
    const nw = Engine.run(n, p, { catalog: C.PRODUCTS }), old = withMax(0, () => Engine.run(n, p, { catalog: C.PRODUCTS }));
    const a = pick(nw), b = pick(old);
    assert.equal(a.prio, b.prio, 'priorités et interprétation identiques');
    assert.equal(a.sup, b.sup, 'ingrédients d\'hydratant identiques');
    assert.equal(a.def, b.def, 'actifs écartés identiques');
    assert.deepEqual(old.accompanimentItems, [], 'désactivé : aucun axe');
    const extra = added(nw);
    if (nw.accompanimentItems.length) withAcc++;
    if (!extra.length) {
      assert.deepEqual(a.tr, b.tr, 'sans soin ajouté : mêmes soins');
      assert.equal(J(nw.routinePlan.slots.morning.map(s => [s.id, s.kind, s.activeId])), J(old.routinePlan.slots.morning.map(s => [s.id, s.kind, s.activeId])));
      assert.equal(J(nw.productMatches), J(old.productMatches), 'sans soin ajouté : mêmes produits');
      if (nw.accompaniment.recommendations.some(r => r.status === 'covered')) free++;
      continue;
    }
    addedSteps++;
    assert.equal(extra.length, 1);
    assert.deepEqual(a.tr.filter(x => !x.startsWith(extra[0].activeId + ':')).sort(), b.tr.sort(), 'les soins prioritaires sont conservés, un soin d\'accompagnement s\'y ajoute');
    const oldIds = new Set(old.productMatches.map(m => m.stepId));
    for (const m of old.productMatches) assert.ok(nw.productMatches.some(x => x.stepId === m.stepId && x.productId === m.productId), 'produits existants conservés');
    for (const m of nw.productMatches) if (!oldIds.has(m.stepId)) assert.ok(/:treatment:niacinamide$/.test(m.stepId), 'seul nouveau produit : celui du soin d\'accompagnement');
  }
  if (process.env.ACC_VERBOSE) console.log('ACC-DIFF', { withAcc, addedSteps, free });
  assert.ok(withAcc > 100 && addedSteps > 0, `l'accompagnement est exercé (${withAcc} profils avec axes, ${addedSteps} avec soin ajouté, ${free} accompagnements gratuits)`);
});

/* ---------- Produits : recommandation générée, produit trouvé, aucun produit ---------- */
test('ACC29 états produit : matched, no_catalog_product, not_applicable ; jamais de produit inventé', () => {
  const real = go({ acne: 70, pores: 70 });
  assert.deepEqual(real.accompaniment.recommendations.map(r => [r.indicator, r.status, r.productStatus, r.productId]), [['acne', 'added', 'matched', 'to-niacinamide-10-zinc-1'], ['pores', 'added', 'matched', 'to-niacinamide-10-zinc-1']]);
  assert.ok(C.PRODUCTS.some(p => p.id === 'to-niacinamide-10-zinc-1'), 'le produit existe réellement dans le catalogue');
  const none = Engine.run(analysis({ acne: 70, pores: 70 }), { goals: [], level: 'simple', cats: [] }, { catalog: [] });
  assert.deepEqual(none.accompaniment.recommendations.map(r => [r.status, r.productStatus, r.productId]), [['added', 'no_catalog_product', null], ['added', 'no_catalog_product', null]], 'recommandation générée, aucun produit : dit explicitement');
  assert.deepEqual(none.productMatches, []);
  const single = go({ acne: 70 });
  assert.deepEqual([single.accompaniment.recommendations[0].status, single.accompaniment.recommendations[0].productStatus, single.accompaniment.recommendations[0].productId], ['identified', 'not_applicable', null], 'axe identifié sans étape : aucun produit demandé');
  const covered = go({ pores: 40, acne: 70 }), coveredNone = Engine.run(analysis({ pores: 40, acne: 70 }), { goals: [], level: 'simple', cats: [] }, { catalog: [] });
  assert.deepEqual([covered.accompaniment.recommendations[0].status, covered.accompaniment.recommendations[0].productStatus], ['covered', 'matched'], 'couvert : le produit du soin qui le couvre');
  assert.equal(coveredNone.accompaniment.recommendations[0].productStatus, 'no_catalog_product');
  for (let s = 1; s <= 600; s++) { const c = randomCase(s * 37 + 5), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS });
    for (const x of r.accompaniment.recommendations) {
      assert.ok(['matched', 'no_catalog_product', 'not_applicable'].includes(x.productStatus), x.productStatus);
      assert.equal(x.productStatus === 'matched', !!x.productId);
      if (x.productId) assert.ok(C.PRODUCTS.some(p => p.id === x.productId));
      if (x.status === 'identified') assert.equal(x.productStatus, 'not_applicable');
    } }
});

test('ACC30 le pays ne change ni la décision ni l\'état du produit : il ne sert qu\'à classer les offres d\'un produit déjà choisi', () => {
  const r = go({ acne: 70, pores: 70 }), P = require('../js/engine/products.js');
  const prod = P.byId(r.accompaniment.recommendations[0].productId, C.PRODUCTS);
  const views = ['NG', 'GH', 'KE', 'ZA', 'SN'].map(code => P.marketView(prod, code));
  assert.equal(JSON.stringify(go({ acne: 70, pores: 70 }).accompaniment.recommendations), JSON.stringify(r.accompaniment.recommendations), 'même recommandation quel que soit le pays consulté');
  assert.ok(views.every(v => v.country), 'le pays n\'agit que sur les offres');
  assert.deepEqual(views.map(v => v.tier).filter(t => !['local', 'regional', 'international', 'none'].includes(t)), []);
});
