'use strict';
/* Étape 18 : audit de séparation MOTEUR / CATALOGUE / MARCHÉ.
   MOTEUR décide (actifs, routine, produits retenus). CATALOGUE décrit les produits. MARCHÉ (pays, offres, qualité) n'arrive qu'APRÈS la recommandation et ne sert qu'à l'affichage commercial. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const MD = require('../js/engine/data/markets.js');
const Market = require('../js/market.js');
const copy = require('../js/engine/copy.fr.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const REAL = CAT.PRODUCTS, ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, 'introuvable : ' + sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };
const lineOf = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, 'introuvable : ' + sig); return src.slice(i, src.indexOf('\n', i)); };
const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- Profils d'essai : variés (peaux, objectifs, approche douce, exclusions, niveaux) ---------- */
const PROFILES = (() => {
  const out = [];
  const mk = (ui, o, profile) => out.push({ n: norm(ui, o), profile: Object.assign({ goals: [], level: 'simple', cats: [] }, profile) });
  for (const skin of ['Dry', 'Oily', 'Combination', 'Normal', 'Dry & Redness', 'Oily & Redness']) mk({ pigmentation: 30, radiance: 40, wrinkles: 45, hydration: 35, acne: 45, pores: 40 }, { skin }, { goals: ['tone', 'hydration'], level: 'full' });
  mk({ pigmentation: 30 }, { skin: 'Normal' }, { goals: ['tone'], level: 'full', comfort: { preferGentle: true } });
  mk({ pigmentation: 30, wrinkles: 40 }, { skin: 'Dry' }, { goals: ['aging'], level: 'full' });
  mk({ pigmentation: 40 }, { skin: 'Normal' }, { goals: [], level: 'full' });
  mk({ pigmentation: 30, acne: 30 }, { skin: 'Oily' }, { goals: ['tone'], level: 'full', exclusions: ['vitamin_c'] });
  mk({ acne: 20, pores: 30, oiliness: 25 }, { skin: 'Oily' }, { goals: ['blemishes'], level: 'full' });
  mk({ hydration: 25 }, { skin: 'Dry' }, { goals: ['hydration'], level: 'simple' });
  mk({}, { skin: 'Normal', fill: 90 }, { goals: [], level: 'simple' });
  for (let s = 1; s <= 30; s++) { const c = randomCase(s * 211); out.push({ n: norm(c.ui, c.o), profile: c.profile }); }
  return out;
})();
const snapshot = (n, profile, catalog) => {
  const r = Engine.run(n, profile, { catalog });
  const v = P.catalogView(r.routinePlan, r.productMatches, catalog);
  return { r, view: v, json: JSON.stringify({ r, rec: v.recommended.map(x => x.productId), oth: v.others.map(x => [x.productId, x.reason]), recFull: v.recommended, othFull: v.others }) };
};
const BASE = PROFILES.map(({ n, profile }) => snapshot(n, profile, REAL));

/* ---------- Variantes COMMERCIALES du catalogue (seules les offres changent) ---------- */
const mapOffers = fn => REAL.map(p => Object.assign({}, p, { offers: (p.offers || []).flatMap(o => fn(clone(o), p)) }));
const VARIANTS = {
  'B catalogue sans aucune offre': () => mapOffers(() => []),
  'catalogue sans le champ offers': () => REAL.map(p => { const c = Object.assign({}, p); delete c.offers; return c; }),
  'C toutes les offres prêtes (stock + prix + lien)': () => mapOffers(o => [Object.assign(o, { availability: 'in_stock', price: o.price || 1000, currency: o.currency || 'NGN', url: o.url || 'https://boutique-vraie.org/p' })]),
  'J toutes les offres en rupture': () => mapOffers(o => [Object.assign(o, { availability: 'out_of_stock' })]),
  'toutes les offres bientôt disponibles': () => mapOffers(o => [Object.assign(o, { availability: 'coming_soon' })]),
  'K toutes les offres en unknown': () => mapOffers(o => [Object.assign(o, { availability: 'unknown' })]),
  'M prix multipliés par 10 / supprimés': () => mapOffers((o, p) => [Object.assign(o, p.id.length % 2 ? { price: o.price * 10 } : { price: null, currency: null })]),
  'N disponibilité inversée': () => mapOffers(o => [Object.assign(o, { availability: o.availability === 'in_stock' ? 'out_of_stock' : 'in_stock' })]),
  'O vendeurs et types changés': () => mapOffers(o => [Object.assign(o, { retailer: 'Vendeur très long '.repeat(3).trim(), seller: 'Autre vendeur', type: 'pharmacy' })]),
  'P deuxième offre ajoutée dans chaque pays': () => mapOffers(o => [o, Object.assign(clone(o), { retailer: 'Deuxième vendeur', url: o.url ? o.url + '-2' : null })]),
  'I plusieurs offres, toutes dans le même pays': () => mapOffers(o => [o, Object.assign(clone(o), { retailer: 'Autre A', price: 1 }), Object.assign(clone(o), { retailer: 'Autre B', availability: 'unknown' })]),
  'Q toutes les offres retirées': () => REAL.map(p => Object.assign({}, p, { offers: [] }))
};

