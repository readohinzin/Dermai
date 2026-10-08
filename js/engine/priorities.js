/* Couche PRIORITÉS : quels besoins DERMAI retient, et pourquoi. Déterministe, sans coefficient. Ne lit que la DÉCISION de
   l'interprétation (`value`, `band`, `role`), jamais le score affiché.
   Étapes : (1) validité (score absent = absent, jamais 0) ; (2) éligibilité : repère « mid » ou « low » (data/decision.js), rôle
   « actionable » (ou « goal_gated » avec l'objectif correspondant choisi), levier cosmétique validé ; (3) ordre : repère le plus bas
   d'abord ; dans un repère, les indicateurs liés à un objectif de l'utilisateur d'abord ; (4) puis valeur de décision la plus basse, sans
   changer le classement pour un écart de ±TIE_TOLERANCE (ordre fixe) ; (5) plafond de 3.
   Aucun repère « good » ne devient une priorité ; un objectif ne fait jamais passer un indicateur au-dessus d'un repère plus faible ;
   un indicateur descriptif (niveau d'huile, texture, fermeté) n'est jamais une priorité. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { data: require('./data/indicators.js'), decision: require('./data/decision.js'), actives: require('./actives.js'), copy: require('./copy.fr.js') }
    : { data: E.indicatorsData, decision: E.decisionData, actives: E.actives, copy: E.copy };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.priorities = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data, DEC = dep.decision, actives = dep.actives, copy = dep.copy;
  const MAX_PRIORITIES = 3;
  const under = i => i.band === 'low' || i.band === 'mid';

  /* Tri par valeur de décision avec stabilité : deux valeurs à ±TIE_TOLERANCE du début d'un groupe sont départagées par l'ordre fixe. */
  function stableByValue(list) {
    const sorted = [...list].sort((a, b) => a.value - b.value || a.order - b.order);
    const out = [];
    let cluster = [], start = null;
    const flush = () => { cluster.sort((a, b) => a.order - b.order); out.push(...cluster); cluster = []; };
    for (const it of sorted) {
      if (start === null || it.value - start > DEC.TIE_TOLERANCE) { flush(); start = it.value; }
      cluster.push(it);
    }
    flush();
    return out;
  }

  /* Le rôle autorise-t-il un besoin ? actionable : oui ; goal_gated : seulement avec l'objectif choisi ; descriptive, informative : non. */
  const roleAllows = (i, goals) => i.role === 'actionable' || (i.role === 'goal_gated' && goals.includes(i.roleGoal));
  /* Besoin possible (avant plafond) : repère sous « good », rôle qui l'autorise, levier validé. */
  const isCandidate = (i, goals) => i.available && under(i) && roleAllows(i, goals) && actives.hasLever(i.id);

  function compute(interp, profile) {
    const goals = profile.goals || [];
    const goalDomains = new Set(goals.map(id => (data.GOALS.find(g => g.id === id) || {}).domain).filter(Boolean));
    const eligible = interp.indicators.filter(i => isCandidate(i, goals)).map(i => Object.assign({}, i, { objectiveMatch: goalDomains.has(i.domain) }));
    const ordered = [];
    for (const band of ['low', 'mid']) {
      const inBand = eligible.filter(i => i.band === band);
      ordered.push(...stableByValue(inBand.filter(i => i.objectiveMatch)), ...stableByValue(inBand.filter(i => !i.objectiveMatch)));
    }
    const items = ordered.slice(0, MAX_PRIORITIES).map((i, rank) => ({
      indicator: i.id, label: i.label, score: i.score, uiBand: i.uiBand, value: i.value, basis: i.basis, band: i.band, bandLabel: i.bandLabel,
      domain: i.domain, role: i.role, objectiveMatch: i.objectiveMatch, actionability: i.actionability, confidence: i.confidence, rank: rank + 1,
      reason: copy.priorityReason({ band: i.band, objectiveMatch: i.objectiveMatch })
    }));
    /* Contour des yeux : information seulement (jamais une priorité d'action). */
    const informational = interp.indicators.filter(i => i.available && under(i) && i.role === 'informative')
      .map(i => ({ indicator: i.id, label: i.label, score: i.score, band: i.band, domain: i.domain, actionability: i.actionability, confidence: i.confidence }));
    return { mode: items.length ? 'action' : 'maintenance', basis: interp.basis, items, informational, eyeInfo: informational.length ? copy.eyeInfo(informational.map(i => i.label)) : null };
  }

  return { compute, MAX_PRIORITIES, stableByValue, isCandidate, roleAllows };
});
