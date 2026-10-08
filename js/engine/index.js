/* Point d'entrée du moteur d'interprétation cosmétique : normalized (+ profil) → interprétation, priorités, actifs, routine, produits.
   Fonctions pures, déterministes, sans DOM, sans réseau, sans IA, sans dépendance à Perfect Corp (seulement le contrat normalized de
   skin-model.js). L'interface (app.js) ne fait qu'appeler run() et afficher. Chaque décision est tracée dans `explanations`. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { indicators: require('./data/indicators.js'), activesData: require('./data/actives.js'), interpret: require('./interpret.js'), priorities: require('./priorities.js'), accompaniment: require('./accompaniment.js'),
        actives: require('./actives.js'), personalization: require('./personalization.js'), routine: require('./routine.js'), products: require('./products.js'), synthesis: require('./synthesis.js'), copy: require('./copy.fr.js'), skin: require('../skin-model.js') }
    : { indicators: E.indicatorsData, activesData: E.activesData, interpret: E.interpret, priorities: E.priorities, accompaniment: E.accompaniment, actives: E.actives, personalization: E.personalization, routine: E.routine,
        products: E.products, synthesis: E.synthesis, copy: E.copy, skin: root.SkinModel };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); Object.assign(NS, api); }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const D = dep.indicators, A = dep.activesData, copy = dep.copy;
  const GOAL_IDS = D.GOALS.map(g => g.id);

  /* Version des règles cosmétiques (priorités, personnalisation, actifs, routine). Enregistrée avec chaque analyse de l'historique pour que
     l'on sache avec quelles règles elle a été produite. À changer dès qu'une règle modifie une priorité ou une recommandation. */
  const VERSION = '1.3.0';   // 1.1.0 : un produit réel n'est plus proposé sans justification (étape 22)
                             // 1.2.0 : décisions sur raw_score (repères DERMAI provisoires), rôles des indicateurs, ui_score pour l'affichage seulement
                             // 1.3.0 : accompagnement des indicateurs « good » (deuxième voie après les priorités ; les priorités LOW/MID sont inchangées)

  /* Profil : objectifs connus (3 au maximum), niveau de routine connu (sinon « simple »), catégories de produits déjà utilisées,
     confort demandé par l'utilisateur (préférence cosmétique) et exclusions (actifs que l'utilisateur ne souhaite pas, jamais une donnée de santé).
     Le type de peau n'est pas saisi : il vient de l'analyse (contexte). Aucune persistance ici : l'état courant de l'application suffit. */
  function normalizeProfile(profile) {
    const p = profile && typeof profile === 'object' ? profile : {};
    const goals = (Array.isArray(p.goals) ? p.goals : []).filter((g, i, a) => GOAL_IDS.includes(g) && a.indexOf(g) === i).slice(0, D.MAX_GOALS);
    const level = A.LIMITS[p.level] ? p.level : A.DEFAULT_LEVEL;
    const cats = (Array.isArray(p.cats) ? p.cats : []).filter(c => typeof c === 'string');
    const comfort = { preferGentle: !!(p.comfort && p.comfort.preferGentle) };
    const exclusions = (Array.isArray(p.exclusions) ? p.exclusions : []).filter((id, i, a) => typeof id === 'string' && a.indexOf(id) === i && dep.actives.byId(id));
    return { goals, level, cats, comfort, exclusions };
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

  /* Chaîne complète : mesures → priorités → personnalisation → actifs → routine → produits. Le contexte effectif (confort demandé par
     l'analyse ou par l'utilisateur) est partagé par les actifs et la routine. */
  function core(normalized, prof) {
    const interpretation = dep.interpret.interpret(normalized);
    const priorities = dep.priorities.compute(interpretation, prof);
    const axes = dep.accompaniment.compute(interpretation, priorities, prof);           // 1. axes d'accompagnement (après les priorités, sans les modifier)
    const pers = dep.personalization.build(interpretation, priorities, prof);
    const eff = Object.assign({}, interpretation, { context: Object.assign({}, interpretation.context, pers.context) });
    const priorityPlan = dep.actives.select(priorities.items, eff, prof);               // plan des priorités : inchangé
    const added = dep.actives.addAccompaniment(priorityPlan, axes.items, prof);          // 2. recommandation, 3. soin ajouté si les règles le permettent
    const activePlan = added.plan;
    const routinePlan = dep.routine.build(eff, priorities, activePlan, prof);
    activePlan.deferred = routinePlan.deferred;              // inclut les actifs écartés faute de place dans un créneau
    /* Le soin n'est « ajouté » que s'il est réellement dans la routine : un créneau plein le renvoie à « identifié ». */
    const inRoutine = id => [...routinePlan.slots.morning, ...routinePlan.slots.evening].some(s => s.kind === 'treatment' && s.activeId === id);
    for (const r of added.recommendations) if (r.status === 'added' && !inRoutine(r.activeId)) { r.status = 'identified'; r.blocked = 'slot'; }
    const accompaniment = Object.assign({}, axes, { recommendations: added.recommendations });
    return { interpretation, eff, priorities, accompaniment, pers, activePlan, routinePlan };
  }

  /* options.previous : normalized de l'analyse précédente (comparaison seulement, jamais traitée comme l'analyse courante). */
  function run(normalized, profile, options) {
    const prof = normalizeProfile(profile);
    const cur = core(normalized, prof);
    const { interpretation, eff, priorities, accompaniment, pers, activePlan, routinePlan } = cur;
    /* options.catalog : catalogue de produits à utiliser (réel ou démonstration, choisi par l'appelant). Le catalogue n'agit QUE sur cette dernière couche. */
    const productMatches = dep.products.match(routinePlan, options && options.catalog);
    const prev = options && options.previous ? core(options.previous, prof) : null;
    const personalization = dep.personalization.finalize(pers, eff, priorities, activePlan, routinePlan, prev);

    const explanations = [];
    /* Trace interne (jamais affichée) : valeur de décision, sa base (raw ou ui en compatibilité) et le repère. */
    const idx = id => { const i = interpretation.indicators.find(x => x.id === id); return i ? `${id}=${i.value} (${i.basis}, ${i.band})` : id; };
    explanations.push({ kind: 'mode', text: priorities.mode === 'maintenance' ? copy.MAINTENANCE.title : copy.summary(priorities.items.map(i => i.label), 'action'),
      trace: { source: 'priorities.items=' + priorities.items.length, rule: 'mode', result: priorities.mode } });
    for (const it of priorities.items) {
      explanations.push({ kind: 'priority', indicator: it.indicator, text: it.reason,
        trace: { source: idx(it.indicator) + (it.objectiveMatch ? ' + objectif ' + it.domain : ''), rule: 'éligibilité (repère, rôle, levier) puis ordre (repère, objectif, valeur de décision)', result: 'priorité ' + it.rank } });
    }
    for (const t of activePlan.treatments) {
      const a = dep.actives.byId(t.activeId);
      if (t.origin === 'accompaniment') {
        explanations.push({ kind: 'accompaniment', activeId: t.activeId, text: copy.accompanimentStep(a.label, t.indicators.map(i => dep.skin.METRIC_LABELS[i])),
          trace: { source: t.indicators.map(idx).join(', '), rule: 'accompagnement : axe distinct, objectif ou débordement ; actif doux validé ; étape ajoutée (objectif ou convergence)', result: 'soin d\'accompagnement ' + a.id } });
        continue;
      }
      explanations.push({ kind: 'active', activeId: t.activeId, text: copy.activeReason(t.indicators.map(i => dep.skin.METRIC_LABELS[i]), t.gentleFallback, t.indicators.filter(i => a.evidence.editorial.includes(i)).map(i => dep.skin.METRIC_LABELS[i])),
        trace: { source: t.indicators.map(idx).join(', '), rule: 'préférence éditoriale validée (' + a.status + ')', result: 'soin ciblé ' + a.id } });
    }
    for (const s of activePlan.supports) {
      explanations.push({ kind: 'support', activeId: s.activeId, text: copy.supportReason(s.indicators.map(i => dep.skin.METRIC_LABELS[i])),
        trace: { source: s.indicators.length ? s.indicators.map(idx).join(', ') : 'contexte ' + (eff.context.comfortMode ? 'confort' : 'peau sèche'),
          rule: 'préférence éditoriale validée', result: 'ingrédient d\'hydratant ' + s.activeId } });
    }
    for (const d of activePlan.deferred) {
      explanations.push({ kind: 'deferred', activeId: d.activeId, text: copy.DEFERRED[d.kind],
        trace: { source: d.indicators.map(idx).join(', '), rule: d.kind, result: 'écarté ' + d.activeId } });
    }
    for (const g of personalization.goals) explanations.push({ kind: 'goal', goal: g.id, text: g.text, trace: { source: 'objectif ' + g.id, rule: 'les objectifs départagent ; ils n\'ouvrent radiance ou rides qu\'avec leur objectif, sous les repères, jamais un résultat favorable', result: g.status } });
    if (eff.context.comfortMode) {
      explanations.push({ kind: 'context', text: eff.context.comfortReasons.join() === 'user_preference' ? copy.PERSONAL.comfortUser : copy.NOTES.comfort,
        trace: { source: eff.context.comfortReasons.join(', '), rule: 'mode confort', result: 'actifs doux d\'abord' } });
    }
    if (priorities.eyeInfo) explanations.push({ kind: 'info', text: priorities.eyeInfo, trace: { source: priorities.informational.map(i => idx(i.indicator)).join(', '), rule: 'contour des yeux : information seulement', result: 'aucun actif' } });

    /* Synthèse personnalisée : lecture des décisions ci-dessus (rien de nouveau n'est décidé ici). */
    const synthesis = dep.synthesis.build({ interpretation, priorities, profile: prof, goalStatuses: personalization.goals, routinePlan, productMatches, catalog: options && options.catalog, productsApi: dep.products });
    /* priorityItems : les besoins retenus (priorités LOW/MID) ; accompanimentItems : les axes d'accompagnement ; accompaniment.recommendations : l'état de chacun. */
    return { profile: prof, interpretation, priorities, priorityItems: priorities.items, accompaniment, accompanimentItems: accompaniment.items, personalization, activePlan, routinePlan,
      productMatches, explanations, synthesis };
  }

  return { run, normalizeProfile, toggleGoal, goalList, MAX_GOALS: D.MAX_GOALS, VERSION };
});
