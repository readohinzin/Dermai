/* Couche PERSONNALISATION : entre les priorités et les actifs. Elle réunit ce que l'analyse mesure, les priorités du moteur, les objectifs,
   le type de peau, le niveau de routine, le confort et les exclusions de l'utilisateur, puis explique chaque choix de façon structurée.
   Fonctions pures et déterministes : pas de DOM, pas de réseau, pas de stockage, aucun score caché, aucun coefficient.

   Hiérarchie de décision (la première règle l'emporte toujours) :
   1. sécurité (mode confort, actifs à valider jamais choisis, un seul exfoliant ou rétinoïde par soir) et exclusions de l'utilisateur ;
   2. données réellement mesurées ; 3. priorités du moteur ; 4. objectifs (ils départagent, ils ne créent rien) ;
   5. type de peau (contexte, jamais un constat) ; 6. niveau de routine ; 7. préférences ; 8. actifs validés disponibles.
   Un objectif ne transforme jamais un bon score en priorité, ne force aucun actif et ne contourne aucune règle de sécurité.
   Le type de peau est une donnée de contexte. Le niveau d'huile (oiliness) n'est jamais interprété comme « peau grasse ». */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { indicators: require('./data/indicators.js'), activesData: require('./data/actives.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'), skin: require('../skin-model.js') }
    : { indicators: E.indicatorsData, activesData: E.activesData, actives: E.actives, copy: E.copy, skin: root.SkinModel };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.personalization = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const D = dep.indicators, A = dep.activesData, actives = dep.actives, copy = dep.copy, skin = dep.skin;
  const P = copy.PERSONAL, lower = copy.lower, join = copy.joinList;
  const labelOf = id => skin.METRIC_LABELS[id] || id;
  const activeLabel = id => (actives.byId(id) || { label: id }).label;

  /* Matrice objectif → indicateurs → actifs compatibles. Dérivée des données existantes (domaines, préférences validées) : aucune relation
     nouvelle n'est créée ici. Un actif « à_valider » n'y figure jamais. */
  function goalMatrix() {
    return D.GOALS.map(g => {
      const indicators = g.domain ? Object.keys(D.INDICATORS).filter(k => D.INDICATORS[k].domain === g.domain && D.INDICATORS[k].actionability === 'actionable') : [];
      return {
        goal: g.id, domain: g.domain,
        indicators: indicators.map(ind => ({ indicator: ind, actives: (A.PREFERENCE[ind] || []).map(actives.byId).filter(a => actives.isValidated(a) && a.targets.includes(ind)).map(a => a.id) }))
      };
    });
  }

  /* Avant les actifs : contexte effectif (confort demandé par l'analyse ou choisi par l'utilisateur), exclusions, objectifs et leur statut. */
  function build(interp, prios, profile) {
    const preferGentle = !!(profile.comfort && profile.comfort.preferGentle);
    const comfortReasons = [...interp.context.comfortReasons, ...(preferGentle ? ['user_preference'] : [])];
    const level = profile.level;
    const context = {
      skinType: interp.skinType ? { key: interp.skinType.key, label: interp.skinType.label, base: interp.skinType.base } : null,
      skinBase: interp.context.skinBase,
      comfortMode: comfortReasons.length > 0, comfortReasons,
      routineLevel: level, routineLevelLabel: copy.LEVEL_LABELS[level] || level
    };
    const exclusions = (profile.exclusions || []).filter((id, i, a) => actives.byId(id) && a.indexOf(id) === i);
    const matrix = goalMatrix();
    const goals = (profile.goals || []).map(id => {
      const def = D.GOALS.find(g => g.id === id), row = matrix.find(m => m.goal === id);
      const label = copy.GOAL_LABELS[id];
      if (!def.domain) return { id, label, status: 'maintenance', indicators: [], text: P.goalStatus.maintenance };
      const inds = interp.indicators.filter(i => i.domain === def.domain && i.actionability === 'actionable')
        .map(i => ({ indicator: i.id, label: i.label, score: i.score, band: i.band }));
      const inPriority = prios.items.some(it => it.domain === def.domain);
      const eligible = inds.some(i => (i.band === 'low' || i.band === 'mid') && actives.hasLever(i.indicator));
      const status = inPriority ? 'priority' : eligible ? 'beyond_cap' : inds.some(i => i.score !== null) ? 'no_signal' : 'unavailable';
      return { id, label, status, indicators: inds, candidateActives: row.indicators.flatMap(r => r.actives).filter((x, k, a) => a.indexOf(x) === k), text: P.goalStatus[status] };
    });
    return { context, exclusions, goals, routineLevel: level };
  }

  /* Évolution : compare avec l'analyse précédente SANS jamais la traiter comme l'analyse courante (la dernière analyse valide reste la référence). */
  function evolution(prev, interp, prios, activePlan) {
    if (!prev) return { available: false, indicators: [], routineStable: null, note: null };
    const step = skin.TREND_STEP;
    const rows = prios.items.map(it => {
      const before = (prev.interpretation.indicators.find(i => i.id === it.indicator) || {}).score;
      const delta = before === null || before === undefined || it.score === null ? null : it.score - before;
      return { indicator: it.indicator, label: it.label, previous: before === undefined ? null : before, current: it.score, delta,
        trend: delta === null ? null : delta > step ? 'up' : delta < -step ? 'down' : 'stable' };
    });
    const ids = r => r.activePlan.treatments.map(t => t.activeId).sort().join('|');
    const routineStable = ids(prev) === ids({ activePlan });
    return { available: true, indicators: rows, routineStable, note: routineStable ? P.evolution.stable : P.evolution.changed };
  }

  /* Après les actifs et la routine : explications structurées et résultat de personnalisation. */
  function finalize(pers, interp, prios, activePlan, routinePlan, previous) {
    const deferred = activePlan.deferred;
    const level = pers.routineLevel;
    const measuredOf = inds => inds.map(id => { const i = interp.indicators.find(x => x.id === id); return { indicator: id, label: labelOf(id), score: i ? i.score : null, band: i ? i.band : null }; });
    const goalIdsFor = inds => pers.goals.filter(g => g.indicators.some(i => inds.includes(i.indicator))).map(g => g.id);
    const whyNotFor = (inds, selfId) => deferred
      .filter(d => d.activeId !== selfId && d.indicators.some(i => inds.includes(i)) && P.whyNot[d.kind])
      .map(d => ({ activeId: d.activeId, kind: d.kind, text: 'Nous n\'avons pas retenu ' + lower(activeLabel(d.activeId)) + ' : ' + P.whyNot[d.kind] + '.' }));
    const whyNowFor = a => {
      const parts = [P.whyNow[level] || P.whyNow.simple];
      if (pers.context.comfortMode) parts.push(P.whyNowComfort);
      else if (pers.context.skinBase === 'dry' && a.irritation !== 'low') parts.push(P.whyNowDry);
      return parts.join(' ');
    };
    const describe = (entry, kind) => {
      const a = actives.byId(entry.activeId), inds = entry.indicators || [];
      const goalIds = goalIdsFor(inds);
      const parts = [];
      if (inds.length) parts.push('Votre analyse indique un repère plus faible sur : ' + join(inds.map(i => lower(labelOf(i)))) + '.');
      else parts.push('Il accompagne votre profil pour le confort de la peau.');
      if (goalIds.length) parts.push('Il rejoint votre objectif : ' + join(goalIds.map(g => lower(copy.GOAL_LABELS[g]))) + '.');
      if (entry.choice && P.choice[entry.choice]) parts.push(P.choice[entry.choice]);
      const editorial = inds.filter(i => a.evidence.editorial.includes(i));
      if (editorial.length) parts.push('Pour ' + join(editorial.map(i => lower(labelOf(i)))) + ', c\'est une option cosmétique courante.');
      return { activeId: a.id, label: a.label, kind, indicators: inds, measured: measuredOf(inds), goals: goalIds, choice: entry.choice || null,
        why: parts.join(' '), whyNow: whyNowFor(a), whyNot: whyNotFor(inds, a.id), cautions: a.cautions };
    };
    const selectedActives = [...activePlan.treatments.map(t => describe(t, 'treatment')), ...activePlan.supports.map(s => describe(s, 'support'))];
    const excludedActives = deferred.map(d => ({ activeId: d.activeId, label: activeLabel(d.activeId), kind: d.kind, indicators: d.indicators,
      text: copy.DEFERRED[d.kind] || null }));

    /* « Autres actifs » : consultables mais non retenus. Raisons lisibles seulement (pas de raison technique interne). */
    const seen = new Set(selectedActives.map(s => s.activeId));
    const otherActives = [];
    for (const d of excludedActives) {
      if (seen.has(d.activeId) || !P.whyNot[d.kind] || d.kind === 'slot') continue;
      seen.add(d.activeId);
      otherActives.push({ activeId: d.activeId, label: d.label, kind: d.kind, text: P.notRetained(P.whyNot[d.kind]) });
    }
    for (const a of A.ACTIVES) {
      if (!a.consultable || actives.isValidated(a) || seen.has(a.id)) continue;
      seen.add(a.id);
      otherActives.push({ activeId: a.id, label: a.label, kind: 'not_validated', text: P.notValidated });
    }

    const rationale = [];
    if (prios.items.length) rationale.push({ code: 'measured', text: P.measured(prios.items.map(i => i.label)), facts: measuredOf(prios.items.map(i => i.indicator)) });
    else rationale.push({ code: 'measured', text: P.measuredNone, facts: [] });
    if (pers.goals.length) rationale.push({ code: 'goals', text: P.goals(pers.goals.map(g => g.label)), facts: pers.goals.map(g => ({ id: g.id, status: g.status })) });
    rationale.push({ code: 'level', text: P.level[level] || P.level.simple, facts: { level } });
    if (pers.context.comfortMode) rationale.push({ code: 'comfort', text: pers.context.comfortReasons.includes('user_preference') && pers.context.comfortReasons.length === 1 ? P.comfortUser : P.comfortAnalysis, facts: pers.context.comfortReasons });
    if (pers.context.skinType) rationale.push({ code: 'skin', text: P.skin(pers.context.skinType.label), facts: pers.context.skinType });
    const treatLabels = activePlan.treatments.map(t => activeLabel(t.activeId));
    const headline = [prios.items.length ? P.measured(prios.items.map(i => i.label)) : P.measuredNone,
      pers.goals.length ? 'Vous avez indiqué comme objectif : ' + join(pers.goals.map(g => lower(g.label))) + '.' : null,
      pers.context.skinType ? 'Votre analyse indique le profil : ' + pers.context.skinType.label + '.' : null,
      treatLabels.length ? P.result(treatLabels) : P.resultNone].filter(Boolean).join(' ');

    return {
      goals: pers.goals, priorities: prios.items, selectedActives, excludedActives, otherActives, rationale, headline,
      approachNote: pers.context.comfortMode ? P.approachNote : null,
      routineLevel: level, routineLevelLabel: pers.context.routineLevelLabel, exclusions: pers.exclusions, context: pers.context,
      evolution: evolution(previous, interp, prios, activePlan)
    };
  }

  return { build, finalize, goalMatrix, evolution };
});
