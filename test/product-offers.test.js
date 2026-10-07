'use strict';
/* Étape 14B : premier catalogue réel (Afrique) et modèle d'offres par pays. Un produit → plusieurs offres → plusieurs pays → prix et disponibilité LOCAUX.
   Les offres de test ci-dessous sont des JEUX DE TEST (jamais livrés) : la livraison ne contient aucune offre, faute d'accès vérifiable aux fiches des vendeurs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Engine, norm, randomCase } = require('./helpers/engine.js');
const products = require('../js/engine/products.js');
const demoData = require('../js/engine/data/products.js');
const realData = require('../js/engine/data/catalog.js');
const actives = require('../js/engine/actives.js');
const copy = require('../js/engine/copy.fr.js');

const REAL = realData.PRODUCTS;
const byId = id => REAL.find(p => p.id === id);
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const OFFER = (extra) => Object.assign({ market: 'BJ', retailer: 'Boutique de test', type: 'retailer', currency: 'XOF', price: 9500, availability: 'in_stock', url: 'https://vendeur-de-test.shop/produit',
  shipping: 'local', source: 'Relevé de test', checkedAt: '2026-10-01' }, extra || {});
const withOffers = (id, offers) => ({ ...byId(id), offers });
/* Offres de test ci-dessous : jeux de test. */
const BRIEF = {
  acne: ['to-salicylic-2-solution', 'lrp-effaclar-duo-m'], pores: ['to-niacinamide-10-zinc-1', 'cerave-blemish-control-gel'], oiliness: ['to-niacinamide-10-zinc-1', 'lrp-effaclar-duo-m'],
  hydration: ['to-hyaluronic-b5-ceramides', 'cerave-hydrating-ha-serum'], redness: ['to-azelaic-acid-10', 'lrp-cicaplast-baume-b5-plus'], texture: ['to-mandelic-acid-10-ha', 'lrp-pure-vitamin-c10-serum'],
  pigmentation: ['lrp-mela-b3-serum', 'to-ascorbyl-glucoside-12'], aging: ['lrp-pure-vitamin-c10-serum', 'vichy-liftactiv-vitamin-c-serum']
};
const STATIC_ACTIVES = ['niacinamide', 'salicylic', 'azelaic', 'vitamin_c', 'retinoid', 'aha_pha', 'hyaluronic', 'glycerin', 'ceramides', 'panthenol', 'squalane', 'peptides', 'zinc', 'centella', 'caffeine', 'tranexamic'];   // les 16 actifs existants avant l'étape 14B

test('OF1 A/B : les 8 préoccupations ont leurs 2 candidats dans le catalogue ; un produit partagé est permis ; rien n\'est forcé', () => {
  assert.deepEqual(products.validateCatalog(REAL), []);
  for (const [concern, list] of Object.entries(BRIEF)) {
    assert.equal(list.length, 2, concern);
    for (const id of list) assert.ok(byId(id), concern + ' : ' + id + ' absent');
  }
  const distinct = new Set(Object.values(BRIEF).flat());
  assert.equal(distinct.size, 13, '13 produits distincts, certains partagés entre préoccupations');
  assert.equal(REAL.length, 13);
  assert.ok(Object.values(BRIEF).flat().filter(id => id === 'to-niacinamide-10-zinc-1').length === 2, 'un produit partagé');
});

