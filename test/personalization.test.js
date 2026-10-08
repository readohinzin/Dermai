'use strict';
/* Étape 7 : couche de personnalisation. Objectifs, type de peau, niveau de routine, confort et exclusions : déterministes, explicables,
   jamais un diagnostic, jamais devant une règle de sécurité. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, run, randomCase } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const indicators = require('../js/engine/data/indicators.js');
const actives = require('../js/engine/actives.js');
const products = require('../js/engine/products.js');
const personalization = require('../js/engine/personalization.js');
const copy = require('../js/engine/copy.fr.js');

const tids = r => r.activePlan.treatments.map(t => t.activeId);
const allTexts = r => JSON.stringify([r.personalization, r.explanations, r.routinePlan.notes, r.routinePlan.summary, r.routinePlan.slots, r.priorities.items.map(i => i.reason)]);
const DIAG = /(?<![\p{L}])(maladie|pathologi\w*|gu[ée]ri\w*|prescri\w*|hyperpigmentation|inflamm\w*|souffre\w*)(?![\p{L}])|vous avez (?:une|un|des)\b/iu;
const GOALS = indicators.GOALS.map(g => g.id);

test('P1 objectif hydration : le repère d\'hydratation passe devant des repères comparables, avec des ingrédients d\'hydratant', () => {
  const ui = { hydration: 40, acne: 38 };
  assert.equal(run(ui).priorities.items[0].indicator, 'acne');
  const r = run(ui, {}, { goals: ['hydration'] });
  assert.equal(r.priorities.items[0].indicator, 'hydration');
  assert.equal(r.personalization.goals[0].status, 'priority');
  assert.ok(r.activePlan.supports.some(s => s.activeId === 'hyaluronic'));
});

test('P2 objectif oil_pores : les pores passent devant un repère comparable ; le salicylique n\'est jamais déduit du niveau d\'huile', () => {
  const ui = { pores: 50, acne: 48 };
  assert.equal(run(ui).priorities.items[0].indicator, 'acne');
  const r = run(ui, {}, { goals: ['oil_pores'] });
  assert.equal(r.priorities.items[0].indicator, 'pores');
  assert.ok(tids(r).includes('niacinamide'));
  assert.ok(!tids(run({ oiliness: 20 }, {}, { goals: ['oil_pores'] })).includes('salicylic'));
});

test('P3 objectif tone : le repère teint/taches passe devant un repère comparable ; vitamine C possible, option cosmétique', () => {
  const r = run({ pigmentation: 50, acne: 48 }, {}, { goals: ['tone'] });
  assert.equal(r.priorities.items[0].indicator, 'pigmentation');
  assert.ok(tids(r).includes('vitamin_c'));
  assert.equal(r.priorities.items[0].objectiveMatch, true);
});

test('P4 objectif texture : texture est descriptive (étape 25) : l\'objectif n\'oriente rien, n\'ajoute aucun actif, et le dit', () => {
  const r = run({ texture: 50, acne: 48 }, {}, { goals: ['texture'] });
  assert.deepEqual(r.priorities.items.map(i => i.indicator), ['acne']);
  assert.ok(!r.activePlan.treatments.some(t => t.indicators.includes('texture')));
  assert.equal(r.personalization.goals[0].status, 'descriptive');
  assert.match(r.synthesis.goals.items[0].text, /^Texture : texture \(50\), résultat décrit sans règle d'action automatique : aucun soin ciblé n'est ajouté à ce titre\.$/);
});

test('P5 objectif aging : aucun rétinoïde automatique (« à_valider »), la vitamine C reste possible', () => {
  for (const level of ['none', 'simple', 'full']) {
    const r = run({ wrinkles: 30, firmness: 35 }, {}, { goals: ['aging'], level });
    assert.ok(!tids(r).includes('retinoid'), level);
  }
  assert.ok(tids(run({ wrinkles: 30 }, {}, { goals: ['aging'], level: 'simple' })).includes('vitamin_c'));
});

test('P6 trois objectifs : exactement trois ; P7 quatre : le quatrième est refusé', () => {
  let g = [];
  for (const id of ['hydration', 'texture', 'tone']) g = Engine.toggleGoal(g, id).goals;
  assert.deepEqual(g, ['hydration', 'texture', 'tone']);
  const over = Engine.toggleGoal(g, 'aging');
  assert.equal(over.limited, true);
  assert.deepEqual(over.goals, g);
  assert.equal(run({}, {}, { goals: ['hydration', 'texture', 'tone', 'aging', 'oil_pores'] }).personalization.goals.length, 3);
  assert.equal(Engine.normalizeProfile({ goals: GOALS }).goals.length, 3);
});

test('P8 un objectif n\'est pas un diagnostic : il ne crée ni priorité, ni actif, ni mot médical', () => {
  for (const id of GOALS) {
    const r = run({}, {}, { goals: [id] });
    assert.equal(r.priorities.mode, 'maintenance', id);
    assert.deepEqual(r.priorities.items, []);
    assert.deepEqual(tids(r), []);
    assert.doesNotMatch(allTexts(r), DIAG, id);
    assert.ok(['no_signal', 'maintenance', 'descriptive'].includes(r.personalization.goals[0].status), id);
  }
  const r = run({}, {}, { goals: ['tone'] });
  assert.match(r.personalization.goals[0].text, /aucun actif n'est ajouté/);
  assert.match(r.explanations.find(e => e.kind === 'mode').text, /DERMAI ne retient aucun besoin particulier/);
});

test('P9 confort choisi par l\'utilisateur : aucun rétinoïde, aucun actif à forte irritation, base d\'hydratation, SPF', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, { ...c.profile, comfort: { preferGentle: true } });
    assert.equal(r.routinePlan.comfortMode, true);
    assert.ok(!tids(r).includes('retinoid'));
    for (const t of r.activePlan.treatments) assert.notEqual(actives.byId(t.activeId).irritation, 'high');
    assert.ok(r.routinePlan.slots.morning.some(s => s.kind === 'spf'));
  }
  const r = run({ acne: 30 }, {}, { comfort: { preferGentle: true } });
  assert.deepEqual(tids(r), ['niacinamide']);
  assert.ok(r.activePlan.supports.some(s => s.context));
  assert.match(r.personalization.rationale.find(x => x.code === 'comfort').text, /Vous avez choisi une approche douce/);
});

test('P10 routine none : routine minimale, un seul soin ciblé très doux', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, { ...c.profile, level: 'none' });
    assert.ok(r.activePlan.treatments.length <= 1, 'seed ' + seed);
    for (const t of r.activePlan.treatments) assert.equal(actives.byId(t.activeId).irritation, 'low', 'seed ' + seed);
    assert.deepEqual(r.routinePlan.slots.morning.map(s => s.kind).filter(k => k !== 'treatment'), ['cleanse', 'moisturize', 'spf']);
  }
  const r = run({ acne: 30, pigmentation: 40 }, {}, { level: 'none' });
  assert.deepEqual(tids(r), ['niacinamide']);
  assert.ok(r.activePlan.deferred.some(d => d.kind === 'minimal'));
});

test('P11 routine simple et P12 complète : plafonds, la complète reste non excessive', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed);
    const s = run(c.ui, c.o, { ...c.profile, level: 'simple' }), f = run(c.ui, c.o, { ...c.profile, level: 'full' });
    assert.ok(s.activePlan.treatments.length <= 2, 'simple ' + seed);
    assert.ok(f.activePlan.treatments.length <= 3, 'full ' + seed);
    for (const slot of ['morning', 'evening']) {
      assert.ok(s.routinePlan.slots[slot].filter(x => x.kind === 'treatment').length <= 1, 'simple créneau ' + seed);
      assert.ok(f.routinePlan.slots[slot].length <= 5, 'full créneau ' + seed);
    }
  }
  assert.equal(run({ acne: 30, pigmentation: 40, redness: 50 }, {}, { level: 'full' }).activePlan.treatments.length, 3);
});

test('P13 modifier un objectif ou le niveau recalcule la routine ; le moteur est pur (aucun cache)', () => {
  const n = require('./helpers/engine.js').norm({ hydration: 40, acne: 38 });
  const a = Engine.run(n, { goals: [], level: 'simple', cats: [] }), b = Engine.run(n, { goals: ['hydration'], level: 'simple', cats: [] });
  assert.notDeepEqual(a.priorities.items.map(i => i.indicator), b.priorities.items.map(i => i.indicator));
  assert.deepEqual(Engine.run(n, { goals: ['hydration'], level: 'simple', cats: [] }), b);
  const c = Engine.run(n, { goals: ['hydration'], level: 'none', cats: [] });
  assert.ok(c.activePlan.treatments.length <= 1);
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(app, /const engineFor=s=>/);
  assert.doesNotMatch(app, /engineCache|memo(ize)?\(/);
  assert.match(app, /case `gentle`:state\.gentle=!state\.gentle;render\(true\)/);
});

test('P14 le type de peau influence le contexte (et jamais un diagnostic) ; les priorités ne changent pas', () => {
  const ui = { hydration: 40, acne: 45 };
  const dry = run(ui, { skin: 'Dry' }), oily = run(ui, { skin: 'Oily' });
  assert.equal(dry.personalization.context.skinBase, 'dry');
  assert.equal(oily.personalization.context.skinBase, 'oily');
  assert.deepEqual(dry.priorities.items.map(i => i.indicator), oily.priorities.items.map(i => i.indicator));
  assert.match(dry.personalization.rationale.find(x => x.code === 'skin').text, /Votre analyse indique le profil : Peau sèche\. Il sert de contexte/);
  assert.notEqual(dry.routinePlan.slots.morning.find(s => s.kind === 'moisturize').texture, oily.routinePlan.slots.morning.find(s => s.kind === 'moisturize').texture);
  assert.doesNotMatch(allTexts(dry) + allTexts(oily), DIAG);
});

test('P15 le niveau d\'huile (oiliness) ne crée jamais de conclusion « peau grasse »', () => {
  for (const v of [0, 20, 50, 90]) for (const skin of ['Normal', 'Dry', 'Combination']) {
    const r = run({ oiliness: v }, { skin }, { goals: ['oil_pores'] });
    assert.doesNotMatch(allTexts(r), /peau grasse|trop gras|excès de s[ée]bum/i, `${v} ${skin}`);
    assert.equal(r.personalization.context.skinType.label.includes('grasse'), false);
  }
});

test('P16 le score global et P17 l\'âge cutané n\'influencent jamais le choix des actifs', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const c = randomCase(seed * 5), a = run(c.ui, { ...c.o, global: 2, age: 85 }, c.profile), b = run(c.ui, { ...c.o, global: 99, age: 18 }, c.profile);
    assert.deepEqual(a.activePlan, b.activePlan);
    assert.deepEqual(a.personalization.selectedActives, b.personalization.selectedActives);
    assert.deepEqual(a.personalization.priorities, b.personalization.priorities);
  }
});

test('P18 aucun actif « à_valider » ni P19 aucun médicament ni P20 aucun faux pourcentage de correspondance', () => {
  const MED = /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon|mercure/i;
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed * 3 + 1), r = run(c.ui, c.o, c.profile);
    for (const s of r.personalization.selectedActives) assert.equal(actives.byId(s.activeId).status, 'validated');
    assert.doesNotMatch(allTexts(r), MED);
    assert.doesNotMatch(JSON.stringify(r.productMatches) + allTexts(r), /\d\s?%\s?(de )?(correspondance|compatib)|match\s?:\s?\d/i);
  }
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.doesNotMatch(app, /correspondance avec votre profil|\$\{p\.match/i);
});

test('S1 structure de sortie : objectifs, priorités, actifs retenus et écartés, raisons, niveau, contexte', () => {
  const r = run({ pores: 40, acne: 45, hydration: 35 }, { skin: 'Combination' }, { goals: ['oil_pores'], level: 'full', cats: ['exfoliant'] });
  const p = r.personalization;
  assert.deepEqual(Object.keys(p).sort(), ['approachNote', 'context', 'evolution', 'exclusions', 'excludedActives', 'goals', 'headline', 'otherActives', 'priorities', 'rationale', 'routineLevel', 'routineLevelLabel', 'selectedActives'].sort());
  assert.equal(p.routineLevel, 'full');
  assert.ok(p.rationale.length >= 2 && p.rationale.every(x => x.code && x.text));
  assert.match(p.headline, /^Votre analyse indique des repères plus faibles sur/);
  for (const s of p.selectedActives) {
    assert.ok(typeof s.why === 'string' && s.why.length > 0 && typeof s.whyNow === 'string' && s.whyNow.length > 0, s.activeId);
    assert.ok(Array.isArray(s.whyNot) && Array.isArray(s.measured));
  }
  assert.ok(p.excludedActives.every(d => d.text));
});

test('S2 explications « pourquoi / pourquoi maintenant / pourquoi pas autre chose »', () => {
  const r = run({ acne: 30 }, {}, { level: 'none', goals: ['blemishes'] });
  const s = r.personalization.selectedActives.find(x => x.activeId === 'niacinamide');
  assert.match(s.why, /Votre analyse indique un repère plus faible sur : acné/);
  assert.match(s.why, /objectif/);
  assert.match(s.whyNow, /routine est encore minimale/);
  assert.ok(s.whyNot.some(n => /Nous n'avons pas retenu .*acide salicylique.*routine reste minimale/.test(n.text)), JSON.stringify(s.whyNot));
  const owned = run({ acne: 30 }, {}, { cats: ['exfoliant'] }).personalization.selectedActives[0];
  assert.ok(owned.whyNot.some(n => /exfoliant/.test(n.text)));
});

test('S3 couverture : un actif compatible qui couvre plusieurs repères évite de multiplier les actifs, sans jamais être plus irritant', () => {
  /* Étape 25 : le niveau d'huile, descriptif, ne compte plus ; scénario de couverture : imperfections + rougeurs (acide azélaïque). */
  const r = run({ acne: 30, redness: 35 }, {}, { level: 'full' });
  assert.equal(r.activePlan.treatments[0].activeId, 'azelaic');
  assert.equal(r.activePlan.treatments[0].choice, 'coverage');
  assert.ok(r.activePlan.deferred.some(d => d.activeId === 'salicylic' && d.kind === 'covered'));
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed), x = run(c.ui, c.o, c.profile);
    for (const t of x.activePlan.treatments) if (t.choice !== 'editorial') {
      const first = x.priorities.items.length && (data.PREFERENCE[t.indicators[0]] || []).map(actives.byId).find(a => actives.isValidated(a) && a.kind === 'treatment');
      if (first) assert.ok(['low', 'moderate', 'high'].indexOf(t.irritation) <= ['low', 'moderate', 'high'].indexOf(first.irritation), `seed ${seed}`);
    }
  }
});

