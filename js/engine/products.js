/* Couche PRODUITS : relie un pas de routine à des produits du catalogue DE DÉMONSTRATION, par activeId (jamais par texte libre).
   Aucun score, aucun pourcentage de « correspondance ». Ordre déterministe : ingrédients recherchés présents, puis type de peau, puis
   ordre du catalogue. En mode confort, un produit contenant un actif plus exigeant que celui du pas n'est pas proposé. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { pdata: require('./data/products.js'), actives: require('./actives.js'), copy: require('./copy.fr.js') }
    : { pdata: E.productsData, actives: E.actives, copy: E.copy };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.products = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const PRODUCTS = dep.pdata.PRODUCTS, actives = dep.actives, copy = dep.copy;

  const byId = id => PRODUCTS.find(p => p.id === id) || null;
  const ids = p => p.ingredients.map(i => i.activeId).filter(Boolean);
  const demanding = id => { const a = actives.byId(id); return !!a && a.irritation !== 'low'; };
  const strong = id => { const a = actives.byId(id); return !!a && a.groups.length > 0; };
  const skinOk = (p, base) => !base || p.skinTypes.includes('all') || p.skinTypes.includes(base);

  function match(routine) {
    const out = [];
    const comfort = routine.comfortMode;
    const strongEvening = routine.slots.evening.some(st => st.kind === 'treatment' && strong(st.activeId));
    for (const slot of ['morning', 'evening']) {
      routine.slots[slot].forEach(step => {
        if (step.owned) return;
        const candidates = PRODUCTS.map((p, order) => ({ p, order })).filter(({ p }) => {
          if (step.kind === 'cleanse') return p.category === 'cleanser';
          if (step.kind === 'spf') return p.category === 'spf';
          if (step.kind === 'moisturize') return p.category === 'moisturizer';
          return p.category === 'serum' && ids(p).includes(step.activeId);
        }).filter(({ p }) => !comfort || !ids(p).some(id => demanding(id) && id !== step.activeId))
          /* Pas d'exfoliant ou de rétinoïde caché dans un autre produit le soir où le plan en contient déjà un. */
          .filter(({ p }) => step.kind === 'treatment' || !(slot === 'evening' && strongEvening) || !ids(p).some(id => strong(id)));
        let wanted = [];
        if (step.kind === 'treatment') wanted = [step.activeId];
        if (step.kind === 'moisturize') wanted = step.supportIds;
        const score = ({ p }) => wanted.filter(id => ids(p).includes(id)).length;
        let pool = candidates;
        if (step.kind === 'moisturize' && wanted.length) pool = candidates.filter(c => score(c) > 0);
        pool = pool.sort((a, b) => score(b) - score(a) || (skinOk(b.p, routine.skinBase) - skinOk(a.p, routine.skinBase)) || a.order - b.order);
        if (!pool.length) return;
        const p = pool[0].p, because = wanted.filter(id => ids(p).includes(id));
        out.push({ stepId: step.id, kind: step.kind, productId: p.id, activeIds: because,
          because: because.length ? copy.productBecause(because.map(id => actives.byId(id).label)) : null, demo: p.demo === true });
      });
    }
    return out;
  }

  return { PRODUCTS, byId, match, ids };
});
