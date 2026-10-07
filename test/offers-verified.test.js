'use strict';
/* Étape 16 : offres commerciales africaines vérifiées. Données telles que fournies, jamais complétées ; aucun effet sur le moteur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const Market = require('../js/market.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const REAL = CAT.PRODUCTS, read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DAY = '2026-10-07';
/* [produit, pays, vendeur (retailer), seller, type, devise, prix, disponibilité, lien exact] */
const EXPECTED = [
  ['to-niacinamide-10-zinc-1', 'GH', 'Jumia Ghana', null, 'marketplace', 'GHS', 200, 'in_stock', 'https://www.jumia.com.gh/the-ordinary-niacinamide-10-zinc-1-30ml-300877098.html'],
  ['to-mandelic-acid-10-ha', 'GH', 'Swanky Beauty Supply', null, 'retailer', 'GHS', 220, 'unknown', 'https://www.swankybeautygh.com/products/the-ordinary-mandelic-acid-10-ha'],
  ['to-salicylic-2-solution', 'NG', 'Konga', 'SebuFTech Ventures', 'marketplace', 'NGN', 9500, 'unknown', 'https://www.konga.com/product/the-ordinary-salicylic-acid-2-solution-30ml-4559112'],
  ['to-niacinamide-10-zinc-1', 'NG', 'Konga', 'SebuFTech Ventures', 'marketplace', 'NGN', 9990, 'unknown', 'https://www.konga.com/product/the-ordinary-niacinamide-10-zinc-1-30ml-4559110'],
  ['to-azelaic-acid-10', 'NG', 'Konga', 'Posh Gallery', 'marketplace', 'NGN', 22000, 'unknown', 'https://www.konga.com/product/the-ordinary-azelaic-acid-suspension-10-6852441'],
  ['to-ascorbyl-glucoside-12', 'NG', 'Konga', 'smile time', 'marketplace', 'NGN', 10000, 'unknown', 'https://www.konga.com/product/the-ordinary-ascorbyl-glucoside-solution-12-30ml-6447242'],
  ['cerave-hydrating-ha-serum', 'NG', 'Jumia Nigeria', 'Annette Trudan', 'marketplace', 'NGN', 4150, 'in_stock', 'https://www.jumia.com.ng/cerave-hydrating-hyaluronic-acid-serum-30ml-420211821.html'],
  ['cerave-blemish-control-gel', 'NG', 'Jumia Nigeria', null, 'marketplace', 'NGN', 2999, 'in_stock', 'https://www.jumia.com.ng/cerave-blemish-control-gel-with-ahabha-40ml-420162558.html'],
  ['lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria', null, 'retailer', 'NGN', 27103.4, 'in_stock', 'https://www.caretobeauty.com/ng/la-roche-posay-cicaplast-baume-b5-ultra-repairing-soothing-balm-40ml'],
  ['to-mandelic-acid-10-ha', 'KE', 'Jumia Kenya', null, 'marketplace', 'KES', 3800, 'in_stock', 'https://www.jumia.co.ke/the-ordinary-mandelic-acid-10-ha-328723982.html'],
  ['to-ascorbyl-glucoside-12', 'KE', 'Jumia Kenya', null, 'marketplace', 'KES', 1699, 'in_stock', 'https://www.jumia.co.ke/ascorbyl-glucoside-solution-12-vitamin-c-serum-water-based-antioxidant-face-serum-for-uneven-skin-tone-dullness-skin-smoothness-vegan-30ml-the-ordinary-mpg10747273.html'],
  ['cerave-blemish-control-gel', 'ZA', 'Dermastore', null, 'retailer', 'ZAR', 300, 'in_stock', 'https://dermastore.co.za/cerave-blemish-control-gel/']
];
const offerOf = (id, market, retailer) => P.offersOf(P.byId(id, REAL)).find(o => o.market === market && o.retailer === retailer);

