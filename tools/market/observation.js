'use strict';
/* OBSERVATION COMMERCIALE : le schéma partagé par confidence.js et classify.js. Fonctions PURES (aucun réseau, aucun fichier, aucune horloge, aucune mutation de l'entrée). Hors du bundle client.
   Ici on VALIDE et on NORMALISE ; on ne DÉCIDE rien : ni fiabilité (confidence.js), ni LOCAL / REGIONAL / IMPORT (classify.js). Une donnée absente reste null / 'UNKNOWN' : jamais devinée.

   Observation (tout est facultatif ; ce qui manque est « inconnu ») :
   { id?, match? (résultat du matcher : { matchClass, signals?, warningCodes?, productId? }), assignedByCatalog? (true : l'offre est déjà rattachée à son produit par le catalogue),
     seller?: { id?, name?, type?, registered?, verified?, country?: { value, basis, source } | [ ... ] },
     price?: { amount, currency, basis? }, stock?, url?: string | { href, kind? }, source?: { kind, label?, reopened? }, method?, checkedAt?, city?,
     shipsTo?: [{ country, explicit, source, checkedAt }], shippingMention?: 'local' | 'international' }

   Règles de lecture (fermées, versionnées) : un pays de vendeur n'est ÉTABLI que par une base explicite ET une source ; une devise, un domaine, une langue, un numéro ne l'établissent jamais.
   Un stock n'est jamais déduit. Une URL n'est une « fiche produit » que si elle est déclarée telle et qu'aucun indice ne la contredit (recherche, catégorie). */
const P = require('../../js/engine/products.js');

const SCHEMA_VERSION = 1;
const MARKETS = P.MARKETS;                                        // pays connus de DERMAI (code ISO → nom) : même source que le catalogue et availabilityStatus

/* Identité du produit vis-à-vis du produit visé, déduite de la CLASSE du matcher (jamais d'un score). */
const IDENTITY_OF_CLASS = { EXACT_MATCH: 'TARGET', STRONG_MATCH: 'TARGET', POSSIBLE_MATCH: 'AMBIGUOUS', VARIANT_MATCH: 'VARIANT', NO_MATCH: 'OTHER' };
const IDENTITIES = ['TARGET', 'AMBIGUOUS', 'VARIANT', 'OTHER'];

const STOCK_STATES = ['IN_STOCK', 'OUT_OF_STOCK', 'COMING_SOON', 'UNKNOWN'];
const STOCK_ALIASES = { in_stock: 'IN_STOCK', out_of_stock: 'OUT_OF_STOCK', coming_soon: 'COMING_SOON', unknown: 'UNKNOWN' };
const SELLER_TYPES = ['retailer', 'pharmacy', 'marketplace', 'brand', 'brand_site', 'importer', 'other'];
const SOURCE_KINDS = ['seller_page', 'marketplace_listing', 'team_provided', 'manufacturer_page', 'search_engine', 'snippet', 'secondary'];
/* Base d'un pays de vendeur. ÉTABLIE : la page du vendeur le dit, un registre vérifié le dit, l'équipe DERMAI l'a relevé, le catalogue l'a enregistré avec sa source. Les autres sont des INDICES. */
const COUNTRY_BASES_ESTABLISHED = ['seller_page', 'registry', 'team_provided', 'catalog_offer'];
const COUNTRY_BASES_HINT = ['currency', 'domain', 'language', 'phone', 'shipping_mention', 'inferred'];
const URL_KINDS = ['product_page', 'seller', 'category', 'search', 'unclassified'];
const PRICE_BASES = ['displayed', 'estimated', 'converted'];

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const str = x => (typeof x === 'string' ? x.trim() : '');
const isCountryShape = c => typeof c === 'string' && /^[A-Z]{2}$/.test(c);

/* Date « AAAA-MM-JJ » (préfixe d'un horodatage ISO accepté) → jours depuis l'époque, ou null. */
function dayNumber(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof d === 'string' ? d : (d instanceof Date ? d.toISOString() : ''));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), back = new Date(t);
  if (back.getUTCFullYear() !== +m[1] || back.getUTCMonth() !== +m[2] - 1 || back.getUTCDate() !== +m[3]) return null;
  return Math.floor(t / 86400000);
}
const ageDays = (checkedAt, now) => { const a = dayNumber(checkedAt), b = dayNumber(now); return a == null || b == null ? null : b - a; };

