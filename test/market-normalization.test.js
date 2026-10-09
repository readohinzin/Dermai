'use strict';
/* Phase 3B-2 : normalisation de texte et d'unités (tools/market/normalize.js). Fonctions pures ; aucun réseau, aucun fichier. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const N = require('../tools/market/normalize.js');

const ROOT = path.join(__dirname, '..');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const key = N.comparableKey, norm = N.normalizeText;

test('NM-A accents : « céramides » → « ceramides » ; NFKD sans perdre les lettres', () => {
  assert.equal(norm('céramides'), 'ceramides'); assert.equal(norm('Acide azélaïque'), 'acide azelaique'); assert.equal(norm('Sérum'), 'serum');
  assert.equal(norm('Crème Hydratante à l\'Acide'), 'creme hydratante a l acide');
});

test('NM-B casse : « THE ORDINARY » = « The Ordinary » = « the ordinary »', () => {
  assert.equal(norm('THE ORDINARY'), norm('The Ordinary')); assert.equal(norm('The Ordinary'), 'the ordinary');
  assert.equal(key('THE ORDINARY Niacinamide'), key('the ordinary niacinamide'));
});

test('NM-C espaces et unités collées : « 30 ml » = « 30ml » = « 30 mL » ; espaces multiples et insécables', () => {
  for (const v of ['30 ml', '30ml', '30 mL', '30   ml', '30 ml', '30 ML']) assert.equal(norm(v), '30ml', JSON.stringify(v));
  assert.equal(norm('  The   Ordinary \n Niacinamide  '), 'the ordinary niacinamide');
});

test('NM-D ponctuation : « B5 - 30 ml » = « B5 30 ml » ; tirets typographiques, parenthèses, guillemets, deux-points', () => {
  assert.equal(norm('B5 - 30 ml'), norm('B5 30 ml')); assert.equal(norm('B5 – 30 ml'), norm('B5 30 ml')); assert.equal(norm('B5 — 30 ml'), norm('B5 30 ml'));
  assert.equal(norm('La Roche-Posay'), 'la roche posay'); assert.equal(norm('« Original Formulation » (30 ml) : sérum'), 'original formulation 30ml serum');
  assert.equal(key('B5 - 30 ml'), key('B5 30 ml'));
});

test('NM-E concentrations protégées : « 2% » reste 2 %, jamais « 2 » ; virgule décimale ; valeurs distinctes jamais fusionnées', () => {
  assert.equal(norm('Hyaluronic Acid 2%'), 'hyaluronic acid 2%'); assert.equal(norm('Hyaluronic Acid 2 %'), 'hyaluronic acid 2%');
  assert.equal(norm('0,5 %'), '0.5%'); assert.equal(norm('2,5%'), '2.5%');
  assert.match(norm('Niacinamide 10% + Zinc 1%'), /10%.*1%/);
  assert.notEqual(key('Hyaluronic Acid 2%'), key('Hyaluronic Acid 20%')); assert.notEqual(key('Salicylic Acid 2%'), key('Salicylic Acid 0.5%'));
  assert.ok(norm('Niacinamide 10%').includes('10%') && !/\b10\b(?!%)/.test(norm('Niacinamide 10%')));
});

test('NM-F le signe + est protégé : « B5 + Ceramides » garde son +, y compris collé ou en fin de nom', () => {
  assert.equal(norm('B5 + Ceramides'), 'b5 + ceramides'); assert.equal(norm('b5+ceramides'), 'b5 + ceramides'); assert.equal(norm('B5   +   Ceramides'), 'b5 + ceramides');
  assert.ok(key('Hyaluronic Acid 2% + B5').includes('+'));
  assert.notEqual(key('La Roche-Posay Cicaplast Baume B5+'), key('La Roche-Posay Cicaplast Baume B5'), 'Baume B5+ ≠ ancien Baume B5');
  assert.notEqual(key('Effaclar Duo+'), key('Effaclar Duo')); assert.notEqual(key('SPF 50+'), key('SPF 50'));
  assert.equal(norm('SPF 50+'), 'spf50+');
});

test('NM-G variantes protégées : with / avec ceramides, kit, set, duo, refill, supersize, ancienne / nouvelle formule restent identifiables', () => {
  assert.ok(norm('Hyaluronic Acid 2% + B5 (with Ceramides)').includes('with ceramides'));
  assert.ok(key('Hyaluronic Acid 2% + B5 (with Ceramides)').split(' ').includes('with') && key('Hyaluronic Acid 2% + B5 (with Ceramides)').split(' ').includes('ceramides'));
  for (const w of ['kit', 'set', 'duo', 'refill', 'supersize']) assert.ok(key('Niacinamide 10% ' + w).split(' ').includes(w), w);
  assert.ok(key('Sérum ancienne formule').includes('old') && key('Sérum ancienne formule').includes('formula'));
  assert.ok(key('Sérum nouvelle formule').includes('new'));
  assert.equal(key('Sérum avec céramides'), key('Serum with ceramides'));
  assert.notEqual(key('Hyaluronic Acid 2% + B5 with Ceramides'), key('Hyaluronic Acid 2% + B5'));
  assert.notEqual(key('Hyaluronic Acid 2% + B5 with Ceramides'), key('Hyaluronic Acid 2% + B5 Original Formulation'));
  assert.notEqual(key('Niacinamide 10% duo'), key('Niacinamide 10%'));
  for (const sw of N.STOPWORDS) assert.ok(!['with', 'avec', 'kit', 'set', 'duo', 'refill', 'supersize', 'old', 'new', 'original', 'formula'].includes(sw), sw + ' ne doit pas être un mot vide');
});

test('NM-H langue : FR et EN se rapprochent UNIQUEMENT par le lexique explicite', () => {
  assert.equal(key('Acide Hyaluronique'), key('Hyaluronic Acid'));
  assert.equal(key('The Ordinary Acide Hyaluronique 2% + B5 - 30 ml'), key('The Ordinary Hyaluronic Acid 2% + B5 30ml'));
  assert.equal(key('the ordinary hyaluronique acid 2% + b5 30ml'), key('The Ordinary Hyaluronic Acid 2% + B5 - 30 ml'), 'écriture mixte FR/EN');
  assert.equal(key('Sérum Vitamine C 10%'), key('Vitamin C Serum 10%'), 'ordre des mots et langue');
  assert.equal(key('Vitamine B3'), key('Niacinamide'));
  assert.equal(key('Acide Salicylique 2%'), key('Salicylic Acid 2%'));
  // hors lexique : rien n'est traduit, rien n'est fusionné
  assert.notEqual(key('Acide kojique 2%'), key('Kojic acid 2%'), 'terme non déclaré : pas de traduction implicite');
  assert.notEqual(key('Acide Hyaluronique 2%'), key('Acide Salicylique 2%'));
  assert.ok(N.LEXICON_VERSION >= 1);
  for (const [fr, en] of N.PHRASES) { assert.equal(norm(fr), fr, 'expression FR normalisée : ' + fr); assert.equal(norm(en), en, 'expression EN normalisée : ' + en); }
  for (const [fr, en] of Object.entries(N.WORDS)) { assert.equal(norm(fr), fr, fr); assert.equal(norm(en), en, en); }
});

test('NM-H2 ordre des mots : l\'ordre ne compte pas, mais chaque concentration reste liée à SON ingrédient', () => {
  assert.equal(key('B5 + Hyaluronic Acid 2%'), key('Hyaluronic Acid 2% + B5'));
  assert.equal(key('Serum Vitamin C 10% Vichy'), key('Vichy Vitamin C Serum 10%'));
  assert.notEqual(key('Niacinamide 10% + Zinc 1%'), key('Niacinamide 1% + Zinc 10%'), 'concentrations échangées = produit différent');
  assert.equal(key('Niacinamide 10% + Zinc 1%'), key('Zinc 1% + Niacinamide 10%'));
});

test('NM-H3 format et formulation jamais fusionnés par la normalisation', () => {
  assert.notEqual(key('Hyaluronic Acid 2% + B5 30 ml'), key('Hyaluronic Acid 2% + B5 60 ml'));
  assert.equal(key('Hyaluronic Acid 2% + B5 30 ml'), key('Hyaluronic Acid 2% + B5 0.03 L'), 'même quantité écrite autrement');
  assert.equal(key('Hyaluronic Acid 2% + B5 30 ml'), key('Hyaluronic Acid 2% + B5 3 cl'));
  assert.notEqual(key('Salicylic Acid 2% Solution'), key('Salicylic Acid 2% Anhydrous Solution'));
});

test('NM-I unités : ml / mL / cl / l / g / kg / oz ; valeur d\'origine conservée, valeur normalisée seulement pour comparer', () => {
  const ok = (v, u) => N.normalizeUnit(v, u);
  assert.deepEqual(ok(30, 'ml'), { ok: true, raw: { value: 30, unit: 'ml' }, normalized: { value: 30, unit: 'ml' }, kind: 'volume' });
  assert.deepEqual(ok(30, 'mL').normalized, { value: 30, unit: 'ml' }); assert.equal(ok(30, 'mL').raw.unit, 'mL');
  assert.deepEqual(ok(3, 'cl').normalized, { value: 30, unit: 'ml' }); assert.deepEqual(ok('0,03', 'L').normalized, { value: 30, unit: 'ml' }); assert.equal(ok('0,03', 'L').raw.value, 0.03);
  assert.deepEqual(ok(1, 'fl oz'), { ok: true, raw: { value: 1, unit: 'fl oz' }, normalized: { value: 29.5735, unit: 'ml' }, kind: 'volume' });
  assert.deepEqual(ok(1, 'FL. OZ').normalized, { value: 29.5735, unit: 'ml' });
  assert.deepEqual(ok(250, 'g').normalized, { value: 250, unit: 'g' }); assert.deepEqual(ok(0.25, 'kg').normalized, { value: 250, unit: 'g' });
  // « oz » seul : once liquide ou once de poids → jamais converti
  const oz = ok(1, 'oz'); assert.equal(oz.ok, true); assert.equal(oz.normalized, null); assert.equal(oz.kind, 'ambiguous'); assert.equal(oz.warning, 'ambiguous_unit');
  // une quantité normalisée ne fait pas deux formats « le même produit » : 1 fl oz ≠ 30 ml
  assert.notEqual(ok(1, 'fl oz').normalized.value, ok(30, 'ml').normalized.value);
  // parse depuis un texte : raw = écriture d'origine
  assert.deepEqual(N.parseVolume('The Ordinary Niacinamide 30 ml'), { raw: '30 ml', value: 30, unit: 'ml', normalized: { value: 30, unit: 'ml' }, kind: 'volume' });
  assert.equal(N.parseVolume('Sérum 1 fl oz').raw, '1 fl oz'); assert.equal(N.parseVolume('Sérum 1 fl oz').normalized.value, 29.5735);
  assert.deepEqual(N.parseQuantities('30 ml / 1 fl oz').map(q => q.raw), ['30 ml', '1 fl oz']);
  assert.equal(N.parseVolume('B5 gel 2% sans quantité'), null, '« 5 g » dans « B5 gel » n\'est pas une quantité');
  assert.equal(N.parseVolume('Hyaluronic Acid 2%'), null);
});

test('NM-J données absentes ou invalides : jamais d\'invention, jamais d\'exception', () => {
  for (const bad of [null, undefined, '', '   ', 0, 42, {}, [], true, NaN]) {
    assert.equal(norm(bad), ''); assert.equal(key(bad), ''); assert.equal(N.parseVolume(bad), null); assert.deepEqual(N.parseQuantities(bad), []); assert.deepEqual(N.translate(norm(bad)), []);
  }
  for (const [v, u, err] of [[null, 'ml', 'missing_value'], [undefined, 'ml', 'missing_value'], ['', 'ml', 'missing_value'], [0, 'ml', 'invalid_value'], [-5, 'ml', 'invalid_value'], [NaN, 'ml', 'invalid_value'], [Infinity, 'ml', 'invalid_value'],
    ['abc', 'ml', 'invalid_value'], [30, null, 'missing_unit'], [30, '', 'missing_unit'], [30, 'cup', 'unknown_unit'], [30, 'litre', 'unknown_unit'], [30, 5, 'missing_unit']]) {
    assert.deepEqual(N.normalizeUnit(v, u), { ok: false, error: err }, JSON.stringify([v, u]));
  }
  assert.equal(N.parseVolume('0 ml'), null, 'volume impossible ignoré');
  assert.equal(norm('x'.repeat(100000)).length, 1000, 'entrée démesurée tronquée');
  const t0 = Date.now(); key('a + '.repeat(5000)); assert.ok(Date.now() - t0 < 1500, 'pas de coût démesuré sur entrée hostile');
});

test('NM-K pureté : même entrée, même sortie ; rien n\'est muté ; aucun accès fichier, réseau, horloge ou hasard', () => {
  const a = ['The Ordinary Hyaluronic Acid 2% + B5 - 30 ml', 'Acide Hyaluronique 2%'], copy = a.slice();
  assert.deepEqual(a.map(norm), a.map(norm)); assert.deepEqual(a, copy);
  const frozenWords = JSON.stringify(N.WORDS) + JSON.stringify(N.PHRASES); key('Sérum Vitamine C 10%'); assert.equal(JSON.stringify(N.WORDS) + JSON.stringify(N.PHRASES), frozenWords, 'le lexique n\'est jamais modifié');
  for (const f of ['normalize.js', 'attributes.js', 'identity.js']) {
    const src = strip(fs.readFileSync(path.join(ROOT, 'tools/market', f), 'utf8'));
    assert.doesNotMatch(src, /require\(['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|worker_threads|vm)['"]\)/, f + ' : aucun accès fichier ni réseau');
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|process\.env|Date\.now|new Date|Math\.random|globalThis\.|\bglobal\./, f + ' : aucun réseau, environnement, horloge ou hasard');
  }
});

test('NM-L hors du navigateur : ni app.js, ni index.html, ni js/ ne référencent tools/market ou data/market ; app.js garde sa taille', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of [path.join(ROOT, 'index.html')].concat(walk(path.join(ROOT, 'js')), walk(path.join(ROOT, 'api')), walk(path.join(ROOT, 'server')))) {
    if (!/\.(js|html)$/.test(f)) continue;
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tools\/market\/|(?<![\w.])data\/market\/|identities\.json/, path.relative(ROOT, f));
  }
  assert.equal(fs.statSync(path.join(ROOT, 'js/app.js')).size, 149552, 'budget app.js inchangé');
});
