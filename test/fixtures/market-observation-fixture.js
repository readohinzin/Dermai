'use strict';
/* JEU DE DONNÉES EXPLICITE pour confidence.js et classify.js (phase 3B-4).
   Aucune donnée de production : les vendeurs, adresses et prix ci-dessous sont des valeurs d'ESSAI (« Vendeur Alpha »...), jamais livrées. Le catalogue n'est pas lu ici.
   Le résultat du matcher est simulé par `matched(classe)` : on teste ce que confidence/classify FONT d'une classe donnée, pas le matcher (déjà testé). */

const NOW = '2026-10-08';
const DAYS = { fresh: '2026-10-01', recent: '2026-08-20', stale: '2026-01-15', future: '2026-12-31' };     // 7, 49, 266 jours avant NOW ; une date postérieure
const clone = o => JSON.parse(JSON.stringify(o));

const matched = cls => ({ matchClass: cls, productId: 'p-essai', signals: {}, warningCodes: [] });
const country = (value, basis, source) => ({ value, basis: basis === undefined ? 'seller_page' : basis, source: source === undefined ? 'page « Contact » du vendeur d\'essai' : source });
const SOURCE_FIRST_HAND = { kind: 'seller_page', label: 'fiche du vendeur d\'essai', reopened: true };

/* Observation de référence : complète, première main, fraîche, produit exact, vendeur d'essai au Bénin. Aucun test ne dépend de ses VALEURS, seulement de ce que chaque modification change. */
const BASE = Object.freeze({
  id: 'obs-base', match: matched('EXACT_MATCH'),
  seller: { name: 'Vendeur Alpha', type: 'retailer', registered: false, verified: false, country: country('BJ') },
  price: { amount: 10000, currency: 'XOF' }, stock: 'in_stock',
  url: { href: 'https://alpha.invalid/products/serum-essai', kind: 'product_page' },
  source: SOURCE_FIRST_HAND, method: 'page du vendeur ouverte', checkedAt: DAYS.fresh, city: null, shipsTo: []
});

/* make(patch) : copie de BASE dont les clés du patch REMPLACENT celles de BASE ; `undefined` supprime la clé. */
function make(patch) {
  const o = clone(BASE);
  for (const [k, v] of Object.entries(patch || {})) { if (v === undefined) delete o[k]; else o[k] = clone(v); }
  return o;
}
const sellerOf = (patch, base) => Object.assign({}, clone(BASE.seller), base || {}, patch || {});
const withSeller = (patch) => make({ seller: sellerOf(patch) });
const withCountry = (value, basis, source) => withSeller({ country: value === null ? undefined : country(value, basis, source) });
const delivery = (c, explicit, source, checkedAt) => ({ country: c, explicit, source: source === undefined ? 'page « Livraison » du vendeur d\'essai' : source, checkedAt: checkedAt === undefined ? DAYS.fresh : checkedAt });
const foreign = (c, extra) => make(Object.assign({ seller: sellerOf({ country: country(c) }) }, extra || {}));

