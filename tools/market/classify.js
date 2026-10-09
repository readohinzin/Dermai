'use strict';
/* CLASSIFICATION MARCHÉ : « dans quel marché cette offre est-elle réellement disponible, pour un PAYS CIBLE ? »
   LOCAL, REGIONAL, IMPORT, UNAVAILABLE ou UNKNOWN. Pur, déterministe, explicable, sans réseau, sans horloge, sans mutation de l'entrée.
   Il ne répond PAS à « est-ce le bon produit ? » (match.js) ni à « la fiche est-elle fiable ? » (confidence.js) : il ne lit ni le niveau de confiance, ni le prix, ni la devise.

   HIÉRARCHIE AVEC availabilityStatus() (js/engine/products.js) : UNE source de vérité par étage, jamais deux définitions concurrentes.
     - availabilityStatus() est la fonction de RÉFÉRENCE du statut d'un produit DU CATALOGUE : elle lit les offres et les marketChecks enregistrés. Elle n'est pas appelée par l'application : l'affichage actuel passe par marketView et commerceOf (js/app.js), que cette phase ne modifie pas. Ce module ne la remplace, ne l'appelle et ne la modifie pas.
     - classify.js est la BARRIÈRE D'ADMISSION d'une observation CANDIDATE (pas encore au catalogue) : il dit quel statut une observation peut revendiquer avec des preuves explicites. Il lit les marketChecks par la MÊME validation (validateMarketCheck).
     - Contrat : classify n'est JAMAIS PLUS PERMISSIF. S'il donne un statut fort, availabilityStatus donne le même sur la forme catalogue de l'observation ; il peut être plus prudent (UNKNOWN) dans les seuls cas nommés par DIVERGENCES.
       Quand ils divergent, le catalogue (availabilityStatus) fait référence tant qu'il n'a pas changé ; une future phase d'application devra écrire des offres dont availabilityStatus redonne le statut de classify.
     - reconcile(statutCatalogue, résultat) classe tout couple de résultats : AGREE, MORE_CAUTIOUS (avec le nom de la divergence) ou VIOLATION (jamais attendue : un test l'interdit). 

   PRINCIPE : UNKNOWN est le statut par défaut. Un statut plus fort exige une PREUVE explicite, jamais un indice.
     LOCAL        vendeur dont le pays est ÉTABLI = pays cible (base explicite + source), identité du produit confirmée, offre non en rupture.
     REGIONAL     vendeur d'un autre pays africain du référentiel + livraison vers le pays cible EXPLICITEMENT établie (shipsTo).
     IMPORT       vendeur hors de ces pays + livraison vers le pays cible EXPLICITEMENT établie.
     UNAVAILABLE  seulement par une recherche explicite (marketChecks.searched_none, règle de products.js) sans offre qualifiante : jamais par une absence, un site muet, un stock inconnu.
     UNKNOWN      tout le reste.
   Jamais déduits : la devise (XOF), le domaine (.bj), la langue, un numéro de téléphone, « livraison internationale » sans pays nommé, le stock. */
const O = require('./observation.js');

const SCHEMA = 'classification/1';
const STATUSES = ['LOCAL', 'REGIONAL', 'IMPORT', 'UNAVAILABLE', 'UNKNOWN'];
const RANK = { LOCAL: 0, REGIONAL: 1, IMPORT: 2 };                          // priorité entre offres qualifiantes (comme availabilityStatus)

