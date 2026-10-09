'use strict';
/* Phase 3B-4 : CLASSIFICATION MARCHÉ (tools/market/classify.js). « Dans quel marché cette offre est-elle réellement disponible ? »
   Données : test/fixtures/market-observation-fixture.js (valeurs d'essai) ; le catalogue réel n'est lu que pour la compatibilité avec availabilityStatus() et le cas Lynia (présent-si). Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../tools/market/classify.js');
const C = require('../tools/market/confidence.js');
const O = require('../tools/market/observation.js');
const M = require('../tools/market/match.js');
const P = require('../js/engine/products.js');
const F = require('./fixtures/market-observation-fixture.js');
const INV = require('./fixtures/catalog-inventory.js');

const ROOT = path.join(__dirname, '..');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const IDENT = JSON.parse(read('data/market/identities.json'));
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const classify = (obs, target, checks, opts) => K.classify({ targetCountry: target, observation: obs, marketChecks: checks }, opts);
const clsOf = (c) => classify(c.obs, c.target, c.checks);

test('MK-1 cas A à O : statut, codes de raison, avertissements', () => {
  assert.ok(F.CLASSIFICATION_CASES.length >= 12);
  for (const c of F.CLASSIFICATION_CASES) {
    const r = clsOf(c);
    assert.equal(r.status, c.status, c.id + ' ' + c.title + ' (' + r.reasonCodes.join(',') + ')');
    for (const code of c.codes || []) assert.ok(r.reasonCodes.includes(code), c.id + ' : code ' + code + ' (' + r.reasonCodes.join(',') + ')');
    for (const w of c.warnings || []) assert.ok(r.warningCodes.includes(w), c.id + ' : avertissement ' + w + ' (' + r.warningCodes.join(',') + ')');
    if (c.historical !== undefined) assert.equal(r.historicalOffer, c.historical, c.id);
  }
});

test('MK-2 forme de la sortie : statut fermé, raisons, preuves, avertissements ; sérialisable, déterministe, prête pour un mode ombre', () => {
  for (const c of F.CLASSIFICATION_CASES.concat(F.TRAPS.map(t => ({ obs: t.obs, target: 'BJ', id: t.id })))) {
    const r = clsOf(c);
    assert.ok(K.STATUSES.includes(r.status), c.id); assert.equal(r.schema, 'classification/1');
    assert.ok(Array.isArray(r.reasonCodes) && r.reasonCodes.length > 0, c.id + ' : au moins une raison');
    assert.equal(r.reasons.length, r.reasonCodes.length); assert.equal(r.warnings.length, r.warningCodes.length);
    for (const code of r.reasonCodes.concat(r.warningCodes)) assert.ok(K.REASONS[code], c.id + ' : code connu ' + code);
    assert.ok(Array.isArray(r.evidence)); assert.ok(r.reasons.every(t => typeof t === 'string' && t.length));
    if (r.status !== 'UNKNOWN') assert.ok(r.evidence.length > 0, c.id + ' : un statut fort s\'appuie sur des preuves listées');
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r, c.id + ' : sérialisable sans perte'); assert.deepEqual(clsOf(c), r, c.id + ' : déterministe');
    assert.equal(r.targetCountry, String(c.target).toUpperCase());
  }
  const r = classify(F.make({}), 'BJ');
  assert.deepEqual(r.evidence.map(e => e.type), ['identity', 'seller', 'seller_country', 'stock']);
  assert.deepEqual(r.evidence.find(e => e.type === 'seller_country'), { type: 'seller_country', value: 'BJ', basis: 'seller_page', source: 'page « Contact » du vendeur d\'essai', established: true });
});

test('MK-3 erreurs à empêcher : ce que la classification ne doit jamais conclure', () => {
  for (const t of F.TRAPS) { const r = classify(t.obs, 'BJ'); assert.equal(r.status, t.status, t.id + ' ' + t.title + ' : ' + r.status); assert.notEqual(r.status, 'LOCAL', t.id); }
  // XOF, .bj, français, téléphone : même ensemble, une base explicite change tout, rien d'autre
  const hints = ['currency', 'domain', 'language', 'phone', 'shipping_mention', 'inferred', 'autre', null];
  for (const b of hints) assert.equal(classify(F.withCountry('BJ', b), 'BJ').status, 'UNKNOWN', String(b));
  for (const b of O.COUNTRY_BASES_ESTABLISHED) assert.equal(classify(F.withCountry('BJ', b), 'BJ').status, 'LOCAL', b);
  // vendeur connu, enregistré, vérifié, ville béninoise, devise XOF, prix, stock : toujours sans pays établi, toujours UNKNOWN
  const noCountry = F.make({ seller: { name: 'Vendeur Alpha', id: 'v1', type: 'pharmacy', registered: true, verified: true }, city: 'Cotonou', price: { amount: 12700, currency: 'XOF' }, stock: 'in_stock' });
  assert.equal(classify(noCountry, 'BJ').status, 'UNKNOWN'); assert.deepEqual(classify(noCountry, 'BJ').reasonCodes, ['MARKET_COUNTRY_UNKNOWN', 'NO_SEARCH_RECORDED']);
  // « international » sous toutes ses formes, sans pays nommé
  for (const mention of ['international', 'local', null]) assert.equal(classify(F.foreign('FR', { shippingMention: mention }), 'BJ').status, 'UNKNOWN', String(mention));
  // une livraison confirmée pour d'AUTRES pays ne vaut pas le pays cible
  assert.equal(classify(F.foreign('FR', { shipsTo: ['TG', 'NG', 'CI', 'SN'].map(c => F.delivery(c, true)) }), 'BJ').status, 'UNKNOWN');
  // un pays de vendeur non valide ou en conflit
  for (const co of ['bj ', 'Benin', 'B', 'BJX', '', '12', 5, {}, null]) assert.equal(classify(F.withSeller({ country: co }), 'BJ').status, 'UNKNOWN', JSON.stringify(co) + ' : un pays sans base explicite n\'est pas établi');
  assert.equal(classify(F.withSeller({ country: [F.country('BJ'), F.country('TG')] }), 'BJ').reasonCodes[0], 'MARKET_COUNTRY_CONFLICT');
});

test('MK-4 l\'identité du produit est une porte : seules les classes EXACT et STRONG ouvrent un statut', () => {
  for (const [cls, ok] of [['EXACT_MATCH', true], ['STRONG_MATCH', true], ['POSSIBLE_MATCH', false], ['VARIANT_MATCH', false], ['NO_MATCH', false]]) {
    for (const obs of [F.make({ match: F.matched(cls) }), F.foreign('TG', { match: F.matched(cls), shipsTo: [F.delivery('BJ', true)] })]) {
      const r = classify(obs, 'BJ');
      assert.equal(r.status !== 'UNKNOWN', ok, cls + ' ' + r.status); if (!ok) assert.deepEqual(r.reasonCodes.slice(0, 1), ['IDENTITY_NOT_CONFIRMED']);
    }
  }
  assert.equal(classify(F.make({ match: undefined }), 'BJ').status, 'UNKNOWN', 'sans résultat de matching : jamais rattaché');
  assert.equal(classify(F.make({ match: { valid: false, matchClass: null, error: { code: 'candidate_invalid' } } }), 'BJ').status, 'UNKNOWN', 'résultat inexploitable du matcher : identité inconnue');
  assert.equal(classify(F.make({ match: { matchClass: 'EXACT_MATCH', valid: false } }), 'BJ').status, 'UNKNOWN', 'résultat du matcher marqué inexploitable : ignoré même avec une classe');
  assert.equal(classify(F.make({ match: undefined, assignedByCatalog: true }), 'BJ').status, 'LOCAL', 'rattachement par le catalogue');
});

test('MK-5 indépendance matching ≠ confiance ≠ marché : les six cas A à F de la brief', () => {
  const run = obs => ({ conf: C.assess(obs, { now: F.NOW }), mkt: classify(obs, 'BJ') });
  // A : EXACT + pays inconnu → produit HIGH, marché UNKNOWN
  const a = run(F.withCountry(null)); assert.equal(a.conf.dimensions.product.level, 'HIGH'); assert.equal(a.conf.level, 'HIGH'); assert.equal(a.mkt.status, 'UNKNOWN');
  // B : POSSIBLE + vendeur parfait → pas HIGH sur le produit (et pas de statut marché pour ce produit)
  const b = run(F.make({ match: F.matched('POSSIBLE_MATCH'), seller: F.sellerOf({ registered: true, verified: true }) })); assert.notEqual(b.conf.dimensions.product.level, 'HIGH'); assert.notEqual(b.conf.level, 'HIGH'); assert.equal(b.mkt.status, 'UNKNOWN');
  // C : EXACT + vendeur Bénin + in_stock → LOCAL
  const c = run(F.make({})); assert.equal(c.mkt.status, 'LOCAL');
  // D : EXACT + vendeur Togo + livraison BJ confirmée → REGIONAL
  assert.equal(run(F.foreign('TG', { shipsTo: [F.delivery('BJ', true)] })).mkt.status, 'REGIONAL');
  // E : EXACT + vendeur France + livraison BJ confirmée → IMPORT
  assert.equal(run(F.foreign('FR', { shipsTo: [F.delivery('BJ', true)] })).mkt.status, 'IMPORT');
  // F : EXACT + vendeur France + « international shipping » sans preuve BJ → UNKNOWN
  assert.equal(run(F.foreign('FR', { shippingMention: 'international' })).mkt.status, 'UNKNOWN');
  // et dans l'autre sens : un marché LOCAL peut avoir une confiance faible ; une confiance HIGH n'implique pas LOCAL
  const weakLocal = run(F.make({ source: { kind: 'snippet' } })); assert.equal(weakLocal.mkt.status, 'LOCAL'); assert.equal(weakLocal.conf.level, 'LOW');
  const highUnknown = run(F.foreign('FR', {})); assert.equal(highUnknown.conf.level, 'HIGH'); assert.equal(highUnknown.mkt.status, 'UNKNOWN');
  const exactNotLocal = run(F.foreign('TG', {})); assert.equal(exactNotLocal.conf.dimensions.product.level, 'HIGH'); assert.notEqual(exactNotLocal.mkt.status, 'LOCAL');
  const inStockNotLocal = run(F.foreign('TG', { stock: 'in_stock' })); assert.notEqual(inStockNotLocal.mkt.status, 'LOCAL');
});

test('MK-6 la classification ne lit ni le prix, ni la devise, ni la source, ni la fraîcheur, ni la confiance : résultat identique', () => {
  const grid = F.CLASSIFICATION_CASES.filter(c => c.obs);
  const variants = [
    o => { o.price = { amount: 1, currency: 'NGN' }; }, o => { o.price = { amount: 99999999, currency: 'EUR' }; }, o => { delete o.price; }, o => { o.price = 'gratuit'; },
    o => { o.source = { kind: 'snippet' }; }, o => { delete o.source; }, o => { o.checkedAt = F.DAYS.stale; }, o => { delete o.checkedAt; }, o => { o.method = 'autre'; },
    o => { o.url = { href: 'https://autre.invalid/search?q=x' }; }, o => { delete o.url; }, o => { o.city = 'Paris'; }, o => { o.seller.type = 'marketplace'; if (o.seller) o.seller.registered = !o.seller.registered; }
  ];
  for (const c of grid) {
    const ref = JSON.stringify(clsOf(c));
    for (const [i, v] of variants.entries()) { const obs = F.clone(c.obs); v(obs); assert.equal(JSON.stringify(classify(obs, c.target, c.checks)), ref, c.id + ' variante ' + i); }
  }
  assert.doesNotMatch(strip(read('tools/market/classify.js')), /\bprice\b|\bcurrency\b|confidence|freshness/i, 'classify ne lit ni le prix, ni la devise, ni la confiance, ni la fraîcheur');
});

test('MK-7 REGIONAL / IMPORT : la zone vient du pays du vendeur, jamais de la livraison seule ; la règle de zone est remplaçable', () => {
  for (const seller of ['TG', 'CI', 'NG', 'GH', 'SN', 'MA', 'ZA']) assert.equal(classify(F.foreign(seller, { shipsTo: [F.delivery('BJ', true)] }), 'BJ').status, 'REGIONAL', seller);
  for (const seller of ['FR', 'BE', 'US', 'CN', 'AE']) assert.equal(classify(F.foreign(seller, { shipsTo: [F.delivery('BJ', true)] }), 'BJ').status, 'IMPORT', seller);
  const obs = F.foreign('FR', { shipsTo: [F.delivery('BJ', true)] });
  assert.equal(classify(obs, 'BJ', undefined, { isRegional: () => true }).status, 'REGIONAL'); assert.equal(classify(F.foreign('TG', { shipsTo: [F.delivery('BJ', true)] }), 'BJ', undefined, { isRegional: () => false }).status, 'IMPORT');
  assert.equal(classify(F.foreign('FR', { shipsTo: [F.delivery('BJ', true)] }), 'BJ', undefined, { isRegional: () => 'oui' }).status, 'IMPORT', 'seul `true` compte');
  assert.equal(K.defaultIsRegional('TG', 'BJ'), true); assert.equal(K.defaultIsRegional('BJ', 'BJ'), false); assert.equal(K.defaultIsRegional('FR', 'BJ'), false);
});

test('MK-8 le rôle du stock : rupture = offre historique, pas disponibilité ; stock inconnu ne se déduit pas', () => {
  for (const st of ['out_of_stock', 'coming_soon']) {
    const r = classify(F.make({ stock: st }), 'BJ'); assert.equal(r.status, 'UNKNOWN'); assert.notEqual(r.status, 'UNAVAILABLE');
    assert.ok(r.warningCodes.includes('W_HISTORICAL_OFFER'));
  }
  assert.equal(classify(F.make({ stock: 'out_of_stock' }), 'BJ').historicalOffer, true); assert.equal(classify(F.make({ stock: 'coming_soon' }), 'BJ').historicalOffer, false);
  assert.ok(classify(F.make({ stock: 'out_of_stock' }), 'BJ').evidence.some(e => e.type === 'seller_country' && e.value === 'BJ'), 'la preuve historique garde le vendeur et son pays');
  // plusieurs offres : une disponible l'emporte sur une en rupture
  const both = K.classifyMarket({ targetCountry: 'BJ', observations: [F.make({ id: 'x1', stock: 'out_of_stock' }), F.make({ id: 'x2', stock: 'in_stock' })] });
  assert.equal(both.status, 'LOCAL'); assert.equal(both.observationId, 'x2'); assert.deepEqual(both.supportingObservations, [1]);
  assert.equal(classify(F.make({ stock: undefined }), 'BJ').status, 'LOCAL'); assert.ok(classify(F.make({ stock: undefined }), 'BJ').warningCodes.includes('W_STOCK_UNKNOWN'));
  assert.equal(classify(F.make({ stock: 'disponible' }), 'BJ').status, 'LOCAL', 'valeur non reconnue = stock inconnu, pas une rupture');
});

test('MK-9 UNAVAILABLE : seulement par une recherche explicite valide, selon la règle existante (marketChecks, products.js)', () => {
  const none = F.SEARCH_NONE, found = F.SEARCH_FOUND;
  assert.equal(P.validateMarketCheck(none).length, 0);
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [], marketChecks: [none] }).status, 'UNAVAILABLE');
  for (const bad of [{}, { market: 'BJ' }, Object.assign({}, none, { method: '' }), Object.assign({}, none, { checkedAt: 'hier' }), Object.assign({}, none, { status: 'peut-etre' }), Object.assign({}, none, { extra: 1 }), Object.assign({}, none, { market: 'ZZ' }), null, 'x', 5]) {
    const r = K.classifyMarket({ targetCountry: 'BJ', observations: [], marketChecks: [bad] }); assert.notEqual(r.status, 'UNAVAILABLE', JSON.stringify(bad)); assert.equal(r.status, 'UNKNOWN');
  }
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [], marketChecks: [none, found] }).status, 'UNKNOWN', 'recherches contradictoires : prudence');
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [], marketChecks: [found] }).status, 'UNKNOWN');
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [] }).status, 'UNKNOWN');
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [], marketChecks: [Object.assign({}, none, { market: 'TG' })] }).status, 'UNKNOWN');
  // une offre qualifiante l'emporte toujours sur une recherche « aucune offre »
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [F.make({})], marketChecks: [none] }).status, 'LOCAL');
  // absence ne se déduit jamais : site inaccessible, stock inconnu, vendeur inconnu, pas d'URL, un seul résultat vide
  for (const obs of [F.make({ url: undefined, stock: undefined, seller: { country: F.country('BJ') }, match: F.matched('POSSIBLE_MATCH') }), F.foreign('FR'), F.withCountry(null), null]) assert.notEqual(K.classifyMarket({ targetCountry: 'BJ', observations: obs ? [obs] : [] }).status, 'UNAVAILABLE');
  // une offre « livraison internationale » sans pays nommé : on ne sait pas si elle livre le pays cible, donc aucune indisponibilité déclarée (availabilityStatus la lirait comme IMPORT)
  const intl = K.classifyMarket({ targetCountry: 'BJ', observations: [F.foreign('FR', { shippingMention: 'international' })], marketChecks: [none] });
  assert.equal(intl.status, 'UNKNOWN'); assert.equal(intl.reasonCodes[0], 'UNSPECIFIED_INTERNATIONAL_OFFER_EXISTS');
  // un autre pays recherché ne rend pas le pays cible indisponible
  assert.equal(K.classifyMarket({ targetCountry: 'TG', observations: [], marketChecks: [none] }).status, 'UNKNOWN');
});

test('MK-10 plusieurs observations : priorité LOCAL, REGIONAL, IMPORT ; le détail de chacune est conservé', () => {
  const imp = F.foreign('FR', { id: 'imp', shipsTo: [F.delivery('BJ', true)] }), reg = F.foreign('TG', { id: 'reg', shipsTo: [F.delivery('BJ', true)] }), loc = F.make({ id: 'loc' }), unk = F.foreign('FR', { id: 'unk' });
  for (const order of [[imp, reg, loc, unk], [unk, loc, reg, imp], [reg, imp, unk, loc]]) {
    const r = K.classifyMarket({ targetCountry: 'BJ', observations: order });
    assert.equal(r.status, 'LOCAL'); assert.equal(r.observationId, 'loc'); assert.equal(r.observations.length, 4);
    assert.deepEqual(r.observations.map(o => o.status).sort(), ['IMPORT', 'LOCAL', 'REGIONAL', 'UNKNOWN']);
  }
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [imp, unk, reg] }).status, 'REGIONAL');
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [unk, imp] }).status, 'IMPORT');
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: [unk] }).status, 'UNKNOWN');
  // plusieurs offres de même statut : l'ordre d'entrée tranche, tous les soutiens sont listés
  const two = K.classifyMarket({ targetCountry: 'BJ', observations: [F.make({ id: 'a' }), F.make({ id: 'b' })] }); assert.equal(two.observationId, 'a'); assert.deepEqual(two.supportingObservations, [0, 1]);
});

test('MK-11 cas de référence Bénin / Lynia : LOCAL uniquement parce que les preuves de marché indiquent le Bénin', () => {
  const ha = IDENT.products['to-hyaluronic-b5-ceramides'];
  const lynia = {
    id: 'lynia-bj', seller: { name: 'Lynia Shop', type: 'retailer', country: { value: 'BJ', basis: 'team_provided', source: 'relevé fourni par l\'équipe DERMAI (Lynia Shop, lynia-shop.com) : vendeur au Bénin' } },
    price: { amount: 12700, currency: 'XOF' }, stock: 'in_stock', url: null, source: { kind: 'team_provided', label: 'relevé de l\'équipe DERMAI', reopened: false }, checkedAt: '2026-10-08', shipsTo: []
  };
  const title = { exact: 'The Ordinary Acide Hyaluronique 2% + B5 30ml avec céramides', possible: 'The Ordinary Acide Hyaluronique 2% + B5 30ml vendu au bénin' };
  const exact = M.matchCandidate({ title: title.exact }, ha, { productId: 'to-hyaluronic-b5-ceramides' });
  assert.equal(exact.matchClass, 'EXACT_MATCH');
  const obs = Object.assign({}, lynia, { match: exact });
  const mk = classify(obs, 'BJ'), cf = C.assess(obs, { now: F.NOW });
  assert.equal(mk.status, 'LOCAL'); assert.deepEqual(mk.reasonCodes, ['LOCAL_SELLER_IN_TARGET_CONFIRMED']);
  assert.deepEqual(mk.evidence.find(e => e.type === 'seller_country'), { type: 'seller_country', value: 'BJ', basis: 'team_provided', source: lynia.seller.country.source, established: true });
  assert.equal(mk.productId, 'to-hyaluronic-b5-ceramides');
  assert.equal(cf.dimensions.product.level, 'HIGH'); assert.equal(cf.level, 'MEDIUM', 'relevé de l\'équipe, page non rouverte, pas de lien : MEDIUM'); assert.deepEqual(cf.caps.sort(), ['CAP_INCOMPLETE', 'CAP_SOURCE_NOT_FIRST_HAND']);
  // le prix et la devise ne jouent aucun rôle
  for (const price of [undefined, { amount: 1, currency: 'EUR' }, { amount: 12700, currency: 'NGN' }]) assert.deepEqual(classify(Object.assign({}, obs, { price }), 'BJ'), mk);
  // sans preuve de marché explicite : le même relevé n'est plus LOCAL, quelle que soit la devise XOF
  for (const country of [undefined, { value: 'BJ', basis: 'currency', source: 'prix en XOF' }, { value: 'BJ', basis: 'domain', source: 'lynia-shop.com' }, { value: 'BJ', basis: 'team_provided' }])
    assert.equal(classify(Object.assign({}, obs, { seller: Object.assign({}, lynia.seller, { country }) }), 'BJ').status, 'UNKNOWN');
  // le matcher seul ne reproduit pas la décision humaine : un titre sans formulation reste POSSIBLE, donc aucun statut marché
  const possible = M.matchCandidate({ title: title.possible }, ha, { productId: 'to-hyaluronic-b5-ceramides' });
  assert.equal(possible.matchClass, 'POSSIBLE_MATCH');
  const p = classify(Object.assign({}, lynia, { match: possible }), 'BJ'); assert.equal(p.status, 'UNKNOWN'); assert.equal(p.reasonCodes[0], 'IDENTITY_NOT_CONFIRMED');
  assert.equal(C.assess(Object.assign({}, lynia, { match: possible }), { now: F.NOW }).level, 'LOW');
  // autre pays cible : le vendeur béninois n'est pas local au Togo
  assert.equal(classify(obs, 'TG').status, 'UNKNOWN');
  // le catalogue réel (présent-si) : l'offre Lynia enregistrée reste LOCAL au Bénin, UNKNOWN ailleurs, conforme à availabilityStatus
  const prod = INV.byId('to-hyaluronic-b5-ceramides'), has = prod && (prod.offers || []).some(o => o.market === 'BJ' && /lynia/i.test(o.retailer));
  if (has) {
    const bridge = O.fromCatalogProduct(prod);
    assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: bridge.observations, marketChecks: bridge.marketChecks }).status, 'LOCAL');
    assert.equal(P.availabilityStatus(prod, 'BJ').status, 'LOCAL');
    for (const t of ['TG', 'CI', 'NG', 'FR']) assert.equal(K.classifyMarket({ targetCountry: t, observations: bridge.observations, marketChecks: bridge.marketChecks }).status, 'UNKNOWN', t);
  }
});

/* Génération déterministe de produits d'essai : valides pour products.js, avec des offres et des recherches variées. */
function syntheticProducts(n, seed0) {
  let seed = seed0; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const markets = ['BJ', 'TG', 'CI', 'NG', 'GH', 'KE', 'SN'], out = [];
  for (let i = 0; i < n; i++) {
    const offers = Array.from({ length: Math.floor(rnd() * 5) }, (_, k) => {
      const market = pick(markets), o = { market, retailer: 'Vendeur essai ' + i + '-' + k, type: pick(P.OFFER_TYPES), availability: pick(P.OFFER_AVAILABILITY), source: 'source d\'essai ' + k, checkedAt: '2026-10-01' };
      const sh = pick([null, null, 'local', 'international']); if (sh) o.shipping = sh;
      if (rnd() < 0.4) o.servesMarkets = markets.filter(m => rnd() < 0.4);
      if (o.servesMarkets && !o.servesMarkets.length) delete o.servesMarkets;
      return o;
    });
    const checks = [], marketsWith = new Set(offers.map(o => o.market));
    if (rnd() < 0.5) { const m = pick(markets); checks.push({ market: m, status: marketsWith.has(m) ? 'searched_found' : 'searched_none', checkedAt: '2026-10-02', method: 'recherche d\'essai' }); }
    if (rnd() < 0.5) { const m = pick(markets); if (!checks.some(c => c.market === m)) checks.push({ market: m, status: marketsWith.has(m) ? 'searched_found' : 'searched_none', checkedAt: '2026-10-02', method: 'recherche d\'essai 2' }); }
    if (rnd() < 0.15) checks.push({ market: pick(markets), status: pick(P.MARKET_CHECK_STATUS), checkedAt: '2026-10-02', method: 'recherche incohérente avec les offres' });   // incohérence volontaire : produit invalide
    if (rnd() < 0.1) checks.push({ market: pick(markets), status: 'searched_none' });                                                              // enregistrement invalide
    out.push(Object.assign(INV.withOffers(INV.template(), offers, checks), { id: 'essai-' + i }));
  }
  return out;
}

