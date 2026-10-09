'use strict';
/* Phase 3 : disponibilité au Bénin. Aucune offre béninoise n'est enregistrée dans le catalogue (aucune n'a pu être vérifiée) : ces tests éprouvent le COMPORTEMENT sur des jeux d'essai
   (jamais livrés) et gardent la porte fermée aux données non vérifiées. Le produit reste indépendant de sa disponibilité. */
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const { Engine, norm } = require('./helpers/engine.js');
const INV = require('./fixtures/catalog-inventory.js');

const REAL = CAT.PRODUCTS;
const clone = o => JSON.parse(JSON.stringify(o));
const BASE = id => clone(REAL.find(p => p.id === id));
const bj = o => Object.assign({ market: 'BJ', retailer: 'Pharmacie de test', type: 'pharmacy', city: 'Cotonou', currency: 'XOF', price: 9000, availability: 'in_stock', url: 'https://pharmacie-de-test.org/produit',
  shipping: 'local', source: 'Fiche vendeur de test', checkedAt: '2026-10-08' }, o || {});
const chk = c => Object.assign({ market: 'BJ', status: 'searched_none', checkedAt: '2026-10-08', method: 'Recherche de test', note: 'jeu de test' }, c || {});
const withData = (id, offers, checks) => Object.assign(BASE(id), { offers }, checks ? { marketChecks: checks } : {});
const NIAC = 'to-niacinamide-10-zinc-1', HYA = 'to-hyaluronic-b5-ceramides';
const st = (p, c) => P.availabilityStatus(p, c || 'BJ');
const PROFILE = { goals: ['oil_pores'], level: 'full', cats: [] };
const run = cat => Engine.run(norm({ oiliness: 15, pores: 30, acne: 70 }, { skin: 'Oily' }), PROFILE, { catalog: cat });
const picks = r => r.productMatches.map(m => m.productId);

test('BJ-A offre béninoise valide → LOCAL', () => {
  const p = withData(NIAC, [bj()]);
  assert.deepEqual(P.validateProduct(p), []);
  assert.equal(st(p).status, 'LOCAL'); assert.equal(st(p).reason, 'local_offer');
  const v = P.marketView(p, 'BJ'); assert.equal(v.tier, 'local'); assert.equal(v.local[0].city, 'Cotonou');
});

test('BJ-B / BJ-C sans recherche → UNKNOWN ; searched_none valide → UNAVAILABLE ; le catalogue livré reste UNKNOWN au Bénin', () => {
  assert.equal(st(withData(NIAC, [])).status, 'UNKNOWN'); assert.equal(st(withData(NIAC, [])).reason, 'no_search');
  const none = withData(NIAC, [], [chk()]);
  assert.deepEqual(P.validateProduct(none), []);
  assert.equal(st(none).status, 'UNAVAILABLE'); assert.equal(st(none).checkedAt, '2026-10-08');
  assert.equal(st(withData(NIAC, [], [chk({ status: 'searched_none', method: '' })])).status, 'UNKNOWN', 'recherche invalide ignorée');
  // sur le catalogue observé : LOCAL exactement quand une offre béninoise fiable existe ; UNAVAILABLE exactement quand une recherche explicite sans offre existe ; UNKNOWN sinon (le défaut)
  const reliableBj = p => (p.offers || []).some(o => o.market === 'BJ' && o.availability !== 'out_of_stock' && o.availability !== 'coming_soon' && P.validateOffer(o, false).length === 0);
  for (const p of REAL) {
    const noneCheck = (p.marketChecks || []).some(c => c.market === 'BJ' && c.status === 'searched_none');
    const got = st(p).status;
    if (reliableBj(p)) assert.equal(got, 'LOCAL', p.id);
    else if (noneCheck && !(p.offers || []).some(o => o.market !== 'BJ' && (((o.servesMarkets || []).includes('BJ')) || o.shipping === 'international') && o.availability !== 'out_of_stock' && o.availability !== 'coming_soon')) assert.equal(got, 'UNAVAILABLE', p.id);
    else assert.notEqual(got, 'UNAVAILABLE', p.id + ' : jamais UNAVAILABLE sans recherche explicite');
    if (!reliableBj(p) && !noneCheck) assert.ok(['UNKNOWN', 'REGIONAL', 'IMPORT'].includes(got), p.id);
  }
  assert.ok(REAL.every(p => (p.marketChecks || []).every(c => c.status !== 'searched_none') || (p.marketChecks || []).every(c => P.validateMarketCheck(c).length === 0)), 'toute recherche enregistrée est valide');
});