const REASONS = {
  LOCAL_SELLER_IN_TARGET_CONFIRMED: 'vendeur situé dans le pays cible, pays établi par une base explicite et une source',
  REGIONAL_SHIPS_TO_TARGET_CONFIRMED: 'vendeur d\'un autre pays africain, livraison vers le pays cible explicitement confirmée',
  IMPORT_SHIPS_TO_TARGET_CONFIRMED: 'vendeur hors d\'Afrique du référentiel, livraison vers le pays cible explicitement confirmée',
  UNAVAILABLE_SEARCHED_NONE: 'recherche explicite sans offre fiable dans ce pays (marketChecks.searched_none)',
  TARGET_COUNTRY_INVALID: 'pays cible absent ou inconnu', IDENTITY_NOT_CONFIRMED: 'le produit visé n\'est pas confirmé (EXACT ou STRONG requis) : aucun statut marché pour ce produit',
  SELLER_UNKNOWN: 'vendeur inconnu', MARKET_COUNTRY_UNKNOWN: 'pays du vendeur inconnu', MARKET_COUNTRY_NOT_ESTABLISHED: 'pays du vendeur seulement déduit d\'un indice (devise, domaine, langue...) : non établi',
  MARKET_COUNTRY_CONFLICT: 'pays du vendeur contradictoire', MARKET_COUNTRY_INVALID: 'pays du vendeur invalide',
  OUT_OF_STOCK: 'rupture explicite : pas une disponibilité actuelle (l\'offre reste une preuve historique)', COMING_SOON: 'produit pas encore disponible',
  DELIVERY_TO_TARGET_UNKNOWN: 'livraison vers le pays cible non établie', DELIVERY_TO_TARGET_EXCLUDED: 'le vendeur indique ne pas livrer le pays cible', DELIVERY_EVIDENCE_CONFLICT: 'livraison vers le pays cible à la fois confirmée et refusée',
  DELIVERY_EVIDENCE_NO_SOURCE: 'livraison vers le pays cible affirmée sans source', DELIVERY_LOCAL_ONLY: 'le vendeur indique une livraison locale seulement',
  NO_SEARCH_RECORDED: 'aucune recherche de disponibilité enregistrée pour ce pays', INSUFFICIENT_SEARCH_COVERAGE: 'recherche de disponibilité enregistrée mais invalide ou incomplète',
  SEARCH_EVIDENCE_CONFLICT: 'recherches contradictoires pour ce pays (une offre trouvée, une absence déclarée)',
  SEARCH_FOUND_NOT_QUALIFIED: 'une recherche a trouvé une offre, mais aucune offre qualifiante n\'est établie ici',
  MARKET_CHECK_CONTRADICTS_OFFER: 'recherche « aucune offre » contredite par une offre établie dans le pays cible',
  UNSPECIFIED_INTERNATIONAL_OFFER_EXISTS: 'un vendeur annonce une livraison internationale sans nommer le pays cible : aucune indisponibilité ne peut être déclarée',
  DELIVERY_CLAIM_EXISTS_NOT_QUALIFIED: 'une livraison vers le pays cible est affirmée mais non qualifiée : aucune indisponibilité ne peut être déclarée',
  UNRESOLVED_IDENTITY_OBSERVATION_EXISTS: 'une observation dont l\'identité n\'est pas résolue (matching absent ou inexploitable) existe : la recherche ne prouve pas l\'indisponibilité du produit exact',
  UNCONFIRMED_LOCAL_CANDIDATE_EXISTS: 'une offre locale probable existe mais n\'est pas confirmée : aucune indisponibilité ne peut être déclarée',
  W_STOCK_UNKNOWN: 'stock inconnu (jamais déduit) : le statut ne dit rien de la disponibilité immédiate', W_INTERNATIONAL_SHIPPING_NOT_SPECIFIC: '« livraison internationale » sans pays nommé : ne prouve pas la livraison vers le pays cible',
  W_DELIVERY_CHECKED_AT_MISSING: 'date de la preuve de livraison absente', W_HISTORICAL_OFFER: 'offre historique : vendeur et pays connus, mais pas de disponibilité actuelle', W_OBSERVATION_ISSUES: 'anomalies de forme dans l\'observation',
  W_COUNTRY_HINTS_IGNORED: 'des indices de pays (devise, domaine...) ont été ignorés'
};