test('V1 les 12 offres du catalogue réel correspondent exactement aux relevés fournis (produit, pays, vendeur, devise, prix, disponibilité, lien)', () => {
  const all = REAL.flatMap(p => P.offersOf(p).map(o => [p.id, o]));
  assert.equal(all.length, EXPECTED.length, 'aucune offre de plus ni de moins');
  for (const [id, market, retailer, seller, type, cur, price, avail, url] of EXPECTED) {
    const o = offerOf(id, market, retailer);
    assert.ok(o, id + ' / ' + market + ' / ' + retailer);
    assert.deepEqual([o.seller, o.type, o.currency, o.price, o.availability, o.url], [seller, type, cur, price, avail, url], id + ' / ' + market);
    assert.ok(o.source && o.source.length > 5, 'source : ' + id);
  }
});

test('V2 chaque offre porte market, country, currency, retailer, type, price, availability, url, source, checkedAt ; aucun prix sans devise ni source', () => {
  for (const p of REAL) for (const raw of p.offers) {
    assert.deepEqual(P.validateOffer(raw), [], p.id);
    for (const k of ['market', 'retailer', 'type', 'currency', 'price', 'availability', 'url', 'source', 'checkedAt']) assert.ok(raw[k] != null && raw[k] !== '', p.id + ' : ' + k);
    assert.ok(typeof raw.price === 'number' && raw.price > 0);
  }
  for (const p of REAL) for (const o of P.offersOf(p)) assert.ok(Market.byCode(o.market).fr === o.country, 'country dérivé du marché : ' + o.market);
});

