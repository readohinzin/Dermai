'use strict';
/* Phase 3B-2 : identités des produits du catalogue (data/market/identities.json + tools/market/identity.js).
   Aucune identité n'est inventée : les champs dérivés doivent être égaux à ce que le catalogue donne ; les champs sourcés doivent citer un extrait retrouvé tel quel dans le catalogue.
   Le catalogue peut grandir : seuls les produits historiques doivent avoir une identité, un produit nouveau sans identité ne casse aucun test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I = require('../tools/market/identity.js');
const A = require('../tools/market/attributes.js');
const N = require('../tools/market/normalize.js');
const CAT = require('../js/engine/data/catalog.js');
const ACTIVES = require('../js/engine/data/actives.js').ACTIVES.map(a => a.id);

const ROOT = path.join(__dirname, '..');
const FILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/identities.json'), 'utf8'));
const PRODUCTS = CAT.PRODUCTS, byId = id => PRODUCTS.find(p => p.id === id);
const clone = o => JSON.parse(JSON.stringify(o));
const ctx = { products: PRODUCTS, activeIds: ACTIVES };
const HISTORICAL = ['to-salicylic-2-solution', 'to-niacinamide-10-zinc-1', 'to-azelaic-acid-10', 'to-ascorbyl-glucoside-12', 'to-mandelic-acid-10-ha', 'to-hyaluronic-b5-ceramides', 'cerave-hydrating-ha-serum',
  'cerave-blemish-control-gel', 'cerave-skin-renewing-vitamin-c-serum', 'lrp-effaclar-duo-m', 'lrp-cicaplast-baume-b5-plus', 'lrp-pure-vitamin-c10-serum', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum'];
const ident = id => FILE.products[id];

test('ID-1 les 14 produits historiques ont une identité ; aucune identité ne vise un produit inexistant ; chaque productId est unique', () => {
  for (const id of HISTORICAL) assert.ok(ident(id), id + ' : identité manquante');
  assert.equal(HISTORICAL.length, 14);
  const keys = Object.keys(FILE.products);
  assert.equal(new Set(keys).size, keys.length, 'ids uniques');
  for (const k of keys) assert.ok(byId(k), k + ' : produit absent du catalogue');
  assert.equal(FILE.version, I.IDENTITY_VERSION);
  assert.deepEqual(I.validateIdentityFile(FILE, ctx), []);
});

test('ID-2 les champs dérivés sont exactement ceux du catalogue (marque, nom, volume, variante, actifs, concentrations) : rien d\'ajouté, rien de retouché', () => {
  for (const [id, identity] of Object.entries(FILE.products)) assert.deepEqual(I.derivedPart(identity), I.deriveIdentity(byId(id)), id);
  for (const [id, identity] of Object.entries(FILE.products)) {
    const p = byId(id);
    assert.equal(identity.brand.canonical, p.brand, id); assert.ok(p.name.startsWith(identity.name.canonical), id + ' : nom canonique = début du nom du catalogue');
    assert.deepEqual(identity.attributes.actives.map(a => a.activeId), p.ingredients.filter(i => i.activeId).map(i => i.activeId), id + ' : mêmes actifs que le catalogue');
  }
});

test('ID-3 volumes et concentrations structurés et valides ; les données absentes restent absentes', () => {
  for (const [id, x] of Object.entries(FILE.products)) {
    const p = byId(id);
    if (p.format) { assert.ok(x.volume, id); assert.ok(x.volume.value > 0 && ['ml', 'g'].includes(x.volume.normalized.unit), id); assert.equal(`${x.volume.value} ${x.volume.unit}`, p.format, id + ' : volume = format du catalogue'); }
    else assert.equal(x.volume, null, id + ' : pas de format au catalogue → volume null');
    for (const c of x.attributes.concentrations) { assert.ok(c.percentage > 0 && c.percentage <= 100, id); assert.ok(c.activeId === null || ACTIVES.includes(c.activeId), id); assert.ok(c.sources.length > 0, id); }
  }
  // le volume du catalogue vaut 30 ml pour la plupart : valeur lue, pas supposée ; Vichy n'a aucun format → null + indice NON vérifié
  const v = ident('vichy-liftactiv-vitamin-c-serum');
  assert.equal(v.volume, null); assert.equal(v.volumeHints.length, 1); assert.equal(v.volumeHints[0].status, 'unverified'); assert.equal(v.volumeHints[0].value, 20);
  // concentrations vérifiées sur des cas connus, avec réserves conservées
  const conc = id => ident(id).attributes.concentrations.map(c => `${c.ingredient}:${c.percentage}`);
  assert.deepEqual(conc('to-niacinamide-10-zinc-1'), ['niacinamide:10', 'zinc:1']); assert.deepEqual(conc('to-salicylic-2-solution'), ['salicylic acid:2']);
  assert.deepEqual(conc('to-hyaluronic-b5-ceramides'), ['hyaluronic acid:2']); assert.deepEqual(conc('cerave-hydrating-ha-serum'), [], 'aucun pourcentage écrit : liste vide');
  assert.deepEqual(conc('lrp-pure-vitamin-c10-serum'), [], '« C10 » n\'est pas lu comme 10 % : non écrit');
  const eff = ident('lrp-effaclar-duo-m').attributes.concentrations[0]; assert.equal(eff.percentage, 0.5); assert.deepEqual(eff.qualifiers, ['us_sheet', 'to_confirm']);
  assert.deepEqual(ident('cerave-skin-renewing-vitamin-c-serum').attributes.concentrations[0].qualifiers, ['per_brand']);
});

test('ID-4 aucun GTIN / MPN / SKU inventé : tous null, et un identifiant renseigné exigerait sa source', () => {
  for (const [id, x] of Object.entries(FILE.products)) assert.deepEqual(x.identifiers, { gtin: null, mpn: null, sku: null }, id);
  const base = clone(ident('to-niacinamide-10-zinc-1'));
  for (const k of ['gtin', 'mpn', 'sku']) {
    assert.ok(I.validateIdentity(Object.assign(clone(base), { identifiers: Object.assign({ gtin: null, mpn: null, sku: null }, { [k]: '123' }) }), { activeIds: ACTIVES }).length, k + ' : valeur nue refusée');
    assert.ok(I.validateIdentity(Object.assign(clone(base), { identifiers: Object.assign({ gtin: null, mpn: null, sku: null }, { [k]: { value: '5060123456789', source: '' } }) }), { activeIds: ACTIVES }).length, k + ' : source vide refusée');
  }
  const withGtin = Object.assign(clone(base), { identifiers: { gtin: { value: '5060123456789', source: 'fiche fabricant (test)' }, mpn: null, sku: null } });
  assert.deepEqual(I.validateIdentity(withGtin, { activeIds: ACTIVES }), [], 'avec valeur ET source : accepté (le schéma est prêt)');
  assert.ok(I.validateIdentity(Object.assign(clone(base), { identifiers: { gtin: { value: '12', source: 's' }, mpn: null, sku: null } }), { activeIds: ACTIVES }).some(m => /gtin/.test(m)));
});

test('ID-5 variantes non générées arbitrairement : une seule variante, celle écrite dans le nom du catalogue', () => {
  const withVariant = Object.entries(FILE.products).filter(([, x]) => x.variant !== null);
  assert.deepEqual(withVariant.map(([id, x]) => [id, x.variant.id, x.variant.exactness, x.variant.source]), [['to-hyaluronic-b5-ceramides', 'with_ceramides', 'explicit', 'name']]);
  assert.equal(ident('to-hyaluronic-b5-ceramides').variant.raw, 'with Ceramides');
  for (const [id, x] of Object.entries(FILE.products)) if (x.variant) assert.ok(byId(id).name.includes('(' + x.variant.raw + ')'), id + ' : la variante est écrite entre parenthèses dans le nom');
  // les mots de variante qui font partie d'un NOM de gamme sont déclarés, pas pris pour une variante du produit
  assert.deepEqual(ident('lrp-effaclar-duo-m').name.variantTerms, ['duo']); assert.equal(ident('lrp-effaclar-duo-m').variant, null);
});

test('ID-6 produits frères : seulement ceux que le catalogue énonce, chacun avec source et extrait retrouvé ; rien d\'automatique', () => {
  const sib = id => ident(id).siblings.map(s => `${s.relation}:${s.variant || '-'}${s.volume ? ':' + s.volume.value + s.volume.unit : ''}`);
  assert.deepEqual(sib('to-hyaluronic-b5-ceramides'), ['formulation:original', 'size:with_ceramides:60ml']);
  assert.deepEqual(sib('to-salicylic-2-solution'), ['formulation:anhydrous']); assert.deepEqual(sib('cerave-blemish-control-gel'), ['regional:-']);
  assert.deepEqual(sib('lrp-cicaplast-baume-b5-plus'), ['formulation:old_formula', 'sun_protection:with_spf', 'size:-:15ml', 'size:-:100ml']);
  // produits sans mention de frère dans le catalogue : aucun frère déclaré (ni même parce que des noms se ressemblent)
  const declared = new Set(['to-hyaluronic-b5-ceramides', 'to-salicylic-2-solution', 'cerave-blemish-control-gel', 'lrp-cicaplast-baume-b5-plus']);
  for (const [id, x] of Object.entries(FILE.products)) if (!declared.has(id)) assert.deepEqual(x.siblings, [], id);
  for (const [id, x] of Object.entries(FILE.products)) for (const s of x.siblings) { assert.equal(s.status, 'known'); assert.equal(s.productId, null, id + ' : le frère n\'est pas (encore) un produit du catalogue'); assert.ok(I.resolveSource(byId(id), s.source).includes(s.evidence), id + ' : ' + s.evidence); }
  // deux produits du catalogue au nom proche ne deviennent jamais frères d'eux-mêmes : aucun frère ne vise un produit du catalogue
  assert.ok(Object.values(FILE.products).every(x => x.siblings.every(s => s.productId === null)));
});

test('ID-7 cas de référence Lynia : l\'identité distingue « with Ceramides » de « Original Formulation » et le 30 ml du 60 ml', () => {
  const x = ident('to-hyaluronic-b5-ceramides');
  assert.equal(x.brand.canonical, 'The Ordinary'); assert.deepEqual(x.brand.aliases, ['the ordinary', 'theordinary']); assert.equal(x.name.canonical, 'Hyaluronic Acid 2% + B5');
  assert.deepEqual(x.volume, { raw: '30 ml', value: 30, unit: 'ml', normalized: { value: 30, unit: 'ml' }, kind: 'volume' }); assert.equal(x.variant.id, 'with_ceramides');
  assert.deepEqual(x.attributes.concentrations.map(c => [c.ingredient, c.activeId, c.percentage]), [['hyaluronic acid', 'hyaluronic', 2]]);
  assert.deepEqual(x.attributes.actives.map(a => a.activeId), ['hyaluronic', 'panthenol', 'ceramides', 'glycerin']);
  // ce que le futur matching pourra comparer : le texte d'une fiche « Original Formulation » ne porte pas la variante de ce produit, mais celle d'un frère connu
  const listing = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 30 ml Original Formulation');
  assert.equal(listing.brand.canonical, x.brand.canonical); assert.equal(listing.volume.normalized.value, x.volume.normalized.value);
  assert.notEqual(listing.variants[0].id, x.variant.id); assert.ok(x.siblings.some(s => s.variant === listing.variants[0].id && s.status === 'known'));
  // une fiche à 60 ml est un format frère connu, pas ce produit
  const big = A.extractAttributes('The Ordinary Hyaluronic Acid 2% + B5 60 ml (with Ceramides)');
  assert.equal(big.variants[0].id, x.variant.id); assert.notEqual(big.volume.normalized.value, x.volume.normalized.value); assert.ok(x.siblings.some(s => s.relation === 'size' && s.volume.normalized.value === big.volume.normalized.value));
  // le catalogue lui-même est inchangé : même nom, même format
  assert.equal(byId('to-hyaluronic-b5-ceramides').name, 'Hyaluronic Acid 2% + B5 (with Ceramides)'); assert.equal(byId('to-hyaluronic-b5-ceramides').format, '30 ml');
});

test('ID-8 alias de nom : seulement des libellés de sources du catalogue, avec extrait ; jamais déduits', () => {
  for (const [id, x] of Object.entries(FILE.products)) for (const a of x.name.aliases) { assert.equal(a.status, 'source_label'); assert.ok(I.resolveSource(byId(id), a.source).includes(a.evidence), id); assert.notEqual(N.normalizeText(a.text), N.normalizeText(x.name.canonical), id + ' : un alias identique au nom ne sert à rien'); }
  const withAliases = Object.entries(FILE.products).filter(([, x]) => x.name.aliases.length).map(([id]) => id);
  assert.deepEqual(withAliases, ['cerave-hydrating-ha-serum', 'lrp-effaclar-duo-m', 'lrp-mela-b3-serum', 'vichy-liftactiv-vitamin-c-serum']);
});

test('ID-9 le validateur refuse ce qui serait inventé', () => {
  const base = () => clone(ident('to-hyaluronic-b5-ceramides')), bad = (mut, re) => { const x = base(); mut(x); const e = I.validateIdentityFile({ version: 1, products: { 'to-hyaluronic-b5-ceramides': x } }, ctx); assert.ok(e.some(m => re.test(m)), JSON.stringify(e)); };
  assert.deepEqual(I.validateIdentityFile({ version: 1, products: { 'to-hyaluronic-b5-ceramides': base() } }, ctx), []);
  bad(x => { x.siblings[0].evidence = 'texte inventé'; }, /extrait introuvable/); bad(x => { x.siblings[0].source = 'sources[9].label'; }, /extrait introuvable/);
  bad(x => { delete x.siblings[0].evidence; }, /extrait|source/); bad(x => { x.siblings[0].relation = 'inconnu'; }, /frère invalide/); bad(x => { x.siblings[0].variant = 'magique'; }, /variante inconnue/);
  bad(x => { x.attributes.concentrations[0].activeId = 'nouvel_actif'; }, /actif inconnu/); bad(x => { x.attributes.actives[0].activeId = 'nouvel_actif'; }, /actif inconnu/);
  bad(x => { x.attributes.concentrations[0].percentage = 120; }, /pourcentage/); bad(x => { x.attributes.concentrations[0].percentage = 0; }, /pourcentage/);
  bad(x => { x.volume.unit = 'cup'; }, /unité/); bad(x => { x.volume.value = -3; }, /valeur/); bad(x => { x.volume.normalized.value = 31; }, /incohérente/);
  bad(x => { x.variant.id = 'magique'; }, /variante invalide/); bad(x => { x.variant.exactness = 'sûr'; }, /variante invalide/);
  bad(x => { x.brand.aliases = ['The Ordinary']; }, /marque invalide/); bad(x => { x.surprise = 1; }, /champ inattendu/);
  bad(x => { x.name.aliases = [{ text: 'Autre nom', source: 'sources[0].label', evidence: 'Autre nom', status: 'source_label' }]; }, /extrait introuvable/);
  bad(x => { x.notes = [{ text: 'note', source: '', evidence: '' }]; }, /note sans source/);
  assert.ok(I.validateIdentityFile({ version: 2, products: {} }, ctx).length); assert.ok(I.validateIdentityFile(null, ctx).length); assert.ok(I.validateIdentityFile({ version: 1 }, ctx).length);
  assert.ok(I.validateIdentityFile({ version: 1, products: { 'produit-fantome': base() } }, ctx).some(m => /absent du catalogue/.test(m)));
  const a = base(), b = base(); b.brand = { canonical: 'Autre Marque', aliases: ['the ordinary'] };
  assert.ok(I.validateIdentityFile({ version: 1, products: { 'to-hyaluronic-b5-ceramides': a, 'to-niacinamide-10-zinc-1': b } }, ctx).some(m => /partagé par deux marques/.test(m)), 'un alias de marque ne peut pas servir deux marques');
});

test('ID-10 robustesse : deriveIdentity ne plante pas, ne mute rien, et reste valide pour tout produit du catalogue (y compris ceux à venir)', () => {
  const before = JSON.stringify(PRODUCTS);
  for (const p of PRODUCTS) { const d = I.deriveIdentity(p); assert.deepEqual(I.validateIdentity(d, { activeIds: ACTIVES }), [], p.id); }
  assert.equal(JSON.stringify(PRODUCTS), before, 'le catalogue n\'est pas modifié');
  for (const bad of [null, undefined, 0, 'x', [], {}, { id: 'a' }, { id: 'a', name: 'N' }, { id: 'a', name: 'N', brand: '' }]) assert.equal(I.deriveIdentity(bad), null, JSON.stringify(bad));
  // produit minimal : tout ce qui manque reste null / []
  const m = I.deriveIdentity({ id: 'x', name: 'Sérum Test', brand: 'Marque Inconnue' });
  assert.equal(m.volume, null); assert.equal(m.variant, null); assert.deepEqual(m.attributes, { actives: [], concentrations: [] }); assert.deepEqual(m.brand.aliases, ['marque inconnue']); assert.deepEqual(m.identifiers, { gtin: null, mpn: null, sku: null });
  assert.equal(I.deriveIdentity({ id: 'x', name: 'Sérum Test', brand: 'B', format: 'texte sans quantité' }).volume, null);
  assert.equal(I.deriveIdentity({ id: 'x', name: 'Sérum (parenthèse libre)', brand: 'B' }).variant, null, 'une parenthèse qui n\'est pas une variante reste dans le nom');
  assert.equal(I.resolveSource(null, 'name'), null); assert.equal(I.resolveSource({ name: 'a' }, 'sources[0].label'), null); assert.equal(I.resolveSource({ name: 'a' }, 'constructor'), null);
});

test('ID-11 isolation : l\'identité n\'est lue par aucun moteur ni par le navigateur ; le moteur de décision est inchangé', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'js')).concat(walk(path.join(ROOT, 'server')), walk(path.join(ROOT, 'api')))) if (/\.js$/.test(f)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /tools\/market|data\/market\/|identities\.json|require\(['"][^'"]*\/identity\.js['"]\)/, path.relative(ROOT, f));
  const lynia = byId('to-hyaluronic-b5-ceramides').offers.find(o => o.market === 'BJ' && o.retailer === 'Lynia Shop');
  assert.ok(lynia === undefined || (lynia.price === 12700 && lynia.currency === 'XOF' && lynia.availability === 'in_stock'), 'l\'offre Lynia du catalogue est intacte');
});