test('BJ-D rupture seule → UNKNOWN ; BJ-E offre d\'un autre pays sans livraison vers le Bénin → pas IMPORT', () => {
  for (const a of ['out_of_stock', 'coming_soon']) assert.equal(st(withData(NIAC, [bj({ availability: a })])).status, 'UNKNOWN', a);
  const ci = o => bj(Object.assign({ market: 'CI', city: 'Abidjan' }, o || {}));
  for (const shipping of [null, 'local']) { const s = st(withData(NIAC, [ci({ shipping })])); assert.equal(s.status, 'UNKNOWN', String(shipping)); assert.notEqual(s.status, 'IMPORT'); }
  assert.equal(st(withData(NIAC, [ci({ shipping: 'international' })])).status, 'IMPORT', 'seulement si la livraison internationale est indiquée');
  assert.equal(st(withData(NIAC, [ci({ servesMarkets: ['BJ'] })])).status, 'REGIONAL', 'seulement si le vendeur déclare desservir le Bénin');
});

test('BJ-F / BJ-G le produit reste recommandé, indisponible ou disponible : le statut de marché est séparé', () => {
  const ref = run(REAL), refIds = picks(ref);
  assert.ok(refIds.includes(NIAC), 'cas de référence : la niacinamide est recommandée');
  const mk = (offers, checks) => REAL.map(p => (p.id === NIAC ? Object.assign(clone(p), { offers, marketChecks: checks }) : clone(p)));
  const unavailable = mk([], [chk()]), local = mk([bj()], undefined), noInfo = mk([], undefined);
  assert.deepEqual(P.validateCatalog(unavailable), []); assert.deepEqual(P.validateCatalog(local), []);
  for (const [name, cat] of [['UNAVAILABLE', unavailable], ['LOCAL', local], ['UNKNOWN', noInfo]]) {
    const r = run(cat);
    assert.deepEqual(picks(r), refIds, name + ' : mêmes produits recommandés');
    assert.equal(JSON.stringify(r.routinePlan), JSON.stringify(ref.routinePlan), name + ' : même routine');
    assert.equal(JSON.stringify(r.priorityItems), JSON.stringify(ref.priorityItems), name + ' : mêmes priorités');
    assert.equal(st(cat.find(p => p.id === NIAC)).status, name);
  }
  assert.ok(P.commerceOf(local.find(p => p.id === NIAC)).offers.some(o => o.market === 'BJ'), 'l\'offre locale est disponible à côté de la recommandation');
});

test('BJ-H plusieurs vendeurs au Bénin : aucune offre n\'est écrasée', () => {
  const a = bj({ retailer: 'Pharmacie A', url: 'https://pharmacie-a.org/p', price: 9000 }), b = bj({ retailer: 'Boutique B', type: 'retailer', city: 'Calavi', url: 'https://boutique-b.org/p', price: 11500 });
  const p = withData(NIAC, [a, b]);
  assert.deepEqual(P.validateProduct(p), []);
  const offers = P.marketView(p, 'BJ').local;
  assert.deepEqual(offers.map(o => o.retailer).sort(), ['Boutique B', 'Pharmacie A']);
  assert.deepEqual(offers.map(o => o.price).sort((x, y) => x - y), [9000, 11500]);
  assert.equal(P.commerceOf(p).offers.length, 2);
  // le même vendeur avec la même adresse est refusé comme doublon (jamais fusionné en silence)
  assert.ok(P.validateProduct(withData(NIAC, [a, clone(a)])).some(m => /double/.test(m)));
  // un même vendeur avec deux fiches différentes reste accepté
  assert.deepEqual(P.validateProduct(withData(NIAC, [a, bj({ retailer: 'Pharmacie A', url: 'https://pharmacie-a.org/autre' })])), []);
});

test('BJ-I prix absent / BJ-J lien absent : rien n\'est inventé', () => {
  const p = withData(NIAC, [bj({ price: null, currency: null, url: null, availability: 'unknown' })]);
  assert.deepEqual(P.validateProduct(p), []);
  const o = P.marketView(p, 'BJ').local[0];
  assert.equal(o.price, null); assert.equal(o.url, null); assert.equal(o.buyable, false); assert.equal(o.linkOnly, false); assert.equal(o.quality, 'partial');
  assert.equal(st(p).status, 'LOCAL', 'une offre locale sans prix reste une offre locale, sans prix inventé');
  // un prix sans devise, ou une devise étrangère au Bénin, est refusé : aucune conversion
  assert.ok(P.validateProduct(withData(NIAC, [bj({ currency: null })])).some(m => /devise/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ currency: 'NGN' })])).some(m => /impossible dans ce pays/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ price: -5 })])).length);
  assert.ok(P.validateProduct(withData(NIAC, [bj({ url: 'http://pharmacie-de-test.org/p' })])).length, 'lien http refusé');
  assert.ok(P.validateProduct(withData(NIAC, [bj({ url: 'https://example.com/p' })])).length, 'lien factice refusé');
});

