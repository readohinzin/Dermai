'use strict';
/* Qualité des offres : un classement grossier pour l'AFFICHAGE, après la recommandation. Chaîne : actif → produits compatibles → exclusions / approche douce → CHOIX DU PRODUIT
   (moteur, inchangé) → offres du pays → qualité de l'offre. Le pays et la qualité ne font jamais passer un produit d'une section à l'autre. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const Market = require('../js/market.js');
const copy = require('../js/engine/copy.fr.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const REAL = CAT.PRODUCTS, read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const off = o => Object.assign({ retailer: 'V', type: 'retailer', source: 'Page', checkedAt: '2026-10-07', market: 'NG', currency: 'NGN', price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/p', shipping: null }, o);
const prod = offers => Object.assign({}, P.byId('cerave-blemish-control-gel', REAL), { id: 'tmp-product', offers });

test('Q1 qualité : ready = stock indiqué + prix + lien ; partial = information manquante ou non confirmée ; unavailable = rupture ou bientôt disponible', () => {
  const q = o => P.offersOf(prod([off(o)]))[0].quality;
  assert.equal(q({}), 'ready');
  assert.equal(q({ availability: 'unknown' }), 'partial'); assert.equal(q({ price: null, currency: null }), 'partial'); assert.equal(q({ url: null }), 'partial');
  assert.equal(q({ availability: 'out_of_stock' }), 'unavailable'); assert.equal(q({ availability: 'coming_soon' }), 'unavailable');
  assert.deepEqual(P.QUALITY, ['ready', 'partial', 'unavailable']);
  for (const o of REAL.flatMap(p => P.offersOf(p))) assert.ok(P.QUALITY.includes(o.quality), 'toute offre réelle a une qualité');
});

test('Q2 à pays et niveau égaux, les offres sont classées par qualité puis ordre stable ; la qualité n\'est jamais un score', () => {
  const p = prod([off({ retailer: 'A rupture', availability: 'out_of_stock' }), off({ retailer: 'B inconnu', availability: 'unknown' }), off({ retailer: 'C prêt' }), off({ retailer: 'D prêt', price: 2000 }),
    off({ market: 'GH', currency: 'GHS', retailer: 'E ailleurs', availability: 'out_of_stock' }), off({ market: 'KE', currency: 'KES', retailer: 'F ailleurs' })]);
  const v = P.marketView(p, 'NG');
  assert.deepEqual(v.local.map(o => o.retailer), ['C prêt', 'D prêt', 'B inconnu', 'A rupture'], 'prêt, puis à vérifier, puis indisponible ; égalité : ordre alphabétique conservé');
  assert.deepEqual(v.international.map(o => o.retailer), ['F ailleurs', 'E ailleurs']);
  for (const o of v.local.concat(v.international)) { assert.equal(typeof o.quality, 'string'); assert.ok(!Object.keys(o).some(k => /score|rank|percent|match|best|compat/i.test(k))); }
  assert.doesNotMatch(JSON.stringify(v), /"quality":\d|%/);
  // le pays prime sur la qualité : une offre locale « à vérifier » reste avant une offre d'ailleurs « prête »
  const w = P.marketView(prod([off({ availability: 'unknown', retailer: 'Local' }), off({ market: 'GH', currency: 'GHS', retailer: 'Ailleurs prête' })]), 'NG');
  assert.equal(w.tier, 'local'); assert.deepEqual(w.local.map(o => o.retailer), ['Local']); assert.deepEqual(w.international.map(o => o.retailer), ['Ailleurs prête']);
});

test('Q3 résumé pour le pays : ready / partial / unavailable (meilleure offre du pays), elsewhere, none ; aucun pays → pas de résumé', () => {
  const sum = (offers, c) => P.marketView(prod(offers), c).summary;
  assert.equal(sum([off({})], 'NG'), 'ready'); assert.equal(sum([off({ availability: 'unknown' }), off({ retailer: 'W', availability: 'out_of_stock' })], 'NG'), 'partial');
  assert.equal(sum([off({ availability: 'coming_soon' })], 'NG'), 'unavailable'); assert.equal(sum([off({})], 'BJ'), 'elsewhere'); assert.equal(sum([], 'NG'), 'none'); assert.equal(sum([off({})], null), null);
  assert.equal(sum([off({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ'] })], 'BJ'), 'ready', 'offre régionale déclarée par le vendeur : traitée comme celles du pays');
  for (const k of ['ready', 'partial', 'unavailable', 'elsewhere', 'none']) assert.ok(copy.MARKET_TEXTS.summary[k].length > 10, k);
  assert.doesNotMatch(JSON.stringify(copy.MARKET_TEXTS.summary), /garanti|actuellement disponible|%|meilleur/i, 'jamais « garanti », « disponible actuellement » ni « meilleur »');
  assert.match(copy.MARKET_TEXTS.summary.none, /Aucune offre vérifiée pour ce pays pour le moment/); assert.doesNotMatch(copy.MARKET_TEXTS.summary.none, /indisponible/i);
  // catalogue réel
  const real = (id, c) => P.marketView(P.byId(id, REAL), c).summary;
  assert.equal(real('to-niacinamide-10-zinc-1', 'GH'), 'ready'); assert.equal(real('to-salicylic-2-solution', 'NG'), 'partial'); assert.equal(real('to-hyaluronic-b5-ceramides', 'GH'), 'none'); assert.equal(real('to-salicylic-2-solution', 'BJ'), 'elsewhere');
});

test('Q4 le choix du produit vient AVANT le pays : 54 pays × produits → mêmes sections « Recommandés » / « Autres produits » ; aucun produit ne change de section', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const c = randomCase(seed * 313), n = norm(c.ui, c.o), r = Engine.run(n, c.profile, { catalog: REAL });
    const base = JSON.stringify(P.catalogView(r.routinePlan, r.productMatches, REAL));
    for (const code of Market.COUNTRIES.map(x => x.code)) for (const p of REAL) P.marketView(p, code);
    assert.equal(JSON.stringify(P.catalogView(r.routinePlan, r.productMatches, REAL)), base);
    // un catalogue sans AUCUNE offre donne exactement les mêmes sections
    const bare = REAL.map(p => Object.assign({}, p, { offers: [] })), rb = Engine.run(n, c.profile, { catalog: bare });
    assert.equal(JSON.stringify(P.catalogView(rb.routinePlan, rb.productMatches, bare)), base, 'profil #' + seed);
  }
  const src = strip(read('js/engine/products.js'));
  for (const sig of ['function match(', 'function catalogView(']) { const i = src.indexOf(sig); assert.ok(i >= 0); const j = src.indexOf('\n  function ', i + 20); assert.doesNotMatch(src.slice(i, j < 0 ? undefined : j), /marketView|qualityOf|byQuality|\.quality|offersOf|commerceOf/, sig + ' ne lit ni pays ni offre ni qualité'); }
});

test('Q5 affichage : résumé sur la fiche, offres classées par qualité, aucun bouton d\'achat sans stock indiqué, aucun appel réseau', () => {
  const app = read('js/app.js');
  assert.match(app, /data-summary="\$\{v\.summary\}">\$\{MT\.summary\[v\.summary\]\}/);
  assert.match(app, /v\.local\.map\(o=>offerRow\(o,`local`\)\)\.concat\(v\.regional\.map/, 'la fiche affiche v.local tel que classé par marketView');
  assert.match(app, /mine=v\.local\.concat\(v\.regional\),o=mine\.find\(x=>x\.buyable\)\|\|mine\[0\]/, 'la carte montre l\'offre la mieux classée du pays');
  for (const o of REAL.flatMap(p => P.offersOf(p))) if (o.buyable) assert.equal(o.quality, 'ready', 'bouton « Acheter » seulement pour une offre prête');
  for (const o of REAL.flatMap(p => P.offersOf(p))) if (o.quality !== 'ready') assert.equal(o.buyable, false);
  assert.doesNotMatch(strip(read('js/app.js')).slice(read('js/app.js').indexOf('const offersBlock=')), /fetch\(.*summary|XMLHttpRequest/);
});
