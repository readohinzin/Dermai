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
const rawOffers = () => REAL.flatMap(p => (p.offers || []).map(o => [p.id, o]));   // TOUTES les offres du catalogue observé (jamais un compteur recopié)
/* Les relevés ci-dessous (LIST) sont des ENREGISTREMENTS : s'ils sont présents dans le catalogue, ils doivent y être tels qu'enregistrés ; en ajouter d'autres ou en retirer un
   ne casse aucun test (les règles générales valent pour TOUTES les offres). */
const recordedRaw = (id, market, retailer) => { const p = REAL.find(x => x.id === id); return p ? (p.offers || []).find(o => o.market === market && o.retailer === retailer) || null : null; };
const RECORDED_DATES = /^2026-10-0[6-7]$/;

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

test('U1 les relevés enregistrés (étape 20) sont intacts s\'ils sont au catalogue : produit, pays, vendeur, devise, prix, état ready / partial ; règles de devise et de prix valables pour TOUTES les offres', () => {
  const all = USABLE.flatMap(p => P.offersOf(p).map(o => [p.id, o]));
  assert.equal(all.length, USABLE.reduce((n, p) => n + (p.offers || []).filter(o => P.validateOffer(o, false).length === 0).length, 0), 'toute offre valide d\'un produit utilisable est présentée, aucune de plus');
  let found = 0;
  for (const [, id, market, retailer, cur, price, quality] of LIST) {
    const o = all.find(([pid, x]) => pid === id && x.market === market && x.retailer === retailer);
    if (!o) continue;                         // un relevé retiré par une décision de données n'est pas une régression
    found++;
    assert.deepEqual([o[1].currency, o[1].price, o[1].quality], [cur, price, quality], id + ' / ' + market);
    assert.equal(o[1].buyable, quality === 'ready'); assert.equal(o[1].linkOnly, quality === 'partial');
  }
  assert.ok(found > 0, 'au moins un relevé enregistré est encore au catalogue (le test n\'est pas vide)');
  const countries = new Set(MD.COUNTRIES.map(c => c.code));
  assert.ok(all.every(([, o]) => countries.has(o.market)), 'chaque offre porte un pays connu');
  assert.deepEqual(P.QUALITY, ['ready', 'partial', 'unavailable']);
  // règles générales de prix et de devise : un prix est un nombre, avec sa devise, cohérente avec son pays (le FCFA est un cas ordinaire) ; aucune conversion
  for (const [, o] of rawOffers()) {
    assert.deepEqual(P.validateOffer(o), []);
    if (o.price != null) { assert.equal(typeof o.price, 'number'); assert.ok(o.price > 0 && o.currency, 'un prix exige sa devise'); }
    assert.ok(!Object.keys(o).some(k => /^(convert|conversion|rate|fcfa|equivalent)/i.test(k)), 'aucun champ de conversion');
  }
  assert.ok(P.validateOffer({ market: 'BJ', retailer: 'V', type: 'retailer', currency: 'XOF', price: 9000, availability: 'in_stock', source: 's', checkedAt: '2026-10-08' }).length === 0, 'XOF accepté au Bénin');
});

