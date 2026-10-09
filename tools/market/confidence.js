'use strict';
/* CONFIDENCE : « quelle est la FIABILITÉ de ce que nous avons trouvé ? » Évalue une observation commerciale déjà passée par le matcher.
   Pur, déterministe, explicable, sans réseau, sans horloge (la date de référence est fournie : opts.now), sans mutation de l'entrée.
   Il ne répond PAS à « est-ce le bon produit ? » (match.js, déjà fait) ni à « dans quel marché est-ce disponible ? » (classify.js) : ces trois questions restent séparées.

   PRINCIPE : des DIMENSIONS et des RÈGLES, pas une formule. Chaque dimension reçoit un niveau (HIGH, MEDIUM, LOW, UNKNOWN ; REJECTED pour un produit contredit) et un code.
   Le niveau global part du niveau du PRODUIT et ne peut qu'être ABAISSÉ par des plafonds nommés (CAP_*). Aucun coefficient, aucun seuil de score.
   Le `score` renvoyé est AUXILIAIRE (observer, trier) : calculé APRÈS le niveau, jamais lu par la décision.

   Le MARCHÉ (pays du vendeur) est une dimension d'information : il ne plafonne PAS le niveau. Un produit sûr à 100 % peut avoir un marché inconnu ; classify.js le dira (UNKNOWN). */
const O = require('./observation.js');

const SCHEMA = 'confidence/1';
const LEVELS = ['REJECTED', 'LOW', 'MEDIUM', 'HIGH'];                      // niveaux globaux, du plus faible au plus fort
const DIM_RANK = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };               // niveaux d'une dimension (REJECTED : produit seulement)
const FRESHNESS_DAYS = Object.freeze({ fresh: 30, recent: 90 });           // frais ≤ 30 jours ; récent ≤ 90 ; ancien au-delà. Réglable par opts.freshness. Jamais un motif de suppression.
const DIMENSIONS = ['product', 'seller', 'market', 'price', 'stock', 'url', 'source', 'freshness'];

