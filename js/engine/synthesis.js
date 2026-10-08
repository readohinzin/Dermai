/* Couche SYNTHÈSE : transforme les décisions du moteur en une lecture personnalisée, déterministe et vérifiable, en quatre parties
   distinctes, jamais confondues :
     1. shows    « Ce que l'analyse montre »        : les résultats, tels qu'affichés (score affiché, ui_score) ;
     2. lowest   « Vos résultats les moins élevés » : comparaison RELATIVE entre vos propres résultats, jamais un problème ;
     3. retained « Ce que DERMAI retient »          : seulement les besoins retenus par une règle DERMAI (priorities.js) ;
     4. strategy « Votre stratégie »                : la conséquence sur la routine.

   Elle ne décide RIEN de nouveau : elle lit l'interprétation, les priorités, les objectifs, la routine et les produits déjà calculés.
   Classement (moins élevés, plus élevés) : valeur de DÉCISION (raw_score, ou score affiché en compatibilité), puis ordre fixe des
   indicateurs. Les textes ne montrent que le score affiché : un score brut n'est jamais affiché.
   Taille des groupes : MAX_PRIORITIES (3) au plus, et jamais plus de la moitié des indicateurs principaux.
   Jamais lus ici : masques de localisation, pays, offres, prix. Aucun aléa, aucune IA. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { skin: require('../skin-model.js'), priorities: require('./priorities.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'),
        indicators: require('./data/indicators.js'), decision: require('./data/decision.js') }
    : { skin: root.SkinModel, priorities: E.priorities, actives: E.actives, copy: E.copy, indicators: E.indicatorsData, decision: E.decisionData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.synthesis = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const skin = dep.skin, copy = dep.copy, S = copy.SYNTH, D = dep.indicators, DEC = dep.decision;
  const N = dep.priorities.MAX_PRIORITIES;
  const pick = i => ({ id: i.id, label: i.label, score: i.score, band: i.band, role: i.role, domain: i.domain });
  /* Groupes de la synthèse : tri strict par valeur de décision (à égalité, ordre fixe). La tolérance ±TIE_TOLERANCE ne sert qu'au
     classement des besoins retenus (priorities.js). */
  const asc = list => [...list].sort((a, b) => a.value - b.value || a.order - b.order);
  const desc = list => [...list].sort((a, b) => b.value - a.value || a.order - b.order);
  const under = i => i.band === 'low' || i.band === 'mid';

  /* 1. Hiérarchie : besoins retenus, résultats les moins élevés, résultats les plus élevés, autres. */
  function tiers(interp, prios) {
    const main = interp.indicators.filter(i => i.available && DEC.isComparable(i.id));
    const values = main.map(i => i.value);
    const gap = main.length ? Math.max(...values) - Math.min(...values) : 0;
    const homogeneous = main.length > 1 && gap <= DEC.TIE_TOLERANCE;
    const size = Math.min(N, Math.floor(main.length / 2));
    const lowest = homogeneous ? [] : asc(main).slice(0, size);
    const low = new Set(lowest.map(i => i.id));
    const strength = homogeneous ? [] : desc(main.filter(i => !low.has(i.id))).slice(0, size);
    const prioIds = new Set(prios.items.map(p => p.indicator));
    const tierOf = {};
    for (const i of main) tierOf[i.id] = prioIds.has(i.id) ? 'priority' : low.has(i.id) ? 'lowest' : strength.some(x => x.id === i.id) ? 'strength' : 'other';
    /* Sélection par valeur de décision ; présentation par score affiché (ce que l'utilisateur lit), à égalité valeur puis ordre fixe. */
    const shown = (list, dir) => [...list].sort((a, b) => dir * (a.score - b.score) || dir * (a.value - b.value) || a.order - b.order).map(pick);
    const out = {
      priority: prios.items.map(p => pick(main.find(i => i.id === p.indicator))),
      lowest: shown(lowest, 1),
      strength: shown(strength, -1),
      other: asc(main.filter(i => tierOf[i.id] === 'other')).map(pick)
    };
    return { tiers: out, tierOf, homogeneous, main, prioIds };
  }

  /* 2. Les quatre parties */
  function shows(h, interp) {
    const parts = [];
    if (h.main.length) {
      const sc = h.main.map(i => i.score);
      parts.push(S.range(h.main.length, Math.min(...sc), Math.max(...sc)));
    }
    if (h.homogeneous) parts.push(S.homogeneous);
    else if (h.tiers.strength.length) parts.push(S.strengths(h.tiers.strength));
    if (interp.skinType) parts.push(S.skinType(interp.skinType.label));
    return parts.join(' ');
  }
  function lowestText(h) {
    if (!h.tiers.lowest.length) return h.homogeneous ? S.homogeneous : '';
    return S.lowest(h.tiers.lowest) + ' ' + S.lowestNote;
  }
  function retained(h, prios, interp, profile) {
    const parts = [];
    if (prios.items.length) {
      const strong = h.tiers.priority.filter(i => i.band === 'low'), support = h.tiers.priority.filter(i => i.band !== 'low');
      parts.push(S.retained(strong, support)); parts.push(S.retainedWhy(prios.items.length));
    }
    else parts.push(S.noNeed);
    const goals = profile.goals || [];
    const rest = h.main.filter(i => !h.prioIds.has(i.id));
    const cand = rest.filter(i => dep.priorities.isCandidate(i, goals));
    const noLever = rest.filter(i => under(i) && dep.priorities.roleAllows(i, goals) && !dep.actives.hasLever(i.id));
    if (cand.length) parts.push(S.beyondCap(asc(cand).map(pick)));
    if (noLever.length) parts.push(S.noLever(asc(noLever).map(pick)));
    /* Descriptifs : mentionnés s'ils figurent parmi les moins élevés ou sous les repères (jamais un besoin). */
    const low = new Set(h.tiers.lowest.map(i => i.id));
    const descr = rest.filter(i => i.role === 'descriptive' && (low.has(i.id) || under(i)));
    if (descr.length) parts.push(S.descriptive(asc(descr).map(pick)));
    /* Soumis à un objectif : seulement s'ils sont sous les repères et que l'objectif n'est pas choisi. Un repère favorable n'est jamais un problème. */
    const gated = rest.filter(i => i.role === 'goal_gated' && under(i) && !goals.includes(i.roleGoal));
    if (gated.length) parts.push(S.gated(asc(gated).map(pick), [...new Set(gated.map(i => copy.GOAL_LABELS[i.roleGoal]))]));
    if (interp.basis !== 'raw' && h.main.length) parts.push(S.compat);
    return parts.join(' ');
  }

  /* Statut DERMAI de chaque indicateur affiché (carte du visage, page d'un indicateur). Lecture des décisions déjà prises : le masque
     de localisation n'entre jamais ici. */
  function statuses(interp, prios, profile) {
    const goals = profile.goals || [], kept = new Map(prios.items.map(p => [p.indicator, p]));
    const out = {};
    for (const i of interp.indicators.filter(x => x.available)) {
      let state;
      if (kept.has(i.id)) state = i.band === 'low' ? 'priority' : 'support';
      else if (!under(i)) state = 'favorable';
      else if (i.role === 'descriptive') state = 'descriptive';
      else if (i.role === 'informative' || (i.role === 'goal_gated' && !goals.includes(i.roleGoal))) state = 'informative';
      else if (dep.priorities.isCandidate(i, goals)) state = 'beyond';
      else state = 'noLever';
      const goal = i.role === 'goal_gated' ? copy.GOAL_LABELS[i.roleGoal] : null;
      out[i.id] = { id: i.id, label: i.label, score: i.score, state, level: S.LEVELS[state], text: state === 'informative' ? S.status.informative(goal) : S.status[state] };
    }
    return out;
  }

  /* 3. Objectifs : chacun est relié à son statut réel (personalization.js) et aux indicateurs concernés. Un objectif n'oriente que s'il
        existe déjà une base exploitable ; sinon il n'ajoute rien. */
  function goals(h, profile, mode, statuses) {
    if (!profile.goals.length) return { mode: 'none', items: [], text: S.noGoal, matched: [] };
    const matched = [];
    const items = profile.goals.map(id => {
      const g = D.GOALS.find(x => x.id === id), label = copy.GOAL_LABELS[id];
      if (!g.domain) return { id, label, status: 'maintenance', indicators: [], text: S.goal.maintenance(label, mode === 'action') };
      const st = (statuses || []).find(x => x.id === id), status = st ? st.status : 'unavailable';
      const dom = h.main.filter(i => i.domain === g.domain);
      const acts = i => i.role === 'actionable' || (i.role === 'goal_gated' && i.roleGoal === id);
      let sel;
      if (status === 'priority') sel = dom.filter(i => h.prioIds.has(i.id));
      else if (status === 'beyond_cap') sel = dom.filter(i => !h.prioIds.has(i.id) && dep.priorities.isCandidate(i, profile.goals));
      else if (status === 'descriptive') sel = dom;
      else sel = dom.filter(acts);
      sel = asc(sel).map(pick);
      if (status === 'priority') matched.push(...sel.map(i => i.id));
      const text = !sel.length || !S.goal[status] ? S.goal.unavailable(label) : S.goal[status](label, sel);
      return { id, label, status, indicators: sel, text };
    });
    return { mode: 'set', items, text: items.map(i => i.text).join(' '), matched: [...new Set(matched)] };
  }

  /* 4. Stratégie : conséquence des besoins retenus, des objectifs, du profil et du niveau */
  function strategy(h, g, interp, profile, routine) {
    const treatments = [...routine.slots.morning, ...routine.slots.evening].filter(s => s.kind === 'treatment');
    const skinLabel = interp.skinType ? interp.skinType.label : null;
    let mode, text, focus = [];
    if (h.tiers.priority.length) {
      mode = 'action';
      focus = [...h.tiers.priority.filter(i => g.matched.includes(i.id)), ...h.tiers.priority.filter(i => !g.matched.includes(i.id))];
      text = treatments.length ? S.strategy.action(focus, treatments.length, copy.lower(copy.LEVEL_SHORT[profile.level] || '')) : S.strategy.actionNoTreatment(focus);
    } else { mode = 'maintenance'; text = S.strategy.maintenance(skinLabel); }
    return { mode, focus: focus.map(i => i.id), text, skinContext: skinLabel ? S.skinContext(skinLabel) : null };
  }

  /* 5. Pourquoi chaque étape de la routine existe. Les étapes de base sont dites telles quelles : jamais « elle entretient votre score ». */
  function steps(h, interp, routine, actives, profile) {
    const base = interp.context.skinBase || 'unknown', ind = id => h.main.find(i => i.id === id);
    const all = [...routine.slots.morning, ...routine.slots.evening];
    const exfoliant = all.some(s => s.kind === 'treatment' && (actives.byId(s.activeId).groups || []).includes('evening_strong'));
    const out = {};
    for (const st of all) {
      let t;
      if (st.owned) t = S.step.owned;
      else if (st.kind === 'cleanse') t = S.step.base + (S.step.cleanse[base] || '');
      else if (st.kind === 'moisturize') {
        t = S.step.base;
        if (h.prioIds.has('hydration')) t += S.step.moistKept;
        if (st.supportIds && st.supportIds.length) {
          const targets = [...new Set(st.supportIds.flatMap(id => actives.byId(id).targets))].map(ind).filter(i => i && i.id !== 'hydration' && h.prioIds.has(i.id));
          t += S.step.moistSupports(st.supportIds.map(id => actives.byId(id).label), asc(targets).map(pick));
        }
        if (base === 'oily') t += ' ' + copy.stepReason.moisturizeOily;
        if (base === 'dry') t += S.step.moistDry;
      } else if (st.kind === 'spf') {
        t = S.step.base + (exfoliant ? S.step.spfExfoliant : '');
      } else if (st.kind === 'treatment') {
        const inds = asc((st.indicators || []).map(ind).filter(Boolean));
        const g = (profile.goals || []).find(id => { const d = (D.GOALS.find(x => x.id === id) || {}).domain; return d && inds.some(i => i.domain === d); });
        t = S.step.treatment(st.activeLabel, inds.map(pick), g ? copy.GOAL_LABELS[g] : null);
      }
      out[st.id] = t;
    }
    return out;
  }

  /* 6. Pourquoi ce produit (ou pourquoi aucun) pour chaque étape. Un produit est toujours « proposé par DERMAI ». */
  function products(h, routine, matches, catalogList, productsApi) {
    const out = {};
    for (const st of [...routine.slots.morning, ...routine.slots.evening]) {
      if (st.owned) continue;
      const m = (matches || []).find(x => x.stepId === st.id);
      if (!m) { out[st.id] = { status: 'none', productId: null, text: S.product.none[st.kind] || '' }; continue; }
      const p = productsApi && productsApi.byId ? productsApi.byId(m.productId, catalogList) : null;
      let text = productsApi.whyOf(m);
      const tg = p && !p.demo ? (p.targets || []).filter(id => h.prioIds.has(id)).map(id => skin.METRIC_LABELS[id]) : [];
      if (tg.length) text += S.product.targets(tg);
      out[st.id] = { status: 'matched', productId: m.productId, text };
    }
    return out;
  }

  function build({ interpretation, priorities, profile, goalStatuses, routinePlan, productMatches, catalog, productsApi }) {
    const h = tiers(interpretation, priorities);
    const g = goals(h, profile, priorities.mode, goalStatuses);
    const strat = strategy(h, g, interpretation, profile, routinePlan);
    const sections = { shows: shows(h, interpretation), lowest: lowestText(h), retained: retained(h, priorities, interpretation, profile), strategy: strat.text };
    return {
      basis: interpretation.basis,
      titles: S.TITLES, sections, scoreNote: S.scoreNote,
      tiers: h.tiers, tierOf: h.tierOf, homogeneous: h.homogeneous,
      informative: interpretation.indicators.filter(i => i.available && DEC.isInformative(i.id)).map(pick),
      goals: g,
      strategy: strat,
      steps: steps(h, interpretation, routinePlan, dep.actives, profile),
      indicators: statuses(interpretation, priorities, profile),
      products: productsApi ? products(h, routinePlan, productMatches, catalog, productsApi) : {}
    };
  }

  return { build, tiers };
});