test('V3 date : checkedAt = date d\'intégration (2026-10-07) pour les offres de l\'étape 16 ; jamais une date de publication ; Dermastore garde la sienne', () => {
  for (const [id, market, retailer] of EXPECTED) {
    const raw = P.byId(id, REAL).offers.find(o => o.market === market && o.retailer === retailer);
    assert.equal(raw.checkedAt, retailer === 'Dermastore' ? '2026-10-06' : DAY, id + ' / ' + market);
  }
  assert.match(read('js/engine/data/catalog.js'), /n'ont PAS pu être rouvertes depuis l'environnement d'intégration/, 'la méthode (relevés fournis, non rouverts) est documentée');
});

test('V4 pays couverts : Ghana, Nigeria, Kenya, Afrique du Sud, et eux seuls ; Bénin, Togo, Côte d\'Ivoire, Sénégal, Cameroun, Maroc sans offre (offers vides, pas « indisponible »)', () => {
  const markets = new Set(REAL.flatMap(p => P.offersOf(p).map(o => o.market)));
  assert.deepEqual([...markets].sort(), ['GH', 'KE', 'NG', 'ZA']);
  for (const m of ['BJ', 'TG', 'CI', 'SN', 'CM', 'MA']) for (const p of REAL) {
    const v = P.marketView(p, m);
    assert.equal(v.local.length, 0, m + ' / ' + p.id); assert.equal(v.regional.length, 0);
    assert.notEqual(v.tier, 'local');
  }
  for (const p of REAL) assert.ok(Array.isArray(p.offers), p.id + ' : offers[] présent (vide si aucune offre vérifiée)');
  assert.ok(REAL.some(p => p.offers.length === 0), 'des produits restent sans offre');
});

test('V5 Ghana, Nigeria, Kenya, Afrique du Sud : le pays choisi affiche d\'abord ses offres ; les autres pays restent derrière « autres pays »', () => {
  const cases = [['to-niacinamide-10-zinc-1', 'GH', ['Jumia Ghana'], ['Konga']], ['to-niacinamide-10-zinc-1', 'NG', ['Konga'], ['Jumia Ghana']],
    ['to-ascorbyl-glucoside-12', 'KE', ['Jumia Kenya'], ['Konga']], ['cerave-blemish-control-gel', 'ZA', ['Dermastore'], ['Jumia Nigeria']], ['cerave-blemish-control-gel', 'NG', ['Jumia Nigeria'], ['Dermastore']]];
  for (const [id, m, local, other] of cases) {
    const v = P.marketView(P.byId(id, REAL), m);
    assert.equal(v.tier, 'local'); assert.deepEqual(v.local.map(o => o.retailer), local, id + ' ' + m);
    assert.deepEqual(v.international.map(o => o.retailer), other, id + ' ' + m + ' : offres d\'ailleurs séparées');
    assert.ok(v.local.every(o => o.market === m) && v.international.every(o => o.market !== m));
  }
  const bj = P.marketView(P.byId('to-niacinamide-10-zinc-1', REAL), 'BJ');
  assert.equal(bj.tier, 'international', 'Bénin : aucune offre locale, offres d\'ailleurs seulement derrière le repli'); assert.equal(bj.local.length, 0);
});

test('V6 plusieurs offres pour un même produit et plusieurs devises : chacune dans sa devise, jamais convertie ni additionnée', () => {
  const nia = P.offersOf(P.byId('to-niacinamide-10-zinc-1', REAL));
  assert.deepEqual(nia.map(o => o.market + ':' + o.currency + ':' + o.price), ['GH:GHS:200', 'NG:NGN:9990']);
  const asc = P.offersOf(P.byId('to-ascorbyl-glucoside-12', REAL)); assert.deepEqual(new Set(asc.map(o => o.currency)), new Set(['KES', 'NGN']));
  const mand = P.offersOf(P.byId('to-mandelic-acid-10-ha', REAL)); assert.deepEqual(new Set(mand.map(o => o.currency)), new Set(['GHS', 'KES']));
  const blem = P.offersOf(P.byId('cerave-blemish-control-gel', REAL)); assert.deepEqual(new Set(blem.map(o => o.currency)), new Set(['ZAR', 'NGN']));
  const text = JSON.stringify(REAL);
  assert.doesNotMatch(text, /XOF[^}]{0,40}price|"converted|conversion|FCFA/i, 'aucun prix converti en FCFA');
  for (const p of REAL) assert.equal(P.commerceOf(p).price, null, 'aucun prix global');
  for (const raw of REAL.flatMap(p => p.offers)) assert.ok(raw.currency !== 'XOF' && raw.currency !== 'XAF', 'aucune offre en FCFA : aucun vendeur FCFA n\'a été vérifié');
});

test('V7 place de marché : Jumia et Konga restent des places de marché, avec le vendeur exact ; Clicks/Dermastore/Care to Beauty sont des revendeurs ; aucun n\'est présenté comme fabricant', () => {
  for (const [id, market, retailer, seller, type] of EXPECTED) {
    const o = offerOf(id, market, retailer);
    if (/^(Jumia|Konga)/.test(retailer)) { assert.equal(o.type, 'marketplace'); assert.equal(o.marketplace, true); assert.equal(o.typeLabel, 'Place de marché'); }
    else assert.equal(o.type, 'retailer');
    assert.notEqual(o.type, 'brand_site', retailer + ' n\'est pas le site du fabricant');
  }
  assert.equal(offerOf('cerave-hydrating-ha-serum', 'NG', 'Jumia Nigeria').seller, 'Annette Trudan');
  assert.deepEqual(P.offersOf(P.byId('to-ascorbyl-glucoside-12', REAL)).filter(o => o.market === 'NG').map(o => o.seller), ['smile time']);
  assert.match(copy().OFFER_TEXTS.marketplace, /DERMAI ne garantit pas l'authenticité/);
  assert.deepEqual(P.validateOffer({ market: 'NG', retailer: 'Konga', type: 'marketplace', availability: 'unknown', source: 's', checkedAt: DAY, seller: '' }).length > 0, true, 'seller vide refusé');
});
function copy() { return require('../js/engine/copy.fr.js'); }

test('V8 disponibilité : in_stock seulement quand la page affiche un stock ; unknown sinon ; « few units left » reste une note, pas un statut', () => {
  const inStock = EXPECTED.filter(e => e[7] === 'in_stock').map(e => e[0] + ':' + e[1] + ':' + e[2]).sort();
  assert.deepEqual(inStock, ['cerave-blemish-control-gel:NG:Jumia Nigeria', 'cerave-blemish-control-gel:ZA:Dermastore', 'cerave-hydrating-ha-serum:NG:Jumia Nigeria', 'lrp-cicaplast-baume-b5-plus:NG:Care to Beauty Nigeria',
    'to-ascorbyl-glucoside-12:KE:Jumia Kenya', 'to-mandelic-acid-10-ha:KE:Jumia Kenya', 'to-niacinamide-10-zinc-1:GH:Jumia Ghana']);
  for (const o of REAL.flatMap(p => P.offersOf(p))) assert.ok(P.OFFER_AVAILABILITY.includes(o.availability), 'aucun statut hors modèle');
  assert.equal(offerOf('to-niacinamide-10-zinc-1', 'GH', 'Jumia Ghana').stockNote, 'Peu d\'unités restantes');
  assert.equal(offerOf('to-mandelic-acid-10-ha', 'KE', 'Jumia Kenya').stockNote, 'Peu d\'unités restantes');
  assert.equal(offerOf('to-ascorbyl-glucoside-12', 'KE', 'Jumia Kenya').stockNote, '5 unités restantes');
  assert.equal(offerOf('lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria').stockNote, 'Prêt à expédier');
  const swanky = offerOf('to-mandelic-acid-10-ha', 'GH', 'Swanky Beauty Supply');
  assert.equal(swanky.availability, 'unknown', 'retrait proposé ≠ stock affiché'); assert.equal(swanky.city, 'Accra'); assert.equal(swanky.availabilityLabel, 'Disponibilité à vérifier');
  for (const o of REAL.flatMap(p => P.offersOf(p))) if (o.availability === 'unknown') { assert.equal(o.buyable, false); assert.equal(o.linkOnly, true, 'lien « Voir l\'offre », jamais « Acheter en ligne »'); }
  assert.ok(P.validateOffer({ market: 'GH', retailer: 'X', type: 'retailer', availability: 'few_units_left', source: 's', checkedAt: DAY }).length, 'statut inventé refusé');
});

test('V9 prix : 9 500 NGN (jamais le prix barré de 16 000), 27 103,40 NGN conservé tel quel, aucun prix sans source', () => {
  assert.equal(offerOf('to-salicylic-2-solution', 'NG', 'Konga').price, 9500);
  assert.ok(!REAL.flatMap(p => p.offers).some(o => o.price === 16000), 'le prix barré n\'est enregistré comme prix nulle part');
  assert.equal(offerOf('lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria').price, 27103.4);
  for (const raw of REAL.flatMap(p => p.offers)) assert.ok(raw.price == null || (raw.currency && raw.source && raw.checkedAt));
  assert.doesNotMatch(offerOf('to-salicylic-2-solution', 'NG', 'Konga').source, /16/, 'le prix barré n\'apparaît pas à l\'écran');
  assert.match(read('js/engine/data/catalog.js'), /le prix barré d'une annonce n'est jamais le prix actuel/);
});

test('V10 liens : https réels, exacts, sans paramètre ni suivi, sans lien de recherche, sans comparateur, sans affiliation', () => {
  const urls = REAL.flatMap(p => p.offers.map(o => o.url));
  assert.equal(new Set(urls).size, urls.length, 'un lien par offre');
  for (const u of urls) {
    assert.match(u, /^https:\/\//); assert.equal(new URL(u).search, '', 'aucun paramètre : ' + u); assert.equal(new URL(u).hash, '');
    assert.doesNotMatch(u, /utm_|affil|ref=|\/search|\?q=|pricecheck/i);
  }
  assert.doesNotMatch(JSON.stringify(REAL), /pricecheck|price ?check/i, 'PriceCheck (comparateur) n\'est ni vendeur ni source');
  assert.deepEqual(urls.sort(), EXPECTED.map(e => e[8]).sort());
});

test('V11 Care to Beauty : l\'offre du Nigeria est propre au Nigeria ; aucune livraison ailleurs affirmée ; aucune offre Ghana sans lien produit vérifié', () => {
  const raw = P.byId('lrp-cicaplast-baume-b5-plus', REAL).offers[0];
  assert.equal(raw.market, 'NG'); assert.equal(raw.shipping, null, 'livraison hors Nigeria non établie'); assert.equal(raw.servesMarkets, undefined);
  assert.match(raw.source, /livraison hors Nigeria non établie/);
  for (const m of ['BJ', 'GH', 'KE', 'TG', 'CI', 'SN', 'CM']) assert.equal(P.marketView(P.byId('lrp-cicaplast-baume-b5-plus', REAL), m).local.length, 0, 'Care to Beauty Nigeria n\'est pas Care to Beauty ' + m);
  const ctb = REAL.flatMap(p => p.offers.filter(o => /care to beauty/i.test(o.retailer)).map(o => o.market));
  assert.deepEqual(ctb, ['NG'], 'aucune offre Care to Beauty hors Nigeria : aucun lien produit ni prix vérifiés pour les autres pays');
  const view = P.marketView(P.byId('lrp-cicaplast-baume-b5-plus', REAL), 'BJ');
  assert.equal(view.international[0].shipping, null); assert.match(require('../js/engine/copy.fr.js').MARKET_TEXTS.shipCheck, /Vérifier la livraison/);
});

test('V12 aucun nouveau produit, aucun nouvel actif : le catalogue garde ses 13 produits et ses actifs', () => {
  assert.deepEqual(REAL.map(p => p.id), ['to-salicylic-2-solution', 'to-niacinamide-10-zinc-1', 'to-azelaic-acid-10', 'to-ascorbyl-glucoside-12', 'to-mandelic-acid-10-ha', 'to-hyaluronic-b5-ceramides', 'cerave-hydrating-ha-serum',
    'cerave-blemish-control-gel', 'lrp-effaclar-duo-m', 'lrp-cicaplast-baume-b5-plus', 'lrp-pure-vitamin-c10-serum', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum']);
  assert.deepEqual(P.validateCatalog(REAL), []);
  assert.doesNotMatch(JSON.stringify(REAL.map(p => p.id + p.name)), /vitamin c serum.*cerave|skin renewing/i, 'CeraVe Skin Renewing Vitamin C Serum n\'est pas au catalogue : ses offres ne sont pas intégrées');
  assert.ok(!REAL.some(p => /natural moisturizing/i.test(p.name)), 'NMF + HA absent du catalogue : non intégré');
});

test('V13 aucun impact moteur : 100 profils, catalogue avec offres vs sans offres → globalScore, priorités, objectifs, actifs, routine et produits identiques', () => {
  const stripped = REAL.map(p => Object.assign({}, p, { offers: [] }));
  const kinds = new Set();
  for (let seed = 1; seed <= 100; seed++) {
    const c = randomCase(seed * 7919), n = norm(c.ui, c.o);
    const a = Engine.run(n, c.profile, { catalog: REAL }), b = Engine.run(n, c.profile, { catalog: stripped });
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'profil #' + seed + ' : sortie complète identique');
    assert.equal(a.interpretation.globalScore, b.interpretation.globalScore);
    assert.deepEqual(a.priorities, b.priorities); assert.deepEqual(a.activePlan, b.activePlan); assert.deepEqual(a.routinePlan, b.routinePlan); assert.deepEqual(a.profile.goals, b.profile.goals);
    const va = P.catalogView(a.routinePlan, a.productMatches, REAL), vb = P.catalogView(b.routinePlan, b.productMatches, stripped);
    assert.deepEqual(va.recommended.map(r => r.productId), vb.recommended.map(r => r.productId), 'Recommandés identiques'); assert.deepEqual(va.others.map(r => r.productId), vb.others.map(r => r.productId), 'Autres produits identiques');
    kinds.add(a.priorities.mode + ':' + a.routinePlan.level);
  }
  assert.ok(kinds.size >= 3, 'profils variés : ' + [...kinds]);
});

test('V14 aucun appel externe : ni Perfect Corp, ni réseau dans les données d\'offres ; offres = données publiques', () => {
  const src = read('js/engine/data/catalog.js');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|perfectcorp|api_key|secret|token|service_role/i);
  assert.doesNotMatch(JSON.stringify(REAL), /apikey|api_key|secret|bearer|service_role|password/i);
});
