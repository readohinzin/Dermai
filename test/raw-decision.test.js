'use strict';
/* Étape 25 : décisions sur raw_score, affichage sur ui_score. Les 14 cas du cahier des charges (R1 à R14), plus les garde-fous de
   configuration et d'affichage (R15 à R18). Aucune analyse Perfect Corp, aucun réseau : normalized synthétiques seulement. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, norm } = require('./helpers/engine.js');
const P = require('../js/engine/products.js');
const C = require('../js/engine/data/catalog.js');
const DEC = require('../js/engine/data/decision.js');
const copy = require('../js/engine/copy.fr.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const REAL = C.PRODUCTS;
const run = (ui, o = {}, profile = {}) => Engine.run(norm(ui, Object.assign({ skin: 'Normal', rawFill: 80 }, o)), Object.assign({ goals: [], level: 'simple', cats: [] }, profile), { catalog: REAL });
const prio = r => r.priorities.items.map(i => i.indicator);
const tids = r => r.activePlan.treatments.map(t => t.activeId);
const ind = (r, id) => r.interpretation.indicators.find(i => i.id === id);
const allText = r => JSON.stringify([r.synthesis, r.explanations.map(e => e.text), r.personalization.headline]);

test('R1 ui élevé + raw faible → la décision suit le raw ; l\'écran garde le ui', () => {
  const r = run({ hydration: 67 }, { rawMap: { hydration: 42.08 } });
  assert.equal(r.interpretation.basis, 'raw');
  assert.deepEqual(prio(r), ['hydration']);
  const h = ind(r, 'hydration');
  assert.deepEqual([h.score, h.uiBand, h.value, h.band], [67, 'good', 42.08, 'mid']);
  assert.equal(r.priorities.items[0].score, 67, 'score affiché : ui');
  assert.doesNotMatch(allText(r), /42[.,]08|\b42\b/, 'aucune valeur brute dans un texte');
});

test('R2 ui bas + raw favorable → pas de sur-réaction (ni besoin, ni mode confort)', () => {
  const r = run({ acne: 25, redness: 20 }, { rawMap: { acne: 72, redness: 88 } });
  assert.deepEqual(prio(r), []);
  assert.equal(r.priorities.mode, 'maintenance');
  assert.equal(r.interpretation.context.comfortMode, false, 'rougeurs : décision sur raw (88), pas sur l\'écran (20)');
  assert.deepEqual(tids(r), []);
});

test('R3 le classement suit le raw (besoins retenus et résultats les moins élevés), jamais l\'écran', () => {
  // à l'écran : acné 50 < pores 70 ; en raw : pores 30 < acné 45
  const r = run({ acne: 50, pores: 70 }, { rawMap: { acne: 45, pores: 30 } });
  assert.deepEqual(prio(r), ['pores', 'acne']);
  // résultats les moins élevés : sélection sur raw (hydratation ui 90 mais raw 35 ; pigmentation ui 60 mais raw 75)
  const y = run({ hydration: 90, pigmentation: 60, acne: 70 }, { rawMap: { hydration: 35, pigmentation: 75, acne: 55 }, rawFill: 60 }).synthesis;
  assert.ok(y.tiers.priority.some(i => i.id === 'hydration'));
  assert.ok(y.tiers.lowest.some(i => i.id === 'hydration'));
  assert.ok(!y.tiers.lowest.some(i => i.id === 'pigmentation'), 'un ui plus bas ne suffit pas à classer un résultat parmi les moins élevés');
});

for (const [n, id, label] of [[4, 'oiliness', 'Niveau d\'huile'], [5, 'texture', 'Texture'], [6, 'firmness', 'Fermeté']]) {
  test(`R${n} ${id} : descriptif seulement, jamais de besoin ni d'actif automatique, même très bas et même avec un objectif`, () => {
    for (const goals of [[], ['oil_pores'], ['texture'], ['aging']]) {
      const r = run({ [id]: 10 }, { rawMap: { [id]: 5 } }, { goals, level: 'full' });
      assert.deepEqual(prio(r), [], goals.join());
      /* Étape 27 : un objectif peut ouvrir l'accompagnement d'un AUTRE indicateur du même domaine (huile et pores : les pores), jamais celui-ci. */
      assert.ok(!r.accompanimentItems.some(a => a.indicator === id), goals.join());
      for (const t of r.activePlan.treatments) { assert.equal(t.origin, 'accompaniment', goals.join()); assert.ok(!t.indicators.includes(id), goals.join()); }
      assert.equal(ind(r, id).role, 'descriptive');
    }
    const y = run({ [id]: 10 }, { rawMap: { [id]: 5 } }).synthesis;
    assert.match(y.sections.retained, new RegExp(label + ' \\(10\\) : résultat décrit sans soin ciblé automatique'));
    assert.equal(DEC.ROLES[id].role, 'descriptive');
  });
}

