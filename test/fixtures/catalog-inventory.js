'use strict';
/* INVENTAIRE OBSERVÉ du catalogue réel, pour les tests.
   Principe : observer, ne jamais copier. Rien ici ne reproduit un nombre du catalogue : tout est dérivé de js/engine/data/catalog.js au moment du test.
   Un test qui a besoin de « savoir ce qu'il y a » le demande ici ; un test qui vérifie une RÈGLE construit ses propres données (voir `synthetic`) ou prend ce que l'inventaire lui donne.
   Les définitions ci-dessous (utilisable, avec offre...) sont volontairement indépendantes du moteur : elles ne rappellent pas les fonctions testées. */
const CAT = require('../../js/engine/data/catalog.js');
const MD = require('../../js/engine/data/markets.js');

const clone = o => JSON.parse(JSON.stringify(o));
const products = CAT.PRODUCTS;
const byId = id => products.find(p => p.id === id) || null;
const rawOffers = p => (p && Array.isArray(p.offers) ? p.offers : []);

const validatedProducts = products.filter(p => p.status === 'validated');
const toVerifyProducts = products.filter(p => p.status === 'to_verify');
const usableProducts = products.filter(p => p.status !== 'to_verify' && p.active !== false);   // même définition publique que « utilisable » : validé et actif
const productsWithOffers = products.filter(p => rawOffers(p).length > 0);
const productsWithoutOffers = products.filter(p => rawOffers(p).length === 0);
const usableProductsWithoutOffers = usableProducts.filter(p => rawOffers(p).length === 0);
const offers = products.flatMap(p => rawOffers(p).map(offer => ({ productId: p.id, product: p, offer })));
const markets = [...new Set(offers.map(x => x.offer.market))].sort();            // pays qui ont au moins une offre
const countryCodes = MD.COUNTRIES.map(c => c.code);                              // tous les pays connus du marché

/* Une copie du catalogue, offres retirées : la même identité produit, aucun commerce. */
const withoutAnyOffer = list => (list || products).map(p => Object.assign(clone(p), { offers: [], marketChecks: undefined }));

/* Produit utilisable (validé, actif) « sans offre » pour un test de règle. Si le catalogue en contient un, on le prend tel quel ; sinon on construit EXPLICITEMENT une copie d'un produit réel sans offre
   (`synthetic: true`) : le scénario reste représenté, aucun produit n'est inventé. */
function productWithoutOffers() {
  if (usableProductsWithoutOffers.length) return { product: usableProductsWithoutOffers[0], synthetic: false };
  const base = usableProducts[0] || products[0];
  return { product: Object.assign(clone(base), { offers: [], marketChecks: undefined }), synthetic: true };
}

/* Un produit réel validé et actif sert de modèle d'identité à des produits d'essai dont le test choisit les offres. */
const template = () => clone(usableProducts[0]);
const withOffers = (p, offs, checks) => Object.assign(clone(p), { offers: offs }, checks ? { marketChecks: checks } : {});

/* Offres d'essai : de vraies formes d'offre, des valeurs d'essai (jamais livrées). */
const HOME_CURRENCY = Object.fromEntries(MD.COUNTRIES.map(c => [c.code, c.currency]));
const testOffer = (extra) => Object.assign({ market: 'NG', retailer: 'Vendeur de test', type: 'retailer', currency: 'NGN', price: 1000, availability: 'in_stock',
  url: 'https://boutique-vraie.org/produit', shipping: null, source: 'Relevé de test', checkedAt: '2026-10-01' }, extra || {});
const testOfferIn = (market, extra) => testOffer(Object.assign({ market, currency: HOME_CURRENCY[market], retailer: 'Vendeur ' + market, url: 'https://boutique-vraie.org/' + market.toLowerCase() }, extra || {}));

module.exports = { CAT, MD, clone, products, byId, rawOffers, validatedProducts, toVerifyProducts, usableProducts, productsWithOffers, productsWithoutOffers, usableProductsWithoutOffers, offers, markets, countryCodes,
  withoutAnyOffer, productWithoutOffers, template, withOffers, HOME_CURRENCY, testOffer, testOfferIn };
