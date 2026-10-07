'use strict';
/* Étape 20 : cohérence de la couche commerciale V1. Le MOTEUR décide du produit ; le MARCHÉ explique comment le trouver. Les relevés ci-dessous sont les données déjà intégrées :
   ce ne sont PAS des vérifications faites par DERMAI (checkedAt = date du relevé ; verifiedAt n'existe que pour une page réellement rouverte). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const MD = require('../js/engine/data/markets.js');
const Market = require('../js/market.js');
const copy = require('../js/engine/copy.fr.js');

const REAL = CAT.PRODUCTS, USABLE = P.usable(REAL), read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const rawOffers = () => REAL.flatMap(p => (p.offers || []).map(o => [p.id, o]));

/* Les 14 offres de l'énoncé de l'étape 20 (A à N) + Dermastore (étape 14B) : produit, pays, vendeur, devise, prix, état attendu */
const LIST = [
  ['A', 'to-niacinamide-10-zinc-1', 'GH', 'Jumia Ghana', 'GHS', 200, 'ready'], ['B', 'to-mandelic-acid-10-ha', 'GH', 'Swanky Beauty Supply', 'GHS', 220, 'partial'],
  ['C', 'to-salicylic-2-solution', 'NG', 'Konga', 'NGN', 9500, 'partial'], ['D', 'to-niacinamide-10-zinc-1', 'NG', 'Konga', 'NGN', 9990, 'partial'],
  ['E', 'to-azelaic-acid-10', 'NG', 'Konga', 'NGN', 22000, 'partial'], ['F', 'to-ascorbyl-glucoside-12', 'NG', 'Konga', 'NGN', 10000, 'partial'],
  ['G', 'cerave-hydrating-ha-serum', 'NG', 'Jumia Nigeria', 'NGN', 4150, 'ready'], ['H', 'cerave-blemish-control-gel', 'NG', 'Jumia Nigeria', 'NGN', 2999, 'ready'],
  ['I', 'lrp-cicaplast-baume-b5-plus', 'NG', 'Care to Beauty Nigeria', 'NGN', 27103.4, 'ready'], ['J', 'to-mandelic-acid-10-ha', 'KE', 'Jumia Kenya', 'KES', 3800, 'ready'],
  ['K', 'to-ascorbyl-glucoside-12', 'KE', 'Jumia Kenya', 'KES', 1699, 'ready'], ['L', 'cerave-skin-renewing-vitamin-c-serum', 'ZA', 'Clicks', 'ZAR', 550, 'ready'],
  ['M', 'cerave-skin-renewing-vitamin-c-serum', 'KE', 'Cosmetics Kenya', 'KES', 4995, 'partial'], ['N', 'cerave-skin-renewing-vitamin-c-serum', 'NG', 'Konga', 'NGN', 25481, 'partial'],
  ['—', 'cerave-blemish-control-gel', 'ZA', 'Dermastore', 'ZAR', 300, 'ready']
];

test('U1 les 15 offres intégrées = la liste de l\'étape 20 (produit, pays, vendeur, devise, prix, état ready / partial) ; rien de plus, rien de moins ; prix et devise tels quels', () => {
  const all = USABLE.flatMap(p => P.offersOf(p).map(o => [p.id, o]));
  assert.equal(all.length, LIST.length); assert.equal(REAL.reduce((n, p) => n + p.offers.length, 0), LIST.length);
  for (const [, id, market, retailer, cur, price, quality] of LIST) {
    const o = all.find(([pid, x]) => pid === id && x.market === market && x.retailer === retailer);
    assert.ok(o, id + ' / ' + market + ' / ' + retailer);
    assert.deepEqual([o[1].currency, o[1].price, o[1].quality], [cur, price, quality], id + ' / ' + market);
    assert.equal(o[1].buyable, quality === 'ready'); assert.equal(o[1].linkOnly, quality === 'partial');
  }
  assert.deepEqual([...new Set(all.map(([, o]) => o.market))].sort(), ['GH', 'KE', 'NG', 'ZA']);
  assert.deepEqual(P.QUALITY, ['ready', 'partial', 'unavailable']);
  for (const [, o] of rawOffers()) { assert.equal(typeof o.price, 'number'); assert.ok(!['XOF', 'XAF'].includes(o.currency), 'aucun prix converti en FCFA'); assert.ok(['GHS', 'NGN', 'KES', 'ZAR'].includes(o.currency)); }
});

