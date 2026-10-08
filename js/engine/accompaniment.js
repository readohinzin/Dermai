/* Couche ACCOMPAGNEMENT (étape 27) : quels indicateurs, sans être une priorité, DERMAI peut accompagner avec un soin doux, et pourquoi.
   Deuxième voie, calculée APRÈS les priorités : priorities.js reste inchangé (mêmes repères 50 / 25, même ordre, même plafond de 3).

   Trois niveaux, jamais confondus :
     1. AXE d'accompagnement : cet indicateur peut faire partie de ce que DERMAI propose (ce module) ;
     2. RECOMMANDATION       : l'actif doux concerné et l'état du produit (actives.js, products.js) ;
     3. SOIN ajouté          : une étape réellement présente dans la routine (actives.addAccompaniment, routine.js).
   Un axe identifié n'est PAS un soin automatiquement ajouté.

   Éligible : indicateur disponible, rôle qui autorise l'accompagnement (decision.js), hors priorités, avec au moins un actif doux validé non exclu.
   Il devient un axe si UNE condition est vraie :
     C (débordement) : candidat LOW/MID que le plafond de 3 priorités a écarté ;
     B (objectif)    : il correspond à un objectif choisi ;
     A (distinct)    : valeur de décision < médiane − TIE_TOLERANCE (strictement), sur le lot des indicateurs de comparaison.
   Classement : débordements, puis objectifs, puis distincts ; dans chaque groupe, la valeur de décision la plus basse d'abord (stableByValue : à ±TIE_TOLERANCE, ordre fixe).
   Au plus MAX_ACCOMPANIMENT_AXES axes.

   Lu : valeurs de décision (raw, ou score affiché en compatibilité, jamais mélangés : `value` d'interpret.js), rôles, actifs, objectifs, exclusions.
   Jamais lu : masques de localisation, pays, offres, prix, type de peau, score global, âge cutané. Aucun aléa, aucune IA, aucun seuil de score nouveau. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { data: require('./data/indicators.js'), decision: require('./data/decision.js'), actives: require('./actives.js'), priorities: require('./priorities.js'), copy: require('./copy.fr.js') }
    : { data: E.indicatorsData, decision: E.decisionData, actives: E.actives, priorities: E.priorities, copy: E.copy };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.accompaniment = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data, DEC = dep.decision, actives = dep.actives, copy = dep.copy;

  /* Médiane usuelle : valeur centrale, ou moyenne des deux valeurs centrales quand le nombre de valeurs est pair (dix indicateurs : cas courant).
     Le moteur n'en avait pas : cette définition est la seule du dépôt. Liste vide : null. */
  function median(values) {
    const v = values.filter(x => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b), n = v.length;
    if (!n) return null;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }
  /* Strictement inférieure : médiane 77, tolérance 2 → 75 n'est pas distinct, 74,9 l'est. */
  const isDistinct = (value, m) => m !== null && typeof value === 'number' && value < m - DEC.TIE_TOLERANCE;

  /* interp : sortie de interpret ; prios : sortie de priorities.compute (items, overflow) ; profile : profil normalisé (goals, exclusions). */
  function compute(interp, prios, profile) {
    const max = DEC.MAX_ACCOMPANIMENT_AXES, goals = profile.goals || [], excluded = profile.exclusions || [];
    const lot = interp.indicators.filter(i => i.available && DEC.isComparable(i.id));
    const m = median(lot.map(i => i.value));
    const base = { median: m, lot: lot.length, tolerance: DEC.TIE_TOLERANCE, basis: interp.basis, items: [] };
    if (!(max > 0)) return base;
    const goalDomains = new Set(goals.map(id => (data.GOALS.find(g => g.id === id) || {}).domain).filter(Boolean));
    const inPriority = new Set(prios.items.map(p => p.indicator)), overflow = prios.overflow || [];
    const eligible = interp.indicators
      .filter(i => i.available && DEC.allowsAccompaniment(i.id, goals) && !inPriority.has(i.id))
      .map(i => ({ i, gentle: actives.gentleFor(i.id, excluded) }))
      .filter(x => x.gentle.length)
      .map(({ i, gentle }) => Object.assign({}, i, { activeId: gentle[0].id, activeLabel: gentle[0].label,
        objectiveMatch: goalDomains.has(i.domain), distinct: isDistinct(i.value, m), overflow: overflow.includes(i.id) }));
    const stable = dep.priorities.stableByValue;
    const groups = [
      ['overflow', overflow.map(id => eligible.find(e => e.id === id)).filter(Boolean)],
      ['objective', stable(eligible.filter(e => !e.overflow && e.objectiveMatch))],
      ['distinct', stable(eligible.filter(e => !e.overflow && !e.objectiveMatch && e.distinct))]
    ];
    const items = [];
    for (const [origin, list] of groups) for (const e of list) items.push({
      indicator: e.id, label: e.label, score: e.score, uiBand: e.uiBand, value: e.value, basis: e.basis, band: e.band, bandLabel: e.bandLabel,
      domain: e.domain, role: e.role, objectiveMatch: e.objectiveMatch, distinct: e.distinct, origin, source: 'accompaniment',
      activeId: e.activeId, activeLabel: e.activeLabel, reason: copy.accompanimentReason(origin) });
    base.items = items.slice(0, max).map((it, k) => Object.assign(it, { rank: k + 1 }));
    return base;
  }

  return { compute, median, isDistinct };
});
