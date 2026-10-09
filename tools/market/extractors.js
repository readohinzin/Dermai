'use strict';
/* EXTRACTEURS GÉNÉRIQUES : lisent un contenu DÉJÀ récupéré (résultat de safe-fetch.js ou { body, contentType, finalUrl }) et en tirent des FICHES CANDIDATES, avec la provenance et les limites de chaque champ.
   Fonctions PURES : aucun réseau, aucun fichier, aucune horloge, aucune mutation de l'entrée, aucune dépendance. Hors navigateur.

   PRINCIPES
   - Rien n'est fabriqué : un champ absent vaut null ; une devise n'est jamais déduite d'un symbole, d'un domaine ou d'une langue ; un pays, un stock, une marque ne sont jamais inventés.
   - Rien n'est tranché en silence : plusieurs produits, plusieurs prix, plusieurs devises, des sources qui se contredisent produisent des anomalies explicites (`issues`) et laissent la valeur concernée à null.
   - Un champ extrait n'est pas une preuve commerciale : titre de page ≠ produit en stock ; URL canonique ≠ livraison vers un pays ; une déclaration de livraison n'est jamais transformée en `shipsTo`.
   - Ce module ne décide ni du matching (match.js), ni de la fiabilité (confidence.js), ni du marché (classify.js). Il ne produit jamais de classe de matching.

   CONTRAT DE SORTIE (extraction/1) : voir README. Chaque candidat contient `candidate` (champs lus par match.js : title, brand, description, volume, gtin, mpn, sku) et `observation` (champs lus par
   observation.js : price, stock, url) ; l'appelant assemble `{ match: matchCandidate(candidate, identité), ...observation, seller, source, checkedAt }`. */
const N = require('./normalize.js');
const { isValidGtin } = require('./match.js');

const SCHEMA = 'extraction/1';
const LIMITS = Object.freeze({
  maxChars: 3 * 1024 * 1024,   // contenu examiné
  maxTagLength: 8192,          // une balise plus longue est considérée malformée
  maxJsonLdBlocks: 50, maxJsonLdChars: 1024 * 1024,
  maxMetaTags: 2000, maxDepth: 10, maxNodes: 5000, maxCandidates: 50, maxOffers: 50, maxText: 2000
});

const ISSUES = Object.freeze({
  input_invalid: ['error', 'entrée invalide : un contenu récupéré avec succès est attendu'], input_too_large: ['error', 'contenu trop volumineux pour être examiné'],
  content_type_unsupported: ['error', 'type de contenu non pris en charge'], content_type_unknown: ['warning', 'type de contenu non indiqué : lu comme du HTML'],
  html_malformed: ['warning', 'HTML malformé : certaines balises n\'ont pas pu être lues'], html_tag_limit: ['warning', 'trop de balises : lecture interrompue'],
  jsonld_none: ['info', 'aucun bloc JSON-LD'], jsonld_invalid: ['warning', 'bloc JSON-LD invalide : ignoré'], jsonld_unterminated: ['warning', 'bloc JSON-LD non refermé'], jsonld_multiple_blocks: ['info', 'plusieurs blocs JSON-LD'],
  jsonld_no_product: ['info', 'JSON-LD sans produit'], jsonld_traversal_limit: ['warning', 'JSON-LD trop profond ou trop grand : lecture partielle'], json_not_jsonld: ['info', 'JSON sans données de produit schema.org'],
  no_product_data: ['info', 'aucune donnée de produit exploitable'], multiple_products: ['conflict', 'plusieurs produits dans la page : aucun n\'est choisi'], product_group_ignored: ['info', 'groupe de produits : seules ses variantes déclarées sont lues'],
  product_name_missing: ['warning', 'produit sans nom'], too_many_candidates: ['warning', 'trop de produits : liste tronquée'],
  field_multiple_values: ['conflict', 'plusieurs valeurs différentes pour un même champ : aucune retenue'], field_not_text: ['warning', 'valeur non textuelle ignorée'], reference_unresolved: ['warning', 'référence (@id) non résolue'],
  gtin_invalid: ['warning', 'GTIN invalide (forme ou clé de contrôle)'], gtin_conflict: ['conflict', 'plusieurs GTIN différents : aucun retenu'], sku_only: ['info', 'référence vendeur (SKU) sans GTIN ni MPN'],
  volume_unparsed: ['warning', 'taille présente mais non lisible comme un volume ou une masse'], unit_code_unknown: ['warning', 'code d\'unité inconnu'],
  price_missing: ['info', 'prix absent'], price_format_ambiguous: ['warning', 'format de prix ambigu : non interprété'], price_not_positive: ['warning', 'prix nul ou négatif'], price_without_currency: ['warning', 'prix sans devise : aucune devise inventée'],
  currency_invalid: ['warning', 'devise invalide (code à trois lettres attendu)'], currency_case_normalized: ['info', 'devise mise en majuscules'],
  multiple_prices: ['conflict', 'plusieurs prix différents : aucun retenu'], multiple_currencies: ['conflict', 'plusieurs devises : aucune retenue'], price_range: ['warning', 'fourchette de prix : pas un prix unique'],
  multiple_price_specifications: ['info', 'plusieurs spécifications de prix pour une même offre'], price_source_conflict: ['conflict', 'prix différent entre JSON-LD et métadonnées de la page'],
  currency_source_conflict: ['conflict', 'devise différente entre JSON-LD et métadonnées de la page'], offers_truncated: ['warning', 'trop d\'offres : liste tronquée'],
  availability_missing: ['info', 'disponibilité absente : inconnue'], availability_not_mapped: ['info', 'disponibilité déclarée mais non interprétée comme présente ou en rupture : inconnue'],
  availability_conflict: ['conflict', 'disponibilités différentes entre offres : inconnue'], availability_source_conflict: ['conflict', 'disponibilité différente entre JSON-LD et métadonnées de la page'],
  canonical_missing: ['info', 'URL canonique absente'], canonical_invalid: ['warning', 'URL canonique invalide ou non résoluble'], canonical_cross_host: ['warning', 'URL canonique sur un autre hôte que la page'],
  canonical_differs_from_final: ['info', 'URL canonique différente de l\'URL finale'], base_tag_present: ['info', 'balise <base> présente : ignorée pour résoudre les adresses'],
  delivery_evidence_none: ['info', 'aucune déclaration de livraison trouvée : aucune preuve de livraison vers un pays'], delivery_destination_unparsed: ['info', 'destination de livraison non lisible comme code pays']
});

