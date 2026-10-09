'use strict';
/* Phase 3B-4 : CONFIDENCE (tools/market/confidence.js). « Quelle est la fiabilité de ce que nous avons trouvé ? »
   Données : test/fixtures/market-observation-fixture.js (valeurs d'essai explicites, aucune donnée de production). Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../tools/market/confidence.js');
const O = require('../tools/market/observation.js');
const F = require('./fixtures/market-observation-fixture.js');

const ROOT = path.join(__dirname, '..');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const read = f => fs.readFileSync(path.join(ROOT, 'tools/market', f), 'utf8');
const assess = (obs, opts) => C.assess(obs, Object.assign({ now: F.NOW }, opts));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const RANK = { REJECTED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };

test('MC-1 24 cas minimum : niveau global, dimensions, plafonds, contradictions', () => {
  assert.ok(F.CONFIDENCE_CASES.length >= 24);
  for (const k of F.CONFIDENCE_CASES) {
    const r = assess(k.obs);
    assert.equal(r.level, k.level, k.id + ' ' + k.title + ' : niveau (' + r.reasonCodes.join(',') + ')');
    for (const [d, lv] of Object.entries(k.dims || {})) assert.equal(r.dimensions[d].level, lv, k.id + ' : dimension ' + d);
    for (const c of k.caps || []) assert.ok(r.caps.includes(c), k.id + ' : plafond ' + c + ' (' + r.caps.join(',') + ')');
    for (const c of k.contradictions || []) assert.ok(r.contradictions.includes(c), k.id + ' : contradiction ' + c);
    for (const c of k.codes || []) assert.ok(r.reasonCodes.includes(c), k.id + ' : code ' + c);
    for (const w of k.warnings || []) assert.ok(r.warningCodes.includes(w), k.id + ' : avertissement ' + w);
    if (k.target !== undefined) assert.equal(r.targetProduct, k.target, k.id + ' : produit visé');
    if (k.identity !== undefined) assert.equal(r.identity, k.identity, k.id);
    if (k.stockState) assert.equal(r.dimensions.stock.state, k.stockState, k.id);
  }
});

test('MC-2 forme de la sortie : explicable, sérialisable, prête pour un mode ombre', () => {
  for (const k of F.CONFIDENCE_CASES) {
    const r = assess(k.obs);
    assert.deepEqual(Object.keys(r.dimensions), C.DIMENSIONS);
    for (const d of Object.values(r.dimensions)) { assert.ok(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN', 'REJECTED'].includes(d.level)); assert.ok(C.REASONS[d.code], k.id + ' : code de dimension connu ' + d.code); }
    assert.ok(C.LEVELS.includes(r.level));
    assert.equal(r.reasons.length, r.reasonCodes.length); assert.equal(r.warnings.length, r.warningCodes.length);
    for (const c of r.reasonCodes.concat(r.warningCodes)) assert.ok(C.REASONS[c], k.id + ' : code connu ' + c);
    assert.ok(r.reasonCodes.length > 0 && r.reasons.every(t => typeof t === 'string' && t.length > 0));
    assert.equal(r.schema, 'confidence/1');
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r, k.id + ' : sortie sérialisable sans perte (aucun undefined, aucune fonction)');
    assert.deepEqual(assess(k.obs), r, k.id + ' : déterministe');
  }
});

test('MC-3 règle critique produit : NO_MATCH jamais au-dessus de REJECTED ; VARIANT et POSSIBLE jamais HIGH ni offre du produit exact ; seuls EXACT et STRONG peuvent atteindre HIGH', () => {
  const sellers = [{}, { registered: true, verified: true }, { name: undefined, id: undefined }];
  const sources = [F.BASE.source, { kind: 'team_provided' }, { kind: 'snippet' }, undefined];
  const dates = [F.DAYS.fresh, F.DAYS.stale, undefined];
  const prices = [F.BASE.price, undefined, { amount: 5 }];
  const stocks = ['in_stock', 'out_of_stock', undefined];
  const urls = [F.BASE.url, undefined, { href: 'https://alpha.invalid/search?q=x' }];
  const countries = [F.country('BJ'), F.country('BJ', 'currency'), undefined];
  let n = 0;
  for (const cls of ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH'])
    for (const sl of sellers) for (const src of sources) for (const dt of dates) for (const pr of prices) for (const st of stocks) for (const ur of urls) for (const co of countries) {
      const obs = F.make({ match: F.matched(cls), seller: F.sellerOf(Object.assign({}, sl, { country: co })), source: src, checkedAt: dt, price: pr, stock: st, url: ur });
      const r = assess(obs); n++;
      const at = cls + ' ' + JSON.stringify([sl, src && src.kind, dt, pr, st, ur && ur.href, co && co.basis]);
      if (cls === 'NO_MATCH') { assert.equal(r.level, 'REJECTED', at); assert.equal(r.targetProduct, false, at); }
      if (cls === 'POSSIBLE_MATCH' || cls === 'VARIANT_MATCH') { assert.ok(RANK[r.level] <= RANK.LOW, 'jamais au-dessus de LOW : ' + at); assert.equal(r.targetProduct, false, at); }
      if (r.level === 'HIGH') assert.ok(cls === 'EXACT_MATCH' || cls === 'STRONG_MATCH', 'HIGH exige une correspondance EXACT ou STRONG : ' + at);
      assert.ok(RANK[r.level] <= RANK[r.dimensions.product.level] || r.dimensions.product.level === 'UNKNOWN', 'le niveau global ne dépasse jamais le niveau du produit : ' + at);
    }
  assert.ok(n > 5000);
});

test('MC-4 EXACT_MATCH n\'est pas automatiquement HIGH : chaque faiblesse l\'abaisse, avec un plafond nommé', () => {
  const weak = [
    ['source faible', { source: { kind: 'search_engine' } }, 'LOW', 'CAP_SOURCE_WEAK'], ['source absente', { source: undefined }, 'LOW', 'CAP_SOURCE_WEAK'],
    ['source non rouverte', { source: { kind: 'seller_page', reopened: false } }, 'MEDIUM', 'CAP_SOURCE_NOT_FIRST_HAND'], ['vendeur inconnu', { seller: { country: F.country('BJ') } }, 'MEDIUM', 'CAP_SELLER_UNKNOWN'],
    ['relevé ancien', { checkedAt: F.DAYS.stale }, 'MEDIUM', 'CAP_FRESHNESS'], ['sans date', { checkedAt: undefined }, 'MEDIUM', 'CAP_FRESHNESS'], ['prix absent', { price: undefined }, 'MEDIUM', 'CAP_INCOMPLETE'],
    ['stock inconnu', { stock: undefined }, 'MEDIUM', 'CAP_INCOMPLETE'], ['lien absent', { url: undefined }, 'MEDIUM', 'CAP_INCOMPLETE'], ['lien de catégorie', { url: { href: 'https://alpha.invalid/category/soins', kind: 'product_page' } }, 'MEDIUM', 'CAP_INCOMPLETE']
  ];
  assert.equal(assess(F.make({})).level, 'HIGH');
  for (const [name, patch, level, cap] of weak) { const r = assess(F.make(patch)); assert.equal(r.level, level, name); assert.ok(r.caps.includes(cap), name + ' : ' + r.caps.join(',')); }
  // sans date de référence fournie, la fraîcheur est inconnue : jamais deviné
  const noNow = C.assess(F.make({}), {}); assert.equal(noNow.dimensions.freshness.level, 'UNKNOWN'); assert.notEqual(noNow.level, 'HIGH');
});

test('MC-5 un vendeur excellent ne rachète pas une identité ambiguë (POSSIBLE, VARIANT)', () => {
  const best = { registered: true, verified: true };
  for (const cls of ['POSSIBLE_MATCH', 'VARIANT_MATCH']) {
    const r = assess(F.make({ match: F.matched(cls), seller: F.sellerOf(best) }));
    assert.equal(r.dimensions.seller.level, 'HIGH'); assert.equal(r.dimensions.stock.level, 'HIGH'); assert.equal(r.dimensions.source.level, 'HIGH');
    assert.equal(r.level, 'LOW', cls); assert.equal(r.targetProduct, false); assert.ok(r.caps.includes('CAP_PRODUCT_NOT_TARGET'));
  }
});

test('MC-6 le marché ne se confond pas avec le produit : pays du vendeur inconnu ou faux, le niveau ne bouge pas', () => {
  for (const cls of ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH']) {
    const levels = new Set();
    for (const co of [undefined, F.country('BJ'), F.country('FR'), F.country('BJ', 'currency'), F.country('XX'), F.country('TG', 'registry')]) levels.add(assess(F.make({ match: F.matched(cls), seller: F.sellerOf({ country: co }) })).level);
    assert.equal(levels.size, 1, cls + ' : le pays du vendeur ne change jamais le niveau (' + [...levels] + ')');
  }
  const r = assess(F.withCountry(null)); assert.equal(r.level, 'HIGH'); assert.equal(r.dimensions.product.level, 'HIGH'); assert.equal(r.dimensions.market.level, 'UNKNOWN');
  assert.ok(r.warningCodes.includes('W_MARKET_UNKNOWN'));
  for (const [basis, lv] of [['seller_page', 'HIGH'], ['registry', 'HIGH'], ['team_provided', 'HIGH'], ['catalog_offer', 'HIGH'], ['currency', 'LOW'], ['domain', 'LOW'], ['language', 'LOW'], ['phone', 'LOW'], ['inferred', 'LOW'], ['n\'importe quoi', 'LOW']])
    assert.equal(assess(F.withCountry('BJ', basis)).dimensions.market.level, lv, basis);
  assert.equal(assess(F.withCountry('BJ', 'seller_page', null)).dimensions.market.level, 'LOW', 'base explicite sans source : non établi');
});

test('MC-7 prix, stock, lien : absent n\'est pas invalide ; jamais déduits ; une recherche n\'est pas une fiche', () => {
  const price = p => assess(F.make({ price: p })).dimensions.price;
  assert.deepEqual([price(undefined).level, price(undefined).code], ['UNKNOWN', 'PRICE_ABSENT']);
  assert.equal(price({ amount: 12700, currency: 'XOF' }).level, 'HIGH');
  for (const bad of [{ amount: 12700 }, { currency: 'XOF' }, { amount: -5, currency: 'XOF' }, { amount: '12700', currency: 'XOF' }, { amount: 12700, currency: 'franc' }, 'gratuit', 12700]) assert.equal(price(bad).level, 'LOW', JSON.stringify(bad));
  for (const b of ['estimated', 'converted']) assert.equal(price({ amount: 5, currency: 'XOF', basis: b }).code, 'PRICE_NOT_DISPLAYED', b);
  const stock = s => assess(F.make({ stock: s })).dimensions.stock;
  for (const [v, st] of [['in_stock', 'IN_STOCK'], ['IN_STOCK', 'IN_STOCK'], ['In Stock', 'IN_STOCK'], ['out_of_stock', 'OUT_OF_STOCK'], ['out-of-stock', 'OUT_OF_STOCK'], ['coming_soon', 'COMING_SOON'], ['unknown', 'UNKNOWN'], [undefined, 'UNKNOWN'], [null, 'UNKNOWN'], ['available', 'UNKNOWN'], ['limited', 'UNKNOWN'], [1, 'UNKNOWN'], [true, 'UNKNOWN']])
    assert.equal(stock(v).state, st, String(v));
  assert.equal(assess(F.make({ stock: 'available' })).issues.includes('stock_value_invalid'), true);
  const url = u => assess(F.make({ url: u })).dimensions.url;
  for (const [href, kind] of [['https://a.invalid/search?q=x', 'search'], ['https://a.invalid/recherche/serum', 'search'], ['https://a.invalid/catalogsearch/result/?q=ha', 'search'], ['https://a.invalid/collections/soins', 'category'], ['https://a.invalid/category/serums', 'category'], ['https://a.invalid/', 'seller'], ['https://a.invalid/collections/soins/products/serum-ha', 'product_page'], ['https://a.invalid/products/serum-ha', 'product_page']])
    assert.equal(url({ href, kind: 'product_page' }).kind, kind, href);
  assert.equal(url('https://a.invalid/serum-ha').kind, 'unclassified', 'une adresse non typée n\'est pas une fiche produit');
  assert.equal(url('https://a.invalid/serum-ha').level, 'UNKNOWN');
  assert.equal(url({ href: 'https://a.invalid/serum-ha', kind: 'product_page' }).level, 'HIGH', 'déclarée fiche produit et rien ne la contredit');
  assert.equal(url('pas une adresse').level, 'UNKNOWN'); assert.equal(url(undefined).code, 'URL_ABSENT');
  assert.equal(url({ href: 'https://a.invalid/search?q=x', kind: 'product_page' }).level, 'LOW', 'la recherche l\'emporte sur la déclaration');
});

test('MC-8 source : hiérarchie justifiée (page rouverte > relevé de l\'équipe / place de marché rouverte > le reste) ; une page non rouverte ne vaut pas une page rouverte', () => {
  const lv = s => assess(F.make({ source: s })).dimensions.source.level;
  assert.equal(lv({ kind: 'seller_page', reopened: true }), 'HIGH'); assert.equal(lv({ kind: 'seller_page', reopened: false }), 'MEDIUM'); assert.equal(lv({ kind: 'seller_page' }), 'MEDIUM');
  assert.equal(lv({ kind: 'team_provided' }), 'MEDIUM'); assert.equal(lv({ kind: 'marketplace_listing', reopened: true }), 'MEDIUM'); assert.equal(lv({ kind: 'marketplace_listing' }), 'LOW');
  for (const k of ['manufacturer_page', 'search_engine', 'snippet', 'secondary']) assert.equal(lv({ kind: k, reopened: true }), 'LOW', k + ' : même rouverte, ne prouve pas une vente');
  assert.equal(lv({ kind: 'blog' }), 'UNKNOWN', 'type inconnu'); assert.equal(lv(undefined), 'UNKNOWN'); assert.equal(lv('seller_page'), 'UNKNOWN');
});

test('MC-9 fraîcheur : jamais supprimée ; la date de référence est fournie ; bornes déclarées', () => {
  const f = (d, now, th) => C.assess(F.make({ checkedAt: d }), { now, freshness: th }).dimensions.freshness;
  assert.equal(f('2026-10-08', '2026-10-08').level, 'HIGH'); assert.equal(f('2026-09-08', '2026-10-08').level, 'HIGH'); assert.equal(f('2026-09-07', '2026-10-08').level, 'MEDIUM');
  assert.equal(f('2026-07-10', '2026-10-08').level, 'MEDIUM'); assert.equal(f('2026-07-09', '2026-10-08').level, 'LOW');
  assert.equal(f('2026-07-09', '2026-10-08').ageDays, 91); assert.equal(f('2025-01-01', '2026-10-08').code, 'FRESHNESS_STALE');
  assert.equal(f('2026-10-09', '2026-10-08').code, 'FRESHNESS_FUTURE_DATE'); assert.equal(f('2026-02-30', '2026-10-08').code, 'FRESHNESS_UNKNOWN'); assert.equal(f('hier', '2026-10-08').code, 'FRESHNESS_UNKNOWN');
  assert.equal(f('2026-10-01T10:00:00Z', '2026-10-08T23:00:00Z').level, 'HIGH', 'horodatage ISO accepté');
  assert.equal(f('2026-09-20', '2026-10-08', { fresh: 10, recent: 20 }).level, 'MEDIUM', 'bornes réglables');
  const stale = assess(F.make({ checkedAt: F.DAYS.stale })); assert.equal(stale.dimensions.stock.state, 'IN_STOCK', 'une observation ancienne garde son contenu'); assert.equal(stale.dimensions.price.level, 'HIGH');
});

test('MC-10 vendeur : inconnu n\'est pas mauvais ; nouveau ≠ validé', () => {
  const s = p => assess(F.make({ seller: F.sellerOf(p) })).dimensions.seller;
  assert.deepEqual([s({ name: undefined }).level, s({ name: undefined }).code], ['UNKNOWN', 'SELLER_UNKNOWN']);
  assert.equal(s({}).code, 'SELLER_IDENTIFIED'); assert.equal(s({ registered: true }).code, 'SELLER_REGISTERED'); assert.equal(s({ registered: true, verified: true }).code, 'SELLER_REGISTERED_VERIFIED');
  assert.equal(s({ verified: true }).code, 'SELLER_IDENTIFIED', 'vérifié sans être enregistré : non pris en compte');
  assert.ok(RANK.HIGH > RANK.MEDIUM);
  assert.notEqual(assess(F.make({ seller: { country: F.country('BJ') } })).level, 'LOW', 'un vendeur inconnu ne fait pas tomber sous MEDIUM');
  assert.equal(assess(F.make({ seller: F.sellerOf({ id: 'v-12', name: undefined }) })).dimensions.seller.level, 'MEDIUM', 'identifié par son identifiant');
});

test('MC-11 stock : IN_STOCK, OUT_OF_STOCK, UNKNOWN ; la rupture est une information fiable, jamais effacée', () => {
  const out = assess(F.make({ stock: 'out_of_stock' }));
  assert.equal(out.level, 'HIGH', 'une rupture explicite n\'abaisse pas la fiabilité'); assert.ok(out.warningCodes.includes('W_STOCK_OUT_OF_STOCK'));
  assert.equal(assess(F.make({ stock: undefined })).level, 'MEDIUM');
});

test('MC-12 contradictions : elles abaissent à LOW, ne sont jamais corrigées', () => {
  const cases = [
    F.foreign('TG', { shipsTo: [F.delivery('BJ', true), F.delivery('BJ', false)] }), F.make({ checkedAt: F.DAYS.future }), F.withSeller({ country: [F.country('BJ'), F.country('FR')] })
  ];
  for (const obs of cases) { const r = assess(obs); assert.equal(r.level, 'LOW'); assert.ok(r.caps.includes('CAP_CONTRADICTION')); assert.ok(r.contradictions.length > 0); assert.ok(r.reasonCodes.includes('CAP_CONTRADICTION')); }
  assert.equal(assess(F.foreign('TG', { shipsTo: [F.delivery('BJ', true), F.delivery('NG', false)] })).contradictions.length, 0, 'pays différents : pas de contradiction');
  assert.deepEqual(assess(F.make({})).contradictions, []);
});

test('MC-13 le score est auxiliaire : calculé après le niveau, jamais lu par la décision, aucun seuil', () => {
  const src = strip(read('confidence.js'));
  const decision = src.slice(src.indexOf('function assess('), src.indexOf('/* AUXILIAIRE') > 0 ? src.length : src.length);
  const before = src.slice(0, src.indexOf('const dimensions = Object.fromEntries'));
  assert.doesNotMatch(before, /\bscore\b/i, 'rien de ce qui précède le calcul du score ne le lit');
  assert.doesNotMatch(src, /\b0?\.\d+\s*\*|\*\s*0?\.\d+|threshold|poids|weight|coefficient/i, 'aucune pondération');
  assert.doesNotMatch(src, /[<>]=?\s*0\.\d+/, 'aucun seuil de score');
  assert.ok(decision.length > 500);
  // deux observations de même niveau et de scores différents ; deux scores proches et de niveaux différents : le score n'est donc pas la décision
  const a = assess(F.make({ price: undefined })), b = assess(F.make({ price: undefined, url: undefined, stock: undefined }));
  assert.equal(a.level, b.level); assert.ok(a.score > b.score);
  const c = assess(F.make({ match: F.matched('POSSIBLE_MATCH') })), d = assess(F.make({ match: F.matched('STRONG_MATCH'), checkedAt: F.DAYS.stale }));
  assert.equal(c.level, 'LOW'); assert.equal(d.level, 'MEDIUM');
  for (const k of F.CONFIDENCE_CASES) { const r = assess(k.obs); assert.ok(r.score >= 0 && r.score <= 1); if (r.level === 'REJECTED') assert.equal(r.score, 0); }
});

test('MC-14 pureté : aucune mutation de l\'entrée, aucun réseau, aucun fichier, aucune horloge ; entrées hostiles sans exception', () => {
  for (const k of F.CONFIDENCE_CASES) { const frozen = deepFreeze(F.clone(k.obs)); assert.doesNotThrow(() => assess(frozen), k.id); assert.deepEqual(frozen, k.obs, k.id + ' : entrée intacte'); }
  for (const f of ['confidence.js', 'observation.js']) {
    const src = strip(read(f));
    assert.doesNotMatch(src, /require\(['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|worker_threads|vm|os)['"]\)/, f); assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|process\.|Date\.now|new Date\(\s*\)|Math\.random|writeFile|console\./, f);
  }
  assert.deepEqual([...strip(read('confidence.js')).matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]), ['./observation.js'], 'confidence ne charge ni le catalogue, ni la classification, ni le matcher');
  assert.doesNotMatch(strip(read('confidence.js')), /availabilityStatus|marketView|classifyMarket/);
  const hostile = [undefined, null, 0, 'x', [], {}, { match: 5 }, { match: { matchClass: 7 } }, { seller: 'x' }, { seller: { country: 5 } }, { seller: { country: [null, 3] } }, { price: [] }, { url: 9 }, { url: { href: {} } }, { source: 'x' }, { shipsTo: 'x' }, { shipsTo: [null, 1, {}] }, { checkedAt: {} }, { stock: {} }];
  for (const h of hostile) { let r; assert.doesNotThrow(() => { r = assess(h); }, JSON.stringify(h)); assert.ok(C.LEVELS.includes(r.level)); assert.notEqual(r.level, 'HIGH', JSON.stringify(h)); }
  assert.doesNotThrow(() => C.assess(undefined, undefined));
});

test('MC-15 indépendance : la confiance ne lit ni le statut marché ni le pays cible ; le matching n\'est lu que par sa CLASSE', () => {
  const src = strip(read('confidence.js'));
  assert.doesNotMatch(src, /targetCountry|\bLOCAL\b|\bREGIONAL\b|\bIMPORT\b|\bUNAVAILABLE\b/, 'aucune notion de statut marché dans la confiance');
  // changer les SIGNAUX du matcher sans changer la classe ne change rien
  const a = assess(F.make({ match: { matchClass: 'EXACT_MATCH', signals: { brand: 'MATCH' } } })), b = assess(F.make({ match: { matchClass: 'EXACT_MATCH', signals: { brand: 'UNKNOWN' } } }));
  assert.equal(a.level, b.level);
  assert.equal(assess(F.make({ shipsTo: [F.delivery('BJ', true)] })).level, assess(F.make({ shipsTo: [] })).level, 'la livraison ne change pas la fiabilité');
  assert.equal(assess(F.make({ price: { amount: 1, currency: 'XOF' } })).level, assess(F.make({ price: { amount: 999999, currency: 'XOF' } })).level, 'la valeur du prix ne change pas la fiabilité');
});

test('MC-16 croissance : aucune dépendance à un nombre de vendeurs, de produits ou d\'offres ; nouveaux vendeurs, pays, sources', () => {
  const sellers = Array.from({ length: 200 }, (_, i) => ({ name: 'Vendeur essai ' + i, id: 'v-' + i, registered: i % 3 === 0, verified: i % 6 === 0, country: F.country(['BJ', 'TG', 'CI', 'NG', 'FR', 'FR', 'BE', 'SN'][i % 8]) }));
  for (const s of sellers) { const r = assess(F.make({ seller: s })); assert.ok(['HIGH'].includes(r.level), s.name); assert.equal(r.dimensions.seller.level, s.registered && s.verified ? 'HIGH' : 'MEDIUM'); }
  // nouveau type de vendeur, source inconnue : jamais d'exception, jamais HIGH
  const r = assess(F.make({ seller: F.sellerOf({ type: 'nouveau_type' }), source: { kind: 'nouveau_type' } }));
  assert.ok(r.issues.includes('seller_type_invalid') && r.issues.includes('source_kind_unknown')); assert.notEqual(r.level, 'HIGH');
});

test('MC-17 pont catalogue : une offre du catalogue se lit comme une observation sans que le catalogue soit modifié', () => {
  const CAT = require('../js/engine/data/catalog.js'), before = JSON.stringify(CAT.PRODUCTS);
  let seen = 0;
  for (const p of CAT.PRODUCTS) {
    const { observations } = O.fromCatalogProduct(p);
    for (const obs of observations) { const r = assess(obs); seen++; assert.equal(r.identity, 'TARGET'); assert.equal(r.dimensions.product.code, 'PRODUCT_ASSIGNED_BY_CATALOG'); assert.notEqual(r.level, 'HIGH', 'une offre de catalogue n\'est jamais HIGH : produit non vérifié par le matcher, source secondaire'); }
  }
  assert.equal(JSON.stringify(CAT.PRODUCTS), before, 'catalogue intact');
  assert.ok(seen >= 0);
});

test('MC-18 STRONG_MATCH peut atteindre HIGH quand toutes les autres conditions sont réunies ; chaque condition manquante l\'abaisse', () => {
  const M = require('../tools/market/match.js'), MF = require('./fixtures/market-matching-fixture.js'), fs2 = require('node:fs');
  const IDENT = JSON.parse(fs2.readFileSync(path.join(ROOT, 'data/market/identities.json'), 'utf8'));
  // 1. une VRAIE classe STRONG produite par le matcher, pas une classe simulée
  const strongCase = MF.CASES.find(k => k.family === 'STRONG' && k.expected === 'STRONG_MATCH');
  const m = M.matchCandidate(strongCase.candidate, MF.applyPatch(IDENT.products[strongCase.productId], strongCase.patch), { productId: strongCase.productId });
  assert.equal(m.matchClass, 'STRONG_MATCH');
  // 2. vendeur nommé, première main, fiche produit, prix explicite, stock explicite, relevé ≤ 30 jours, aucune contradiction, preuve de marché suffisante
  const full = F.make({ match: m });
  const r = assess(full);
  assert.equal(r.level, 'HIGH'); assert.equal(r.dimensions.product.code, 'PRODUCT_STRONG_MATCH'); assert.equal(r.dimensions.product.level, 'HIGH');
  assert.deepEqual([r.dimensions.seller.level, r.dimensions.source.level, r.dimensions.url.level, r.dimensions.price.level, r.dimensions.stock.level, r.dimensions.freshness.level, r.dimensions.market.level], ['MEDIUM', 'HIGH', 'HIGH', 'HIGH', 'HIGH', 'HIGH', 'HIGH']);
  assert.ok(r.dimensions.freshness.ageDays <= 30); assert.deepEqual(r.contradictions, []); assert.deepEqual(r.caps, []); assert.equal(r.targetProduct, true); assert.ok(r.reasonCodes.includes('ALL_REQUIREMENTS_MET'));
  // 3. le niveau est le même que pour EXACT, la différence reste lisible dans le code produit
  const exact = assess(F.make({ match: F.matched('EXACT_MATCH') })); assert.equal(exact.level, r.level); assert.notEqual(exact.dimensions.product.code, r.dimensions.product.code);
  // 4. chaque condition retirée abaisse le niveau (STRONG n'est pas un laissez-passer)
  const drops = [['vendeur inconnu', { seller: { country: F.country('BJ') } }], ['source non rouverte', { source: { kind: 'seller_page', reopened: false } }], ['source faible', { source: { kind: 'snippet' } }], ['lien absent', { url: undefined }],
    ['prix absent', { price: undefined }], ['stock inconnu', { stock: undefined }], ['relevé ancien', { checkedAt: F.DAYS.stale }], ['contradiction', { checkedAt: F.DAYS.future }]];
  for (const [name, patch] of drops) assert.notEqual(assess(F.make(Object.assign({ match: m }, patch))).level, 'HIGH', name);
  // 5. sans preuve de marché, le produit reste HIGH (la preuve de marché relève de classify.js) : une dimension d'information, pas un plafond
  assert.equal(assess(F.make({ match: m, seller: F.sellerOf({ country: undefined }) })).level, 'HIGH');
  // 6. et la porte reste fermée pour POSSIBLE / VARIANT / NO_MATCH, même avec le vendeur parfait
  for (const cls of ['POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH']) assert.notEqual(assess(F.make({ match: F.matched(cls), seller: F.sellerOf({ registered: true, verified: true }) })).level, 'HIGH', cls);
});

test('MC-19 un résultat inexploitable du matcher (valid: false, aucune classe) n\'est ni un rejet ni une identité : identité inconnue, niveau LOW', () => {
  const bad = { valid: false, matchClass: null, error: { code: 'candidate_invalid' } };
  const r = assess(F.make({ match: bad })); assert.equal(r.level, 'LOW'); assert.equal(r.identity, null); assert.equal(r.dimensions.product.level, 'UNKNOWN'); assert.ok(r.issues.includes('match_invalid_input'));
  assert.notEqual(r.level, 'REJECTED', 'REJECTED est réservé à une contradiction (NO_MATCH)');
  assert.equal(assess(F.make({ match: { valid: false, matchClass: 'EXACT_MATCH' } })).level, 'LOW', 'même accompagné d\'une classe, un résultat inexploitable est ignoré');
});

test('MC-20 une classe portée par un résultat inexploitable (valid: false) n\'est jamais lue : identité inconnue, aucune dimension produit fondée dessus', () => {
  const forged = cls => ({ valid: false, matchClass: cls, error: { code: 'candidate_invalid' } });
  for (const cls of ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH']) {
    const obs = F.make({ match: forged(cls) });          // par ailleurs une fiche complète, de première main, fraîche : tout le reste plaiderait pour HIGH
    const n = O.normalizeObservation(obs);
    assert.equal(n.observation.matchClass, null, cls + ' : la classe n\'est pas recopiée'); assert.equal(n.observation.identity, null); assert.ok(n.issues.includes('match_invalid_input'));
    const r = assess(obs);
    assert.equal(r.matchClass, null, cls); assert.equal(r.identity, null); assert.equal(r.targetProduct, false);
    assert.deepEqual([r.dimensions.product.level, r.dimensions.product.code], ['UNKNOWN', 'PRODUCT_NOT_MATCHED'], cls + ' : aucune dimension produit fondée sur la classe invalide');
    assert.equal(r.level, 'LOW', cls); assert.ok(r.caps.includes('CAP_PRODUCT_NOT_TARGET')); assert.notEqual(r.level, 'REJECTED');
    assert.ok(!r.reasonCodes.some(c => /^PRODUCT_(EXACT|STRONG|AMBIGUOUS|IS_VARIANT|REJECTED)/.test(c)), cls + ' : ' + r.reasonCodes.join(','));
    assert.equal(r.dimensions.price.level, 'LOW', 'le prix n\'est pas celui d\'un produit visé');
  }
  // même chose avec un rattachement catalogue : un résultat inexploitable l'emporte, l'identité reste inconnue
  assert.equal(assess(F.make({ match: forged('EXACT_MATCH'), assignedByCatalog: true })).identity, null);
  // aucune régression sur les résultats valides : EXACT et STRONG restent HIGH si toutes les conditions sont réunies, avec ou sans le drapeau `valid: true` du vrai matcher
  for (const cls of ['EXACT_MATCH', 'STRONG_MATCH']) for (const extra of [{}, { valid: true }]) {
    const r = assess(F.make({ match: Object.assign(F.matched(cls), extra) }));
    assert.equal(r.level, 'HIGH', cls); assert.equal(r.identity, 'TARGET'); assert.equal(r.matchClass, cls); assert.equal(r.dimensions.product.level, 'HIGH');
  }
  for (const k of F.CONFIDENCE_CASES) assert.equal(assess(k.obs).level, k.level, k.id + ' : résultats des cas valides inchangés');
});
