/* Couche PRIORITÉS : quels indicateurs méritent une attention d'action, et pourquoi. Déterministe, sans coefficient.
   Étapes : (1) validité (score absent = absent, jamais 0) ; (2) éligibilité : bande « À soutenir » ou « À surveiller », indicateur
   actionnable, levier cosmétique validé ; (3) ordre : bande la plus basse d'abord ; dans une bande, les indicateurs liés à un objectif de
   l'utilisateur d'abord ; (4) puis score le plus bas, sans changer le classement pour un écart de ±TREND_STEP (ordre fixe) ;
   (5) plafond de 3. Aucun score « Bien » ne devient une priorité ; aucun objectif ne fait passer un indicateur au-dessus d'une bande plus faible. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { skin: require('../skin-model.js'), data: require('./data/indicators.js'), actives: require('./actives.js'), copy: require('./copy.fr.js') }
    : { skin: root.SkinModel, data: E.indicatorsData, actives: E.actives, copy: E.copy };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.priorities = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const skin = dep.skin, data = dep.data, actives = dep.actives, copy = dep.copy;
  const MAX_PRIORITIES = 3;
  const BAND_RANK = { low: 0, mid: 1 };

  /* Tri par score avec stabilité : deux scores à ±TREND_STEP du début d'un groupe sont départagés par l'ordre fixe des indicateurs. */
  function stableByScore(list) {
    const sorted = [...list].sort((a, b) => a.score - b.score || a.order - b.order);
    const out = [];
    let cluster = [], start = null;
    const flush = () => { cluster.sort((a, b) => a.order - b.order); out.push(...cluster); cluster = []; };
    for (const it of sorted) {
      if (start === null || it.score - start > skin.TREND_STEP) { flush(); start = it.score; }
      cluster.push(it);
    }
    flush();
    return out;
  }

  function compute(interp, profile) {
    const goalDomains = new Set((profile.goals || []).map(id => (data.GOALS.find(g => g.id === id) || {}).domain).filter(Boolean));
    const eligible = interp.indicators.filter(i => i.available && (i.band === 'low' || i.band === 'mid') && i.actionability === 'actionable' && actives.hasLever(i.id))
      .map(i => Object.assign({}, i, { objectiveMatch: goalDomains.has(i.domain) }));
    const ordered = [];
    for (const band of ['low', 'mid']) {
      const inBand = eligible.filter(i => i.band === band);
      ordered.push(...stableByScore(inBand.filter(i => i.objectiveMatch)), ...stableByScore(inBand.filter(i => !i.objectiveMatch)));
    }
    const items = ordered.slice(0, MAX_PRIORITIES).map((i, rank) => ({
      indicator: i.id, label: i.label, score: i.score, band: i.band, bandLabel: i.bandLabel, domain: i.domain,
      objectiveMatch: i.objectiveMatch, actionability: i.actionability, confidence: i.confidence, rank: rank + 1,
      reason: copy.priorityReason({ band: i.band, objectiveMatch: i.objectiveMatch })
    }));
    /* Contour des yeux : information seulement (jamais une priorité d'action). */
    const informational = interp.indicators.filter(i => i.available && (i.band === 'low' || i.band === 'mid') && i.actionability === 'informative')
      .map(i => ({ indicator: i.id, label: i.label, score: i.score, band: i.band, bandLabel: i.bandLabel, domain: i.domain, actionability: i.actionability, confidence: i.confidence }));
    return { mode: items.length ? 'action' : 'maintenance', items, informational, eyeInfo: informational.length ? copy.eyeInfo(informational.map(i => i.label)) : null };
  }

  return { compute, MAX_PRIORITIES, stableByScore };
});