/* ---------- URL ---------- */
const SEARCH_KEYS = ['q', 's', 'query', 'search', 'keyword', 'keywords', 'term', 'text', 'searchterm', 'k'];
function urlInfo(input, issues) {
  const raw = isObj(input) ? input.href : input, declared = isObj(input) ? input.kind : null;
  if (raw == null || raw === '') return null;
  let u; try { u = new URL(String(raw)); } catch (e) { issues.push('url_invalid'); return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') { issues.push('url_invalid'); return null; }
  const path = u.pathname.toLowerCase(), segs = path.split('/').filter(Boolean);
  const search = SEARCH_KEYS.some(k => u.searchParams.has(k)) || /(^|\/)(search|recherche|rechercher|catalogsearch|results?)(\/|$)/.test(path);
  const productLike = /(^|\/)(products?|produits?|dp|item|items|p)\/[^/]+/.test(path);
  const category = !productLike && /(^|\/)(category|categories|categorie|collections?|cat|brands?|marques?)(\/|$)/.test(path);
  const root = segs.length === 0;
  let kind = 'unclassified';
  if (declared != null && !URL_KINDS.includes(declared)) issues.push('url_kind_invalid');
  const d = URL_KINDS.includes(declared) ? declared : null;
  if (search) kind = 'search';
  else if (category) kind = 'category';
  else if (root) kind = 'seller';
  else if (d) kind = d;
  if (d && d !== kind) issues.push('url_kind_conflict');          // la déclaration est contredite par l'adresse : le plus prudent l'emporte
  return { href: String(raw), kind };
}

/* ---------- pays du vendeur ---------- */
function countryInfo(input, issues) {
  if (input == null) return null;
  const list = Array.isArray(input) ? input : [input];
  const items = list.map(c => (typeof c === 'string' ? { value: c, basis: null, source: null } : c)).filter(isObj);
  if (!items.length) return null;
  const values = [...new Set(items.map(c => str(c.value).toUpperCase()))];
  if (values.length > 1) { issues.push('seller_country_conflict'); return { value: null, basis: null, source: null, established: false, conflict: true, valid: false, values }; }
  const c = items[0], value = str(c.value).toUpperCase(), basis = str(c.basis) || null, source = str(c.source) || null;
  if (basis && !COUNTRY_BASES_ESTABLISHED.includes(basis) && !COUNTRY_BASES_HINT.includes(basis)) issues.push('seller_country_basis_unknown');
  const valid = isCountryShape(value);
  return { value: value || null, basis, source, established: valid && COUNTRY_BASES_ESTABLISHED.includes(basis) && !!source, conflict: false, valid, values };
}

function shipsToInfo(input, issues) {
  const out = [];
  for (const e of (Array.isArray(input) ? input : [])) {
    if (!isObj(e)) { issues.push('shipsto_entry_invalid'); continue; }
    const country = str(e.country).toUpperCase();
    if (!isCountryShape(country)) { issues.push('shipsto_entry_invalid'); continue; }
    out.push({ country, state: e.explicit === true ? 'YES' : e.explicit === false ? 'NO' : 'UNKNOWN', explicit: e.explicit === true, source: str(e.source) || null, checkedAt: dayNumber(e.checkedAt) != null ? String(e.checkedAt).slice(0, 10) : null });
  }
  return out;
}

function stockState(v, issues) {
  if (v == null || v === '') return 'UNKNOWN';
  const k = String(v).trim();
  if (STOCK_STATES.includes(k)) return k;
  const a = STOCK_ALIASES[k.toLowerCase().replace(/[\s-]+/g, '_')];
  if (a) return a;
  issues.push('stock_value_invalid');
  return 'UNKNOWN';                                              // jamais déduit : une valeur inconnue vaut « inconnu »
}

function priceInfo(v, issues) {
  if (v == null) return null;
  if (!isObj(v)) { issues.push('price_invalid'); return { amount: null, currency: null, basis: null, valid: false, displayed: false }; }
  const amount = typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount > 0 ? v.amount : null;
  const currency = typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency) ? v.currency : null;
  const basis = PRICE_BASES.includes(v.basis) ? v.basis : (v.basis == null ? 'displayed' : null);
  const valid = amount != null && currency != null;
  if (!valid) issues.push('price_invalid');
  if (v.basis != null && basis == null) issues.push('price_basis_invalid');
  return { amount, currency, basis, valid, displayed: valid && basis === 'displayed' };
}

