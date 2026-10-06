/* CATALOGUE RÉEL de produits DERMAI : vide tant qu'aucune donnée vérifiée n'existe.
   Mode réel : seuls les produits listés ICI peuvent apparaître. Aucun produit de démonstration (data/products.js) n'est jamais montré en mode réel.

   Ajouter un produit = ajouter une entrée ci-dessous, avec uniquement des informations vérifiées (un test valide chaque entrée : validateProduct) :
     { id: 'serum-niacinamide-x', name: '…', brand: '…', category: 'cleanser' | 'serum' | 'moisturizer' | 'spf',
       ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide 10 %' }, …],   // activeId = identifiant d'un actif DERMAI, ou null
       primaryActiveId: 'niacinamide',                                             // soin ciblé : l'actif pour lequel DERMAI le propose
       skinTypes: ['all'], targets: ['pores'], description: '…', active: true, demo: false,
       // commercial : laisser null / omettre tant que non vérifié
       availability: 'available' | 'unavailable' | 'coming_soon' | null, vendor: '…' | null, url: 'https://…' | null,
       price: { amount: 9500, currency: 'XOF' } | null, priceSource: '…', priceCheckedAt: 'AAAA-MM-JJ',   // le prix exige sa source et sa date
       image: { src: 'img/products/….jpg', alt: '…' } | null }
   Aucun champ de score ou de « correspondance ». Le rétinoïde reste « à valider » : un produit qui en contient n'est jamais recommandé automatiquement. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.catalogData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PRODUCTS = [];
  return { PRODUCTS };
});