test('S4 une preuve directe n\'est jamais remplacée par une simple règle éditoriale (vitamine C pour la pigmentation)', () => {
  const r = run({ pores: 30, pigmentation: 40 }, {}, { level: 'simple' });
  assert.ok(tids(r).includes('vitamin_c'));
});

test('S5 exclusions : un actif exclu n\'est jamais choisi, ni dans un produit ; identifiant inconnu ignoré', () => {
  const r = run({ acne: 30, pigmentation: 40 }, {}, { level: 'full', exclusions: ['azelaic', 'salicylic', 'vitamin_c', 'bogus'] });
  assert.deepEqual(r.personalization.exclusions, ['azelaic', 'salicylic', 'vitamin_c']);
  for (const id of ['azelaic', 'salicylic', 'vitamin_c']) assert.ok(!tids(r).includes(id), id);
  assert.ok(r.activePlan.deferred.some(d => d.kind === 'excluded'));
  for (const m of r.productMatches) for (const id of products.ids(products.byId(m.productId))) assert.ok(!['azelaic', 'salicylic', 'vitamin_c'].includes(id), `${m.productId} ${id}`);
  const sup = run({ hydration: 30 }, {}, { exclusions: ['hyaluronic'] });
  assert.ok(!sup.activePlan.supports.some(s => s.activeId === 'hyaluronic'));
  assert.deepEqual(Engine.normalizeProfile({ exclusions: ['x', 'niacinamide', 'niacinamide'] }).exclusions, ['niacinamide']);
});

