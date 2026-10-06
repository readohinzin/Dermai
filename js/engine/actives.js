/* Couche ACTIFS : choix déterministe d'actifs validés à partir des priorités, du contexte (type de peau, confort), du niveau de routine
   et des produits déjà utilisés. Un actif « à_valider » n'est jamais sélectionné. Chaque rejet est enregistré avec sa raison (deferred). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode ? { data: require('./data/actives.js') } : { data: (root.DermaiEngine || {}).activesData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.actives = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data;
  const IRRITATION_RANK = { low: 0, moderate: 1, high: 2 };
  const MAX_SUPPORTS = 3;   // paramètre de conception provisoire : l'hydratant ne cherche pas une longue liste d'ingrédients

  const byId = id => data.ACTIVES.find(a => a.id === id) || null;
  const isValidated = a => !!a && a.status === 'validated';
  const validated = () => data.ACTIVES.filter(isValidated);
  /* Un indicateur a un « levier » si au moins un actif validé le cible. */
  const hasLever = indicatorId => validated().some(a => a.targets.includes(indicatorId));
  /* Actifs validés couramment utilisés pour un indicateur, dans l'ordre éditorial. Information générale, pas un plan personnel. */
  const leversFor = indicatorId => (data.PREFERENCE[indicatorId] || []).map(byId).filter(a => isValidated(a) && a.targets.includes(indicatorId));

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

  return { byId, validated, hasLever, leversFor, select, MAX_SUPPORTS, isValidated };
});