/* Le pays du vendeur appartient-il à la zone « régionale » du pays cible ? Par défaut : les deux sont des pays africains du référentiel DERMAI (O.MARKETS).
   Ce n'est PAS une zone économique : une règle simple, déclarée, remplaçable (opts.isRegional(vendeur, cible)). */
const defaultIsRegional = (seller, target) => seller !== target && Object.prototype.hasOwnProperty.call(O.MARKETS, seller) && Object.prototype.hasOwnProperty.call(O.MARKETS, target);

/* Seules les anomalies de forme qui touchent la classification comptent (prix, lien, source, date n'y entrent jamais). */
const RELEVANT_ISSUE = /^(observation_|match_|seller_country|shipsto_|stock_)/;

const result = (status, codes, evidence, warnings, extra) => Object.assign({ status, reasonCodes: codes, reasons: codes.map(c => REASONS[c] || c), evidence, warningCodes: warnings, warnings: warnings.map(c => REASONS[c] || c) }, extra || {});

/* Statut d'UNE observation (LOCAL, REGIONAL, IMPORT ou UNKNOWN). UNAVAILABLE ne vient jamais d'une seule offre : voir classifyMarket. */
function classifyOne(o, issues, target, opts) {
  const ev = [], warn = [];
  if (issues.some(i => RELEVANT_ISSUE.test(i))) warn.push('W_OBSERVATION_ISSUES');
  const unknown = (code, extra) => result('UNKNOWN', [code], ev, warn, Object.assign({ historicalOffer: false }, extra || {}));
  if (!target || !Object.prototype.hasOwnProperty.call(O.MARKETS, target)) return unknown('TARGET_COUNTRY_INVALID');
  ev.push({ type: 'identity', identity: o.identity, matchClass: o.matchClass, basis: o.identityBasis });
  if (o.identity !== 'TARGET') return unknown('IDENTITY_NOT_CONFIRMED');
  if (!o.seller.name && !o.seller.id) return unknown('SELLER_UNKNOWN');
  ev.push({ type: 'seller', id: o.seller.id, name: o.seller.name });
  const c = o.seller.country;
  if (!c) return unknown('MARKET_COUNTRY_UNKNOWN');
  if (c.conflict) return unknown('MARKET_COUNTRY_CONFLICT');
  if (!c.valid) return unknown('MARKET_COUNTRY_INVALID');
  if (!c.established) { warn.push('W_COUNTRY_HINTS_IGNORED'); ev.push({ type: 'seller_country', value: c.value, basis: c.basis, source: c.source, established: false }); return unknown('MARKET_COUNTRY_NOT_ESTABLISHED'); }
  ev.push({ type: 'seller_country', value: c.value, basis: c.basis, source: c.source, established: true });
  ev.push({ type: 'stock', state: o.stock });
  // Rupture : l'offre prouve qu'un vendeur propose ce produit (historique), pas qu'il est disponible maintenant. Jamais transformée en UNAVAILABLE.
  if (o.stock === 'OUT_OF_STOCK' || o.stock === 'COMING_SOON') { warn.push('W_HISTORICAL_OFFER'); return unknown(o.stock === 'OUT_OF_STOCK' ? 'OUT_OF_STOCK' : 'COMING_SOON', { historicalOffer: o.stock === 'OUT_OF_STOCK' }); }
  if (o.stock === 'UNKNOWN') warn.push('W_STOCK_UNKNOWN');
  if (c.value === target) return result('LOCAL', ['LOCAL_SELLER_IN_TARGET_CONFIRMED'], ev, warn, { historicalOffer: false });
  // Vendeur hors du pays cible : il faut une livraison EXPLICITE vers ce pays.
  if (o.shippingMention === 'local') return unknown('DELIVERY_LOCAL_ONLY');
  const entries = o.shipsTo.filter(e => e.country === target), yes = entries.filter(e => e.state === 'YES'), no = entries.filter(e => e.state === 'NO');
  for (const e of entries) ev.push({ type: 'delivery', country: e.country, state: e.state, source: e.source, checkedAt: e.checkedAt });
  if (yes.length && no.length) return unknown('DELIVERY_EVIDENCE_CONFLICT');
  if (no.length) return unknown('DELIVERY_TO_TARGET_EXCLUDED');
  if (!yes.length) { if (o.shippingMention === 'international') warn.push('W_INTERNATIONAL_SHIPPING_NOT_SPECIFIC'); return unknown('DELIVERY_TO_TARGET_UNKNOWN'); }
  if (!yes.some(e => e.source)) return unknown('DELIVERY_EVIDENCE_NO_SOURCE');
  if (!yes.some(e => e.checkedAt)) warn.push('W_DELIVERY_CHECKED_AT_MISSING');
  const regional = (opts && typeof opts.isRegional === 'function' ? opts.isRegional : defaultIsRegional)(c.value, target) === true;
  return result(regional ? 'REGIONAL' : 'IMPORT', [regional ? 'REGIONAL_SHIPS_TO_TARGET_CONFIRMED' : 'IMPORT_SHIPS_TO_TARGET_CONFIRMED'], ev, warn, { historicalOffer: false });
}

