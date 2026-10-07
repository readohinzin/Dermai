'use strict';
/* Étape 17 : CeraVe Skin Renewing Vitamin C Serum (30 ml) au catalogue réel. Le produit est une CONSÉQUENCE de la routine : il ne crée aucune priorité et ne change aucune règle. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const copy = require('../js/engine/copy.fr.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const ID = 'cerave-skin-renewing-vitamin-c-serum';
const REAL = CAT.PRODUCTS, prod = P.byId(ID, REAL);
const WITHOUT = REAL.filter(p => p.id !== ID);
const NO_OFFERS = REAL.map(p => Object.assign({}, p, { offers: [] }));
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };
const INCI_FABRICANT = ['WATER', 'ASCORBIC ACID', 'GLYCERIN', 'DIMETHICONE', 'CETEARYL ETHYLHEXANOATE', 'ALCOHOL DENAT.', 'SODIUM HYDROXIDE', 'AMMONIUM POLYACRYLOYLDIMETHYL TAURATE', 'PANTHENOL', 'CERAMIDE NP', 'CERAMIDE AP', 'CERAMIDE EOP', 'CARBOMER', 'CETEARYL ALCOHOL',
  'BEHENTRIMONIUM METHOSULFATE', 'SODIUM HYALURONATE', 'SODIUM LAUROYL LACTYLATE', 'CHOLESTEROL', 'PHENOXYETHANOL', 'TOCOPHERYL ACETATE', 'DISODIUM EDTA', 'ISOPROPYL MYRISTATE', 'CAPRYLYL GLYCOL', 'XANTHAN GUM', 'PHYTOSPHINGOSINE', 'ETHYLHEXYLGLYCERIN'];
const stepsOf = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
const hasVitC = r => stepsOf(r).some(s => s.activeId === 'vitamin_c' && !s.owned);
const views = (r, cat) => P.catalogView(r.routinePlan, r.productMatches, cat);
const sweep = n => Array.from({ length: n }, (_, i) => randomCase((i + 1) * 131));

test('C1 1. produit valide au catalogue réel, réel (demo = false), validé, actif', () => {
  assert.ok(prod, 'présent');
  assert.deepEqual(P.validateProduct(prod), []); assert.deepEqual(P.validateCatalog(REAL), []);
  assert.equal(prod.demo, false); assert.equal(prod.status, 'validated'); assert.equal(prod.active, true);
  assert.equal(prod.name, 'Skin Renewing Vitamin C Serum'); assert.equal(prod.brand, 'CeraVe'); assert.equal(prod.format, '30 ml');
  assert.ok(P.usable(REAL).includes(prod)); assert.equal(P.usable(REAL).length, 11);
  assert.ok(/^[a-z0-9][a-z0-9_-]{1,40}$/.test(prod.id));
});

test('C2 2, 3, 4. actif principal vitamin_c ; aucun autre actif DERMAI ; ni rétinoïde, ni salicylique, ni exfoliant ; catégorie « soin ciblé »', () => {
  assert.equal(prod.primaryActiveId, 'vitamin_c'); assert.equal(P.primaryActive(prod), 'vitamin_c');
  assert.deepEqual(P.ids(prod), ['vitamin_c'], 'céramides, acide hyaluronique, panthénol : descriptifs seulement, aucun nouvel actif relié');
  const A = require('../js/engine/actives.js');
  assert.ok(!P.ids(prod).includes('retinoid') && !P.ids(prod).includes('salicylic') && !P.ids(prod).includes('aha_pha'));
  assert.equal(A.byId('vitamin_c').groups.length, 0, 'vitamin_c n\'est pas un exfoliant fort');
  assert.doesNotMatch(prod.inci.join(' | '), /retin|retinal|retinyl|salicyl|glycolic|lactic acid|mandelic|azelaic|bakuchiol|kojic/i, 'aucun rétinoïde ni exfoliant caché dans l\'INCI');
  assert.equal(prod.category, 'serum'); assert.equal(copy.PRODUCT_CATEGORY_LABELS.serum, 'Soin ciblé');
  assert.equal(P.stepCategory({ kind: 'treatment' }), 'serum');
  assert.ok(prod.ingredients.every(i => i.activeId === 'vitamin_c' || i.activeId === null));
  assert.equal(prod.ingredients.filter(i => i.activeId === null).length, 3);
});

test('C3 5. type de peau « all » (documenté par la fiche) ; indicateurs et objectifs existants seulement', () => {
  assert.deepEqual(prod.skinTypes, ['all']); assert.equal(prod.skinTypesDocumented, true);
  const M = require('../js/skin-model.js');
  assert.deepEqual(prod.targets, ['pigmentation', 'radiance', 'wrinkles']);
  assert.ok(prod.targets.every(t => M.METRIC_KEYS.includes(t)), 'indicateurs déjà existants');
  assert.ok(!prod.targets.includes('firmness') && !prod.targets.includes('darkCircle') && !prod.targets.includes('eyebag'), 'jamais une recommandation du contour des yeux ni de la fermeté');
  assert.ok(!Object.keys(prod).some(k => /match|score|compat|percent/i.test(k)));
});

test('C4 INCI : exactement la liste publiée (26 ingrédients, ordre conservé), source fabricant, note « vérifiez l\'emballage », jamais présentée comme éternelle', () => {
  assert.deepEqual(prod.inci.map(x => x.toUpperCase()), INCI_FABRICANT);
  assert.equal(prod.inci.length, 26); assert.ok(prod.inci.includes('Alcohol Denat.'));
  const src = prod.sources.find(s => s.kind === 'manufacturer');
  assert.equal(src.url, 'https://www.cerave.com/skincare/facial-serums/skin-renewing-vitamin-c-serum'); assert.match(src.method, /non rouverte depuis l'environnement d'intégration/);
  assert.match(prod.inciNote, /met à jour régulièrement/); assert.match(prod.inciNote, /vérifier l'emballage/); assert.doesNotMatch(prod.inciNote, /définitiv|toujours|éternel/i);
  assert.match(prod.inciNote, /ne créent aucun actif DERMAI/);
  assert.match(read('js/app.js'), /La composition peut varier selon le pays : vérifiez l'emballage/, 'rappel affiché sous la source de chaque fiche');
});

test('C5 7. aucune image inventée : image = null (« Image à venir »), aucun fichier, aucune URL d\'image', () => {
  assert.equal(prod.image, null);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'img/products/' + ID + '.webp')) && !fs.existsSync(path.join(__dirname, '..', 'img/products/' + ID + '.jpg')));
  assert.doesNotMatch(JSON.stringify(prod), /\.(png|jpe?g|webp|gif|svg)/i, 'aucune URL d\'image dans la fiche');
});

test('C6 8, 9, 10. offres rattachées au bon produit, devise du pays, prix tels quels ; Dis-Chem et Jumia « Generic » non intégrés', () => {
  const o = P.offersOf(prod);
  assert.deepEqual(o.map(x => [x.market, x.retailer, x.type, x.currency, x.price, x.availability]), [['ZA', 'Clicks', 'retailer', 'ZAR', 550, 'in_stock'], ['KE', 'Cosmetics Kenya', 'retailer', 'KES', 4995, 'unknown'], ['NG', 'Konga', 'marketplace', 'NGN', 25481, 'unknown']].sort((a, b) => P.MARKETS[a[0]].localeCompare(P.MARKETS[b[0]], 'fr')));
  for (const x of prod.offers) { assert.deepEqual(P.validateOffer(x), []); const home = { ZA: 'ZAR', KE: 'KES', NG: 'NGN' }[x.market]; assert.equal(x.currency, home, 'devise du pays'); }
  assert.ok(prod.offers.every(x => x.shipping === null && x.servesMarkets === undefined), 'aucune livraison internationale déduite : le pays de l\'offre reste explicite');
  assert.doesNotMatch(JSON.stringify(prod.offers), /Dis-?Chem|Takealot|cosmetology|PriceCheck|Generic|7\s?999|7999/i, 'offres non intégrées : pas de lien vendeur direct (Dis-Chem), comparateur, fiche « Generic »');
  assert.equal(P.marketView(prod, 'BJ').local.length, 0); assert.equal(P.marketView(prod, 'BJ').international.length, 3, 'au Bénin : les 3 offres ne sont que des options d\'autres pays, livraison à vérifier');
  assert.equal(P.marketView(prod, 'ZA').local[0].retailer, 'Clicks');
  assert.ok(!prod.offers.some(x => x.price == null || typeof x.price !== 'number'));
  assert.equal(P.commerceOf(prod).price, null, 'aucun prix global ni conversion');
  assert.doesNotMatch(JSON.stringify(prod), /converted|FCFA|XOF/);
});

test('C7 confiance commerciale : relevé ≠ vérification ; unknown = « Voir l\'offre », jamais « Acheter » ; aucune garantie de prix ou de stock', () => {
  for (const x of prod.offers) { assert.equal(x.checkedAt, '2026-10-07'); assert.equal(x.verifiedAt, undefined, 'aucune vérification indépendante déclarée'); }
  assert.match(read('js/engine/data/catalog.js'), /checkedAt` est la date du RELEVÉ \(recherche\), pas une vérification indépendante par DERMAI/);
  assert.match(read('js/engine/data/catalog.js'), /À revérifier avant tout lancement public/);
  for (const x of P.offersOf(prod).filter(o => o.availability === 'unknown')) { assert.equal(x.buyable, false); assert.equal(x.linkOnly, true); }
  assert.equal(P.offersOf(prod).find(o => o.market === 'ZA').buyable, true, 'in_stock + lien https : achat possible selon les règles existantes');
  const app = strip(read('js/app.js'));
  assert.match(app, /o\.buyable\?`<a [^>]*>Acheter en ligne<\/a>`:o\.linkOnly\?`<a [^>]*>Voir l'offre<\/a>`/);
  assert.doesNotMatch(app, /Prix garanti|Stock garanti|Disponible actuellement|stock garanti|prix garanti/i);
  assert.doesNotMatch(JSON.stringify(copy.MARKET_TEXTS) + JSON.stringify(copy.OFFER_TEXTS), /garanti(?!t pas)|Disponible actuellement/i);
  for (const o of P.offersOf(prod)) assert.equal(o.verifiedAt, null);
  const dz = P.offersOf(P.byId('cerave-blemish-control-gel', REAL)).find(o => o.market === 'ZA'); assert.equal(dz.verifiedAt, '2026-10-06', 'Dermastore : seule page ouverte directement');
});

test('C8 12. sécurité éditoriale : aucun diagnostic, traitement médical, guérison, promesse absolue, causalité médicale, pourcentage ou score de correspondance, avant/après', () => {
  const texts = [prod.name, prod.description, prod.inciNote, ...prod.ingredients.map(i => i.label), ...prod.offers.flatMap(o => [o.source, o.stockNote || '']), ...prod.sources.map(s => s.label)];
  const BAN = /diagnosti|traite(?:r|s|ment)?\b|soigne|soins? m[ée]dica|gu[ée]ri|gu[ée]rison|[ée]limine|efface|corrige|d[ée]finitiv|permanent|garanti|prouv|cliniquement|dermatolog|m[ée]dical|th[ée]rap|acn[ée]|maladie|pathologi|cancer|anti-?rides?\b|rajeuni|miracle|r[ée]sultats? (?:garantis|assur)|\d\s?%\s?(?:de )?(?:correspondance|compatib)|\bscore\b|avant\s*\/?\s*apr[èe]s|100 ?% efficace/i;
  for (const t of texts) assert.doesNotMatch(String(t), BAN, 'texte : ' + t);
  assert.match(prod.description, /Présenté par la marque pour l'éclat et l'apparence du teint/, 'discours de la marque rapporté comme tel, jamais repris comme promesse');
  assert.doesNotMatch(JSON.stringify(prod), /"(?:match|score|compat|percent)/i);
  assert.ok(prod.description.length <= 300);
});

test('C9 compatibilité moteur : ni exclusion, ni confort, ni « alcohol denat. » ne créent de règle ; contour des yeux, âge cutané et score global jamais liés au produit', () => {
  const eng = ['js/engine/actives.js', 'js/engine/priorities.js', 'js/engine/personalization.js', 'js/engine/routine.js', 'js/engine/interpret.js', 'js/engine/index.js', 'js/engine/products.js', 'js/engine/data/actives.js'].map(f => strip(read(f))).join('\n');
  assert.doesNotMatch(eng, /alcohol|ascorbic|cerave-skin|alcool/i, 'aucune règle n\'est écrite à partir d\'un ingrédient ou de ce produit');
  assert.doesNotMatch(eng.replace(/skin_?age|skinAge/g, 'SA'), /globalScore\s*[^;]{0,40}(?:product|catalog)/i, 'le score global ne touche pas le choix des produits');
  // contour des yeux : informatif seulement, jamais un produit
  const r = Engine.run(norm({ darkCircle: 20, eyebag: 25, pigmentation: 40 }), { goals: ['tone'], level: 'full', cats: [] }, { catalog: REAL });
  const v = views(r, REAL);
  for (const x of v.recommended) assert.ok(!stepsOf(r).some(s => s.indicator === 'darkCircle' && x.steps.includes(s)), 'aucun produit pour le contour des yeux');
});

test('C10 15, 16. échantillon de profils : le produit n\'apparaît dans « Recommandés » que sélectionné par les règles, jamais forcé ; sinon dans « Autres produits » avec la raison du moteur', () => {
  const profiles = [];
  const mk = (ui, o, profile) => profiles.push({ n: norm(ui, o), profile: Object.assign({ goals: [], level: 'simple', cats: [] }, profile) });
  for (const skin of ['Dry', 'Oily', 'Combination', 'Normal', 'Dry & Redness']) mk({ pigmentation: 30, radiance: 40, wrinkles: 45 }, { skin }, { goals: ['tone'], level: 'full' });
  mk({ pigmentation: 30 }, { skin: 'Normal' }, { goals: ['tone'], level: 'full', comfort: { preferGentle: true } });                          // approche douce
  mk({ pigmentation: 30, wrinkles: 40 }, { skin: 'Dry' }, { goals: ['aging'], level: 'full' });                                              // objectif aging
  mk({ radiance: 35 }, { skin: 'Oily' }, { goals: ['tone'], level: 'simple' });                                                              // radiance
  mk({ pigmentation: 40 }, { skin: 'Normal' }, { goals: [], level: 'full' });                                                                // sans objectif
  mk({ pigmentation: 30 }, { skin: 'Normal' }, { goals: ['tone'], level: 'full', exclusions: ['vitamin_c'] });                               // exclusion de l'actif
  mk({ acne: 20, pores: 30, hydration: 25 }, { skin: 'Oily' }, { goals: ['blemishes'], level: 'full' });                                     // vitamin_c non sélectionné
  mk({}, { skin: 'Normal', fill: 90 }, { goals: [], level: 'simple' });                                                                      // tout va bien
  for (const c of sweep(300)) profiles.push({ n: norm(c.ui, c.o), profile: c.profile });
  let withVc = 0, without = 0, others = 0;
  for (const { n, profile } of profiles) {
    const full = Engine.run(n, profile, { catalog: REAL }), base = Engine.run(n, profile, { catalog: WITHOUT });
    const v = views(full, REAL), r = v.recommended.some(x => x.productId === ID), o = v.others.find(x => x.productId === ID), vc = hasVitC(full);
    // le produit ne change rien : mêmes priorités, actifs, routine, score, et mêmes recommandations pour les produits existants
    assert.deepEqual(full.priorities, base.priorities); assert.deepEqual(full.activePlan, base.activePlan); assert.deepEqual(full.routinePlan, base.routinePlan); assert.equal(full.interpretation.globalScore, base.interpretation.globalScore);
    // `selection` décrit le départage (nombre de candidats) : il varie légitimement quand un candidat de plus existe ; le produit retenu, lui, ne change pas
    const pick = ms => JSON.stringify(ms.map(m => Object.assign({}, m, { selection: undefined })));
    assert.equal(pick(full.productMatches), pick(base.productMatches), 'les produits déjà choisis ne sont jamais remplacés');
    if (!vc) { without++; assert.equal(r, false, 'jamais recommandé si vitamin_c n\'est pas dans la routine'); }
    else { withVc++; assert.equal(r, false, 'les règles existantes retiennent déjà un produit à la vitamine C (ordre du catalogue) : il n\'est jamais substitué'); }
    assert.ok(r || o, 'toujours listé : recommandé ou « autres produits »');
    if (o) { others++; assert.ok(typeof o.text === 'string' && o.text.length > 5); if (vc) assert.equal(o.reason, 'other_product_chosen'); else assert.notEqual(o.reason, 'other_product_chosen'); }
  }
  assert.ok(withVc >= 50 && without >= 50, 'profils avec et sans vitamin_c : ' + withVc + ' / ' + without);
  assert.equal(others, profiles.length);
});

test('C11 le produit est sélectionnable : quand vitamin_c est dans la routine et qu\'aucun autre produit à la vitamine C ne précède, il est recommandé ; jamais si l\'actif est exclu ni en l\'absence de vitamin_c', () => {
  const ONLY = REAL.filter(p => p.id === ID || !P.ids(p).includes('vitamin_c'));
  let selected = 0, comfortSelected = 0, notSelected = 0;
  for (const c of sweep(300)) {
    const n = norm(c.ui, c.o), r = Engine.run(n, c.profile, { catalog: ONLY }), v = views(r, ONLY), rec = v.recommended.some(x => x.productId === ID), vc = hasVitC(r);
    assert.equal(rec, vc, 'recommandé exactement quand la routine retient vitamin_c et que ce produit est le seul candidat');
    if (rec) { selected++; if (r.routinePlan.comfortMode) comfortSelected++; const x = v.recommended.find(y => y.productId === ID); assert.ok(x.steps.every(s => s.activeId === 'vitamin_c' || s.stepId), 'seulement pour un pas vitamin_c'); }
    else notSelected++;
  }
  assert.ok(selected >= 20 && notSelected >= 20, selected + ' / ' + notSelected);
  const ex = Engine.run(norm({ pigmentation: 30 }), { goals: ['tone'], level: 'full', cats: [], exclusions: ['vitamin_c'] }, { catalog: ONLY });
  assert.equal(views(ex, ONLY).recommended.some(x => x.productId === ID), false, 'actif exclu : jamais recommandé');
  assert.equal(views(ex, ONLY).others.find(x => x.productId === ID).reason, 'excluded');
  const gentle = Engine.run(norm({ pigmentation: 30 }), { goals: ['tone'], level: 'full', cats: [], comfort: { preferGentle: true } }, { catalog: ONLY });
  if (hasVitC(gentle)) assert.equal(views(gentle, ONLY).recommended.some(x => x.productId === ID), true, 'l\'alcool dénaturé ne le rend pas « irritant » en approche douce : seule la règle existante sur les actifs exigeants s\'applique');
});

test('C12 14. le moteur est strictement identique avec et sans offres (100 profils) et l\'affichage ne déclenche aucune analyse', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const c = randomCase(seed * 977), n = norm(c.ui, c.o);
    const a = Engine.run(n, c.profile, { catalog: REAL }), b = Engine.run(n, c.profile, { catalog: NO_OFFERS });
    assert.equal(JSON.stringify(a), JSON.stringify(b), 'profil #' + seed);
  }
  const app = strip(read('js/app.js'));
  for (const sig of ['function productSheet(', 'function productCard(', 'const offersBlock=', 'const cardOffer=', 'const offerRow=']) assert.doesNotMatch(fnBody(app, sig), /fetch\(|ACCOUNT\.|provider|analyze|runAnalysis|persist\(|XMLHttpRequest/, sig + ' : aucune analyse ni réseau à l\'affichage');
});

test('C13 11, 13, 15. aucun pourcentage ni score ; aucun produit existant cassé ; aucun produit de démonstration en mode réel', () => {
  assert.doesNotMatch(strip(read('js/app.js')).slice(strip(read('js/app.js')).indexOf('function productCard')), /\$\{p\.match\}|% de correspondance|score de correspondance/);
  for (const p of REAL) { assert.deepEqual(P.validateProduct(p), [], p.id); assert.equal(p.demo, false, p.id); }
  assert.equal(REAL.filter(p => p.status === 'validated').length, 11); assert.equal(REAL.filter(p => p.status === 'to_verify').length, 3);
  assert.ok(P.usable(REAL).every(p => p.status === 'validated' && p.active === true));
  const demoIds = new Set(P.PRODUCTS.map(p => p.id)); assert.ok(P.PRODUCTS.every(p => p.demo === true));
  assert.ok(!REAL.some(p => demoIds.has(p.id)), 'aucun produit de démonstration dans le catalogue réel');
  const app = strip(read('js/app.js'));
  assert.match(app, /const catalogNow=\(\)=>DEMO_MODE\?Engine\.products\.PRODUCTS:Engine\.catalogData\.PRODUCTS;/, 'mode réel : uniquement le catalogue réel ; démonstration : uniquement les produits démo');
  for (const id of ['to-salicylic-2-solution', 'to-niacinamide-10-zinc-1', 'cerave-blemish-control-gel', 'lrp-cicaplast-baume-b5-plus', 'to-ascorbyl-glucoside-12']) assert.ok(P.usable(REAL).some(p => p.id === id), id + ' toujours affiché');
});