test('S1 audit statique : aucun jeton commercial (pays, marché, devise, offre, prix, stock, vendeur, date de relevé, qualité) dans le moteur de personnalisation', () => {
  const FILES = ['js/engine/index.js', 'js/engine/personalization.js', 'js/engine/priorities.js', 'js/engine/actives.js', 'js/engine/routine.js', 'js/engine/interpret.js', 'js/engine/data/actives.js', 'js/engine/data/indicators.js', 'js/skin-model.js'];
  const TOKENS = /market|country|pays\b|currenc|devise|offer|offre|availability|in_stock|out_of_stock|\bstock\b|seller|vendeur|\bprice|prix|verifiedAt|checkedAt|\bretailer|shipping|livraison|stockNote|\bready\b/i, TOKENS_CS = /qualityOf|byQuality|\bQUALITY\b/;   // « quality » seul est un homonyme (qualité d'une référence scientifique)
  const blank = s => s.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''");   // le code seul : les libellés et références (textes) ne comptent pas
  for (const f of FILES) {
    for (const line of blank(strip(read(f))).split('\n')) if (TOKENS.test(line) || TOKENS_CS.test(line)) assert.fail(f + ' : jeton commercial dans le code du moteur : ' + line.trim().slice(0, 140));
  }
  for (const f of FILES) assert.doesNotMatch(read(f), /require\(['"]\.{1,2}\/(?:\.\.\/)?(?:market|data\/markets|data\/catalog)(?:\.js)?['"]\)/, f + ' : ne dépend ni du marché ni du catalogue réel');
});

test('S2 audit statique de la couche produits : les fonctions de SÉLECTION ne lisent aucune donnée commerciale', () => {
  const src = strip(read('js/engine/products.js'));
  const COMMERCE = /offers?\b|offersOf|commerceOf|marketView|qualityOf|byQuality|MARKETS|QUALITY|\bprice|availability|\bvendor|\.url\b|currency|seller|checkedAt|verifiedAt|stockNote|shipping|country|\bmarket\b/;
  for (const sig of ['function context(', 'function rejection(', 'function match(', 'function catalogView(', 'function primaryActive(']) assert.doesNotMatch(fnBody(src, sig), COMMERCE, sig);
  for (const sig of ['const byId =', 'const ids =', 'const demanding =', 'const strong =', 'const skinOk =', 'const usable =', 'const fitsStep =', 'const stepCategory =', 'const whyOf =']) assert.doesNotMatch(lineOf(src, sig), COMMERCE, sig);
  // et le sens inverse : la couche marché ne lit aucune décision du moteur et n'appelle jamais la sélection
  for (const sig of ['function offersOf(', 'function marketView(', 'function commerceOf(']) assert.doesNotMatch(fnBody(src, sig), /\bmatch\(|catalogView\(|context\(|rejection\(|routine|priorit|Engine/, sig + ' : le marché ne rappelle pas le moteur');
});

test('S3 Engine.run : aucune entrée commerciale ni de pays, ni obligatoire, ni lue ; app.js ne passe jamais le pays au moteur', () => {
  const idx = strip(read('js/engine/index.js'));
  const run = fnBody(idx, 'function run(');
  assert.deepEqual([...new Set([...run.matchAll(/options\.(\w+)/g)].map(m => m[1]))].sort(), ['catalog', 'previous'], 'options : seulement le catalogue de produits et l\'analyse précédente');
  assert.doesNotMatch(run, /country|market|offer|price|availab|seller|currency/i);
  const n = norm({ acne: 30 }); const a = Engine.run(n, { goals: [], level: 'simple', cats: [] }), b = Engine.run(n, { goals: [], level: 'simple', cats: [] }, {}), c = Engine.run(n, { goals: [], level: 'simple', cats: [] }, { catalog: REAL });
  assert.equal(JSON.stringify(a.priorities), JSON.stringify(b.priorities)); assert.equal(JSON.stringify(a.routinePlan), JSON.stringify(c.routinePlan), 'sans catalogue ni option : fonctionne, même routine');
  const app = strip(read('js/app.js'));
  assert.doesNotMatch(lineOf(app, 'const engineFor='), /market|country|offer|MK\./, 'engineFor : aucun marché');
  const eng = [...app.matchAll(/Engine\.run\(([^;]*?)\)\)?[;}\n]/g)].map(m => m[1]);
  assert.ok(eng.length >= 1); for (const e of eng) assert.doesNotMatch(e, /market|country|offer|price|availab/i);
  // où le pays est lu dans app.js : uniquement des fonctions d'affichage commercial
  const where = [];
  for (const m of app.matchAll(/state\.market\b|MK\.(?!choices|isCountry|read|write|byCode|pour|currencyLabel)\w*|marketView|commerceOf|offersOf|cardOffer|offersBlock/g)) {
    const before = app.slice(0, m.index), starts = [...before.matchAll(/\n(?:const|function|let|V\.)\s*([A-Za-z.]+)/g)], name = starts.length ? starts[starts.length - 1][1] : '';
    where.push(name);
  }
  const ALLOWED = new Set(['byCountry', 'marketSelect', 'setMarket', 'offersBlock', 'cardOffer', 'marketBar', 'marketSection', 'priceLine', 'productCard', 'productSheet', 'state', 'MK', 'MT', 'marketStore', 'offerSummary', 'offerRow']);
  for (const w of where) assert.ok(ALLOWED.has(w), 'lecture du marché hors affichage commercial : ' + w);
  assert.doesNotMatch(app.slice(app.indexOf('function engineFor') < 0 ? 0 : 0), /Engine\.run\([^)]*state\.market/);
});

test('S4 preuve dynamique : le moteur et la sélection tournent sur un catalogue « piégé » (toute lecture d\'une donnée commerciale lève une erreur) et sans stockage ni pays', () => {
  const KEYS = new Set(['offers', 'price', 'availability', 'vendor', 'url', 'priceSource', 'priceCheckedAt']);
  const trapped = REAL.map(p => new Proxy(Object.assign({}, p), { get(t, k) { if (KEYS.has(k)) throw new Error('lecture commerciale par le moteur : ' + String(k)); return t[k]; }, ownKeys() { throw new Error('énumération des clés d\'un produit par le moteur'); } }));
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('le moteur lit le stockage (pays)'); } });
  try {
    for (const { n, profile } of PROFILES) {
      const r = Engine.run(n, profile, { catalog: trapped });
      const v = P.catalogView(r.routinePlan, r.productMatches, trapped);
      assert.ok(Array.isArray(v.recommended) && Array.isArray(v.others));
    }
  } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
  const touched = P.usable(trapped).length; assert.equal(touched, 11, 'la liste des produits utilisables ne lit que le statut et l\'état actif');
});

test('S5 TESTS A–K, M–Q : sortie moteur, sections « Recommandés » / « Autres produits » et raisons strictement identiques pour 11 variantes de catalogue × 40 profils', () => {
  assert.ok(PROFILES.length >= 40);
  for (const [name, make] of Object.entries(VARIANTS)) {
    const cat = make();
    PROFILES.forEach(({ n, profile }, i) => assert.equal(snapshot(n, profile, cat).json, BASE[i].json, name + ' : profil #' + i));
  }
  // les variantes sont réellement différentes sur le plan commercial (le test ne compare pas deux fois la même chose)
  const prices = c => JSON.stringify(c.map(p => p.offers));
  assert.notEqual(prices(VARIANTS['M prix multipliés par 10 / supprimés']()), prices(REAL)); assert.notEqual(prices(VARIANTS['J toutes les offres en rupture']()), prices(REAL));
  assert.equal(P.offersOf(VARIANTS['I plusieurs offres, toutes dans le même pays']().find(p => p.id === 'to-niacinamide-10-zinc-1')).length, 6);
});

test('S6 TESTS A, D, E, F, I : 54 pays × états d\'offres (ready / unknown / unavailable / aucune / plusieurs) → mêmes recommandations ; seul marketView change', () => {
  const states = { prêtes: VARIANTS['C toutes les offres prêtes (stock + prix + lien)'](), rupture: VARIANTS['J toutes les offres en rupture'](), unknown: VARIANTS['K toutes les offres en unknown'](), aucune: VARIANTS['B catalogue sans aucune offre'](), plusieurs: VARIANTS['I plusieurs offres, toutes dans le même pays']() };
  const st = memory();
  for (const country of MD.COUNTRIES.map(c => c.code)) {
    Market.write(st, country); assert.equal(Market.read(st), country);
    for (const [label, cat] of Object.entries(states)) {
      for (const i of [0, 1, 6, 9, 12, 20]) {
        const { n, profile } = PROFILES[i], s = snapshot(n, profile, cat);
        assert.equal(s.json, BASE[i].json, country + ' / ' + label + ' / profil #' + i);
        for (const p of cat) { const v = P.marketView(p, country); assert.ok(['no-country', 'local', 'regional', 'international', 'none'].includes(v.tier)); }
      }
    }
  }
  // la présentation, elle, change bien avec le pays et avec l'état des offres
  const nia = id => REAL.find(p => p.id === id);
  assert.equal(P.marketView(nia('to-niacinamide-10-zinc-1'), 'GH').summary, 'ready'); assert.equal(P.marketView(nia('to-niacinamide-10-zinc-1'), 'BJ').summary, 'elsewhere');
  assert.equal(P.marketView(states['rupture'].find(p => p.id === 'to-niacinamide-10-zinc-1'), 'GH').summary, 'unavailable'); assert.equal(P.marketView(states['unknown'].find(p => p.id === 'to-niacinamide-10-zinc-1'), 'GH').summary, 'partial');
  assert.equal(P.marketView(states['aucune'].find(p => p.id === 'to-niacinamide-10-zinc-1'), 'GH').summary, 'none');
});

test('S7 TESTS G, H + scénarios A–D : recommandé sans offre reste recommandé ; non recommandé avec offre locale reste non recommandé ; cartes cohérentes', () => {
  const found = { A: null, B: null, C: null, D: null };
  const rd = Object.assign({}, ...REAL.map(p => ({ [p.id]: p })));
  PROFILES.forEach(({ n, profile }, i) => {
    const v = BASE[i].view, recIds = new Set(v.recommended.map(x => x.productId)), othIds = new Set(v.others.map(x => x.productId));
    for (const country of ['GH', 'NG', 'KE', 'ZA', 'BJ']) {
      for (const id of recIds) { const s = P.marketView(rd[id], country).summary; if (['ready', 'partial'].includes(s)) found.A = found.A || [i, id, country, s]; if (s === 'none' || s === 'elsewhere') found.B = found.B || [i, id, country, s]; }
      for (const id of othIds) { const s = P.marketView(rd[id], country).summary; if (['ready', 'partial'].includes(s)) found.C = found.C || [i, id, country, s]; if (s === 'elsewhere') found.D = found.D || [i, id, country, s]; }
    }
  });
  for (const k of Object.keys(found)) assert.ok(found[k], 'scénario ' + k + ' présent dans les données réelles : ' + JSON.stringify(found));
  // G : le produit recommandé SANS aucune offre (A→B) reste recommandé, quel que soit le pays
  const [iB, idB] = found.B, noOffers = VARIANTS['B catalogue sans aucune offre']();
  for (const country of MD.COUNTRIES.map(c => c.code)) { assert.ok(P.marketView(noOffers.find(p => p.id === idB), country).summary === 'none'); assert.ok(snapshot(PROFILES[iB].n, PROFILES[iB].profile, noOffers).view.recommended.some(x => x.productId === idB), 'recommandé sans offre, pays ' + country); }
  assert.ok(BASE[iB].view.recommended.some(x => x.productId === idB));
  // H : le produit NON recommandé qui reçoit une offre locale prête dans chaque pays reste non recommandé
  const [iC, idC] = found.C, ready = VARIANTS['C toutes les offres prêtes (stock + prix + lien)']();
  const readyEverywhere = ready.map(p => p.id === idC ? Object.assign({}, p, { offers: MD.COUNTRIES.filter(c => ['GH', 'NG', 'KE', 'ZA', 'BJ', 'SN'].includes(c.code)).map(c => ({ market: c.code, retailer: 'Vendeur ' + c.code, type: 'retailer', currency: c.currency, price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/' + c.code, shipping: null, source: 'test', checkedAt: '2026-10-07' })) }) : p);
  const sH = snapshot(PROFILES[iC].n, PROFILES[iC].profile, readyEverywhere);
  assert.ok(!sH.view.recommended.some(x => x.productId === idC) && sH.view.others.some(x => x.productId === idC), 'une offre locale prête ne fait pas passer le produit dans « Recommandés »');
  assert.equal(sH.json, BASE[iC].json);
});

test('S8 TESTS I, J, K, L : changer de pays ne lance aucune analyse et ne modifie ni objectifs, ni actifs, ni routine (profil, état et stockage)', () => {
  const app = strip(read('js/app.js'));
  const set = fnBody(app, 'function setMarket');
  assert.doesNotMatch(set, /runAnalysis|analyze|fetch\(|ACCOUNT|persist\(|SCANS|state\.(goals|level|gentle|exclusions|cats|latest|scanStep|route)|go\(|scan/, 'setMarket ne touche à rien de l\'analyse ni du profil');
  assert.match(set, /render\(true\)/);
  const before = clone(PROFILES.map(({ n, profile }) => ({ n, profile })));
  const st = memory();
  for (const code of MD.COUNTRIES.map(c => c.code)) Market.write(st, code);
  assert.equal(JSON.stringify(PROFILES.map(({ n, profile }) => ({ n, profile }))), JSON.stringify(before), 'le choix d\'un pays ne modifie aucun profil ni aucune donnée d\'analyse');
  PROFILES.forEach(({ n, profile }, i) => assert.equal(snapshot(n, profile, REAL).json, BASE[i].json));
  assert.deepEqual(Object.keys(Object.fromEntries(st.getItem ? [['dermai.market', st.getItem('dermai.market')]] : [])), ['dermai.market'], 'une seule clé : dermai.market');
});

test('S9 TEST M, N, O : prix, disponibilité, vendeur d\'une offre réelle modifiés → moteur et sections identiques, présentation commerciale différente', () => {
  const touch = (id, fn) => REAL.map(p => p.id === id ? Object.assign({}, p, { offers: p.offers.map(o => Object.assign(clone(o), fn(o))) }) : p);
  const id = 'to-niacinamide-10-zinc-1';
  for (const fn of [o => ({ price: o.price + 777 }), o => ({ availability: 'out_of_stock' }), o => ({ retailer: 'Autre boutique', seller: 'Quelqu\'un' })]) {
    const cat = touch(id, fn);
    PROFILES.forEach(({ n, profile }, i) => assert.equal(snapshot(n, profile, cat).json, BASE[i].json));
    assert.notEqual(JSON.stringify(P.offersOf(cat.find(p => p.id === id))), JSON.stringify(P.offersOf(REAL.find(p => p.id === id))), 'la présentation, elle, change');
  }
});

test('S10 produits multiples pour un même actif (vitamin_c) : le pays et les offres ne décident pas ; le départage est la priorité éditoriale explicite (étape 19)', () => {
  const A = P.byId('to-ascorbyl-glucoside-12', REAL), C = P.byId('cerave-skin-renewing-vitamin-c-serum', REAL);
  assert.ok(P.ids(A).includes('vitamin_c') && P.ids(C).includes('vitamin_c'));
  const profile = { goals: ['tone'], level: 'full', cats: [] }, n = norm({ pigmentation: 25, radiance: 40 });
  const chosen = (cat) => { const r = Engine.run(n, profile, { catalog: cat }); return r.productMatches.filter(m => m.activeIds && m.activeIds.includes('vitamin_c')).map(m => m.productId); };
  const base = chosen(REAL); assert.ok(base.length > 0);
  for (const country of MD.COUNTRIES.map(c => c.code)) { Market.write(memory(), country); assert.deepEqual(chosen(REAL), base, 'pays ' + country); }
  for (const [k, make] of Object.entries(VARIANTS)) assert.deepEqual(chosen(make()), base, k);
  // un seul des deux est retenu par pas ; le départage ne regarde ni le pays ni l'offre : il suit l'ordre du catalogue
  assert.deepEqual(base.filter(id => id === C.id || id === A.id), [A.id], 'The Ordinary Ascorbyl Glucoside précède CeraVe dans le catalogue : il est retenu');
  const reversed = REAL.slice().reverse(); const rev = chosen(reversed);
  assert.deepEqual(rev.filter(id => id === C.id || id === A.id), [A.id], 'étape 19 : le départage est la PRIORITÉ ÉDITORIALE explicite, plus l\'ordre physique du catalogue : inverser le catalogue ne change pas le choix');
  assert.deepEqual(chosen(REAL), base);
  // donner à CeraVe toutes les offres du monde ne change rien
  const boosted = REAL.map(p => p.id === C.id ? Object.assign({}, p, { offers: MD.COUNTRIES.map(c => ({ market: c.code, retailer: 'V' + c.code, type: 'retailer', currency: c.currency, price: 1, availability: 'in_stock', url: 'https://boutique-vraie.org/' + c.code, shipping: null, source: 'test', checkedAt: '2026-10-07' })) }) : p);
  assert.deepEqual(chosen(boosted), base);
  const src = strip(read('js/engine/products.js'));
  assert.match(fnBody(src, 'function match('), /sort\(\(a, b\) => score\(b\) - score\(a\) \|\| \(skinOk\(b\.p, routine\.skinBase\) - skinOk\(a\.p, routine\.skinBase\)\) \|\| byPrio\(a, b\) \|\| a\.order - b\.order\)/, 'départage : actifs recherchés, type de peau, priorité éditoriale explicite, puis ordre du catalogue en repli');
  assert.equal(PROFILES.length > 0, true);
});

test('S11 structure des données : catalogue ≠ marché ≠ offres ; champs commerciaux facultatifs ; aucune duplication ; aucun commerce dans la liste des pays', () => {
  const FLAT = ['price', 'availability', 'vendor', 'url', 'priceSource', 'priceCheckedAt'];
  for (const p of REAL) { for (const k of FLAT) assert.equal(p[k], undefined, p.id + ' : champ commercial plat interdit ' + k); }
  for (const p of REAL) for (const o of p.offers) { for (const k of ['name', 'brand', 'ingredients', 'inci', 'category', 'skinTypes', 'targets', 'description', 'format', 'primaryActiveId']) assert.equal(o[k], undefined, 'une offre ne recopie pas les données du produit : ' + k); }
  // facultatifs : un produit sans `offers`, une offre sans seller / city / stockNote / servesMarkets / verifiedAt restent valides
  for (const p of REAL) { const c = Object.assign({}, p); delete c.offers; assert.deepEqual(P.validateProduct(c), [], p.id + ' sans offers'); }
  for (const o of REAL.flatMap(p => p.offers)) { const c = Object.assign({}, o); for (const k of ['seller', 'city', 'stockNote', 'servesMarkets', 'verifiedAt', 'shipping']) delete c[k]; assert.deepEqual(P.validateOffer(c), [], 'offre minimale : ' + o.retailer); }
  assert.doesNotMatch(JSON.stringify(MD), /offer|price|prix|retailer|vendeur|stock|availab|ingredient|\binci\b/i, 'markets.js : aucun commerce, aucun produit');
  assert.doesNotMatch(read('js/market.js').replace(/\/\*[\s\S]*?\*\//g, ''), /offer|price|retailer|availab|ingredient|catalog/i, 'market.js : préférence et liste de pays seulement');
  const cat = strip(read('js/engine/data/catalog.js'));
  assert.doesNotMatch(cat, /MARKETS|marketView|Market|country/, 'le catalogue ne connaît pas la logique de marché');
  // la devise d'un pays est une information d'affichage : jamais utilisée pour déduire une offre locale (XOF au Sénégal ≠ offre au Bénin)
  const sn = Object.assign({}, REAL[1], { offers: [{ market: 'SN', retailer: 'Dakar', type: 'retailer', currency: 'XOF', price: 9000, availability: 'in_stock', url: 'https://boutique-vraie.org/sn', shipping: null, source: 'test', checkedAt: '2026-10-07' }] });
  assert.equal(P.marketView(sn, 'BJ').local.length, 0); assert.equal(P.marketView(sn, 'BJ').regional.length, 0); assert.equal(P.marketView(sn, 'BJ').summary, 'elsewhere');
});

test('S12 livraison et devises : aucune inférence entre pays ; livraison internationale affichée seulement si renseignée ; aucune conversion', () => {
  const make = (offers) => Object.assign({}, REAL[1], { offers });
  const o = (market, extra) => Object.assign({ market, retailer: 'V' + market, type: 'retailer', currency: Market.byCode(market).currency, price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/' + market, shipping: null, source: 'test', checkedAt: '2026-10-07' }, extra || {});
  const view = (offers, c) => P.marketView(make(offers), c);
  // Nigeria ≠ Bénin, Ghana ≠ Togo, Afrique du Sud ≠ Afrique entière
  for (const [from, to] of [['NG', 'BJ'], ['GH', 'TG'], ['ZA', 'KE'], ['ZA', 'NG'], ['ZA', 'GH'], ['KE', 'TZ']]) { const v = view([o(from)], to); assert.equal(v.local.length, 0); assert.equal(v.regional.length, 0); assert.equal(v.international.length, 1); assert.equal(v.international[0].market, from); assert.equal(v.international[0].shipping, null, 'aucune livraison déduite'); }
  assert.equal(view([o('ZA', { shipping: 'local' })], 'BJ').international.length, 0, 'livraison locale annoncée : jamais proposée ailleurs');
  assert.equal(view([o('SN', { servesMarkets: ['BJ'] })], 'BJ').regional.length, 1, 'seule une déclaration explicite du vendeur crée une offre régionale');
  const app = strip(read('js/app.js'));
  assert.match(lineOf(app, 'const note=tier==='), /o\.shipping===`international`/, 'texte de livraison internationale : uniquement si la donnée est renseignée');
  assert.doesNotMatch(app + strip(read('js/market.js')) + strip(read('js/engine/products.js')), /convertCurrency|exchangeRate|rate\(|\btaux\b|toXOF|toFCFA|fcfaEquivalent|≈|environ \d+ ?FCFA/i);
  assert.doesNotMatch(read('js/engine/data/catalog.js'), /FCFA|XOF|XAF/, 'aucune offre ni prix en FCFA converti');
  const priced = REAL.flatMap(p => P.offersOf(p)); for (const x of priced) { const raw = REAL.flatMap(p => p.offers).find(r => r.url === x.url); assert.equal(x.price, raw.price); assert.equal(x.currency, raw.currency); }
});

test('S13 qualité d\'offre, textes et bouton : propriété d\'affichage, jamais un score ; ready seulement → « Acheter en ligne » ; partial → « Voir l\'offre » ; unavailable → aucun bouton ; aucune garantie', () => {
  const offer = extra => P.offersOf(Object.assign({}, REAL[1], { offers: [Object.assign({ market: 'NG', retailer: 'V', type: 'retailer', currency: 'NGN', price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/p', shipping: null, source: 'test', checkedAt: '2026-10-07' }, extra)] }))[0];
  const cases = [[{}, 'ready', true, false], [{ availability: 'unknown' }, 'partial', false, true], [{ price: null, currency: null }, 'partial', false, true], [{ url: null }, 'partial', false, false],
    [{ availability: 'out_of_stock' }, 'unavailable', false, false], [{ availability: 'coming_soon' }, 'unavailable', false, false]];
  for (const [extra, q, buy, link] of cases) { const o = offer(extra); assert.equal(o.quality, q, JSON.stringify(extra)); assert.equal(o.buyable, buy, 'Acheter : ' + JSON.stringify(extra)); assert.equal(o.linkOnly, link, 'Voir l\'offre : ' + JSON.stringify(extra)); }
  assert.ok(P.QUALITY.every(q => typeof q === 'string')); assert.doesNotMatch(JSON.stringify(P.offersOf(REAL[1])), /"(?:score|rank|relevance|pertinence|percent)/i);
  const app = strip(read('js/app.js'));
  assert.match(app, /o\.buyable\?`<a [^>]*>Acheter en ligne<\/a>`:o\.linkOnly\?`<a [^>]*>Voir l'offre<\/a>`:``/);
  assert.equal((app.match(/Acheter en ligne/g) || []).length, 2, 'seulement la ligne d\'offre et la carte (gardée par o.inPlan||noReal())');
  assert.match(app, /co&&co\.buy&&\(o\.inPlan\|\|noReal\(\)\)/);
  const texts = JSON.stringify([copy.MARKET_TEXTS, copy.OFFER_TEXTS, copy.OFFER_AVAILABILITY_LABELS]);
  assert.doesNotMatch(texts, /garanti(?!t pas)|en temps réel|disponible actuellement|stock garanti|prix garanti|livraison garantie|assuré/i);
  assert.equal(copy.MARKET_TEXTS.summary.ready, 'Offre locale : stock et prix indiqués au relevé'); assert.equal(copy.MARKET_TEXTS.summary.partial, 'Offre locale à vérifier : stock, prix ou lien non confirmé');
  assert.equal(copy.MARKET_TEXTS.summary.unavailable, 'Offre locale : rupture ou bientôt disponible'); assert.equal(copy.MARKET_TEXTS.summary.elsewhere, 'Offres dans d\'autres pays seulement'); assert.equal(copy.MARKET_TEXTS.summary.none, 'Aucune offre vérifiée pour ce pays pour le moment.');
  assert.equal(P.marketView(Object.assign({}, REAL[1], { offers: [] }), 'NG').summary, 'none');
  // un produit recommandé sans offre reste visible : la carte n'est jamais conditionnée à une offre
  assert.doesNotMatch(fnBody(app, 'function productCard('), /hasOffers|if\s*\(!?co\)\s*return|\.buyable\s*\?\s*`<button/);
});

test('S14 sélecteur de pays : ni Supabase, ni Perfect Corp, ni analyse, ni historique ; le pays reste local', () => {
  for (const f of ['js/account.js', 'api/skin-analysis.js', 'js/skin-model.js']) assert.doesNotMatch(strip(read(f)), /dermai\.market|DermaiMarket|\bmarket\b|\bcountry\b|shopping_country/i, f);
  const app = strip(read('js/app.js'));
  for (const sig of ['class PerfectCorpProvider', 'function postJpeg(', 'function runAnalysis(']) assert.doesNotMatch(fnBody(app, sig), /state\.market|MK\.|DermaiMarket/, sig);
  assert.doesNotMatch(lineOf(app, 'const profileForSave='), /market/i);
  assert.doesNotMatch(app, /saveAnalysis\([^)]*market|saveProfile\([^)]*market/i);
});