test('S6 matrice objectif → indicateurs → actifs : dérivée des données validées, rien d\'inventé', () => {
  const m = personalization.goalMatrix();
  assert.deepEqual(m.map(x => x.goal), GOALS);
  for (const row of m) for (const ind of row.indicators) for (const id of ind.actives) {
    const a = actives.byId(id);
    assert.equal(a.status, 'validated', id);
    assert.ok(a.targets.includes(ind.indicator) && data.PREFERENCE[ind.indicator].includes(id), `${row.goal} ${ind.indicator} ${id}`);
  }
  assert.ok(!m.flatMap(r => r.indicators.flatMap(i => i.actives)).includes('retinoid'));
  assert.deepEqual(m.find(r => r.goal === 'maintenance').indicators, []);
});

test('S7 évolution : l\'analyse précédente sert à comparer, la dernière analyse reste la référence', () => {
  const N = require('./helpers/engine.js').norm;
  const prev = N({ acne: 55, hydration: 70 }), cur = N({ acne: 35, hydration: 70 });
  const r = Engine.run(cur, { level: 'simple' }, { previous: prev });
  const e = r.personalization.evolution;
  assert.equal(e.available, true);
  assert.equal(e.indicators.find(i => i.indicator === 'acne').trend, 'down');
  assert.equal(r.priorities.items[0].score, 35, 'les priorités viennent de l\'analyse courante');
  assert.deepEqual(Engine.run(cur, { level: 'simple' }).activePlan, r.activePlan, 'la précédente ne change pas le plan');
  const same = Engine.run(cur, { level: 'simple' }, { previous: cur }).personalization.evolution;
  assert.equal(same.routineStable, true);
  assert.equal(same.note, copy.PERSONAL.evolution.stable);
  assert.equal(run({}).personalization.evolution.available, false);
});

