'use strict';
/* Étape 19 : départage éditorial explicite entre produits compatibles avec le MÊME actif.
   Ordre : actifs recherchés présents → type de peau → priorité éditoriale (editorialPriority[actif], 1 = d'abord) → ordre du catalogue (repli). Les filtres (exclusions, approche douce, composition)
   passent AVANT. Aucune donnée commerciale n'intervient : ni pays, ni offre, ni prix, ni disponibilité, ni vendeur, ni livraison. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const MD = require('../js/engine/data/markets.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const REAL = CAT.PRODUCTS, ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };
const clone = o => JSON.parse(JSON.stringify(o));

/* Catalogue d'essai : tous les produits réels SAUF les produits à la vitamine C, plus deux produits « vitamine C » jumeaux (X et Y) dont on règle priorité, ordre, peau, composition et offres. */
const BASE_VC = P.byId('to-ascorbyl-glucoside-12', REAL);
const NO_VC = REAL.filter(p => !P.ids(p).includes('vitamin_c'));
const twin = (id, extra) => Object.assign(clone(BASE_VC), { id, name: 'Jumeau ' + id, offers: [], image: null, editorialPriority: undefined }, extra || {});
const catalog = (list) => NO_VC.concat(list);
const PROFILE = { goals: ['tone'], level: 'full', cats: [] }, SKIN = 'Normal';
const run = (cat, profile, ui, skin) => Engine.run(norm(ui || { pigmentation: 25, radiance: 40 }, { skin: skin || SKIN }), profile || PROFILE, { catalog: cat });
const vcPick = (cat, profile, ui, skin) => run(cat, profile, ui, skin).productMatches.filter(m => m.activeIds.includes('vitamin_c')).map(m => m.productId);
const offer = o => Object.assign({ market: 'NG', retailer: 'V', type: 'retailer', currency: 'NGN', price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/p', shipping: null, source: 'test', checkedAt: '2026-10-07' }, o);

test('E1 TEST 1 : deux produits compatibles, priorités 1 et 2 → la priorité 1 est sélectionnée', () => {
  const X = twin('x', { editorialPriority: { vitamin_c: 1 } }), Y = twin('y', { editorialPriority: { vitamin_c: 2 } });
  assert.deepEqual(vcPick(catalog([X, Y])), ['x']);
  const r = run(catalog([X, Y])), v = P.catalogView(r.routinePlan, r.productMatches, catalog([X, Y]));
  assert.ok(v.recommended.some(x => x.productId === 'x')); assert.equal(v.others.find(o => o.productId === 'y').reason, 'other_product_chosen');
});

test('E2 TEST 2 : ordre physique inversé, priorités conservées → le produit de priorité 1 reste sélectionné', () => {
  const X = twin('x', { editorialPriority: { vitamin_c: 1 } }), Y = twin('y', { editorialPriority: { vitamin_c: 2 } });
  assert.deepEqual(vcPick(catalog([Y, X])), ['x']); assert.deepEqual(vcPick(catalog([X, Y])), ['x']);
  assert.deepEqual(vcPick(catalog([X, Y]).reverse()), ['x'], 'catalogue entier inversé');
  // même chose avec les produits réels
  const reversed = REAL.slice().reverse();
  assert.deepEqual(vcPick(reversed), vcPick(REAL)); assert.deepEqual(vcPick(REAL), ['to-ascorbyl-glucoside-12']);
});

test('E3 TEST 3 : sans priorité explicite, l\'ordre du catalogue est conservé (repli)', () => {
  const X = twin('x'), Y = twin('y');
  assert.deepEqual(vcPick(catalog([X, Y])), ['x']); assert.deepEqual(vcPick(catalog([Y, X])), ['y']);
  // priorité explicite pour un seul des deux : celui qui en a une passe avant, quel que soit l'ordre physique
  const Xp = twin('x'), Yp = twin('y', { editorialPriority: { vitamin_c: 5 } });
  assert.deepEqual(vcPick(catalog([Xp, Yp])), ['y'], 'un produit sans priorité explicite passe après ceux qui en ont une : aucune valeur n\'est inventée pour lui');
  // une priorité pour un AUTRE actif ne compte pas pour vitamin_c
  assert.deepEqual(vcPick(catalog([twin('x'), twin('y', { editorialPriority: { hyaluronic: 1 } })])), ['x']);
});

test('E4 TEST 4 : même priorité → ordre du catalogue', () => {
  const X = twin('x', { editorialPriority: { vitamin_c: 1 } }), Y = twin('y', { editorialPriority: { vitamin_c: 1 } });
  assert.deepEqual(vcPick(catalog([X, Y])), ['x']); assert.deepEqual(vcPick(catalog([Y, X])), ['y']);
});

test('E5–E10 TESTS 5–10 : offre ready, pays, prix, disponibilité, vendeur, absence d\'offres → le même produit est recommandé', () => {
  const mk = (xo, yo) => catalog([twin('x', { editorialPriority: { vitamin_c: 1 }, offers: xo }), twin('y', { editorialPriority: { vitamin_c: 2 }, offers: yo })]);
  const cases = {
    'aucune offre': mk([], []),
    'offre ready seulement pour Y (test 5)': mk([], [offer({})]),
    'Y très bon marché (test 7)': mk([offer({ price: 100000 })], [offer({ price: 1 })]),
    'X en rupture, Y prêt (test 8)': mk([offer({ availability: 'out_of_stock' })], [offer({})]),
    'X bientôt disponible, Y prêt': mk([offer({ availability: 'coming_soon' })], [offer({})]),
    'X unknown sans prix, Y prêt': mk([offer({ availability: 'unknown', price: null, currency: null, url: null })], [offer({})]),
    'vendeurs et types changés (test 9)': mk([offer({ retailer: 'Aucun', type: 'marketplace' })], [offer({ retailer: 'Pharmacie', seller: 'Quelqu\'un', type: 'pharmacy' })]),
    'offres locales dans 4 pays pour Y seulement (test 11)': mk([], ['GH', 'NG', 'KE', 'ZA'].map(m => offer({ market: m, currency: { GH: 'GHS', NG: 'NGN', KE: 'KES', ZA: 'ZAR' }[m] }))),
    'Y livre partout (servesMarkets)': mk([], [offer({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ', 'TG', 'CI'] })]),
    'offres dans tous les pays pour Y': mk([], MD.COUNTRIES.map(c => offer({ market: c.code, currency: c.currency, url: 'https://boutique-vraie.org/' + c.code })))
  };
  const base = JSON.stringify([run(cases['aucune offre']), P.catalogView(run(cases['aucune offre']).routinePlan, run(cases['aucune offre']).productMatches, cases['aucune offre'])]);
  for (const [name, cat] of Object.entries(cases)) {
    assert.deepEqual(vcPick(cat), ['x'], name);
    const r = run(cat); assert.equal(JSON.stringify([r, P.catalogView(r.routinePlan, r.productMatches, cat)]), base, name + ' : sortie moteur et sections identiques');
    for (const code of MD.COUNTRIES.map(c => c.code)) for (const p of cat) P.marketView(p, code);          // test 6 : consulter le marché d'un pays ne change rien
    assert.deepEqual(vcPick(cat), ['x'], name + ' après lecture des 54 marchés');
  }
});

test('E11 TEST 12 : exclure vitamin_c → aucun produit vitamin_c recommandé, même avec la priorité 1', () => {
  const X = twin('x', { editorialPriority: { vitamin_c: 1 } }), Y = twin('y', { editorialPriority: { vitamin_c: 2 } }), cat = catalog([X, Y]);
  const prof = Object.assign({}, PROFILE, { exclusions: ['vitamin_c'] }), r = run(cat, prof), v = P.catalogView(r.routinePlan, r.productMatches, cat);
  assert.deepEqual(vcPick(cat, prof), []); assert.ok(!v.recommended.some(x => ['x', 'y'].includes(x.productId)));
  assert.deepEqual(v.others.filter(o => ['x', 'y'].includes(o.productId)).map(o => o.reason), ['excluded', 'excluded']);
  const real = run(REAL, prof); assert.ok(!P.catalogView(real.routinePlan, real.productMatches, REAL).recommended.some(x => P.ids(P.byId(x.productId, REAL)).includes('vitamin_c')));
});

test('E12 TEST 13 : approche douce — la priorité ne contourne jamais une incompatibilité déjà validée (confort)', () => {
  // X (priorité 1) contient en plus de l'acide azélaïque (actif exigeant, planifié) ; Y (priorité 2) est simple.
  const X = twin('x', { editorialPriority: { vitamin_c: 1 }, ingredients: [{ activeId: 'vitamin_c', label: 'Vitamine C' }, { activeId: 'azelaic', label: 'Acide azélaïque' }] }), Y = twin('y', { editorialPriority: { vitamin_c: 2 } });
  const cat = catalog([X, Y]);
  let found = null;
  for (let s = 1; s <= 3000 && !found; s++) {
    const c = randomCase(s * 977), n = norm(c.ui, c.o);
    const plain = Object.assign({}, c.profile, { level: 'full', exclusions: [], comfort: { preferGentle: false } }), gentle = Object.assign({}, plain, { comfort: { preferGentle: true } });
    const a = Engine.run(n, plain, { catalog: cat }), g = Engine.run(n, gentle, { catalog: cat });
    const pick = r => r.productMatches.filter(m => m.activeIds.includes('vitamin_c')).map(m => m.productId);
    if (pick(a)[0] === 'x' && pick(g)[0] === 'y' && g.routinePlan.comfortMode) found = { n, plain, gentle, a, g };
  }
  assert.ok(found, 'profil trouvé où X est retenu hors confort et écarté en approche douce');
  const v = P.catalogView(found.g.routinePlan, found.g.productMatches, cat);
  assert.equal(v.others.find(o => o.productId === 'x').reason, 'comfort', 'écarté par la règle de confort existante, malgré la priorité 1');
  assert.ok(v.recommended.some(r => r.productId === 'y'));
  // et la règle de confort elle-même n'a pas bougé : mêmes raisons qu'avant l'étape 19 sur les produits réels (voir test de non-régression E16)
});

test('E13 TEST 14 : le type de peau passe avant la priorité éditoriale', () => {
  const X = twin('x', { editorialPriority: { vitamin_c: 1 }, skinTypes: ['dry'], skinTypesDocumented: true }), Y = twin('y', { editorialPriority: { vitamin_c: 2 }, skinTypes: ['all'] });
  assert.deepEqual(vcPick(catalog([X, Y]), PROFILE, null, 'Oily'), ['y'], 'peau grasse : X ne convient pas à la peau, Y passe avant malgré sa priorité 2');
  assert.deepEqual(vcPick(catalog([X, Y]), PROFILE, null, 'Dry'), ['x'], 'peau sèche : les deux conviennent, la priorité décide');
  assert.deepEqual(vcPick(catalog([Y, X]), PROFILE, null, 'Oily'), ['y']);
});

test('E14 TEST 15 : plusieurs actifs — le nombre d\'actifs recherchés passe avant tout départage éditorial (hydratants)', () => {
  const cic = P.byId('lrp-cicaplast-baume-b5-plus', REAL);
  const mkM = (id, acts, extra) => Object.assign(clone(cic), { id, name: id, offers: [], image: null, primaryActiveId: acts[0], ingredients: acts.map(a => ({ activeId: a, label: a })), editorialPriority: undefined }, extra || {});
  const one = mkM('un-seul-actif', ['hyaluronic'], { editorialPriority: { hyaluronic: 1 } }), two = mkM('deux-actifs', ['hyaluronic', 'ceramides']);
  let checked = 0;
  for (let s = 1; s <= 600; s++) {
    const c = randomCase(s * 331), n = norm(c.ui, c.o);
    for (const cat of [[one, two].concat(REAL), REAL.concat([two, one])]) {
      const r = Engine.run(n, c.profile, { catalog: cat });
      for (const st of [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening]) if (st.kind === 'moisturize' && !st.owned && (st.supportIds || []).includes('hyaluronic') && st.supportIds.includes('ceramides')) {
        const m = r.productMatches.find(x => x.stepId === st.id); checked++;
        assert.notEqual(m.productId, 'un-seul-actif', 'le produit à 1 actif, premier du catalogue et prioritaire, ne passe pas devant celui qui couvre 2 actifs recherchés');
      }
    }
  }
  assert.ok(checked >= 100, 'étapes d\'hydratant avec au moins deux actifs de soutien vérifiées : ' + checked);
});

test('E15 invariance marché : « Recommandés » et « Autres produits » strictement identiques pour 13 profils × 54 pays × offres (aucune, locales, internationales, ready, unknown, unavailable)', () => {
  const P_ = [];
  const mk = (ui, o, profile) => P_.push({ n: norm(ui, o), profile: Object.assign({ goals: [], level: 'simple', cats: [] }, profile) });
  for (const skin of ['Dry', 'Oily', 'Combination', 'Normal', 'Dry & Redness']) mk({ pigmentation: 30, radiance: 40, wrinkles: 45, acne: 40 }, { skin }, { goals: ['tone'], level: 'full' });
  mk({ pigmentation: 30 }, { skin: 'Normal' }, { goals: ['tone'], level: 'full', comfort: { preferGentle: true } });
  mk({ pigmentation: 30, wrinkles: 40 }, { skin: 'Dry' }, { goals: ['aging'], level: 'full' });
  mk({ radiance: 35, pigmentation: 45 }, { skin: 'Oily' }, { goals: ['tone'], level: 'simple' });
  mk({ pigmentation: 40 }, { skin: 'Normal' }, { goals: [], level: 'full' });
  mk({ pigmentation: 30, acne: 30 }, { skin: 'Oily' }, { goals: ['tone'], level: 'full', exclusions: ['vitamin_c'] });
  mk({ acne: 20, pores: 30 }, { skin: 'Oily' }, { goals: ['blemishes'], level: 'full' });
  mk({ hydration: 25 }, { skin: 'Dry' }, { goals: ['hydration'], level: 'simple' });
  mk({}, { skin: 'Normal', fill: 90 }, { goals: [], level: 'none' });
  assert.ok(P_.length >= 13);
  const withOffers = f => REAL.map(p => Object.assign({}, p, { offers: (p.offers || []).flatMap(o => f(clone(o))) }));
  const states = { 'réel': REAL, 'aucune': withOffers(() => []), 'ready': withOffers(o => [Object.assign(o, { availability: 'in_stock', price: o.price || 1, currency: o.currency || 'NGN', url: o.url || 'https://boutique-vraie.org/p' })]),
    'unknown': withOffers(o => [Object.assign(o, { availability: 'unknown' })]), 'unavailable': withOffers(o => [Object.assign(o, { availability: 'out_of_stock' })]),
    'internationales': withOffers(o => [Object.assign(o, { market: 'ZA', currency: 'ZAR' })]), 'locales partout': withOffers(o => MD.COUNTRIES.map(c => Object.assign(clone(o), { market: c.code, currency: c.currency, url: 'https://boutique-vraie.org/' + c.code + (o.url || '').length }))) };
  const sections = (cat, n, profile) => { const r = Engine.run(n, profile, { catalog: cat }); const v = P.catalogView(r.routinePlan, r.productMatches, cat); return JSON.stringify([r, v.recommended, v.others]); };
  const base = P_.map(({ n, profile }) => sections(REAL, n, profile));
  for (const [name, cat] of Object.entries(states)) {
    P_.forEach(({ n, profile }, i) => assert.equal(sections(cat, n, profile), base[i], name + ' / profil #' + i));
    for (const code of MD.COUNTRIES.map(c => c.code)) for (const p of cat) P.marketView(p, code);
  }
  P_.forEach(({ n, profile }, i) => assert.equal(sections(REAL, n, profile), base[i], 'après lecture des marchés : profil #' + i));
});

test('E16 non-régression : l\'ajout de la priorité ne change AUCUNE sortie (1 500 profils : score, interprétation, priorités, objectifs, actifs, routine, produits retenus, sections)', () => {
  const noPrio = REAL.map(p => { const c = Object.assign({}, p); delete c.editorialPriority; return c; });
  for (let s = 1; s <= 1500; s++) {
    const c = randomCase(s * 37 + 5), n = norm(c.ui, c.o);
    const a = Engine.run(n, c.profile, { catalog: REAL }), b = Engine.run(n, c.profile, { catalog: noPrio });
    // étape 22 : `selection` (et la phrase qui l'explique) décrit la règle de départage appliquée ; sans priorité éditoriale elle devient « ordre du catalogue ». Le produit retenu, lui, ne change pas.
    const nosel = function (k, v) { return k === 'selection' || k === 'synthesis' || k === 'why' ? undefined : v; };
    assert.equal(JSON.stringify([a, P.catalogView(a.routinePlan, a.productMatches, REAL)], nosel), JSON.stringify([b, P.catalogView(b.routinePlan, b.productMatches, noPrio)], nosel), 'profil #' + s);
  }
});

test('E17 données : priorités explicites seulement là où plusieurs produits concourent ; valeurs valides ; aucun produit unique ne reçoit de hiérarchie ; catalogue inchangé par ailleurs', () => {
  const withP = REAL.filter(p => p.editorialPriority).map(p => [p.id, p.editorialPriority]);
  assert.ok(withP.length > 0, 'le catalogue contient des priorités éditoriales (le test n\'est pas vide)');
  // pour chaque priorité : l'actif est relié au produit, il y a au moins deux produits utilisables compatibles avec cet actif (une priorité n'existe que là où plusieurs produits concourent)
  for (const [id, ep] of withP) for (const act of Object.keys(ep)) { assert.ok(P.ids(P.byId(id, REAL)).includes(act)); assert.ok(P.usable(REAL).filter(p => P.ids(p).includes(act) && p.category === 'serum').length >= 2, act + ' : plusieurs produits'); }
  // et réciproquement : un actif porté par un seul produit utilisable (en soin ciblé) ne reçoit aucune hiérarchie
  for (const act of new Set(REAL.flatMap(p => P.ids(p)))) {
    const competing = P.usable(REAL).filter(p => P.ids(p).includes(act) && p.category === 'serum');
    if (competing.length <= 1) assert.ok(!REAL.some(p => p.editorialPriority && p.editorialPriority[act]), act + ' : un seul produit, aucune hiérarchie');
  }
  assert.deepEqual(P.validateCatalog(REAL), []);
  // validation
  const bad = (ep, re) => assert.ok(P.validateProduct(Object.assign({}, BASE_VC, { editorialPriority: ep })).some(m => re.test(m)), JSON.stringify(ep));
  bad({ vitamin_c: 0 }, /rang entier/); bad({ vitamin_c: 1.5 }, /rang entier/); bad({ vitamin_c: 'a' }, /rang entier/); bad({ salicylic: 1 }, /non relié/); bad([1], /objet/); bad('1', /objet/); bad({ vitamin_c: 100 }, /rang entier/);
  assert.deepEqual(P.validateProduct(Object.assign({}, BASE_VC, { editorialPriority: { vitamin_c: 3 } })), []);
  assert.deepEqual(P.validateProduct(Object.assign({}, BASE_VC, { editorialPriority: undefined })), [], 'facultatif');
});

test('E18 code : le départage ne lit aucune donnée commerciale ; l\'ordre de tri est exactement actifs → peau → priorité → catalogue', () => {
  const src = strip(read('js/engine/products.js')), m = fnBody(src, 'function match(');
  assert.doesNotMatch(m, /country|\bmarket\b|marketView|offers?\b|offersOf|commerceOf|price|currency|availability|seller|shipping|verifiedAt|checkedAt|stockNote|quality|buyable|\.url\b|vendor/i);
  assert.match(m, /sort\(\(a, b\) => score\(b\) - score\(a\) \|\| \(skinOk\(b\.p, routine\.skinBase\) - skinOk\(a\.p, routine\.skinBase\)\) \|\| byPrio\(a, b\) \|\| a\.order - b\.order\)/);
  assert.match(m, /step\.kind === 'treatment' && p\.editorialPriority && Number\.isInteger\(p\.editorialPriority\[step\.activeId\]\)/);
  assert.match(m, /return x === y \? 0 : x === null \? 1 : y === null \? -1 : x - y/, 'comparateur total : priorité explicite avant l\'absence de priorité, sans valeur inventée');
  // les filtres passent avant le tri : exclusions, confort, composition
  assert.ok(m.indexOf('rejection(p, step, ctx) === null') < m.indexOf('pool.sort'));
  for (const sig of ['function rejection(', 'function context(', 'function catalogView(']) assert.doesNotMatch(fnBody(src, sig), /editorialPriority/, sig + ' : la priorité ne touche ni les filtres ni la vue');
  // rien d'autre dans le moteur ne connaît la priorité
  for (const f of ['js/engine/index.js', 'js/engine/personalization.js', 'js/engine/priorities.js', 'js/engine/routine.js', 'js/engine/actives.js', 'js/engine/interpret.js']) assert.doesNotMatch(strip(read(f)), /editorialPriority/, f);
  // la priorité n'est lue que par la validation du modèle et par le tri de match() : aucune autre logique ne la connaît
  const rest = src.replace(fnBody(src, 'function match('), '').replace(fnBody(src, 'function validateProduct('), '');
  assert.doesNotMatch(rest, /editorialPriority/, 'un seul endroit de décision (match), un seul de validation');
});

test('E19 contenu : la priorité éditoriale n\'est jamais montrée à l\'utilisateur ni présentée comme score, note, qualité, efficacité, classement ou « meilleur produit »', () => {
  for (const f of ['js/app.js', 'js/engine/copy.fr.js', 'js/hero.js', 'index.html']) assert.doesNotMatch(read(f), /editorialPriority|priorité éditoriale|preferredOrder/i, f + ' : règle interne, jamais affichée');
  const r = run(REAL), view = P.catalogView(r.routinePlan, r.productMatches, REAL);
  assert.doesNotMatch(JSON.stringify(view) + JSON.stringify(r.productMatches), /editorialPriority|priority|priorit/i, 'ni la vue du catalogue ni les correspondances n\'exposent la priorité');
  const texts = JSON.stringify([require('../js/engine/copy.fr.js').PRODUCT_REASONS, REAL.map(p => [p.description, p.inciNote, p.name])]);
  assert.doesNotMatch(texts, /meilleur|plus efficace|le mieux|rapport qualité|classement|numéro un|n°\s?1|recommandé en priorité|préférons|nous préférons/i);
  const cat = strip(read('js/engine/data/catalog.js'));
  assert.match(read('js/engine/data/catalog.js'), /C'est l'ordre éditorial\s+ACTUEL, pas un jugement de valeur/);
  assert.doesNotMatch(read('README.md'), /(Ascorbyl|The Ordinary)[^.\n]{0,60}(meilleur|plus efficace)|(CeraVe)[^.\n]{0,60}(meilleur|plus efficace)/i);
  assert.ok(cat.length > 0);
});