/* classifyMarket({ targetCountry, observations, marketChecks }, opts) → statut du PRODUIT pour le pays cible, avec le détail par observation.
   Priorité : LOCAL, REGIONAL, IMPORT (la meilleure offre qualifiante) ; sinon UNAVAILABLE si, et seulement si, une recherche explicite valide (marketChecks, même règle que products.js) l'affirme
   et qu'aucune offre établie ou probable ne la contredit ; sinon UNKNOWN. */
function classifyMarket(input, opts) {
  const inp = input && typeof input === 'object' ? input : {};
  const target = typeof inp.targetCountry === 'string' ? inp.targetCountry.toUpperCase() : null;
  const list = Array.isArray(inp.observations) ? inp.observations : [];
  const per = list.map((raw, i) => { const n = O.normalizeObservation(raw); return { index: i, obs: n.observation, issues: n.issues, r: classifyOne(n.observation, n.issues, target, opts) }; });
  const base = { schema: SCHEMA, targetCountry: target, observationCount: per.length };
  const qualifying = per.filter(x => x.r.status in RANK).sort((a, b) => RANK[a.r.status] - RANK[b.r.status] || a.index - b.index);
  const detail = per.map(x => Object.assign({ index: x.index, observationId: x.obs.id, productId: x.obs.productId }, x.r));
  if (qualifying.length) {
    const best = qualifying[0];
    return Object.assign(base, best.r, { observationId: best.obs.id, productId: best.obs.productId, supportingObservations: qualifying.filter(q => q.r.status === best.r.status).map(q => q.index), observations: detail });
  }
  if (!target || !Object.prototype.hasOwnProperty.call(O.MARKETS, target)) return Object.assign(base, result('UNKNOWN', ['TARGET_COUNTRY_INVALID'], [], [], { historicalOffer: false }), { observationId: null, productId: null, supportingObservations: [], observations: detail });
  // Aucune offre qualifiante : on cherche une recherche explicite, selon la règle existante (products.js : validateMarketCheck).
  const checks = (Array.isArray(inp.marketChecks) ? inp.marketChecks : []).filter(ch => ch && typeof ch === 'object' && ch.market === target);
  const valid = checks.filter(ch => O.validateMarketCheck(ch).length === 0), none = valid.find(ch => ch.status === 'searched_none'), found = valid.find(ch => ch.status === 'searched_found');
  const historical = per.some(x => x.r.historicalOffer);
  const establishedIn = x => !!(x.obs.seller.country && x.obs.seller.country.established && x.obs.seller.country.value === target);
  const localOffer = per.some(x => x.obs.identity === 'TARGET' && establishedIn(x));
  const candidate = per.some(x => x.obs.identity === 'AMBIGUOUS' && establishedIn(x));
  const ev = valid.map(ch => ({ type: 'market_check', market: ch.market, status: ch.status, checkedAt: ch.checkedAt, method: ch.method }));
  const tail = { observationId: null, productId: null, supportingObservations: [], observations: detail, historicalOffer: historical };
  if (none && !found) {
    if (localOffer) return Object.assign(base, result('UNKNOWN', ['MARKET_CHECK_CONTRADICTS_OFFER'], ev, [], {}), tail);
    if (candidate) return Object.assign(base, result('UNKNOWN', ['UNCONFIRMED_LOCAL_CANDIDATE_EXISTS'], ev, [], {}), tail);
    // identité non résolue (matching absent ou inexploitable) : la recherche ne peut pas établir l'indisponibilité du produit EXACT
    if (per.some(x => x.obs.identity === null)) return Object.assign(base, result('UNKNOWN', ['UNRESOLVED_IDENTITY_OBSERVATION_EXISTS'], ev, [], {}), tail);
    if (per.some(x => x.obs.identity === 'TARGET' && x.obs.shipsTo.some(e => e.country === target && e.state === 'YES'))) return Object.assign(base, result('UNKNOWN', ['DELIVERY_CLAIM_EXISTS_NOT_QUALIFIED'], ev, [], {}), tail);
    if (per.some(x => x.r.warningCodes.includes('W_INTERNATIONAL_SHIPPING_NOT_SPECIFIC'))) return Object.assign(base, result('UNKNOWN', ['UNSPECIFIED_INTERNATIONAL_OFFER_EXISTS'], ev, [], {}), tail);
    return Object.assign(base, result('UNAVAILABLE', ['UNAVAILABLE_SEARCHED_NONE'], ev, [], {}), tail);
  }
  const best = per[0];
  if (none && found) return Object.assign(base, result('UNKNOWN', ['SEARCH_EVIDENCE_CONFLICT'], ev, [], {}), tail);
  if (found) return Object.assign(base, result('UNKNOWN', ['SEARCH_FOUND_NOT_QUALIFIED'].concat(best ? best.r.reasonCodes : []), ev.concat(best ? best.r.evidence : []), best ? best.r.warningCodes : [], {}), tail);
  if (checks.length) return Object.assign(base, result('UNKNOWN', ['INSUFFICIENT_SEARCH_COVERAGE'].concat(best ? best.r.reasonCodes : []), best ? best.r.evidence : [], best ? best.r.warningCodes : [], {}), tail);
  if (best) return Object.assign(base, best.r, tail, { reasonCodes: best.r.reasonCodes.concat(['NO_SEARCH_RECORDED']), reasons: best.r.reasonCodes.concat(['NO_SEARCH_RECORDED']).map(c => REASONS[c] || c) });
  return Object.assign(base, result('UNKNOWN', ['NO_SEARCH_RECORDED'], [], [], {}), tail);
}