/* normalizeObservation(brut) → { observation, issues }. Ne lève jamais d'exception ; ne modifie jamais l'entrée. `issues` : anomalies de FORME (codes), jamais un jugement de fiabilité. */
function normalizeObservation(raw) {
  const issues = [];
  if (!isObj(raw)) return { observation: normalizeObservation({}).observation, issues: ['observation_invalid'] };
  const m = isObj(raw.match) ? raw.match : null;
  const matchInvalid = !!m && m.valid === false;
  /* Un résultat marqué inexploitable (valid: false) n'a pas de classe valable : celle qu'il porterait éventuellement (résultat forgé ou incohérent) n'est jamais lue ni recopiée. */
  const matchClass = !matchInvalid && m && typeof m.matchClass === 'string' ? m.matchClass : null;
  let identity = null, identityBasis = null;
  /* Résultat du matcher marqué inexploitable (valid: false, aucune classe) : l'identité reste inconnue, jamais « autre produit ». */
  if (matchInvalid) issues.push('match_invalid_input');
  else if (matchClass && Object.prototype.hasOwnProperty.call(IDENTITY_OF_CLASS, matchClass)) { identity = IDENTITY_OF_CLASS[matchClass]; identityBasis = 'matcher'; }
  else if (matchClass) issues.push('match_class_unknown');
  else if (raw.assignedByCatalog === true) { identity = 'TARGET'; identityBasis = 'catalog'; }
  const s = isObj(raw.seller) ? raw.seller : {};
  const type = str(s.type) || null;
  if (type && !SELLER_TYPES.includes(type)) issues.push('seller_type_invalid');
  const src = isObj(raw.source) ? raw.source : null;
  const kind = src ? str(src.kind) : '';
  if (kind && !SOURCE_KINDS.includes(kind)) issues.push('source_kind_unknown');
  const checkedAt = dayNumber(raw.checkedAt) != null ? String(raw.checkedAt).slice(0, 10) : null;
  if (raw.checkedAt != null && checkedAt == null) issues.push('checked_at_invalid');
  return {
    observation: {
      schemaVersion: SCHEMA_VERSION, id: str(raw.id) || null,
      identity, identityBasis, matchClass, productId: m && typeof m.productId === 'string' ? m.productId : null,
      matchWarningCodes: m && Array.isArray(m.warningCodes) ? m.warningCodes.filter(w => typeof w === 'string').slice() : [],
      seller: {
        id: str(s.id) || null, name: str(s.name) || null, type: SELLER_TYPES.includes(type) ? type : null,
        registered: s.registered === true, verified: s.verified === true, country: countryInfo(s.country, issues)
      },
      price: priceInfo(raw.price, issues), stock: stockState(raw.stock, issues), url: urlInfo(raw.url, issues),
      source: src ? { kind: SOURCE_KINDS.includes(kind) ? kind : null, label: str(src.label) || null, reopened: src.reopened === true } : null,
      method: str(raw.method) || null, checkedAt, city: str(raw.city) || null,
      shipsTo: shipsToInfo(raw.shipsTo, issues), shippingMention: raw.shippingMention === 'local' || raw.shippingMention === 'international' ? raw.shippingMention : null
    },
    issues: [...new Set(issues)]
  };
}

/* fromCatalogProduct(produit) → { observations, marketChecks } : le pont vers le catalogue ACTUEL, en lecture seule. Chaque offre VALIDE du catalogue devient une observation déjà rattachée à son produit.
   Le catalogue n'est jamais modifié ; seules ses règles de validation (products.js) sont réutilisées. `servesMarkets` (pays que le vendeur dit desservir) devient une livraison explicite ;
   `shipping: 'international'` sans pays nommé n'est PAS une livraison vers un pays précis et n'en devient pas une. */
function fromCatalogProduct(product) {
  if (!isObj(product) || product.demo === true || !Array.isArray(product.offers)) return { observations: [], marketChecks: Array.isArray(product && product.marketChecks) ? product.marketChecks.slice() : [] };
  const observations = product.offers.map((o, i) => ({ o, i })).filter(x => P.validateOffer(x.o, false).length === 0).map(({ o, i }) => ({
    id: String(product.id) + '#' + i, assignedByCatalog: true,
    seller: { name: o.seller || o.retailer, type: o.type, country: { value: o.market, basis: 'catalog_offer', source: o.source } },
    price: o.price != null ? { amount: o.price, currency: o.currency, basis: 'displayed' } : null,
    stock: o.availability, url: o.url ? { href: o.url } : null, source: { kind: 'secondary', label: o.source }, checkedAt: o.checkedAt, city: o.city || null,
    shipsTo: (Array.isArray(o.servesMarkets) ? o.servesMarkets : []).map(c => ({ country: c, explicit: true, source: o.source, checkedAt: o.checkedAt })),
    shippingMention: o.shipping || null
  }));
  return { observations, marketChecks: Array.isArray(product.marketChecks) ? product.marketChecks.slice() : [] };
}

module.exports = {
  SCHEMA_VERSION, MARKETS, IDENTITY_OF_CLASS, IDENTITIES, STOCK_STATES, SELLER_TYPES, SOURCE_KINDS, COUNTRY_BASES_ESTABLISHED, COUNTRY_BASES_HINT, URL_KINDS, PRICE_BASES,
  dayNumber, ageDays, urlInfo, normalizeObservation, fromCatalogProduct, validateMarketCheck: P.validateMarketCheck
};