test('BJ-K donnée de marché invalide → validation rejetée ; toute offre BJ du catalogue exige vendeur, source, date, devise FCFA', () => {
  assert.ok(P.validateProduct(withData(NIAC, [bj({ source: '' })])).some(m => /source/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ checkedAt: 'hier' })])).some(m => /date/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ retailer: '' })])).some(m => /vendeur/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ type: 'ami' })])).some(m => /type/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ market: 'XX' })])).some(m => /pays/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj({ score: 3 })])).some(m => /interdit/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [bj()], [chk({ status: 'searched_none' })])).some(m => /contredit/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [], [chk({ status: 'searched_found' })])).some(m => /exige une offre/.test(m)));
  assert.ok(P.validateProduct(withData(NIAC, [], [chk({ status: 'peut-être' })])).some(m => /statut/.test(m)));
  // garde-fou des données à venir : toute offre BJ livrée porte vendeur, source, date, devise FCFA, et un lien réel si elle en a un
  for (const p of REAL) for (const o of (p.offers || []).filter(x => x.market === 'BJ')) {
    assert.ok(o.retailer && o.source && o.checkedAt && o.currency === 'XOF', p.id + ' : offre BJ incomplète');
    assert.ok(o.url == null || /^https:\/\//.test(o.url), p.id);
  }
});

/* Cas de référence figé (Lynia Shop, relevé du 2026-10-08, fourni par l'équipe DERMAI) : l'observation exacte, indépendante du contenu courant du catalogue. */
const LYNIA = { market: 'BJ', retailer: 'Lynia Shop', type: 'retailer', currency: 'XOF', price: 12700, availability: 'in_stock', url: null, shipping: null,
  source: 'Lynia Shop (lynia-shop.com) : relevé fourni par l\'équipe DERMAI, correspondance « with Ceramides » confirmée par elle ; page non rouverte ici', checkedAt: '2026-10-08' };
const LYNIA_CHECK = { market: 'BJ', status: 'searched_found', checkedAt: '2026-10-08', method: 'Fiche vendeur relevée par l\'équipe DERMAI et fournie au projet ; page non rouverte' };

test('BJ-L1 cas de référence Lynia (observation figée) : LOCAL, offre partielle sans lien, rien d\'inventé, décision inchangée', () => {
  const base = REAL.find(x => x.id === HYA) || INV.usableProducts[0];
  const p = Object.assign(clone(base), { offers: [clone(LYNIA)], marketChecks: [clone(LYNIA_CHECK)] });
  assert.deepEqual(P.validateProduct(p), []);
  assert.equal(st(p).status, 'LOCAL');
  const view = P.marketView(p, 'BJ').local[0];
  assert.equal(view.quality, 'partial'); assert.equal(view.buyable, false); assert.equal(view.linkOnly, false); assert.equal(view.price, 12700); assert.equal(view.currency, 'XOF');
  for (const k of ['city', 'seller', 'stockNote', 'servesMarkets', 'verifiedAt']) assert.equal(LYNIA[k], undefined, k + ' : jamais inventé');
  assert.equal(LYNIA.url, null);
  for (const c of ['TG', 'CI', 'SN', 'GH', 'NG']) assert.equal(st(p, c).status, 'UNKNOWN', c + ' : le Bénin ne devient pas un autre pays');
  // la décision est identique avec ou sans l'offre
  const withOffer = REAL.map(x => (x.id === p.id ? p : x)), bare = REAL.map(x => (x.id === p.id ? Object.assign(clone(x), { offers: [], marketChecks: undefined }) : x));
  for (const ui of [{ hydration: 15 }, { hydration: 30, redness: 40 }, { hydration: 55 }, { acne: 20, pores: 40 }]) {
    const go = cat => Engine.run(norm(ui, { skin: 'Dry' }), { goals: ['hydration'], level: 'full', cats: [] }, { catalog: cat });
    assert.equal(JSON.stringify(go(withOffer)), JSON.stringify(go(bare)), JSON.stringify(ui));
  }
});

test('BJ-L2 enregistrement Lynia au catalogue : s\'il y est, il y est tel qu\'enregistré (aucune retouche silencieuse) ; l\'absence n\'est pas une erreur', () => {
  /* Test d\'ENREGISTREMENT : il ne force pas la présence d\'une offre (une décision de données peut la retirer ou la remplacer) ; il interdit seulement de l\'altérer sans nouveau relevé. */
  const p = REAL.find(x => x.id === HYA), o = p && (p.offers || []).find(x => x.market === 'BJ' && x.retailer === 'Lynia Shop');
  if (!o) return;
  assert.deepEqual(o, LYNIA);
  assert.ok(p.marketChecks.some(c => c.market === 'BJ' && c.status === 'searched_found' && c.checkedAt === LYNIA.checkedAt));
  assert.match(p.name, /with Ceramides/); assert.equal(p.status, 'validated');
});
