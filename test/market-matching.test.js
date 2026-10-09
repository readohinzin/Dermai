'use strict';
/* Phase 3B-3 : matcher produit (tools/market/match.js) et jeu de tests étiqueté (test/fixtures/market-matching-fixture.js).
   Le matcher répond « est-ce probablement le même produit ? » : ni fiabilité d'offre (confidence), ni LOCAL/REGIONAL/IMPORT (classify). Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../tools/market/match.js');
const I = require('../tools/market/identity.js');
const N = require('../tools/market/normalize.js');
const F = require('./fixtures/market-matching-fixture.js');
const CAT = require('../js/engine/data/catalog.js');

const ROOT = path.join(__dirname, '..');
const IDENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/identities.json'), 'utf8'));
const PRODUCTS = CAT.PRODUCTS;
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const clone = o => JSON.parse(JSON.stringify(o));
const HA = 'to-hyaluronic-b5-ceramides';
const run = (candidate, productId, patch) => M.matchCandidate(candidate, F.applyPatch(IDENT.products[productId], patch), { productId });
const cls = (title, productId, extra, patch) => run(Object.assign({ title }, extra || {}), productId || HA, patch).matchClass;

test('MT-1 exactement cinq classes ; aucune autre valeur n\'est jamais renvoyée', () => {
  assert.deepEqual(M.CLASSES, ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH']);
  for (const k of F.CASES) assert.ok(M.CLASSES.includes(run(k.candidate, k.productId, k.patch).matchClass), k.id);
});

test('MT-2 jeu étiqueté : chaque cas donne la classe, les signaux, la raison et l\'avertissement attendus', () => {
  const ids = new Set();
  for (const k of F.CASES) {
    assert.ok(!ids.has(k.id), 'id de cas unique : ' + k.id); ids.add(k.id);
    const r = run(k.candidate, k.productId, k.patch);
    assert.equal(r.matchClass, k.expected, k.id + ' : ' + k.note + ' → ' + r.reasonCodes.join(','));
    for (const [sig, v] of Object.entries(k.signals)) assert.equal(r.signals[sig], v, k.id + ' : signal ' + sig);
    if (k.reason) assert.ok(r.reasonCodes.includes(k.reason), k.id + ' : raison ' + k.reason + ' absente de ' + r.reasonCodes.join(','));
    if (k.warning) assert.ok(r.warningCodes.includes(k.warning), k.id + ' : avertissement ' + k.warning + ' absent de ' + r.warningCodes.join(','));
  }
});

test('MT-3 couverture du jeu : toutes les familles demandées, avec le nombre minimal de cas', () => {
  const byFamily = f => F.CASES.filter(k => k.family === f);
  assert.ok(F.CASES.length >= 60, 'au moins 60 cas');
  assert.ok(byFamily('EXACT').length >= 3 && byFamily('STRONG').length >= 3 && byFamily('POSSIBLE').length >= 4 && byFamily('VARIANT').length >= 6 && byFamily('NO_MATCH').length >= 8, 'effectifs par famille');
  const reasons = new Set(F.CASES.map(k => k.reason));
  for (const r of ['gtin_match', 'mpn_match', 'gtin_mismatch', 'mpn_mismatch', 'brand_mismatch', 'concentration_mismatch', 'actives_mismatch', 'volume_kind_mismatch', 'variant_negated', 'name_conflict',
    'volume_format_differs', 'variant_formulation_mismatch', 'variant_packaging', 'variant_sibling', 'volume_absent', 'concentration_absent', 'variant_absent', 'name_incomplete', 'brand_unknown']) assert.ok(reasons.has(r), 'raison couverte : ' + r);
  for (const f of ['EXACT', 'STRONG', 'POSSIBLE', 'VARIANT', 'NO_MATCH', 'TRAP', 'IDENTIFIER']) assert.ok(byFamily(f).length > 0, f);
  for (const k of F.CASES) assert.ok(k.productId && k.candidate && k.expected && k.note, k.id + ' : cas complet');
});

test('MT-4 hyaluronique : avec céramides, sans formulation, 60 ml, Original Formulation', () => {
  for (const h of F.HYALURONIC) assert.equal(cls(h.title), h.expected, h.id);
  const get = t => run({ title: t }, HA);
  const a = get(F.HYALURONIC[0].title), b = get(F.HYALURONIC[1].title), c = get(F.HYALURONIC[2].title), d = get(F.HYALURONIC[3].title);
  assert.equal(a.signals.variant, 'MATCH'); assert.equal(b.signals.variant, 'UNKNOWN'); assert.equal(c.signals.volume, 'MISMATCH'); assert.equal(d.signals.variant, 'MISMATCH');
  assert.ok(b.warningCodes.includes('sibling_formulation_exists'), 'le produit frère rend le moteur plus conservateur');
  assert.notEqual(b.matchClass, 'STRONG_MATCH'); assert.notEqual(b.matchClass, 'EXACT_MATCH');
});

test('MT-5 cas Lynia : sans formulation écrite, jamais EXACT ; avec « céramides » écrit, le moteur tranche', () => {
  for (const l of F.LYNIA) assert.equal(cls(l.title), l.expected, l.id + ' : ' + l.why);
  // la décision humaine (capture) n'est pas reproduite : l'offre du catalogue n'entre jamais dans le matching
  const lynia = PRODUCTS.find(p => p.id === HA).offers.find(o => o.retailer === 'Lynia Shop');
  const candidate = { title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml vendu au bénin' };
  const before = JSON.stringify(run(candidate, HA));
  const idx = M.buildIndex(IDENT, { products: PRODUCTS.map(p => Object.assign(clone(p), { offers: [] })) }), idx2 = M.buildIndex(IDENT, { products: PRODUCTS });
  assert.equal(JSON.stringify(M.findMatches(candidate, idx)), JSON.stringify(M.findMatches(candidate, idx2)), 'les offres du catalogue sont sans effet sur le matching');
  assert.equal(JSON.stringify(run(candidate, HA)), before);
  assert.ok(!lynia || (lynia.price === 12700 && lynia.currency === 'XOF'), 'offre Lynia intacte');
  const r = run({ title: F.LYNIA[0].title }, HA);
  assert.equal(r.signals.variant, 'UNKNOWN'); assert.ok(r.reasons.includes('formulation absente de la fiche'));
});

test('MT-6 cas pièges : en cas de doute, POSSIBLE plutôt qu\'un faux EXACT ; jamais de faux STRONG parmi les pièges', () => {
  const traps = F.CASES.filter(k => k.family === 'TRAP');
  assert.ok(traps.length >= 10);
  for (const k of traps) {
    const r = run(k.candidate, k.productId, k.patch);
    if (k.expected !== 'EXACT_MATCH' && k.expected !== 'STRONG_MATCH') assert.ok(!['EXACT_MATCH', 'STRONG_MATCH'].includes(r.matchClass), k.id + ' : faux positif');
  }
  // « Duo » dans un nom de gamme n'est pas un coffret ; un vrai coffret l'est
  assert.equal(cls('La Roche-Posay Effaclar Duo+M 40 ml', 'lrp-effaclar-duo-m'), 'STRONG_MATCH'); assert.equal(cls('La Roche-Posay Effaclar Duo+M Kit 40 ml', 'lrp-effaclar-duo-m'), 'VARIANT_MATCH'); // limite connue : pour ce produit, « duo » ne peut pas signaler un lot (c'est son nom)
  // « Original » seul n'est pas une formulation reconnue : jamais pris pour « Original Formulation »
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml Original' }, HA).signals.variant, 'UNKNOWN');
});

test('MT-7 stabilité : les écritures équivalentes donnent le même résultat ; les concentrations échangées restent différentes', () => {
  const results = F.STABLE.map(t => { const r = run({ title: t }, HA); return JSON.stringify([r.matchClass, r.signals]); });
  assert.equal(new Set(results).size, 1, 'quatre écritures, un seul résultat : ' + results[0]);
  assert.equal(JSON.parse(results[0])[0], 'EXACT_MATCH');
  const nia = 'to-niacinamide-10-zinc-1';
  assert.equal(cls('The Ordinary Niacinamide 10% + Zinc 1% 30ml', nia), 'EXACT_MATCH'); assert.equal(cls('The Ordinary Zinc 1% + Niacinamide 10% 30ml', nia), 'EXACT_MATCH', 'ordre des mots indifférent');
  assert.equal(cls('The Ordinary Niacinamide 1% + Zinc 10% 30ml', nia), 'NO_MATCH'); assert.equal(run({ title: 'The Ordinary Niacinamide 1% + Zinc 10% 30ml' }, nia).signals.concentration, 'MISMATCH');
  // FR / EN : mêmes résultats via le lexique
  assert.equal(JSON.stringify(run({ title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml avec céramides' }, HA).signals), JSON.stringify(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml with ceramides' }, HA).signals));
});

test('MT-8 volumes comparés après normalisation ; un autre format est une variante ; une autre nature d\'unité est une contradiction', () => {
  for (const v of ['30ml', '30 ml', '30mL', '0.03 L', '3 cl', '30 ML']) assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides ' + v }, HA).signals.volume, 'MATCH', v);
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 1 fl oz' }, HA).signals.volume, 'MATCH', '1 fl oz = 30 ml étiqueté (arrondi)');
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 1.5 fl oz' }, HA).signals.volume, 'MISMATCH');
  assert.equal(cls('The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 60 ml'), 'VARIANT_MATCH');
  assert.equal(cls('The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 30 g'), 'NO_MATCH');
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 1 oz' }, HA).signals.volume, 'UNKNOWN', 'oz seul : ambigu, jamais comparé');
  // volume structuré fourni à part
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides', volume: { value: 30, unit: 'ml' } }, HA).signals.volume, 'MATCH');
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides', volume: '60 ml' }, HA).signals.volume, 'MISMATCH');
  assert.equal(run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides 30 ml / 60 ml' }, HA).signals.volume, 'UNKNOWN', 'plusieurs formats dans la fiche');
  assert.equal(run({ title: 'Liftactiv Supreme Vitamin C Serum Vichy 20 ml' }, 'vichy-liftactiv-vitamin-c-serum').signals.volume, 'UNKNOWN', 'volume absent du catalogue : jamais comparé');
});

test('MT-9 identifiants : GTIN / MPN seulement avec source côté catalogue ; un SKU vendeur n\'est jamais un MPN', () => {
  assert.equal(M.isValidGtin(F.G1), true); assert.equal(M.isValidGtin('5060000000000'), false); assert.equal(M.isValidGtin('12'), false); assert.equal(M.isValidGtin(null), false); assert.equal(M.isValidGtin('5060 0000 0001 6'), true);
  const base = { brand: 'The Ordinary', title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml' };
  // catalogue sans GTIN : le GTIN de la fiche n'est PAS une preuve
  const noId = run(Object.assign({ gtin: F.G1 }, base), HA); assert.equal(noId.signals.gtin, 'UNKNOWN'); assert.notEqual(noId.matchClass, 'EXACT_MATCH'); assert.ok(noId.warningCodes.includes('candidate_gtin_ignored'));
  const withG = { identifiers: { gtin: { value: F.G1, source: 'valeur de test' } } };
  assert.equal(run(Object.assign({ gtin: F.G1 }, base), HA, withG).matchClass, 'EXACT_MATCH');
  assert.equal(run(Object.assign({ gtin: F.G2 }, base), HA, withG).matchClass, 'NO_MATCH'); assert.equal(run(Object.assign({ gtin: F.G2 }, base), HA, withG).signals.gtin, 'MISMATCH');
  assert.equal(run(Object.assign({ gtin: '0' + F.G1 }, base), HA, withG).signals.gtin, 'MATCH', 'GTIN-14 de même base');
  // MPN
  const withM = { identifiers: { mpn: { value: 'TO-HA-30', source: 'valeur de test' } } };
  assert.equal(run(Object.assign({ mpn: 'to ha 30' }, base), HA, withM).signals.mpn, 'MATCH'); assert.equal(run(Object.assign({ mpn: 'TO-HA-60' }, base), HA, withM).matchClass, 'NO_MATCH');
  const mpnOnly = run({ mpn: 'TO-HA-30', title: 'Hyaluronic Acid 2% + B5 30 ml' }, HA, withM); assert.equal(mpnOnly.signals.brand, 'UNKNOWN'); assert.equal(mpnOnly.matchClass, 'STRONG_MATCH', 'MPN sans marque : STRONG seulement');
  // SKU vendeur : même valeur que le MPN du catalogue, aucun effet
  const sku = run(Object.assign({ sku: 'TO-HA-30' }, base), HA, withM); assert.equal(sku.signals.mpn, 'UNKNOWN'); assert.ok(sku.warningCodes.includes('sku_ignored'));
  assert.equal(sku.matchClass, run(base, HA, withM).matchClass);
  // l\'identité enregistrée ne contient aucun identifiant : aucune preuve par identifiant n\'existe sans test
  for (const x of Object.values(IDENT.products)) assert.deepEqual(x.identifiers, { gtin: null, mpn: null, sku: null });
});

test('MT-10 les produits frères rendent le moteur plus conservateur', () => {
  const t = 'The Ordinary Hyaluronic Acid 2% + B5 30 ml';
  const noSib = F.applyPatch(IDENT.products[HA], { siblings: [] });
  const base = clone(IDENT.products[HA]); base.variant = null;
  const bare = clone(base); bare.siblings = [];
  assert.equal(M.matchCandidate({ title: t }, bare, { productId: HA }).matchClass, 'EXACT_MATCH', 'sans variante ni frère : rien d\'ambigu');
  assert.equal(M.matchCandidate({ title: t }, base, { productId: HA }).matchClass, 'POSSIBLE_MATCH', 'avec frères de formulation : POSSIBLE');
  const withCandidateSibling = clone(bare); withCandidateSibling.siblings = [{ relation: 'formulation', label: 'autre formule (candidat à vérifier)', variant: 'original', volume: null, productId: null, status: 'candidate' }];
  assert.equal(M.matchCandidate({ title: t }, withCandidateSibling, { productId: HA }).matchClass, 'POSSIBLE_MATCH', 'un frère simplement candidat suffit à rendre le moteur prudent');
  assert.equal(run({ title: t + ' with Ceramides' }, HA).matchClass, 'EXACT_MATCH', 'formulation explicite : le moteur peut trancher');
  assert.ok(noSib.siblings.length === 0 && IDENT.products[HA].siblings.length > 0, 'l\'identité enregistrée n\'est pas modifiée par un patch de test');
});

test('MT-11 alias : seuls les alias déclarés comptent, rien n\'est inventé', () => {
  for (const b of ['The Ordinary', 'THE ORDINARY', 'Theordinary', 'the-ordinary']) assert.equal(run({ brand: b, title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, HA).signals.brand, 'MATCH', b);
  for (const b of ['Ordinary', 'TO', 'Deciem']) assert.notEqual(run({ brand: b, title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, HA).signals.brand, 'MATCH', b + ' n\'est pas un alias déclaré');
  for (const t of ['LRP', 'La Roche-Posay', 'Laroche Posay', 'LA ROCHE POSAY']) assert.equal(run({ title: t + ' Cicaplast Baume B5+ 40 ml' }, 'lrp-cicaplast-baume-b5-plus').signals.brand, 'MATCH', t);
  // alias de nom : seulement ceux de l'identité (libellés de sources du catalogue)
  assert.equal(run({ title: 'La Roche-Posay Mela B3 Intense Anti-Dark Spot Serum 30 ml' }, 'lrp-mela-b3-serum').signals.name, 'MATCH');
  assert.notEqual(run({ title: 'La Roche-Posay Mela B3 Super Dark Spot Serum 30 ml' }, 'lrp-mela-b3-serum').signals.name, 'MATCH');
  // langue : FR/EN seulement via le lexique ; un terme non déclaré n'est pas deviné
  const kojic = clone(IDENT.products[HA]); kojic.name.canonical = 'Kojic Acid 2%'; kojic.attributes = { actives: [], concentrations: [] }; kojic.variant = null; kojic.siblings = []; kojic.volume = null;
  assert.equal(M.matchCandidate({ title: 'The Ordinary Kojic Acid 2%' }, kojic).signals.name, 'MATCH');
  assert.notEqual(M.matchCandidate({ title: 'The Ordinary Acide Kojique 2%' }, kojic).signals.name, 'MATCH', 'synonyme non déclaré : jamais assimilé');
  assert.equal(M.matchCandidate({ title: 'The Ordinary Acide Hyaluronique 2% + B5' }, IDENT.products[HA]).signals.name, 'MATCH', 'synonyme déclaré au lexique');
});

test('MT-12 explicabilité : chaque résultat dit pourquoi ; raisons déterministes issues d\'une table fermée', () => {
  for (const k of F.CASES) {
    const r = run(k.candidate, k.productId, k.patch), again = run(k.candidate, k.productId, k.patch);
    assert.deepEqual(r, again, k.id + ' : déterministe');
    assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, k.id + ' : au moins une raison');
    assert.equal(r.reasons.length, r.reasonCodes.length);
    for (const c of r.reasonCodes) assert.ok(M.REASONS[c], k.id + ' : code de raison connu ' + c);
    for (const w of r.warningCodes) assert.ok(M.WARNINGS[w], k.id + ' : code d\'avertissement connu ' + w);
    if (r.matchClass === 'NO_MATCH') assert.ok(r.contradictions.length > 0, k.id + ' : la contradiction qui rejette la fiche est donnée');
    assert.deepEqual(Object.keys(r.signals), M.SIGNAL_ORDER); for (const v of Object.values(r.signals)) assert.ok(['MATCH', 'MISMATCH', 'UNKNOWN'].includes(v));
    assert.equal(r.productId, k.productId);
  }
  const r = run({ title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml' }, HA);
  assert.deepEqual(r.reasons.slice(0, 5), ['marque concordante', 'nom concordant', 'actifs concordants', 'concentration concordante', 'volume concordant']);
  assert.ok(r.reasons.includes('formulation absente de la fiche')); assert.ok(r.warnings.includes(M.WARNINGS.sibling_formulation_exists));
  assert.equal(r.evidence.volume, '30ml'); assert.deepEqual(r.evidence.concentrations, [{ ingredient: 'hyaluronic acid', percentage: 2 }]);
});

test('MT-13 le score numérique est auxiliaire : jamais lu par la décision, aucun seuil', () => {
  const src = strip(fs.readFileSync(path.join(ROOT, 'tools/market/match.js'), 'utf8'));
  const decide = src.slice(src.indexOf('function decide('), src.indexOf('function matchCandidate('));
  assert.ok(decide.length > 500); assert.doesNotMatch(decide, /score/i, 'decide() ne lit aucun score');
  assert.doesNotMatch(src, /\b0\.\d+\s*[<>]|[<>]=?\s*0\.\d+|threshold|seuil/i, 'aucun seuil numérique de décision');
  for (const k of F.CASES) { const r = run(k.candidate, k.productId, k.patch); assert.ok(r.score >= 0 && r.score <= 1); }
  // deux fiches de même classe se trient par score auxiliaire, puis par identifiant : ordre stable
  const idx = M.buildIndex(IDENT, { products: PRODUCTS });
  const list = M.findMatches({ title: 'La Roche-Posay Serum' }, idx, { includeNoMatch: true });
  assert.ok(list.length > 1);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i], ra = M.CLASSES.indexOf(a.matchClass), rb = M.CLASSES.indexOf(b.matchClass);
    assert.ok(ra < rb || (ra === rb && (a.score > b.score || (a.score === b.score && a.productId < b.productId))), 'tri : classe, score auxiliaire, identifiant');
  }
  assert.deepEqual(M.findMatches({ title: 'La Roche-Posay Serum' }, idx, { includeNoMatch: true }), list);
});

test('MT-14 pur et en lecture seule : aucune mutation, aucun réseau, aucun fichier ; identités et catalogue gelés sans effet', () => {
  const deepFreeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v); return o; };
  const frozenIdent = deepFreeze(clone(IDENT)), frozenCat = deepFreeze(clone(PRODUCTS)), cand = deepFreeze({ brand: 'The Ordinary', title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml', description: 'avec céramides' });
  const idx = M.buildIndex(frozenIdent, { products: frozenCat });
  assert.doesNotThrow(() => M.findMatches(cand, idx, { includeNoMatch: true })); assert.doesNotThrow(() => M.matchCandidate(cand, frozenIdent.products[HA], { productId: HA }));
  const before = JSON.stringify([IDENT, PRODUCTS]);
  for (const k of F.CASES) run(k.candidate, k.productId, k.patch);
  M.findMatches({ title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml' }, M.buildIndex(IDENT, { products: PRODUCTS }));
  assert.equal(JSON.stringify([IDENT, PRODUCTS]), before, 'identités et catalogue inchangés');
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/identities.json'), 'utf8'))), JSON.stringify(IDENT), 'identities.json non modifié');
  const src = strip(fs.readFileSync(path.join(ROOT, 'tools/market/match.js'), 'utf8'));
  assert.doesNotMatch(src, /require\(['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|worker_threads|vm)['"]\)/); assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|writeFile/);
});

test('MT-15 entrées invalides : jamais d\'exception, jamais de classe de matching (ni NO_MATCH), erreur technique séparée', () => {
  for (const bad of [null, undefined, 0, 'x', [], {}, { title: '' }, { title: '   ' }, { title: 42 }, { title: null }, { brand: 'The Ordinary' }]) {
    const r = M.matchCandidate(bad, IDENT.products[HA], { productId: HA });
    assert.equal(r.valid, false, JSON.stringify(bad)); assert.equal(r.matchClass, null, 'aucune classe : ' + JSON.stringify(bad)); assert.deepEqual(r.error, { code: 'candidate_invalid', reason: M.REASONS.candidate_invalid });
    assert.deepEqual(r.contradictions, []); assert.deepEqual(r.reasonCodes, []); assert.ok(!('invalid' in r));
  }
  for (const bad of [null, undefined, {}, [], 'x', { brand: {}, name: {} }]) { const r = M.matchCandidate({ title: 'The Ordinary Hyaluronic Acid' }, bad, { productId: 'x' }); assert.equal(r.valid, false); assert.equal(r.matchClass, null); assert.equal(r.error.code, 'identity_invalid'); assert.deepEqual(r.contradictions, []); }
  const huge = 'The Ordinary Hyaluronic Acid 2% + B5 '.repeat(5000), t0 = Date.now();
  assert.doesNotThrow(() => M.matchCandidate({ title: huge, description: huge, brand: huge }, IDENT.products[HA])); assert.ok(Date.now() - t0 < 2000, 'entrée démesurée : coût borné');
  assert.deepEqual(M.findMatches(null, M.buildIndex(IDENT)), []); assert.deepEqual(M.findMatches({ title: 'x' }, null), []);
  assert.equal(M.matchCandidate({ title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml', gtin: 'abc', mpn: {}, sku: [] }, IDENT.products[HA]).matchClass, 'POSSIBLE_MATCH', 'identifiants invalides ignorés');
});

test('MT-16 index : préfiltre par marque / GTIN / MPN, tri stable, milliers de fiches en un temps raisonnable', () => {
  const idx = M.buildIndex(IDENT, { products: PRODUCTS });
  assert.ok(idx.size >= 14);
  const ceraVe = M.findMatches({ title: 'CeraVe Hydrating Hyaluronic Acid Serum 30 ml' }, idx, { includeNoMatch: true });
  assert.ok(ceraVe.length > 0 && ceraVe.every(r => idx.byProduct.get(r.productId).brand.canonical === 'CeraVe'), 'seules les identités de la marque détectée sont évaluées');
  assert.equal(ceraVe[0].productId, 'cerave-hydrating-ha-serum');
  const noBrand = M.findMatches({ title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, idx);
  assert.equal(noBrand[0].productId, HA); assert.equal(noBrand[0].matchClass, 'POSSIBLE_MATCH');
  const idxG = M.buildIndex((() => { const f = clone(IDENT); f.products[HA].identifiers.gtin = { value: F.G1, source: 'valeur de test' }; return f; })());
  assert.equal(M.findMatches({ title: 'Titre sans rapport', gtin: F.G1 }, idxG)[0].productId, HA, 'un GTIN connu retrouve le produit sans passer par le texte');
  const titles = PRODUCTS.map(p => [p.brand, p.name, p.format].join(' ')), t0 = Date.now();
  for (let i = 0; i < 3000; i++) M.findMatches({ title: titles[i % titles.length] + ' ' + (i % 7) }, idx);
  assert.ok(Date.now() - t0 < 8000, '3000 fiches évaluées en moins de 8 s (mesuré : environ 2 s)');
});

test('MT-17 auto-identification sur le vrai catalogue : chaque produit se retrouve, et aucun AUTRE produit n\'atteint STRONG ou EXACT', () => {
  const idx = M.buildIndex(IDENT, { products: PRODUCTS });
  for (const p of PRODUCTS) {
    const title = [p.brand, p.name, p.format].filter(Boolean).join(' '), all = M.findMatches({ title }, idx, { includeNoMatch: true });
    const own = all.find(r => r.productId === p.id);
    assert.ok(own && ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH'].includes(own.matchClass), p.id + ' : ' + (own && own.matchClass));
    assert.deepEqual(all.filter(r => r.productId !== p.id && ['EXACT_MATCH', 'STRONG_MATCH'].includes(r.matchClass)).map(r => r.productId), [], p.id + ' : aucun faux positif parmi les autres produits');
    assert.equal(all[0].productId, p.id, p.id + ' : classé premier');
  }
});

test('MT-18 le catalogue peut grandir sans casser le matcher (simulations A à F)', () => {
  const t = 'The Ordinary Hyaluronic Acid 2% + B5 30 ml with Ceramides';
  const baseline = JSON.stringify(M.findMatches({ title: t }, M.buildIndex(IDENT, { products: PRODUCTS })));
  // A. nouveau produit SANS identité : identité dérivée, aucun plantage, rien ne change pour les autres
  const newProduct = clone(PRODUCTS.find(p => p.id === 'to-azelaic-acid-10')); newProduct.id = 'sim-nouveau'; newProduct.name = 'Matrixyl 10% + HA'; newProduct.offers = [];
  const idxA = M.buildIndex(IDENT, { products: PRODUCTS.concat([newProduct]) });
  assert.equal(idxA.size, M.buildIndex(IDENT, { products: PRODUCTS }).size + 1); assert.equal(JSON.stringify(M.findMatches({ title: t }, idxA)), baseline);
  assert.ok(M.findMatches({ title: 'The Ordinary Matrixyl 10% + HA' }, idxA).some(r => r.productId === 'sim-nouveau'), 'le produit sans identité est trouvable via son identité dérivée');
  // B. nouveau produit AVEC identité dans le fichier
  const fileB = clone(IDENT); fileB.products['sim-nouveau'] = I.deriveIdentity(newProduct);
  assert.equal(JSON.stringify(M.findMatches({ title: t }, M.buildIndex(fileB, { products: PRODUCTS.concat([newProduct]) }))), baseline);
  // C. nouvelle offre / F. offre retirée : les offres ne sont jamais lues
  const withOffers = PRODUCTS.map(p => Object.assign(clone(p), { offers: p.offers.concat([{ market: 'TG', retailer: 'Sim', type: 'retailer', currency: 'XOF', price: 1, availability: 'in_stock', url: null, shipping: null, source: 'Simulation', checkedAt: '2026-10-09' }]) }));
  const noOffers = PRODUCTS.map(p => Object.assign(clone(p), { offers: [] }));
  for (const cat of [withOffers, noOffers]) assert.equal(JSON.stringify(M.findMatches({ title: t }, M.buildIndex(IDENT, { products: cat }))), baseline);
  // D. nouvelle variante déclarée : la même fiche devient une variante
  const fileD = clone(IDENT); fileD.products[HA].variant = { id: 'new_formula', raw: 'New Formula', exactness: 'explicit', source: 'simulation' };
  assert.equal(M.findMatches({ title: t }, M.buildIndex(fileD), { includeNoMatch: true }).find(r => r.productId === HA).matchClass, 'VARIANT_MATCH');
  // E. nouveau frère déclaré sur un produit qui n'en avait pas : le moteur devient plus prudent
  const fileE = clone(IDENT), nia = 'to-niacinamide-10-zinc-1', tt = 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml';
  assert.equal(M.findMatches({ title: tt }, M.buildIndex(fileE))[0].matchClass, 'EXACT_MATCH');
  fileE.products[nia].siblings = [{ relation: 'formulation', label: 'autre formule (simulation)', variant: 'original', volume: null, productId: null, status: 'known', source: 'description', evidence: 'x' }];
  assert.equal(M.findMatches({ title: tt }, M.buildIndex(fileE))[0].matchClass, 'POSSIBLE_MATCH');
});

test('MT-19 périmètre : pas de safe-fetch.js, discovery.js, review.js, apply.js (confidence.js et classify.js existent depuis la phase 3B-4) ; le matcher n\'est lu ni par le navigateur ni par le moteur ; disponibilité inchangée', () => {
  for (const f of ['safe-fetch.js', 'discovery.js', 'review.js', 'apply.js']) assert.ok(!fs.existsSync(path.join(ROOT, 'tools/market', f)), f + ' ne doit pas exister à ce stade');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'js')).concat(walk(path.join(ROOT, 'server')), walk(path.join(ROOT, 'api')))) if (/\.js$/.test(f)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tools\/market|market\/match|identities\.json/, path.relative(ROOT, f));
  assert.equal(fs.statSync(path.join(ROOT, 'js/app.js')).size, 149365);
  const P = require('../js/engine/products.js'), lynia = PRODUCTS.find(p => p.id === HA);
  if (lynia && (lynia.offers || []).some(o => o.market === 'BJ' && /lynia/i.test(o.retailer))) { assert.equal(P.availabilityStatus(lynia, 'BJ').status, 'LOCAL'); assert.equal(P.availabilityStatus(lynia, 'TG').status, 'UNKNOWN'); }   // relevé enregistré : présent-si
  const src = fs.readFileSync(path.join(ROOT, 'tools/market/match.js'), 'utf8');
  assert.doesNotMatch(strip(src), /availabilityStatus|marketView|offers|LOCAL|REGIONAL|IMPORT|UNAVAILABLE/, 'le matcher ignore la classification marché');
  assert.ok(N.LEXICON_VERSION >= 1);
});

test('MT-20 propriétés sur 6000 fiches aléatoires (graine fixe) : aucun faux positif structurel, quelle que soit la combinaison', () => {
  let seed = 20261009; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, pick = a => a[Math.floor(rnd() * a.length)];
  const BRANDS = ['', 'THE ORDINARY', 'CeraVe', 'La Roche-Posay', 'LRP', 'Vichy', 'Garnier'], NOISE = ['', '', 'Serum', 'Kit', 'Refill', 'Eye Cream', 'vendu au bénin', 'Original Formulation', 'with Ceramides', 'avec céramides', 'Supersize', '2 x', 'Duo', 'sans céramides', 'Hydrating Mask', 'Old Formula', 'SPF 50'];
  const VOLS = ['', '30 ml', '60 ml', '0.03 L', '3 cl', '1 fl oz', '30 g', '15 ml', '100 ml', '1 oz'];
  const mutate = name => {
    const w = name.split(' ');
    switch (Math.floor(rnd() * 6)) {
      case 0: return name;
      case 1: return w.filter(() => rnd() > 0.3).join(' ') || name;
      case 2: return name.replace(/(\d+(?:\.\d+)?)%/g, (m, n) => (rnd() < 0.5 ? Number(n) * 10 : Number(n) / 2) + '%');
      case 3: return w.slice().reverse().join(' ');
      case 4: return name.replace(/Acid/g, 'Acide').replace(/Serum/g, 'Sérum');
      default: return name + ' ' + pick(['Pro', 'Plus', 'Intense', 'X']);
    }
  };
  const ids = Object.keys(IDENT.products), seen = { EXACT_MATCH: 0, STRONG_MATCH: 0, POSSIBLE_MATCH: 0, VARIANT_MATCH: 0, NO_MATCH: 0 };
  for (let n = 0; n < 6000; n++) {
    const id = ids[n % ids.length], identity = IDENT.products[id], brand = pick(BRANDS);
    const title = [brand, mutate(identity.name.canonical), pick(VOLS), pick(NOISE), pick(NOISE)].join(' ').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const r = M.matchCandidate({ title }, identity, { productId: id }); seen[r.matchClass]++;
    const S = r.signals, mism = Object.entries(S).filter(([, v]) => v === 'MISMATCH').map(([k]) => k), at = id + ' | ' + title + ' | ' + r.matchClass;
    assert.ok(M.CLASSES.includes(r.matchClass), at);
    assert.deepEqual(M.matchCandidate({ title }, identity, { productId: id }), r, 'déterministe : ' + at);
    if (r.matchClass === 'EXACT_MATCH' || r.matchClass === 'STRONG_MATCH') { assert.deepEqual(mism, [], 'aucune contradiction : ' + at); assert.equal(S.brand, 'MATCH', 'marque établie : ' + at); assert.equal(S.name, 'MATCH', 'nom concordant : ' + at); }
    if (r.matchClass === 'EXACT_MATCH') { assert.ok(!r.warningCodes.includes('title_has_extra_neutral_words') && !r.warningCodes.includes('name_via_alias'), at); assert.equal(S.volume, 'MATCH', at); }
    if (r.matchClass === 'VARIANT_MATCH') { assert.equal(S.brand, 'MATCH', at); assert.equal(S.name, 'MATCH', at); assert.ok(mism.every(k => k === 'variant' || k === 'volume'), 'seules la variante et le format diffèrent : ' + at); assert.ok(mism.length > 0, at); }
    if (r.matchClass === 'NO_MATCH') assert.ok(r.contradictions.length > 0, at);
    const hard = mism.filter(k => k !== 'variant' && k !== 'volume');
    if (hard.length) assert.equal(r.matchClass, 'NO_MATCH', 'une contradiction forte donne NO_MATCH : ' + at);
    else if (mism.length) assert.ok(['VARIANT_MATCH', 'POSSIBLE_MATCH', 'NO_MATCH'].includes(r.matchClass), 'format ou variante différents : jamais EXACT ni STRONG : ' + at);
    if (S.brand === 'MISMATCH') assert.equal(r.matchClass, 'NO_MATCH', at);
    if (S.concentration === 'MISMATCH') assert.equal(r.matchClass, 'NO_MATCH', at);
    if (S.variant === 'UNKNOWN' && (identity.variant || (identity.siblings || []).some(s => ['formulation', 'sun_protection'].includes(s.relation)))) assert.ok(!['EXACT_MATCH', 'STRONG_MATCH'].includes(r.matchClass), 'formulation non établie avec produit frère : ' + at);
  }
  for (const c of M.CLASSES) assert.ok(seen[c] > 0, 'le jeu aléatoire produit aussi des ' + c + ' (' + JSON.stringify(seen) + ')');
});

test('MT-21 sémantique : NO_MATCH = contradiction explicite ; information insuffisante = POSSIBLE_MATCH', () => {
  const HARD = ['gtin', 'mpn', 'brand', 'actives', 'concentration', 'name'];
  for (const k of F.CASES) {
    const r = run(k.candidate, k.productId, k.patch);
    assert.ok(!r.reasonCodes.includes('insufficient_evidence') && !r.contradictions.includes(M.REASONS.insufficient_evidence), k.id + ' : « insuffisant » n\'est jamais une contradiction');
    if (r.matchClass === 'NO_MATCH') assert.ok(r.valid === true && r.contradictions.length > 0 && (HARD.some(s => r.signals[s] === 'MISMATCH') || r.reasonCodes.some(c => ['volume_kind_mismatch', 'variant_negated'].includes(c))), k.id + ' : une contradiction nommée explique le rejet');
  }
  // aucune marque, aucun nom reconnu, aucune contradiction : on ne sait pas
  for (const title of ['Garnier Hyaluronic Acid 2% + B5 30 ml', 'Hyaluronic Acid 2% + B5 30 ml sérum visage', 'Acide hyaluronique 2% + B5 30ml']) {
    const r = run({ title }, HA);
    assert.notEqual(r.matchClass, 'NO_MATCH', title);
    assert.ok(!['EXACT_MATCH', 'STRONG_MATCH'].includes(r.matchClass), title + ' : sans marque établie, jamais STRONG ni EXACT');
  }
  const g = run({ title: 'Garnier Hyaluronic Acid 2% + B5 30 ml' }, HA);
  assert.equal(g.matchClass, 'POSSIBLE_MATCH'); assert.ok(g.warningCodes.includes('insufficient_evidence')); assert.deepEqual(g.contradictions, []);
  // titre qui ne dit rien du nom (mots neutres seulement) : information insuffisante ; titre qui désigne autre chose (mots propres, aucun mot du produit) : contradiction
  assert.equal(run({ title: 'The Ordinary Serum 30 ml' }, HA).matchClass, 'POSSIBLE_MATCH'); assert.equal(run({ title: 'The Ordinary 30 ml' }, HA).matchClass, 'POSSIBLE_MATCH');
  const other = run({ title: 'The Ordinary Foo Bar 30 ml' }, HA); assert.equal(other.matchClass, 'NO_MATCH'); assert.equal(other.signals.name, 'MISMATCH'); assert.ok(other.contradictions.length > 0);
  // une entrée inexploitable n'est PAS un NO_MATCH : validation préalable, aucune classe
  for (const k of F.INVALID_INPUTS) { const r = M.matchCandidate(k.candidate, IDENT.products[HA], { productId: HA }); assert.equal(r.valid, false, k.id); assert.equal(r.matchClass, null, k.id); assert.equal(r.error.code, k.error, k.id); assert.deepEqual(M.validateCandidate(k.candidate), { valid: false, errors: [k.error] }, k.id); }
  const real = run({ title: 'CeraVe Hyaluronic Acid 2% + B5 30 ml' }, HA); assert.equal(real.valid, true); assert.equal(real.matchClass, 'NO_MATCH'); assert.ok(real.contradictions.length > 0 && !('error' in real), 'une vraie contradiction reste un NO_MATCH avec ses contradictions');
});
