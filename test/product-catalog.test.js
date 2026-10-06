'use strict';
/* Catalogue produits : modèle, validation, relation produit ↔ actif, compatibilité, routine, données commerciales, séparation réel / démonstration.
   Le catalogue de test ci-dessous est un JEU DE TEST (jamais livré) : produits `demo: false` fictifs, uniquement pour éprouver le moteur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { M, Engine, norm, withStatus, randomCase } = require('./helpers/engine.js');
const products = require('../js/engine/products.js');
const demoData = require('../js/engine/data/products.js');
const realData = require('../js/engine/data/catalog.js');
const actives = require('../js/engine/actives.js');
const copy = require('../js/engine/copy.fr.js');

const ing = (activeId, label) => ({ activeId, label: label || activeId });
const P = (id, category, ingredients, extra) => Object.assign({ id, name: 'Produit de test ' + id, brand: 'Marque de test', category, ingredients, skinTypes: ['all'], targets: ['acne'], active: true, demo: false }, extra || {});
const FULL = { description: 'Fiche de test.', availability: 'available', vendor: 'Boutique de test', url: 'https://boutique.example/produit', price: { amount: 9500, currency: 'XOF' }, priceSource: 'Relevé de test', priceCheckedAt: '2026-10-01', image: { src: 'img/products/test.jpg', alt: 'Produit de test' } };
const FIX = [
  P('cl-a', 'cleanser', [ing('glycerin')]),
  P('cl-strong', 'cleanser', [ing('glycerin'), ing('salicylic')]),
  P('s-aze', 'serum', [ing('azelaic')], FULL),
  P('s-nia', 'serum', [ing('niacinamide')], { availability: 'coming_soon' }),
  P('s-nia-aze', 'serum', [ing('niacinamide'), ing('azelaic')]),
  P('s-sal', 'serum', [ing('salicylic')]),
  P('s-vitc', 'serum', [ing('vitamin_c')]),
  P('s-ret', 'serum', [ing('retinoid', 'Rétinoïde cosmétique')], { primaryActiveId: 'retinoid' }),
  P('s-off', 'serum', [ing('azelaic')], { active: false }),
  P('m-a', 'moisturizer', [ing('hyaluronic'), ing('ceramides')]),
  P('m-b', 'moisturizer', [ing('glycerin')]),
  P('m-hidden', 'moisturizer', [ing('hyaluronic'), ing('azelaic')]),
  P('spf-a', 'spf', [ing(null, 'Filtres UV large spectre')])
];
const profile = (extra) => Object.assign({ goals: [], level: 'full', cats: [] }, extra || {});
const run = (ui, prof, o) => Engine.run(norm(ui, o), profile(prof), { catalog: FIX });
const steps = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
const WEAK = { acne: 30, pigmentation: 40, hydration: 45, pores: 50 };

test('PC1 le catalogue réel est vide et valide ; le catalogue de démonstration est valide et entièrement marqué demo', () => {
  assert.deepEqual(realData.PRODUCTS, []);
  assert.deepEqual(products.validateCatalog(realData.PRODUCTS), []);
  assert.deepEqual(products.validateCatalog(demoData.PRODUCTS), []);
  assert.ok(demoData.PRODUCTS.length > 0 && demoData.PRODUCTS.every(p => p.demo === true));
  assert.ok(realData.PRODUCTS.every(p => p.demo === false), 'aucun produit de démonstration dans le catalogue réel');
  assert.deepEqual(products.validateCatalog(FIX), []);
});

test('PC2 le modèle exige un produit complet et refuse les données douteuses', () => {
  const bad = (p, re) => { const e = products.validateProduct(p); assert.ok(e.some(m => re.test(m)), JSON.stringify(e) + ' ≠ ' + re); };
  bad(P('x1', 'serum', [ing('azelaic')], { name: '' }), /nom/);
  bad(P('x2', 'serum', [ing('azelaic')], { brand: '' }), /marque/);
  bad(P('x3', 'masque', [ing('azelaic')]), /catégorie/);
  bad(P('x4', 'serum', [ing('actif_inconnu')]), /actif inconnu/);
  bad(P('x5', 'serum', [ing(null, 'Zinc')]), /relié à un actif/);                     // B : un soin ciblé sans actif relié
  bad(P('x6', 'serum', [ing('azelaic')], { match: 87 }), /champ interdit/);
  bad(P('x7', 'serum', [ing('azelaic')], { score: 3 }), /champ interdit/);
  bad(P('x8', 'serum', [ing('azelaic')], { name: '94 % de correspondance' }), /pourcentage/);
  bad(P('x9', 'serum', [ing('azelaic')], { price: { amount: 5000, currency: 'XOF' } }), /source et sa date/);
  bad(P('y1', 'serum', [ing('azelaic')], { price: { amount: -1, currency: 'XOF' }, priceSource: 's', priceCheckedAt: '2026-10-01' }), /prix invalide/);
  bad(P('y2', 'serum', [ing('azelaic')], { price: { amount: 100, currency: 'JPY' }, priceSource: 's', priceCheckedAt: '2026-10-01' }), /prix invalide/);
  bad(P('y3', 'serum', [ing('azelaic')], { url: 'http://boutique.example' }), /https/);
  bad(P('y4', 'serum', [ing('azelaic')], { url: 'javascript:alert(1)' }), /https/);
  bad(P('y5', 'serum', [ing('azelaic')], { availability: 'en stock' }), /disponibilité/);
  bad(P('y6', 'serum', [ing('azelaic')], { image: { src: 'http://x/y.jpg', alt: 'a' } }), /image/);
  bad(P('y7', 'serum', [ing('azelaic')], { image: { src: 'img/products/a.jpg', alt: '' } }), /image/);
  bad(P('y8', 'serum', [ing('azelaic')], { demo: undefined }), /demo/);
  bad(P('y9', 'serum', [ing('azelaic')], { primaryActiveId: 'niacinamide' }), /actif principal/);
  bad(P('Z Z', 'serum', [ing('azelaic')]), /id invalide/);
  assert.ok(products.validateCatalog([P('dup', 'spf', [ing(null, 'UV')]), P('dup', 'spf', [ing(null, 'UV')])]).some(m => /double/.test(m)));
  assert.deepEqual(products.validateProduct(P('ok', 'serum', [ing('azelaic')], FULL)), [], 'une fiche réelle complète et sourcée est valide');
  assert.deepEqual(products.validateProduct(P('ok2', 'spf', [ing(null, 'UV')])), [], 'un produit sans aucune donnée commerciale est valide (champs nuls)');
});

test('PC3 A : un soin est relié à l\'actif retenu pour l\'étape ; H/I : catégorie et créneau corrects', () => {
  const r = run(WEAK);
  const t = steps(r).filter(s => s.kind === 'treatment');
  assert.ok(t.length > 0 && r.productMatches.length > 0);
  for (const m of r.productMatches) {
    const step = steps(r).find(s => s.id === m.stepId), p = products.byId(m.productId, FIX);
    assert.equal(p.category, products.stepCategory(step), `${m.stepId} → ${p.id}`);                    // H : un sérum n'est jamais un nettoyant, etc.
    assert.equal(m.stepId.split(':')[0], step.slot);                                                       // I : même créneau que l'étape de la routine
    if (step.kind === 'treatment') assert.ok(products.ids(p).includes(step.activeId));                     // A : l'actif de l'étape est dans le produit
    if (step.kind === 'spf') assert.equal(step.slot, 'morning');
  }
  assert.ok(!steps(r).some(s => s.kind === 'cleanse' && r.productMatches.find(m => m.stepId === s.id && products.byId(m.productId, FIX).category !== 'cleanser')));
});

test('PC4 C : un produit dont l\'actif n\'est pas retenu n\'est pas recommandé et dit pourquoi ; le rétinoïde n\'est jamais recommandé', () => {
  const r = run({ acne: 30 });
  const view = products.catalogView(r.routinePlan, r.productMatches, FIX);
  const treat = steps(r).filter(s => s.kind === 'treatment').map(s => s.activeId);
  for (const p of FIX.filter(x => x.category === 'serum' && x.active !== false)) {
    if (!products.ids(p).some(id => treat.includes(id))) {
      assert.ok(!view.recommended.some(x => x.productId === p.id), p.id);
      assert.equal(view.others.find(o => o.productId === p.id).reason, 'active_not_selected', p.id);
    }
  }
  assert.ok(!view.recommended.some(x => x.productId === 's-ret'), 'rétinoïde : jamais recommandé automatiquement');
  assert.equal(view.others.find(o => o.productId === 's-ret').text, copy.PRODUCT_REASONS.active_not_selected);
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), rr = Engine.run(norm(c.ui, c.o), { ...c.profile }, { catalog: FIX });
    assert.ok(!rr.productMatches.some(m => m.productId === 's-ret'), 'seed ' + seed);
  }
  // même si un jour le rétinoïde était validé : un produit qui en contient n'est proposé que si la ROUTINE a retenu le rétinoïde (jamais l'inverse)
  withStatus('retinoid', 'validated', () => { const rr = run({ wrinkles: 20, firmness: 25 }, { goals: ['aging'] }); for (const m of rr.productMatches.filter(x => x.productId === 's-ret')) assert.ok(steps(rr).some(s => s.id === m.stepId && s.activeId === 'retinoid')); });
});

test('PC5 D : un produit contenant un actif exclu n\'est jamais proposé, raison « exclu »', () => {
  const free = run(WEAK), excl = run(WEAK, { exclusions: ['azelaic'] });
  assert.ok(free.productMatches.some(m => products.ids(products.byId(m.productId, FIX)).includes('azelaic')), 'sans exclusion, un produit à l\'acide azélaïque est bien proposé');
  for (const m of excl.productMatches) assert.ok(!products.ids(products.byId(m.productId, FIX)).includes('azelaic'), m.productId);
  const view = products.catalogView(excl.routinePlan, excl.productMatches, FIX);
  for (const id of ['s-aze', 'm-hidden']) { const o = view.others.find(x => x.productId === id); assert.ok(o, id); assert.ok(['excluded', 'active_not_selected'].includes(o.reason), id + ' ' + o.reason); }
  const sNiaAze = view.others.find(x => x.productId === 's-nia-aze'); assert.ok(sNiaAze && sNiaAze.reason === 'excluded', 'contient l\'actif exclu : ' + (sNiaAze && sNiaAze.reason));
});

test('PC6 E : approche douce — jamais de produit qui ajoute un actif plus exigeant que celui de l\'étape ; la raison affichée est vraie', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), rr = Engine.run(norm(c.ui, c.o), { ...c.profile, comfort: { preferGentle: true } }, { catalog: FIX });
    for (const m of rr.productMatches) {
      const step = steps(rr).find(s => s.id === m.stepId), p = products.byId(m.productId, FIX);
      for (const id of products.ids(p)) if (id !== step.activeId) assert.equal(actives.byId(id).irritation, 'low', `seed ${seed} ${p.id} ${id}`);
    }
    const view = products.catalogView(rr.routinePlan, rr.productMatches, FIX);
    for (const o of view.others.filter(x => x.reason === 'comfort')) {
      assert.equal(rr.routinePlan.comfortMode, true);
      const p = products.byId(o.productId, FIX);
      assert.ok(products.ids(p).some(id => actives.byId(id).irritation !== 'low'), `seed ${seed} ${p.id}`);
    }
  }
  const gentle = run({ acne: 30, pores: 40 }, { comfort: { preferGentle: true } });
  const view = products.catalogView(gentle.routinePlan, gentle.productMatches, FIX);
  assert.ok(view.others.some(o => o.reason === 'comfort') || gentle.routinePlan.comfortMode, 'cas de référence : la raison « approche douce » existe quand le moteur l\'applique');
});

test('PC7 F/G : prix et disponibilité absents → « Prix à venir » / « Données à venir », sans bouton d\'achat ; ils n\'influencent jamais la sélection', () => {
  const bare = products.commerceOf(FIX.find(p => p.id === 's-nia-aze'));
  assert.deepEqual(bare, { availability: null, availabilityLabel: 'Données à venir', price: null, vendor: null, url: null, buyable: false });
  const full = products.commerceOf(FIX.find(p => p.id === 's-aze'));
  assert.equal(full.buyable, true); assert.equal(full.availabilityLabel, 'Disponible'); assert.deepEqual(full.price, { amount: 9500, currency: 'XOF', source: 'Relevé de test', checkedAt: '2026-10-01' });
  assert.equal(products.commerceOf(FIX.find(p => p.id === 's-nia')).availabilityLabel, 'Bientôt disponible');
  assert.equal(products.commerceOf({ ...FIX[2], availability: 'unavailable' }).buyable, false);
  assert.equal(products.commerceOf({ ...FIX[2], url: null }).buyable, false, 'pas de lien : pas d\'achat');
  assert.equal(products.commerceOf({ ...FIX[2], priceSource: null }).price, null, 'prix sans source : jamais affiché');
  assert.equal(products.commerceOf({ ...FIX[2], demo: true }).price, null, 'prix de démonstration : jamais affiché');
  assert.equal(products.commerceOf({ ...FIX[2], demo: true }).buyable, false);
  const stripped = FIX.map(p => ({ ...p, price: null, priceSource: null, priceCheckedAt: null, availability: null, vendor: null, url: null, image: null }));
  const maxed = FIX.map(p => ({ ...p, ...FULL, availability: 'unavailable' }));
  for (let seed = 1; seed <= 100; seed++) {
    const c = randomCase(seed), a = Engine.run(norm(c.ui, c.o), c.profile, { catalog: stripped }), b = Engine.run(norm(c.ui, c.o), c.profile, { catalog: FIX }), d = Engine.run(norm(c.ui, c.o), c.profile, { catalog: maxed });
    assert.deepEqual(a.productMatches, b.productMatches, 'seed ' + seed); assert.deepEqual(a.productMatches, d.productMatches, 'seed ' + seed);
  }
});

test('PC8 principe : le catalogue ne modifie ni mesure, ni interprétation, ni priorité, ni actif, ni routine, ni personnalisation', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), n = norm(c.ui, c.o);
    const base = Engine.run(n, c.profile, { catalog: realData.PRODUCTS });
    for (const cat of [FIX, demoData.PRODUCTS, undefined]) {
      const x = Engine.run(n, c.profile, cat ? { catalog: cat } : undefined);
      for (const part of ['interpretation', 'priorities', 'personalization', 'activePlan', 'routinePlan', 'explanations', 'profile']) assert.deepEqual(x[part], base[part], `seed ${seed} ${part}`);
    }
    assert.deepEqual(base.productMatches, [], 'catalogue réel vide : aucun produit');
  }
});

test('PC9 J : aucun pourcentage de correspondance, aucun champ de score, nulle part dans la couche produits', () => {
  const r = run(WEAK); const view = products.catalogView(r.routinePlan, r.productMatches, FIX);
  const all = JSON.stringify([r.productMatches, view, FIX.map(p => products.commerceOf(p))]);
  assert.doesNotMatch(all, /\d\s?%|correspondance|compatib|"match"|"score"/i);
  assert.ok(FIX.concat(demoData.PRODUCTS).every(p => !Object.keys(p).some(k => /^(match|score|compat|percent)/i.test(k))));
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../js/engine/copy.fr.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../js/engine/products.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(app, /\d\s?%\s?(de )?(correspondance|compatib)|Correspondance avec votre profil|compatibilit[ée]\s*:\s*\d/i);
});

test('PC10 invariants sur 300 profils variés : objectifs, niveaux, approche douce, exclusions, données indisponibles', () => {
  const REASONS = Object.keys(copy.PRODUCT_REASONS);
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed);
    const prof = { ...c.profile, comfort: { preferGentle: seed % 3 === 0 }, exclusions: seed % 5 === 0 ? ['azelaic', 'vitamin_c'] : seed % 7 === 0 ? ['niacinamide'] : [] };
    const r = Engine.run(norm(c.ui, c.o), prof, { catalog: FIX }), view = products.catalogView(r.routinePlan, r.productMatches, FIX);
    const excl = new Set(r.routinePlan.exclusions);
    const seen = new Set();
    for (const rec of view.recommended) {
      const p = products.byId(rec.productId, FIX); seen.add(p.id);
      assert.ok(p.active !== false, 'jamais un produit désactivé'); assert.ok(!products.ids(p).some(id => excl.has(id)), `seed ${seed} exclusion ${p.id}`);
      assert.ok(!products.ids(p).includes('retinoid'), 'seed ' + seed); assert.ok(rec.steps.length > 0 && rec.steps.every(s => s.why && !/traite|guérit|élimine|médic/i.test(s.why)));
    }
    for (const o of view.others) {
      assert.ok(!seen.has(o.productId), 'un produit n\'est pas à la fois recommandé et non retenu'); seen.add(o.productId);
      assert.ok(REASONS.includes(o.reason) && o.text === copy.PRODUCT_REASONS[o.reason]);
      const p = products.byId(o.productId, FIX);
      if (o.reason === 'excluded') assert.ok(products.ids(p).some(id => excl.has(id)), `seed ${seed} ${p.id}`);
      if (o.reason === 'active_not_selected') assert.ok(!steps(r).some(s => s.kind === 'treatment' && products.ids(p).includes(s.activeId)), `seed ${seed} ${p.id}`);
      if (o.reason === 'owned') { const rel = steps(r).filter(s => products.stepCategory(s) === p.category && (s.kind !== 'treatment' || products.ids(p).includes(s.activeId))); assert.ok(rel.length > 0 && rel.every(s => s.owned), `seed ${seed} ${p.id}`); }
    }
    assert.equal(seen.size, FIX.filter(p => p.active !== false).length, 'tout produit actif est classé une fois');
    assert.ok(!seen.has('s-off'), 'le produit désactivé n\'est jamais listé');
    assert.ok(!r.productMatches.some(m => steps(r).find(s => s.id === m.stepId).owned), 'aucun produit pour une étape déjà couverte par l\'utilisatrice');
  }
});

test('PC11 « pourquoi ce produit » : rôle et actif de l\'étape, sans promesse ni langage médical', () => {
  const r = run(WEAK), view = products.catalogView(r.routinePlan, r.productMatches, FIX);
  for (const rec of view.recommended) for (const s of rec.steps) {
    assert.ok(s.why.length > 20);
    if (s.kind === 'treatment') assert.ok(s.activeIds.length === 1 && s.why.toLowerCase().includes(actives.byId(s.activeIds[0]).label.toLowerCase()), s.why);
    assert.doesNotMatch(s.why, /va traiter|guérit|élimine|corrige|efface|100 ?%|garanti/i);
  }
  assert.equal(copy.productWhy('cleanse', []), 'Nettoyant doux pour l\'étape de nettoyage de votre routine.');
  assert.match(copy.productWhy('spf', []), /Protection solaire/);
});

test('PC12 K/L : mode réel = catalogue réel seulement ; démonstration séparée ; aucune donnée commerciale de démonstration montrée', () => {
  const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
  assert.match(app, /const catalogNow=\(\)=>DEMO_MODE\?Engine\.products\.PRODUCTS:Engine\.catalogData\.PRODUCTS/);
  assert.match(app, /Object\.assign\(\{catalog:catalogNow\(\)\}/);
  assert.doesNotMatch(app.replace(/\/\*[\s\S]*?\*\//g, ''), /Engine\.products\.PRODUCTS(?!:Engine)/.source ? /Engine\.products\.PRODUCTS\.(filter|map|find)/ : /x/, 'aucune lecture directe du catalogue de démonstration');
  assert.match(app, /p\.demo\?bottle\(p\.type,p\.color\)/);                                    // illustration réservée à la démonstration
  assert.match(app, /Image à venir/);
  assert.match(app, /c\.buyable\?`<a class="c-btn c-btn--primary c-btn--block" href=/);          // pas de bouton d'achat sans vrai lien
  assert.doesNotMatch(app, /Les liens d'achat ne sont pas encore disponibles/);
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(html.indexOf('data/catalog.js') > html.indexOf('data/products.js') && html.indexOf('data/catalog.js') < html.indexOf('copy.fr.js'));
  assert.deepEqual(Engine.run(norm({ acne: 30 }), { goals: [], level: 'full', cats: [] }, { catalog: realData.PRODUCTS }).productMatches, []);
  assert.ok(Engine.run(norm({ acne: 30 }), { goals: [], level: 'full', cats: [] }, { catalog: demoData.PRODUCTS }).productMatches.every(m => m.demo === true));
});

test('PC13 aucune donnée sensible ni dépendance : le catalogue ne contient aucun secret, aucune clé, aucun identifiant utilisateur', () => {
  for (const f of ['js/engine/products.js', 'js/engine/data/catalog.js', 'js/engine/data/products.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /service_role|apikey|api_key|secret|token|fetch\(|XMLHttpRequest|localStorage|require\('(?!\.)/i, f);
  }
});