const clip = (s, n) => (s.length > n ? s.slice(0, n) : s);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

/* ---------------------------------------------------------------- HTML : balises */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e) => {
    if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; } catch (x) { return m; } }
    return Object.prototype.hasOwnProperty.call(ENT, e.toLowerCase()) ? ENT[e.toLowerCase()] : m;
  });
}

/* Lit une balise ouvrante commençant à `pos` ('<'). Renvoie { name, attrs, end } (end : index après '>') ou null si malformée. Les guillemets sont respectés ; longueur bornée. */
function readTag(html, pos) {
  let i = pos + 1; const max = Math.min(html.length, pos + LIMITS.maxTagLength);
  const nameStart = i;
  while (i < max && /[A-Za-z0-9:-]/.test(html[i])) i++;
  const name = html.slice(nameStart, i).toLowerCase(); const attrs = {};
  while (i < max) {
    while (i < max && /[\s/]/.test(html[i])) i++;
    if (html[i] === '>') return { name, attrs, end: i + 1 };
    const ns = i;
    while (i < max && !/[\s=>/]/.test(html[i])) i++;
    const an = html.slice(ns, i).toLowerCase();
    if (i === ns) { i++; continue; }
    while (i < max && /\s/.test(html[i])) i++;
    let val = '';
    if (html[i] === '=') {
      i++; while (i < max && /\s/.test(html[i])) i++;
      if (html[i] === '"' || html[i] === '\'') { const q = html[i]; const close = html.indexOf(q, i + 1); if (close === -1 || close >= max) return null; val = html.slice(i + 1, close); i = close + 1; }
      else { const vs = i; while (i < max && !/[\s>]/.test(html[i])) i++; val = html.slice(vs, i); }
    }
    if (!Object.prototype.hasOwnProperty.call(attrs, an)) attrs[an] = decodeEntities(val);
  }
  return null;
}

/* Découpage minimal du HTML en tenant compte de l'interaction commentaire / script, comme un navigateur : un commentaire <!-- ... --> n'est pas du contenu ; le texte d'un <script> est opaque
   (aucune balise n'y est lue). Renvoie les scripts et les zones à ignorer pour la recherche des autres balises. Un commentaire jamais refermé couvre le reste du document. */
function tokenize(html, state) {
  const scripts = [], excluded = [], re = /<!--|<script(?=[\s/>])/gi, closeRe = /<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0] === '<!--') {
      const end = html.indexOf('-->', m.index + 4);
      if (end === -1) { excluded.push([m.index, html.length]); state.malformed = true; break; }
      excluded.push([m.index, end + 3]); re.lastIndex = end + 3; continue;
    }
    if (scripts.length >= LIMITS.maxMetaTags) { state.tagLimit = true; break; }
    const tag = readTag(html, m.index);
    if (!tag) { state.malformed = true; re.lastIndex = Math.min(html.length, m.index + LIMITS.maxTagLength); continue; }      // balise jamais refermée dans la limite : fragment sauté (coût linéaire)
    closeRe.lastIndex = tag.end; const c = closeRe.exec(html);
    if (!c) state.malformed = true;
    scripts.push({ attrs: tag.attrs, start: m.index, content: c ? html.slice(tag.end, c.index) : html.slice(tag.end), terminated: !!c });
    const end = c ? c.index + c[0].length : html.length;
    excluded.push([m.index, end]); re.lastIndex = end;
  }
  return { scripts, excluded };
}

/* Toutes les balises `name` (insensible à la casse) hors commentaires et scripts, dans l'ordre. withContent : texte brut jusqu'à la balise fermante. */
function findTags(html, name, withContent, state, excluded) {
  const out = [], re = new RegExp('<' + name + '(?=[\\s/>])', 'gi'), closeRe = new RegExp('</' + name + '\\s*>', 'gi'), zones = excluded || [];
  let m, z = 0;
  while ((m = re.exec(html))) {
    while (z < zones.length && zones[z][1] <= m.index) z++;
    if (z < zones.length && zones[z][0] <= m.index) { re.lastIndex = zones[z][1]; continue; }
    if (out.length >= LIMITS.maxMetaTags) { state.tagLimit = true; break; }
    const tag = readTag(html, m.index);
    if (!tag) { state.malformed = true; re.lastIndex = Math.min(html.length, m.index + LIMITS.maxTagLength); continue; }
    const t = { attrs: tag.attrs, start: m.index, content: null, terminated: true };
    if (withContent) {
      closeRe.lastIndex = tag.end; const c = closeRe.exec(html);
      if (c) { t.content = html.slice(tag.end, c.index); re.lastIndex = c.index + c[0].length; } else { t.content = html.slice(tag.end); t.terminated = false; re.lastIndex = html.length; state.malformed = true; }
    } else re.lastIndex = tag.end;
    out.push(t);
  }
  return out;
}

