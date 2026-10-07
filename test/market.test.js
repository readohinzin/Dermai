'use strict';
/* Étape 15 : pays d'achat et options d'achat selon le marché. Le pays est une préférence d'affichage : il ne touche ni le moteur, ni l'historique, ni Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Market = require('../js/market.js');
const MD = require('../js/engine/data/markets.js');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const copy = require('../js/engine/copy.fr.js');
const { M, Engine, run } = require('./helpers/engine.js');
const FX = require('./fixtures/perfectcorp-json-response.json');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, 'fonction introuvable : ' + sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };
const memory = (init) => { const m = new Map(init ? Object.entries(init) : []); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), raw: m }; };
const REAL = CAT.PRODUCTS, blemish = P.byId('cerave-blemish-control-gel', REAL), noOffer = P.byId('to-hyaluronic-b5-ceramides', REAL);
const mkOffer = o => Object.assign({ retailer: 'Vendeur', type: 'retailer', availability: 'in_stock', source: 'Page du vendeur', checkedAt: '2026-10-07' }, o);
const mkProduct = offers => Object.assign({}, blemish, { id: 'test-product', offers });

/* ---------- Structure centralisée des pays ---------- */
test('MK1 pays d\'Afrique : une structure centralisée (ISO, nom français, nom anglais, devise), 54 pays, aucun doublon', () => {
  assert.equal(MD.COUNTRIES.length, 54);
  assert.equal(new Set(MD.COUNTRIES.map(c => c.code)).size, 54);
  for (const c of MD.COUNTRIES) {
    assert.match(c.code, /^[A-Z]{2}$/); assert.ok(c.fr && c.en && typeof c.det === 'string', c.code);
    assert.ok(P.OFFER_CURRENCIES.includes(c.currency), c.code + ' : devise ' + c.currency + ' reconnue');
  }
  assert.deepEqual(Object.keys(P.MARKETS).sort(), MD.COUNTRIES.map(c => c.code).sort(), 'products.js dérive ses pays de la même source');
  for (const c of MD.COUNTRIES) assert.equal(P.MARKETS[c.code], c.fr);
  assert.deepEqual(MD.COUNTRIES.find(c => c.code === 'BJ'), { code: 'BJ', fr: 'Bénin', en: 'Benin', det: 'le', currency: 'XOF' });
});

test('MK2 pays demandés présents ; liste extensible sans toucher au moteur ; devises cohérentes avec les zones monétaires', () => {
  for (const [code, fr, cur] of [['BJ', 'Bénin', 'XOF'], ['BF', 'Burkina Faso', 'XOF'], ['CM', 'Cameroun', 'XAF'], ['CI', 'Côte d\'Ivoire', 'XOF'], ['GH', 'Ghana', 'GHS'], ['KE', 'Kenya', 'KES'], ['MA', 'Maroc', 'MAD'], ['NG', 'Nigeria', 'NGN'], ['SN', 'Sénégal', 'XOF'], ['ZA', 'Afrique du Sud', 'ZAR'], ['TG', 'Togo', 'XOF']]) {
    const c = Market.byCode(code); assert.equal(c.fr, fr); assert.equal(c.currency, cur);
    assert.ok(MD.FEATURED.includes(code), code + ' proposé en premier');
  }
  for (const [cur, zone] of Object.entries({ XOF: ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'], XAF: ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'] })) for (const code of zone) assert.equal(Market.byCode(code).currency, cur, code);
  const { featured, others } = Market.choices();
  assert.equal(featured.length + others.length, 54); assert.equal(new Set([...featured, ...others].map(c => c.code)).size, 54);
  assert.deepEqual(others.map(c => c.fr), others.map(c => c.fr).slice().sort((a, b) => a.localeCompare(b, 'fr')), 'autres pays par ordre alphabétique');
  assert.equal(Market.pour('BJ'), 'pour le Bénin'); assert.equal(Market.pour('CI'), 'pour la Côte d\'Ivoire'); assert.equal(Market.pour('ZA'), 'pour l\'Afrique du Sud'); assert.equal(Market.pour('DJ'), 'pour Djibouti'); assert.equal(Market.pour('XX'), '');
  assert.equal(Market.currencyLabel('XOF'), 'FCFA (XOF)'); assert.equal(Market.currencyLabel('NGN'), 'NGN');
  assert.doesNotMatch(strip(read('js/engine/index.js') + read('js/engine/routine.js') + read('js/engine/priorities.js')), /DermaiMarket|markets\.js/, 'le moteur ne connaît pas la liste des pays');
});