/* ---------- CONFIANCE : 24 cas minimum, chacun avec le niveau global et les dimensions attendus ---------- */
const CONFIDENCE_CASES = [
  { id: 'C01', title: 'EXACT + fiche complète', obs: make({}), level: 'HIGH', dims: { product: 'HIGH', seller: 'MEDIUM', market: 'HIGH', price: 'HIGH', stock: 'HIGH', url: 'HIGH', source: 'HIGH', freshness: 'HIGH' } },
  { id: 'C02', title: 'EXACT + URL absente', obs: make({ url: undefined }), level: 'MEDIUM', dims: { url: 'UNKNOWN', product: 'HIGH' }, caps: ['CAP_INCOMPLETE'] },
  { id: 'C03', title: 'STRONG + fiche complète : peut atteindre HIGH', obs: make({ match: matched('STRONG_MATCH') }), level: 'HIGH', dims: { product: 'HIGH' }, codes: ['PRODUCT_STRONG_MATCH', 'ALL_REQUIREMENTS_MET'], target: true, identity: 'TARGET' },
  { id: 'C04', title: 'POSSIBLE + fiche complète', obs: make({ match: matched('POSSIBLE_MATCH') }), level: 'LOW', dims: { product: 'LOW' }, target: false, identity: 'AMBIGUOUS' },
  { id: 'C05', title: 'POSSIBLE + vendeur excellent, prix clair, stock clair', obs: make({ match: matched('POSSIBLE_MATCH'), seller: sellerOf({ registered: true, verified: true }) }), level: 'LOW', dims: { seller: 'HIGH', price: 'LOW', stock: 'HIGH', product: 'LOW' }, target: false },
  { id: 'C06', title: 'VARIANT (autre format ou autre formulation)', obs: make({ match: matched('VARIANT_MATCH') }), level: 'LOW', dims: { product: 'LOW', price: 'LOW' }, target: false, identity: 'VARIANT', codes: ['PRODUCT_IS_VARIANT'] },
  { id: 'C07', title: 'NO_MATCH', obs: make({ match: matched('NO_MATCH') }), level: 'REJECTED', dims: { product: 'REJECTED' }, target: false, identity: 'OTHER' },
  { id: 'C08', title: 'vendeur connu (enregistré et vérifié)', obs: withSeller({ registered: true, verified: true }), level: 'HIGH', dims: { seller: 'HIGH' } },
  { id: 'C09', title: 'vendeur inconnu : pas mauvais, mais pas au niveau d\'un vendeur validé', obs: make({ seller: { country: country('BJ') } }), level: 'MEDIUM', dims: { seller: 'UNKNOWN' }, caps: ['CAP_SELLER_UNKNOWN'] },
  { id: 'C10', title: 'pays du vendeur connu', obs: make({}), level: 'HIGH', dims: { market: 'HIGH' } },
  { id: 'C11', title: 'pays du vendeur inconnu : le produit reste HIGH, le marché est UNKNOWN', obs: withCountry(null), level: 'HIGH', dims: { product: 'HIGH', market: 'UNKNOWN' }, warnings: ['W_MARKET_UNKNOWN'] },
  { id: 'C12', title: 'prix présent', obs: make({}), level: 'HIGH', dims: { price: 'HIGH' } },
  { id: 'C13', title: 'prix absent : n\'invalide pas l\'offre', obs: make({ price: undefined }), level: 'MEDIUM', dims: { price: 'UNKNOWN' }, caps: ['CAP_INCOMPLETE'], warnings: ['W_PRICE_ABSENT'] },
  { id: 'C14', title: 'devise absente : prix incomplet', obs: make({ price: { amount: 10000 } }), level: 'MEDIUM', dims: { price: 'LOW' } },
  { id: 'C15', title: 'stock IN_STOCK : preuve positive', obs: make({ stock: 'in_stock' }), level: 'HIGH', dims: { stock: 'HIGH' }, stockState: 'IN_STOCK' },
  { id: 'C16', title: 'stock OUT_OF_STOCK : preuve négative, information fiable', obs: make({ stock: 'out_of_stock' }), level: 'HIGH', dims: { stock: 'HIGH' }, stockState: 'OUT_OF_STOCK', warnings: ['W_STOCK_OUT_OF_STOCK'] },
  { id: 'C17', title: 'stock UNKNOWN : jamais déduit', obs: make({ stock: undefined }), level: 'MEDIUM', dims: { stock: 'UNKNOWN' }, stockState: 'UNKNOWN' },
  { id: 'C18', title: 'URL de fiche produit', obs: make({}), level: 'HIGH', dims: { url: 'HIGH' } },
  { id: 'C19', title: 'URL de recherche : n\'est pas une fiche produit', obs: make({ url: { href: 'https://alpha.invalid/search?q=acide+hyaluronique', kind: 'product_page' } }), level: 'MEDIUM', dims: { url: 'LOW' }, caps: ['CAP_INCOMPLETE'], warnings: ['W_URL_NOT_PRODUCT_PAGE'] },
  { id: 'C20', title: 'source forte : page du vendeur rouverte', obs: make({}), level: 'HIGH', dims: { source: 'HIGH' } },
  { id: 'C21', title: 'source faible : extrait de moteur de recherche', obs: make({ source: { kind: 'snippet', label: 'extrait' } }), level: 'LOW', dims: { source: 'LOW' }, caps: ['CAP_SOURCE_WEAK'] },
  { id: 'C22', title: 'observation fraîche', obs: make({}), level: 'HIGH', dims: { freshness: 'HIGH' } },
  { id: 'C23', title: 'observation ancienne : vraie historiquement, pas présentée comme fraîche, jamais supprimée', obs: make({ checkedAt: DAYS.stale }), level: 'MEDIUM', dims: { freshness: 'LOW' }, caps: ['CAP_FRESHNESS'], warnings: ['W_FRESHNESS_STALE'] },
  { id: 'C24', title: 'combinaison contradictoire : livraison confirmée ET refusée pour le même pays', obs: foreign('TG', { shipsTo: [delivery('BJ', true), delivery('BJ', false)] }), level: 'LOW', caps: ['CAP_CONTRADICTION'], contradictions: ['CONTRADICTION_DELIVERY'] },
  { id: 'C25', title: 'relevé fourni par l\'équipe (page non rouverte)', obs: make({ source: { kind: 'team_provided', label: 'relevé de l\'équipe' } }), level: 'MEDIUM', dims: { source: 'MEDIUM' }, caps: ['CAP_SOURCE_NOT_FIRST_HAND'] },
  { id: 'C26', title: 'fiche fabricant : établit le produit, pas une vente', obs: make({ source: { kind: 'manufacturer_page' } }), level: 'LOW', dims: { source: 'LOW' }, caps: ['CAP_SOURCE_WEAK'] },
  { id: 'C27', title: 'date du relevé dans le futur', obs: make({ checkedAt: DAYS.future }), level: 'LOW', dims: { freshness: 'LOW' }, contradictions: ['CONTRADICTION_FUTURE_DATE'] },
  { id: 'C28', title: 'deux pays de vendeur contradictoires', obs: withSeller({ country: [country('BJ'), country('TG')] }), level: 'LOW', dims: { market: 'LOW' }, contradictions: ['CONTRADICTION_SELLER_COUNTRY'] },
  { id: 'C29', title: 'pays seulement déduit de la devise : ne compte pas comme établi', obs: withCountry('BJ', 'currency'), level: 'HIGH', dims: { market: 'LOW' }, warnings: ['W_MARKET_UNKNOWN'] },
  { id: 'C30', title: 'observation récente (31 à 90 jours)', obs: make({ checkedAt: DAYS.recent }), level: 'MEDIUM', dims: { freshness: 'MEDIUM' }, caps: ['CAP_FRESHNESS'] },
  { id: 'C31', title: 'source absente', obs: make({ source: undefined }), level: 'LOW', dims: { source: 'UNKNOWN' }, caps: ['CAP_SOURCE_WEAK'] },
  { id: 'C32', title: 'aucun résultat de matching', obs: make({ match: undefined }), level: 'LOW', dims: { product: 'UNKNOWN' }, target: false, identity: null }
];