/* ---------------------------------------------------------------- champs */
const SRC = { jsonld: 'json-ld', meta: 'meta', title: 'html-title', link: 'link-canonical' };
const field = (raw, value, source, path, explicitness, issues) => ({ raw: raw === undefined ? null : raw, value: value === undefined ? null : value, source, path, explicitness, issues: issues || [] });
const textOf = v => (typeof v === 'string' && v.trim() ? v.trim() : null);

/* Une valeur textuelle simple, éventuellement multiple. 0 valeur → null ; 1 valeur distincte → elle ; plusieurs distinctes → conflit, aucune retenue. */
function scalarText(raw, source, path, issues) {
  const list = (Array.isArray(raw) ? raw : [raw]).filter(v => v !== undefined && v !== null);
  if (!list.length) return null;
  const texts = list.map(textOf);
  if (texts.some(t => t === null)) issues.push({ code: 'field_not_text', path });
  const distinct = [...new Set(texts.filter(Boolean))];
  if (!distinct.length) return field(raw, null, source, path, 'ambiguous', ['field_not_text']);
  if (distinct.length > 1) { issues.push({ code: 'field_multiple_values', path }); return field(raw, null, source, path, 'ambiguous', ['field_multiple_values']); }
  return field(raw, clip(distinct[0], LIMITS.maxText), source, path, 'explicit');
}

function brandOf(raw, path, issues) {
  if (raw === undefined || raw === null) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const names = [];
  for (const b of list) {
    if (typeof b === 'string') { if (b.trim()) names.push(b.trim()); } else if (isObj(b)) { if (textOf(b.name)) names.push(b.name.trim()); else if (b['@id'] && Object.keys(b).length <= 2) issues.push({ code: 'reference_unresolved', path }); }
  }
  const distinct = [...new Set(names)];
  if (distinct.length === 1) return field(raw, distinct[0], SRC.jsonld, path, 'explicit');
  if (distinct.length > 1) { issues.push({ code: 'field_multiple_values', path }); return field(raw, null, SRC.jsonld, path, 'ambiguous', ['field_multiple_values']); }
  return field(raw, null, SRC.jsonld, path, 'ambiguous', ['reference_unresolved']);
}

const gtinKey = v => String(v).padStart(14, '0');
function gtinOf(entries, issues) {
  // entries : [{ raw, path }] (gtin, gtin8/12/13/14 du produit et de ses offres)
  const found = [];
  for (const e of entries) {
    const digits = typeof e.raw === 'string' || typeof e.raw === 'number' ? String(e.raw).replace(/[\s-]/g, '') : '';
    if (/^\d{8,14}$/.test(digits)) found.push({ digits, path: e.path, valid: isValidGtin(digits) });
    else if (e.raw !== undefined && e.raw !== null && e.raw !== '') issues.push({ code: 'gtin_invalid', path: e.path });
  }
  if (!found.length) return null;
  const keys = [...new Set(found.map(f => gtinKey(f.digits)))];
  const rawAll = entries.map(e => e.raw);
  if (keys.length > 1) { issues.push({ code: 'gtin_conflict', path: found[0].path }); return field(rawAll, null, SRC.jsonld, found[0].path, 'ambiguous', ['gtin_conflict']); }
  const f = found[0];
  if (!f.valid) issues.push({ code: 'gtin_invalid', path: f.path });
  const fld = field(rawAll.length === 1 ? rawAll[0] : rawAll, f.digits, SRC.jsonld, f.path, 'explicit', f.valid ? [] : ['gtin_invalid']);
  fld.valid = f.valid;
  return fld;
}

/* Code d'unité UN/CEFACT → unité lisible par normalize.js. Table fermée ; tout autre code est signalé, jamais deviné. */
const UNIT_CODES = { MLT: 'ml', LTR: 'l', CLT: 'cl', GRM: 'g', KGM: 'kg' };
const VOLUME_PROPERTY_NAMES = /^(volume|contenance|contenu net|net content|net volume|size|taille|capacit[eé]|capacity)$/i;
function volumeOf(node, path, issues) {
  const make = (raw, source, p) => {
    if (typeof raw === 'string' && raw.trim()) {
      const q = N.parseVolume(raw.trim());
      if (q) return field(raw, raw.trim(), source, p, 'explicit');
      issues.push({ code: 'volume_unparsed', path: p }); return field(raw, null, source, p, 'ambiguous', ['volume_unparsed']);
    }
    if (isObj(raw)) {
      const value = typeof raw.value === 'number' ? raw.value : (typeof raw.value === 'string' && /^\d+(\.\d+)?$/.test(raw.value.trim()) ? Number(raw.value) : null);
      let unit = textOf(raw.unitText), how = 'explicit';
      if (!unit && textOf(raw.unitCode)) {
        const u = UNIT_CODES[raw.unitCode.trim().toUpperCase()];
        if (u) { unit = u; how = 'normalized'; } else { issues.push({ code: 'unit_code_unknown', path: p }); return field(raw, null, source, p, 'ambiguous', ['unit_code_unknown']); }
      }
      if (value !== null && unit) { const r = N.normalizeUnit(value, unit); if (r && r.ok) return Object.assign(field(raw, { value, unit }, source, p, how), {}); }
      issues.push({ code: 'volume_unparsed', path: p }); return field(raw, null, source, p, 'ambiguous', ['volume_unparsed']);
    }
    return null;
  };
  if (node.size !== undefined && node.size !== null) return make(node.size, SRC.jsonld, path + '.size');
  const props = (Array.isArray(node.additionalProperty) ? node.additionalProperty : node.additionalProperty ? [node.additionalProperty] : []);
  for (let i = 0; i < props.length; i++) {
    const p = props[i];
    if (isObj(p) && typeof p.name === 'string' && VOLUME_PROPERTY_NAMES.test(p.name.trim())) {
      const val = p.value; const raw = isObj(val) ? val : (p.unitText && (typeof val === 'number' || typeof val === 'string') ? { value: val, unitText: p.unitText } : val);
      const f = make(raw, SRC.jsonld, path + '.additionalProperty[' + i + ']'); if (f) return f;
    }
  }
  return null;
}

