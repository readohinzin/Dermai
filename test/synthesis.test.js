'use strict';
/* Étape 22 : synthèse personnalisée (js/engine/synthesis.js) et justification obligatoire des produits.
   Les valeurs du scénario de référence (dernier résultat réel observé) ne servent qu'à vérifier la lecture : rien n'est codé en dur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Engine, norm, randomCase } = require('./helpers/engine.js');
const P = require('../js/engine/products.js');
const C = require('../js/engine/data/catalog.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const REAL = C.PRODUCTS;
const run = (ui, o = {}, profile = {}) => Engine.run(norm(ui, Object.assign({ skin: 'Normal' }, o)), Object.assign({ goals: [], level: 'simple', cats: [] }, profile), { catalog: REAL });
const ids = list => list.map(i => i.id);
const REF = { acne: 70, pores: 81, oiliness: 67, texture: 69, hydration: 67, redness: 99, pigmentation: 72, wrinkles: 79, firmness: 78, radiance: 65 };
const REF_O = { skin: 'Oily', global: 75, age: 29 };
const texts = y => [y.found, y.attention, y.goals.text, y.strategy.text, y.strategy.skinContext || '', ...Object.values(y.steps), ...Object.values(y.products).map(p => p.text)].join(' ');

test('S0 scénario de référence (dernier résultat réel) : lecture cohérente, explicable, sans priorité forte', () => {
  const r = run(REF, REF_O), y = r.synthesis;
  assert.equal(r.priorities.mode, 'maintenance');
  assert.deepEqual(ids(y.tiers.priority), []);
  assert.deepEqual(ids(y.tiers.attention), ['radiance', 'oiliness', 'hydration']);
  assert.deepEqual(ids(y.tiers.strength), ['redness', 'pores', 'wrinkles']);
  assert.deepEqual(ids(y.tiers.maintain), ['texture', 'acne', 'pigmentation', 'firmness']);
  assert.match(y.found, /Sur vos 10 indicateurs principaux, 10 sont dans la plage « Bien » \(61 et plus\)\./);
  assert.match(y.found, /plus favorables : rougeurs \(99\), pores \(81\) et rides \(79\)/);
  assert.match(y.found, /moins élevés : radiance \(65\), niveau d'huile \(67\) et hydratation \(67\)/);
  assert.match(y.attention, /même vos résultats les moins élevés, radiance \(65\), niveau d'huile \(67\) et hydratation \(67\), sont à 61 ou plus\. Selon les règles actuelles de DERMAI, cela ne justifie pas de soin ciblé/);
  assert.match(y.goals.text, /^Vous n'avez pas indiqué d'objectif : DERMAI s'appuie sur votre analyse seule, en suivant surtout radiance \(65\)/);
  assert.match(y.strategy.text, /^Stratégie : entretien adapté à votre profil \(peau grasse\), en suivant surtout radiance \(65\)/);
  assert.match(y.steps['morning:moisturize'], /Votre hydratation \(67\) fait partie de vos résultats les moins élevés/);
  assert.match(y.steps['morning:spf'], /Votre radiance \(65\) fait partie de vos axes à suivre/);
  assert.match(y.steps['morning:cleanse'], /profil gras/);
  // produits : le Cicaplast n'est plus proposé par défaut ; il n'est pas présenté comme adapté
  assert.deepEqual(r.productMatches, []);
  assert.equal(y.products['morning:moisturize'].status, 'none');
  const v = P.catalogView(r.routinePlan, r.productMatches, REAL);
  assert.equal(v.others.find(o => o.productId === 'lrp-cicaplast-baume-b5-plus').reason, 'not_justified');
  // aucune valeur du scénario n'est écrite dans le code
  for (const f of ['js/engine/synthesis.js']) assert.doesNotMatch(code(f), /\b(65|67|69|70|72|75|78|79|81|99)\b/, f);
});

test('S1 cas 1 profil globalement favorable → entretien, explication sans vocabulaire générique', () => {
  const r = run({}, { fill: 88 }), y = r.synthesis;
  assert.equal(r.priorities.mode, 'maintenance');
  assert.equal(y.strategy.mode, 'maintenance');
  assert.equal(y.homogeneous, true);
  assert.match(y.found, /très proches les uns des autres/);
  assert.match(y.strategy.text, /entretien de l'ensemble/);
  assert.match(y.attention, /Aucun indicateur principal n'est sous la plage « Bien »/);
});

test('S2 cas 2 un axe nettement moins favorable → identifié comme priorité', () => {
  const y = run({ hydration: 40 }).synthesis;
  assert.deepEqual(ids(y.tiers.priority), ['hydration']);
  assert.match(y.attention, /Ce qui mérite votre attention en premier : hydratation \(40\)/);
  assert.equal(y.strategy.mode, 'action');
});

test('S3 cas 3 deux axes moins favorables → hiérarchie : bande la plus basse d\'abord', () => {
  const y = run({ pigmentation: 45, acne: 25 }).synthesis;
  assert.deepEqual(ids(y.tiers.priority), ['acne', 'pigmentation']);
  assert.match(y.strategy.text, /^Stratégie : soutenir acné \(25\) et pigmentation \(45\) avec/);
});

const MIX = { radiance: 65, acne: 67, pigmentation: 72 };
test('S4 / S5 / S7 objectifs : même analyse, objectifs différents → stratégie différente, fondée sur les données', () => {
  const none = run(MIX, { fill: 86 }).synthesis, tone = run(MIX, { fill: 86 }, { goals: ['tone'] }).synthesis, blem = run(MIX, { fill: 86 }, { goals: ['blemishes'] }).synthesis;
  assert.match(tone.strategy.text, /attention particulière à radiance \(65\) et pigmentation \(72\)|attention particulière à radiance \(65\)/);
  assert.match(tone.strategy.text, /en lien avec votre objectif/);
  assert.equal(tone.goals.items[0].tier, 'attention');
  assert.match(blem.strategy.text, /attention particulière à acné \(67\)/);
  assert.equal(blem.goals.items[0].tier, 'attention');
  assert.notEqual(tone.strategy.text, blem.strategy.text);
  assert.notEqual(none.strategy.text, tone.strategy.text);
  assert.deepEqual(none.strategy.focus, ['radiance', 'acne', 'pigmentation']);
  assert.deepEqual(blem.strategy.focus, ['acne', 'radiance', 'pigmentation'], 'l\'axe relié à l\'objectif passe en tête du suivi');
  // un objectif ne crée ni priorité ni soin ciblé (règle existante conservée)
  for (const y of [tone, blem]) assert.deepEqual(y.tiers.priority, []);
  // objectif sur un point fort : on le dit, sans inventer d'axe
  const strong = run(Object.assign({ redness: 97 }, MIX), { fill: 86 }, { goals: ['redness_comfort'] }).synthesis;
  assert.equal(strong.goals.items[0].tier, 'strength');
  assert.match(strong.goals.items[0].text, /fait partie de vos points forts/);
});

test('S6 type de peau : contexte (étapes formulées différemment), jamais à lui seul un produit', () => {
  const oily = run(MIX, { skin: 'Oily', fill: 86 }), dry = run(MIX, { skin: 'Dry', fill: 86 });
  assert.notEqual(oily.synthesis.steps['morning:cleanse'], dry.synthesis.steps['morning:cleanse']);
  assert.notEqual(oily.synthesis.steps['morning:moisturize'], dry.synthesis.steps['morning:moisturize']);
  assert.match(oily.synthesis.strategy.skinContext, /jamais à lui seul le choix d'un produit/);
  // le type de peau seul ne fait choisir aucun produit réel
  assert.deepEqual(oily.productMatches.filter(m => m.kind !== 'treatment'), []);
});

test('S8 pays : la stratégie ne dépend pas du pays (le moteur ne le reçoit pas)', () => {
  const a = Engine.run(norm(REF, REF_O), { goals: ['tone'] }, { catalog: REAL, market: 'GH' }), b = Engine.run(norm(REF, REF_O), { goals: ['tone'] }, { catalog: REAL, market: 'BJ' });
  assert.deepEqual(a.synthesis, b.synthesis);
  for (const f of ['js/engine/synthesis.js', 'js/engine/index.js']) assert.doesNotMatch(code(f), /market|offer|country|price/i, f);
});

test('S9 / S10 masques : ni la présence, ni la forme d\'un masque ne changent l\'interprétation ; un score ne crée aucune localisation', () => {
  const n = norm(REF, REF_O), withLoc = Object.assign({}, n, { localization: { acne: ['data:image/png;base64,AAAA'] } });
  assert.deepEqual(Engine.run(withLoc, {}, { catalog: REAL }).synthesis, Engine.run(n, {}, { catalog: REAL }).synthesis);
  for (const f of ['js/engine/synthesis.js', 'js/engine/index.js', 'js/engine/priorities.js', 'js/engine/interpret.js']) assert.doesNotMatch(code(f), /mask|localization|facemap/i, f);
  const out = JSON.stringify(run({ acne: 20 }).synthesis);
  assert.doesNotMatch(out, /mask|localization|zone|coord/i);
});

test('S11 produit sans justification : jamais proposé ni présenté comme adapté ; justifié, il dit pourquoi et pourquoi lui', () => {
  for (let s = 1; s <= 400; s++) {
    const c = randomCase(s * 13 + 7), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: REAL });
    for (const m of r.productMatches) {
      const st = [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening].find(x => x.id === m.stepId);
      assert.ok(m.activeIds.length > 0, 'tout produit réel proposé contient ce que son étape recherche (' + m.productId + ')');
      assert.ok(st.kind === 'treatment' ? m.activeIds.includes(st.activeId) : m.activeIds.every(id => st.supportIds.includes(id)));
      assert.ok(['only', 'more_actives', 'skin', 'editorial', 'order'].includes(m.selection.rule));
      assert.match(r.synthesis.products[m.stepId].text, /(Ce soin le contient|actifs de soutien retenus).*(seul produit|Parmi \d+ produits)/);
    }
  }
  // le Cicaplast reste proposé quand sa composition répond à un besoin réel (soutien retenu), avec la raison
  const r = run({ redness: 45 }, { skin: 'Normal' }, { level: 'simple' });
  const m = r.productMatches.find(x => x.productId === 'lrp-cicaplast-baume-b5-plus');
  if (m) { assert.ok(m.activeIds.length > 0); assert.match(r.synthesis.products[m.stepId].text, /La marque le présente pour : rougeurs/); }
  assert.match(require('../js/engine/copy.fr.js').PRODUCT_REASONS.not_justified, /n'est donc pas proposé/);
});

test('S12 aucun objectif : la stratégie vient de l\'analyse seule, sans objectif inventé', () => {
  const y = run(MIX, { fill: 86 }).synthesis;
  assert.equal(y.goals.mode, 'none');
  assert.deepEqual(y.goals.items, []);
  assert.match(y.goals.text, /^Vous n'avez pas indiqué d'objectif/);
  assert.doesNotMatch(y.strategy.text, /objectif/);
});

test('S13 contour des yeux : informatif, jamais dans la hiérarchie ni la stratégie', () => {
  const y = run({ eyeBag: 15, darkCircle: 20, tearTrough: 25 }, { fill: 85 }).synthesis;
  const all = [...y.tiers.priority, ...y.tiers.attention, ...y.tiers.maintain, ...y.tiers.strength].map(i => i.id);
  for (const k of ['eyeBag', 'darkCircle', 'tearTrough', 'droopyUpperEyelid', 'droopyLowerEyelid']) assert.ok(!all.includes(k), k);
  assert.ok(y.informative.some(i => i.id === 'eyeBag'));
  assert.doesNotMatch(y.strategy.text, /poches|cernes|vallée/i);
});

test('S14 ancienne analyse ou données partielles : la synthèse fonctionne ; l\'historique garde son affichage', () => {
  const r = run({ acne: 55, pores: null, oiliness: null, texture: null, hydration: null, redness: null, pigmentation: null, wrinkles: null, firmness: null, radiance: null }, { skin: null });
  assert.deepEqual(ids(r.synthesis.tiers.priority), ['acne']);
  assert.equal(r.synthesis.strategy.skinContext, null);
  const app = read('js/app.js');
  assert.match(app, /\$\{H\?``:DermaiInsight\.found\(eng\.synthesis\)\}/);                 // analyse ancienne : pas de synthèse recalculée
  assert.match(app, /\$\{H\?Engine\.copy\.MAINTENANCE\.text:eng\.synthesis\.attention\}/);
});

test('S15 sémantique Perfect Corp et déterminisme : un score plus élevé n\'est jamais moins favorable ; mêmes entrées, même sortie', () => {
  for (let s = 1; s <= 600; s++) {
    const c = randomCase(s * 29 + 3), n = norm(c.ui, c.o);
    const a = Engine.run(n, c.profile, { catalog: REAL }), b = Engine.run(n, c.profile, { catalog: REAL });
    assert.deepEqual(a.synthesis, b.synthesis);
    const y = a.synthesis;
    const att = y.tiers.attention.filter(i => i.band === 'good'), str = y.tiers.strength;
    if (att.length && str.length) assert.ok(Math.max(...att.map(i => i.score)) <= Math.min(...str.map(i => i.score)), 'profil #' + s);
    for (const t of ['priority', 'attention', 'maintain', 'strength']) for (const i of y.tiers[t]) assert.equal(i.score, a.interpretation.indicators.find(x => x.id === i.id).score, 'score inchangé');
    // groupes plafonnés à MAX_PRIORITIES (3) dans la plage « Bien » ; les indicateurs « à soutenir » non retenus restent tous visibles (jamais masqués)
    assert.ok(att.length <= 3 && y.tiers.strength.length <= 3);
    for (const i of y.tiers.attention.filter(x => x.band !== 'good')) assert.ok(!y.tiers.priority.some(p => p.id === i.id));
    assert.doesNotMatch(texts(y), /maladie|souffr|diagnostic|pathologi|traitement|guéri|parfait|undefined|NaN|null/i, 'profil #' + s);
  }
  // aucune nouvelle valeur seuil : la synthèse lit les bandes existantes et TREND_STEP
  const src = code('js/engine/synthesis.js');
  assert.match(src, /skin\.BANDS/); assert.match(src, /skin\.TREND_STEP/); assert.match(src, /MAX_PRIORITIES/);
  assert.doesNotMatch(src, /\b(3[01]|6[01]|50|40|80|90)\b/);
});

test('S16 version des règles : changée, puisque la règle des produits change', () => {
  assert.equal(Engine.VERSION, '1.1.0');
});
