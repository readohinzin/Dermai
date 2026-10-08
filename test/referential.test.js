'use strict';
/* Phase 2 du référentiel produits : carte des preuves (documentaire) et recherches de disponibilité par pays (marketChecks).
   Rien de tout cela n'entre dans la décision : ni la carte des preuves, ni les statuts de disponibilité ne changent un score, une priorité, un actif, une routine ou un produit choisi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EV = require('../js/engine/data/evidence-map.js');
const P = require('../js/engine/products.js');
const CAT = require('../js/engine/data/catalog.js');
const MD = require('../js/engine/data/markets.js');
const AD = require('../js/engine/data/actives.js');
const SM = require('../js/skin-model.js');
const { Engine, norm, randomCase } = require('./helpers/engine.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const clone = o => JSON.parse(JSON.stringify(o));
const REAL = CAT.PRODUCTS;
const ALL_CODES = MD.COUNTRIES.map(c => c.code);
const entry = (indicator, activeId) => EV.ENTRIES.find(x => x.indicator === indicator && x.activeId === activeId);
const lvl = (indicator, activeId) => (entry(indicator, activeId) || {}).evidenceLevel;
const offer = o => Object.assign({ market: 'NG', retailer: 'Vendeur de test', type: 'retailer', currency: 'NGN', price: 1000, availability: 'in_stock', url: 'https://boutique-vraie.org/p', shipping: null, source: 'test', checkedAt: '2026-10-08' }, o);
const check = c => Object.assign({ market: 'BJ', status: 'searched_none', checkedAt: '2026-10-08', method: 'Recherche de test', note: 'jeu de test' }, c);
const base = () => clone(REAL.find(p => p.id === 'to-niacinamide-10-zinc-1'));
const withOffers = (offers, checks) => Object.assign(base(), { offers }, checks ? { marketChecks: checks } : {});

/* ---------- A. La carte des preuves ---------- */
test('REF-A la carte des preuves est valide, couvre les 15 indicateurs et classe chaque lien selon la source réellement consultée', () => {
  assert.deepEqual(EV.validateMap(EV.ENTRIES), []);
  for (const k of SM.METRIC_KEYS) assert.ok(EV.forIndicator(k).length > 0, 'indicateur sans ligne : ' + k);
  // explicit_perfectcorp : seulement ce qu'un passage Perfect Corp établit, avec un lien perfectcorp.com
  assert.deepEqual(EV.ENTRIES.filter(x => x.evidenceLevel === 'explicit_perfectcorp').map(x => x.indicator + '/' + x.activeId).sort(), [
    'acne/benzoyl_peroxide', 'acne/niacinamide', 'acne/salicylic', 'hydration/ceramides', 'hydration/glycerin', 'hydration/hyaluronic', 'oiliness/niacinamide',
    'wrinkles/peptides', 'wrinkles/retinoid', 'wrinkles/vitamin_c'].sort());
  for (const x of EV.ENTRIES.filter(y => /^(explicit_perfectcorp|perfectcorp_example)$/.test(y.evidenceLevel))) assert.match(x.sourceUrl, /^https:\/\/www\.perfectcorp\.com\//, x.indicator + '/' + x.activeId);
  // niveaux prudents
  // contrôle du 2026-10-08 : seules les suggestions attribuées à l'analyse (page « vérificateur d'ingrédients ») sont explicit ; un conseil d'article est un exemple
  assert.ok(EV.ENTRIES.filter(x => x.evidenceLevel === 'explicit_perfectcorp').every(x => /\/skincare-ingredient-checker-with-ai-skin-analysis$/.test(x.sourceUrl)), 'explicit : une seule page, celle où l\'analyse est citée');
  assert.equal(lvl('texture', 'retinoid'), 'perfectcorp_example');
  assert.equal(lvl('firmness', 'retinoid'), 'dermAI_inference');
  for (const a of ['peptides', 'niacinamide']) assert.equal(lvl('firmness', a), 'not_documented', 'fermeté/' + a + ' : citation non retrouvée');
  assert.deepEqual(EV.ENTRIES.filter(x => x.evidenceLevel === 'perfectcorp_example').map(x => x.indicator + '/' + x.activeId).sort(), ['eyeBag/caffeine', 'hydration/squalane', 'texture/retinoid']);
  assert.ok(!EV.ENTRIES.some(x => x.indicator === 'firmness' && /^(explicit_perfectcorp|perfectcorp_example)$/.test(x.evidenceLevel)), 'fermeté : aucun lien Perfect Corp établi');
  assert.equal(lvl('eyeBag', 'caffeine'), 'perfectcorp_example');
  assert.equal(lvl('hydration', 'squalane'), 'perfectcorp_example', 'squalane : exemple d\'un article éducatif');
  for (const a of ['niacinamide', 'salicylic']) assert.equal(lvl('pores', a), 'dermAI_inference');
  for (const a of ['niacinamide', 'azelaic', 'ceramides', 'panthenol']) assert.equal(lvl('redness', a), 'dermAI_inference');
  for (const a of ['vitamin_c', 'niacinamide', 'azelaic', 'aha_pha']) assert.equal(lvl('pigmentation', a), 'dermAI_inference');
  for (const a of ['vitamin_c', 'aha_pha']) assert.equal(lvl('radiance', a), 'dermAI_inference');
  for (const k of ['darkCircle', 'tearTrough', 'droopyUpperEyelid', 'droopyLowerEyelid']) { const l = EV.forIndicator(k); assert.equal(l.length, 1); assert.equal(l[0].evidenceLevel, 'not_documented'); assert.equal(l[0].activeId, null); }
  // toute extraction est déclarée comme telle (perfectcorp.com est inaccessible d'ici) : aucune page n'est prétendue lue
  assert.ok(EV.ENTRIES.filter(x => x.sourceUrl && /perfectcorp\.com/.test(x.sourceUrl)).every(x => x.consulted === 'search_excerpt'));
  // le rétinol reste rangé sous « retinoid » (à valider) : aucun id « retinol »
  assert.ok(!EV.ENTRIES.some(x => x.activeId === 'retinol'));
  // une ligne « dermAI_inference » sur un actif DERMAI doit exister réellement dans les préférences du moteur (la carte décrit le moteur, ne le pilote pas)
  for (const x of EV.ENTRIES.filter(y => y.evidenceLevel === 'dermAI_inference')) assert.ok((AD.PREFERENCE[x.indicator] || []).includes(x.activeId), 'PREFERENCE : ' + x.indicator + '/' + x.activeId);
});

test('REF-A2 trois actifs candidats : documentés, jamais activés', () => {
  assert.deepEqual(EV.CANDIDATE_ACTIVES, ['benzoyl_peroxide', 'tea_tree', 'alpha_arbutin']);
  const cands = EV.ENTRIES.filter(x => x.status === 'candidate_not_enabled');
  assert.deepEqual(cands.map(x => x.activeId).sort(), ['alpha_arbutin', 'benzoyl_peroxide', 'tea_tree']);
  assert.equal(entry('acne', 'benzoyl_peroxide').evidenceLevel, 'explicit_perfectcorp');
  assert.equal(entry('acne', 'tea_tree').evidenceLevel, 'not_documented');
  assert.equal(entry('pigmentation', 'alpha_arbutin').evidenceLevel, 'market_only');
  const ids = AD.ACTIVES.map(a => a.id);
  for (const c of EV.CANDIDATE_ACTIVES) {
    assert.ok(!ids.includes(c), c + ' n\'est pas un actif DERMAI');
    assert.equal(require('../js/engine/actives.js').byId(c), null);
    for (const list of Object.values(AD.PREFERENCE)) assert.ok(!list.includes(c), c + ' hors PREFERENCE');
    for (const p of REAL.concat(require('../js/engine/data/products.js').PRODUCTS)) assert.ok(!p.ingredients.some(i => i.activeId === c), p.id + ' : ' + c + ' relié');
  }
  assert.equal(ids.length, 16, 'aucun actif ajouté');
});

/* ---------- B/C. Valeurs interdites ---------- */
test('REF-B evidenceLevel invalide → rejet', () => {
  const x = clone(entry('hydration', 'glycerin'));
  assert.deepEqual(EV.validateEntry(x), []);
  for (const bad of ['explicit', 'perfectcorp', 'EXPLICIT_PERFECTCORP', '', null, undefined, 3]) assert.ok(EV.validateEntry(Object.assign({}, x, { evidenceLevel: bad })).some(m => /evidenceLevel/.test(m)), String(bad));
  for (const ok of EV.EVIDENCE_LEVELS) assert.ok(EV.validateMap([Object.assign({}, x, { evidenceLevel: ok })]).every(m => !/evidenceLevel invalide/.test(m)));
  assert.deepEqual(EV.EVIDENCE_LEVELS, ['explicit_perfectcorp', 'perfectcorp_example', 'dermAI_inference', 'market_only', 'not_documented']);
});

test('REF-C sourceKind invalide → rejet ; niveau et source doivent s\'accorder', () => {
  const x = clone(entry('hydration', 'glycerin'));
  for (const bad of ['blog', 'official', 'wikipedia', '', null, undefined]) assert.ok(EV.validateEntry(Object.assign({}, x, { sourceKind: bad })).some(m => /sourceKind/.test(m)), String(bad));
  assert.deepEqual(EV.SOURCE_KINDS, ['official_blog', 'official_product_page', 'official_api', 'official_documentation', 'patent', 'market_source', 'internal_rule']);
  // explicit_perfectcorp exige une source Perfect Corp officielle ET un lien perfectcorp.com
  assert.ok(EV.validateEntry(Object.assign({}, x, { sourceKind: 'market_source' })).some(m => /officielle/.test(m)));
  assert.ok(EV.validateEntry(Object.assign({}, x, { sourceUrl: 'https://exemple-quelconque.org/page' })).some(m => /perfectcorp\.com/.test(m)));
  assert.ok(EV.validateEntry(Object.assign({}, x, { sourceUrl: 'http://www.perfectcorp.com/x' })).some(m => /sourceUrl|perfectcorp/.test(m)), 'http refusé');
  assert.ok(EV.validateEntry(Object.assign({}, x, { sourceUrl: 'https://perfectcorp.com.evil.org/x' })).some(m => /perfectcorp\.com/.test(m)), 'faux domaine refusé');
  assert.ok(EV.validateEntry(Object.assign({}, x, { consulted: 'none' })).some(m => /consultation/.test(m)));
  // une règle DERMAI ne porte jamais de lien externe ; une absence de source non plus
  const inf = clone(entry('pores', 'niacinamide')), abs = clone(entry('tearTrough', null));
  assert.ok(EV.validateEntry(Object.assign({}, inf, { sourceUrl: 'https://www.perfectcorp.com/x' })).length);
  assert.ok(EV.validateEntry(Object.assign({}, inf, { sourceKind: 'official_blog' })).length);
  assert.ok(EV.validateEntry(Object.assign({}, abs, { sourceUrl: 'https://www.perfectcorp.com/x' })).length);
});

test('REF-A3 la carte refuse les erreurs de structure : actif inconnu, candidat déguisé, doublon, champ de décision', () => {
  const x = clone(entry('acne', 'salicylic'));
  assert.ok(EV.validateEntry(Object.assign({}, x, { activeId: 'benzoyl_peroxide' })).some(m => /candidate_not_enabled/.test(m)), 'un actif non DERMAI exige le statut candidat');
  assert.ok(EV.validateEntry(Object.assign({}, x, { activeId: 'inconnu_total' })).length);
  const cand = clone(entry('acne', 'benzoyl_peroxide'));
  assert.ok(EV.validateEntry(Object.assign({}, cand, { activeId: 'niacinamide' })).some(m => /déjà un actif DERMAI/.test(m)), 'un candidat ne peut pas porter un actif déjà actif');
  assert.ok(EV.validateEntry(Object.assign({}, cand, { activeId: 'peptides' })).length);
  assert.ok(EV.validateEntry(Object.assign({}, x, { status: 'enabled' })).some(m => /status/.test(m)));
  assert.ok(EV.validateEntry(Object.assign({}, x, { indicator: 'acné' })).some(m => /indicateur/.test(m)));
  assert.ok(EV.validateEntry(Object.assign({}, x, { activeId: null })).some(m => /not_documented/.test(m)));
  assert.ok(EV.validateEntry(Object.assign({}, x, { checkedAt: '08/10/2026' })).length);
  assert.ok(EV.validateEntry(Object.assign({}, x, { notes: '' })).length);
  for (const k of ['score', 'weight', 'priority', 'rank', 'percent']) assert.ok(EV.validateEntry(Object.assign({}, x, { [k]: 1 })).some(m => /interdit/.test(m)), k);
  assert.ok(EV.validateMap([x, clone(x)]).some(m => /double/.test(m)));
  assert.ok(EV.validateEntry(null).length);
});

/* ---------- D/E. marketChecks ---------- */
test('REF-D marketChecks valide : structure, pays ISO, date, méthode, note facultative', () => {
  assert.deepEqual(P.MARKET_CHECK_STATUS, ['searched_found', 'searched_none']);
  assert.deepEqual(P.validateMarketCheck(check()), []);
  assert.deepEqual(P.validateMarketCheck(check({ note: undefined })), []);
  assert.deepEqual(P.validateProduct(withOffers([], [check({ market: 'BJ' }), check({ market: 'TG', note: undefined })])), []);
  assert.deepEqual(P.validateProduct(withOffers([offer({ market: 'GH', currency: 'GHS' })], [check({ market: 'GH', status: 'searched_found' }), check({ market: 'BJ' })])), []);
  assert.deepEqual(P.validateProduct(base()), [], 'marketChecks absent = valide');
  assert.deepEqual(P.validateProduct(Object.assign(base(), { marketChecks: [] })), []);
  assert.ok(P.validateMarketCheck(check({ market: 'XX' })).some(m => /pays/.test(m)));
  assert.ok(P.validateMarketCheck(check({ checkedAt: 'hier' })).some(m => /date/.test(m)));
  assert.ok(P.validateMarketCheck(check({ method: '' })).some(m => /méthode/.test(m)));
  assert.ok(P.validateMarketCheck(check({ note: 5 })).some(m => /note/.test(m)));
  assert.ok(P.validateMarketCheck(check({ score: 3 })).some(m => /champ inattendu/.test(m)));
});

test('REF-E statut de recherche inconnu → rejet ; incohérences avec les offres refusées', () => {
  for (const bad of ['unknown', 'found', 'none', 'unavailable', 'UNAVAILABLE', 'searched', '', null, undefined]) {
    assert.ok(P.validateMarketCheck(check({ status: bad })).some(m => /statut/.test(m)), String(bad));
    assert.ok(P.validateProduct(withOffers([], [check({ status: bad })])).length, 'produit : ' + String(bad));
  }
  assert.ok(P.validateProduct(withOffers([], [check(), check()])).some(m => /double/.test(m)));
  // searched_none contredit une offre du même pays ; searched_found exige une offre valide dans ce pays
  assert.ok(P.validateProduct(withOffers([offer({ market: 'NG' })], [check({ market: 'NG' })])).some(m => /contredit/.test(m)));
  assert.ok(P.validateProduct(withOffers([], [check({ market: 'BJ', status: 'searched_found' })])).some(m => /exige une offre/.test(m)));
  assert.ok(P.validateProduct(Object.assign(base(), { marketChecks: 'BJ' })).some(m => /liste/.test(m)));
  // un produit de démonstration n'a pas de recherche de marché
  const demo = clone(require('../js/engine/data/products.js').PRODUCTS[0]);
  assert.deepEqual(P.validateProduct(demo), []);
  assert.ok(P.validateProduct(Object.assign(demo, { marketChecks: [check()] })).some(m => /démonstration/.test(m)));
});

/* ---------- F/G. Statuts de disponibilité ---------- */
test('REF-F UNKNOWN par défaut : sans recherche fiable, rien n\'est déduit', () => {
  assert.deepEqual(P.AVAILABILITY_STATUS, ['LOCAL', 'REGIONAL', 'IMPORT', 'UNAVAILABLE', 'UNKNOWN']);
  // aucun produit du catalogue ne porte de recherche : aucune recherche fiable n'a été faite (les pistes web ne sont pas des recherches vérifiées)
  assert.ok(REAL.every(p => p.marketChecks == null), 'aucune marketChecks dans catalog.js');
  assert.deepEqual(P.validateCatalog(REAL), []);
  for (const code of ['BJ', 'TG', 'CI', 'SN']) for (const p of REAL) {
    const s = P.availabilityStatus(p, code);
    assert.equal(s.status, 'UNKNOWN', p.id + ' ' + code); assert.notEqual(s.status, 'UNAVAILABLE');
  }
  // un produit sans aucune offre est UNKNOWN partout, jamais UNAVAILABLE
  const none = withOffers([]);
  for (const c of ALL_CODES) assert.equal(P.availabilityStatus(none, c).status, 'UNKNOWN', c);
  // sans pays choisi : UNKNOWN
  assert.equal(P.availabilityStatus(none, null).status, 'UNKNOWN'); assert.equal(P.availabilityStatus(none, 'ZZ').status, 'UNKNOWN'); assert.equal(P.availabilityStatus(none, undefined).country, null);
  // une offre dans un AUTRE pays dont la livraison n'est pas indiquée ne fait pas un IMPORT : on ne sait pas
  const elsewhere = withOffers([offer({ market: 'NG', shipping: null })]);
  assert.equal(P.availabilityStatus(elsewhere, 'BJ').status, 'UNKNOWN'); assert.equal(P.availabilityStatus(elsewhere, 'BJ').reason, 'no_reliable_offer');
  // des offres en rupture seulement : pas de disponibilité fiable, et pas non plus UNAVAILABLE (aucune recherche explicite)
  const oos = withOffers([offer({ market: 'BJ', currency: 'XOF', availability: 'out_of_stock', shipping: 'local' })]);
  assert.equal(P.availabilityStatus(oos, 'BJ').status, 'UNKNOWN');
  const oosIntl = withOffers([offer({ market: 'NG', availability: 'coming_soon', shipping: 'international' })]);
  assert.equal(P.availabilityStatus(oosIntl, 'BJ').status, 'UNKNOWN');
  // le catalogue réel : les statuts existants restent ceux des offres (NG, GH, KE, ZA)
  const niac = REAL.find(p => p.id === 'to-niacinamide-10-zinc-1');
  assert.equal(P.availabilityStatus(niac, 'GH').status, 'LOCAL'); assert.equal(P.availabilityStatus(niac, 'NG').status, 'LOCAL');
});

test('REF-G UNAVAILABLE uniquement après une recherche explicite ; LOCAL, REGIONAL et IMPORT viennent d\'offres fiables', () => {
  const searched = withOffers([], [check({ market: 'BJ', status: 'searched_none', checkedAt: '2026-10-08' })]);
  assert.deepEqual(P.validateProduct(searched), []);
  const s = P.availabilityStatus(searched, 'BJ');
  assert.equal(s.status, 'UNAVAILABLE'); assert.equal(s.reason, 'searched_none'); assert.equal(s.checkedAt, '2026-10-08');
  // la recherche vaut pour SON pays seulement
  for (const c of ALL_CODES.filter(x => x !== 'BJ')) assert.equal(P.availabilityStatus(searched, c).status, 'UNKNOWN', c);
  // une recherche invalide ou « trouvée » ne produit jamais UNAVAILABLE
  assert.equal(P.availabilityStatus(Object.assign(base(), { offers: [], marketChecks: [check({ status: 'bogus' })] }), 'BJ').status, 'UNKNOWN');
  assert.equal(P.availabilityStatus(Object.assign(base(), { offers: [], marketChecks: [check({ status: 'searched_found' })] }), 'BJ').status, 'UNKNOWN');
  assert.equal(P.availabilityStatus(Object.assign(base(), { offers: [], marketChecks: [check({ checkedAt: 'x' })] }), 'BJ').status, 'UNKNOWN');
  // LOCAL : une offre fiable dans le pays
  assert.equal(P.availabilityStatus(withOffers([offer({ market: 'BJ', currency: 'XOF', shipping: 'local' })]), 'BJ').status, 'LOCAL');
  // REGIONAL : le vendeur déclare desservir le pays
  const reg = withOffers([offer({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ', 'TG'] })], [check({ market: 'BJ' })]);
  assert.equal(P.availabilityStatus(reg, 'BJ').status, 'REGIONAL', 'une offre régionale passe avant searched_none (aucune offre LOCALE trouvée)');
  assert.equal(P.availabilityStatus(reg, 'TG').status, 'REGIONAL'); assert.equal(P.availabilityStatus(reg, 'CI').status, 'UNKNOWN');
  // IMPORT : livraison internationale explicitement indiquée
  const imp = withOffers([offer({ market: 'NG', shipping: 'international' })], [check({ market: 'BJ' })]);
  assert.equal(P.availabilityStatus(imp, 'BJ').status, 'IMPORT');
  // une livraison « locale » n'est jamais proposée hors de son pays
  assert.equal(P.availabilityStatus(withOffers([offer({ market: 'NG', shipping: 'local' })]), 'BJ').status, 'UNKNOWN');
  // ordre : LOCAL > REGIONAL > IMPORT
  const mix = withOffers([offer({ market: 'NG', shipping: 'international' }), offer({ market: 'SN', currency: 'XOF', servesMarkets: ['BJ'], url: 'https://boutique-vraie.org/q' }),
    offer({ market: 'BJ', currency: 'XOF', shipping: 'local', url: 'https://boutique-vraie.org/r' })]);
  assert.equal(P.availabilityStatus(mix, 'BJ').status, 'LOCAL');
  // la lecture d'un statut ne modifie pas le produit
  const before = JSON.stringify(mix); for (const c of ALL_CODES) P.availabilityStatus(mix, c); assert.equal(JSON.stringify(mix), before);
});

/* ---------- H/I. Le moteur ne change pas ---------- */
test('REF-H aucun fichier de décision ne lit la carte des preuves ni les recherches de marché ; app.js reste sous le budget', () => {
  const evidenceRefs = ['js/engine/data/decision.js', 'js/engine/data/indicators.js', 'js/engine/data/actives.js', 'js/engine/actives.js', 'js/engine/accompaniment.js', 'js/engine/interpret.js', 'js/engine/priorities.js',
    'js/engine/routine.js', 'js/engine/synthesis.js', 'js/engine/personalization.js', 'js/engine/index.js', 'js/app.js', 'index.html'];
  for (const f of evidenceRefs) { const src = strip(read(f)); assert.ok(!/evidence-map|evidenceMap/.test(src), f + ' ne lit pas la carte des preuves'); assert.ok(!/marketChecks|availabilityStatus/.test(src), f + ' ne lit pas les recherches de marché'); }
  // dans products.js, la sélection (match / rejection / fitsStep) n'utilise ni marketChecks ni le statut de disponibilité
  const src = strip(read('js/engine/products.js'));
  const body = (sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };
  for (const sig of ['function match(', 'function rejection(', 'const fitsStep', 'function context(', 'function whyOf(', 'function catalogView(']) {
    let b; try { b = body(sig); } catch (e) { continue; }
    assert.ok(!/marketChecks|availabilityStatus|evidence/.test(b), sig + ' ne dépend pas des recherches de marché');
  }
  assert.ok(Buffer.byteLength(read('js/app.js')) <= 149365, 'app.js n\'a pas grossi');
  assert.ok(!/evidence-map/.test(read('index.html')), 'la carte des preuves n\'est pas chargée par l\'application');
});

test('REF-H2 les recherches de marché ne changent ni le moteur ni les produits choisis (200 profils), même « searched_none » partout', () => {
  const withChecks = REAL.map(p => {
    const q = clone(p); const taken = new Set((q.offers || []).map(o => o.market));
    if (q.status === 'validated') q.marketChecks = ['BJ', 'TG', 'CI', 'SN'].filter(c => !taken.has(c)).map(c => check({ market: c }));
    return q;
  });
  assert.deepEqual(P.validateCatalog(withChecks), []);
  assert.ok(withChecks.some(p => p.marketChecks && p.marketChecks.length), 'jeu de test non vide');
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed), run = cat => Engine.run(norm(c.ui, c.o), c.profile, { catalog: cat });
    const a = run(REAL), b = run(withChecks);
    assert.equal(JSON.stringify(b), JSON.stringify(a), 'seed ' + seed);
    const va = P.catalogView(a.routinePlan, a.productMatches, REAL), vb = P.catalogView(b.routinePlan, b.productMatches, withChecks);
    assert.equal(JSON.stringify(vb), JSON.stringify(va), 'sections seed ' + seed);
  }
});

test('REF-I un produit indisponible dans un pays garde sa recommandation ; un produit non vérifié n\'est jamais recommandé ; le rétinoïde reste à valider', () => {
  const PROFILE = { goals: ['blemishes'], level: 'full', cats: [] };
  const run = cat => Engine.run(norm({ acne: 20, pores: 40 }, { skin: 'Oily' }), PROFILE, { catalog: cat });
  const picked = r => r.productMatches.map(m => m.productId);
  const ref = run(REAL), refIds = picked(ref);
  assert.ok(refIds.length > 0, 'cas de référence : au moins un produit choisi');
  // chaque produit choisi devient « UNAVAILABLE » au Bénin : la recommandation reste identique
  const marked = REAL.map(p => { const q = clone(p); if (q.status === 'validated') q.marketChecks = [check({ market: 'BJ' })]; return q; });
  assert.deepEqual(P.validateCatalog(marked), []);
  assert.deepEqual(picked(run(marked)), refIds);
  for (const id of refIds) assert.equal(P.availabilityStatus(marked.find(p => p.id === id), 'BJ').status, 'UNAVAILABLE');
  // aucun produit à vérifier ni inactif n'est proposé, même avec une recherche positive
  const toVerify = REAL.filter(p => p.status === 'to_verify').map(p => p.id);
  assert.deepEqual(toVerify.sort(), ['lrp-effaclar-duo-m', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum']);
  for (let seed = 1; seed <= 200; seed++) { const c = randomCase(seed); for (const m of Engine.run(norm(c.ui, c.o), c.profile, { catalog: REAL }).productMatches) assert.ok(!toVerify.includes(m.productId), m.productId); }
  assert.ok(P.usable(REAL).every(p => p.status === 'validated' && p.active !== false));
  // aucun produit du catalogue n'a de rétinoïde ni d'actif candidat relié ; un produit à rétinoïde ne serait jamais choisi
  for (const p of P.usable(REAL)) assert.ok(!p.ingredients.some(i => i.activeId === 'retinoid' || EV.CANDIDATE_ACTIVES.includes(i.activeId)), p.id + ' : aucun produit recommandable ne porte de rétinoïde');
  for (const p of REAL) assert.ok(!p.ingredients.some(i => EV.CANDIDATE_ACTIVES.includes(i.activeId)), p.id + ' : aucun actif candidat relié');
  assert.ok(REAL.filter(p => p.ingredients.some(i => i.activeId === 'retinoid')).every(p => p.status === 'to_verify' && p.active === false), 'le seul produit à rétinoïde (Mela B3) reste à vérifier et inactif');
  assert.equal(AD.ACTIVES.find(a => a.id === 'retinoid').status, 'à_valider');
  assert.equal(REAL.length, 14, 'les 14 produits existants sont intacts');
});