/* classify({ targetCountry, observation, marketChecks? }, opts) : une observation, un pays cible. Même sortie que classifyMarket pour une liste d'une observation. */
function classify(input, opts) {
  const inp = input && typeof input === 'object' ? input : {};
  return classifyMarket({ targetCountry: inp.targetCountry, observations: inp.observation == null ? [] : [inp.observation], marketChecks: inp.marketChecks }, opts);
}


/* Divergences VOLONTAIRES avec availabilityStatus() : toutes dans le sens de la prudence (classify dit UNKNOWN là où le catalogue affirme un statut). Documentées, testées, nommées. */
const DIVERGENCES = {
  D1_INTERNATIONAL_UNSPECIFIED: { catalog: 'IMPORT', classify: 'UNKNOWN', why: 'le catalogue lit `shipping: international` comme IMPORT ; sans pays nommé, rien ne prouve la livraison vers le pays cible' },
  D2_LOCAL_ONLY_DELIVERY: { catalog: 'REGIONAL', classify: 'UNKNOWN', why: 'le catalogue compte `servesMarkets` même si le vendeur indique une livraison locale seulement ; une livraison « locale » contredit la desserte du pays cible' },
  D3_UNAVAILABLE_GUARDED: { catalog: 'UNAVAILABLE', classify: 'UNKNOWN', why: 'une offre, une livraison affirmée ou une livraison internationale non précisée existe : déclarer l\'indisponibilité serait plus fort que les preuves' },
  D4_SEARCH_CONFLICT: { catalog: 'UNAVAILABLE', classify: 'UNKNOWN', why: 'le catalogue retient la première recherche valide (ordre de saisie) ; deux recherches contradictoires pour un pays ne prouvent pas l\'indisponibilité' }
};
const D3_CODES = ['MARKET_CHECK_CONTRADICTS_OFFER', 'UNCONFIRMED_LOCAL_CANDIDATE_EXISTS', 'UNSPECIFIED_INTERNATIONAL_OFFER_EXISTS', 'DELIVERY_CLAIM_EXISTS_NOT_QUALIFIED'];