/* ---------- Stockage du pays : A, B, C, Q ---------- */
test('MK3 A. aucun pays choisi : aucun pays par défaut, aucun blocage', () => {
  const st = memory();
  assert.equal(Market.read(st), null); assert.equal(Market.read(null), null);
  const v = P.marketView(blemish, null);
  assert.equal(v.country, null); assert.equal(v.tier, 'no-country'); assert.deepEqual([v.local, v.regional, v.international], [[], [], []]);
  assert.equal(P.marketView(blemish, 'XX').tier, 'no-country', 'un code inconnu vaut « pas de pays »');
  assert.equal(v.all.length, 2, 'les offres connues (Afrique du Sud, Nigeria) restent consultables');
});

test('MK4 B, C, Q. pays choisi, modifié, retrouvé après rechargement ; valeurs invalides refusées ; stockage indisponible sans plantage', () => {
  const st = memory();
  assert.equal(Market.write(st, 'BJ'), true); assert.equal(Market.read(st), 'BJ');
  assert.equal(Market.write(st, 'NG'), true); assert.equal(Market.read(st), 'NG', 'modifié');
  assert.equal(Market.read(memory(Object.fromEntries(st.raw))), 'NG', 'rechargement : un nouveau lecteur retrouve le choix');
  assert.equal(Market.write(st, 'XX'), false); assert.equal(Market.write(st, 'bj'), false); assert.equal(Market.write(st, '<script>'), false); assert.equal(Market.read(st), 'NG');
  assert.equal(Market.read(memory({ [Market.KEY]: 'ZZ' })), null, 'valeur corrompue ignorée');
  assert.equal(Market.write(st, null), true); assert.equal(Market.read(st), null, 'effaçable');
  const broken = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); }, removeItem() { throw new Error('refusé'); } };
  assert.equal(Market.read(broken), null); assert.equal(Market.write(broken, 'BJ'), false); assert.equal(Market.write(null, 'BJ'), false);
  assert.equal(Market.KEY, 'dermai.market');
});

/* ---------- Offres selon le marché : D, E, F, G, H ---------- */
test('MK5 D. offre locale : elle passe en premier, avec son vendeur, sa devise et son prix', () => {
  const v = P.marketView(blemish, 'ZA');
  assert.equal(v.tier, 'local'); assert.equal(v.local.length, 1);
  assert.deepEqual([v.local[0].retailer, v.local[0].currency, v.local[0].price, v.local[0].availability], ['Dermastore', 'ZAR', 300, 'in_stock']);
  assert.equal(v.local[0].buyable, true); assert.equal(v.countryName, 'Afrique du Sud');
});

test('MK6 E. aucune offre locale : ni « indisponible » ni offre inventée ; le produit existe toujours', () => {
  const bj = P.marketView(blemish, 'BJ');
  assert.deepEqual(bj.local, []); assert.notEqual(bj.tier, 'local');
  assert.equal(P.marketView(noOffer, 'BJ').tier, 'none'); assert.equal(P.marketView(noOffer, 'BJ').all.length, 0);
  assert.equal(P.usable(REAL).includes(noOffer), true, 'un produit sans offre reste dans le catalogue');
  assert.match(copy.MARKET_TEXTS.noLocal, /^Aucune offre vérifiée pour ce pays pour le moment\.$/);
  assert.match(copy.MARKET_TEXTS.noLocalCard, /^Aucune offre vérifiée pour votre pays pour le moment\.$/);
  for (const t of Object.values(copy.MARKET_TEXTS)) if (typeof t === 'string') assert.doesNotMatch(t, /indisponible/i, 'jamais « indisponible » faute de donnée');
});