test('OF2 C : chaque actif référencé existe ; aucun actif nouveau ; mandélique → aha_pha ; dérivé de vitamine C → vitamin_c', () => {
  assert.deepEqual(require('../js/engine/data/actives.js').ACTIVES.map(a => a.id).sort(), [...STATIC_ACTIVES].sort(), 'aucun actif créé');
  for (const p of REAL) for (const i of p.ingredients) assert.ok(i.activeId == null || actives.byId(i.activeId), p.id + ' : ' + i.activeId);
  assert.ok(!actives.byId('mandelic') && !actives.byId('vitc'));
  assert.deepEqual(byId('to-mandelic-acid-10-ha').ingredients.filter(i => i.activeId === 'aha_pha').length, 1);
  assert.equal(byId('to-mandelic-acid-10-ha').primaryActiveId, 'aha_pha');
  // « zinc » existe mais est un soin « à valider » : relier le zinc PCA ferait écarter le produit (composition) sans raison utile ; le zinc reste un ingrédient secondaire non relié
  assert.ok(!REAL.some(p => p.ingredients.some(i => i.activeId === 'zinc')));
  assert.ok(!byId('lrp-cicaplast-baume-b5-plus').inci.some(x => /centella/i.test(x)) && !byId('lrp-cicaplast-baume-b5-plus').ingredients.some(i => i.activeId === 'centella'), 'l\'INCI Afrique du Cicaplast ne liste pas d\'extrait de centella : non relié (le madécassoside n\'est pas l\'extrait)');
  assert.equal(byId('to-ascorbyl-glucoside-12').primaryActiveId, 'vitamin_c');
  assert.equal(byId('to-niacinamide-10-zinc-1').primaryActiveId, 'niacinamide');
  assert.equal(byId('to-azelaic-acid-10').primaryActiveId, 'azelaic');
  assert.equal(byId('to-salicylic-2-solution').primaryActiveId, 'salicylic');
  // les exfoliants cachés sont déclarés (jamais d'exfoliant invisible pour le moteur)
  assert.ok(byId('cerave-blemish-control-gel').ingredients.some(i => i.activeId === 'aha_pha') && byId('cerave-blemish-control-gel').ingredients.some(i => i.activeId === 'salicylic'));
  assert.ok(byId('lrp-pure-vitamin-c10-serum').ingredients.some(i => i.activeId === 'salicylic'));
});

test('OF3 D/E : aucun rétinoïde ni médicament dans les produits proposés ; un produit à rétinoïde est écarté de l\'affichage', () => {
  const shown = products.usable(REAL);
  for (const p of shown) {
    assert.ok(!p.ingredients.some(i => i.activeId === 'retinoid'), p.id + ' contient un rétinoïde');
    assert.notEqual(p.primaryActiveId, 'retinoid');
    assert.doesNotMatch(JSON.stringify([p.name, p.description, p.ingredients, p.targets]), /r[ée]tino|tretino|adapal|benzoyl|clindamycin|antibiotique|m[ée]dicament|ordonnance|prescri/i, p.id);
  }
  const mela = byId('lrp-mela-b3-serum');
  assert.ok(mela.ingredients.some(i => i.activeId === 'retinoid'), 'le dérivé de vitamine A est déclaré, pas caché');
  assert.equal(mela.status, 'to_verify'); assert.equal(mela.active, false);
  assert.ok(!shown.includes(mela));
});