test('S8 catalogue produit : forme cible préparée, aucun champ commercial inventé', () => {
  assert.deepEqual(products.CATALOG_FIELDS, ['productId', 'activeIds', 'categories', 'skinTypes', 'goals', 'price', 'currency', 'vendor', 'availability', 'url']);
  for (const p of products.PRODUCTS) {
    const e = products.toCatalogEntry(p);
    assert.deepEqual(Object.keys(e), products.CATALOG_FIELDS);
    for (const k of ['price', 'currency', 'vendor', 'availability', 'url']) assert.equal(e[k], null, `${p.id}.${k}`);
    assert.ok(e.goals.every(g => GOALS.includes(g)));
  }
});

test('S9 le module de personnalisation est pur (pas de DOM, réseau, stockage ni fournisseur)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/engine/personalization.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(src, /\bdocument\b|\bwindow\.|localStorage|sessionStorage|fetch\(|XMLHttpRequest|Supabase|perfect ?corp|youcam|rawScore/i);
});

test('SIM simulation 6000 profils : objectifs, types de peau, niveaux, confort, exclusions, données manquantes', () => {
  let s = 12345;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const MED = /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon|mercure/i;
  const eyes = ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
  const ids = data.ACTIVES.map(a => a.id);
  const violations = [];
  for (let seed = 1; seed <= 6000; seed++) {
    const c = randomCase(seed * 19 + 7);
    const goals = []; const n = Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) goals.push(rnd() < 0.1 ? 'unknown' : GOALS[Math.floor(rnd() * GOALS.length)]);
    const profile = { ...c.profile, goals, comfort: { preferGentle: rnd() < 0.3 }, exclusions: rnd() < 0.2 ? [ids[Math.floor(rnd() * ids.length)]] : [] };
    const prev = rnd() < 0.3 ? require('./helpers/engine.js').norm(randomCase(seed + 1).ui) : null;
    const r = Engine.run(require('./helpers/engine.js').norm(c.ui, c.o), profile, prev ? { previous: prev } : undefined);
    const p = r.personalization, t = r.activePlan.treatments, level = r.routinePlan.level;
    const bad = m => violations.push(seed + ' ' + m);
    if (p.goals.length > 3 || r.profile.goals.length > 3) bad('objectifs > 3');
    if (r.priorities.items.length > 3) bad('priorités > 3');
    for (const x of [...t, ...r.activePlan.supports]) {
      if (actives.byId(x.activeId).status !== 'validated') bad('à_valider');
      if (r.profile.exclusions.includes(x.activeId)) bad('exclu choisi');
    }
    if (t.some(x => x.activeId === 'retinoid')) bad('rétinoïde');
    if (MED.test(JSON.stringify(r))) bad('médicament');
    if (DIAG.test(allTexts(r))) bad('diagnostic ' + (allTexts(r).match(DIAG) || [])[0]);
    if (/\d\s?%\s?(de )?(correspondance|compatib)/i.test(JSON.stringify(r))) bad('faux pourcentage');
    if (r.routinePlan.comfortMode) for (const x of t) if (actives.byId(x.activeId).irritation === 'high') bad('confort');
    if (profile.comfort.preferGentle && !r.routinePlan.comfortMode) bad('confort demandé ignoré');
    if (level === 'none' && (t.length > 1 || t.some(x => actives.byId(x.activeId).irritation !== 'low'))) bad('routine none');
    if (level === 'simple' && t.length > 2) bad('simple > 2');
    if (level === 'full' && t.length > 3) bad('full > 3');
    if (t.filter(x => actives.byId(x.activeId).groups.includes('evening_strong')).length > 1) bad('double fort');
    if (t.some(x => x.indicators.some(i => eyes.includes(i)))) bad('yeux');
    if (r.priorities.items.some(i => eyes.includes(i.indicator))) bad('priorité yeux');
    const placed = r.routinePlan.slots.morning.concat(r.routinePlan.slots.evening).filter(x => x.kind === 'treatment').map(x => x.activeId).sort().join();
    const planned = [...t.map(x => x.activeId)].filter(id => !r.routinePlan.deferred.some(d => d.activeId === id && d.kind === 'slot')).sort().join();
    if (placed !== planned) bad('routine ≠ plan');
    for (const g of p.goals) if (g.status === 'no_signal' && r.priorities.items.some(i => i.domain === (indicators.GOALS.find(x => x.id === g.id) || {}).domain)) bad('objectif sans signal mais priorité');
    if (r.priorities.mode === 'maintenance' && t.length) bad('maintenance avec actif');
    const flip = Engine.run(require('./helpers/engine.js').norm(c.ui, { ...c.o, global: 1, age: 90 }), profile);
    const flip2 = Engine.run(require('./helpers/engine.js').norm(c.ui, { ...c.o, global: 100, age: 18 }), profile);
    if (JSON.stringify(flip.activePlan) !== JSON.stringify(flip2.activePlan)) bad('all/skin_age');
  }
  assert.deepEqual(violations.slice(0, 10), []);
});
