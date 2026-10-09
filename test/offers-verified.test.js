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
  ['cerave-blemish-control-gel', 'ZA', 'Dermastore', null, 'retailer', 'ZAR', 300, 'in_stock', 'https://dermastore.co.za/cerave-blemish-control-gel/'],
  /* étape 17 : CeraVe Skin Renewing Vitamin C Serum */
  ['cerave-skin-renewing-vitamin-c-serum', 'ZA', 'Clicks', null, 'retailer', 'ZAR', 550, 'in_stock', 'https://www.clicks.co.za/cerave_skin-renew-vitamin-c-serum-30ml/p/405225'],
  ['cerave-skin-renewing-vitamin-c-serum', 'KE', 'Cosmetics Kenya', null, 'retailer', 'KES', 4995, 'unknown', 'https://cosmetics.ke/skincare/vitamin-c-serums/cerave-vitamin-c-serum/'],
  ['cerave-skin-renewing-vitamin-c-serum', 'NG', 'Konga', null, 'marketplace', 'NGN', 25481, 'unknown', 'https://www.konga.com/product/cerave-skin-renewing-vitamin-c-serum-6770300']
];
/* Phase 3 : première offre béninoise (Lynia Shop), relevée par l'équipe DERMAI le 2026-10-08. Le lien exact de la fiche n'a pas été fourni : url null, jamais inventée. */
const BENIN = [['to-hyaluronic-b5-ceramides', 'BJ', 'Lynia Shop', null, 'retailer', 'XOF', 12700, 'in_stock', null]];
const offerOf = (id, market, retailer) => P.offersOf(P.byId(id, REAL) || { demo: true }).find(o => o.market === market && o.retailer === retailer);
const INV = require('./fixtures/catalog-inventory.js');
/* Les tableaux EXPECTED et BENIN sont des ENREGISTREMENTS de relevés : s'ils sont au catalogue, ils doivent y être tels qu'enregistrés (aucune retouche silencieuse). Ajouter d'autres offres, ou en retirer
   une par décision de données, ne casse aucun de ces tests ; les règles générales (valeurs du modèle, liens, devises, dates) valent pour TOUTES les offres. */
