'use strict';
/* Phase 3B-2 : extraction d'attributs (tools/market/attributes.js). Fonctions pures ; l'extraction ne prétend jamais savoir ce qui n'est pas écrit. */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../tools/market/attributes.js');

test('AT-1 marques : alias déclarés seulement ; casse et écritures voisines rapprochées', () => {
  for (const t of ['The Ordinary Niacinamide', 'THE ORDINARY Niacinamide', 'Theordinary niacinamide', 'the-ordinary niacinamide']) assert.equal(A.extractBrand(t).canonical, 'The Ordinary', t);
  for (const t of ['La Roche-Posay Cicaplast', 'LA ROCHE POSAY Cicaplast', 'Laroche Posay Cicaplast', 'LRP Cicaplast']) assert.equal(A.extractBrand(t).canonical, 'La Roche-Posay', t);
  assert.equal(A.extractBrand('Cera Ve Hydrating').canonical, 'CeraVe'); assert.equal(A.extractBrand('Vichy Liftactiv').canonical, 'Vichy');
  // rien d'inventé : marque non déclarée, mot partiel, entrée vide
  assert.equal(A.extractBrand('Garnier Vitamin C'), null); assert.equal(A.extractBrand('lrpx cicaplast'), null); assert.equal(A.extractBrand('Ordinary Niacinamide'), null, '« Ordinary » seul n\'est pas un alias déclaré');
  for (const bad of [null, undefined, '', 12, {}]) assert.equal(A.extractBrand(bad), null);
  // deux marques dans le même texte : ambigu, aucune n'est choisie
  assert.deepEqual(A.extractBrand('La Roche-Posay vs CeraVe'), { canonical: null, ambiguous: true, candidates: ['CeraVe', 'La Roche-Posay'] });
});

test('AT-2 les alias de marque ne fusionnent jamais deux marques', () => {
  assert.deepEqual(A.validateBrands(A.BRANDS), []);
  assert.ok(A.validateBrands([{ canonical: 'A', aliases: ['x'] }, { canonical: 'B', aliases: ['x'] }]).some(m => /partagé/.test(m)));
  assert.ok(A.validateBrands([{ canonical: 'A', aliases: ['The Ordinary'] }]).some(m => /non normalisé/.test(m)));
  assert.ok(A.validateBrands([{ canonical: 'A', aliases: [] }]).length); assert.ok(A.validateBrands([null]).length);
  const seen = new Map(); for (const b of A.BRANDS) for (const a of b.aliases) { assert.ok(!seen.has(a), a); seen.set(a, b.canonical); }
});

test('AT-3 exemples du brief : brand, actif, concentration, ingrédient secondaire, volume', () => {
  const a = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 30ml');
  assert.equal(a.brand.canonical, 'The Ordinary');
  assert.deepEqual(a.concentrations.map(c => [c.ingredient, c.activeId, c.percentage]), [['hyaluronic acid', 'hyaluronic', 2]]);
  assert.deepEqual(a.ingredients.map(i => i.ingredient), ['hyaluronic acid', 'panthenol']);   // B5 = ingrédient secondaire, sans pourcentage
  assert.equal(a.volume.value, 30); assert.equal(a.volume.unit, 'ml'); assert.equal(a.volume.raw, '30ml');
  assert.deepEqual(a.variants, []); assert.equal(a.spf, null);
  const v = A.extractAttributes('Vichy Vitamin C Serum 10%');
  assert.equal(v.brand.canonical, 'Vichy'); assert.deepEqual(v.concentrations.map(c => [c.ingredient, c.activeId, c.percentage]), [['vitamin c', 'vitamin_c', 10]]);
  assert.equal(v.volume, null, 'pas de volume écrit : null');
  // FR et EN donnent les mêmes attributs
  const fr = A.extractAttributes('The Ordinary Acide Hyaluronique 2% + B5 - 30 ml');
  assert.deepEqual(fr.concentrations, a.concentrations); assert.deepEqual(fr.ingredients, a.ingredients); assert.equal(fr.volume.value, 30);
});

test('AT-4 concentrations structurées : ingrédient lié, pourcentage numérique, réserves conservées, invalides ignorées avec avertissement', () => {
  const c = A.extractConcentrations('Niacinamide 10% + Zinc 1%');
  assert.deepEqual(c.map(x => [x.ingredient, x.percentage]), [['niacinamide', 10], ['zinc', 1]]);
  assert.deepEqual(A.extractConcentrations('10% niacinamide + 1% zinc').map(x => [x.ingredient, x.percentage]), [['niacinamide', 10], ['zinc', 1]], 'pourcentage avant l\'ingrédient');
  assert.deepEqual(A.extractConcentrations('Azelaic Acid Suspension 10%').map(x => [x.ingredient, x.percentage]), [['azelaic acid', 10]]);
  assert.deepEqual(A.extractConcentrations('Ascorbyl Glucoside Solution 12%').map(x => x.activeId), ['vitamin_c']);
  assert.equal(A.extractConcentrations('Acide salicylique 0,5 %')[0].percentage, 0.5);
  assert.deepEqual(A.extractConcentrations('Acide salicylique 0,5 % (fiche US) et dérivé LHA : à confirmer selon le pays')[0].qualifiers, ['us_sheet', 'to_confirm']);
  assert.deepEqual(A.extractConcentrations('Vitamine C pure (acide ascorbique, 10 % selon la marque)')[0].qualifiers, ['per_brand']);
  assert.equal(A.extractConcentrations('Mystery Extract 5%')[0].ingredient, null, 'ingrédient non reconnu : null, le pourcentage est conservé');
  const bad = A.extractConcentrationsDetailed('Niacinamide 250% + Zinc 0%'); assert.deepEqual(bad.items, []); assert.deepEqual(bad.warnings, ['invalid_percentage:250%', 'invalid_percentage:0%']);
  assert.deepEqual(A.extractConcentrations('Sérum sans pourcentage'), []);
  for (const x of [null, undefined, '', 5]) assert.deepEqual(A.extractConcentrations(x), []);
});