test('MK7 F. hiérarchie : 1 pays, 2 régional (déclaré par le vendeur), 3 international, 4 aucune ; la livraison « locale » ne sort pas de son pays', () => {
  const p = mkProduct([
    mkOffer({ market: 'BJ', retailer: 'A local', currency: 'XOF', price: 9000 }),
    mkOffer({ market: 'SN', retailer: 'B régional', currency: 'XOF', price: 9500, servesMarkets: ['BJ', 'TG'], shipping: 'international' }),
    mkOffer({ market: 'NG', retailer: 'C international', currency: 'NGN', price: 15000, shipping: 'international' }),
    mkOffer({ market: 'KE', retailer: 'D livraison locale', currency: 'KES', price: 2500, shipping: 'local' }),
    mkOffer({ market: 'GH', retailer: 'E inconnu', currency: 'GHS', price: null })
  ]);
  const v = P.marketView(p, 'BJ');
  assert.equal(v.tier, 'local');
  assert.deepEqual(v.local.map(o => o.retailer), ['A local']);
  assert.deepEqual(v.regional.map(o => o.retailer), ['B régional']);
  assert.deepEqual(v.international.map(o => o.retailer).sort(), ['C international', 'E inconnu'], 'D (livraison locale seulement) est exclue');
  assert.equal(P.marketView(p, 'TG').tier, 'regional'); assert.equal(P.marketView(p, 'TG').local.length, 0);
  assert.equal(P.marketView(p, 'ML').tier, 'international');
  assert.equal(P.marketView(mkProduct([mkOffer({ market: 'KE', currency: 'KES', shipping: 'local' })]), 'BJ').tier, 'none');
  assert.equal(P.marketView(p, 'KE').local[0].retailer, 'D livraison locale', 'dans son pays, une offre à livraison locale reste locale');
  for (const o of v.local.concat(v.regional, v.international)) for (const k of Object.keys(o)) assert.doesNotMatch(k, /score|match|percent|rank|best|compat/i);
  assert.ok(P.validateOffer(mkOffer({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ', 'BJ'] })).length, 'doublon refusé');
  assert.ok(P.validateOffer(mkOffer({ market: 'SN', currency: 'XOF', servesMarkets: ['XX'] })).length, 'code inconnu refusé');
  assert.ok(P.validateOffer(mkOffer({ market: 'SN', currency: 'XOF', servesMarkets: [] })).length, 'liste vide refusée (absent = inconnu)');
  assert.deepEqual(P.validateOffer(mkOffer({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ'] })), []);
});

test('MK8 G, H. plusieurs offres et plusieurs devises : chaque offre séparée, dans SA devise, aucune conversion ni somme', () => {
  const p = mkProduct([
    mkOffer({ market: 'NG', retailer: 'Z', currency: 'NGN', price: 15000 }), mkOffer({ market: 'NG', retailer: 'A', currency: 'NGN', price: 14000 }),
    mkOffer({ market: 'GH', retailer: 'G', currency: 'GHS', price: 120 }), mkOffer({ market: 'BJ', retailer: 'B', currency: 'XOF', price: 12500 }), mkOffer({ market: 'KE', retailer: 'K', currency: 'KES', price: 2500 })
  ]);
  const v = P.marketView(p, 'NG');
  assert.deepEqual(v.local.map(o => [o.retailer, o.currency, o.price]), [['A', 'NGN', 14000], ['Z', 'NGN', 15000]], 'chaque offre garde sa devise, ordre déterministe');
  assert.deepEqual(new Set(v.international.map(o => o.currency)), new Set(['GHS', 'XOF', 'KES']));
  const c = P.commerceOf(p); assert.equal(c.price, null, 'aucun prix global');
  assert.doesNotMatch(JSON.stringify(v), /converted|conversion|total|sum|average|moyenne/i);
  assert.ok(P.validateOffer(mkOffer({ market: 'NG', currency: 'XOF', price: 100 })).length, 'XOF au Nigeria refusé');
  assert.ok(P.validateOffer(mkOffer({ market: 'BJ', currency: 'NGN', price: 100 })).length, 'naira au Bénin refusé');
  assert.ok(P.validateOffer(Object.assign(mkOffer({ market: 'BJ', currency: 'XOF', price: 100 }), { converted: 1 })).length, 'champ « converted » interdit');
});

/* ---------- Prix, disponibilité, lien : I, J, K, L, M ---------- */
test('MK9 I. prix absent : « Prix à vérifier », jamais 0 ni prix déduit', () => {
  const p = mkProduct([mkOffer({ market: 'BJ', currency: null, price: null })]);
  const o = P.marketView(p, 'BJ').local[0];
  assert.equal(o.price, null);
  assert.ok(P.validateOffer(mkOffer({ market: 'BJ', price: 0, currency: 'XOF' })).length, 'prix 0 refusé');
  assert.ok(P.validateOffer(mkOffer({ market: 'BJ', price: 100 })).length, 'prix sans devise refusé');
  assert.equal(copy.OFFER_TEXTS.priceToCheck, 'Prix à vérifier');
  assert.match(read('js/app.js'), /\$\{Engine\.copy\.OFFER_TEXTS\.priceToCheck\}/);
});

test('MK10 J. disponibilité inconnue : jamais transformée en « Disponible » ; libellés français exacts', () => {
  const o = P.marketView(mkProduct([mkOffer({ market: 'BJ', availability: 'unknown', url: 'https://boutique.example-shop.org/p' })]), 'BJ').local[0];
  assert.equal(o.availability, 'unknown'); assert.equal(o.availabilityLabel, 'Disponibilité à vérifier'); assert.equal(o.buyable, false);
  assert.equal(o.linkOnly, true, 'le lien reste proposé comme « Voir l\'offre », pas comme un achat');
  assert.deepEqual(copy.OFFER_AVAILABILITY_LABELS, { in_stock: 'En stock', out_of_stock: 'Rupture de stock', coming_soon: 'Bientôt disponible', unknown: 'Disponibilité à vérifier' });
  assert.ok(!Object.values(copy.OFFER_AVAILABILITY_LABELS).some((l, i, a) => l === a[3] && i < 3), 'unknown garde son propre libellé');
});

test('MK11 K, L, M. bouton d\'achat : seulement avec un vrai lien https, un vendeur identifié et une offre ; jamais de lien généré ni http', () => {
  const view = u => P.marketView(mkProduct([mkOffer({ market: 'BJ', currency: 'XOF', price: 100, url: u })]), 'BJ').local;
  assert.equal(view(undefined)[0].url, null); assert.equal(view(undefined)[0].buyable, false, 'K. lien absent : pas de bouton');
  assert.equal(view('https://boutique-vraie.org/produit')[0].buyable, true, 'L. https valide');
  assert.equal(view('https://boutique-vraie.org/produit')[0].url, 'https://boutique-vraie.org/produit', 'lien repris tel quel : ni UTM, ni paramètre ajouté');
  for (const bad of ['http://boutique-vraie.org/p', 'javascript:alert(1)', 'ftp://x.org/p', '//boutique.org/p', 'https://example.com/p', 'https://localhost/p', 'boutique.org/p']) assert.equal(view(bad).length, 0, 'M. refusé : ' + bad);
  assert.ok(P.validateOffer(mkOffer({ market: 'BJ', retailer: '', currency: 'XOF', url: 'https://boutique-vraie.org/p' })).length, 'vendeur obligatoire');
  const app = read('js/app.js');
  assert.match(app, /target="_blank" rel="noopener noreferrer"/); assert.doesNotMatch(strip(app), /utm_|[?&]ref=|affiliate|affiliation|commission|tracking/i);
  assert.doesNotMatch(strip(read('js/engine/products.js')), /utm_|affiliate|affili|commission/i);
});

/* ---------- Le pays n'influence JAMAIS le moteur : N, O ---------- */
test('MK12 N. mêmes résultats pour Bénin, Nigeria, Ghana, Kenya, Afrique du Sud, Sénégal : score, priorités, objectifs, actifs, routine, niveau, interprétation', () => {
  const normalized = M.parseSkinResponse(FX).normalized, profile = { goals: ['tone', 'hydration'], level: 'full', cats: [], comfort: { preferGentle: false } };
  const results = ['BJ', 'NG', 'GH', 'KE', 'ZA', 'SN'].map(code => {
    const st = memory(); Market.write(st, code);
    const r = Engine.run(normalized, profile, { catalog: REAL });
    return { code, json: JSON.stringify(r), r, view: P.catalogView(r.routinePlan, r.productMatches, REAL) };
  });
  const first = results[0];
  for (const x of results) {
    assert.equal(x.json, first.json, 'résultat du moteur identique pour ' + x.code);
    assert.equal(x.r.interpretation.globalScore, first.r.interpretation.globalScore);
    assert.deepEqual(x.r.priorities, first.r.priorities); assert.deepEqual(x.r.activePlan, first.r.activePlan); assert.deepEqual(x.r.routinePlan, first.r.routinePlan);
    assert.equal(x.r.routinePlan.level, first.r.routinePlan.level); assert.deepEqual(x.r.profile.goals, first.r.profile.goals);
    assert.equal(JSON.stringify(x.view), JSON.stringify(first.view), 'Recommandés / Autres produits inchangés pour ' + x.code);
  }
  assert.equal(Engine.run.length <= 3, true, 'run(normalized, profile, options) : aucun paramètre de pays');
  assert.doesNotMatch(strip(read('js/engine/index.js')), /country|pays|market/i, 'index.js du moteur ne mentionne ni pays ni marché');
});

test('MK13 N. le pays ne fait jamais passer un produit de « Autres produits » à « Recommandés » : il ne reçoit aucun accès au choix', () => {
  const normalized = M.parseSkinResponse(FX).normalized, r = Engine.run(normalized, { goals: [], level: 'simple', cats: [] }, { catalog: REAL });
  const before = JSON.stringify(P.catalogView(r.routinePlan, r.productMatches, REAL));
  for (const code of Market.COUNTRIES.map(c => c.code)) { for (const p of REAL) P.marketView(p, code); }
  assert.equal(JSON.stringify(P.catalogView(r.routinePlan, r.productMatches, REAL)), before, 'les 54 pays parcourus : sélection inchangée');
  const src = strip(read('js/engine/products.js'));
  for (const sig of ['function match(', 'function catalogView(', 'function context(', 'function whyOf(']) if (src.includes(sig)) assert.doesNotMatch(fnBody(src, sig), /marketView|offersOf|commerceOf|MARKETS|\.offers\b|country/, sig + ' : la sélection des produits ne lit aucune donnée de marché');
  for (const f of ['js/engine/index.js', 'js/engine/personalization.js', 'js/engine/routine.js', 'js/engine/priorities.js', 'js/engine/interpret.js', 'js/engine/actives.js']) assert.doesNotMatch(strip(read(f)), /marketView|DermaiMarket|dermai\.market|MARKETS/, f);
});

test('MK14 O. l\'historique ne reçoit jamais le pays : ni goals_snapshot, ni compte, ni API, ni base', () => {
  for (const f of ['js/account.js', 'js/skin-model.js', 'api/skin-analysis.js']) assert.doesNotMatch(strip(read(f)), /dermai\.market|DermaiMarket|state\.market|shopping_country|purchase_country|\bmarket\b|\bcountry\b/i, f);
  for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations'))) assert.doesNotMatch(read('supabase/migrations/' + f), /market|country|pays/i, f + ' : aucune colonne de pays');
  const app = strip(read('js/app.js'));
  const prof = app.slice(app.indexOf('const profileForSave='), app.indexOf('function applyProfile'));
  assert.doesNotMatch(prof, /market/i, 'le profil enregistré ne contient pas le pays');
  for (const m of app.matchAll(/ACCOUNT\.(saveAnalysis|saveProfile)\(([^;]*)\)/g)) assert.doesNotMatch(m[2], /market/i, m[0]);
  assert.match(app, /function resetPrivateState\(\)\{(?:(?!\n\}).)*\n\}/s);
  const reset = app.slice(app.indexOf('function resetPrivateState'), app.indexOf('const softStatus'));
  assert.doesNotMatch(reset, /market/i, 'la déconnexion n\'efface pas une préférence d\'appareil, et ne touche pas aux analyses de ce fait');
});

/* ---------- Démo séparée : P ---------- */
test('MK15 P. mode démonstration : aucun sélecteur, aucune offre réelle, aucun pays lu ; produits de démo sans offre ni faux prix', () => {
  const app = strip(read('js/app.js'));
  assert.match(app, /state\.market=DEMO_MODE\?null:MK\.read\(marketStore\(\)\)/);
  assert.match(app, /const marketBar=\(\)=>\{\s*if\(DEMO_MODE\)return ``;/); assert.match(app, /const marketSection=\(\)=>\{\s*if\(DEMO_MODE\)return ``;/);
  assert.match(app, /function setMarket\(code,focusId\)\{\s*if\(DEMO_MODE\|\|!MK\.isCountry\(code\)\)return;/);
  const demo = P.PRODUCTS[0];
  assert.equal(demo.demo, true); assert.deepEqual(P.offersOf(demo), []); assert.equal(P.marketView(demo, 'BJ').tier, 'none');
  assert.ok(!REAL.some(p => p.demo), 'le catalogue réel ne contient aucun produit de démonstration');
  assert.match(app, /p\.demo\?`<span class="badge demo-b">Démo<\/span>`:``/, 'les produits de démonstration restent marqués « Démo »');
});

/* ---------- Pas d'appel externe, pas de localisation : R ---------- */
test('MK16 R. aucun réseau, aucune géolocalisation, aucune adresse IP, aucun Perfect Corp dans le pays d\'achat', () => {
  for (const f of ['js/market.js', 'js/engine/data/markets.js']) assert.doesNotMatch(strip(read(f)), /fetch\(|XMLHttpRequest|sendBeacon|geolocation|navigator\.|perfect|ipapi|ip-api|\bWebSocket\b|document\.cookie/i, f);
  const app = strip(read('js/app.js'));
  assert.doesNotMatch(app, /navigator\.geolocation|getCurrentPosition|watchPosition|ipapi|ipinfo|geoip|ip-api/i, 'aucune géolocalisation dans l\'application');
  const fn = fnBody(app, 'function setMarket');
  assert.doesNotMatch(fn, /fetch\(|ACCOUNT|provider|analyze|persist\(|go\(|location/, 'changer de pays : aucune requête, aucune analyse, aucune navigation');
  assert.match(fn, /render\(true\)/, 'rendu local seulement, sans rechargement');
  const chg = app.slice(app.indexOf('document.addEventListener(`change`'), app.indexOf('document.addEventListener(`submit`'));
  assert.match(chg, /data-market|dataset\.market/);
});

/* ---------- Pas de faux prix, pas de pourcentage : S, T ---------- */
test('MK17 S. aucun faux prix : chaque prix du catalogue réel a sa devise, sa source et sa date ; les pays sans offre n\'affichent rien', () => {
  let offers = 0;
  for (const p of REAL) for (const o of (p.offers || [])) { offers++; assert.deepEqual(P.validateOffer(o), [], p.id); if (o.price != null) assert.ok(o.currency && o.source && o.checkedAt, p.id); }
  assert.ok(offers >= 1);
  const covered = new Set(['GH', 'KE', 'NG', 'ZA']);   // pays pour lesquels des offres vérifiées ont été intégrées (étape 16)
  for (const c of Market.COUNTRIES) if (!covered.has(c.code)) for (const p of REAL) assert.equal(P.marketView(p, c.code).local.length, 0, c.code + ' / ' + p.id + ' : aucune offre locale inventée');
  assert.doesNotMatch(JSON.stringify(MD), /price|prix|vendor|retailer/i, 'la liste des pays ne contient aucune donnée commerciale');
});

test('MK18 T. aucun pourcentage de compatibilité ni score de vendeur dans les textes, les données et l\'interface du pays d\'achat', () => {
  assert.doesNotMatch(JSON.stringify(copy.MARKET_TEXTS), /%|correspondance|compatib|meilleur vendeur|score/i);
  const app = strip(read('js/app.js'));
  const block = app.slice(app.indexOf('const marketSelect'), app.indexOf('const priceLine'));
  assert.doesNotMatch(block, /%|compat|match|score|meilleur/i);
  for (const o of P.offersOf(blemish)) assert.deepEqual(Object.keys(o).filter(k => /match|score|compat|percent|rank/i.test(k)), []);
});

/* ---------- Interface : accessibilité, profil, première utilisation ---------- */
test('MK19 sélecteur : étiquette liée, <select> natif (clavier, mobile), cible ≥ 44 px, texte de 16 px, pays courants puis tous les pays', () => {
  const app = read('js/app.js'), css = read('css/components/card.css');
  assert.match(app, /<label class="c-field__label" for="\$\{id\}">\$\{MT\.label\}<\/label><select class="sel mk-sel" id="\$\{id\}" data-market>/);
  assert.match(app, /<optgroup label="Pays courants">/); assert.match(app, /<optgroup label="Autres pays d'Afrique">/);
  assert.match(app, /<option value="" selected disabled>\$\{MT\.placeholder\}<\/option>/, 'invitation « Choisir un pays » tant qu\'aucun choix');
  assert.match(css, /\.mk-sel\{[^}]*min-height:48px;font-size:16px\}/); assert.match(css, /\.mk-row \.c-btn\{min-height:44px\}/); assert.match(css, /\.mk-else>summary\{[^}]*min-height:44px/);
  assert.match(css, /\.pcard-w \.pbuy\{min-height:44px\}/);
  assert.equal(copy.MARKET_TEXTS.label, 'Pays pour mes achats'); assert.equal(copy.MARKET_TEXTS.question, 'Où souhaitez-vous acheter vos produits ?'); assert.equal(copy.MARKET_TEXTS.prompt, 'Sélectionnez votre pays pour voir les options disponibles.');
});

test('MK20 profil et produits : section « Pays pour mes achats » avec Modifier ; invitation sans blocage ; « Options d\'achat pour le … » ; pas de choix forcé avant l\'analyse', () => {
  const app = read('js/app.js');
  assert.match(app, /const marketSection=\(\)=>/); assert.match(app, /\$\{marketSection\(\)\}/); assert.match(app, /data-act="market-edit" data-v="mk-prof">Modifier<\/button>/);
  assert.match(app, /Options d'achat \$\{MK\.pour\(c\.code\)\}/); assert.match(app, /\$\{MT\.question\}/);
  assert.match(app, /case `market-edit`:state\.marketEdit=true;render\(true\)/);
  const go = app.slice(app.indexOf('function go('), app.indexOf('function back()'));
  assert.doesNotMatch(go, /market/i, 'la navigation ne passe jamais par le choix du pays');
  const scan = app.slice(app.indexOf('V.scan='), app.indexOf('V.analyzing')); assert.doesNotMatch(scan, /state\.market|marketSelect|MT\./, 'aucun choix de pays avant ni pendant l\'analyse');
  assert.match(app, /Si vous choisissez un pays pour vos achats, ce choix reste dans ce navigateur/);
  assert.match(copy.MARKET_TEXTS.help, /ni votre position ni votre adresse IP/);
});

test('MK21 fiche et cartes : produit sans offre = « Produit recommandé » + message neutre ; international distingué du local ; livraison jamais affirmée', () => {
  const app = read('js/app.js');
  for (const k of ['local', 'international', 'shipCheck', 'shipDeclared', 'elsewhereTitle', 'noLocal']) assert.ok(copy.MARKET_TEXTS[k], k);
  assert.equal(copy.MARKET_TEXTS.local, 'Vendeur local'); assert.equal(copy.MARKET_TEXTS.international, 'Achat en ligne / international');
  assert.match(copy.MARKET_TEXTS.shipCheck, /Vérifier la livraison lors de la commande/);
  assert.match(copy.MARKET_TEXTS.elsewhereTitle, /options d'achat en ligne disponibles dans d'autres pays/);
  for (const t of Object.values(copy.MARKET_TEXTS)) assert.doesNotMatch(String(t), /Livraison au |livré au |livrable (au|en) |livraison garantie|livraison gratuite/i, 'aucune promesse de livraison');
  assert.match(app, /Produit recommandé|MT\.recommended/);
  assert.match(app, /<details class="mk-else"><summary>\$\{MT\.elsewhereTitle\}<\/summary>/);
});