const REASONS = {
  // produit
  PRODUCT_EXACT_MATCH: 'produit : correspondance exacte (EXACT_MATCH)', PRODUCT_STRONG_MATCH: 'produit : correspondance forte (STRONG_MATCH) : marque, nom et dimensions essentielles concordent, sans contradiction', PRODUCT_AMBIGUOUS: 'produit : identité ambiguë (POSSIBLE_MATCH) : une information distinctive manque',
  PRODUCT_IS_VARIANT: 'produit : variante ou autre format (VARIANT_MATCH) : ce n\'est pas une offre du produit exact', PRODUCT_REJECTED: 'produit : contredit (NO_MATCH)', PRODUCT_NOT_MATCHED: 'produit : aucun résultat de matching fourni',
  PRODUCT_ASSIGNED_BY_CATALOG: 'produit : rattaché par le catalogue (non vérifié par le matcher)',
  // vendeur
  SELLER_REGISTERED_VERIFIED: 'vendeur : enregistré et vérifié', SELLER_REGISTERED: 'vendeur : enregistré, non vérifié', SELLER_IDENTIFIED: 'vendeur : identifié par son nom, absent du registre', SELLER_UNKNOWN: 'vendeur : inconnu',
  // marché (pays du vendeur)
  MARKET_COUNTRY_ESTABLISHED: 'pays du vendeur : établi (base explicite et source)', MARKET_COUNTRY_DEDUCED: 'pays du vendeur : seulement déduit d\'un indice (devise, domaine, langue...)', MARKET_COUNTRY_UNKNOWN: 'pays du vendeur : inconnu',
  MARKET_COUNTRY_CONFLICT: 'pays du vendeur : indications contradictoires', MARKET_COUNTRY_INVALID: 'pays du vendeur : code invalide',
  // prix
  PRICE_DISPLAYED: 'prix : affiché, chiffré, avec devise, pour le produit visé', PRICE_ABSENT: 'prix : absent (cela n\'invalide pas l\'offre)', PRICE_INVALID: 'prix : incomplet ou invalide (montant ou devise)',
  PRICE_NOT_DISPLAYED: 'prix : estimé ou converti, non affiché tel quel', PRICE_NOT_FOR_TARGET: 'prix : appartient à une fiche qui n\'est pas le produit visé',
  // stock
  STOCK_IN_STOCK: 'stock : disponible, mention explicite', STOCK_OUT_OF_STOCK: 'stock : rupture, mention explicite', STOCK_COMING_SOON: 'stock : bientôt disponible, mention explicite', STOCK_UNKNOWN: 'stock : inconnu (jamais déduit)',
  // url
  URL_PRODUCT_PAGE: 'lien : fiche produit', URL_SELLER_ROOT: 'lien : page d\'accueil du vendeur (pas une fiche produit)', URL_CATEGORY: 'lien : page de catégorie (pas une fiche produit)', URL_SEARCH: 'lien : page de recherche (pas une fiche produit)',
  URL_KIND_UNKNOWN: 'lien : présent, nature non établie', URL_ABSENT: 'lien : absent',
  // source
  SOURCE_SELLER_PAGE_REOPENED: 'source : page du vendeur, rouverte', SOURCE_SELLER_PAGE_NOT_REOPENED: 'source : page du vendeur, non rouverte', SOURCE_TEAM_PROVIDED: 'source : relevé fourni par l\'équipe DERMAI, page non rouverte',
  SOURCE_MARKETPLACE_REOPENED: 'source : fiche de place de marché, rouverte', SOURCE_MARKETPLACE_NOT_REOPENED: 'source : fiche de place de marché, non rouverte',
  SOURCE_MANUFACTURER_ONLY: 'source : fiche fabricant (établit le produit, pas une vente)', SOURCE_WEAK: 'source : moteur de recherche, extrait ou source secondaire', SOURCE_UNKNOWN: 'source : non indiquée',
  // fraîcheur
  FRESHNESS_FRESH: 'fraîcheur : relevé frais', FRESHNESS_RECENT: 'fraîcheur : relevé récent', FRESHNESS_STALE: 'fraîcheur : relevé ancien (peut être vrai historiquement, pas présenté comme frais)',
  FRESHNESS_UNKNOWN: 'fraîcheur : date du relevé absente, invalide ou référence temporelle non fournie', FRESHNESS_FUTURE_DATE: 'fraîcheur : date du relevé postérieure à la date de référence',
  // plafonds du niveau global
  CAP_PRODUCT_NOT_TARGET: 'plafond : le produit n\'est pas établi comme le produit visé', CAP_CONTRADICTION: 'plafond : indications contradictoires dans l\'observation',
  CAP_SOURCE_WEAK: 'plafond : source faible ou non indiquée', CAP_SOURCE_NOT_FIRST_HAND: 'plafond : source non rouverte par DERMAI', CAP_SELLER_UNKNOWN: 'plafond : vendeur inconnu',
  CAP_FRESHNESS: 'plafond : relevé ni frais ni daté', CAP_INCOMPLETE: 'plafond : fiche incomplète (prix, stock explicite ou fiche produit manquants)',
  // résultat
  ALL_REQUIREMENTS_MET: 'toutes les conditions du niveau élevé sont réunies',
  // contradictions
  CONTRADICTION_FUTURE_DATE: 'la date du relevé est postérieure à la date de référence', CONTRADICTION_SELLER_COUNTRY: 'plusieurs pays de vendeur différents', CONTRADICTION_DELIVERY: 'livraison à la fois confirmée et refusée pour un même pays',
  // avertissements
  W_STOCK_OUT_OF_STOCK: 'rupture explicite : pas une disponibilité actuelle (preuve historique seulement)', W_STOCK_COMING_SOON: 'produit pas encore disponible', W_PRICE_ABSENT: 'prix absent', W_URL_NOT_PRODUCT_PAGE: 'le lien n\'est pas une fiche produit',
  W_SELLER_UNREGISTERED: 'vendeur absent du registre', W_MARKET_UNKNOWN: 'pays du vendeur non établi : à traiter par la classification marché', W_FRESHNESS_STALE: 'relevé ancien',
  W_MATCH_WARNINGS: 'le matcher a émis des avertissements', W_OBSERVATION_ISSUES: 'anomalies de forme dans l\'observation'
};

const dim = (level, code, extra) => Object.assign({ level, code }, extra || {});
const rankOf = lv => DIM_RANK[lv];
const minLevel = (a, b) => (LEVELS.indexOf(a) <= LEVELS.indexOf(b) ? a : b);