test('AT-5 variantes : reconnues quand elles sont écrites, jamais inventées', () => {
  const ids = t => A.extractVariants(t).map(v => v.id + ':' + v.exactness);
  assert.deepEqual(ids('Hyaluronic Acid 2% + B5 (with Ceramides)'), ['with_ceramides:explicit']);
  assert.deepEqual(ids('Acide Hyaluronique 2% + B5 avec céramides'), ['with_ceramides:explicit']);
  assert.deepEqual(ids('Hyaluronic Acid 2% + B5 + Ceramides'), ['with_ceramides:inferred'], '« + Ceramides » est déduit, pas écrit comme variante');
  assert.deepEqual(ids('Hyaluronic Acid 2% + B5 (Original Formulation)'), ['original:explicit']);
  assert.deepEqual(ids('Sérum formule originale'), ['original:explicit']);
  assert.deepEqual(ids('Baume ancienne formule'), ['old_formula:explicit']); assert.deepEqual(ids('Serum new formula'), ['new_formula:explicit']); assert.deepEqual(ids('Sérum nouvelle formule'), ['new_formula:explicit']);
  assert.deepEqual(ids('Coffret niacinamide'), ['set:explicit']); assert.deepEqual(ids('Niacinamide Kit'), ['kit:explicit']); assert.deepEqual(ids('Recharge sérum'), ['refill:explicit']);
  assert.deepEqual(ids('Super Size Niacinamide'), ['supersize:explicit']); assert.deepEqual(ids('Niacinamide Supersize'), ['supersize:explicit']);
  // rien d'écrit → rien de déduit
  for (const t of ['Hyaluronic Acid 2% + B5 30 ml', 'The Ordinary Niacinamide 10% + Zinc 1%', 'Reset serum', 'Asset manager', '', null, undefined, 7]) assert.deepEqual(A.extractVariants(t), [], String(t));
  // un terme qui fait partie du NOM du produit se déclare et s'exclut
  assert.deepEqual(ids('La Roche-Posay Effaclar Duo+M 40 ml'), ['duo:explicit']);
  assert.deepEqual(A.extractVariants('La Roche-Posay Effaclar Duo+M 40 ml', { exclude: ['duo'] }), []);
  // un motif explicite l'emporte sur un motif déduit du même identifiant
  assert.deepEqual(ids('Hyaluronic Acid 2% + B5 + Ceramides (with Ceramides)'), ['with_ceramides:explicit']);
  // chaque détection porte son extrait source
  assert.match(A.extractVariants('Serum (with Ceramides)')[0].raw, /with ceramides/);
});

test('AT-6 Lynia : le même texte avec « with Ceramides » ou « Original Formulation » diffère par la variante seulement', () => {
  const withC = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 30 ml (with Ceramides)'), orig = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 30 ml (Original Formulation)'), none = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 30 ml');
  for (const k of ['brand', 'volume']) assert.deepEqual(withC[k], orig[k]);
  assert.deepEqual(withC.concentrations, orig.concentrations);
  assert.deepEqual(withC.variants.map(v => v.id), ['with_ceramides']); assert.deepEqual(orig.variants.map(v => v.id), ['original']); assert.deepEqual(none.variants, [], 'variante absente du texte : non déterminée, jamais devinée');
  assert.notEqual(withC.key, orig.key); assert.notEqual(withC.key, none.key); assert.notEqual(orig.key, none.key);
});

test('AT-7 SPF, quantités multiples, entrées invalides', () => {
  assert.deepEqual(A.extractSpf('Cicaplast Baume B5+ SPF 50+'), { value: 50, plus: true }); assert.deepEqual(A.extractSpf('SPF30'), { value: 30, plus: false }); assert.equal(A.extractSpf('Baume B5+'), null);
  const q = A.extractAttributes('Serum 30 ml / 1 fl oz'); assert.equal(q.quantities.length, 2); assert.equal(q.volume.raw, '30 ml');
  assert.deepEqual(A.extractAttributes('Serum 1 oz').warnings, ['ambiguous_unit']);
  for (const bad of [null, undefined, '', 0, {}, []]) {
    const a = A.extractAttributes(bad);
    assert.equal(a.brand, null); assert.equal(a.volume, null); assert.deepEqual([a.quantities, a.ingredients, a.concentrations, a.variants, a.warnings], [[], [], [], [], []]); assert.equal(a.spf, null); assert.equal(a.key, '');
  }
});