/* reconcile(statutCatalogue, résultat de classify/classifyMarket) → { relation, divergence, catalog, classify, explanation }. Pure ; n'appelle pas availabilityStatus (le statut catalogue est fourni).
   AGREE : même statut. MORE_CAUTIOUS : classify dit UNKNOWN dans l'un des cas DIVERGENCES. VIOLATION : tout autre écart (plus permissif, ou prudence non nommée) : jamais attendu. */
function reconcile(catalogStatus, r) {
  const k = r && typeof r === 'object' ? r.status : null, out = (relation, divergence, explanation) => ({ relation, divergence: divergence || null, catalog: catalogStatus, classify: k, explanation: explanation || null });
  if (!STATUSES.includes(catalogStatus) || !STATUSES.includes(k)) return out('VIOLATION', null, 'statut inconnu');
  if (catalogStatus === k) return out('AGREE');
  if (k !== 'UNKNOWN') return out('VIOLATION', null, 'classify affirme ' + k + ' là où le catalogue dit ' + catalogStatus);
  const per = Array.isArray(r.observations) ? r.observations : [], codes = r.reasonCodes || [];
  if (catalogStatus === 'IMPORT' && per.some(o => o.reasonCodes.includes('DELIVERY_TO_TARGET_UNKNOWN') && o.warningCodes.includes('W_INTERNATIONAL_SHIPPING_NOT_SPECIFIC'))) return out('MORE_CAUTIOUS', 'D1_INTERNATIONAL_UNSPECIFIED', DIVERGENCES.D1_INTERNATIONAL_UNSPECIFIED.why);
  if (catalogStatus === 'REGIONAL' && per.some(o => o.reasonCodes.includes('DELIVERY_LOCAL_ONLY'))) return out('MORE_CAUTIOUS', 'D2_LOCAL_ONLY_DELIVERY', DIVERGENCES.D2_LOCAL_ONLY_DELIVERY.why);
  if (catalogStatus === 'UNAVAILABLE' && codes.includes('SEARCH_EVIDENCE_CONFLICT')) return out('MORE_CAUTIOUS', 'D4_SEARCH_CONFLICT', DIVERGENCES.D4_SEARCH_CONFLICT.why);
  if (catalogStatus === 'UNAVAILABLE' && codes.some(c => D3_CODES.includes(c))) return out('MORE_CAUTIOUS', 'D3_UNAVAILABLE_GUARDED', DIVERGENCES.D3_UNAVAILABLE_GUARDED.why);
  return out('VIOLATION', null, 'prudence non nommée : ' + catalogStatus + ' → UNKNOWN (' + codes.join(',') + ')');
}

module.exports = { SCHEMA, STATUSES, REASONS, DIVERGENCES, defaultIsRegional, classify, classifyMarket, reconcile };