test('MK-12 contrat avec availabilityStatus() : jamais plus permissif ; tout écart est nommé (reconcile) ; catalogue réel et 600 produits d\'essai', () => {
  const countries = Object.keys(P.MARKETS);
  const valid = p => P.validateProduct(p).filter(e => /offre|recherche/.test(e)).length === 0;
  const check = (p, t, at) => {
    const a = P.availabilityStatus(p, t).status, bridge = O.fromCatalogProduct(p), res = K.classifyMarket({ targetCountry: t, observations: bridge.observations, marketChecks: bridge.marketChecks });
    const rel = K.reconcile(a, res);
    assert.notEqual(rel.relation, 'VIOLATION', at + ' : ' + rel.explanation);
    if (valid(p)) { if (a === 'LOCAL') assert.equal(res.status, 'LOCAL', at); if (a === 'UNKNOWN') assert.equal(res.status, 'UNKNOWN', at); }
    return rel;
  };
  let pairs = 0; const seen = new Set(), divergences = new Set();
  for (const p of INV.products) for (const t of countries) { const rel = check(p, t, p.id + ' → ' + t); assert.equal(rel.relation, 'AGREE', 'catalogue réel : aucune divergence ' + p.id + ' ' + t); pairs++; }
  let nValid = 0;
  for (const p of syntheticProducts(600, 20261010)) { if (valid(p)) nValid++; for (const t of ['BJ', 'TG', 'CI', 'NG', 'GH', 'KE', 'SN', 'FR', 'ZA']) { const rel = check(p, t, p.id + ' → ' + t); seen.add(rel.catalog + '>' + rel.classify); if (rel.divergence) divergences.add(rel.divergence); pairs++; } }
  for (const need of ['LOCAL>LOCAL', 'REGIONAL>REGIONAL', 'UNAVAILABLE>UNAVAILABLE', 'UNKNOWN>UNKNOWN']) assert.ok(seen.has(need), 'le jeu d\'essai couvre ' + need + ' (' + [...seen].join(' ') + ')');
  assert.ok(pairs > 5000 && nValid > 300, 'assez de produits d\'essai valides (' + nValid + ')');
  for (const d of divergences) assert.ok(K.DIVERGENCES[d], 'divergence déclarée : ' + d);
});