test('OF4 F/G : statut — validé = identité complète (nom, marque, format, INCI, source fabricant) ; à vérifier = jamais affiché et sa lacune est écrite', () => {
  for (const p of REAL) {
    assert.ok(['validated', 'to_verify'].includes(p.status), p.id);
    if (p.status === 'validated') {
      assert.ok(p.name && p.brand && p.format && p.category, p.id);
      assert.ok(Array.isArray(p.inci) && p.inci.length > 3, p.id + ' : INCI');
      assert.ok(p.sources.some(s => s.kind === 'manufacturer' && /^https:\/\//.test(s.url) && /^\d{4}-\d\d-\d\d$/.test(s.checkedAt)), p.id + ' : source fabricant');
      assert.equal(p.active, true);
    } else {
      assert.equal(p.active, false);
      assert.ok(p.verification.missing.length > 0, p.id);
      assert.deepEqual(p.offers, []);
    }
  }
  assert.deepEqual(REAL.filter(p => p.status === 'to_verify').map(p => p.id).sort(), ['lrp-effaclar-duo-m', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum']);
  assert.equal(products.usable(REAL).length, 10);
  // une seule version de chaque produit (aucun mélange ancienne / nouvelle formule)
  assert.equal(REAL.filter(p => /Hyaluronic Acid 2%/.test(p.name)).length, 1);
  assert.match(byId('to-hyaluronic-b5-ceramides').name, /with Ceramides/);
  assert.ok(byId('to-hyaluronic-b5-ceramides').inci.includes('Phospholipids') && !byId('to-hyaluronic-b5-ceramides').inci.some(x => /original/i.test(x)));
  assert.doesNotMatch(JSON.stringify(byId('to-hyaluronic-b5-ceramides')), /Original Formulation['"]?\s*[,}]\s*category/);
  assert.match(byId('to-salicylic-2-solution').description, /anhydre/);
});

test('OF5 H/I/J : catégories existantes seulement ; actif retenu distinct du contenu ; hydratant sans actif fort', () => {
  for (const p of REAL) assert.ok(products.CATEGORIES.includes(p.category), p.id);
  assert.deepEqual(products.CATEGORIES, ['cleanser', 'serum', 'moisturizer', 'spf']);
  assert.equal(byId('lrp-cicaplast-baume-b5-plus').category, 'moisturizer');
  assert.ok(!byId('lrp-cicaplast-baume-b5-plus').ingredients.some(i => i.activeId && actives.byId(i.activeId).groups.length));
  for (const p of REAL.filter(p => p.category === 'serum' && p.primaryActiveId)) assert.ok(p.ingredients.some(i => i.activeId === p.primaryActiveId), p.id);
});

test('OF6 K : aucune donnée commerciale globale ; aucune offre inventée ; la livraison ne contient aucune offre non vérifiée', () => {
  for (const p of REAL) {
    for (const k of ['price', 'priceSource', 'priceCheckedAt', 'availability', 'vendor', 'url']) assert.equal(p[k], undefined, p.id + ' : ' + k);
    assert.ok(Array.isArray(p.offers));
    for (const o of p.offers) { assert.ok(o.source && o.checkedAt); if (o.price != null) assert.ok(o.currency); }
  }
  // seule offre livrée : Dermastore (Afrique du Sud), page produit ouverte et lue ; le lien BuyBetter cité par CeraVe renvoie 404 : aucune offre pour le Nigeria
  const shipped = REAL.flatMap(p => p.offers.map(o => [p.id, o]));
  assert.deepEqual(shipped.map(([id, o]) => id + ':' + o.market + ':' + o.retailer), ['cerave-blemish-control-gel:ZA:Dermastore']);
  const dz = shipped[0][1];
  assert.equal(dz.price, 300); assert.equal(dz.currency, 'ZAR'); assert.equal(dz.availability, 'in_stock'); assert.equal(dz.type, 'retailer');
  assert.equal(dz.url, 'https://dermastore.co.za/cerave-blemish-control-gel/'); assert.match(dz.source, /ouverte directement/); assert.equal(dz.checkedAt, '2026-10-06');
  assert.ok(!JSON.stringify(REAL).includes('buybetter.ng'), 'lien mort : retiré');
  assert.ok(shipped.every(([id]) => byId(id).status === 'validated'));
  const text = JSON.stringify(REAL);
  assert.doesNotMatch(text, /\d\s?%\s?(de )?(correspondance|compatib)/i);
});

test('OF6b images : fichiers du projet, WebP valides, produit reconnaissable, provenance connue ; sans image vérifiable : « Image à venir »', () => {
  const withImg = REAL.filter(p => p.image), without = REAL.filter(p => !p.image);
  assert.deepEqual(without.map(p => p.id).sort(), ['cerave-hydrating-ha-serum', 'lrp-effaclar-duo-m', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum'], 'jamais d\'image pour un produit non validé, ni sans source ouverte');
  assert.equal(withImg.length, 9);
  for (const p of withImg) {
    assert.equal(p.status, 'validated');
    assert.equal(p.image.src, 'img/products/' + p.id + '.webp');
    const f = path.join(__dirname, '..', p.image.src), b = fs.readFileSync(f);
    assert.equal(b.slice(0, 4).toString('latin1'), 'RIFF', p.id); assert.equal(b.slice(8, 12).toString('latin1'), 'WEBP', p.id);
    assert.ok(b.length > 2000 && b.length < 60000, p.id + ' : poids ' + b.length);
    assert.ok(p.image.alt.length > 10 && p.image.alt.includes(p.name.split(' ')[0]) || /Flacon|Tube/.test(p.image.alt), p.id);
    assert.match(p.image.sourceUrl, /^https:\/\/(theordinary\.com|africa\.cerave\.com|africa\.laroche-posay\.com)\//, p.id + ' : source fabricant');
    assert.ok(p.sources.some(s => s.url === p.image.sourceUrl), p.id + ' : la page de l\'image est une source du produit');
    assert.equal(p.image.checkedAt, '2026-10-06'); assert.match(p.image.credit, /^Visuel : (The Ordinary|CeraVe|La Roche-Posay)$/);
    assert.ok(p.image.credit.includes(p.brand), p.id);
  }
  const files = fs.readdirSync(path.join(__dirname, '../img/products')).filter(x => x !== '.gitkeep').sort();
  assert.deepEqual(files, withImg.map(p => p.id + '.webp').sort(), 'aucun fichier orphelin');
  // les validateurs refusent une image sans provenance, ou distante
  const bad = (img, re) => assert.ok(products.validateProduct({ ...byId('to-azelaic-acid-10'), image: img }).some(m => re.test(m)), JSON.stringify(img));
  bad({ src: 'img/products/x.webp', alt: 'Tube' }, /page d'origine/);
  bad({ src: 'https://cdn.exemple-site.com/x.png', alt: 'Tube', sourceUrl: 'https://theordinary.com/p', checkedAt: '2026-10-06', credit: 'Visuel : X' }, /fichier du projet/);
  bad({ src: 'img/products/x.webp', alt: '', sourceUrl: 'https://theordinary.com/p', checkedAt: '2026-10-06', credit: 'Visuel : X' }, /image invalide/);
  bad({ src: 'img/products/x.webp', alt: 'Tube', sourceUrl: 'http://theordinary.com/p', checkedAt: '2026-10-06', credit: 'Visuel : X' }, /page d'origine/);
});

test('OF7 L/M : une offre exige pays, vendeur, type, disponibilité, source, date ; le prix exige sa devise ; devises cohérentes avec le pays ; aucun faux lien', () => {
  const bad = (extra, re) => { const e = products.validateProduct(withOffers('to-azelaic-acid-10', [OFFER(extra)])); assert.ok(e.some(m => re.test(m)), JSON.stringify(extra) + ' → ' + JSON.stringify(e)); };
  assert.deepEqual(products.validateProduct(withOffers('to-azelaic-acid-10', [OFFER()])), []);
  bad({ market: 'XX' }, /pays/); bad({ market: undefined }, /pays/);
  bad({ retailer: '' }, /vendeur/); bad({ type: 'cart' }, /type/);
  bad({ availability: 'available' }, /disponibilité/); bad({ availability: undefined }, /disponibilité/);
  bad({ source: '' }, /source/); bad({ source: undefined }, /source/);
  bad({ checkedAt: undefined }, /date/); bad({ checkedAt: 'hier' }, /date/);
  bad({ price: 0 }, /prix/); bad({ price: -5 }, /prix/); bad({ price: '9500' }, /prix/);
  bad({ currency: null }, /devise/);                                                   // un prix sans devise
  bad({ currency: 'JPY' }, /devise/);
  bad({ market: 'NG', currency: 'XOF' }, /impossible dans ce pays/);                  // FCFA au Nigeria : conversion ou erreur
  bad({ market: 'BJ', currency: 'NGN' }, /impossible dans ce pays/);                  // naira au Bénin
  bad({ market: 'GH', currency: 'XAF' }, /impossible dans ce pays/);
  bad({ market: 'CM', currency: 'XOF' }, /impossible dans ce pays/);
  bad({ url: 'http://vendeur-de-test.shop/p' }, /lien/); bad({ url: 'javascript:alert(1)' }, /lien/); bad({ url: '#' }, /lien/); bad({ url: 'https://example.com/p' }, /lien/);
  bad({ url: 'https://localhost/p' }, /lien/); bad({ url: 'https://boutique.example/p' }, /lien/); bad({ url: 'https://192.168.0.1/p' }, /lien/);
  bad({ shipping: 'drone' }, /livraison/); bad({ converted: 4000 }, /interdit/); bad({ score: 9 }, /interdit/);
  assert.ok(products.validateProduct({ ...withOffers('to-azelaic-acid-10', [OFFER(), OFFER()]) }).some(m => /double/.test(m)), 'offre en double');
  assert.ok(products.validateProduct({ ...byId('lrp-mela-b3-serum'), offers: [OFFER()] }).some(m => /à vérifier n'a aucune offre/.test(m)));
  // prix inconnu : permis, avec ou sans devise
  assert.deepEqual(products.validateProduct(withOffers('to-azelaic-acid-10', [OFFER({ price: null, currency: null, availability: 'unknown', url: null })])), []);
});

test('OF8 N/O/P : plusieurs pays, plusieurs offres, prix et disponibilité propres à chaque pays ; aucun pays par défaut', () => {
  const offers = [
    OFFER({ market: 'NG', currency: 'NGN', price: 14500, retailer: 'Boutique A', type: 'marketplace', availability: 'in_stock', shipping: 'international' }),
    OFFER({ market: 'BJ', currency: 'XOF', price: 9500, retailer: 'Boutique B', availability: 'out_of_stock' }),
    OFFER({ market: 'GH', currency: 'GHS', price: 180, retailer: 'Boutique C', availability: 'coming_soon', url: null }),
    OFFER({ market: 'KE', currency: 'KES', price: 2400, retailer: 'Boutique D', availability: 'unknown' }),
    OFFER({ market: 'ZA', currency: 'ZAR', price: 210, retailer: 'Boutique E', type: 'pharmacy' }),
    OFFER({ market: 'MA', currency: 'MAD', price: 120, retailer: 'Boutique F' }),
    OFFER({ market: 'CM', currency: 'XAF', price: 9800, retailer: 'Boutique G' }),
    OFFER({ market: 'SN', currency: 'XOF', price: null, retailer: 'Boutique H', availability: 'unknown', url: null }),
    OFFER({ market: 'CI', currency: 'XOF', price: 9700, retailer: 'Boutique I', type: 'brand_site' }),
    OFFER({ market: 'TG', currency: 'XOF', price: 9600, retailer: 'Boutique J', type: 'importer' }),
    OFFER({ market: 'NG', currency: 'NGN', price: 15900, retailer: 'Boutique K' })
  ];
  const p = withOffers('to-niacinamide-10-zinc-1', offers);
  assert.deepEqual(products.validateProduct(p), []);
  const c = products.commerceOf(p);
  assert.equal(c.offers.length, 11); assert.equal(c.price, null, 'jamais de prix unique'); assert.equal(c.availability, null, 'jamais de disponibilité unique');
  assert.deepEqual(c.markets.sort(), ['BJ', 'CI', 'CM', 'GH', 'KE', 'MA', 'NG', 'SN', 'TG', 'ZA']);
  const at = (m, r) => c.offers.find(o => o.market === m && (!r || o.retailer === r));
  assert.equal(at('NG', 'Boutique A').currency, 'NGN'); assert.equal(at('NG', 'Boutique A').availability, 'in_stock'); assert.equal(at('NG', 'Boutique A').marketplace, true);
  assert.equal(at('BJ').availability, 'out_of_stock'); assert.equal(at('BJ').buyable, false);                         // Bénin indisponible ≠ Nigeria disponible
  assert.equal(at('NG', 'Boutique A').buyable, true);
  assert.equal(at('GH').buyable, false); assert.equal(at('GH').url, null);
  assert.equal(at('KE').linkOnly, true); assert.equal(at('KE').buyable, false);
  assert.equal(at('SN').price, null);
  assert.equal(at('CM').currency, 'XAF'); assert.equal(at('CI').currency, 'XOF');
  assert.ok(c.offers.every(o => o.country && o.typeLabel && o.availabilityLabel && o.source && o.checkedAt));
  // prix jamais convertis : chaque prix reste exactement celui saisi, dans sa devise
  assert.deepEqual(c.offers.map(o => [o.market, o.currency, o.price]).filter(x => x[0] === 'NG').map(x => x[2]).sort(), [14500, 15900]);
  // ordre : pays (alphabétique français) puis vendeur, sans préférence
  const order = c.offers.map(o => o.country); assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b, 'fr')));
  // un produit présent seulement au Nigeria ne laisse apparaître ni le Bénin ni un autre pays
  const ng = products.commerceOf(withOffers('to-niacinamide-10-zinc-1', [OFFER({ market: 'NG', currency: 'NGN', price: 14500 })]));
  assert.deepEqual(ng.markets, ['NG']); assert.ok(!JSON.stringify(ng).includes('Bénin') && !JSON.stringify(ng).includes('XOF'));
  // les marchés couvrent les 54 pays africains
  assert.equal(Object.keys(products.MARKETS).length, 54);
  for (const code of ['BJ', 'NG', 'GH', 'CI', 'SN', 'TG', 'KE', 'ZA', 'MA', 'CM']) assert.ok(products.MARKETS[code], code);
});

test('OF9 Q/R : l\'offre ne change jamais la sélection ; une offre ne rend pas un produit recommandable ni ne le retire', () => {
  const rich = REAL.map(p => ({ ...p, offers: p.status === 'validated' ? [OFFER({ market: 'NG', currency: 'NGN', price: 1, availability: 'out_of_stock' }), OFFER({ market: 'KE', currency: 'KES', price: 9999999, retailer: 'Autre' })] : [] }));
  const none = REAL.map(p => ({ ...p, offers: [] }));
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed), a = Engine.run(norm(c.ui, c.o), c.profile, { catalog: REAL }), b = Engine.run(norm(c.ui, c.o), c.profile, { catalog: rich }), d = Engine.run(norm(c.ui, c.o), c.profile, { catalog: none });
    assert.deepEqual(a.productMatches, b.productMatches, 'seed ' + seed); assert.deepEqual(a.productMatches, d.productMatches, 'seed ' + seed);
  }
});

test('OF10 S/T : sélection réelle cohérente avec l\'actif retenu ; exclusions et approche douce respectées ; profils synthétiques variés', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed);
    const prof = { ...c.profile, comfort: { preferGentle: seed % 3 === 0 }, exclusions: seed % 5 === 0 ? ['azelaic', 'vitamin_c'] : seed % 7 === 0 ? ['niacinamide'] : [] };
    const r = Engine.run(norm(c.ui, c.o), prof, { catalog: REAL });
    const steps = [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
    const excl = new Set(r.routinePlan.exclusions);
    for (const m of r.productMatches) {
      const p = byId(m.productId), step = steps.find(s => s.id === m.stepId); seen.add(p.id);
      assert.equal(p.status, 'validated'); assert.equal(p.demo, false);
      if (step.kind === 'treatment') assert.ok(products.ids(p).includes(step.activeId), `seed ${seed} : ${p.id} ne contient pas l'actif retenu ${step.activeId}`);
      assert.ok(!products.ids(p).some(id => excl.has(id)), `seed ${seed} : exclusion violée par ${p.id}`);
      if (r.routinePlan.comfortMode) assert.ok(!products.ids(p).some(id => actives.byId(id).irritation !== 'low' && id !== step.activeId), `seed ${seed} : approche douce violée par ${p.id}`);
      assert.ok(!products.ids(p).includes('retinoid'));
      // jamais d'exfoliant fort introduit hors plan
      assert.ok(products.ids(p).every(id => id === step.activeId || !actives.byId(id).groups.length), `seed ${seed} : ${p.id} introduit un exfoliant`);
    }
    const view = products.catalogView(r.routinePlan, r.productMatches, REAL);
    assert.ok(!view.recommended.concat(view.others).some(x => byId(x.productId).status === 'to_verify'), 'un produit à vérifier n\'est jamais listé');
    for (const o of view.others) assert.ok(copy.PRODUCT_REASONS[o.reason] && o.text === copy.PRODUCT_REASONS[o.reason]);
  }
  assert.ok(seen.has('to-niacinamide-10-zinc-1') && seen.has('lrp-cicaplast-baume-b5-plus') && seen.has('to-ascorbyl-glucoside-12'), 'les produits compatibles sont bien recommandés');
  // conséquences assumées de l'architecture existante (moteur inchangé) : ces produits restent « Autres produits »
  for (const id of ['cerave-blemish-control-gel', 'lrp-pure-vitamin-c10-serum', 'cerave-hydrating-ha-serum', 'to-hyaluronic-b5-ceramides']) assert.ok(!seen.has(id), id + ' ne doit pas être recommandé par le moteur actuel');
});

test('OF11 démonstration séparée : aucun produit ni marque de démonstration dans le catalogue réel, et inversement', () => {
  const demoIds = new Set(demoData.PRODUCTS.map(p => p.id)), demoBrands = new Set(demoData.PRODUCTS.map(p => p.brand));
  for (const p of REAL) { assert.equal(p.demo, false); assert.ok(!demoIds.has(p.id) && !demoBrands.has(p.brand), p.id); }
  assert.ok(demoData.PRODUCTS.every(p => p.demo === true && !(p.offers && p.offers.length)));
  assert.ok(products.validateProduct({ ...demoData.PRODUCTS[0], offers: [OFFER()] }).some(m => /démonstration n'a pas d'offre réelle/.test(m)));
});

test('OF12 interface : offres par pays, textes neutres, bouton « Acheter en ligne » seulement avec un vrai lien, aucun pays par défaut, aucun prix global', () => {
  const app = read('js/app.js'), css = read('css/components/card.css');
  assert.match(app, /o\.buyable\?`<a class="c-btn c-btn--primary c-btn--block" href="\$\{esc\(o\.url\)\}"[^>]*>Acheter en ligne<\/a>`/);
  assert.equal((app.match(/Acheter en ligne/g) || []).length, 1, 'un seul bouton d\'achat, lié à une offre');
  assert.match(app, /Engine\.copy\.OFFER_TEXTS\.neutral/); assert.match(app, /OFFER_TEXTS\.none/); assert.match(app, /OFFER_TEXTS\.priceToCheck/);
  assert.match(app, /Offres à venir/); assert.match(app, /Relevé le \$\{dFr\(o\.checkedAt\)\} \(\$\{esc\(o\.source\)\}\)/);
  assert.match(app, /p\.demo\|\|p\.skinTypesDocumented/, 'types de peau affichés seulement s\'ils sont documentés');
  assert.match(app, /fmtMoney\(o\.price,o\.currency\)/);
  assert.doesNotMatch(strip(app), /['"`]BJ['"`]|Cotonou|\|\|\s*['"`]XOF/, 'aucun pays ni devise par défaut');
  assert.doesNotMatch(strip(read('js/engine/products.js')), /market\s*\|\|\s*['"`]|['"`]BJ['"`]\s*;/);
  assert.match(css, /\.offer\b/);
  assert.ok(/neutre|dépendent de votre pays/.test(copy.OFFER_TEXTS.neutral) && /livraison selon votre pays/.test(copy.OFFER_TEXTS.international));
  assert.match(copy.OFFER_TEXTS.marketplace, /authenticité/);
  assert.doesNotMatch(JSON.stringify(copy.OFFER_TEXTS), /officiellement distribu/i);
});

test('OF13 le catalogue réel reste une donnée publique : aucun secret, clé, jeton, accès admin ; sources en https', () => {
  const code = strip(read('js/engine/data/catalog.js'));
  assert.doesNotMatch(code, /service_role|apikey|api_key|secret|token|password|admin|fetch\(|require\('(?!\.)/i);
  for (const p of REAL) for (const s of p.sources) { assert.match(s.url, /^https:\/\//); assert.doesNotMatch(s.url, /[?&](key|token|sig|auth)=/i); }
});
