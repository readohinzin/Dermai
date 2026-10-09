'use strict';
/* Phase 3B-5 : EXTRACTEURS GÉNÉRIQUES (tools/market/extractors.js). Fixtures locales uniquement (test/fixtures/market-pages/) ; aucun accès réseau, aucune dépendance à un vendeur réel. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../tools/market/extractors.js');
const M = require('../tools/market/match.js');
const O = require('../tools/market/observation.js');
const C = require('../tools/market/confidence.js');
const K = require('../tools/market/classify.js');
const S = require('../tools/market/safe-fetch.js');
const { Readable } = require('node:stream');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(__dirname, 'fixtures/market-pages');
const fx = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const URL_P = 'https://boutique-essai.invalid/produits/acide-hyaluronique';
const ext = (name, extra) => E.extract(Object.assign({ ok: true, body: fx(name), contentType: /\.json$/.test(name) ? 'application/json' : 'text/html; charset=utf-8', finalUrl: URL_P }, extra || {}));
const html = (body, extra) => E.extract(Object.assign({ ok: true, body, contentType: 'text/html', finalUrl: URL_P }, extra || {}));
const ldPage = (obj, head) => '<html><head><title>t</title>' + (head || '') + '<script type="application/ld+json">' + JSON.stringify(obj) + '</script></head></html>';
const prod = (extra) => Object.assign({ '@context': 'https://schema.org', '@type': 'Product', name: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides' }, extra || {});
const codes = r => r.issues.map(i => i.code);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const IDENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/identities.json'), 'utf8'));
const HA = IDENT.products['to-hyaluronic-b5-ceramides'];
const keysDeep = (o, acc = new Set()) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.add(k); keysDeep(v, acc); } return acc; };

test('EX-1 pureté : aucune dépendance réseau ni fichier ni horloge ; entrée non modifiée ; aucune classe de matching produite', () => {
  const code = strip(fs.readFileSync(path.join(ROOT, 'tools/market/extractors.js'), 'utf8'));
  assert.deepEqual([...code.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(m => m[1]), ['./normalize.js', './match.js'], 'seules dépendances : normalisation et validation de GTIN');
  assert.doesNotMatch(code, /require\(['"](?:node:)?(?:fs|http|https|net|tls|dns|child_process|worker_threads|vm|os)['"]\)|\bfetch\s*\(|XMLHttpRequest|process\.|Date\.now|new Date|Math\.random|console\.|safe-fetch|writeFile/);
  const input = deepFreeze({ ok: true, body: fx('product-full.html'), contentType: 'text/html', finalUrl: URL_P });
  const r = E.extract(input); assert.equal(r.status, 'PRODUCT_DATA');
  const keys = keysDeep(r); for (const forbidden of ['matchClass', 'EXACT_MATCH', 'confidence', 'level', 'shipsTo', 'status_market', 'LOCAL']) assert.ok(!keys.has(forbidden), forbidden);
  assert.doesNotMatch(JSON.stringify(r), /EXACT_MATCH|STRONG_MATCH|POSSIBLE_MATCH|VARIANT_MATCH|NO_MATCH/, 'l\'extracteur ne décide aucune classe');
});

test('EX-2 JSON-LD Product valide : champs, provenance, niveau d\'explicitation, observation', () => {
  const r = ext('product-full.html');
  assert.equal(r.schema, 'extraction/1'); assert.equal(r.status, 'PRODUCT_DATA'); assert.equal(r.primary, 0); assert.equal(r.candidates.length, 1);
  const c = r.candidates[0];
  assert.deepEqual(c.candidate, { title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides', brand: 'The Ordinary', description: 'Sérum hydratant.', volume: '30 ml', gtin: '5060000000016', mpn: 'TO-HA-30', sku: 'ESSAI-0001' });
  assert.equal(c.origin, 'json-ld'); assert.equal(c.path, 'jsonld[0]');
  for (const k of ['name', 'brand', 'description', 'gtin', 'mpn', 'sku', 'volume', 'url']) {
    const f = c.fields[k]; assert.ok(f, k); assert.deepEqual(Object.keys(f).filter(x => !['valid'].includes(x)).sort(), ['explicitness', 'issues', 'path', 'raw', 'source', 'value']); assert.equal(f.source, 'json-ld'); assert.equal(f.explicitness, 'explicit'); assert.match(f.path, /^jsonld\[0\]\./);
  }
  assert.equal(c.fields.name.raw, 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides'); assert.equal(c.fields.brand.raw.name, 'The Ordinary'); assert.equal(c.fields.brand.value, 'The Ordinary');
  assert.equal(c.fields.gtin.valid, true); assert.equal(c.fields.gtin.path, 'jsonld[0].gtin13');
  assert.deepEqual(c.observation, { price: { amount: 12700, currency: 'XOF', basis: 'displayed' }, stock: 'IN_STOCK', url: { href: URL_P } });
  assert.equal(c.offers.length, 1); assert.equal(c.offers[0].prices[0].raw, '12700'); assert.equal(c.offers[0].prices[0].value, 12700); assert.equal(c.offers[0].prices[0].currency, 'XOF'); assert.equal(c.offers[0].seller, 'Boutique Essai');
  assert.equal(c.offers[0].availability.raw, 'https://schema.org/InStock'); assert.equal(c.offers[0].availability.value, 'IN_STOCK');
  assert.equal(r.page.title.value, 'The Ordinary Hyaluronic Acid 2% + B5 & Ceramides | Boutique Essai', 'entités décodées'); assert.equal(r.page.title.raw.includes('&amp;'), true, 'valeur brute conservée');
  assert.equal(r.page.canonicalUrl.value, 'https://boutique-essai.invalid/produits/acide-hyaluronique'); assert.equal(r.page.openGraph['og:type'].value, 'product');
  assert.equal(r.stats.jsonLdBlocks, 1); assert.equal(r.stats.productNodes, 1);
  assert.deepEqual(r.source, { requestedUrl: null, finalUrl: URL_P, contentType: 'text/html; charset=utf-8' });
});

test('EX-3 plusieurs blocs JSON-LD : seul le bloc produit est retenu ; chemin exact dans la page', () => {
  const r = ext('product-graph-multi-blocks.html');
  assert.equal(r.stats.jsonLdBlocks, 3); assert.ok(codes(r).includes('jsonld_multiple_blocks')); assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0].path, 'jsonld[2].@graph[1]');
  assert.equal(r.candidates[0].candidate.brand, 'The Ordinary'); assert.equal(r.candidates[0].observation.price.amount, 12700);
  // un tableau racine et des types multiples
  const arr = html(ldPage([{ '@type': 'WebSite' }, prod({ '@type': ['Product', 'Thing'] })])); assert.equal(arr.candidates.length, 1);
  const schemaPrefixed = html(ldPage({ '@type': 'schema:Product', name: 'X' })); assert.equal(schemaPrefixed.candidates.length, 1);
  const urlType = html(ldPage({ '@type': 'https://schema.org/Product', name: 'X' })); assert.equal(urlType.candidates.length, 1);
  // un produit lié à l'intérieur d'un produit n'est pas un second produit de la page
  const nested = html(ldPage(prod({ isRelatedTo: [{ '@type': 'Product', name: 'Autre' }], isSimilarTo: { '@type': 'Product', name: 'Autre 2' } }))); assert.equal(nested.candidates.length, 1); assert.equal(nested.candidates[0].candidate.title, 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides');
  // les types non produit ne produisent pas de candidat
  assert.equal(html(ldPage({ '@type': 'Organization', name: 'X' })).status, 'NO_PRODUCT_DATA');
  assert.equal(html(ldPage({ '@type': 'ProductGroup', name: 'G', hasVariant: [{ '@type': 'Product', name: 'V1' }, { '@type': 'Product', name: 'V2' }] })).candidates.length, 2);
  assert.ok(codes(html(ldPage({ '@type': 'ProductGroup', name: 'G' }))).includes('product_group_ignored'));
});

test('EX-4 JSON invalide : signalé, jamais réparé ni deviné ; un bloc valide voisin reste lu', () => {
  const r = ext('jsonld-invalid.html');
  assert.equal(r.status, 'PRODUCT_DATA'); assert.equal(r.stats.jsonLdBlocks, 2); assert.equal(r.stats.jsonLdInvalid, 1);
  const inv = r.issues.find(i => i.code === 'jsonld_invalid'); assert.ok(inv); assert.equal(inv.severity, 'warning'); assert.equal(inv.path, 'jsonld[0]'); assert.ok(inv.detail && inv.detail.length > 3);
  assert.equal(r.candidates.length, 1); assert.equal(r.candidates[0].candidate.title, 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides'); assert.notEqual(r.candidates[0].candidate.title, 'Cassé', 'le bloc cassé n\'est pas « réparé »');
  const only = html('<script type="application/ld+json">{"@type":"Product","name":"X",}</script>'); assert.equal(only.status, 'NO_PRODUCT_DATA'); assert.ok(codes(only).includes('jsonld_invalid')); assert.ok(codes(only).includes('no_product_data'));
  for (const bad of ['', '   ', 'null', '123', '"texte"', '[', '{"@type":"Product"', 'undefined', '{@type: Product}', '\u0000\u0001']) { let r2; assert.doesNotThrow(() => { r2 = html('<script type="application/ld+json">' + bad + '</script>'); }, JSON.stringify(bad)); assert.notEqual(r2.status, 'PRODUCT_DATA', JSON.stringify(bad)); }
  assert.equal(html('<script type="application/ld+json">' + JSON.stringify(prod()).replace(/^/, '﻿') + '</script>').status, 'PRODUCT_DATA', 'BOM toléré');
});

test('EX-5 produit sans prix : prix inconnu, jamais zéro ni deviné', () => {
  const r = ext('product-no-price.html'); const c = r.candidates[0];
  assert.equal(c.observation.price, null); assert.ok(codes(r).includes('price_missing')); assert.deepEqual(c.offers, []); assert.equal(c.observation.stock, 'UNKNOWN'); assert.ok(codes(r).includes('availability_missing'));
  assert.equal(c.candidate.gtin, '5060000000016', 'le reste est conservé');
  assert.equal(JSON.stringify(c).includes('"price":0'), false);
});

test('EX-6 prix sans devise : aucune devise inventée, quelle que soit la page (domaine, langue, symbole)', () => {
  const r = ext('product-price-no-currency.html', { finalUrl: 'https://boutique-essai.bj/produits/ha' });
  const c = r.candidates[0];
  assert.equal(c.observation.price, null); assert.ok(codes(r).includes('price_without_currency'));
  assert.equal(c.offers[0].prices[0].value, 12700, 'le montant est conservé'); assert.equal(c.offers[0].prices[0].currency, null); assert.equal(c.offers[0].prices[0].currencyRaw, null);
  for (const [price, cur] of [['12700', '€'], ['12700', 'FCFA'], ['12700', 'F CFA'], ['12700', 12], ['12700', ''], ['12700', 'XO'], ['12700', 'XOFF']]) {
    const x = html(ldPage(prod({ offers: { '@type': 'Offer', price, priceCurrency: cur } })), {}); assert.equal(x.candidates[0].observation.price, null, JSON.stringify(cur));
    if (cur !== '') assert.ok(codes(x).includes('currency_invalid'), JSON.stringify(cur)); assert.equal(x.candidates[0].offers[0].prices[0].currency, null);
  }
  // la devise dans le texte de la page ne compte pas
  const text = html(ldPage(prod({ offers: { '@type': 'Offer', price: '12700' } })) + '<p>Prix : 12 700 FCFA — Cotonou, Bénin</p>'); assert.equal(text.candidates[0].observation.price, null);
});

test('EX-7 prix avec devise explicite : montant et devise lus tels quels ; formats ambigus non interprétés', () => {
  const r = ext('product-full.html'); assert.deepEqual(r.candidates[0].observation.price, { amount: 12700, currency: 'XOF', basis: 'displayed' });
  const lower = html(ldPage(prod({ offers: { '@type': 'Offer', price: 19.5, priceCurrency: 'eur' } }))); assert.deepEqual(lower.candidates[0].observation.price, { amount: 19.5, currency: 'EUR', basis: 'displayed' }); assert.ok(codes(lower).includes('currency_case_normalized'));
  const table = [['12700', 12700, null], ['12700.50', 12700.5, null], [12700, 12700, null], [0.5, 0.5, null], ['0.99', 0.99, null], [' 12700 ', 12700, null], ['12 700', null, 'price_format_ambiguous'], ['12 700', null, 'price_format_ambiguous'], ['12,50', null, 'price_format_ambiguous'],
    ['12,700', null, 'price_format_ambiguous'], ['1.234,56', null, 'price_format_ambiguous'], ['1,234.56', null, 'price_format_ambiguous'], ['€12', null, 'price_format_ambiguous'], ['12 700 FCFA', null, 'price_format_ambiguous'], ['1e3', null, 'price_format_ambiguous'],
    ['abc', null, 'price_format_ambiguous'], ['NaN', null, 'price_format_ambiguous'], ['Infinity', null, 'price_format_ambiguous'], [Infinity, null, 'price_format_ambiguous'], [NaN, null, 'price_format_ambiguous'], ['', null, 'price_missing'], [null, null, 'price_missing'], [undefined, null, 'price_missing'],
    [0, null, 'price_not_positive'], ['0', null, 'price_not_positive'], ['0.00', null, 'price_not_positive'], [-5, null, 'price_not_positive'], ['-5', null, 'price_not_positive'], [true, null, 'price_format_ambiguous'], [{}, null, 'price_format_ambiguous'], [[12700], null, 'price_format_ambiguous']];
  for (const [raw, value, issue] of table) { const p = E.parsePrice(raw); assert.equal(p.value, value, JSON.stringify(raw)); assert.equal(p.issue, issue, JSON.stringify(raw)); }
  for (const [raw, value] of [['XOF', 'XOF'], ['xof', 'XOF'], [' EUR ', 'EUR'], ['€', null], ['FCFA', null], ['', null], [null, null], [undefined, null], [5, null], ['XO', null]]) assert.equal(E.parseCurrency(raw).value, value, JSON.stringify(raw));
  const amb = ext('product-price-formats.html'); assert.equal(amb.candidates[0].observation.price, null); assert.ok(codes(amb).includes('price_format_ambiguous')); assert.equal(amb.candidates[0].offers[0].prices[0].raw, '12 700 FCFA', 'valeur brute conservée'); assert.equal(amb.candidates[0].offers[0].prices[0].explicitness, 'ambiguous');
});

test('EX-8 disponibilité : absente = inconnue ; explicite = lue ; un titre ne prouve pas le stock', () => {
  const avail = a => html(ldPage(prod({ offers: { '@type': 'Offer', price: '1', priceCurrency: 'XOF', availability: a } })));
  assert.equal(ext('product-no-price.html').candidates[0].observation.stock, 'UNKNOWN');
  const none = html(ldPage(prod({ offers: { '@type': 'Offer', price: '1', priceCurrency: 'XOF' } }))); assert.equal(none.candidates[0].observation.stock, 'UNKNOWN'); assert.ok(codes(none).includes('availability_missing'));
  for (const [raw, v] of [['https://schema.org/InStock', 'IN_STOCK'], ['http://schema.org/InStock', 'IN_STOCK'], ['InStock', 'IN_STOCK'], ['instock', 'IN_STOCK'], ['https://schema.org/OutOfStock', 'OUT_OF_STOCK'], ['OutOfStock', 'OUT_OF_STOCK'], ['https://schema.org/SoldOut', 'OUT_OF_STOCK']])
    assert.equal(avail(raw).candidates[0].observation.stock, v, raw);
  for (const raw of ['https://schema.org/PreOrder', 'https://schema.org/BackOrder', 'https://schema.org/LimitedAvailability', 'https://schema.org/Discontinued', 'https://schema.org/InStoreOnly', 'https://schema.org/OnlineOnly', 'https://schema.org/PreSale', 'disponible', 'available', 'En stock', 'Peu de stock', 'oui', 'true', '', 'https://schema.org/']) {
    const r = avail(raw); assert.equal(r.candidates[0].observation.stock, 'UNKNOWN', raw); assert.ok(codes(r).includes(raw === '' ? 'availability_missing' : 'availability_not_mapped'), raw);
    if (raw) assert.equal(r.candidates[0].offers[0].availability.raw, raw, 'valeur brute conservée');
  }
  for (const bad of [true, 1, null, {}, [], ['InStock', 'OutOfStock']]) assert.equal(avail(bad).candidates[0].observation.stock, 'UNKNOWN', JSON.stringify(bad));
  // plusieurs offres : accord → valeur ; désaccord → inconnue et signalée
  const two = (a, b) => html(ldPage(prod({ offers: [{ '@type': 'Offer', price: '1', priceCurrency: 'XOF', availability: a }, { '@type': 'Offer', price: '1', priceCurrency: 'XOF', availability: b }] })));
  assert.equal(two('InStock', 'InStock').candidates[0].observation.stock, 'IN_STOCK'); const conflict = two('InStock', 'OutOfStock'); assert.equal(conflict.candidates[0].observation.stock, 'UNKNOWN'); assert.ok(codes(conflict).includes('availability_conflict'));
  // un titre ou un texte « en stock » ne prouve rien
  const t = html('<html><head><title>Sérum en stock - disponible immédiatement</title><meta property="og:title" content="Sérum en stock"></head><body>En stock ! Livraison au Bénin</body></html>'); assert.equal(t.status, 'NO_PRODUCT_DATA'); assert.deepEqual(t.candidates, []);
  const withTitle = html(ldPage(prod(), '<title>En stock</title>').replace('<title>t</title>', '')); assert.equal(withTitle.candidates[0].observation.stock, 'UNKNOWN');
});

test('EX-9 identifiants : absents = null ; jamais fabriqués ; GTIN invalide signalé, conflits conservés', () => {
  const none = html(ldPage(prod())); const c = none.candidates[0];
  assert.deepEqual([c.candidate.gtin, c.candidate.mpn, c.candidate.sku], [null, null, null]); assert.deepEqual([c.fields.gtin, c.fields.mpn, c.fields.sku], [null, null, null]);
  const inv = html(ldPage(prod({ gtin13: '5060000000017' }))); assert.equal(inv.candidates[0].candidate.gtin, '5060000000017'); assert.equal(inv.candidates[0].fields.gtin.valid, false); assert.ok(codes(inv).includes('gtin_invalid'));
  for (const bad of ['abc', '123', '12345678901234567', '', '5060000000016x', '50600 00000016']) { const r = html(ldPage(prod({ gtin: bad }))); const g = r.candidates[0].candidate.gtin; if (bad === '50600 00000016') assert.equal(g, '5060000000016'); else assert.equal(g, null, bad); }
  const same = html(ldPage(prod({ gtin13: '5060000000016', gtin: '05060000000016', gtin14: '05060000000016' }))); assert.equal(same.candidates[0].candidate.gtin !== null, true); assert.ok(!codes(same).includes('gtin_conflict'), 'GTIN-13 et GTIN-14 de même base : équivalents');
  const conf = html(ldPage(prod({ gtin13: '5060000000016', gtin12: '506000000002' }))); assert.equal(conf.candidates[0].candidate.gtin, null); assert.ok(codes(conf).includes('gtin_conflict')); assert.equal(conf.candidates[0].fields.gtin.explicitness, 'ambiguous'); assert.deepEqual(conf.candidates[0].fields.gtin.raw, ['506000000002', '5060000000016'], 'ordre de lecture : gtin, gtin8, gtin12, gtin13, gtin14');
  const offerGtin = html(ldPage(prod({ offers: { '@type': 'Offer', price: '1', priceCurrency: 'XOF', gtin13: '5060000000016' } }))); assert.equal(offerGtin.candidates[0].candidate.gtin, '5060000000016'); assert.match(offerGtin.candidates[0].fields.gtin.path, /offers\.gtin13$/);
  const skuOnly = html(ldPage(prod({ sku: 'ABC-1' }))); assert.equal(skuOnly.candidates[0].candidate.sku, 'ABC-1'); assert.equal(skuOnly.candidates[0].candidate.mpn, null); assert.equal(skuOnly.candidates[0].candidate.gtin, null); assert.ok(codes(skuOnly).includes('sku_only'), 'un SKU vendeur n\'est jamais pris pour un MPN ou un GTIN');
  const productId = html(ldPage(prod({ productID: 'gtin13:5060000000016', identifier: '5060000000016' }))); assert.equal(productId.candidates[0].candidate.gtin, null, 'productID et identifier ne sont pas interprétés');
  // le nom ne fournit jamais d'identifiant
  assert.equal(html(ldPage(prod({ name: 'Sérum 5060000000016 MPN TO-HA-30' }))).candidates[0].candidate.gtin, null);
  assert.equal(ext('product-full.html').candidates[0].fields.mpn.value, 'TO-HA-30');
});

test('EX-10 marque : lue seulement si déclarée ; jamais déduite du nom', () => {
  const none = html(ldPage(prod())); assert.equal(none.candidates[0].candidate.brand, null); assert.equal(none.candidates[0].fields.brand, null);
  const b = x => html(ldPage(prod({ brand: x }))).candidates[0];
  assert.equal(b('CeraVe').candidate.brand, 'CeraVe'); assert.equal(b({ '@type': 'Brand', name: 'La Roche-Posay' }).candidate.brand, 'La Roche-Posay'); assert.equal(b({ '@type': 'Organization', name: 'Vichy' }).candidate.brand, 'Vichy');
  assert.equal(b(['CeraVe', 'CeraVe']).candidate.brand, 'CeraVe');
  const multi = b(['CeraVe', 'Vichy']); assert.equal(multi.candidate.brand, null); assert.equal(multi.fields.brand.explicitness, 'ambiguous'); assert.ok(codes(html(ldPage(prod({ brand: ['CeraVe', 'Vichy'] })))).includes('field_multiple_values'));
  const ref = b({ '@id': 'https://boutique-essai.invalid/#brand' }); assert.equal(ref.candidate.brand, null); assert.ok(ref.issues.some(i => i.code === 'reference_unresolved'));
  for (const bad of ['', '   ', 5, true, {}, [], [null], { name: 5 }]) assert.equal(b(bad).candidate.brand, null, JSON.stringify(bad));
  // le nom commence par une marque connue : l'extracteur ne la déduit pas (c'est le rôle du matcher)
  assert.equal(html(ldPage(prod({ name: 'CeraVe Hydrating Cleanser' }))).candidates[0].candidate.brand, null);
});

test('EX-11 volume : lu seulement s\'il est déclaré ; jamais déduit du nom ; codes d\'unité en table fermée', () => {
  const v = size => html(ldPage(prod({ size }))).candidates[0];
  assert.equal(v('30 ml').candidate.volume, '30 ml'); assert.equal(v('30ml').candidate.volume, '30ml'); assert.equal(v('1 fl oz').candidate.volume, '1 fl oz');
  assert.deepEqual(v({ '@type': 'QuantitativeValue', value: 30, unitText: 'ml' }).candidate.volume, { value: 30, unit: 'ml' }); assert.equal(v({ value: 30, unitText: 'ml' }).fields.volume.explicitness, 'explicit');
  const code = v({ value: 30, unitCode: 'MLT' }); assert.deepEqual(code.candidate.volume, { value: 30, unit: 'ml' }); assert.equal(code.fields.volume.explicitness, 'normalized'); assert.equal(code.fields.volume.raw.unitCode, 'MLT');
  assert.deepEqual(v({ value: '50', unitCode: 'CLT' }).candidate.volume, { value: 50, unit: 'cl' });
  const unknownCode = v({ value: 30, unitCode: 'ZZZ' }); assert.equal(unknownCode.candidate.volume, null); assert.ok(unknownCode.issues.some(i => i.code === 'unit_code_unknown'));
  for (const bad of ['taille unique', 'grand format', '', '   ', 'M', '30', 'beaucoup', { value: 30 }, { unitText: 'ml' }, { value: 'trente', unitText: 'ml' }, { value: 30, unitText: 'parsecs' }, 30, true, []]) { const x = v(bad); assert.equal(x.candidate.volume, null, JSON.stringify(bad)); }
  assert.ok(v('taille unique').issues.some(i => i.code === 'volume_unparsed')); assert.equal(v('taille unique').fields.volume.raw, 'taille unique', 'valeur brute conservée');
  // propriété additionnelle nommée explicitement
  const add = html(ldPage(prod({ additionalProperty: [{ '@type': 'PropertyValue', name: 'Contenance', value: 30, unitText: 'ml' }] }))).candidates[0]; assert.deepEqual(add.candidate.volume, { value: 30, unit: 'ml' }); assert.match(add.fields.volume.path, /additionalProperty\[0\]$/);
  const other = html(ldPage(prod({ additionalProperty: [{ '@type': 'PropertyValue', name: 'Couleur', value: 'bleu' }] }))).candidates[0]; assert.equal(other.candidate.volume, null);
  // le volume écrit dans le nom n'est PAS extrait : le matcher le lit lui-même
  const inName = html(ldPage(prod({ name: 'The Ordinary Hyaluronic Acid 2% + B5 30ml' }))).candidates[0]; assert.equal(inName.candidate.volume, null); assert.equal(inName.fields.volume, null);
  // le poids n'est jamais pris pour un volume
  assert.equal(html(ldPage(prod({ weight: { value: 30, unitCode: 'GRM' } }))).candidates[0].candidate.volume, null);
  for (const [code, unit] of Object.entries(E.UNIT_CODES)) assert.ok(typeof unit === 'string' && /^[a-z]+$/.test(unit), code);
});

test('EX-12 plusieurs prix ou devises : conservés, signalés, aucun choisi', () => {
  const mp = ext('product-multi-price.html'); const c = mp.candidates[0];
  assert.equal(c.observation.price, null); assert.ok(codes(mp).includes('multiple_prices')); assert.equal(mp.issues.find(i => i.code === 'multiple_prices').severity, 'conflict');
  assert.deepEqual(c.offers.flatMap(o => o.prices.map(p => p.value)), [12700, 9900], 'toutes les valeurs restent disponibles, dans l\'ordre de la page');
  const mc = ext('product-multi-currency.html'); assert.equal(mc.candidates[0].observation.price, null); assert.ok(codes(mc).includes('multiple_currencies')); assert.deepEqual(mc.candidates[0].offers.flatMap(o => o.prices.map(p => p.currency)), ['XOF', 'EUR']);
  const rng = ext('product-aggregate-range.html'); assert.equal(rng.candidates[0].observation.price, null); assert.ok(codes(rng).includes('price_range')); assert.equal(rng.candidates[0].offers[0].kind, 'aggregate');
  const same = html(ldPage(prod({ offers: [{ '@type': 'Offer', price: '12700', priceCurrency: 'XOF' }, { '@type': 'Offer', price: 12700, priceCurrency: 'XOF' }] }))); assert.deepEqual(same.candidates[0].observation.price, { amount: 12700, currency: 'XOF', basis: 'displayed' }, 'même prix répété : pas de contradiction');
  const degenerate = html(ldPage(prod({ offers: { '@type': 'AggregateOffer', lowPrice: '5000', highPrice: '5000', priceCurrency: 'XOF' } }))); assert.equal(degenerate.candidates[0].observation.price.amount, 5000);
  const specs = html(ldPage(prod({ offers: { '@type': 'Offer', priceSpecification: [{ '@type': 'UnitPriceSpecification', price: '12700', priceCurrency: 'XOF' }, { '@type': 'UnitPriceSpecification', price: '15000', priceCurrency: 'XOF' }] } }))); assert.equal(specs.candidates[0].observation.price, null); assert.ok(codes(specs).includes('multiple_price_specifications')); assert.ok(codes(specs).includes('multiple_prices'));
  const nested = html(ldPage(prod({ offers: { '@type': 'AggregateOffer', priceCurrency: 'XOF', lowPrice: '1', highPrice: '9', offers: [{ '@type': 'Offer', price: '5', priceCurrency: 'XOF' }] } }))); assert.equal(nested.candidates[0].observation.price, null, 'fourchette + offre : pas de prix unique');
  const one = html(ldPage(prod({ offers: { '@type': 'Offer', priceSpecification: { price: '700', priceCurrency: 'XOF' } } }))); assert.equal(one.candidates[0].observation.price.amount, 700);
  const many = html(ldPage(prod({ offers: Array.from({ length: 80 }, (_, i) => ({ '@type': 'Offer', price: String(i + 1), priceCurrency: 'XOF' })) }))); assert.equal(many.candidates[0].offers.length, E.LIMITS.maxOffers); assert.ok(codes(many).includes('offers_truncated'));
});

test('EX-13 contenu sans données produit : résultat explicite, un titre de page ne fait pas un produit', () => {
  for (const name of ['no-product.html', 'non-product.json']) { const r = ext(name); assert.equal(r.status, 'NO_PRODUCT_DATA', name); assert.deepEqual(r.candidates, []); assert.equal(r.primary, null); assert.ok(codes(r).includes('no_product_data')); }
  const t = ext('no-product.html'); assert.equal(t.page.title.value, 'Article de blog', 'le titre reste disponible comme information de page'); assert.ok(codes(t).includes('jsonld_no_product'));
  assert.ok(codes(ext('non-product.json')).includes('json_not_jsonld'));
  for (const body of ['', ' ', '<html></html>', 'texte brut', '<title>Seulement un titre</title>', '<script>var x = 1</script>', '<meta property="og:title" content="Titre seul">', '{"@type":"Product","name":"dans du HTML sans balise script"}']) { const r = html(body); assert.equal(r.status, 'NO_PRODUCT_DATA', JSON.stringify(body)); assert.deepEqual(r.candidates, []); }
  assert.equal(html('<meta property="og:type" content="website"><meta property="og:title" content="Accueil">').status, 'NO_PRODUCT_DATA');
});

test('EX-14 HTML malformé : jamais d\'exception, anomalies signalées, rien d\'inventé', () => {
  const m = ext('malformed.html'); assert.equal(m.status, 'NO_PRODUCT_DATA'); assert.ok(codes(m).includes('html_malformed')); assert.ok(codes(m).includes('jsonld_unterminated'));
  const cases = ['<', '<<<<', '<script', '<script type="application/ld+json"', '<script type="application/ld+json">', '<meta', '<meta property="og:title" content="', '<link rel="canonical" href=', '</script></script>', '<script type=\'application/ld+json\'>{}</scr',
    '<title>', '<title>a', '<!--', '<!-- <script type="application/ld+json">{"@type":"Product","name":"commenté"}</script> -->', '<scr<script>ipt>', '\u0000\u0000', '&#x110000;&#99999999;', '<div ' + 'a="b" '.repeat(5000)];
  for (const b of cases) { let r; assert.doesNotThrow(() => { r = html(b); }, JSON.stringify(b.slice(0, 40))); assert.ok(['NO_PRODUCT_DATA', 'PRODUCT_DATA'].includes(r.status)); }
  // troncature de la page complète à de nombreux endroits : tout champ présent est exact, aucun champ n'est inventé
  const full = fx('product-full.html'); let withProduct = 0;
  for (let n = 0; n <= full.length; n += 13) {
    const r = html(full.slice(0, n)); for (const c of r.candidates) { withProduct++; if (c.candidate.title !== null) assert.equal(c.candidate.title, 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides'); if (c.observation.price) assert.deepEqual(c.observation.price, { amount: 12700, currency: 'XOF', basis: 'displayed' }); if (c.candidate.gtin) assert.equal(c.candidate.gtin, '5060000000016'); }
  }
  assert.ok(withProduct > 5);
  // attributs sans guillemets, en majuscules, avec espaces
  const odd = html('<SCRIPT TYPE=application/ld+json>' + JSON.stringify(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF' } })) + '</SCRIPT><LINK REL=canonical HREF=/x>'); assert.equal(odd.status, 'PRODUCT_DATA'); assert.equal(odd.page.canonicalUrl.value, 'https://boutique-essai.invalid/x');
});

test('EX-15 URL canonique : lue telle quelle, comparée sans conséquence ; n\'établit ni disponibilité ni livraison', () => {
  const none = html(ldPage(prod())); assert.equal(none.page.canonicalUrl, null); assert.ok(codes(none).includes('canonical_missing'));
  const rel = html(ldPage(prod(), '<link rel="canonical" href="/p/ha?a=1">')); assert.equal(rel.page.canonicalUrl.value, 'https://boutique-essai.invalid/p/ha?a=1'); assert.equal(rel.page.canonicalUrl.explicitness, 'normalized'); assert.equal(rel.page.canonicalUrl.raw, '/p/ha?a=1');
  const noBase = E.extract({ ok: true, body: ldPage(prod(), '<link rel="canonical" href="/p/ha">'), contentType: 'text/html' }); assert.equal(noBase.page.canonicalUrl.value, null); assert.ok(codes(noBase).includes('canonical_invalid'), 'relative sans URL de base : non résoluble, rien d\'inventé');
  const abs = html(ldPage(prod(), '<link rel="canonical" href="' + URL_P + '">')); assert.equal(abs.page.canonicalUrl.explicitness, 'explicit'); assert.ok(!codes(abs).includes('canonical_differs_from_final'));
  const cross = html(ldPage(prod(), '<link rel="canonical" href="https://autre-site.invalid/p">')); assert.ok(codes(cross).includes('canonical_cross_host')); assert.equal(cross.page.canonicalUrl.value, 'https://autre-site.invalid/p');
  const diff = html(ldPage(prod(), '<link rel="canonical" href="https://boutique-essai.invalid/autre">')); assert.ok(codes(diff).includes('canonical_differs_from_final'));
  const multi = html(ldPage(prod(), '<link rel="canonical" href="/a"><link rel="canonical" href="/b">')); assert.equal(multi.page.canonicalUrl.value, null); assert.ok(codes(multi).includes('field_multiple_values'));
  const rels = html(ldPage(prod(), '<link rel="alternate canonical" href="/z">')); assert.equal(rels.page.canonicalUrl.value, 'https://boutique-essai.invalid/z');
  assert.ok(codes(html(ldPage(prod(), '<base href="https://ailleurs.invalid/">'))).includes('base_tag_present'));
  assert.equal(html(ldPage(prod(), '<link rel="stylesheet" href="/c.css">')).page.canonicalUrl, null);
  // la canonique ne change ni le stock ni le prix ni la livraison
  const a = html(ldPage(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF' } }), '<link rel="canonical" href="/p">')), b = html(ldPage(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF' } })));
  assert.deepEqual(a.candidates[0].observation, b.candidates[0].observation); assert.deepEqual(a.candidates[0].delivery, b.candidates[0].delivery);
});

test('EX-16 livraison : aucune preuve vers un pays cible sans déclaration explicite ; une déclaration brute n\'est jamais une preuve', () => {
  const none = ext('product-full.html'); const d = none.candidates[0].delivery;
  assert.deepEqual(d.declaredDestinations, []); assert.ok(codes(none).includes('delivery_evidence_none'));
  const keys = keysDeep(none); assert.ok(!keys.has('shipsTo') && !keys.has('explicit'), 'aucun shipsTo fabriqué');
  const dec = ext('delivery-declared.html'); const dd = dec.candidates[0].delivery;
  assert.deepEqual(dd.declaredDestinations.map(x => x.country), ['TG'], 'seul le code pays lisible est relevé ; « Afrique de l\'Ouest » ne devient pas une liste de pays'); assert.equal(dd.declaredDestinations[0].explicitness, 'declared'); assert.ok(codes(dec).includes('delivery_destination_unparsed'));
  assert.ok(!dd.declaredDestinations.some(x => x.country === 'BJ'), 'aucune livraison vers le Bénin sans déclaration');
  assert.ok(!keysDeep(dec).has('shipsTo'), 'une déclaration n\'est pas transformée en livraison confirmée'); assert.match(dd.note, /jamais une preuve/);
  // texte libre : livraison mentionnée dans la page, jamais extraite
  const text = html(ldPage(prod()) + '<p>Livraison partout au Bénin, au Togo et en Côte d\'Ivoire</p>'); assert.deepEqual(text.candidates[0].delivery.declaredDestinations, []);
  const text2 = html(ldPage(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF', description: 'Livraison au Bénin' } }))); assert.deepEqual(text2.candidates[0].delivery.declaredDestinations, []);
  // aucun pays de vendeur n'est jamais produit
  const all = JSON.stringify(ext('product-full.html', { finalUrl: 'https://boutique-essai.bj/ha' }).candidates[0]); assert.ok(!/"sellerCountry"|"country"/.test(all), 'ni pays de vendeur ni pays déduit du domaine .bj');
  assert.equal(ext('product-full.html', { finalUrl: 'https://boutique-essai.bj/ha' }).candidates[0].offers[0].prices[0].currency, 'XOF', 'la devise vient du JSON-LD, pas du domaine');
});

test('EX-17 plusieurs produits dans une page : tous conservés, aucun choisi', () => {
  const r = ext('listing-multi-products.html');
  assert.equal(r.status, 'PRODUCT_DATA'); assert.equal(r.candidates.length, 3); assert.equal(r.primary, null); assert.ok(codes(r).includes('multiple_products')); assert.equal(r.issues.find(i => i.code === 'multiple_products').severity, 'conflict');
  assert.deepEqual(r.candidates.map(c => c.candidate.title), ['Produit A', 'Produit B', 'Produit C']); assert.deepEqual(r.candidates.map(c => c.observation.price.amount), [1000, 2000, 3000]); assert.deepEqual(r.candidates.map(c => c.index), [0, 1, 2]);
  assert.ok(r.candidates.every(c => /^jsonld\[0\]\.itemListElement\[\d\]\.item$/.test(c.path)));
  assert.equal(ext('product-full.html').primary, 0);
  const many = html(ldPage(Array.from({ length: 120 }, (_, i) => ({ '@type': 'Product', name: 'P' + i })))); assert.equal(many.candidates.length, E.LIMITS.maxCandidates); assert.ok(codes(many).includes('too_many_candidates'));
});

test('EX-18 métadonnées : secours explicite sans JSON-LD ; recoupement et contradictions avec le JSON-LD ; aucun champ complété en silence', () => {
  const m = ext('meta-only-product.html'); const c = m.candidates[0];
  assert.equal(c.origin, 'meta'); assert.deepEqual(c.candidate, { title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides', brand: 'The Ordinary', description: null, volume: null, gtin: null, mpn: null, sku: null });
  assert.equal(c.fields.name.source, 'meta'); assert.match(c.fields.name.path, /^meta\[og:title\]/); assert.deepEqual(c.observation, { price: { amount: 12700, currency: 'XOF', basis: 'displayed' }, stock: 'IN_STOCK', url: { href: URL_P } });
  const conflict = ext('meta-conflict.html'); const k = conflict.candidates[0];
  assert.equal(k.origin, 'json-ld'); assert.equal(k.observation.price, null, 'prix contradictoire : aucun retenu'); assert.equal(k.observation.stock, 'UNKNOWN'); assert.ok(codes(conflict).includes('price_source_conflict')); assert.ok(codes(conflict).includes('availability_source_conflict'));
  assert.equal(k.offers[0].prices[0].value, 12700, 'la valeur JSON-LD reste consultable');
  // devise en désaccord
  const cur = html(ldPage(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF' } }), '<meta property="og:type" content="product"><meta property="product:price:amount" content="5"><meta property="product:price:currency" content="EUR">')); assert.ok(codes(cur).includes('currency_source_conflict')); assert.equal(cur.candidates[0].observation.price, null);
  // accord entre sources : rien à signaler
  const agree = html(ldPage(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF', availability: 'InStock' } }), '<meta property="product:price:amount" content="5"><meta property="product:price:currency" content="XOF"><meta property="product:availability" content="instock">')); assert.ok(!codes(agree).some(x => /source_conflict/.test(x))); assert.equal(agree.candidates[0].observation.price.amount, 5);
  // la marque des métadonnées ne complète pas un JSON-LD sans marque
  const noFill = html(ldPage(prod(), '<meta property="product:brand" content="CeraVe">')); assert.equal(noFill.candidates[0].candidate.brand, null);
  // métadonnées partielles
  const partial = html('<meta property="og:type" content="product"><meta property="og:title" content="X">'); assert.equal(partial.candidates[0].observation.price, null); assert.equal(partial.candidates[0].observation.stock, 'UNKNOWN');
  const noTitle = html('<meta property="og:type" content="product"><meta property="product:price:amount" content="5">'); assert.equal(noTitle.status, 'NO_PRODUCT_DATA', 'sans titre, pas de fiche');
  const priceNoCur = html('<meta property="og:type" content="product"><meta property="og:title" content="X"><meta property="product:price:amount" content="5">'); assert.equal(priceNoCur.candidates[0].observation.price, null); assert.ok(codes(priceNoCur).includes('price_without_currency'));
  const twoPrices = html('<meta property="og:type" content="product"><meta property="og:title" content="X"><meta property="product:price:amount" content="5"><meta property="product:price:amount" content="6"><meta property="product:price:currency" content="XOF">'); assert.equal(twoPrices.candidates[0].observation.price, null); assert.ok(codes(twoPrices).includes('field_multiple_values'));
});

test('EX-19 contenu JSON, types non pris en charge, entrées invalides', () => {
  const j = ext('standalone-product.json'); assert.equal(j.status, 'PRODUCT_DATA'); assert.equal(j.candidates[0].path, 'json'); assert.equal(j.candidates[0].observation.price.amount, 12700); assert.deepEqual(j.page.openGraph, {});
  assert.equal(E.extract({ ok: true, body: fx('standalone-product.json'), contentType: 'application/ld+json; charset=utf-8', finalUrl: URL_P }).status, 'PRODUCT_DATA');
  assert.equal(E.extract({ ok: true, body: '{"@type":"Product",', contentType: 'application/json' }).status, 'NO_PRODUCT_DATA');
  for (const ct of ['text/plain', 'image/png', 'application/pdf', 'application/xml', 'text/css', 'application/octet-stream']) { const r = E.extract({ ok: true, body: fx('product-full.html'), contentType: ct, finalUrl: URL_P }); assert.equal(r.status, 'UNSUPPORTED', ct); assert.deepEqual(r.candidates, []); assert.ok(codes(r).includes('content_type_unsupported')); }
  const unknownType = E.extract({ ok: true, body: fx('product-full.html'), finalUrl: URL_P }); assert.equal(unknownType.status, 'PRODUCT_DATA'); assert.ok(codes(unknownType).includes('content_type_unknown'));
  for (const bad of [undefined, null, 0, 'x', [], {}, { ok: false, body: fx('product-full.html') }, { ok: true }, { ok: true, body: 5 }, { ok: true, body: null }, { ok: false, failure: { code: 'timeout' }, body: null }]) { let r; assert.doesNotThrow(() => { r = E.extract(bad); }); assert.equal(r.status, 'INVALID_INPUT', JSON.stringify(bad)); assert.deepEqual(r.candidates, []); assert.ok(codes(r).includes('input_invalid')); }
  const huge = E.extract({ ok: true, body: 'x'.repeat(E.LIMITS.maxChars + 1), contentType: 'text/html' }); assert.equal(huge.status, 'INVALID_INPUT'); assert.ok(codes(huge).includes('input_too_large'));
});

test('EX-20 limites et coût borné : JSON-LD géant, imbrication profonde, milliers de balises, entrées hostiles', () => {
  const t0 = Date.now();
  const bigBlock = '<script type="application/ld+json">' + '{"@type":"Product","name":"' + 'a'.repeat(E.LIMITS.maxJsonLdChars) + '"}</script>'; const big = html(bigBlock); assert.equal(big.status, 'NO_PRODUCT_DATA'); assert.ok(codes(big).includes('jsonld_invalid'));
  let deep = { '@type': 'Product', name: 'P' }; for (let i = 0; i < 60; i++) deep = { '@type': 'WebPage', mainEntity: deep }; const d = html(ldPage(deep)); assert.equal(d.status, 'NO_PRODUCT_DATA'); assert.ok(codes(d).includes('jsonld_traversal_limit'));
  const wide = { '@graph': Array.from({ length: E.LIMITS.maxNodes + 100 }, (_, i) => ({ '@type': 'Thing', name: 'n' + i })) }; assert.ok(codes(html(ldPage(wide))).includes('jsonld_traversal_limit'));
  const manyMeta = html('<meta property="og:title" content="x">'.repeat(E.LIMITS.maxMetaTags + 50)); assert.ok(codes(manyMeta).includes('html_tag_limit'));
  const manyScripts = html('<script type="application/ld+json">{}</script>'.repeat(200)); assert.equal(manyScripts.stats.jsonLdBlocks, 200);
  for (const evil of ['<script ' .repeat(50000), '<'.repeat(200000), '<meta ' + 'a='.repeat(100000), '<script type="application/ld+json">' + '['.repeat(100000), '&#'.repeat(100000), '<link rel="canonical" href="' + 'a'.repeat(1000000) + '">']) assert.doesNotThrow(() => html(evil));
  assert.ok(Date.now() - t0 < 8000, 'entrées hostiles traitées en temps borné : ' + (Date.now() - t0) + ' ms');
});

test('EX-21 contrat de sortie stable, sérialisable, déterministe ; chaque anomalie est dans la table fermée', () => {
  const names = fs.readdirSync(DIR).sort();
  assert.ok(names.length >= 15);
  for (const n of names) {
    const r = ext(n), again = ext(n);
    assert.deepEqual(r, again, n + ' : déterministe'); assert.deepEqual(JSON.parse(JSON.stringify(r)), r, n + ' : sérialisable sans perte');
    assert.deepEqual(Object.keys(r), ['schema', 'status', 'source', 'page', 'candidates', 'primary', 'issues', 'stats']); assert.ok(['PRODUCT_DATA', 'NO_PRODUCT_DATA', 'UNSUPPORTED', 'INVALID_INPUT'].includes(r.status));
    for (const i of r.issues) { assert.ok(E.ISSUES[i.code], n + ' : anomalie connue ' + i.code); assert.equal(i.severity, E.ISSUES[i.code][0]); assert.equal(i.message, E.ISSUES[i.code][1]); }
    for (const c of r.candidates) {
      assert.deepEqual(Object.keys(c).sort(), ['candidate', 'delivery', 'fields', 'index', 'issues', 'observation', 'offers', 'origin', 'path']);
      assert.deepEqual(Object.keys(c.candidate), ['title', 'brand', 'description', 'volume', 'gtin', 'mpn', 'sku']); assert.deepEqual(Object.keys(c.observation), ['price', 'stock', 'url']); assert.ok(['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'].includes(c.observation.stock));
      for (const f of Object.values(c.fields)) if (f) { assert.ok(['json-ld', 'meta', 'html-title', 'link-canonical'].includes(f.source)); assert.ok(['explicit', 'normalized', 'ambiguous'].includes(f.explicitness)); assert.equal(typeof f.path, 'string'); }
      for (const o of c.offers) for (const p of o.prices) assert.ok(['explicit', 'ambiguous'].includes(p.explicitness));
    }
  }
  for (const [code, [sev, msg]] of Object.entries(E.ISSUES)) { assert.ok(['info', 'warning', 'conflict', 'error'].includes(sev), code); assert.ok(msg.length > 5, code); }
  const order = ['conflict', 'error', 'warning', 'info']; const r = ext('meta-conflict.html'); const sevs = r.issues.map(i => order.indexOf(i.severity)); assert.deepEqual(sevs, sevs.slice().sort((a, b) => a - b), 'conflits en premier');
});

test('EX-22 provenance : chaque chemin retrouve la valeur brute dans le JSON-LD de la page', () => {
  const walk = (root, p) => { const toks = []; p.replace(/(?:^|\.)([^.[\]]+)|\[(\d+)\]/g, (m, k, i) => { toks.push(k !== undefined ? k : Number(i)); return m; }); let cur = root; for (const t of toks) { if (cur === undefined || cur === null) return undefined; cur = cur[t]; } return cur; };
  for (const name of ['product-full.html', 'product-graph-multi-blocks.html', 'product-multi-price.html', 'listing-multi-products.html', 'delivery-declared.html', 'product-price-formats.html']) {
    const body = fx(name), blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => { try { return JSON.parse(m[1]); } catch (e) { return null; } });
    const r = ext(name); let checked = 0;
    for (const c of r.candidates) {
      const resolve = p => { const m = /^jsonld\[(\d+)\]\.?(.*)$/.exec(p); if (!m) return undefined; const rest = m[2]; return rest ? walk(blocks[Number(m[1])], rest) : blocks[Number(m[1])]; };
      for (const f of Object.values(c.fields)) if (f && f.path && f.source === 'json-ld') { const found = resolve(f.path); if (Array.isArray(f.raw) || (f.raw && typeof f.raw === 'object')) assert.deepEqual(found, Array.isArray(f.raw) && f.path.match(/gtin/) ? found : f.raw, name + ' ' + f.path); else assert.equal(found, f.raw, name + ' ' + f.path); checked++; }
      for (const o of c.offers) for (const p of o.prices) { assert.equal(resolve(p.path), p.raw, name + ' ' + p.path); checked++; }
      assert.ok(resolve(c.path), name + ' chemin du produit ' + c.path);
    }
    assert.ok(checked > 0, name);
  }
});

test('EX-23 bout en bout hors ligne : safe-fetch simulé → extracteur → matcher → observation → confiance → classification ; l\'extraction seule ne produit jamais LOCAL', async () => {
  const body = fx('product-full.html'), ADDR = '93.184.216.34';
  const deps = { resolve: async () => [{ address: ADDR, family: 4 }], request: async call => ({ statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from(body)]), remoteAddress: call.address, abort() {} }), now: () => 0 };
  const fetched = await S.fetchPage(URL_P, { deps }); assert.equal(fetched.ok, true);
  const x = E.extract(fetched); assert.equal(x.status, 'PRODUCT_DATA'); assert.equal(x.source.finalUrl, URL_P); assert.equal(x.source.contentType, 'text/html'); const c = x.candidates[0];
  const match = M.matchCandidate(c.candidate, HA, { productId: 'to-hyaluronic-b5-ceramides' }); assert.equal(match.valid, true); assert.equal(match.matchClass, 'EXACT_MATCH', 'décidé par le matcher, pas par l\'extracteur');
  // l'appelant assemble l'observation : vendeur et source relèvent de lui, pas de la page
  const base = Object.assign({ id: 'essai', match, seller: { name: 'Boutique Essai' }, source: { kind: 'seller_page', reopened: true }, checkedAt: '2026-10-08', method: 'safe-fetch simulé' }, c.observation);
  const n = O.normalizeObservation(base); assert.deepEqual(n.issues, [], 'les champs de l\'extracteur sont lus par observation.js sans anomalie'); assert.equal(n.observation.price.amount, 12700); assert.equal(n.observation.price.currency, 'XOF'); assert.equal(n.observation.stock, 'IN_STOCK'); assert.equal(n.observation.url.href, URL_P);
  const conf = C.assess(base, { now: '2026-10-08' }); assert.equal(conf.dimensions.product.level, 'HIGH'); assert.equal(conf.dimensions.price.level, 'HIGH'); assert.equal(conf.dimensions.stock.level, 'HIGH'); assert.equal(conf.dimensions.url.level, 'UNKNOWN', 'l\'extracteur ne déclare pas « fiche produit » : le type d\'adresse reste à établir'); assert.equal(conf.dimensions.market.level, 'UNKNOWN');
  const market = K.classify({ targetCountry: 'BJ', observation: base }); assert.equal(market.status, 'UNKNOWN'); assert.equal(market.reasonCodes[0], 'MARKET_COUNTRY_UNKNOWN', 'aucun pays de vendeur n\'est extrait de la page');
  // même avec un domaine .bj, une devise XOF, une livraison déclarée et une canonique : toujours inconnu tant qu\'un pays de vendeur n\'est pas établi par ailleurs
  const bj = E.extract({ ok: true, body: fx('delivery-declared.html'), contentType: 'text/html', finalUrl: 'https://boutique-essai.bj/ha' }).candidates[0];
  const obs2 = Object.assign({ id: 'e2', match, seller: { name: 'Boutique Essai' } }, bj.observation); assert.equal(K.classify({ targetCountry: 'BJ', observation: obs2 }).status, 'UNKNOWN'); assert.equal(K.classify({ targetCountry: 'TG', observation: obs2 }).status, 'UNKNOWN');
  // un résultat de récupération en échec n'est jamais extrait
  const failed = await S.fetchPage('http://boutique-essai.invalid/', { deps }); assert.equal(failed.ok, false); const xf = E.extract(failed); assert.equal(xf.status, 'INVALID_INPUT'); assert.deepEqual(xf.candidates, []);
});

test('EX-24 commentaires et scripts : une donnée commentée ou enfouie dans un script n\'est pas lue', () => {
  const live = JSON.stringify(prod({ offers: { '@type': 'Offer', price: '5', priceCurrency: 'XOF' } }));
  const commented = html('<html><head><title>t</title><!-- <script type="application/ld+json">' + live + '</script> --></head></html>'); assert.equal(commented.status, 'NO_PRODUCT_DATA'); assert.equal(commented.stats.jsonLdBlocks, 0);
  const both = html('<!-- <script type="application/ld+json">{"@type":"Product","name":"Ancien"}</script> --><script type="application/ld+json">' + live + '</script>'); assert.equal(both.candidates.length, 1); assert.equal(both.candidates[0].candidate.title, 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides');
  const meta = html('<!-- <meta property="og:type" content="product"><meta property="og:title" content="Commenté"> -->'); assert.equal(meta.status, 'NO_PRODUCT_DATA');
  const canon = html(ldPage(prod(), '<!-- <link rel="canonical" href="/ancien"> --><link rel="canonical" href="/actuel">')); assert.equal(canon.page.canonicalUrl.value, 'https://boutique-essai.invalid/actuel');
  const inScript = html('<script>var tpl = \'<meta property="og:type" content="product"><meta property="og:title" content="Dans un script"><link rel="canonical" href="/piege">\';</script>'); assert.equal(inScript.status, 'NO_PRODUCT_DATA'); assert.equal(inScript.page.canonicalUrl, null);
  const jsCommentLike = html('<script>/* <!-- */ var a = 1;</script><script type="application/ld+json">' + live + '</script>'); assert.equal(jsCommentLike.candidates.length, 1, 'un « <!-- » à l\'intérieur d\'un script n\'ouvre pas de commentaire : le texte d\'un script est opaque');
  const unterminated = html('<!-- jamais refermé <script type="application/ld+json">' + live + '</script>'); assert.equal(unterminated.status, 'NO_PRODUCT_DATA'); assert.ok(codes(unterminated).includes('html_malformed'));
  const order = html('<script type="application/ld+json">{"@type":"Product","name":"A"}</script><script type="application/ld+json">{"@type":"Product","name":"B"}</script><script type="application/ld+json">{"@type":"Product","name":"C"}</script>'); assert.deepEqual(order.candidates.map(c => c.candidate.title), ['A', 'B', 'C'], 'ordre du document conservé');
  const t = Date.now(); assert.doesNotThrow(() => html('<!--'.repeat(100000) + '<script '.repeat(50000))); assert.ok(Date.now() - t < 3000);
});