const rawOf = (id, market, retailer) => { const p = P.byId(id, REAL); return p ? (p.offers || []).find(o => o.market === market && o.retailer === retailer) || null : null; };
const ifPresent = (rows, fn) => { let n = 0; for (const row of rows) { const o = offerOf(row[0], row[1], row[2]); if (o) { n++; fn(row, o); } } return n; };
const SAME_ORDER_PREFIX = ['to-salicylic-2-solution', 'to-niacinamide-10-zinc-1', 'to-azelaic-acid-10', 'to-ascorbyl-glucoside-12', 'to-mandelic-acid-10-ha', 'to-hyaluronic-b5-ceramides', 'cerave-hydrating-ha-serum',
  'cerave-blemish-control-gel', 'cerave-skin-renewing-vitamin-c-serum', 'lrp-effaclar-duo-m', 'lrp-cicaplast-baume-b5-plus', 'lrp-pure-vitamin-c10-serum', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum'];

test('V1 les relevés enregistrés (étapes 16 et 17, puis Bénin) sont intacts s\'ils sont au catalogue : produit, pays, vendeur, devise, prix, disponibilité, lien ; toute offre a sa source', () => {
  const n = ifPresent(EXPECTED.concat(BENIN), ([id, market, , seller, type, cur, price, avail, url], o) => {
    assert.deepEqual([o.seller, o.type, o.currency, o.price, o.availability, o.url], [seller, type, cur, price, avail, url], id + ' / ' + market);
    assert.ok(o.source && o.source.length > 5, 'source : ' + id);
  });
  assert.ok(n > 0, 'au moins un relevé enregistré est encore au catalogue (le test n\'est pas vide)');
  for (const p of REAL) for (const o of p.offers) { assert.ok(o.source && o.source.length > 5, p.id + ' : source'); assert.ok(o.checkedAt, p.id + ' : date'); }
});

test('V2 chaque offre porte market, country, retailer, type, availability, source, checkedAt ; un prix a sa devise ; un lien absent est permis, un lien fourni est un https réel', () => {
  for (const p of REAL) for (const raw of p.offers) {
    assert.deepEqual(P.validateOffer(raw), [], p.id);
    for (const k of ['market', 'retailer', 'type', 'availability', 'source', 'checkedAt']) assert.ok(raw[k] != null && raw[k] !== '', p.id + ' : ' + k);
    if (raw.price != null) { assert.ok(typeof raw.price === 'number' && raw.price > 0, p.id + ' : prix'); assert.ok(raw.currency, p.id + ' : un prix exige sa devise'); }
    if (raw.url != null) assert.match(raw.url, /^https:\/\//, p.id + ' : un lien fourni est https');
  }
  for (const p of REAL) for (const o of P.offersOf(p)) assert.ok(Market.byCode(o.market).fr === o.country, 'country dérivé du marché : ' + o.market);
});

test('V3 date : checkedAt = date d\'intégration pour les relevés enregistrés ; jamais une date de publication ; Dermastore garde la sienne ; Bénin : 2026-10-08', () => {
  let n = 0;
  for (const [id, market, retailer] of EXPECTED) {
    const raw = rawOf(id, market, retailer); if (!raw) continue; n++;
    assert.equal(raw.checkedAt, retailer === 'Dermastore' ? '2026-10-06' : DAY, id + ' / ' + market);
    assert.equal(raw.verifiedAt, retailer === 'Dermastore' ? '2026-10-06' : undefined, 'seule la page Dermastore a été ouverte directement : aucune autre offre n\'est présentée comme vérifiée');
  }
  for (const [id, market, retailer] of BENIN) { const raw = rawOf(id, market, retailer); if (!raw) continue; n++; assert.equal(raw.checkedAt, '2026-10-08'); assert.equal(raw.verifiedAt, undefined, 'relevé fourni, page non rouverte'); }
  assert.ok(n > 0);
  for (const p of REAL) for (const o of p.offers) if (o.verifiedAt != null) assert.match(o.source, /ouverte directement/, p.id + ' : verifiedAt seulement pour une page réellement rouverte');
  assert.match(read('js/engine/data/catalog.js'), /n'ont PAS pu être rouvertes depuis l'environnement d'intégration/, 'la méthode (relevés fournis, non rouverts) est documentée');
});

test('V4 pays : toute offre porte un pays connu ; le pays choisi n\'affiche d\'offre « locale » que si une offre porte ce pays (jamais déduit) ; offers[] présent sur chaque produit', () => {
  const known = new Set(INV.countryCodes);
  assert.ok(INV.markets.every(m => known.has(m)), 'chaque pays d\'offre est un pays connu');
  for (const m of INV.countryCodes) for (const p of REAL) {
    const v = P.marketView(p, m), own = p.offers.filter(o => o.market === m && P.validateOffer(o, false).length === 0).length;
    assert.equal(v.local.length, own, m + ' / ' + p.id + ' : local = offres qui portent ce pays');
    assert.equal(v.tier === 'local', own > 0 && v.local.length > 0);
  }
  for (const p of REAL) assert.ok(Array.isArray(p.offers), p.id + ' : offers[] présent (vide si aucune offre vérifiée)');
});

test('V5 le pays choisi affiche d\'abord ses offres ; les offres des autres pays restent derrière « autres pays »', () => {
  const cases = [['to-niacinamide-10-zinc-1', 'GH', ['Jumia Ghana'], ['Konga']], ['to-niacinamide-10-zinc-1', 'NG', ['Konga'], ['Jumia Ghana']],
    ['to-ascorbyl-glucoside-12', 'KE', ['Jumia Kenya'], ['Konga']], ['cerave-blemish-control-gel', 'ZA', ['Dermastore'], ['Jumia Nigeria']], ['cerave-blemish-control-gel', 'NG', ['Jumia Nigeria'], ['Dermastore']]];
  let n = 0;
  for (const [id, m, local, other] of cases) {
    const p = P.byId(id, REAL); if (!p) continue;
    const v = P.marketView(p, m), loc = v.local.map(o => o.retailer), intl = v.international.map(o => o.retailer);
    if (local.every(r => rawOf(id, m, r))) { n++; assert.equal(v.tier, 'local'); for (const r of local) assert.ok(loc.includes(r), id + ' ' + m + ' : ' + r + ' est local'); }
    for (const r of other) if (p.offers.some(o => o.retailer === r && o.market !== m)) assert.ok(intl.includes(r), id + ' ' + m + ' : ' + r + ' vient d\'ailleurs');
    assert.ok(v.local.every(o => o.market === m) && v.international.every(o => o.market !== m), 'séparation locale / ailleurs');
    for (const r of local) assert.ok(!intl.includes(r), 'une offre locale n\'est pas rangée « ailleurs »');
  }
  assert.ok(n > 0);
  // le Bénin suit les offres qui le portent : local s\'il y en a, sinon un repli « ailleurs » quand d\'autres pays ont une offre sans livraison locale seulement
  for (const p of REAL) {
    const bj = P.marketView(p, 'BJ'), own = p.offers.filter(o => o.market === 'BJ' && P.validateOffer(o, false).length === 0).length;
    if (own > 0) assert.equal(bj.tier, 'local', p.id); else assert.notEqual(bj.tier, 'local', p.id + ' : aucune offre béninoise, jamais « local »');
    assert.equal(bj.local.length, own, p.id);
  }
});

test('V6 prix et devises : chaque offre dans sa devise, jamais convertie ni additionnée ; le FCFA (XOF) est une devise ordinaire du Bénin', () => {
  const nia = P.offersOf(P.byId('to-niacinamide-10-zinc-1', REAL) || { demo: true });
  for (const [market, cur, price] of [['GH', 'GHS', 200], ['NG', 'NGN', 9990]]) { const o = nia.find(x => x.market === market && x.retailer === (market === 'GH' ? 'Jumia Ghana' : 'Konga')); if (o) assert.deepEqual([o.currency, o.price], [cur, price], market); }
  for (const p of REAL) {
    for (const o of P.offersOf(p)) {
      assert.ok(o.price === null || (typeof o.price === 'number' && o.currency), p.id + ' : un prix a sa devise');
    }
    assert.equal(P.commerceOf(p).price, null, 'aucun prix global');
    for (const raw of p.offers) assert.ok(!Object.keys(raw).some(k => /^(convert|conversion|rate|fcfa|equivalent)/i.test(k)), p.id + ' : aucun champ de conversion');
  }
  assert.doesNotMatch(JSON.stringify(REAL), /"converted|"conversion/i, 'aucun prix converti');
  // devise et pays vont ensemble (jamais une devise de zone hors de sa zone) ; XOF accepté au Bénin, refusé au Nigeria
  for (const raw of REAL.flatMap(p => p.offers)) assert.deepEqual(P.validateOffer(raw), []);
  const base = { retailer: 'V', type: 'retailer', price: 1000, availability: 'in_stock', source: 's', checkedAt: '2026-10-08' };
  assert.deepEqual(P.validateOffer(Object.assign({ market: 'BJ', currency: 'XOF' }, base)), []);
  assert.ok(P.validateOffer(Object.assign({ market: 'NG', currency: 'XOF' }, base)).length, 'XOF refusé au Nigeria');
});

test('V7 place de marché : Jumia et Konga restent des places de marché, avec le vendeur exact ; Clicks/Dermastore/Care to Beauty sont des revendeurs ; aucun n\'est présenté comme fabricant', () => {
  const n = ifPresent(EXPECTED, ([, , retailer], o) => {
    if (/^(Jumia|Konga)/.test(retailer)) { assert.equal(o.type, 'marketplace'); assert.equal(o.marketplace, true); assert.equal(o.typeLabel, 'Place de marché'); }
    else assert.equal(o.type, 'retailer');
    assert.notEqual(o.type, 'brand_site', retailer + ' n\'est pas le site du fabricant');
  });
  assert.ok(n > 0);
  const jumiaNg = offerOf('cerave-hydrating-ha-serum', 'NG', 'Jumia Nigeria'); if (jumiaNg) assert.equal(jumiaNg.seller, 'Annette Trudan');
  const konga = rawOf('to-ascorbyl-glucoside-12', 'NG', 'Konga'); if (konga) assert.equal(konga.seller, 'smile time');
  assert.match(copy().OFFER_TEXTS.marketplace, /DERMAI ne garantit pas l'authenticité/);
  assert.deepEqual(P.validateOffer({ market: 'NG', retailer: 'Konga', type: 'marketplace', availability: 'unknown', source: 's', checkedAt: DAY, seller: '' }).length > 0, true, 'seller vide refusé');
  // règle générale : une place de marché (type marketplace) est toujours présentée comme telle, jamais comme le site du fabricant
  for (const p of REAL) for (const o of P.offersOf(p)) assert.equal(o.marketplace, o.type === 'marketplace');
});
function copy() { return require('../js/engine/copy.fr.js'); }

test('V8 disponibilité : in_stock seulement quand la page affiche un stock ; unknown sinon ; « few units left » reste une note, pas un statut', () => {
  const n = ifPresent(EXPECTED, ([, , , , , , , avail], o) => assert.equal(o.availability, avail));   // relevés enregistrés : le statut enregistré, ni plus ni moins
  assert.ok(n > 0);
  for (const o of REAL.flatMap(p => P.offersOf(p))) assert.ok(P.OFFER_AVAILABILITY.includes(o.availability), 'aucun statut hors modèle');
  const note = (id, m, r, txt) => { const o = offerOf(id, m, r); if (o) assert.equal(o.stockNote, txt); };
  note('to-niacinamide-10-zinc-1', 'GH', 'Jumia Ghana', 'Peu d\'unités restantes');
  note('to-mandelic-acid-10-ha', 'KE', 'Jumia Kenya', 'Peu d\'unités restantes');
  note('to-ascorbyl-glucoside-12', 'KE', 'Jumia Kenya', '5 unités restantes');
  note('lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria', 'Prêt à expédier');
  const swanky = offerOf('to-mandelic-acid-10-ha', 'GH', 'Swanky Beauty Supply');
  if (swanky) { assert.equal(swanky.availability, 'unknown', 'retrait proposé ≠ stock affiché'); assert.equal(swanky.city, 'Accra'); assert.equal(swanky.availabilityLabel, 'Disponibilité à vérifier'); }
  // unknown ne donne jamais « Acheter en ligne » ; un lien (s\'il existe) devient « Voir l\'offre », sans lien il n\'y a aucun bouton
  for (const o of REAL.flatMap(p => P.offersOf(p))) if (o.availability === 'unknown') { assert.equal(o.buyable, false); assert.equal(o.linkOnly, !!o.url, 'lien « Voir l\'offre » seulement s\'il existe, jamais « Acheter en ligne »'); }
  assert.ok(P.validateOffer({ market: 'GH', retailer: 'X', type: 'retailer', availability: 'few_units_left', source: 's', checkedAt: DAY }).length, 'statut inventé refusé');
});

test('V9 prix : 9 500 NGN (jamais le prix barré de 16 000), 27 103,40 NGN conservé tel quel, aucun prix sans source', () => {
  const sal = rawOf('to-salicylic-2-solution', 'NG', 'Konga'); if (sal) { assert.equal(sal.price, 9500); assert.doesNotMatch(sal.source, /16/, 'le prix barré n\'apparaît pas à l\'écran'); }
  assert.ok(!REAL.flatMap(p => p.offers).some(o => o.price === 16000), 'le prix barré n\'est enregistré comme prix nulle part');
  const cic = rawOf('lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria'); if (cic) assert.equal(cic.price, 27103.4);
  for (const raw of REAL.flatMap(p => p.offers)) assert.ok(raw.price == null || (raw.currency && raw.source && raw.checkedAt));
  assert.match(read('js/engine/data/catalog.js'), /le prix barré d'une annonce n'est jamais le prix actuel/);
});

test('V10 liens : https réels, exacts, sans paramètre ni suivi, sans lien de recherche, sans comparateur, sans affiliation ; un lien absent est permis', () => {
  const urls = REAL.flatMap(p => p.offers.map(o => o.url)).filter(u => u != null);   // un lien absent n\'est pas une erreur : seul un lien fourni est contrôlé
  assert.equal(new Set(urls).size, urls.length, 'un lien par offre');
  for (const u of urls) {
    assert.match(u, /^https:\/\//); assert.equal(new URL(u).search, '', 'aucun paramètre : ' + u); assert.equal(new URL(u).hash, '');
    assert.doesNotMatch(u, /utm_|affil|ref=|\/search|\?q=|pricecheck/i);
  }
  assert.doesNotMatch(JSON.stringify(REAL), /pricecheck|price ?check/i, 'PriceCheck (comparateur) n\'est ni vendeur ni source');
  for (const [id, market, retailer, , , , , , url] of EXPECTED) { const raw = rawOf(id, market, retailer); if (raw) assert.equal(raw.url, url, id + ' / ' + market + ' : lien tel que fourni'); }
});

test('V11 Care to Beauty : chaque offre est propre à son pays ; aucune livraison ailleurs affirmée ; le pays d\'une offre n\'est jamais déduit', () => {
  const ctb = rawOf('lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria');
  if (ctb) { assert.equal(ctb.shipping, null, 'livraison hors Nigeria non établie'); assert.equal(ctb.servesMarkets, undefined); assert.match(ctb.source, /livraison hors Nigeria non établie/); }
  const cp = P.byId('lrp-cicaplast-baume-b5-plus', REAL);
  for (const m of INV.countryCodes) assert.equal(P.marketView(cp, m).local.length, cp.offers.filter(o => o.market === m).length, 'une offre n\'est locale que dans son pays : ' + m);
  for (const p of REAL) for (const o of p.offers.filter(x => /care to beauty/i.test(x.retailer))) if (o.url) assert.match(new URL(o.url).pathname, new RegExp('^/' + o.market.toLowerCase() + '/'), 'la boutique Care to Beauty d\'un pays ne sert que ce pays');
  const view = P.marketView(cp, 'TG');
  if (view.international.length) assert.ok(view.international.every(o => o.shipping === null || o.shipping === 'international'));
  assert.match(require('../js/engine/copy.fr.js').MARKET_TEXTS.shipCheck, /Vérifier la livraison/);
});

test('V12 catalogue : les 14 produits historiques sont toujours là, dans le même ordre, en tête ; les ajouts viennent après ; aucun nouvel actif', () => {
  assert.deepEqual(REAL.slice(0, SAME_ORDER_PREFIX.length).map(p => p.id), SAME_ORDER_PREFIX, 'les produits existants gardent leur ordre (ajouter un produit ne casse rien)');
  assert.equal(new Set(REAL.map(p => p.id)).size, REAL.length, 'chaque id est unique');
  assert.deepEqual(P.validateCatalog(REAL), []);
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