test('U2 liens : https, hôte cohérent avec le vendeur et le pays, fiche produit directe (pas de recherche, de comparateur ni d\'affiliation), identiques à ceux fournis', () => {
  const HOST = { 'Jumia Ghana': /^www\.jumia\.com\.gh$/, 'Jumia Nigeria': /^www\.jumia\.com\.ng$/, 'Jumia Kenya': /^www\.jumia\.co\.ke$/, Konga: /^www\.konga\.com$/, 'Swanky Beauty Supply': /^www\.swankybeautygh\.com$/,
    'Care to Beauty Nigeria': /^www\.caretobeauty\.com$/, Clicks: /^www\.clicks\.co\.za$/, 'Cosmetics Kenya': /^cosmetics\.ke$/, Dermastore: /^dermastore\.co\.za$/ };
  const TLD = { GH: /\.gh$|\.com$/, NG: /\.ng$|\.com$/, KE: /\.ke$/, ZA: /\.za$/ };
  const seen = new Set();
  for (const [id, o] of rawOffers()) {
    const u = new URL(o.url);
    assert.equal(u.protocol, 'https:'); assert.ok(HOST[o.retailer].test(u.hostname), o.retailer + ' ↔ ' + u.hostname);
    assert.ok(TLD[o.market].test(u.hostname), 'domaine cohérent avec le pays : ' + u.hostname + ' / ' + o.market);
    assert.equal(u.search, ''); assert.equal(u.hash, ''); assert.ok(u.pathname.split('/').filter(Boolean).length >= 1 && u.pathname.length > 8, 'chemin de fiche : ' + u.pathname);
    assert.doesNotMatch(o.url, /\/search|\/recherche|[?&]q=|catalogsearch|pricecheck|compare|affil|utm_|\bref=|aff_|tag=|clickid|awin|shareasale|go\.|redirect/i, o.url);
    if (o.retailer === 'Care to Beauty Nigeria') assert.match(u.pathname, /^\/ng\//, 'boutique du Nigeria, pas une autre boutique pays');
    assert.ok(!seen.has(o.url), 'un lien par offre'); seen.add(o.url);
    assert.equal(P.byId(id, REAL).demo, false);
  }
  const marketOf = { 'Jumia Ghana': 'GH', 'Jumia Nigeria': 'NG', 'Jumia Kenya': 'KE', 'Care to Beauty Nigeria': 'NG', Clicks: 'ZA', 'Cosmetics Kenya': 'KE', Dermastore: 'ZA', 'Swanky Beauty Supply': 'GH' };
  for (const [, o] of rawOffers()) if (marketOf[o.retailer]) assert.equal(o.market, marketOf[o.retailer], o.retailer + ' appartient à son marché explicite');
});

test('U3 checkedAt ≠ verifiedAt : « Relevé le … » toujours ; jamais « Vérifié » à l\'écran ; verifiedAt seulement pour une page réellement rouverte (Dermastore)', () => {
  for (const [id, o] of rawOffers()) {
    assert.match(o.checkedAt, /^2026-10-0[67]$/);
    if (o.retailer === 'Dermastore') { assert.equal(o.verifiedAt, '2026-10-06'); assert.match(o.source, /ouverte directement/); }
    else assert.equal(o.verifiedAt, undefined, id + ' / ' + o.retailer + ' : relevé repris, pas une vérification');
  }
  for (const p of USABLE) for (const o of P.offersOf(p)) assert.equal(o.verifiedAt, o.retailer === 'Dermastore' ? '2026-10-06' : null);
  const app = strip(read('js/app.js'));
  assert.match(app, /Relevé le \$\{dFr\(o\.checkedAt\)\} \(\$\{esc\(o\.source\)\}\)/);
  assert.doesNotMatch(app.slice(app.indexOf('const offerRow='), app.indexOf('const byCountry=')), /verifiedAt|[Vv]érifiée? (le|par)/, 'la ligne d\'offre n\'affiche jamais « vérifié » : seul le relevé est montré');
  assert.doesNotMatch(app, /Vérifié le|Vérifiée le|vérifiée par DERMAI|vérifié par DERMAI|Prix vérifié|Stock vérifié/i);
  assert.ok(P.validateOffer({ market: 'GH', retailer: 'X', type: 'retailer', availability: 'unknown', source: 's', checkedAt: '2026-10-07', verifiedAt: 'hier' }).length, 'verifiedAt doit être une vraie date');
});

test('U4 textes commerciaux : aucune garantie de prix, de stock ou de livraison ; aucune hypothèse de livraison ; aucun comparatif (meilleur vendeur, meilleure offre) ; aucun prix converti ou estimé', () => {
  const all = JSON.stringify([copy.OFFER_TEXTS, copy.MARKET_TEXTS, copy.OFFER_AVAILABILITY_LABELS, copy.OFFER_TYPE_LABELS]);
  const app = strip(read('js/app.js'));
  const commerceUi = app.slice(app.indexOf('const marketSelect='), app.indexOf('V.products=')) + app.slice(app.indexOf('const offersBlock='), app.indexOf('const priceLine='));
  const BAN = /garanti(?!t pas)|disponible actuellement|disponible en ligne|stock réel|en temps réel|prix estimé|équivalent|économi|prix (minimum|moyen)|meilleur(e)? (vendeur|offre|produit|prix)|le moins cher|livraison disponible en afrique|livraison disponible|expédition vers|expédié vers|livré (au|en|partout)|livraison partout|livraison gratuite|livraison en \d/i;
  assert.doesNotMatch(all, BAN); assert.doesNotMatch(commerceUi, BAN);
  // les seules phrases de livraison : conditionnelles (donnée renseignée) ou invitation à vérifier
  const ship = [...(all + commerceUi).matchAll(/[^."`]*livraison[^."`]*/gi)].map(m => m[0].trim());
  for (const s of ship) assert.match(s, /vérifi|annoncée|selon (votre|le) pays|dépend|n'est pas vérifiée|\$\{|o\.shipping|shipping|tier|MT\.|Engine|ship/i, 'phrase de livraison non conditionnelle : ' + s);
  assert.match(copy.OFFER_TEXTS.international, /annoncée par le vendeur/); assert.doesNotMatch(copy.OFFER_TEXTS.international, /^Disponible/);
  assert.doesNotMatch(app + read('js/market.js'), /convertCurrency|exchangeRate|toFCFA|fcfaEquivalent|≈/);
  assert.equal(copy.MARKET_TEXTS.summary.none, 'Aucune offre vérifiée pour ce pays pour le moment.');
  assert.equal(copy.MARKET_TEXTS.summary.elsewhere, 'Offres dans d\'autres pays seulement');
  // aucune donnée du catalogue ne porte de livraison inventée
  for (const [, o] of rawOffers()) { assert.equal(o.shipping, null); assert.equal(o.servesMarkets, undefined); }
});

test('U5 54 pays × 11 produits utilisables = 594 cas : local / ailleurs seulement / aucune offre ; message neutre ; aucune erreur ; jamais « indisponible » faute de données', () => {
  const counts = { local: 0, elsewhere: 0, none: 0 }, pairs = [];
  for (const c of MD.COUNTRIES) for (const p of USABLE) {
    const v = P.marketView(p, c.code); pairs.push([c.code, p.id, v.summary]);
    assert.ok(['ready', 'partial', 'unavailable', 'elsewhere', 'none'].includes(v.summary));
    if (v.summary === 'none') { counts.none++; assert.equal(p.offers.length, 0); assert.equal(copy.MARKET_TEXTS.summary.none, 'Aucune offre vérifiée pour ce pays pour le moment.'); assert.doesNotMatch(copy.MARKET_TEXTS.summary.none, /indisponible/i); }
    else if (v.summary === 'elsewhere') { counts.elsewhere++; assert.equal(v.local.length, 0); assert.ok(v.international.length > 0); assert.ok(v.international.every(o => o.market !== c.code)); }
    else { counts.local++; assert.ok(v.local.length + v.regional.length > 0); assert.ok(v.local.every(o => o.market === c.code)); }
  }
  assert.equal(pairs.length, 594); assert.deepEqual(counts, { local: 15, elsewhere: 471, none: 108 });
  for (const code of ['BJ', 'TG', 'CI', 'SN', 'CM', 'MA']) for (const p of USABLE) assert.notEqual(['ready', 'partial', 'unavailable'].includes(P.marketView(p, code).summary), true, code + ' : aucune offre locale inventée');
  const who = c => USABLE.filter(p => ['ready', 'partial', 'unavailable'].includes(P.marketView(p, c).summary)).length;
  assert.deepEqual(['GH', 'NG', 'KE', 'ZA'].map(who), [2, 8, 3, 2]);
});

test('U6 plusieurs offres, trois états : prête, à vérifier, indisponible dans un même pays → classées dans cet ordre, chacune avec son bouton ; le produit et la section ne changent pas', () => {
  const base = P.byId('cerave-blemish-control-gel', REAL);
  const o = x => Object.assign({ market: 'KE', retailer: 'V', type: 'retailer', currency: 'KES', price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/p', shipping: null, source: 'test', checkedAt: '2026-10-07' }, x);
  const p = Object.assign({}, base, { id: 'multi', offers: [o({ retailer: 'C rupture', availability: 'out_of_stock', url: 'https://boutique-vraie.org/c' }), o({ retailer: 'B inconnu', availability: 'unknown', url: 'https://boutique-vraie.org/b' }), o({ retailer: 'A prête', url: 'https://boutique-vraie.org/a' }), o({ retailer: 'D bientôt', availability: 'coming_soon', url: 'https://boutique-vraie.org/d' })] });
  const v = P.marketView(p, 'KE');
  assert.deepEqual(v.local.map(x => [x.retailer, x.quality, x.buyable, x.linkOnly]), [['A prête', 'ready', true, false], ['B inconnu', 'partial', false, true], ['C rupture', 'unavailable', false, false], ['D bientôt', 'unavailable', false, false]]);
  assert.equal(v.summary, 'ready'); assert.equal(v.tier, 'local');
  assert.doesNotMatch(JSON.stringify(v), /meilleur|best|"rank"|score/i);
});