/* ---------- CLASSIFICATION : cas de la brief (A à L) ---------- */
const SEARCH_NONE = { market: 'BJ', status: 'searched_none', checkedAt: '2026-10-02', method: 'recherche manuelle sur trois sites d\'essai', note: null };
const SEARCH_FOUND = { market: 'BJ', status: 'searched_found', checkedAt: '2026-10-02', method: 'recherche manuelle sur trois sites d\'essai' };
const CLASSIFICATION_CASES = [
  { id: 'A', title: 'BJ + vendeur BJ + in_stock', obs: make({}), target: 'BJ', status: 'LOCAL', codes: ['LOCAL_SELLER_IN_TARGET_CONFIRMED'] },
  { id: 'B', title: 'BJ + vendeur TG + livraison BJ explicite', obs: foreign('TG', { shipsTo: [delivery('BJ', true)] }), target: 'BJ', status: 'REGIONAL', codes: ['REGIONAL_SHIPS_TO_TARGET_CONFIRMED'] },
  { id: 'C', title: 'BJ + vendeur CI + livraison BJ explicite', obs: foreign('CI', { shipsTo: [delivery('BJ', true)] }), target: 'BJ', status: 'REGIONAL', codes: ['REGIONAL_SHIPS_TO_TARGET_CONFIRMED'] },
  { id: 'D', title: 'BJ + vendeur FR + livraison BJ explicite', obs: foreign('FR', { shipsTo: [delivery('BJ', true)] }), target: 'BJ', status: 'IMPORT', codes: ['IMPORT_SHIPS_TO_TARGET_CONFIRMED'] },
  { id: 'E', title: 'BJ + vendeur FR + « livraison internationale » non spécifique', obs: foreign('FR', { shippingMention: 'international' }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_TO_TARGET_UNKNOWN'], warnings: ['W_INTERNATIONAL_SHIPPING_NOT_SPECIFIC'] },
  { id: 'F', title: 'BJ + vendeur inconnu', obs: make({ seller: { country: country('BJ') } }), target: 'BJ', status: 'UNKNOWN', codes: ['SELLER_UNKNOWN'] },
  { id: 'G', title: 'BJ + pays du vendeur inconnu', obs: withCountry(null), target: 'BJ', status: 'UNKNOWN', codes: ['MARKET_COUNTRY_UNKNOWN'] },
  { id: 'H1', title: 'BJ + vendeur « BJ » mais la base est une devise : preuve insuffisante', obs: withCountry('BJ', 'currency'), target: 'BJ', status: 'UNKNOWN', codes: ['MARKET_COUNTRY_NOT_ESTABLISHED'] },
  { id: 'H2', title: 'BJ + vendeur BJ, base explicite mais sans source : preuve insuffisante', obs: withCountry('BJ', 'seller_page', null), target: 'BJ', status: 'UNKNOWN', codes: ['MARKET_COUNTRY_NOT_ESTABLISHED'] },
  { id: 'H3', title: 'BJ + pays indiqué sans aucune base', obs: withSeller({ country: 'BJ' }), target: 'BJ', status: 'UNKNOWN', codes: ['MARKET_COUNTRY_NOT_ESTABLISHED'] },
  { id: 'I', title: 'recherche insuffisante : enregistrement invalide (méthode manquante)', obs: foreign('FR'), target: 'BJ', checks: [{ market: 'BJ', status: 'searched_none', checkedAt: '2026-10-02' }], status: 'UNKNOWN', codes: ['INSUFFICIENT_SEARCH_COVERAGE'] },
  { id: 'J1', title: 'recherche explicite valide sans offre : UNAVAILABLE', obs: null, target: 'BJ', checks: [SEARCH_NONE], status: 'UNAVAILABLE', codes: ['UNAVAILABLE_SEARCHED_NONE'] },
  { id: 'J2', title: 'recherche explicite + une offre non qualifiante (vendeur FR sans livraison) : UNAVAILABLE', obs: foreign('FR'), target: 'BJ', checks: [SEARCH_NONE], status: 'UNAVAILABLE', codes: ['UNAVAILABLE_SEARCHED_NONE'] },
  { id: 'J3', title: 'aucune recherche enregistrée : jamais UNAVAILABLE', obs: null, target: 'BJ', status: 'UNKNOWN', codes: ['NO_SEARCH_RECORDED'] },
  { id: 'J4', title: 'recherche pour un AUTRE pays : ne dit rien du pays cible', obs: null, target: 'BJ', checks: [Object.assign({}, SEARCH_NONE, { market: 'TG' })], status: 'UNKNOWN', codes: ['NO_SEARCH_RECORDED'] },
  { id: 'J5', title: 'recherche « aucune offre » contredite par une offre établie au Bénin', obs: make({ stock: 'out_of_stock' }), target: 'BJ', checks: [SEARCH_NONE], status: 'UNKNOWN', codes: ['MARKET_CHECK_CONTRADICTS_OFFER'] },
  { id: 'J6', title: 'recherche « aucune offre » mais une offre locale seulement POSSIBLE existe : pas d\'indisponibilité déclarée', obs: make({ match: matched('POSSIBLE_MATCH') }), target: 'BJ', checks: [SEARCH_NONE], status: 'UNKNOWN', codes: ['UNCONFIRMED_LOCAL_CANDIDATE_EXISTS'] },
  { id: 'J7', title: 'recherche « offre trouvée » sans offre qualifiante', obs: foreign('FR'), target: 'BJ', checks: [SEARCH_FOUND], status: 'UNKNOWN', codes: ['SEARCH_FOUND_NOT_QUALIFIED'] },
  { id: 'K1', title: 'rupture de stock explicite : pas LOCAL, pas UNAVAILABLE, offre historique', obs: make({ stock: 'out_of_stock' }), target: 'BJ', status: 'UNKNOWN', codes: ['OUT_OF_STOCK'], historical: true },
  { id: 'K2', title: 'bientôt disponible : pas LOCAL', obs: make({ stock: 'coming_soon' }), target: 'BJ', status: 'UNKNOWN', codes: ['COMING_SOON'] },
  { id: 'K3', title: 'vendeur TG avec livraison BJ confirmée mais en rupture : pas REGIONAL', obs: foreign('TG', { stock: 'out_of_stock', shipsTo: [delivery('BJ', true)] }), target: 'BJ', status: 'UNKNOWN', codes: ['OUT_OF_STOCK'] },
  { id: 'L', title: 'prix absent : ne change pas le statut marché', obs: make({ price: undefined }), target: 'BJ', status: 'LOCAL', codes: ['LOCAL_SELLER_IN_TARGET_CONFIRMED'] },
  { id: 'M', title: 'stock absent : LOCAL avec avertissement, jamais déduit', obs: make({ stock: undefined }), target: 'BJ', status: 'LOCAL', warnings: ['W_STOCK_UNKNOWN'] },
  { id: 'N1', title: 'livraison BJ « inconnue » : ne suffit pas', obs: foreign('TG', { shipsTo: [delivery('BJ', null)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_TO_TARGET_UNKNOWN'] },
  { id: 'N2', title: 'le vendeur indique NE PAS livrer le Bénin', obs: foreign('TG', { shipsTo: [delivery('BJ', false)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_TO_TARGET_EXCLUDED'] },
  { id: 'N3', title: 'livraison confirmée pour un AUTRE pays seulement', obs: foreign('TG', { shipsTo: [delivery('NG', true)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_TO_TARGET_UNKNOWN'] },
  { id: 'N4', title: 'livraison BJ affirmée sans source', obs: foreign('TG', { shipsTo: [delivery('BJ', true, null)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_EVIDENCE_NO_SOURCE'] },
  { id: 'N5', title: 'livraison locale seulement', obs: foreign('TG', { shippingMention: 'local', shipsTo: [delivery('BJ', true)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_LOCAL_ONLY'] },
  { id: 'N6', title: 'livraison confirmée et refusée', obs: foreign('TG', { shipsTo: [delivery('BJ', true), delivery('BJ', false)] }), target: 'BJ', status: 'UNKNOWN', codes: ['DELIVERY_EVIDENCE_CONFLICT'] },
  { id: 'N7', title: 'livraison BJ sans date de preuve : REGIONAL avec avertissement', obs: foreign('TG', { shipsTo: [delivery('BJ', true, undefined, null)] }), target: 'BJ', status: 'REGIONAL', warnings: ['W_DELIVERY_CHECKED_AT_MISSING'] },
  { id: 'O1', title: 'pays cible invalide', obs: make({}), target: 'ZZ', status: 'UNKNOWN', codes: ['TARGET_COUNTRY_INVALID'] },
  { id: 'O2', title: 'même vendeur, autre pays cible (TG) : le vendeur béninois n\'est pas local au Togo, sans livraison établie', obs: make({}), target: 'TG', status: 'UNKNOWN', codes: ['DELIVERY_TO_TARGET_UNKNOWN'] },
  { id: 'O3', title: 'même vendeur béninois, livraison TG établie : REGIONAL', obs: make({ shipsTo: [delivery('TG', true)] }), target: 'TG', status: 'REGIONAL' },
  { id: 'O4', title: 'pays cible en minuscules : accepté', obs: make({}), target: 'bj', status: 'LOCAL' }
];

/* ---------- Pièges : ce que la classification NE DOIT PAS conclure ---------- */
const TRAPS = [
  { id: 'T1', title: 'XOF n\'est pas le Bénin (aucun pays de vendeur, devise XOF)', obs: make({ seller: { name: 'Vendeur Alpha' }, price: { amount: 10000, currency: 'XOF' } }), status: 'UNKNOWN' },
  { id: 'T2', title: 'domaine .bj n\'établit pas le vendeur local', obs: withCountry('BJ', 'domain', 'adresse du site en .bj'), status: 'UNKNOWN' },
  { id: 'T3', title: 'le français n\'est pas le Bénin', obs: withCountry('BJ', 'language', 'site rédigé en français'), status: 'UNKNOWN' },
  { id: 'T4', title: 'un numéro de téléphone ne suffit pas', obs: withCountry('BJ', 'phone', 'numéro +229'), status: 'UNKNOWN' },
  { id: 'T5', title: '« livraison internationale » n\'est pas une livraison au Bénin', obs: foreign('FR', { shippingMention: 'international', shipsTo: [] }), status: 'UNKNOWN' },
  { id: 'T6', title: 'vendeur connu et enregistré ne prouve pas la disponibilité', obs: withSeller({ registered: true, verified: true, country: undefined }), status: 'UNKNOWN' },
  { id: 'T7', title: 'EXACT_MATCH seul n\'est pas LOCAL', obs: { id: 't7', match: matched('EXACT_MATCH') }, status: 'UNKNOWN' },
  { id: 'T8', title: 'in_stock seul n\'est pas LOCAL', obs: { id: 't8', match: matched('EXACT_MATCH'), stock: 'in_stock', seller: { name: 'Vendeur Alpha' } }, status: 'UNKNOWN' },
  { id: 'T9', title: 'un prix seul n\'est pas une disponibilité', obs: { id: 't9', match: matched('EXACT_MATCH'), price: { amount: 10000, currency: 'XOF' }, seller: { name: 'Vendeur Alpha' } }, status: 'UNKNOWN' },
  { id: 'T10', title: 'ville béninoise sans pays établi', obs: make({ city: 'Cotonou', seller: { name: 'Vendeur Alpha' } }), status: 'UNKNOWN' }
];

module.exports = { NOW, DAYS, BASE, matched, country, delivery, make, sellerOf, withSeller, withCountry, foreign, SEARCH_NONE, SEARCH_FOUND, CONFIDENCE_CASES, CLASSIFICATION_CASES, TRAPS, clone };