test('R7 radiance : information seulement, sauf objectif explicite + règle explicite ; favorable, jamais un problème', () => {
  const low = { radiance: 60 }, raw = { rawMap: { radiance: 30 } };
  const none = run(low, raw);
  assert.deepEqual(prio(none), []); assert.deepEqual(tids(none), []);
  assert.match(none.synthesis.sections.retained, /Radiance \(60\) : information seulement\. DERMAI n'y associe un soin que si vous choisissez l'objectif « teint et taches »\./);
  const tone = run(low, raw, { goals: ['tone'] });
  assert.deepEqual(prio(tone), ['radiance']);
  assert.deepEqual(tids(tone), ['vitamin_c'], 'règle existante (préférence validée), aucun nouvel actif');
  // objectif « éclat » (teint) + radiance favorable : aucun problème créé, aucun lien avec la protection solaire
  const fav = run({ radiance: 65 }, { rawMap: { radiance: 66.6 } }, { goals: ['tone'] });
  assert.deepEqual(prio(fav), []);
  assert.equal(fav.synthesis.goals.items[0].status, 'no_signal');
  assert.doesNotMatch(allText(fav), /radiance[^."]*(faible|besoin à soutenir|protection solaire)/i);
  assert.doesNotMatch(Object.values(copy.SYNTH.step).map(v => typeof v === 'function' ? (v.length >= 3 ? v('x', [], null) : v(['x'], [])) : JSON.stringify(v)).join(' '), /radiance|teint/i);
  // rides : même règle, objectif « rides et fermeté »
  assert.deepEqual(prio(run({ wrinkles: 60 }, { rawMap: { wrinkles: 30 } })), []);
  assert.deepEqual(prio(run({ wrinkles: 60 }, { rawMap: { wrinkles: 30 } }, { goals: ['aging'] })), ['wrinkles']);
});

test('R8 hydratation : peut agir (règle existante), avec les ingrédients de soutien de l\'hydratant', () => {
  const r = run({ hydration: 67 }, { rawMap: { hydration: 42 } });
  assert.deepEqual(prio(r), ['hydration']);
  const sup = r.activePlan.supports.map(s => s.activeId);
  assert.ok(sup.includes('hyaluronic'), sup.join());
  assert.match(r.synthesis.steps['morning:moisturize'], /^Cette étape fait partie de l'entretien de base\. DERMAI retient l'hydratation comme axe de soin dans cette analyse\. L'objectif est de soutenir le confort et l'hydratation de la peau\. Ingrédients recherchés dans l'hydratant : .+\.$/);
  assert.doesNotMatch(r.synthesis.steps['morning:moisturize'], /déshydrat/i);
});

test('R9 acné : peut agir (règle existante, règles de sécurité conservées)', () => {
  const r = run({ acne: 70 }, { rawMap: { acne: 20 } });
  assert.deepEqual(prio(r), ['acne']);
  assert.deepEqual(tids(r), ['salicylic']);
  const c = run({ acne: 70 }, { rawMap: { acne: 20 }, skin: 'Oily & Redness' });
  assert.deepEqual(tids(c), ['niacinamide'], 'mode confort : actif plus doux (règle de sécurité inchangée)');
});

test('R10 même analyse + objectif différent : l\'objectif ne départage que là où une base existe', () => {
  const ui = { hydration: 70, pores: 72, radiance: 75, texture: 66 }, o = { rawMap: { hydration: 45, pores: 44, radiance: 40, texture: 20 } };
  const a = run(ui, o), b = run(ui, o, { goals: ['hydration'] }), c = run(ui, o, { goals: ['tone'] }), d = run(ui, o, { goals: ['texture'] });
  assert.deepEqual(prio(a), ['pores', 'hydration']);
  assert.deepEqual(prio(b), ['hydration', 'pores']);
  assert.deepEqual(prio(c), ['radiance', 'pores', 'hydration']);
  assert.deepEqual(prio(d), prio(a), 'objectif texture : indicateur descriptif, aucune orientation');
  assert.equal(d.personalization.goals[0].status, 'descriptive');
  assert.notEqual(a.synthesis.strategy.text, b.synthesis.strategy.text);
});

test('R11 pays différent → moteur identique (le pays ne sert qu\'aux offres)', () => {
  const n = norm({ hydration: 67, pores: 64 }, { rawMap: { hydration: 42, pores: 41 }, rawFill: 80 });
  const a = Engine.run(n, { goals: ['tone'] }, { catalog: REAL, market: 'BJ' }), b = Engine.run(n, { goals: ['tone'] }, { catalog: REAL, market: 'CI' });
  assert.deepEqual(a, b);
  for (const f of ['js/engine/data/decision.js', 'js/engine/interpret.js', 'js/engine/priorities.js', 'js/engine/synthesis.js'])
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), /market|country|pays|offer/i, f);
});

test('R12 produit sans justification → aucun produit par défaut ; un produit proposé l\'est « par DERMAI »', () => {
  const r = run({}, { rawFill: 85 });
  assert.deepEqual(r.productMatches, []);
  const v = P.catalogView(r.routinePlan, r.productMatches, REAL);
  assert.equal(v.others.find(o => o.productId === 'lrp-cicaplast-baume-b5-plus').reason, 'not_justified');
  const act = run({ pores: 64 }, { rawMap: { pores: 30 } });
  for (const m of act.productMatches) assert.match(act.synthesis.products[m.stepId].text, /^Proposé par DERMAI\. /);
  assert.equal(copy.MARKET_TEXTS.recommended, 'Proposé par DERMAI');
  assert.doesNotMatch(JSON.stringify(copy), /Perfect ?Corp[^"]*recommand|recommand[^"]*Perfect ?Corp/i);
});

test('R13 analyse ancienne sans raw → compatibilité : score affiché et anciens repères, rien d\'inventé, jamais de mélange', () => {
  const old = run({ hydration: 55, pores: 70 }, { rawFill: undefined });
  assert.equal(old.interpretation.basis, 'ui');
  assert.deepEqual(prio(old), ['hydration'], 'hydratation 55 : sous l\'ancien repère 61');
  assert.ok(old.interpretation.indicators.every(i => i.rawScore === null), 'aucun rawScore reconstruit');
  assert.match(old.synthesis.sections.retained, /Analyse historique : données brutes non disponibles/);
  // rawScore partiel : jamais de mélange, toute l'analyse reste en compatibilité
  const partial = Engine.run(norm({ hydration: 55, pores: 70 }, { rawMap: { hydration: 90 } }), {});
  assert.equal(partial.interpretation.basis, 'ui');
  assert.deepEqual(prio(partial), ['hydration']);
  // historique : une analyse enregistrée avec ses rawScore est relue comme le jour même
  const app = read('js/app.js');
  assert.match(app, /rawScore:\(a\.rawMetrics\|\|\{\}\)\[k\]/);
  const live = norm({ hydration: 67 }, { rawMap: { hydration: 42.08 }, rawFill: 80 });
  const reread = M.sanitizeNormalized({ schemaVersion: M.SCHEMA_VERSION, normalized: Object.assign({ globalScore: 60, skinAge: 30, skinType: { whole: 'Normal' } },
    Object.fromEntries(M.METRIC_KEYS.map(k => [k, { uiScore: live[k].uiScore, rawScore: live[k].rawScore }]))) });
  assert.deepEqual(prio(Engine.run(reread, {})), prio(Engine.run(live, {})));
});

test('R14 aucune localisation déduite d\'un score : le moteur ne lit ni ne produit de zone', () => {
  const n = norm({ acne: 70 }, { rawMap: { acne: 20 }, rawFill: 80 });
  const withLoc = Object.assign({}, n, { localization: { pores: ['data:image/png;base64,AAAA'] } });
  assert.deepEqual(Engine.run(withLoc, {}, { catalog: REAL }), Engine.run(n, {}, { catalog: REAL }));
  assert.doesNotMatch(JSON.stringify(Engine.run(n, {}, { catalog: REAL })), /localization|mask|zone|coord|front|joue|nez|menton/i);
  for (const f of ['js/engine/data/decision.js', 'js/engine/interpret.js', 'js/engine/priorities.js', 'js/engine/synthesis.js'])
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), /mask|localization|zone/i, f);
});