/* ---------------------------------------------------------------- prix, devise, disponibilité */
/* Prix : seulement un nombre décimal avec point (norme JSON-LD). Tout autre format est signalé « ambigu » et non interprété (« 12 700 », « 12,50 », « 12 700 FCFA »). */
function parsePrice(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null, issue: 'price_missing' };
  if (typeof raw === 'number') return !Number.isFinite(raw) ? { value: null, issue: 'price_format_ambiguous' } : raw > 0 ? { value: raw, issue: null } : { value: null, issue: 'price_not_positive' };
  if (typeof raw !== 'string') return { value: null, issue: 'price_format_ambiguous' };
  const t = raw.trim();
  if (/^\d{1,12}(\.\d{1,6})?$/.test(t)) { const n = Number(t); return n > 0 ? { value: n, issue: null } : { value: null, issue: 'price_not_positive' }; }
  if (/^-/.test(t) && /^-\d+(\.\d+)?$/.test(t)) return { value: null, issue: 'price_not_positive' };
  return { value: null, issue: 'price_format_ambiguous' };
}
function parseCurrency(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null, issue: null };
  if (typeof raw === 'string' && /^[A-Za-z]{3}$/.test(raw.trim())) { const t = raw.trim(); return { value: t.toUpperCase(), issue: t === t.toUpperCase() ? null : 'currency_case_normalized' }; }
  return { value: null, issue: 'currency_invalid' };
}
const STOCK_TOKENS = { instock: 'IN_STOCK', outofstock: 'OUT_OF_STOCK', soldout: 'OUT_OF_STOCK', in_stock: 'IN_STOCK', out_of_stock: 'OUT_OF_STOCK', 'in stock': 'IN_STOCK', 'out of stock': 'OUT_OF_STOCK', oos: 'OUT_OF_STOCK' };
function mapAvailability(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: 'UNKNOWN', issue: 'availability_missing' };
  if (typeof raw !== 'string') return { value: 'UNKNOWN', issue: 'availability_not_mapped' };
  const token = raw.trim().replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(STOCK_TOKENS, token) ? { value: STOCK_TOKENS[token], issue: null } : { value: 'UNKNOWN', issue: 'availability_not_mapped' };
}

const hasType = (node, names) => { const t = node && node['@type']; const list = (Array.isArray(t) ? t : [t]).filter(x => typeof x === 'string').map(x => x.replace(/^(https?:\/\/schema\.org\/|schema:)/i, '')); return list.some(x => names.includes(x)); };