test('MK-12b reconcile : un écart plus permissif, ou une prudence non nommée, est une VIOLATION', () => {
  const r = (status, extra) => Object.assign({ status, reasonCodes: [], observations: [] }, extra || {});
  assert.equal(K.reconcile('LOCAL', r('LOCAL')).relation, 'AGREE');
  for (const [cat, k] of [['UNKNOWN', 'LOCAL'], ['UNKNOWN', 'REGIONAL'], ['UNKNOWN', 'IMPORT'], ['UNKNOWN', 'UNAVAILABLE'], ['LOCAL', 'REGIONAL'], ['REGIONAL', 'IMPORT'], ['IMPORT', 'LOCAL'], ['UNAVAILABLE', 'LOCAL'], ['LOCAL', 'UNAVAILABLE']])
    assert.equal(K.reconcile(cat, r(k)).relation, 'VIOLATION', cat + ' → ' + k);
  for (const cat of ['LOCAL', 'REGIONAL', 'IMPORT', 'UNAVAILABLE']) assert.equal(K.reconcile(cat, r('UNKNOWN')).relation, 'VIOLATION', cat + ' → UNKNOWN sans cause nommée');
  assert.equal(K.reconcile('LOCAL', r('UNKNOWN', { reasonCodes: ['DELIVERY_CLAIM_EXISTS_NOT_QUALIFIED'] })).relation, 'VIOLATION', 'LOCAL ne diverge jamais');
  assert.equal(K.reconcile('ZZ', r('UNKNOWN')).relation, 'VIOLATION'); assert.equal(K.reconcile('LOCAL', null).relation, 'VIOLATION');
});

