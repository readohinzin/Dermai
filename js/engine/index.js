/* Point d'entrée du moteur d'interprétation cosmétique : normalized (+ profil) → interprétation, priorités, actifs, routine, produits.
   Fonctions pures, déterministes, sans DOM, sans réseau, sans IA, sans dépendance à Perfect Corp (seulement le contrat normalized de
   skin-model.js). L'interface (app.js) ne fait qu'appeler run() et afficher. Chaque décision est tracée dans `explanations`. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { indicators: require('./data/indicators.js'), activesData: require('./data/actives.js'), interpret: require('./interpret.js'), priorities: require('./priorities.js'),
        actives: require('./actives.js'), routine: require('./routine.js'), products: require('./products.js'), copy: require('./copy.fr.js'), skin: require('../skin-model.js') }
    : { indicators: E.indicatorsData, activesData: E.activesData, interpret: E.interpret, priorities: E.priorities, actives: E.actives, routine: E.routine,
        products: E.products, copy: E.copy, skin: root.SkinModel };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); Object.assign(NS, api); }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const D = dep.indicators, A = dep.activesData, copy = dep.copy;
  const GOAL_IDS = D.GOALS.map(g => g.id);

  /* Profil : objectifs connus (3 au maximum), niveau de routine connu (sinon « simple »), catégories de produits déjà utilisées. */
  function normalizeProfile(profile) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const goals = (Array.isArray(p.goals) ? p.goals : []).filter((g, i, a) => GOAL_IDS.includes(g) && a.indexOf(g) === i).slice(0, D.MAX_GOALS);
    const level = A.LIMITS[p.level] ? p.level : A.DEFAULT_LEVEL;
    const cats = (Array.isArray(p.cats) ? p.cats : []).filter(c => typeof c === 'string');
    return { goals, level, cats };
  }

  /* Choix des objectifs : « none » efface ; 3 au maximum ; l'absence d'objectif n'est jamais une information négative. */
  function toggleGoal(goals, id) {
    const cur = Array.isArray(goals) ? goals : [];
    if (id === 'none') return { goals: [], limited: false };
    if (!GOAL_IDS.includes(id)) return { goals: cur, limited: false };
    if (cur.includes(id)) return { goals: cur.filter(g => g !== id), limited: false };
    if (cur.length >= D.MAX_GOALS) return { goals: cur, limited: true };
    return { goals: [...cur, id], limited: false };
  }
  const goalList = () => D.GOALS.map(g => ({ id: g.id, label: copy.GOAL_LABELS[g.id] }));

  function run(normalized, profile) {
    const prof = normalizeProfile(profile);
    const interpretation = dep.interpret.interpret(normalized);
    const priorities = dep.priorities.compute(interpretation, prof);
    const activePlan = dep.actives.select(priorities.items, interpretation, prof);
    const routinePlan = dep.routine.build(interpretation, priorities, activePlan, prof);
    activePlan.deferred = routinePlan.deferred;              // inclut les actifs écartés faute de place dans un créneau
    const productMatches = dep.products.match(routinePlan);

    const explanations = [];
    const idx = id => { const i = interpretation.indicators.find(x => x.id === id); return i ? `${id}=${i.score} (${i.band})` : id; };
    explanations.push({ kind: 'mode', text: priorities.mode === 'maintenance' ? copy.MAINTENANCE.title : copy.summary(priorities.items.map(i => i.label), 'action'),
      trace: { source: 'priorities.items=' + priorities.items.length, rule: 'mode', result: priorities.mode } });
    for (const it of priorities.items) {
      explanations.push({ kind: 'priority', indicator: it.indicator, text: it.reason,
        trace: { source: idx(it.indicator) + (it.objectiveMatch ? ' + objectif ' + it.domain : ''), rule: 'éligibilité (bande, levier) puis ordre (bande, objectif, score)', result: 'priorité ' + it.rank } });
    }
    for (const t of activePlan.treatments) {
      const a = dep.actives.byId(t.activeId);
      explanations.push({ kind: 'active', activeId: t.activeId, text: copy.activeReason(t.indicators.map(i => dep.skin.METRIC_LABELS[i]), t.gentleFallback),
        trace: { source: t.indicators.map(idx).join(', '), rule: 'préférence éditoriale validée (' + a.status + ')', result: 'soin ciblé ' + a.id } });
    }
    for (const s of activePlan.supports) {
      explanations.push({ kind: 'support', activeId: s.activeId, text: copy.supportReason(s.indicators.map(i => dep.skin.METRIC_LABELS[i])),
        trace: { source: s.indicators.length ? s.indicators.map(idx).join(', ') : 'contexte ' + (interpretation.context.comfortMode ? 'confort' : 'peau sèche'),
          rule: 'préférence éditoriale validée', result: 'ingrédient d\'hydratant ' + s.activeId } });
    }
    for (const d of activePlan.deferred) {
      explanations.push({ kind: 'deferred', activeId: d.activeId, text: copy.DEFERRED[d.kind],
        trace: { source: d.indicators.map(idx).join(', '), rule: d.kind, result: 'écarté ' + d.activeId } });
    }
    if (interpretation.context.comfortMode) {
      explanations.push({ kind: 'context', text: copy.NOTES.comfort,
        trace: { source: interpretation.context.comfortReasons.join(', '), rule: 'mode confort', result: 'actifs doux d\'abord' } });
    }
    if (priorities.eyeInfo) explanations.push({ kind: 'info', text: priorities.eyeInfo, trace: { source: priorities.informational.map(i => idx(i.indicator)).join(', '), rule: 'contour des yeux : information seulement', result: 'aucun actif' } });

    return { profile: prof, interpretation, priorities, activePlan, routinePlan, productMatches, explanations };
  }

  return { run, normalizeProfile, toggleGoal, goalList, MAX_GOALS: D.MAX_GOALS };
});