/* Offres d'un produit (Offer, AggregateOffer, tableaux, offres imbriquées). Chaque entrée de prix garde ses valeurs brutes. */
function offersOf(node, path, issues, base) {
  const out = []; let count = 0;
  const visit = (o, p, depth) => {
    if (count >= LIMITS.maxOffers) { issues.push({ code: 'offers_truncated', path }); return; }
    if (Array.isArray(o)) { o.forEach((x, i) => visit(x, p + '[' + i + ']', depth)); return; }
    if (!isObj(o) || depth > 3) return;
    count++;
    const entry = { path: p, kind: hasType(o, ['AggregateOffer']) ? 'aggregate' : 'offer', prices: [], availability: null, url: null, seller: null, issues: [] };
    const localIssue = (code) => { entry.issues.push(code); issues.push({ code, path: p }); };
    const specs = Array.isArray(o.priceSpecification) ? o.priceSpecification : o.priceSpecification ? [o.priceSpecification] : [];
    const priceSources = [];
    if (o.price !== undefined) priceSources.push({ rawPrice: o.price, rawCur: o.priceCurrency, path: p + '.price' });
    specs.forEach((s, i) => { if (isObj(s) && s.price !== undefined) priceSources.push({ rawPrice: s.price, rawCur: s.priceCurrency !== undefined ? s.priceCurrency : o.priceCurrency, path: p + '.priceSpecification[' + i + '].price' }); });
    if (priceSources.length > 1) localIssue('multiple_price_specifications');
    if (entry.kind === 'aggregate' || o.lowPrice !== undefined || o.highPrice !== undefined) {
      const lo = parsePrice(o.lowPrice), hi = parsePrice(o.highPrice);
      if (o.lowPrice !== undefined || o.highPrice !== undefined) { if (!(lo.value !== null && hi.value !== null && lo.value === hi.value)) localIssue('price_range'); else priceSources.push({ rawPrice: o.lowPrice, rawCur: o.priceCurrency, path: p + '.lowPrice' }); }
    }
    for (const ps of priceSources) {
      const pr = parsePrice(ps.rawPrice), cu = parseCurrency(ps.rawCur);
      const e = { raw: ps.rawPrice, value: pr.value, currencyRaw: ps.rawCur === undefined ? null : ps.rawCur, currency: cu.value, path: ps.path, source: SRC.jsonld, explicitness: pr.value === null ? 'ambiguous' : 'explicit', issues: [] };
      if (pr.issue) { e.issues.push(pr.issue); issues.push({ code: pr.issue, path: ps.path }); }
      if (cu.issue) { e.issues.push(cu.issue); issues.push({ code: cu.issue, path: ps.path }); }
      if (pr.value !== null && cu.value === null && !cu.issue) { e.issues.push('price_without_currency'); issues.push({ code: 'price_without_currency', path: ps.path }); }
      entry.prices.push(e);
    }
    if (o.availability !== undefined) { const a = mapAvailability(Array.isArray(o.availability) ? (new Set(o.availability).size === 1 ? o.availability[0] : '?') : o.availability); entry.availability = { raw: o.availability, value: a.value, path: p + '.availability', source: SRC.jsonld, explicitness: a.value === 'UNKNOWN' ? 'ambiguous' : 'explicit', issue: a.issue }; if (a.issue) issues.push({ code: a.issue, path: p + '.availability' }); }
    if (textOf(o.url)) { try { entry.url = new URL(o.url.trim(), base || undefined).href; } catch (e) { entry.url = null; } }
    const seller = isObj(o.seller) ? textOf(o.seller.name) : textOf(o.seller); if (seller) entry.seller = seller;
    entry.gtin = [o.gtin, o.gtin8, o.gtin12, o.gtin13, o.gtin14].map((v, i) => ({ raw: v, path: p + '.' + ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'][i] })).filter(x => x.raw !== undefined);
    entry.sku = textOf(o.sku);
    out.push(entry);
    if (o.offers !== undefined) visit(o.offers, p + '.offers', depth + 1);
  };
  visit(node.offers, path + '.offers', 0);
  return out;
}

/* Livraison : seulement ce que la page DÉCLARE (shippingDetails.shippingDestination.addressCountry). Jamais transformé en preuve de livraison : c'est une liste de déclarations brutes. */
function deliveryOf(node, path, issues) {
  const declared = [];
  const walkOffers = (o, p) => {
    if (Array.isArray(o)) { o.forEach((x, i) => walkOffers(x, p + '[' + i + ']')); return; }
    if (!isObj(o)) return;
    const sd = Array.isArray(o.shippingDetails) ? o.shippingDetails : o.shippingDetails ? [o.shippingDetails] : [];
    sd.forEach((d, i) => {
      const dests = isObj(d) ? (Array.isArray(d.shippingDestination) ? d.shippingDestination : d.shippingDestination ? [d.shippingDestination] : []) : [];
      dests.forEach((x, j) => {
        const raw = isObj(x) ? x.addressCountry : null, dp = p + '.shippingDetails[' + i + '].shippingDestination[' + j + ']';
        if (typeof raw === 'string' && /^[A-Za-z]{2}$/.test(raw.trim())) declared.push({ country: raw.trim().toUpperCase(), raw, path: dp, source: SRC.jsonld, explicitness: 'declared' });
        else issues.push({ code: 'delivery_destination_unparsed', path: dp });
      });
    });
    if (o.offers !== undefined) walkOffers(o.offers, p + '.offers');
  };
  walkOffers(node.offers, path + '.offers');
  if (!declared.length) issues.push({ code: 'delivery_evidence_none', path });
  return { declaredDestinations: declared, note: 'déclarations de la page, jamais une preuve de livraison vers un pays cible' };
}

/* ---------------------------------------------------------------- JSON-LD */
function walkProducts(root, rootPath, issues, state) {
  const found = []; const stack = [{ node: root, path: rootPath, depth: 0 }]; let nodes = 0;
  while (stack.length) {
    const { node, path, depth } = stack.pop();
    if (++nodes > LIMITS.maxNodes || depth > LIMITS.maxDepth) { if (!state.traversal) { state.traversal = true; issues.push({ code: 'jsonld_traversal_limit', path }); } continue; }
    if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) stack.push({ node: node[i], path: path + '[' + i + ']', depth: depth + 1 }); continue; }
    if (!isObj(node)) continue;
    if (hasType(node, ['Product', 'IndividualProduct'])) { found.push({ node, path }); continue; }                 // les produits imbriqués (liés, similaires) ne sont pas des produits de la page
    if (hasType(node, ['ProductGroup'])) issues.push({ code: 'product_group_ignored', path });
    for (const k of Object.keys(node).reverse()) if (k !== '@context') stack.push({ node: node[k], path: path + '.' + k, depth: depth + 1 });
  }
  return found;
}

function candidateFromProduct(node, path, ctx) {
  const issues = [];
  const name = scalarText(node.name, SRC.jsonld, path + '.name', issues);
  if (!name || !name.value) issues.push({ code: 'product_name_missing', path });
  const brand = brandOf(node.brand, path + '.brand', issues);
  const description = scalarText(node.description, SRC.jsonld, path + '.description', issues);
  const offers = offersOf(node, path, issues, ctx.base);
  const gtinEntries = [node.gtin, node.gtin8, node.gtin12, node.gtin13, node.gtin14].map((v, i) => ({ raw: v, path: path + '.' + ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'][i] })).filter(x => x.raw !== undefined)
    .concat(...offers.map(o => o.gtin));
  const gtin = gtinOf(gtinEntries, issues);
  const mpn = scalarText(node.mpn, SRC.jsonld, path + '.mpn', issues);
  const skuNode = scalarText(node.sku, SRC.jsonld, path + '.sku', issues);
  const sku = skuNode || (offers.length && offers.every(o => o.sku) && new Set(offers.map(o => o.sku)).size === 1 ? field(offers[0].sku, offers[0].sku, SRC.jsonld, offers[0].path + '.sku', 'explicit') : null);
  if (sku && !gtin && !(mpn && mpn.value)) issues.push({ code: 'sku_only', path });
  const volume = volumeOf(node, path, issues);
  const url = textOf(node.url) ? (() => { try { return field(node.url, new URL(node.url.trim(), ctx.base || undefined).href, SRC.jsonld, path + '.url', 'explicit'); } catch (e) { return field(node.url, null, SRC.jsonld, path + '.url', 'ambiguous', ['canonical_invalid']); } })() : null;

  // prix et devise de l'observation : une seule paire (montant, devise) sans contradiction, sinon rien
  const prices = offers.flatMap(o => o.prices);
  const numeric = prices.filter(p => p.value !== null);
  let price = null;
  if (!prices.length) issues.push({ code: 'price_missing', path });
  else if (numeric.length) {
    const pairs = [...new Set(numeric.map(p => p.value + '|' + (p.currency || '')))];
    const currencies = [...new Set(numeric.map(p => p.currency).filter(Boolean))];
    if (pairs.length === 1 && numeric[0].currency) price = { amount: numeric[0].value, currency: numeric[0].currency, basis: 'displayed' };
    else if (pairs.length === 1) { /* prix sans devise : déjà signalé */ }
    else if (currencies.length > 1) issues.push({ code: 'multiple_currencies', path });
    else issues.push({ code: 'multiple_prices', path });
  }
  if (price && offers.some(o => o.issues.includes('price_range'))) price = null;
  // disponibilité : accord de toutes les offres, sinon inconnue
  const avs = offers.map(o => o.availability).filter(Boolean);
  let stock = 'UNKNOWN';
  if (!avs.length) issues.push({ code: 'availability_missing', path });
  else { const vals = [...new Set(avs.map(a => a.value))]; if (vals.length === 1) stock = vals[0]; else issues.push({ code: 'availability_conflict', path }); }
  const delivery = deliveryOf(node, path, issues);

  const volumeValue = volume && volume.value ? volume.value : null;
  return {
    origin: 'json-ld', path,
    candidate: { title: name && name.value, brand: brand && brand.value, description: description && description.value, volume: volumeValue, gtin: gtin && gtin.value, mpn: mpn && mpn.value, sku: sku && sku.value },
    fields: { name, brand, description, gtin, mpn, sku, volume, url },
    offers,
    observation: { price, stock, url: ctx.finalUrl ? { href: ctx.finalUrl } : null },
    delivery, issues
  };
}

/* ---------------------------------------------------------------- métadonnées (secours et recoupement) */
const META_KEYS = ['og:title', 'og:type', 'og:url', 'og:site_name', 'og:description', 'product:price:amount', 'product:price:currency', 'og:price:amount', 'og:price:currency', 'product:availability', 'og:availability',
  'product:brand', 'og:brand', 'product:retailer_item_id', 'product:ean', 'og:ean', 'og:upc', 'product:upc'];
function readMeta(metaTags) {
  const out = {};
  metaTags.forEach((t, i) => {
    const key = (t.attrs.property || t.attrs.name || '').trim().toLowerCase();
    if (!META_KEYS.includes(key) || typeof t.attrs.content !== 'string') return;
    const f = field(t.attrs.content, t.attrs.content.trim() || null, SRC.meta, 'meta[' + key + ']#' + i, 'explicit');
    (out[key] = out[key] || []).push(f);
  });
  return out;
}
const metaOne = (meta, issues, ...keys) => { for (const k of keys) { const list = meta[k]; if (!list) continue; const d = [...new Set(list.map(f => f.value).filter(Boolean))]; if (d.length === 1) return list[0]; if (d.length > 1) { issues.push({ code: 'field_multiple_values', path: 'meta[' + k + ']' }); return field(list.map(f => f.raw), null, SRC.meta, 'meta[' + k + ']', 'ambiguous', ['field_multiple_values']); } } return null; };
const PRODUCT_OG_TYPES = ['product', 'product.item', 'og:product'];

function candidateFromMeta(meta, ctx) {
  const issues = [];
  const type = metaOne(meta, issues, 'og:type'), title = metaOne(meta, issues, 'og:title');
  const amount = metaOne(meta, issues, 'product:price:amount', 'og:price:amount'), cur = metaOne(meta, issues, 'product:price:currency', 'og:price:currency');
  const isProduct = (type && type.value && PRODUCT_OG_TYPES.includes(type.value.toLowerCase())) || amount;
  if (!isProduct || !title || !title.value) return null;
  const brand = metaOne(meta, issues, 'product:brand', 'og:brand'), sku = metaOne(meta, issues, 'product:retailer_item_id'), gtinF = metaOne(meta, issues, 'product:ean', 'og:ean', 'og:upc', 'product:upc');
  const gtin = gtinF && gtinF.value ? gtinOf([{ raw: gtinF.value, path: gtinF.path }], issues) : null;
  const priceInfo = amount ? parsePrice(amount.value) : { value: null, issue: 'price_missing' }, curInfo = cur ? parseCurrency(cur.value) : { value: null, issue: null };
  if (priceInfo.issue) issues.push({ code: priceInfo.issue, path: amount ? amount.path : 'meta' });
  if (curInfo.issue) issues.push({ code: curInfo.issue, path: cur ? cur.path : 'meta' });
  if (priceInfo.value !== null && !curInfo.value && !curInfo.issue) issues.push({ code: 'price_without_currency', path: amount.path });
  const price = priceInfo.value !== null && curInfo.value ? { amount: priceInfo.value, currency: curInfo.value, basis: 'displayed' } : null;
  const avRaw = metaOne(meta, issues, 'product:availability', 'og:availability'); const av = avRaw ? mapAvailability(avRaw.value) : { value: 'UNKNOWN', issue: 'availability_missing' };
  if (av.issue) issues.push({ code: av.issue, path: avRaw ? avRaw.path : 'meta' });
  return {
    origin: 'meta', path: 'meta',
    candidate: { title: title.value, brand: brand && brand.value, description: null, volume: null, gtin: gtin && gtin.value, mpn: null, sku: sku && sku.value },
    fields: { name: title, brand, description: null, gtin, mpn: null, sku, volume: null, url: null }, offers: [],
    observation: { price, stock: av.value, url: ctx.finalUrl ? { href: ctx.finalUrl } : null },
    delivery: { declaredDestinations: [], note: 'déclarations de la page, jamais une preuve de livraison vers un pays cible' }, issues
  };
}

/* Recoupe les métadonnées avec l'unique candidat JSON-LD : une divergence est signalée, jamais arbitrée. */
function crossCheck(c, meta, issues) {
  const mi = [];
  const amount = metaOne(meta, mi, 'product:price:amount', 'og:price:amount'), cur = metaOne(meta, mi, 'product:price:currency', 'og:price:currency'), av = metaOne(meta, mi, 'product:availability', 'og:availability');
  const ld = c.offers.flatMap(o => o.prices).filter(p => p.value !== null);
  if (amount && ld.length) { const pm = parsePrice(amount.value); if (pm.value !== null && !ld.some(p => p.value === pm.value)) { c.issues.push({ code: 'price_source_conflict', path: amount.path }); c.observation.price = null; } }
  if (cur && ld.length) { const cm = parseCurrency(cur.value); if (cm.value && !ld.some(p => p.currency === cm.value) && ld.some(p => p.currency)) { c.issues.push({ code: 'currency_source_conflict', path: cur.path }); c.observation.price = null; } }
  if (av) { const a = mapAvailability(av.value); if (a.value !== 'UNKNOWN' && c.observation.stock !== 'UNKNOWN' && a.value !== c.observation.stock) { c.issues.push({ code: 'availability_source_conflict', path: av.path }); c.observation.stock = 'UNKNOWN'; } }
}

/* ---------------------------------------------------------------- point d'entrée */
function mkIssue(i, extra) { const d = ISSUES[i.code] || ['warning', i.code]; return Object.assign({ code: i.code, severity: d[0], message: d[1] }, i.path ? { path: i.path } : {}, extra || {}); }

/* extract(entrée, { targetCountry }) → { schema, status, source, page, candidates, primary, issues, stats }.
   entrée : résultat de safe-fetch (ok: true requis) ou { body, contentType?, finalUrl?, requestedUrl? }. Ne lève jamais d'exception.
   status : PRODUCT_DATA (au moins un candidat) | NO_PRODUCT_DATA | UNSUPPORTED | INVALID_INPUT. `primary` : index du candidat seulement s'il est UNIQUE, sinon null (jamais de choix silencieux). */
function extract(input, opts) {
  const all = [];
  const add = (i, extra) => { all.push(mkIssue(i, extra)); };
  const empty = (status, src) => ({ schema: SCHEMA, status, source: src, page: { title: null, canonicalUrl: null, openGraph: {} }, candidates: [], primary: null, issues: all, stats: { jsonLdBlocks: 0, jsonLdInvalid: 0, productNodes: 0, metaTags: 0, chars: 0 } });
  try {
    const inp = isObj(input) ? input : null;
    const source = { requestedUrl: inp && typeof inp.requestedUrl === 'string' ? inp.requestedUrl : null, finalUrl: inp && typeof inp.finalUrl === 'string' ? inp.finalUrl : null, contentType: inp && typeof inp.contentType === 'string' ? inp.contentType : null };
    if (!inp || typeof inp.body !== 'string' || inp.ok === false) { add({ code: 'input_invalid' }); return empty('INVALID_INPUT', source); }
    if (inp.body.length > LIMITS.maxChars) { add({ code: 'input_too_large' }); return empty('INVALID_INPUT', source); }
    const mime = source.contentType ? source.contentType.split(';')[0].trim().toLowerCase() : null;
    const isJson = mime === 'application/json' || mime === 'application/ld+json';
    const isHtml = mime === 'text/html' || mime === 'application/xhtml+xml' || mime === null;
    if (!isJson && !isHtml) { add({ code: 'content_type_unsupported' }, { detail: mime }); return empty('UNSUPPORTED', source); }
    if (mime === null) add({ code: 'content_type_unknown' });
    let base = null; try { base = source.finalUrl ? new URL(source.finalUrl).href : null; } catch (e) { base = null; }
    const ctx = { base, finalUrl: source.finalUrl };
    const body = inp.body, state = { malformed: false, tagLimit: false, traversal: false };
    const stats = { jsonLdBlocks: 0, jsonLdInvalid: 0, productNodes: 0, metaTags: 0, chars: body.length };

    // --- JSON-LD (ou JSON brut)
    const found = [];
    const blocks = [];
    let tok = { scripts: [], excluded: [] };
    if (isJson) blocks.push({ text: body, path: 'json', type: mime });
    else {
      tok = tokenize(body, state);
      for (const s of tok.scripts) { const t = (s.attrs.type || '').toLowerCase(); if (t.includes('ld+json')) { if (!s.terminated) add({ code: 'jsonld_unterminated' }); blocks.push({ text: s.content, path: 'jsonld[' + blocks.length + ']', type: t }); } }
    }
    if (!isJson && !blocks.length) add({ code: 'jsonld_none' });
    if (blocks.length > 1) add({ code: 'jsonld_multiple_blocks' });
    stats.jsonLdBlocks = blocks.length;
    for (const b of blocks.slice(0, LIMITS.maxJsonLdBlocks)) {
      if (b.text.length > LIMITS.maxJsonLdChars) { stats.jsonLdInvalid++; add({ code: 'jsonld_invalid', path: b.path }, { detail: 'trop volumineux' }); continue; }
      let parsed;
      try { parsed = JSON.parse(b.text.replace(/^﻿/, '').trim()); } catch (e) { stats.jsonLdInvalid++; add({ code: 'jsonld_invalid', path: b.path }, { detail: clip(String(e && e.message), 120) }); continue; }
      const localIssues = [];
      const prods = walkProducts(parsed, b.path, localIssues, state);
      localIssues.forEach(i => add(i));
      if (!prods.length) { if (isJson) add({ code: 'json_not_jsonld' }, { path: b.path }); continue; }
      found.push(...prods);
    }
    if (blocks.length && !found.length && stats.jsonLdInvalid < blocks.length && !isJson) add({ code: 'jsonld_no_product' });
    stats.productNodes = found.length;

    // --- métadonnées HTML
    let page = { title: null, canonicalUrl: null, openGraph: {} };
    let meta = {};
    if (!isJson) {
      const metaTags = findTags(body, 'meta', false, state, tok.excluded), links = findTags(body, 'link', false, state, tok.excluded), titles = findTags(body, 'title', true, state, tok.excluded), bases = findTags(body, 'base', false, state, tok.excluded);
      stats.metaTags = metaTags.length;
      meta = readMeta(metaTags);
      const tl = titles.length ? decodeEntities(titles[0].content).replace(/\s+/g, ' ').trim() : '';
      if (tl) page.title = field(titles[0].content, clip(tl, 300), SRC.title, 'title', 'explicit');
      const ogIssues = []; for (const k of ['og:title', 'og:type', 'og:url', 'og:site_name', 'og:description']) { const f = metaOne(meta, ogIssues, k); if (f) page.openGraph[k] = f; } ogIssues.forEach(i => add(i));
      if (bases.length) add({ code: 'base_tag_present' });
      const canon = links.filter(l => typeof l.attrs.rel === 'string' && l.attrs.rel.toLowerCase().split(/\s+/).includes('canonical') && typeof l.attrs.href === 'string');
      const distinct = [...new Set(canon.map(l => l.attrs.href.trim()).filter(Boolean))];
      if (!distinct.length) add({ code: 'canonical_missing' });
      else if (distinct.length > 1) { add({ code: 'field_multiple_values', path: 'link[rel=canonical]' }); page.canonicalUrl = field(distinct, null, SRC.link, 'link[rel=canonical]', 'ambiguous', ['field_multiple_values']); }
      else {
        let abs = null; try { abs = new URL(distinct[0], base || undefined).href; } catch (e) { abs = null; }
        if (!abs) { add({ code: 'canonical_invalid', path: 'link[rel=canonical]' }); page.canonicalUrl = field(distinct[0], null, SRC.link, 'link[rel=canonical]', 'ambiguous', ['canonical_invalid']); }
        else {
          page.canonicalUrl = field(distinct[0], abs, SRC.link, 'link[rel=canonical]', abs === distinct[0] ? 'explicit' : 'normalized');
          if (base) { try { if (new URL(abs).host !== new URL(base).host) add({ code: 'canonical_cross_host', path: 'link[rel=canonical]' }); else if (abs !== base) add({ code: 'canonical_differs_from_final', path: 'link[rel=canonical]' }); } catch (e) { /* adresse déjà validée */ } }
        }
      }
      if (state.malformed) add({ code: 'html_malformed' });
      if (state.tagLimit) add({ code: 'html_tag_limit' });
    }

    // --- candidats
    let candidates = found.slice(0, LIMITS.maxCandidates).map(f => candidateFromProduct(f.node, f.path, ctx));
    if (found.length > LIMITS.maxCandidates) add({ code: 'too_many_candidates' });
    if (!candidates.length && !isJson) { const m = candidateFromMeta(meta, ctx); if (m) candidates = [m]; }
    if (candidates.length === 1 && candidates[0].origin === 'json-ld' && !isJson) crossCheck(candidates[0], meta, all);
    candidates.forEach((c, i) => { c.index = i; c.issues = c.issues.map(i2 => mkIssue(i2)); c.issues.forEach(i2 => { if (!all.some(a => a.code === i2.code && a.path === i2.path)) all.push(i2); }); });
    if (candidates.length > 1) add({ code: 'multiple_products' });
    if (!candidates.length) add({ code: 'no_product_data' });
    const sorted = all.slice().sort((a, b) => ['conflict', 'error', 'warning', 'info'].indexOf(a.severity) - ['conflict', 'error', 'warning', 'info'].indexOf(b.severity));
    all.length = 0; all.push(...sorted);
    return { schema: SCHEMA, status: candidates.length ? 'PRODUCT_DATA' : 'NO_PRODUCT_DATA', source, page, candidates, primary: candidates.length === 1 ? 0 : null, issues: all, stats };
  } catch (e) {
    all.push(mkIssue({ code: 'input_invalid' }, { detail: 'erreur interne' }));
    return empty('INVALID_INPUT', { requestedUrl: null, finalUrl: null, contentType: null });
  }
}

module.exports = { SCHEMA, LIMITS, ISSUES, UNIT_CODES, extract, parsePrice, parseCurrency, mapAvailability, decodeEntities, findTags, tokenize };