test('U2 liens : https, hôte cohérent avec le vendeur et le pays, fiche produit directe (pas de recherche, de comparateur ni d\'affiliation), identiques à ceux fournis', () => {
  const HOST = { 'Jumia Ghana': /^www\.jumia\.com\.gh$/, 'Jumia Nigeria': /^www\.jumia\.com\.ng$/, 'Jumia Kenya': /^www\.jumia\.co\.ke$/, Konga: /^www\.konga\.com$/, 'Swanky Beauty Supply': /^www\.swankybeautygh\.com$/,
    'Care to Beauty Nigeria': /^www\.caretobeauty\.com$/, Clicks: /^www\.clicks\.co\.za$/, 'Cosmetics Kenya': /^cosmetics\.ke$/, Dermastore: /^dermastore\.co\.za$/ };
  const TLD = { GH: /\.gh$|\.com$/, NG: /\.ng$|\.com$/, KE: /\.ke$/, ZA: /\.za$/ };
  const seen = new Set();
  for (const [id, o] of rawOffers()) {
    if (o.url == null) continue;               // un lien absent est permis par le modèle (offre « partielle », sans bouton) ; seul un lien fourni est contrôlé
    const u = new URL(o.url);
    assert.equal(u.protocol, 'https:');
    if (HOST[o.retailer]) { assert.ok(HOST[o.retailer].test(u.hostname), o.retailer + ' ↔ ' + u.hostname); if (TLD[o.market]) assert.ok(TLD[o.market].test(u.hostname), 'domaine cohérent avec le pays : ' + u.hostname + ' / ' + o.market); }   // hôtes connus seulement
    assert.equal(u.search, ''); assert.equal(u.hash, ''); assert.ok(u.pathname.split('/').filter(Boolean).length >= 1 && u.pathname.length > 8, 'chemin de fiche : ' + u.pathname);
    assert.doesNotMatch(o.url, /\/search|\/recherche|[?&]q=|catalogsearch|pricecheck|compare|affil|utm_|\bref=|aff_|tag=|clickid|awin|shareasale|go\.|redirect/i, o.url);
    if (o.retailer === 'Care to Beauty Nigeria') assert.match(u.pathname, /^\/ng\//, 'boutique du Nigeria, pas une autre boutique pays');
    if (/care to beauty/i.test(o.retailer)) assert.match(u.pathname, new RegExp('^/' + o.market.toLowerCase() + '/'), 'boutique Care to Beauty du pays de l\'offre');
    assert.ok(!seen.has(o.url), 'un lien par offre'); seen.add(o.url);
    assert.equal(P.byId(id, REAL).demo, false);
  }
  for (const [, o] of rawOffers()) if (o.url != null) assert.ok(/pricecheck/i.test(o.url) === false);
  const marketOf = { 'Jumia Ghana': 'GH', 'Jumia Nigeria': 'NG', 'Jumia Kenya': 'KE', 'Care to Beauty Nigeria': 'NG', Clicks: 'ZA', 'Cosmetics Kenya': 'KE', Dermastore: 'ZA', 'Swanky Beauty Supply': 'GH' };
  for (const [, o] of rawOffers()) if (marketOf[o.retailer]) assert.equal(o.market, marketOf[o.retailer], o.retailer + ' appartient à son marché explicite');   // vendeurs connus seulement
});

test('U3 checkedAt ≠ verifiedAt : « Relevé le … » toujours ; jamais « Vérifié » à l\'écran ; verifiedAt seulement pour une page réellement rouverte (Dermastore)', () => {
  for (const [id, o] of rawOffers()) {
    assert.match(o.checkedAt, /^\d{4}-\d{2}-\d{2}$/, 'toute offre a sa date de relevé');
    if (o.verifiedAt != null) assert.match(o.source, /ouverte directement/, id + ' / ' + o.retailer + ' : verifiedAt seulement pour une page réellement rouverte');
  }
  for (const [, id, market, retailer] of LIST) {            // relevés enregistrés : la date est celle du relevé ; seul Dermastore a été rouvert
    const o = recordedRaw(id, market, retailer); if (!o) continue;
    assert.match(o.checkedAt, RECORDED_DATES);
    if (retailer === 'Dermastore') { assert.equal(o.verifiedAt, '2026-10-06'); assert.match(o.source, /ouverte directement/); }
    else assert.equal(o.verifiedAt, undefined, id + ' / ' + retailer + ' : relevé repris, pas une vérification');
  }
  for (const p of USABLE) for (const raw of (p.offers || [])) { const o = P.offersOf(p).find(x => x.market === raw.market && x.retailer === raw.retailer && x.url === (raw.url || null)); assert.ok(o); assert.equal(o.verifiedAt, raw.verifiedAt || null); }
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
  for (const [, id, market, retailer] of LIST) { const o = recordedRaw(id, market, retailer); if (o) { assert.equal(o.shipping, null); assert.equal(o.servesMarkets, undefined); } }   // relevés enregistrés : aucune livraison déduite
  for (const [, o] of rawOffers()) assert.ok(o.shipping == null || ['local', 'international'].includes(o.shipping), 'livraison : valeur du modèle seulement');
});

test('U5 pays × produits utilisables : local / ailleurs seulement / aucune offre ; message neutre ; aucune erreur ; jamais « indisponible » faute de données (comptes dérivés de l\'inventaire)', () => {
  /* Oracle indépendant du classement par qualité : une offre est « du pays » si son marché est le pays ou si le vendeur déclare le desservir ; « ailleurs » si elle vient d\'un autre pays
     sans livraison locale seulement ; sinon rien. Les comptes attendus viennent des offres brutes, jamais d\'un nombre recopié. */
  const validRaw = p => (p.offers || []).filter(o => P.validateOffer(o, false).length === 0);
  const mine = (p, c) => validRaw(p).filter(o => o.market === c || (o.servesMarkets || []).includes(c));
  const elsewhere = (p, c) => validRaw(p).filter(o => o.market !== c && !(o.servesMarkets || []).includes(c) && o.shipping !== 'local');
  const oracle = (p, c) => mine(p, c).length ? 'mine' : elsewhere(p, c).length ? 'elsewhere' : 'none';
  const counts = { local: 0, elsewhere: 0, none: 0 }, expected = { local: 0, elsewhere: 0, none: 0 }, pairs = [];
  for (const c of MD.COUNTRIES) for (const p of USABLE) {
    const v = P.marketView(p, c.code); pairs.push([c.code, p.id, v.summary]);
    assert.ok(['ready', 'partial', 'unavailable', 'elsewhere', 'none'].includes(v.summary));
    const o = oracle(p, c.code); expected[o === 'mine' ? 'local' : o]++;
    if (v.summary === 'none') { counts.none++; assert.equal(o, 'none', c.code + ' / ' + p.id); assert.equal(copy.MARKET_TEXTS.summary.none, 'Aucune offre vérifiée pour ce pays pour le moment.'); assert.doesNotMatch(copy.MARKET_TEXTS.summary.none, /indisponible/i); }
    else if (v.summary === 'elsewhere') { counts.elsewhere++; assert.equal(o, 'elsewhere', c.code + ' / ' + p.id); assert.equal(v.local.length, 0); assert.ok(v.international.length > 0); assert.ok(v.international.every(x => x.market !== c.code)); }
    else { counts.local++; assert.equal(o, 'mine', c.code + ' / ' + p.id); assert.ok(v.local.length + v.regional.length > 0); assert.ok(v.local.every(x => x.market === c.code)); }
  }
  assert.equal(pairs.length, MD.COUNTRIES.length * USABLE.length, 'une ligne par pays et par produit utilisable');
  assert.deepEqual(counts, expected, 'comptes identiques à ceux des offres brutes');
  // aucune offre locale inventée : pour tout pays, les offres « du pays » affichées sont exactement celles qui portent ce pays
  for (const c of MD.COUNTRIES) for (const p of USABLE) assert.equal(P.marketView(p, c.code).local.length, validRaw(p).filter(o => o.market === c.code).length, c.code + ' / ' + p.id + ' : aucune offre locale inventée');
  const who = c => USABLE.filter(p => ['ready', 'partial', 'unavailable'].includes(P.marketView(p, c).summary)).length;
  for (const c of ['GH', 'NG', 'KE', 'ZA', 'BJ']) assert.equal(who(c), USABLE.filter(p => mine(p, c).length > 0).length, c);
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