test('MK-13 les quatre divergences volontaires avec availabilityStatus() : nommées, expliquées, testées une à une', () => {
  const offer = (market, extra) => Object.assign({ market, retailer: 'Vendeur essai ' + market, type: 'retailer', availability: 'in_stock', source: 'source d\'essai', checkedAt: '2026-10-01' }, extra || {});
  const none = { market: 'BJ', status: 'searched_none', checkedAt: '2026-10-02', method: 'recherche d\'essai' }, found = { market: 'BJ', status: 'searched_found', checkedAt: '2026-10-02', method: 'recherche d\'essai' };
  const both = (p, t) => { const a = P.availabilityStatus(p, t).status, b = O.fromCatalogProduct(p), res = K.classifyMarket({ targetCountry: t, observations: b.observations, marketChecks: b.marketChecks }); return Object.assign({ res }, K.reconcile(a, res)); };
  const T = INV.template();
  // D1 : « livraison internationale » sans pays nommé
  let x = both(INV.withOffers(T, [offer('NG', { shipping: 'international' })]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation, x.divergence], ['IMPORT', 'UNKNOWN', 'MORE_CAUTIOUS', 'D1_INTERNATIONAL_UNSPECIFIED']);
  // D2 : le vendeur annonce une livraison locale mais liste le pays cible dans servesMarkets
  x = both(INV.withOffers(T, [offer('NG', { shipping: 'local', servesMarkets: ['BJ'] })]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation, x.divergence], ['REGIONAL', 'UNKNOWN', 'MORE_CAUTIOUS', 'D2_LOCAL_ONLY_DELIVERY']);
  // D3 : livraison vers le pays cible affirmée mais offre en rupture, avec une recherche « aucune offre »
  x = both(INV.withOffers(T, [offer('TG', { availability: 'out_of_stock', servesMarkets: ['BJ'] })], [none]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation, x.divergence], ['UNAVAILABLE', 'UNKNOWN', 'MORE_CAUTIOUS', 'D3_UNAVAILABLE_GUARDED']);
  // D4 : deux recherches contradictoires (catalogue invalide : la première valide l\'emporte au catalogue)
  const d4 = INV.withOffers(T, [], [none, found]); x = both(d4, 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation, x.divergence], ['UNAVAILABLE', 'UNKNOWN', 'MORE_CAUTIOUS', 'D4_SEARCH_CONFLICT']);
  assert.ok(P.validateProduct(d4).some(e => /searched_found/.test(e)), 'D4 ne peut naître que d\'un catalogue déjà invalide');
  // pas de divergence quand les preuves sont nommées : la livraison nommée (servesMarkets) donne REGIONAL des deux côtés, la recherche seule donne UNAVAILABLE des deux côtés
  x = both(INV.withOffers(T, [offer('NG', { servesMarkets: ['BJ'] })]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation], ['REGIONAL', 'REGIONAL', 'AGREE']);
  x = both(INV.withOffers(T, [], [none]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation], ['UNAVAILABLE', 'UNAVAILABLE', 'AGREE']);
  x = both(INV.withOffers(T, [offer('BJ')]), 'BJ'); assert.deepEqual([x.catalog, x.classify, x.relation], ['LOCAL', 'LOCAL', 'AGREE']);
  // le contrat est documenté : chaque divergence a une raison, et le README les nomme
  for (const [id, d] of Object.entries(K.DIVERGENCES)) { assert.ok(d.why.length > 20 && ['IMPORT', 'REGIONAL', 'UNAVAILABLE'].includes(d.catalog) && d.classify === 'UNKNOWN', id); assert.ok(read('tools/market/README.md').includes(id), 'README : ' + id); }
  assert.deepEqual(Object.keys(K.DIVERGENCES).length, 4);
});

