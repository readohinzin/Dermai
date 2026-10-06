/* Catalogue de produits DE DÉMONSTRATION. Aucun produit réel, aucun vendeur, aucune disponibilité, aucun lien, aucune affiliation.
   Les prix sont des valeurs de démonstration. Les ingrédients sont reliés au catalogue d'actifs par `activeId` (jamais par texte libre) ;
   un ingrédient sans activeId n'est qu'un libellé d'information. Aucun champ de « correspondance » : un produit n'est jamais noté. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.productsData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* category : cleanser | serum | moisturizer | spf. type, color : seulement pour l'illustration du flacon. */
  const PRODUCTS = [
    { id: 'p1', name: 'Gel nettoyant doux', brand: 'Nuru Lab', category: 'cleanser', type: 'pump', color: '#E9C4CC', price: { amount: 6500, currency: 'XOF' },
      ingredients: [{ activeId: 'glycerin', label: 'Glycérine' }, { activeId: 'salicylic', label: 'Acide salicylique 0,5 %' }], skinTypes: ['combination'], targets: ['pores', 'acne'],
      vendor: null, availability: null, url: null, demo: true },
    { id: 'p2', name: 'Sérum Éclat Vitamine C 10 %', brand: 'Oria', category: 'serum', type: 'dropper', color: '#E9B99A', price: { amount: 12900, currency: 'XOF' },
      ingredients: [{ activeId: 'vitamin_c', label: 'Vitamine C 10 %' }, { activeId: null, label: 'Vitamine E' }], skinTypes: ['all'], targets: ['pigmentation', 'radiance'],
      vendor: null, availability: null, url: null, demo: true },
    { id: 'p3', name: 'Sérum Uniformité Acide azélaïque 10 %', brand: 'Kalma', category: 'serum', type: 'dropper', color: '#D9A3B0', price: { amount: 15500, currency: 'XOF' },
      ingredients: [{ activeId: 'azelaic', label: 'Acide azélaïque 10 %' }, { activeId: 'niacinamide', label: 'Niacinamide 2 %' }], skinTypes: ['combination'], targets: ['pigmentation', 'acne'],
      vendor: null, availability: null, url: null, demo: true },
    { id: 'p4', name: 'Lotion Pores Affinés', brand: 'Nuru Lab', category: 'serum', type: 'dropper', color: '#F0CFD5', price: { amount: 9800, currency: 'XOF' },
      ingredients: [{ activeId: 'salicylic', label: 'Acide salicylique 2 %' }], skinTypes: ['combination', 'oily'], targets: ['pores', 'acne'],
      vendor: null, availability: null, url: null, demo: true },
    { id: 'p5', name: 'Crème légère Hydra Équilibre', brand: 'Kalma', category: 'moisturizer', type: 'jar', color: '#F3D9C8', price: { amount: 11000, currency: 'XOF' },
      ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide 4 %' }, { activeId: 'hyaluronic', label: 'Acide hyaluronique' }, { activeId: 'ceramides', label: 'Céramides' }],
      skinTypes: ['combination'], targets: ['hydration', 'pores'], vendor: null, availability: null, url: null, demo: true },
    { id: 'p6', name: 'Fluide invisible SPF 50+', brand: 'Oria', category: 'spf', type: 'tube', color: '#F6C9B0', price: { amount: 8900, currency: 'XOF' },
      ingredients: [{ activeId: null, label: 'Filtres UV large spectre' }], skinTypes: ['all'], targets: ['pigmentation'],
      vendor: null, availability: null, url: null, demo: true },
    { id: 'p7', name: 'Crème barrière Nuit Réconfort', brand: 'Sève Botanique', category: 'moisturizer', type: 'jar', color: '#DDB5BC', price: { amount: 13500, currency: 'XOF' },
      ingredients: [{ activeId: 'hyaluronic', label: 'Acide hyaluronique' }, { activeId: 'ceramides', label: 'Céramides' }, { activeId: 'squalane', label: 'Squalane' }],
      skinTypes: ['dry', 'combination'], targets: ['hydration'], vendor: null, availability: null, url: null, demo: true },
    { id: 'p8', name: 'Sérum Pores et Texture Niacinamide 10 %', brand: 'Nuru Lab', category: 'serum', type: 'dropper', color: '#E4B6C0', price: { amount: 10500, currency: 'XOF' },
      ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide 10 %' }, { activeId: null, label: 'Zinc' }], skinTypes: ['combination', 'oily'], targets: ['pores', 'texture'],
      vendor: null, availability: null, url: null, demo: true }
  ];

  return { PRODUCTS };
});