test('R15 repères DERMAI provisoires : isolés dans une configuration identifiable, distincts de 61 / 31', () => {
  assert.equal(DEC.PROVISIONAL, true);
  assert.equal(DEC.PREFERRED_BASIS, 'raw');
  assert.deepEqual(DEC.RAW_BANDS.map(b => [b.key, b.min]), [['good', 50], ['mid', 25], ['low', 0]]);
  assert.deepEqual(DEC.LEGACY_UI_BANDS.map(b => b.min), [61, 31, 0], 'compatibilité seulement');
  const src = read('js/engine/data/decision.js');
  assert.match(src, /repères DERMAI provisoires/);
  assert.match(src, /rien de cela n'est fourni ni validé par Perfect Corp/);
  // aucun seuil ailleurs dans le moteur
  for (const f of ['js/engine/interpret.js', 'js/engine/priorities.js', 'js/engine/synthesis.js', 'js/engine/personalization.js'])
    assert.doesNotMatch(read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), /\b(25|3[01]|50|6[01])\b/, f);
  // rôles : actionnables, soumis à objectif, descriptifs, informatifs
  const by = role => Object.keys(DEC.ROLES).filter(k => DEC.ROLES[k].role === role);
  assert.deepEqual(by('actionable'), ['acne', 'pores', 'hydration', 'redness', 'pigmentation']);
  assert.deepEqual(by('goal_gated'), ['wrinkles', 'radiance']);
  assert.deepEqual(by('descriptive'), ['oiliness', 'texture', 'firmness']);
  assert.deepEqual(Object.keys(DEC.ROLES), M.METRIC_KEYS);
  // repères : 50 est favorable, 49,99 est sous le repère
  assert.deepEqual(prio(run({ pores: 64 }, { rawMap: { pores: 50 } })), []);
  assert.deepEqual(prio(run({ pores: 64 }, { rawMap: { pores: 49.99 } })), ['pores']);
  assert.equal(run({ pores: 64 }, { rawMap: { pores: 24.9 } }).priorities.items[0].band, 'low');
});