test('MK-14 simulations de croissance A à N : aucune dépendance à un nombre de vendeurs, de produits ou d\'offres', () => {
  const T = 'BJ', st = o => classify(o, T).status, mk = (cc, extra) => (cc === 'LOCAL' ? F.make(extra) : F.foreign(cc, extra));
  // A nouveau vendeur ; B Bénin ; C Togo ; D France ; E livraison BJ ; F livraison inconnue ; G pays vendeur inconnu ; H stock absent ; I stock out_of_stock ; J prix absent ; K URL absente
  for (let i = 0; i < 50; i++) {
    const name = 'Nouveau vendeur ' + i, seller = (c, basis) => F.sellerOf({ name, id: 'nv-' + i, registered: false, verified: false, country: c ? F.country(c, basis) : undefined });
    assert.equal(st(F.make({ seller: seller('BJ') })), 'LOCAL', 'B+A'); assert.equal(st(F.make({ seller: seller('TG'), shipsTo: [F.delivery('BJ', true)] })), 'REGIONAL', 'C+E');
    assert.equal(st(F.make({ seller: seller('FR'), shipsTo: [F.delivery('BJ', true)] })), 'IMPORT', 'D+E'); assert.equal(st(F.make({ seller: seller('FR') })), 'UNKNOWN', 'F');
    assert.equal(st(F.make({ seller: seller(null) })), 'UNKNOWN', 'G'); assert.equal(st(F.make({ seller: seller('BJ'), stock: undefined })), 'LOCAL', 'H');
    assert.equal(st(F.make({ seller: seller('BJ'), stock: 'out_of_stock' })), 'UNKNOWN', 'I'); assert.equal(st(F.make({ seller: seller('BJ'), price: undefined })), 'LOCAL', 'J'); assert.equal(st(F.make({ seller: seller('BJ'), url: undefined })), 'LOCAL', 'K');
  }
  // L ajout d'un produit ; M ajout d'une offre ; N suppression d'une offre : sur le catalogue réel cloné, sans fixer aucun effectif
  const base = INV.usableProducts[0], tmpl = INV.clone(base), offersOf = p => (p.offers || []);
  const status = (p, t) => { const b = O.fromCatalogProduct(p); return K.classifyMarket({ targetCountry: t, observations: b.observations, marketChecks: b.marketChecks }).status; };
  const offer = (market, extra) => Object.assign({ market, retailer: 'Vendeur essai ' + market, type: 'retailer', availability: 'in_stock', source: 'source d\'essai', checkedAt: '2026-10-01' }, extra || {});
  const noOffer = INV.withOffers(tmpl, []); noOffer.marketChecks = undefined;
  assert.equal(status(noOffer, T), 'UNKNOWN', 'produit sans offre');
  const added = INV.withOffers(noOffer, [offer('BJ')]); assert.equal(status(added, T), 'LOCAL', 'M : offre ajoutée'); assert.equal(P.availabilityStatus(added, T).status, 'LOCAL');
  const removed = INV.withOffers(added, offersOf(added).slice(1)); assert.equal(status(removed, T), 'UNKNOWN', 'N : offre retirée'); assert.equal(P.availabilityStatus(removed, T).status, 'UNKNOWN');
  const grown = INV.products.map(INV.clone).concat([Object.assign(INV.withOffers(tmpl, [offer('BJ'), offer('TG', { servesMarkets: ['BJ'] })]), { id: 'essai-nouveau-produit' })]);
  for (const p of grown) assert.ok(K.STATUSES.includes(status(p, T)), p.id);   // L : un produit de plus ne casse rien
  assert.equal(status(grown[grown.length - 1], T), 'LOCAL');
  const manyOffers = INV.withOffers(tmpl, Array.from({ length: 300 }, (_, i) => offer(['TG', 'CI', 'NG', 'GH', 'KE', 'SN'][i % 6], { retailer: 'Vendeur ' + i })));
  assert.equal(status(manyOffers, T), 'UNKNOWN', '300 offres hors du pays cible, aucune livraison nommée'); assert.equal(status(Object.assign({}, manyOffers, { offers: manyOffers.offers.concat([offer('BJ')]) }), T), 'LOCAL');
});

