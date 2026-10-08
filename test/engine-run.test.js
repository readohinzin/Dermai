'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, norm, run, randomCase } = require('./helpers/engine.js');
const FX = require('./fixtures/perfectcorp-json-response.json');

const ROOT = path.join(__dirname, '..');
const stripJs = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const engineFiles = () => {
  const out = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && out.push(path.join(d, e.name))));
  walk(path.join(ROOT, 'js/engine'));
  return out;
};

test('RUN1 sortie centrale : interpretation, priorities, activePlan, routinePlan, productMatches, explanations', () => {
  const r = Engine.run(M.parseSkinResponse(FX).normalized, { goals: ['tone'], level: 'simple', cats: [] });
  assert.deepEqual(Object.keys(r).sort(), ['activePlan', 'explanations', 'interpretation', 'personalization', 'priorities', 'productMatches', 'profile', 'routinePlan', 'synthesis']);
  assert.equal(r.interpretation.indicators.length, 15);
  assert.ok(['action', 'maintenance'].includes(r.priorities.mode));
});

test('RUN2 chaque décision est traçable : donnée source → règle → résultat', () => {
  const r = run({ acne: 30, pigmentation: 40, wrinkles: 45, darkCircle: 20 }, { skin: 'Dry & Redness' }, { goals: ['aging'], level: 'full' });
  assert.ok(r.explanations.length > 0);
  for (const e of r.explanations) {
    assert.ok(typeof e.kind === 'string' && typeof e.text === 'string' && e.text.length > 0, JSON.stringify(e));
    for (const f of ['source', 'rule', 'result']) assert.ok(typeof e.trace[f] === 'string' && e.trace[f].length > 0, `${e.kind}.${f}`);
  }
  const kinds = new Set(r.explanations.map(e => e.kind));
  for (const k of ['mode', 'priority', 'active', 'context', 'info']) assert.ok(kinds.has(k), k);
  const p = r.explanations.find(e => e.kind === 'priority' && e.indicator === 'acne');
  assert.match(p.trace.source, /^acne=30 \(ui, low\)/);   // valeur de décision, sa base (ui : compatibilité, aucun rawScore) et le repère
  const withRaw = run({ acne: 70 }, { rawMap: { acne: 22.5 }, rawFill: 80 });
  assert.match(withRaw.explanations.find(e => e.kind === 'priority').trace.source, /^acne=22\.5 \(raw, low\)/);
  assert.doesNotMatch(JSON.stringify(withRaw.explanations.map(e => e.text)), /22\.5/, 'la valeur brute reste dans la trace interne, jamais dans un texte');
  assert.equal(p.trace.result, 'priorité 1');
});

test('RUN3 jamais de score global ni d\'âge cutané dans la décision (le rawScore, lui, décide : étape 25)', () => {
  const ui = { acne: 35, pores: 50, hydration: 20, firmness: 55 };
  const base = run(ui, { global: 5, age: 70 }, { goals: ['aging'], level: 'full' });
  for (const o of [{ global: 99, age: 18 }, { global: null, age: null }]) {
    const x = run(ui, o, { goals: ['aging'], level: 'full' });
    for (const part of ['priorities', 'activePlan', 'routinePlan', 'productMatches']) assert.deepEqual(x[part], base[part], part + ' ' + JSON.stringify(o));
  }
  assert.equal(base.interpretation.skinAge, 70);          // l'âge reste disponible comme information
});

test('RUN4 données absentes : global, âge, type de peau, scores absents → aucun 0, aucun NaN, le moteur fonctionne', () => {
  const r = run({ acne: null, pores: null }, { global: null, age: null, skin: null });
  const text = JSON.stringify(r);
  assert.equal(text.includes('NaN'), false);
  assert.equal(r.interpretation.global.score, null);
  assert.equal(r.interpretation.skinAge, null);
  assert.equal(r.interpretation.skinType, null);
  assert.ok(r.interpretation.indicators.filter(i => ['acne', 'pores'].includes(i.id)).every(i => i.score === null && i.band === null));
  assert.ok(r.priorities.items.every(i => i.score > 0 && !['acne', 'pores'].includes(i.indicator)) || r.priorities.items.length === 0);
  const all = Engine.run(norm(Object.fromEntries(M.METRIC_KEYS.map(k => [k, null])), { global: null, age: null, skin: null }), {});
  assert.equal(all.priorities.mode, 'maintenance');
});

test('RUN5 profil : objectifs filtrés (3 au plus, connus, sans doublon), niveau inconnu → simple', () => {
  assert.deepEqual(Engine.normalizeProfile({ goals: ['hydration', 'hydration', 'x', 'tone', 'aging', 'texture'], level: 'wow', cats: ['spf', 3] }),
    { goals: ['hydration', 'tone', 'aging'], level: 'simple', cats: ['spf'], comfort: { preferGentle: false }, exclusions: [] });
  assert.deepEqual(Engine.normalizeProfile(null), { goals: [], level: 'simple', cats: [], comfort: { preferGentle: false }, exclusions: [] });
});