test('R16 affichage : score affiché /100, phrase d\'explication, aucun score brut ; « Vos résultats les moins élevés » ; « priorité » réservé à DERMAI', () => {
  const { DermaiInsight } = require('../js/insight-view.js');
  const r = run({ hydration: 67, pores: 64, texture: 67 }, { rawMap: { hydration: 42.08343029022217, pores: 41.18226081132889, texture: 49.07534718513489 } });
  const html = DermaiInsight.found(r.synthesis);
  for (const t of ['Ce que l\'analyse montre', 'Vos résultats les moins élevés', 'Ce que DERMAI retient', 'Votre stratégie']) assert.ok(html.includes(t), t);
  assert.ok(html.includes('Le score affiché est le repère utilisateur fourni par l\'analyse. Les décisions de personnalisation de DERMAI utilisent séparément les données brutes de l\'analyse.'));
  assert.doesNotMatch(html, /42[.,]08|41[.,]18|49[.,]07|raw|brut[^e]/i);
  assert.doesNotMatch(html, /axes? d'attention|Vos points forts/);
  const app = read('js/app.js'), iv = read('js/insight-view.js');
  assert.doesNotMatch(app + iv, /axes? d'attention/i);
  assert.match(app, /Retenu par DERMAI/);
  assert.match(app, /Proposés par DERMAI pour votre routine/);
  assert.doesNotMatch(app, /Recommandés pour votre routine|Produit recommandé/);
  assert.match(app, /<span class="c-score__unit">\/100<\/span>/);
});

test('R17 routine de base : « Cette étape fait partie de l\'entretien de base. », jamais « entretient votre score »', () => {
  for (const o of [{ rawFill: 85 }, { rawMap: { hydration: 30 } }, { rawFill: undefined }]) {
    const y = run({ hydration: 67 }, o, { goals: ['tone'] }).synthesis;
    for (const [id, t] of Object.entries(y.steps)) if (/cleanse|moisturize|spf/.test(id)) assert.ok(t.startsWith('Cette étape fait partie de l\'entretien de base.'), id);
    assert.doesNotMatch(JSON.stringify(y), /entretient (votre|vos|chaque)|votre score de|radiance[^."]*protection solaire|protection solaire[^."]*radiance/i);
  }
});

test('R18 vocabulaire : jamais « problème », jamais un diagnostic, sur 300 analyses avec rawScore', () => {
  const r0 = (s => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)(77);
  for (let k = 0; k < 300; k++) {
    const ui = {}, raw = {};
    for (const id of M.METRIC_KEYS) { raw[id] = 5 + r0() * 95; ui[id] = Math.min(99, Math.round(raw[id] + 10)); }
    const r = run(ui, { rawMap: raw, skin: ['Normal', 'Oily', 'Dry', 'Oily & Redness'][k % 4] }, { goals: [['tone'], ['aging'], [], ['hydration', 'texture']][k % 4], level: ['none', 'simple', 'full'][k % 3] });
    assert.doesNotMatch(allText(r), /probl[eè]me|maladie|diagnostic|pathologi|souffr|guéri/i, 'cas ' + k);
    assert.doesNotMatch(allText(r), /undefined|NaN/, 'cas ' + k);
    for (const it of r.priorities.items) assert.ok(['actionable', 'goal_gated'].includes(it.role) && ['low', 'mid'].includes(it.band));
  }
});