test('MK-15 pureté et périmètre : aucune mutation, aucun réseau, aucune horloge ; entrées hostiles ; fichiers interdits absents ; moteur et catalogue intacts', () => {
  for (const c of F.CLASSIFICATION_CASES) { if (!c.obs) continue; const frozen = deepFreeze(F.clone(c.obs)), checks = deepFreeze(F.clone(c.checks || [])); assert.doesNotThrow(() => classify(frozen, c.target, checks), c.id); assert.deepEqual(frozen, c.obs, c.id + ' : entrée intacte'); }
  for (const f of ['classify.js', 'observation.js']) {
    const src = strip(read('tools/market/' + f));
    assert.doesNotMatch(src, /require\(['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|worker_threads|vm|os)['"]\)/, f); assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|process\.|Date\.now|new Date\(\s*\)|Math\.random|writeFile|console\./, f);
  }
  const requires = f => [...strip(read('tools/market/' + f)).matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  assert.deepEqual(requires('classify.js'), ['./observation.js'], 'classify ne charge ni la confiance, ni le matcher, ni le catalogue');
  assert.deepEqual(requires('confidence.js'), ['./observation.js']); assert.deepEqual(requires('observation.js'), ['../../js/engine/products.js']);
  const hostile = [undefined, null, 0, 'x', [], {}, { targetCountry: 5 }, { targetCountry: 'BJ', observation: 5 }, { targetCountry: 'BJ', observation: { seller: 5 } }, { targetCountry: 'BJ', observations: 'x' }, { targetCountry: 'BJ', observations: [null, 1, {}], marketChecks: 'x' }, { targetCountry: 'BJ', observations: [{ shipsTo: [null] }], marketChecks: [null, 3, {}] }];
  for (const h of hostile) { let r; assert.doesNotThrow(() => { r = K.classifyMarket(h); }, JSON.stringify(h)); assert.equal(r.status, 'UNKNOWN', JSON.stringify(h)); assert.doesNotThrow(() => K.classify(h)); }
  for (const f of ['safe-fetch.js', 'discovery.js', 'review.js', 'apply.js']) assert.ok(!fs.existsSync(path.join(ROOT, 'tools/market', f)), f + ' ne doit pas exister à ce stade');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'js')).concat(walk(path.join(ROOT, 'server')), walk(path.join(ROOT, 'api')))) if (/\.js$/.test(f)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tools\/market|market\/(?:confidence|classify|observation)/, path.relative(ROOT, f));
  assert.equal(fs.statSync(path.join(ROOT, 'js/app.js')).size, 149365, 'app.js inchangé');
  const sig = fs.readFileSync(path.join(ROOT, 'js/engine/products.js'), 'utf8');
  assert.match(sig, /function availabilityStatus\(p, country\)/); assert.ok(sig.includes("return { country: code, status: 'UNAVAILABLE', reason: 'searched_none', checkedAt: check.checkedAt };"), 'availabilityStatus inchangée');
});

test('MK-16 NO_MATCH = contradiction ; le matcher reste indépendant de la confiance et de la classification', () => {
  const src = strip(read('tools/market/match.js'));
  assert.doesNotMatch(src, /confidence|classify|observation|LOCAL|REGIONAL|IMPORT|UNAVAILABLE|availabilityStatus/, 'le matcher ignore la confiance et le marché');
  const ha = IDENT.products['to-hyaluronic-b5-ceramides'];
  const r = M.matchCandidate({ title: 'Garnier Hyaluronic Acid 2% + B5 30 ml' }, ha, { productId: 'x' });
  assert.equal(r.matchClass, 'POSSIBLE_MATCH', 'information insuffisante : POSSIBLE_MATCH, pas NO_MATCH');
  assert.equal(M.matchCandidate({ title: 'CeraVe Hyaluronic Acid 2% + B5 30 ml' }, ha, { productId: 'x' }).matchClass, 'NO_MATCH', 'contradiction explicite : NO_MATCH');
});

test('MK-17 identité non résolue (matching absent ou inexploitable) : jamais UNAVAILABLE, même avec un searched_none valide', () => {
  const none = F.SEARCH_NONE, forged = cls => ({ valid: false, matchClass: cls, error: { code: 'candidate_invalid' } });
  const run = (obs, checks) => K.classifyMarket({ targetCountry: 'BJ', observations: obs ? [obs] : [], marketChecks: checks === undefined ? [none] : checks });
  const unresolved = [['résultat inexploitable', { match: forged(null) }], ['résultat inexploitable avec classe forgée EXACT', { match: forged('EXACT_MATCH') }], ['résultat inexploitable avec classe forgée STRONG', { match: forged('STRONG_MATCH') }], ['aucun résultat de matching', { match: undefined }], ['{valid:false} seul', { match: { valid: false } }]];
  for (const [name, patch] of unresolved) {
    for (const [where, base] of [['vendeur établi au Bénin', F.make({})], ['vendeur France sans livraison', F.foreign('FR')], ['vendeur Togo avec livraison BJ', F.foreign('TG', { shipsTo: [F.delivery('BJ', true)] })]]) {
      const obs = Object.assign({}, base, patch); if (patch.match === undefined) delete obs.match;
      const r = run(obs);
      assert.equal(r.status, 'UNKNOWN', name + ' / ' + where + ' : ' + r.status); assert.notEqual(r.status, 'UNAVAILABLE');
      assert.equal(r.reasonCodes[0], 'UNRESOLVED_IDENTITY_OBSERVATION_EXISTS', name + ' / ' + where);
      assert.equal(K.classify({ targetCountry: 'BJ', observation: obs, marketChecks: [none] }).status, 'UNKNOWN');
    }
  }
  // sans la recherche, l'identité non résolue donne UNKNOWN aussi (porte d'identité), jamais un statut fort
  assert.equal(run(Object.assign(F.make({}), { match: forged('EXACT_MATCH') }), []).status, 'UNKNOWN');
  // les règles existantes sont préservées
  assert.equal(run(null).status, 'UNAVAILABLE', 'aucune observation + recherche valide : UNAVAILABLE comme avant');
  assert.equal(run(F.foreign('FR')).status, 'UNAVAILABLE', 'identité établie, offre non qualifiante : UNAVAILABLE comme avant');
  for (const cls of ['VARIANT_MATCH', 'NO_MATCH']) assert.equal(run(F.make({ match: F.matched(cls) })).status, 'UNAVAILABLE', cls + ' : une variante ou un autre produit ne rend pas le produit exact disponible');
  assert.equal(run(F.make({ match: F.matched('POSSIBLE_MATCH') })).reasonCodes[0], 'UNCONFIRMED_LOCAL_CANDIDATE_EXISTS');
  assert.equal(run(F.make({ stock: 'out_of_stock' })).reasonCodes[0], 'MARKET_CHECK_CONTRADICTS_OFFER');
  // une offre qualifiante l'emporte toujours, y compris à côté d'une observation d'identité non résolue
  const mixed = K.classifyMarket({ targetCountry: 'BJ', observations: [Object.assign(F.make({ id: 'u' }), { match: forged('EXACT_MATCH') }), F.make({ id: 'ok' })], marketChecks: [none] });
  assert.equal(mixed.status, 'LOCAL'); assert.equal(mixed.observationId, 'ok');
  // une observation rattachée par le catalogue reste une identité établie (le pont du catalogue ne change pas)
  const bridge = O.fromCatalogProduct(INV.withOffers(INV.template(), [{ market: 'TG', retailer: 'Vendeur essai', type: 'retailer', availability: 'in_stock', source: 'source d\'essai', checkedAt: '2026-10-01' }], [{ market: 'BJ', status: 'searched_none', checkedAt: '2026-10-02', method: 'recherche d\'essai' }]));
  assert.equal(K.classifyMarket({ targetCountry: 'BJ', observations: bridge.observations, marketChecks: bridge.marketChecks }).status, 'UNAVAILABLE');
  assert.ok(Object.prototype.hasOwnProperty.call(K.REASONS, 'UNRESOLVED_IDENTITY_OBSERVATION_EXISTS'));
});

test('MK-18 documentation : availabilityStatus n\'est pas présentée comme la source du statut affiché ; findMatches / validateCandidate documentés ; confidence.js n\'est plus « à venir »', () => {
  const readme = read('tools/market/README.md'), head = read('tools/market/classify.js').slice(0, 2600), match = read('tools/market/match.js');
  for (const text of [readme, head]) { assert.doesNotMatch(text, /décide ce que l'application affiche|SOURCE DE VÉRITÉ du statut AFFICHÉ|c'est availabilityStatus qui s'affiche|le catalogue prime à l'affichage/); assert.match(text, /marketView/); assert.match(text, /commerceOf/); }
  assert.match(readme, /pas\*\* appelée par l'application/);
  assert.doesNotMatch(readme, /confidence\.js`, à venir|classify\.js`, à venir/); assert.doesNotMatch(match, /confidence\.js, phase suivante/);
  assert.match(readme, /`findMatches`[^\n]*entrée invalide[^\n]*renvoie `\[\]`[^\n]*validateCandidate\(fiche\)/); assert.match(match, /Appeler validateCandidate\(fiche\) avant/);
  // l'application n'utilise toujours pas availabilityStatus ni tools/ : l'affichage n'est pas modifié
  const app = read('js/app.js'); assert.doesNotMatch(app, /availabilityStatus|tools\/market/); assert.match(app, /marketView/); assert.match(app, /commerceOf/);
});
