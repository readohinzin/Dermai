/* Couche SYNTHÈSE : transforme les décisions du moteur en une lecture personnalisée, déterministe et vérifiable.
   Elle répond aux quatre questions de l'utilisatrice : qu'a trouvé l'analyse ? qu'est-ce qui mérite mon attention ? pourquoi cette
   routine ? pourquoi ces produits ?

   Elle ne décide RIEN de nouveau : elle lit l'interprétation, les priorités, le profil, la routine et les produits déjà calculés.
   Aucun score n'est modifié ; aucune nouvelle valeur seuil n'est créée. Seules règles utilisées :
     - les bandes existantes (SkinModel.BANDS) et les priorités existantes (priorities.js) ;
     - le score affiché (ordre croissant ; à égalité, l'ordre fixe des indicateurs) et la tolérance existante ±TREND_STEP ;
     - le plafond existant MAX_PRIORITIES (3) pour la taille des groupes « axes d'attention » et « points forts ».
   Hiérarchie des 10 indicateurs principaux (le contour des yeux reste informatif et à part) :
     priority  : priorité retenue par le moteur ;
     attention : à soutenir mais non retenu (plafond, pas de levier validé), puis les résultats les moins élevés ;
     strength  : les résultats les plus élevés ;
     maintain  : le reste.
   Si tous les résultats restants tiennent dans ±TREND_STEP, ils sont « à maintenir » : rien ne se détache.
   Jamais lus ici : masques de localisation, pays, offres, prix. Aucun aléa, aucune IA. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { skin: require('../skin-model.js'), priorities: require('./priorities.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'), indicators: require('./data/indicators.js') }
    : { skin: root.SkinModel, priorities: E.priorities, actives: E.actives, copy: E.copy, indicators: E.indicatorsData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.synthesis = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const skin = dep.skin, copy = dep.copy, S = copy.SYNTH, D = dep.indicators;
  const N = dep.priorities.MAX_PRIORITIES;
  const BANDS = Object.fromEntries(skin.BANDS.map(b => [b.key, b]));
  const pick = i => ({ id: i.id, label: i.label, score: i.score, band: i.band, domain: i.domain });
  const asc = list => [...list].sort((a, b) => a.score - b.score || a.order - b.order);
  const TIER_RANK = { priority: 0, attention: 1, maintain: 2, strength: 3 };

  /* 1. Hiérarchie */
  function tiers(interp, prios) {
    const main = interp.indicators.filter(i => i.available && i.actionability === 'actionable');
    const prioIds = new Set(prios.items.map(p => p.indicator));
    const rest = main.filter(i => !prioIds.has(i.id));
    const underGood = rest.filter(i => i.band === 'low' || i.band === 'mid');         // à soutenir mais non retenus
    const good = rest.filter(i => i.band === 'good');
    const gap = good.length ? Math.max(...good.map(i => i.score)) - Math.min(...good.map(i => i.score)) : 0;
    const homogeneous = good.length > 1 && gap <= skin.TREND_STEP;
    const half = Math.min(N, Math.floor(good.length / 2));
    const lowGood = homogeneous ? [] : asc(good).slice(0, Math.max(0, Math.min(half, N - underGood.length)));
    const attention = [...underGood, ...lowGood];
    const att = new Set(attention.map(i => i.id));
    const highGood = homogeneous ? [] : [...good].sort((a, b) => b.score - a.score || a.order - b.order).filter(i => !att.has(i.id)).slice(0, half);
    const str = new Set(highGood.map(i => i.id));
    const out = {
      priority: prios.items.map(p => pick(main.find(i => i.id === p.indicator))),
      attention: asc(attention).map(pick),
      strength: [...highGood].sort((a, b) => b.score - a.score || a.order - b.order).map(pick),
      maintain: asc(rest.filter(i => !att.has(i.id) && !str.has(i.id))).map(pick)
    };
    const tierOf = {};
    for (const t of Object.keys(out)) for (const i of out[t]) tierOf[i.id] = t;
    return { tiers: out, tierOf, homogeneous, gap, main, underGood };
  }

  /* 2. Ce que l'analyse a trouvé */
  function found(h) {
    const counts = { good: 0, mid: 0, low: 0 };
    for (const i of h.main) counts[i.band]++;
    const parts = [S.bands(h.main.length, counts, BANDS)];
    if (h.homogeneous && !h.tiers.priority.length) parts.push(S.homogeneous(h.gap));
    else {
      if (h.tiers.strength.length) parts.push(S.strengths(h.tiers.strength));
      const lowest = [...h.tiers.priority, ...h.tiers.attention];
      if (lowest.length) {
        parts.push(S.lowest(asc(lowest)));
        const doms = [...new Set(asc(lowest).map(i => i.domain))].map(d => copy.DOMAIN_LABELS[d]);
        if (doms.length && doms.length < lowest.length) parts.push(S.domains(doms));
      }
    }
    return parts.join(' ');
  }

  /* 3. Ce qui mérite l'attention (et pourquoi il n'y a pas de priorité, le cas échéant) */
  function attentionText(h, prios, interp) {
    const parts = [];
    if (prios.items.length) { parts.push(S.priorities(h.tiers.priority)); parts.push(S.prioritiesWhy(BANDS)); }
    else parts.push(S.noPriority(h.tiers.attention.filter(i => i.band === 'good'), BANDS));
    const noLever = h.underGood.filter(i => !dep.actives.hasLever(i.id)), cap = h.underGood.filter(i => dep.actives.hasLever(i.id));
    if (cap.length) parts.push(S.beyondCap(cap.map(pick)));
    if (noLever.length) parts.push(S.noLever(noLever.map(pick)));
    return parts.join(' ');
  }

  /* 4. Objectifs : chacun est relié aux indicateurs réels de son domaine et à leur place dans la hiérarchie */
  function goals(h, profile, mode) {
    if (!profile.goals.length) return { mode: 'none', items: [], text: S.noGoal(h.tiers.priority.length ? [] : h.tiers.attention), matched: [] };
    const matched = [];
    const items = profile.goals.map(id => {
      const g = D.GOALS.find(x => x.id === id), label = copy.GOAL_LABELS[id];
      if (!g.domain) return { id, label, tier: null, indicators: [], text: S.goal.maintenance(label, mode === 'action') };
      const inds = h.main.filter(i => i.domain === g.domain).map(i => Object.assign(pick(i), { tier: h.tierOf[i.id] }));
      if (!inds.length) return { id, label, tier: null, indicators: [], text: S.goal.unavailable(label) };
      const best = Math.min(...inds.map(i => TIER_RANK[i.tier]));
      const tier = Object.keys(TIER_RANK).find(k => TIER_RANK[k] === best);
      const sel = asc(inds.filter(i => i.tier === tier));
      if (tier === 'priority' || tier === 'attention') matched.push(...sel.map(i => i.id));
      return { id, label, tier, indicators: sel, text: S.goal[tier](label, sel) };
    });
    return { mode: 'set', items, text: items.map(i => i.text).join(' '), matched: [...new Set(matched)] };
  }

  /* 5. Stratégie : conséquence de la hiérarchie, des objectifs, du profil et du niveau */
  function strategy(h, g, interp, profile, routine) {
    const treatments = [...routine.slots.morning, ...routine.slots.evening].filter(s => s.kind === 'treatment');
    const skinLabel = interp.skinType ? interp.skinType.label : null;
    const goalFirst = list => [...list.filter(i => g.matched.includes(i.id)), ...list.filter(i => !g.matched.includes(i.id))];
    let mode, text, focus;
    if (h.tiers.priority.length) {
      mode = 'action'; focus = goalFirst(h.tiers.priority);
      text = treatments.length ? S.strategy.action(focus, treatments.length, copy.lower(copy.LEVEL_SHORT[profile.level] || '')) : S.strategy.actionNoTreatment(focus);
    } else if (h.tiers.attention.length) {
      mode = 'maintenance'; focus = goalFirst(h.tiers.attention);
      const viaGoal = focus.filter(i => g.matched.includes(i.id));
      text = viaGoal.length ? S.strategy.goalFocus(viaGoal) : S.strategy.focus(focus, skinLabel);
    } else { mode = 'maintenance'; focus = []; text = S.strategy.even(skinLabel); }
    return { mode, focus: focus.map(i => i.id), text, skinContext: skinLabel ? S.skinContext(skinLabel) : null };
  }

  /* 6. Pourquoi chaque étape de la routine existe pour CETTE utilisatrice */
  function steps(h, interp, routine, actives) {
    const base = interp.context.skinBase || 'unknown', ind = id => h.main.find(i => i.id === id);
    const tierOf = id => h.tierOf[id];
    const followed = id => tierOf(id) === 'priority' || tierOf(id) === 'attention';
    const all = [...routine.slots.morning, ...routine.slots.evening];
    const exfoliant = all.some(s => s.kind === 'treatment' && (actives.byId(s.activeId).groups || []).includes('evening_strong'));
    const out = {};
    for (const st of all) {
      let t;
      if (st.owned) t = S.step.owned;
      else if (st.kind === 'cleanse') { t = S.step.cleanse[base] || S.step.cleanse.unknown; if (ind('acne') && followed('acne')) t += S.step.cleanseAcne(pick(ind('acne'))); }
      else if (st.kind === 'moisturize') {
        const parts = [];
        if (st.supportIds && st.supportIds.length) {
          const targets = [...new Set(st.supportIds.flatMap(id => actives.byId(id).targets))].map(ind).filter(i => i && followed(i.id));
          parts.push(S.step.moistSupports(st.supportIds.map(id => actives.byId(id).label), asc(targets)));
        }
        const hy = ind('hydration');
        if (hy && tierOf('hydration')) parts.push(S.step.moistTier[tierOf('hydration')](pick(hy)));
        if (base === 'oily') parts.push(copy.stepReason.moisturizeOily);
        if (base === 'dry') parts.push(S.step.moistDry);
        t = parts.join(' ') || copy.stepReason.moisturize('', []);
      } else if (st.kind === 'spf') {
        t = S.step.spf;
        const tone = ['pigmentation', 'radiance'].map(ind).filter(i => i && followed(i.id));
        if (tone.length) t += S.step.spfTone(asc(tone));
        if (exfoliant) t += S.step.spfExfoliant;
      } else if (st.kind === 'treatment') {
        t = S.step.treatment(st.activeLabel, asc((st.indicators || []).map(ind).filter(Boolean)));
      }
      out[st.id] = t;
    }
    return out;
  }

  /* 7. Pourquoi ce produit (ou pourquoi aucun) pour chaque étape */
  function products(h, routine, matches, catalogList, productsApi, actives) {
    const out = {};
    const focus = new Set([...h.tiers.priority, ...h.tiers.attention].map(i => i.id));
    for (const st of [...routine.slots.morning, ...routine.slots.evening]) {
      if (st.owned) continue;
      const m = (matches || []).find(x => x.stepId === st.id);
      if (!m) { out[st.id] = { status: 'none', productId: null, text: S.product.none[st.kind] || '' }; continue; }
      const p = productsApi && productsApi.byId ? productsApi.byId(m.productId, catalogList) : null;
      let text = productsApi.whyOf(m);
      const tg = p && !p.demo ? (p.targets || []).filter(id => focus.has(id)).map(id => skin.METRIC_LABELS[id]) : [];
      if (tg.length) text += S.product.targets(tg);
      out[st.id] = { status: 'matched', productId: m.productId, text };
    }
    return out;
  }

  function build({ interpretation, priorities, profile, routinePlan, productMatches, catalog, productsApi }) {
    const h = tiers(interpretation, priorities);
    const g = goals(h, profile, priorities.mode);
    const strat = strategy(h, g, interpretation, profile, routinePlan);
    return {
      tiers: h.tiers, tierOf: h.tierOf, homogeneous: h.homogeneous,
      informative: interpretation.indicators.filter(i => i.available && i.actionability === 'informative').map(pick),
      found: found(h),
      attention: attentionText(h, priorities, interpretation),
      goals: g,
      strategy: strat,
      steps: steps(h, interpretation, routinePlan, dep.actives),
      products: productsApi ? products(h, routinePlan, productMatches, catalog, productsApi, dep.actives) : {}
    };
  }

  return { build, tiers };
});