/* ---------- dimensions ---------- */
function productDim(o) {
  switch (o.matchClass) {
    case 'EXACT_MATCH': return dim('HIGH', 'PRODUCT_EXACT_MATCH');
    case 'STRONG_MATCH': return dim('HIGH', 'PRODUCT_STRONG_MATCH');
    case 'POSSIBLE_MATCH': return dim('LOW', 'PRODUCT_AMBIGUOUS');
    case 'VARIANT_MATCH': return dim('LOW', 'PRODUCT_IS_VARIANT');
    case 'NO_MATCH': return dim('REJECTED', 'PRODUCT_REJECTED');
    default: return o.identityBasis === 'catalog' ? dim('MEDIUM', 'PRODUCT_ASSIGNED_BY_CATALOG') : dim('UNKNOWN', 'PRODUCT_NOT_MATCHED');
  }
}
function sellerDim(o) {
  const s = o.seller;
  if (!s.name && !s.id) return dim('UNKNOWN', 'SELLER_UNKNOWN');
  if (s.registered && s.verified) return dim('HIGH', 'SELLER_REGISTERED_VERIFIED');
  if (s.registered) return dim('MEDIUM', 'SELLER_REGISTERED');
  return dim('MEDIUM', 'SELLER_IDENTIFIED');
}
function marketDim(o) {
  const c = o.seller.country;
  if (!c) return dim('UNKNOWN', 'MARKET_COUNTRY_UNKNOWN');
  if (c.conflict) return dim('LOW', 'MARKET_COUNTRY_CONFLICT');
  if (!c.valid) return dim('LOW', 'MARKET_COUNTRY_INVALID');
  if (c.established) return dim('HIGH', 'MARKET_COUNTRY_ESTABLISHED');
  return dim('LOW', 'MARKET_COUNTRY_DEDUCED');
}
function priceDim(o) {
  const p = o.price;
  if (!p) return dim('UNKNOWN', 'PRICE_ABSENT');
  if (!p.valid) return dim('LOW', 'PRICE_INVALID');
  if (!p.displayed) return dim('LOW', 'PRICE_NOT_DISPLAYED');
  if (o.identity !== 'TARGET') return dim('LOW', 'PRICE_NOT_FOR_TARGET');
  return dim('HIGH', 'PRICE_DISPLAYED');
}
function stockDim(o) {
  switch (o.stock) {
    case 'IN_STOCK': return dim('HIGH', 'STOCK_IN_STOCK', { state: 'IN_STOCK' });
    case 'OUT_OF_STOCK': return dim('HIGH', 'STOCK_OUT_OF_STOCK', { state: 'OUT_OF_STOCK' });
    case 'COMING_SOON': return dim('HIGH', 'STOCK_COMING_SOON', { state: 'COMING_SOON' });
    default: return dim('UNKNOWN', 'STOCK_UNKNOWN', { state: 'UNKNOWN' });
  }
}
function urlDim(o) {
  if (!o.url) return dim('UNKNOWN', 'URL_ABSENT', { kind: null });
  const k = o.url.kind, table = { product_page: ['HIGH', 'URL_PRODUCT_PAGE'], seller: ['LOW', 'URL_SELLER_ROOT'], category: ['LOW', 'URL_CATEGORY'], search: ['LOW', 'URL_SEARCH'], unclassified: ['UNKNOWN', 'URL_KIND_UNKNOWN'] };
  return dim(table[k][0], table[k][1], { kind: k });
}
/* Hiérarchie des sources, justifiée par CE QU'ELLE PEUT ÉTABLIR (une vente, un prix, un stock, un vendeur) et par la possibilité de le revérifier :
   - la page du vendeur établit tout cela ; rouverte par DERMAI, elle est de première main (HIGH) ; non rouverte, on s'appuie sur un relevé (MEDIUM) ;
   - un relevé fourni par l'équipe est humain mais indirect (MEDIUM) ; une fiche de place de marché porte un vendeur tiers (MEDIUM si rouverte, sinon LOW) ;
   - la fiche fabricant établit le PRODUIT, jamais une vente (LOW pour une offre) ; moteur de recherche, extrait et source secondaire sont incomplets ou indirects (LOW). */
function sourceDim(o) {
  const s = o.source; if (!s || !s.kind) return dim('UNKNOWN', 'SOURCE_UNKNOWN', { kind: null });
  const k = s.kind;
  switch (k) {
    case 'seller_page': return s.reopened ? dim('HIGH', 'SOURCE_SELLER_PAGE_REOPENED', { kind: k }) : dim('MEDIUM', 'SOURCE_SELLER_PAGE_NOT_REOPENED', { kind: k });
    case 'team_provided': return dim('MEDIUM', 'SOURCE_TEAM_PROVIDED', { kind: k });
    case 'marketplace_listing': return s.reopened ? dim('MEDIUM', 'SOURCE_MARKETPLACE_REOPENED', { kind: k }) : dim('LOW', 'SOURCE_MARKETPLACE_NOT_REOPENED', { kind: k });
    case 'manufacturer_page': return dim('LOW', 'SOURCE_MANUFACTURER_ONLY', { kind: k });
    default: return dim('LOW', 'SOURCE_WEAK', { kind: k });
  }
}
function freshnessDim(o, opts) {
  const th = Object.assign({}, FRESHNESS_DAYS, opts && opts.freshness), age = O.ageDays(o.checkedAt, opts && opts.now);
  if (age == null) return dim('UNKNOWN', 'FRESHNESS_UNKNOWN', { ageDays: null });
  if (age < 0) return dim('LOW', 'FRESHNESS_FUTURE_DATE', { ageDays: age });
  if (age <= th.fresh) return dim('HIGH', 'FRESHNESS_FRESH', { ageDays: age });
  if (age <= th.recent) return dim('MEDIUM', 'FRESHNESS_RECENT', { ageDays: age });
  return dim('LOW', 'FRESHNESS_STALE', { ageDays: age });
}

