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
const texts = y => [...Object.values(y.sections), y.goals.text, y.strategy.skinContext || '', y.scoreNote, ...Object.values(y.steps), ...Object.values(y.products).map(p => p.text)].join(' ');
const BASE = 'Cette étape fait partie de l\'entretien de base.';

/* Étape 25 : quatre parties distinctes (ce que l'analyse montre / vos résultats les moins élevés / ce que DERMAI retient / votre
   stratégie). Le cas de référence n'a pas de rawScore (seul l'écran a été relevé) : il est lu en compatibilité, rien n'est inventé. */
test('S0 scénario de référence (dernier résultat réel, sans rawScore) : quatre parties, aucun besoin inventé, aucun lien causal', () => {
  const r = run(REF, REF_O), y = r.synthesis;
  assert.equal(r.priorities.mode, 'maintenance');
  assert.equal(y.basis, 'ui', 'aucun rawScore : compatibilité');
  assert.deepEqual(ids(y.tiers.priority), []);
  assert.deepEqual(ids(y.tiers.lowest), ['radiance', 'oiliness', 'hydration']);
  assert.deepEqual(ids(y.tiers.strength), ['redness', 'pores', 'wrinkles']);
  assert.deepEqual(ids(y.tiers.other), ['texture', 'acne', 'pigmentation', 'firmness']);
  assert.deepEqual(y.titles, { shows: 'Ce que l\'analyse montre', lowest: 'Vos résultats les moins élevés', retained: 'Ce que DERMAI retient', strategy: 'Votre stratégie' });
  assert.equal(y.sections.shows, 'Votre analyse donne 10 indicateurs principaux, de 65 à 99 sur 100. Vos résultats les plus élevés : rougeurs (99), pores (81) et rides (79). Profil de peau indiqué par l\'analyse : peau grasse.');
  assert.equal(y.sections.lowest, 'Radiance (65), niveau d\'huile (67) et hydratation (67). Vos résultats les moins élevés correspondent à une comparaison entre les indicateurs analysés. Un résultat plus bas ne constitue pas automatiquement une priorité de soin.');
  assert.match(y.sections.retained, /^DERMAI ne retient ni priorité de soin ni axe à soutenir : aucun indicateur sur lequel DERMAI peut agir n'est sous ses repères\. Votre routine reste une routine d'entretien\./);
  assert.match(y.sections.retained, /Niveau d'huile \(67\) : résultat décrit sans soin ciblé automatique/);
  assert.match(y.sections.retained, /Analyse historique : données brutes non disponibles\. DERMAI applique ses repères au score affiché, sans rien reconstruire\./);
  assert.doesNotMatch(y.sections.retained, /radiance/i, 'une radiance favorable ne devient jamais un problème');
  assert.equal(y.sections.strategy, 'Stratégie : entretien de base (nettoyage doux, hydratation, protection solaire), adapté à votre profil (peau grasse). Aucun soin ciblé n\'est ajouté.');
  assert.equal(y.goals.text, 'Vous n\'avez pas indiqué d\'objectif : DERMAI s\'appuie sur votre analyse seule.');
  assert.equal(y.scoreNote, 'Le score affiché est le repère utilisateur fourni par l\'analyse. Les décisions de personnalisation de DERMAI utilisent séparément les données brutes de l\'analyse.');
  // étapes de base : dites telles quelles, sans lien causal avec un score
  for (const id of ['morning:cleanse', 'morning:moisturize', 'morning:spf', 'evening:cleanse', 'evening:moisturize']) assert.ok(y.steps[id].startsWith(BASE), id);
  assert.equal(y.steps['morning:spf'], BASE);
  assert.match(y.steps['morning:cleanse'], /profil gras/);
  assert.doesNotMatch(Object.values(y.steps).join(' '), /\(\d+\)|entretient|radiance|axes?/i);
  assert.doesNotMatch(texts(y), /entretient votre score|axes? d'attention|axes? à suivre|en suivant surtout|radiance[^.]*protection solaire|protection solaire[^.]*radiance/i);
  // produits : aucun par défaut ; le Cicaplast n'est pas présenté comme adapté
  assert.deepEqual(r.productMatches, []);
  assert.equal(y.products['morning:moisturize'].status, 'none');
  const v = P.catalogView(r.routinePlan, r.productMatches, REAL);
  assert.equal(v.others.find(o => o.productId === 'lrp-cicaplast-baume-b5-plus').reason, 'not_justified');
  // aucune valeur du scénario n'est écrite dans le code
  for (const f of ['js/engine/synthesis.js']) assert.doesNotMatch(code(f), /\b(65|67|69|70|72|75|78|79|81|99)\b/, f);
});

test('S1 cas 1 profil globalement favorable → entretien, rien ne se détache', () => {
  const r = run({}, { fill: 88 }), y = r.synthesis;
  assert.equal(r.priorities.mode, 'maintenance');
  assert.equal(y.strategy.mode, 'maintenance');
  assert.equal(y.homogeneous, true);
  assert.deepEqual(y.tiers.lowest, []);
  assert.match(y.sections.lowest, /très proches les uns des autres : aucun ne se détache/);
  assert.match(y.strategy.text, /^Stratégie : entretien de base/);
  assert.match(y.sections.retained, /^DERMAI ne retient ni priorité de soin ni axe à soutenir/);
});

test('S2 cas 2 un résultat sous les repères, avec une règle DERMAI → besoin retenu', () => {
  const y = run({ hydration: 40 }).synthesis;
  assert.deepEqual(ids(y.tiers.priority), ['hydration']);
  assert.match(y.sections.retained, /^Aucun indicateur ne ressort comme priorité forte\. En revanche, DERMAI retient un axe à soutenir : hydratation \(40\)\. D'après les données de l'analyse, ce résultat est sous les repères DERMAI/);
  assert.match(run({ hydration: 20, pores: 40 }).synthesis.sections.retained, /^DERMAI retient une priorité de soin : hydratation \(20\), et un axe à soutenir : pores \(40\)\./);
  assert.equal(y.strategy.mode, 'action');
});

test('S3 cas 3 deux besoins → hiérarchie : repère le plus bas d\'abord', () => {
  const y = run({ pigmentation: 45, acne: 25 }).synthesis;
  assert.deepEqual(ids(y.tiers.priority), ['acne', 'pigmentation']);
  assert.match(y.strategy.text, /^Stratégie : soutenir acné \(25\) et pigmentation \(45\) avec/);
});

const MIX = { radiance: 65, acne: 67, pigmentation: 72 };
test('S4 / S5 / S7 objectifs : même analyse, objectifs différents → stratégie différente seulement s\'il existe une base exploitable', () => {
  const ui = { hydration: 50, pores: 55, radiance: 45 };
  const none = run(ui).synthesis, pores = run(ui, {}, { goals: ['oil_pores'] }).synthesis, tone = run(ui, {}, { goals: ['tone'] }).synthesis;
  assert.deepEqual(none.strategy.focus, ['hydration', 'pores'], 'radiance : information seulement sans objectif');
  assert.deepEqual(pores.strategy.focus, ['pores', 'hydration'], 'l\'objectif départage dans le même repère');
  assert.deepEqual(tone.strategy.focus, ['radiance', 'hydration', 'pores'], 'objectif « teint » + radiance sous les repères : règle explicite ouverte');
  assert.notEqual(none.strategy.text, pores.strategy.text); assert.notEqual(none.strategy.text, tone.strategy.text);
  assert.match(none.sections.retained, /Radiance \(45\) : information seulement\. DERMAI n'y associe un soin que si vous choisissez l'objectif « teint et taches »\./);
  assert.match(pores.goals.items[0].text, /^Niveau d'huile et pores : rejoint un besoin retenu par DERMAI \(pores \(55\)\)/);
  // objectif « éclat / teint » avec une radiance favorable : aucun problème créé
  const fav = run(MIX, { fill: 86 }, { goals: ['tone'] }), y = fav.synthesis;
  assert.deepEqual(fav.priorities.items, []);
  assert.equal(y.goals.items[0].status, 'no_signal');
  assert.match(y.goals.items[0].text, /^Teint et taches : radiance \(65\) et pigmentation \(72\) ne font pas ressortir de besoin selon les repères DERMAI : aucun soin ciblé n'est ajouté à ce titre\.$/);
  assert.doesNotMatch(texts(y), /radiance \(65\)[^.]*(besoin à soutenir|sous les repères DERMAI :)/);
  // objectif sur un résultat élevé : on le dit, sans inventer de besoin
  const strong = run(Object.assign({ redness: 97 }, MIX), { fill: 86 }, { goals: ['redness_comfort'] }).synthesis;
  assert.equal(strong.goals.items[0].status, 'no_signal');
  assert.deepEqual(strong.tiers.priority, []);
});

test('S6 type de peau : contexte (étapes formulées différemment), jamais à lui seul un produit ni une priorité', () => {
  const oily = run(MIX, { skin: 'Oily', fill: 86 }), dry = run(MIX, { skin: 'Dry', fill: 86 });
  assert.notEqual(oily.synthesis.steps['morning:cleanse'], dry.synthesis.steps['morning:cleanse']);
  assert.notEqual(oily.synthesis.steps['morning:moisturize'], dry.synthesis.steps['morning:moisturize']);
  assert.match(oily.synthesis.strategy.skinContext, /jamais à lui seul le choix d'un soin/);
  assert.deepEqual(oily.priorities.items, []); assert.deepEqual(dry.priorities.items, []);
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
      assert.match(r.synthesis.products[m.stepId].text, /^Proposé par DERMAI\. Choisi parce qu'il contient (l'actif recherché pour cet axe|les ingrédients recherchés pour l'hydratation) : .*(seul produit|Parmi \d+ produits)/);
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
  assert.equal(y.goals.text, 'Vous n\'avez pas indiqué d\'objectif : DERMAI s\'appuie sur votre analyse seule.');
  assert.doesNotMatch(y.strategy.text, /objectif/);
});

test('S13 contour des yeux : informatif, jamais dans la hiérarchie ni la stratégie', () => {
  const y = run({ eyeBag: 15, darkCircle: 20, tearTrough: 25 }, { fill: 85 }).synthesis;
  const all = [...y.tiers.priority, ...y.tiers.lowest, ...y.tiers.other, ...y.tiers.strength].map(i => i.id);
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
  assert.match(app, /\$\{Engine\.copy\.MAINTENANCE\.text\}/);
});

test('S15 sémantique Perfect Corp et déterminisme : un résultat plus élevé n\'est jamais moins favorable ; mêmes entrées, même sortie', () => {
  const val = (a, id) => a.interpretation.indicators.find(x => x.id === id);
  for (let s = 1; s <= 600; s++) {
    const c = randomCase(s * 29 + 3), n = norm(c.ui, c.o);
    const a = Engine.run(n, c.profile, { catalog: REAL }), b = Engine.run(n, c.profile, { catalog: REAL });
    assert.deepEqual(a.synthesis, b.synthesis);
    const y = a.synthesis, low = y.tiers.lowest, str = y.tiers.strength;
    if (low.length && str.length) assert.ok(Math.max(...low.map(i => val(a, i.id).value)) <= Math.min(...str.map(i => val(a, i.id).value)), 'profil #' + s);
    for (const t of ['priority', 'lowest', 'other', 'strength']) for (const i of y.tiers[t]) assert.equal(i.score, val(a, i.id).score, 'score affiché inchangé');
    assert.ok(low.length <= 3 && str.length <= 3);
    for (const i of y.tiers.priority) assert.ok(i.band === 'low' || i.band === 'mid', 'un besoin retenu est toujours sous les repères');
    assert.doesNotMatch(texts(y), /maladie|souffr|diagnostic|pathologi|traitement|guéri|parfait|probl[eè]me|undefined|NaN|null/i, 'profil #' + s);
  }
  // aucune valeur seuil dans la synthèse : elle lit la configuration de décision (data/decision.js) et MAX_PRIORITIES
  const src = code('js/engine/synthesis.js');
  assert.match(src, /DEC\.TIE_TOLERANCE/); assert.match(src, /MAX_PRIORITIES/);
  assert.doesNotMatch(src, /\b(25|3[01]|50|6[01]|40|80|90)\b/);
});

test('S16 version des règles : 1.3.0 (accompagnement des indicateurs good) ; 1.2.0 : les décisions passent sur le rawScore', () => {
  assert.equal(Engine.VERSION, '1.3.0');
});
