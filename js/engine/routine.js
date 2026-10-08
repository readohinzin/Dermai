/* Couche ROUTINE : plan matin / soir à partir des priorités, des actifs choisis, du contexte et du niveau de routine déclaré.
   Étapes : nettoyage doux, soins ciblés (seulement ceux du plan), hydratation, protection solaire (matin). Pas de routine de 8 produits :
   le nombre de soins ciblés est plafonné par niveau (data.LIMITS, provisoire). Une routine minimale reste possible. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { data: require('./data/actives.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'), indicators: require('./data/indicators.js'), skin: require('../skin-model.js') }
    : { data: E.activesData, actives: E.actives, copy: E.copy, indicators: E.indicatorsData, skin: root.SkinModel };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.routine = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data, actives = dep.actives, copy = dep.copy, skin = dep.skin;

  function build(interp, prios, plan, profile) {
    const limits = data.LIMITS[profile.level] || data.LIMITS[data.DEFAULT_LEVEL];
    const owned = new Set(profile.cats || []);
    const ctx = interp.context;
    const texture = copy.TEXTURE[ctx.skinBase || 'unknown'];
    const supportIds = plan.supports.map(s => s.activeId);
    const supportLabels = supportIds.map(id => actives.byId(id).label);
    const slots = { morning: [], evening: [] };
    const extraDeferred = [];
    const labelOf = id => skin.METRIC_LABELS[id];
    /* Rougeurs : repère de décision « mid » sans mode confort : prudence renforcée (introduction plus lente) pour les actifs plus demandants. */
    const rednessSoft = ((interp.indicators || []).find(i => i.id === 'redness') || {}).band === 'mid';

    for (const slot of ['morning', 'evening']) {
      slots[slot].push({ id: slot + ':cleanse', slot, kind: 'cleanse', label: copy.STEP_LABELS.cleanse, owned: owned.has('cleanser'), origin: 'base',
        reason: owned.has('cleanser') ? copy.stepReason.owned : copy.stepReason.cleanse });
    }
    /* Allocation des créneaux : d'abord les actifs contraints (un seul créneau possible), puis les flexibles, qui prennent leur créneau
       habituel s'il reste de la place, sinon l'autre. L'ordre d'affichage reste celui du plan. */
    const taken = { morning: 0, evening: 0 };
    const chosenSlot = new Map();
    const full = s => taken[s] >= limits.perSlot;
    const entries = plan.treatments.map(t => ({ t, a: actives.byId(t.activeId) }));
    for (const { t, a } of entries.filter(e => e.a.when !== 'both')) {
      const slot = a.defaultSlot;
      if (full(slot)) { extraDeferred.push({ activeId: t.activeId, kind: 'slot', indicators: t.indicators }); continue; }
      taken[slot]++; chosenSlot.set(t.activeId, slot);
    }
    for (const { t, a } of entries.filter(e => e.a.when === 'both')) {
      const alt = a.defaultSlot === 'morning' ? 'evening' : 'morning';
      const slot = !full(a.defaultSlot) ? a.defaultSlot : !full(alt) ? alt : null;
      if (!slot) { extraDeferred.push({ activeId: t.activeId, kind: 'slot', indicators: t.indicators }); continue; }
      taken[slot]++; chosenSlot.set(t.activeId, slot);
    }
    for (const { t, a } of entries) {
      const slot = chosenSlot.get(t.activeId);
      if (!slot) continue;
      slots[slot].push({ id: slot + ':treatment:' + a.id, slot, kind: 'treatment', label: copy.STEP_LABELS.treatment, activeId: a.id, activeLabel: a.label,
        origin: t.origin || 'priority',   // priority | accompaniment (les étapes de nettoyant, d'hydratant et de protection solaire sont « base »)
        reason: t.origin === 'accompaniment' ? copy.accompanimentStep(a.label, t.indicators.map(labelOf))
          : copy.activeReason(t.indicators.map(labelOf), t.gentleFallback, t.indicators.filter(i => a.evidence.editorial.includes(i)).map(labelOf)), indicators: t.indicators,
        introduction: { frequency: a.introduction.frequency, note: a.introduction.note, order: t.introductionOrder },
        cautions: a.cautions, slowDown: (ctx.comfortMode || ctx.skinBase === 'dry' || rednessSoft) && a.irritation !== 'low' });
    }
    for (const slot of ['morning', 'evening']) {
      slots[slot].push({ id: slot + ':moisturize', slot, kind: 'moisturize', label: copy.STEP_LABELS.moisturize, owned: owned.has('moisturizer'), origin: 'base', supportIds, texture,
        reason: owned.has('moisturizer') ? copy.stepReason.owned : copy.stepReason.moisturize(texture, supportLabels) });
    }
    slots.morning.push({ id: 'morning:spf', slot: 'morning', kind: 'spf', label: copy.STEP_LABELS.spf, owned: owned.has('spf'), origin: 'base',
      reason: owned.has('spf') ? copy.stepReason.owned : copy.stepReason.spf });

    const placed = [...slots.morning, ...slots.evening].filter(s => s.kind === 'treatment');
    const deferred = plan.deferred.concat(extraDeferred);
    const notes = [copy.NOTES.level[profile.level] || copy.NOTES.level.simple];
    if (placed.length > 1 || placed.some(s => s.slowDown)) notes.push(copy.NOTES.oneAtATime);
    if (deferred.some(d => d.kind === 'conflict') || placed.some(s => actives.byId(s.activeId).groups.length > 0)) notes.push(copy.NOTES.oneStrong);
    if (placed.some(s => { const a = actives.byId(s.activeId); return a.irritation !== 'low'; })) notes.push(copy.NOTES.marks);
    if (ctx.comfortMode) notes.push((ctx.comfortReasons || []).join() === 'user_preference' ? copy.PERSONAL.comfortUser : copy.NOTES.comfort);
    if (ctx.skinBase === 'dry') notes.push(copy.NOTES.dry);
    return {
      level: profile.level, exclusions: profile.exclusions || [], mode: prios.mode, comfortMode: ctx.comfortMode, skinBase: ctx.skinBase,
      summary: copy.summary(prios.items.map(i => i.label), prios.mode), slots, notes, deferred
    };
  }

  return { build };
});
