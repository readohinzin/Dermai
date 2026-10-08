/* Couche ACTIFS : choix déterministe d'actifs validés à partir des priorités, du contexte (type de peau, confort), du niveau de routine
   et des produits déjà utilisés. Un actif « à_valider » n'est jamais sélectionné. Chaque rejet est enregistré avec sa raison (deferred). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode ? { data: require('./data/actives.js'), decision: require('./data/decision.js') } : { data: (root.DermaiEngine || {}).activesData, decision: (root.DermaiEngine || {}).decisionData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.actives = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data, DEC = dep.decision;
  const IRRITATION_RANK = { low: 0, moderate: 1, high: 2 };
  const MAX_SUPPORTS = 3;   // paramètre de conception provisoire : l'hydratant ne cherche pas une longue liste d'ingrédients

  const byId = id => data.ACTIVES.find(a => a.id === id) || null;
  const isValidated = a => !!a && a.status === 'validated';
  const validated = () => data.ACTIVES.filter(isValidated);
  /* Un indicateur a un « levier » si au moins un actif validé le cible. */
  const hasLever = indicatorId => validated().some(a => a.targets.includes(indicatorId));
  /* Actifs validés couramment utilisés pour un indicateur, dans l'ordre éditorial. Information générale, pas un plan personnel. */
  const leversFor = indicatorId => (data.PREFERENCE[indicatorId] || []).map(byId).filter(a => isValidated(a) && a.targets.includes(indicatorId));

  /* Pool DOUX de l'accompagnement (indicateurs « good ») : sous-ensemble strict du pool existant. Actif validé, du type et de l'irritation
     fixés dans data/decision.js (ACCOMPANIMENT_ACTIVE), qui cible l'indicateur et que l'utilisatrice n'a pas exclu, dans l'ordre éditorial.
     Aujourd'hui : la niacinamide. Un actif « moderate » ou « à_valider » n'y entre jamais, quel que soit l'objectif. */
  const gentleFor = (indicatorId, excluded) => {
    const out = new Set(excluded || []), want = DEC.ACCOMPANIMENT_ACTIVE;
    return (data.PREFERENCE[indicatorId] || []).map(byId).filter(a => isValidated(a) && a.kind === want.kind && a.irritation === want.irritation && a.targets.includes(indicatorId) && !out.has(a.id));
  };

  const activeRule = id => data.CONFLICT_RULES.find(r => r.id === id && r.status === 'validated');

  /* Force du lien actif → indicateur (voir `evidence` des données) : 2 preuve directe, 1 indirecte, 0 règle éditoriale DERMAI seulement. */
  const strength = (a, ind) => (a.evidence.direct.includes(ind) ? 2 : a.evidence.indirect.includes(ind) ? 1 : 0);
  /* Couverture : seuls les liens directs ou indirects comptent ; une simple règle éditoriale ne justifie pas de remplacer un meilleur choix. */
  const coverage = (a, prio) => prio.filter(i => strength(a, i) >= 1).length;
  function rankPool(pool, prio, treatments, ctx, indicator) {
    if (pool.length < 2) return pool;
    const base = IRRITATION_RANK[pool[0].irritation], baseStrength = strength(pool[0], indicator);
    const dry = ctx.skinBase === 'dry';
    const idx = new Map(pool.map((a, i) => [a.id, i]));
    const ok = a => IRRITATION_RANK[a.irritation] <= base && strength(a, indicator) >= baseStrength;
    const eligible = pool.filter(ok);
    const rest = pool.filter(a => !ok(a));
    eligible.sort((x, y) => (treatments.some(t => t.activeId === y.id) - treatments.some(t => t.activeId === x.id))
      || coverage(y, prio) - coverage(x, prio)
      || (dry ? IRRITATION_RANK[x.irritation] - IRRITATION_RANK[y.irritation] : 0)
      || idx.get(x.id) - idx.get(y.id));
    return [...eligible, ...rest];
  }
  /* Pourquoi ce choix plutôt que le premier de l'ordre éditorial : couverture de plusieurs priorités, ou option plus douce (peau sèche). */
  function choiceOf(a, first, prio, ctx) {
    if (!first || a.id === first.id) return 'editorial';
    return coverage(a, prio) > coverage(first, prio) ? 'coverage' : (ctx.skinBase === 'dry' && IRRITATION_RANK[a.irritation] < IRRITATION_RANK[first.irritation] ? 'gentle_skin' : 'coverage');
  }

  /* items : priorités d'action (sortie de priorities.compute). interp : sortie de interpret. profile : { level, cats }. */
  function select(items, interp, profile) {
    const ctx = interp.context, limits = data.LIMITS[profile.level] || data.LIMITS[data.DEFAULT_LEVEL];
    const owned = new Set(profile.cats || []);
    const excluded = new Set(profile.exclusions || []);   // exclusions de l'utilisateur (préférence personnelle, jamais une donnée de santé)
    const prioIndicators = items.map(it => it.indicator);
    const level = data.LIMITS[profile.level] ? profile.level : data.DEFAULT_LEVEL;
    const strongRule = activeRule('strong_evening'), ownedRule = activeRule('owned_exfoliant');
    const treatments = [], supports = [], deferred = [];
    const defer = (a, kind, indicator) => {
      if (treatments.some(t => t.activeId === a.id)) return;
      const d = deferred.find(x => x.activeId === a.id);
      if (d) { if (!d.indicators.includes(indicator)) d.indicators.push(indicator); } else deferred.push({ activeId: a.id, kind, indicators: [indicator] });
    };
    const addIndicator = (list, id) => { if (!list.includes(id)) list.push(id); };

    for (const it of items) {
      const prefs = (data.PREFERENCE[it.indicator] || []).map(byId).filter(a => isValidated(a) && a.targets.includes(it.indicator));
      for (const a of prefs) if (excluded.has(a.id) && a.kind === 'treatment') defer(a, 'excluded', it.indicator);
      const tr = prefs.filter(a => a.kind === 'treatment' && !excluded.has(a.id)), su = prefs.filter(a => a.kind === 'support' && !excluded.has(a.id));

      /* Soins ciblés. */
      let pool = tr, blocked = [];
      /* Aucun actif à irritation « high » n'est sélectionné automatiquement en mode confort. Routine minimale (niveau « none ») :
         seulement un soin ciblé très doux (irritation « low »), jamais un actif plus exigeant. */
      const minimal = level === 'none';
      if (ctx.comfortMode || minimal) {
        blocked = tr.filter(a => (minimal ? a.irritation !== 'low' : a.irritation === 'high'));
        pool = tr.filter(a => !blocked.includes(a));
      }
      if (ctx.comfortMode) {
        const gentle = pool.filter(a => a.irritation === 'low');
        if (gentle.length) {                       // actifs doux d'abord ; l'actif plus exigeant est mis de côté, pas supprimé sans raison
          const skipped = pool.find(a => a.irritation !== 'low');
          pool = gentle;
          if (skipped) defer(skipped, 'comfort', it.indicator);
        }
      }
      /* L'ordre éditorial des préférences domine : le premier actif utilisable est choisi ; un actif déjà dans le plan couvre le besoin
         quand on l'atteint dans l'ordre, ou quand le plafond est atteint. */
      /* Personnalisation : parmi les options COMPATIBLES (jamais plus irritantes que le premier choix éditorial), on préfère un actif déjà
         dans le plan, puis celui qui couvre le plus de priorités, puis (peau sèche) le plus doux. Jamais un actif de plus ni plus fort. */
      const editorialFirst = pool[0];
      pool = rankPool(pool, prioIndicators, treatments, ctx, it.indicator);
      let chosenId = null;
      for (const a of pool) {
        const inPlan = treatments.find(t => t.activeId === a.id);
        if (inPlan) { addIndicator(inPlan.indicators, it.indicator); chosenId = a.id; break; }
        if (ownedRule && owned.has('exfoliant') && (a.role === 'exfoliation' || a.groups.includes(strongRule ? strongRule.group : ''))) { defer(a, 'owned', it.indicator); continue; }
        if (treatments.some(t => t.role === a.role)) { defer(a, 'duplicate', it.indicator); continue; }
        if (strongRule && a.groups.includes(strongRule.group) && treatments.filter(t => t.groups.includes(strongRule.group)).length >= strongRule.max) { defer(a, 'conflict', it.indicator); continue; }
        if (treatments.length >= limits.treatments) {
          const covering = pool.find(x => treatments.some(t => t.activeId === x.id));
          if (covering) { addIndicator(treatments.find(t => t.activeId === covering.id).indicators, it.indicator); chosenId = covering.id; }
          else defer(a, 'cap', it.indicator);
          break;
        }
        treatments.push({ activeId: a.id, role: a.role, groups: a.groups, irritation: a.irritation, indicators: [it.indicator],
          gentleFallback: ctx.comfortMode && a.irritation !== 'low', choice: choiceOf(a, editorialFirst, prioIndicators, ctx) });
        chosenId = a.id;
        break;
      }
      /* Option éditoriale première non retenue parce qu'un actif compatible couvre déjà ce repère (ou est plus doux pour la peau sèche). */
      if (chosenId && editorialFirst && chosenId !== editorialFirst.id) {
        const t = treatments.find(x => x.activeId === chosenId);
        defer(editorialFirst, t && t.choice === 'gentle_skin' ? 'gentler' : 'covered', it.indicator);
      }
      /* Les actifs « high » écartés en mode confort sont expliqués seulement s'ils passaient avant l'actif retenu (ou s'il n'y en a aucun). */
      const rank = id => tr.findIndex(x => x.id === id);
      for (const b of blocked) if (chosenId === null || rank(b.id) < rank(chosenId)) defer(b, ctx.comfortMode ? 'gentle' : 'minimal', it.indicator);

      /* Ingrédients de l'hydratant : au plus un par rôle, deux au maximum pour cette priorité. */
      let added = 0;
      for (const a of su) {
        const same = supports.find(s => s.activeId === a.id);
        if (same) { addIndicator(same.indicators, it.indicator); continue; }
        if (added >= 2 || supports.some(s => s.role === a.role)) continue;
        supports.push({ activeId: a.id, role: a.role, indicators: [it.indicator], context: false });
        added++;
      }
    }

    /* Contexte : mode confort ou peau sèche → une base d'hydratation (humectant + barrière) même sans priorité d'hydratation. */
    if (ctx.comfortMode || ctx.skinBase === 'dry') {
      for (const role of ['humectant', 'barrier']) {
        if (supports.some(s => s.role === role)) continue;
        const a = (data.PREFERENCE.hydration || []).map(byId).find(x => isValidated(x) && x.role === role && !excluded.has(x.id));
        if (a) supports.push({ activeId: a.id, role: a.role, indicators: [], context: true });
      }
    }

    /* Ordre d'introduction : les actifs les plus doux d'abord (à égalité : ordre de priorité). */
    const intro = treatments.map((t, i) => ({ t, i })).sort((x, y) => IRRITATION_RANK[x.t.irritation] - IRRITATION_RANK[y.t.irritation] || x.i - y.i);
    intro.forEach((x, k) => { x.t.introductionOrder = k + 1; });
    const finalDeferred = deferred.filter(d => !treatments.some(t => t.activeId === d.activeId));
    return { treatments, supports: supports.slice(0, MAX_SUPPORTS), deferred: finalDeferred, context: { comfortMode: ctx.comfortMode, skinBase: ctx.skinBase } };
  }

  /* SECONDE PASSE (étape 27) : de l'axe d'accompagnement au soin. Reçoit le plan des priorités (inchangé) et les axes de accompaniment.compute.
     Rend { plan, recommendations }. Chaque axe reçoit UN état :
       covered    : un soin du plan cible déjà cet indicateur : accompagnement gratuit, aucune étape ajoutée ;
       added      : une étape d'accompagnement est ajoutée au plan (origin « accompaniment ») ;
       identified : l'axe reste identifié et recommandé, sans soin ajouté (blocked : no_justification, cap, duplicate).
     Une étape n'est ajoutée que si : aucun soin du plan ne couvre l'indicateur, il reste de la place sous le plafond de soins du niveau (LIMITS),
     MAX_ACCOMPANIMENT_STEPS n'est pas atteint, ET (objectif correspondant OU convergence : ACCOMPANIMENT_CONVERGENCE axes distincts qui partagent le
     même actif doux). Le pool est celui de gentleFor : aucun garde-fou existant n'est contourné. Le plan des priorités n'est jamais modifié. */
  function addAccompaniment(plan, axes, profile) {
    const limits = data.LIMITS[profile.level] || data.LIMITS[data.DEFAULT_LEVEL];
    const base = plan.treatments, added = [];
    const covering = ind => base.find(t => (byId(t.activeId) || { targets: [] }).targets.includes(ind));
    const rec = axes.map(ax => ({ indicator: ax.indicator, label: ax.label, value: ax.value, band: ax.band, basis: ax.basis, origin: ax.origin, source: 'accompaniment',
      activeId: ax.activeId, activeLabel: ax.activeLabel, reason: ax.reason, status: 'identified', coveredBy: null, justification: null, blocked: null, productStatus: null }));
    for (const r of rec) { const c = covering(r.indicator); if (c) { r.status = 'covered'; r.coveredBy = c.activeId; } }
    const open = rec.filter(r => r.status === 'identified');
    for (const id of [...new Set(open.map(r => r.activeId))]) {
      const group = open.filter(r => r.activeId === id), a = byId(id);
      const goal = group.some(r => axes.find(x => x.indicator === r.indicator).objectiveMatch);
      const converge = group.filter(r => axes.find(x => x.indicator === r.indicator).distinct).length >= DEC.ACCOMPANIMENT_CONVERGENCE;
      const block = !(goal || converge) ? 'no_justification'
        : added.length >= DEC.MAX_ACCOMPANIMENT_STEPS || base.length + added.length >= limits.treatments ? 'cap'
        : [...base, ...added].some(t => t.role === a.role) ? 'duplicate' : null;
      for (const r of group) { r.justification = goal ? 'objective' : converge ? 'convergence' : null; r.blocked = block; if (!block) r.status = 'added'; }
      if (!block) added.push({ activeId: a.id, role: a.role, groups: a.groups, irritation: a.irritation, indicators: group.map(r => r.indicator), gentleFallback: false,
        choice: 'accompaniment', origin: 'accompaniment' });
    }
    if (!added.length) return { plan, recommendations: rec };
    /* Ordre d'introduction : les actifs les plus doux d'abord (à égalité : ordre du plan, priorités avant accompagnement), comme select(). */
    const all = [...base, ...added].map((t, i) => ({ t: Object.assign({}, t, { origin: t.origin || 'priority' }), i }));
    all.sort((x, y) => IRRITATION_RANK[x.t.irritation] - IRRITATION_RANK[y.t.irritation] || x.i - y.i).forEach((x, k) => { x.t.introductionOrder = k + 1; });
    return { plan: Object.assign({}, plan, { treatments: all.sort((x, y) => x.i - y.i).map(x => x.t) }), recommendations: rec };
  }

  return { byId, validated, hasLever, leversFor, gentleFor, select, addAccompaniment, MAX_SUPPORTS, isValidated };
});