/* Contradictions internes de l'observation : jamais « corrigées », elles abaissent le niveau. */
function contradictionsOf(o, d) {
  const out = [];
  if (d.freshness.code === 'FRESHNESS_FUTURE_DATE') out.push('CONTRADICTION_FUTURE_DATE');
  if (o.seller.country && o.seller.country.conflict) out.push('CONTRADICTION_SELLER_COUNTRY');
  const byCountry = new Map();
  for (const e of o.shipsTo) { const set = byCountry.get(e.country) || new Set(); set.add(e.state); byCountry.set(e.country, set); }
  if ([...byCountry.values()].some(s => s.has('YES') && s.has('NO'))) out.push('CONTRADICTION_DELIVERY');
  return out;
}

/* assess(observation, { now, freshness }) → résultat explicable. Ne lève jamais d'exception. `now` : date de référence (AAAA-MM-JJ) ; sans elle, la fraîcheur reste inconnue. */
function assess(raw, opts) {
  const { observation: o, issues } = O.normalizeObservation(raw);
  const d = { product: productDim(o), seller: sellerDim(o), market: marketDim(o), price: priceDim(o), stock: stockDim(o), url: urlDim(o), source: sourceDim(o), freshness: freshnessDim(o, opts) };
  const contradictions = contradictionsOf(o, d);
  const caps = [];                                                     // plafonds appliqués : { code, max }
  const cap = (code, max) => caps.push({ code, max });
  if (d.product.level !== 'REJECTED') {
    if (o.identity !== 'TARGET') cap('CAP_PRODUCT_NOT_TARGET', 'LOW');
    if (contradictions.length) cap('CAP_CONTRADICTION', 'LOW');
    if (rankOf(d.source.level) <= DIM_RANK.LOW) cap('CAP_SOURCE_WEAK', 'LOW');
    else if (d.source.level !== 'HIGH') cap('CAP_SOURCE_NOT_FIRST_HAND', 'MEDIUM');
    if (d.seller.level === 'UNKNOWN') cap('CAP_SELLER_UNKNOWN', 'MEDIUM');
    if (d.freshness.level !== 'HIGH') cap('CAP_FRESHNESS', 'MEDIUM');
    if (d.price.level !== 'HIGH' || d.stock.level === 'UNKNOWN' || d.url.level !== 'HIGH') cap('CAP_INCOMPLETE', 'MEDIUM');
  }
  let level = d.product.level === 'UNKNOWN' ? 'LOW' : d.product.level;
  for (const c of caps) level = minLevel(level, c.max);
  const reasonCodes = [d.product.code].concat(caps.map(c => c.code), contradictions, level === 'HIGH' ? ['ALL_REQUIREMENTS_MET'] : []);
  const warn = [];
  if (o.stock === 'OUT_OF_STOCK') warn.push('W_STOCK_OUT_OF_STOCK');
  if (o.stock === 'COMING_SOON') warn.push('W_STOCK_COMING_SOON');
  if (!o.price) warn.push('W_PRICE_ABSENT');
  if (o.url && o.url.kind !== 'product_page') warn.push('W_URL_NOT_PRODUCT_PAGE');
  if (d.seller.code === 'SELLER_IDENTIFIED') warn.push('W_SELLER_UNREGISTERED');
  if (d.market.level !== 'HIGH') warn.push('W_MARKET_UNKNOWN');
  if (d.freshness.code === 'FRESHNESS_STALE') warn.push('W_FRESHNESS_STALE');
  if (o.matchWarningCodes.length) warn.push('W_MATCH_WARNINGS');
  if (issues.length) warn.push('W_OBSERVATION_ISSUES');
  const dimensions = Object.fromEntries(DIMENSIONS.map(k => [k, d[k]]));
  /* AUXILIAIRE : moyenne des rangs de dimensions (0 à 1). Calculée après le niveau ; ne sert qu'à trier et à observer. */
  const score = level === 'REJECTED' ? 0 : Math.round(DIMENSIONS.reduce((s, k) => s + (DIM_RANK[d[k].level] || 0), 0) / (DIMENSIONS.length * 3) * 1000) / 1000;
  return {
    schema: SCHEMA, observationId: o.id, productId: o.productId, matchClass: o.matchClass,
    level, identity: o.identity, targetProduct: o.identity === 'TARGET', dimensions,
    caps: caps.map(c => c.code), contradictions: contradictions.slice(),
    reasonCodes, reasons: reasonCodes.map(c => REASONS[c] || c),
    warningCodes: warn, warnings: warn.map(c => REASONS[c] || c), issues, score
  };
}

module.exports = { SCHEMA, LEVELS, DIM_RANK, DIMENSIONS, FRESHNESS_DAYS, REASONS, assess };