test('RUN6 objectifs : « Aucun » efface, 3 au maximum, retrait possible, valeur inconnue ignorée', () => {
  let g = [];
  for (const id of ['hydration', 'tone', 'aging']) g = Engine.toggleGoal(g, id).goals;
  assert.deepEqual(g, ['hydration', 'tone', 'aging']);
  const over = Engine.toggleGoal(g, 'texture');
  assert.deepEqual([over.goals, over.limited], [g, true]);
  assert.deepEqual(Engine.toggleGoal(g, 'tone').goals, ['hydration', 'aging']);
  assert.deepEqual(Engine.toggleGoal(g, 'none'), { goals: [], limited: false });
  assert.deepEqual(Engine.toggleGoal(['tone'], 'zzz').goals, ['tone']);
  const list = Engine.goalList();
  assert.deepEqual(list.map(x => x.id), ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance']);
  assert.ok(list.every(x => x.label.length > 0));
});

test('RUN7 aucun objectif pré-coché : le profil vide est valide et n\'altère pas le résultat', () => {
  const ui = { pores: 40 };
  assert.deepEqual(run(ui, {}, { goals: [] }).priorities, run(ui, {}, { goals: undefined }).priorities);
});

test('RUN8 le moteur est indépendant de l\'interface et de Perfect Corp (aucun DOM, aucun nom de fournisseur ; rawScore lu à un seul endroit)', () => {
  for (const f of engineFiles()) {
    const code = stripJs(fs.readFileSync(f, 'utf8'));
    assert.doesNotMatch(code, /\bdocument\b|\bwindow\.|localStorage|fetch\(|XMLHttpRequest/, f);
    assert.doesNotMatch(code, /raw_score|perfect ?corp|youcam/i, f);
    /* Étape 25 : rawScore (contrat normalized de skin-model.js) n'est lu que par l'interprétation ; les autres couches lisent `value`. */
    if (!f.endsWith('interpret.js')) assert.doesNotMatch(code, /rawScore/, f);
  }
});

test('RUN9 aucune règle métier du moteur dans app.js : ni catalogue, ni conflit, ni priorité, ni « correspondance » affichée', () => {
  const app = stripJs(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));
  assert.doesNotMatch(app, /\bconst (?:ACTIVES|PRODUCTS|AM|PM|GOALS)\b/);
  assert.doesNotMatch(app, /evening_strong|\.irritation\b|\.groups\b|PREFERENCE|CONFLICT_RULES|LIMITS/);
  assert.doesNotMatch(app, /\bp\.match\b|\.match\s*-|\$\{p\.match/);
  assert.match(app, /DermaiEngine/);
  assert.match(app, /Engine\.run\(/);
});

test('RUN10 textes qui prétendaient à une personnalisation : retirés de l\'interface', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  for (const bad of ['Vos deux priorités sont la pigmentation', 'Choisis selon les actifs dont votre peau a besoin', 'Choisis selon votre profil', 'Correspondance avec votre profil', 'Les ingrédients qui correspondent aux préoccupations observées',
    'Touchez une préoccupation pour voir les zones concernées', 'Zones concernées', 'Huit repères visibles', 'Exemple : Amina', 'Priorité : pigmentation', 'Acide azélaïque le soir, vitamine C le matin',
    'Évitez de toucher ou de gratter les zones concernées', 'cela les agrandit visuellement', 'Changez régulièrement de taie d\'oreiller', 'Liens d\'achat au Bénin', 'Textes provisoires', 'prêt (simulation)'])
    assert.ok(!app.includes(bad), bad);
});

test('RUN11 la page charge les modules du moteur dans le bon ordre, avant app.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  const need = ['js/skin-model.js', 'js/engine/data/indicators.js', 'js/engine/data/decision.js', 'js/engine/data/actives.js', 'js/engine/data/products.js', 'js/engine/copy.fr.js', 'js/engine/interpret.js',
    'js/engine/actives.js', 'js/engine/priorities.js', 'js/engine/personalization.js', 'js/engine/routine.js', 'js/engine/products.js', 'js/engine/index.js', 'js/app.js'];
  const idx = need.map(n => order.indexOf(n));
  assert.ok(idx.every(i => i >= 0), JSON.stringify(idx));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'ordre de chargement');
});

test('RUN12 déterminisme global : 100 jeux, deux exécutions identiques, structure stable', () => {
  for (let seed = 5000; seed < 5100; seed++) {
    const c = randomCase(seed);
    assert.deepEqual(run(c.ui, c.o, c.profile), run(c.ui, c.o, c.profile), 'seed ' + seed);
  }
});
