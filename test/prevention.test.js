'use strict';
/* Lot 4 (peaux foncées) : jamais d'éclaircissant ni de dépigmentant. Substances exclues (hydroquinone, mercure, corticoïdes, arbutine, acide kojique, glutathion), promesses
   d'éclaircissement, produit sans liste d'ingrédients lisible = « composition non vérifiable », jamais recommandé. Message de prévention. Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PV = require('../js/engine/data/prevention.js');
const AL = require('../js/engine/data/inci-aliases.js');
const ACT = require('../js/engine/data/actives.js');
const P = require('../js/engine/products.js');
const V = require('../js/engine/verif.js');
const C = require('../js/engine/data/catalog.js');
const DEMO = require('../js/engine/data/products.js');
const Engine = require('../js/engine/index.js');
const D = require('../js/declared-concerns.js');
const { run, norm } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const mk = (id, name, category, inci, extra) => Object.assign({ id: 'p' + id, name, category, slots: ['evening'], inci, origin: { kind: 'user' } }, extra || {});
const probe = (inci) => V.analyze([mk('a', 'Crème', 'moisturizer', ['Aqua', inci])]).points.map(p => p.id + ':' + p.rule);
const points = (products, rule) => V.analyze(products).points.filter(p => !rule || p.rule === rule);

test('PV1 liste d\'exclusion : les six éclaircissants y sont, avec leurs noms INCI exacts', () => {
  for (const id of ['hydroquinone', 'mercury', 'corticoids', 'arbutin', 'kojic_acid', 'glutathione']) {
    assert.ok(ACT.EXCLUDED.includes(id), id + ' est exclu');
    assert.ok(PV.LIGHTENING_IDS.includes(id));
    assert.ok(AL.EXCLUDED_NAMES.some(e => e.id === id && e.names.length), id + ' a des noms INCI');
  }
  assert.deepEqual(PV.LIGHTENING_IDS.filter(id => !ACT.EXCLUDED.includes(id)), []);
  for (const id of ['benzoyl_peroxide', 'adapalene', 'tretinoin']) assert.equal(PV.isLightening(id), false, id + ' : message neutre, ce n\'est pas un éclaircissant');
  for (const id of ACT.EXCLUDED.filter(PV.isLightening)) assert.ok(PV.messageOf(id), 'un message pour ' + id);
  assert.equal(ACT.ACTIVES.filter(a => ACT.EXCLUDED.includes(a.id)).length, 0, 'aucun actif DERMAI n\'est une substance exclue');
});

test('PV2 détection : nom INCI exact seulement (casse, accents, pourcentage ignorés), jamais par ressemblance', () => {
  const hit = (list, id) => assert.ok(PV.excludedIn(list).includes(id), list.join() + ' -> ' + id);
  hit(['Aqua', 'Hydroquinone 2%'], 'hydroquinone'); hit(['MERCURY'], 'mercury'); hit(['Mercuric Chloride'], 'mercury'); hit(['Alpha-Arbutin'], 'arbutin'); hit(['Arbutin'], 'arbutin');
  hit(['Kojic Acid'], 'kojic_acid'); hit(['Glutathione'], 'glutathione'); hit(['Clobetasol Propionate'], 'corticoids'); hit(['Hydrocortisone'], 'corticoids'); hit(['Mercury (Hg)'], 'mercury');
  for (const safe of [['Arbutus Unedo Leaf Extract'], ['Kojic'], ['Glutamic Acid'], ['Hydroxyethylcellulose'], ['Mercaptoethanol'], ['Niacinamide', 'Azelaic Acid', 'Ascorbic Acid', 'Mandelic Acid'], ['Glycerin']])
    assert.deepEqual(PV.excludedIn(safe), [], safe.join());
  assert.deepEqual(PV.excludedIn(null), []); assert.deepEqual(PV.excludedIn([null, 3, {}]), []);
  /* même normalisation que Vérif'Routine */
  for (const s of ['Hydroquinone 2%', 'Éthyl*', ' A  B ']) assert.equal(PV.normalize(s), V.normalizeName(s));
});

test('PV3 promesses d\'éclaircissement : détectées ; « brightening » seul, « éclat » ou « léger » ne le sont pas', () => {
  for (const t of ['Crème éclaircissante', 'Skin Whitening Cream', 'Lightening serum', 'Sérum dépigmentant', 'Lait blanchissant', 'Bleaching cream', 'Fade cream', 'pour éclaircir la peau', 'WHITENING'])
    assert.ok(PV.claimIn(t), t);
  for (const t of ['Vitamin C Brightening Serum', 'Sérum Teint Uniforme', 'Éclat naturel', 'Gel léger', 'Lightweight fluid', 'Atténue les taches', 'Unifie le teint', '', null, undefined, 3])
    assert.equal(PV.claimIn(t), null, String(t));
});

test('PV4 catalogue : le catalogue réel est propre ; un produit exclu, éclaircissant ou sans liste est refusé et jamais utilisable', () => {
  assert.deepEqual(P.validateCatalog(C.PRODUCTS), [], 'le catalogue réel est valide');
  for (const p of P.usable(C.PRODUCTS)) assert.equal(PV.blocked(p), false, p.id);
  for (const p of C.PRODUCTS.filter(x => x.status === 'to_verify')) assert.ok(PV.check(p).unverifiable && p.active === false, p.id + ' : à vérifier = inactif');
  for (const p of DEMO.PRODUCTS) assert.equal(PV.blocked(p), false, 'démonstration : ' + p.id);
  const base = JSON.parse(JSON.stringify(C.PRODUCTS.find(x => x.id === 'to-niacinamide-10-zinc-1')));
  const bad = (patch, re) => { const p = Object.assign(JSON.parse(JSON.stringify(base)), patch); assert.match(P.validateProduct(p).join(' | '), re); assert.equal(P.usable([p]).length, 0, 'jamais utilisable'); };   // substance exclue ou promesse : refusé à la validation ET à la sélection
  bad({ inci: [...base.inci, 'Hydroquinone'] }, /substance exclue \(hydroquinone\)/);
  bad({ inci: [...base.inci, 'Mercuric Chloride'] }, /substance exclue \(mercury\)/);
  bad({ inci: [...base.inci, 'Clobetasol Propionate'] }, /substance exclue \(corticoids\)/);
  bad({ inci: [...base.inci, 'Alpha-Arbutin'] }, /substance exclue \(arbutin\)/);
  bad({ inci: [...base.inci, 'Kojic Acid'] }, /substance exclue \(kojic_acid\)/);
  bad({ inci: [...base.inci, 'Glutathione'] }, /substance exclue \(glutathione\)/);
  bad({ name: 'Crème éclaircissante visage' }, /promesse d'éclaircissement/);
  bad({ description: 'Sérum pour blanchir la peau entière.' }, /promesse d'éclaircissement/);
  /* composition non vérifiable : refusée à la validation du catalogue (un produit validé exige sa liste INCI) */
  for (const inci of [null, [], ['', '  ']]) assert.match(P.validateProduct(Object.assign(JSON.parse(JSON.stringify(base)), { inci })).join(' | '), /composition non vérifiable|INCI/);
  assert.ok(PV.check(Object.assign({}, base, { inci: null })).unverifiable && !PV.check(Object.assign({}, base, { demo: true, inci: null })).unverifiable, 'les produits de démonstration (fictifs) sont hors de cette règle');
});

test('PV5 sélection : un produit exclu n\'est jamais proposé par le moteur, même s\'il porte l\'actif recherché', () => {
  const base = JSON.parse(JSON.stringify(C.PRODUCTS.find(x => x.id === 'to-niacinamide-10-zinc-1')));
  const tainted = Object.assign(JSON.parse(JSON.stringify(base)), { id: 'faux-produit', name: 'Faux produit', inci: [...base.inci, 'Hydroquinone'] });
  const claim = Object.assign(JSON.parse(JSON.stringify(base)), { id: 'promesse', name: 'Sérum éclaircissant' });
  const r = Engine.run(norm({ pores: 20, acne: 20, oiliness: 20 }, { raw: 20 }), { goals: ['oil_pores'], level: 'full', cats: [] }, { catalog: [tainted, claim, base] });
  const ids = r.productMatches.map(m => m.productId || (m.product && m.product.id)).filter(Boolean);
  for (const bad of ['faux-produit', 'promesse']) assert.ok(!ids.includes(bad), bad + ' jamais proposé');
  assert.ok(r.productMatches.length > 0, 'témoin : le produit sain peut être proposé');
});

test('PV6 Vérif\'Routine : un message de prévention précis par éclaircissant ; message neutre pour les autres ; composition non vérifiable', () => {
  const cases = [['Hydroquinone', /dépigmenter la peau/], ['Mercury', /toxique, notamment pour les reins/], ['Betamethasone', /corticoïdes sont des médicaments, pas des cosmétiques/],
    ['Alpha-Arbutin', /arbutine est utilisée dans des produits pour éclaircir la peau/], ['Kojic Acid', /acide kojique est utilisé/], ['Glutathione', /glutathion est utilisé/]];
  for (const [inci, re] of cases) {
    const r = points([mk('a', 'Crème', 'moisturizer', ['Aqua', inci])], 'EXCLUDED');
    assert.equal(r.length, 1, inci); assert.equal(r[0].level, 'prudence'); assert.match(r[0].title, /^Produit éclaircissant : prudence avec « Crème »$/); assert.match(r[0].text, re);
    assert.match(r[0].text, /parlez-en/); assert.doesNotMatch(r[0].text, /(?<![\p{L}])(?:recommandons|conseillons)(?![\p{L}])/u);
  }
  assert.match(points([mk('n', 'Gel', 'serum', ['Aqua', 'Benzoyl Peroxide'])], 'EXCLUDED')[0].text, /fait partie des substances sur lesquelles DERMAI ne donne pas de conseil/);
  const unk = points([mk('u', 'Sans liste', 'other', [])], 'R4')[0];
  assert.equal(unk.title, 'Composition non vérifiable : « Sans liste »');
  assert.match(unk.text, /DERMAI ne le recommande jamais/); assert.match(unk.text, /promettent d'éclaircir la peau/); assert.match(unk.text, /mercure, de l'hydroquinone ou des corticoïdes sans l'indiquer/);
  assert.equal(points([mk('c', 'Propre', 'serum', ['Aqua', 'Niacinamide'])], 'EXCLUDED').length, 0, 'aucun faux positif');
});

test('PV7 chaque message est un AVERTISSEMENT : il dit d\'éviter ou de demander conseil, sans diagnostic ni promesse', () => {
  const texts = [...Object.values(PV.MESSAGES), PV.GENERAL.text, PV.UNVERIFIABLE.text, PV.UNVERIFIABLE.warn];
  const warn = /(ne conseille pas|évitez|n'utilisez pas|ne le recommande jamais|Méfiez-vous)/i;
  for (const t of texts) {
    assert.match(t, warn, t);
    assert.doesNotMatch(t, /(?<![\p{L}])(?:il faut|traiter|soigner|guérir|guéri|prescri\w*|diagnostic|vous avez (?!indiqu|choisi))(?![\p{L}])/iu, t);
    assert.ok(!/[—–]/.test(t), 'pas de tiret cadratin : ' + t);
  }
  for (const id of ['hydroquinone', 'mercury', 'corticoids', 'arbutin', 'kojic_acid', 'glutathione']) assert.match(PV.MESSAGES[id], /(pharmacien|médecin|dermatologue)/, id);
  assert.match(PV.GENERAL.text, /Les soins que DERMAI propose visent les taches, pas la couleur de votre peau/);
  /* ce qui est conservé : atténuer / unifier, jamais éclaircir */
  for (const id of ['azelaic', 'niacinamide', 'vitamin_c', 'aha_pha']) assert.doesNotMatch(ACT.ACTIVES.find(a => a.id === id).description, /[ée]claircir|d[ée]pigment|blanch/i, id);
});

test('PV8 rappel général : affiché pour qui veut atténuer des taches (objectif « teint » ou taches retenues), jamais autrement', () => {
  const goal = run({}, { raw: 70 }, { goals: ['tone'] });
  const kept = run({ pigmentation: 20 }, { rawMap: { pigmentation: 20 }, rawFill: 80 }, { goals: [] });
  const neither = run({}, { raw: 70 }, { goals: ['hydration'] });
  for (const e of [goal, kept]) { const h = D.preventionNote(e); assert.ok(h.includes('data-prevention-note')); assert.match(h, /évitez les produits éclaircissants/); assert.ok(D.top(e).includes('data-prevention-note')); }
  assert.equal(D.preventionNote(neither), '');
  for (const bad of [undefined, null, {}, { personalization: null }, { priorities: { items: [null] } }]) assert.doesNotThrow(() => D.preventionNote(bad));
});

test('PV9 aucun texte de l\'interface ne parle d\'éclaircir la peau, sauf pour AVERTIR (js/engine/data/prevention.js)', () => {
  const re = /[ée]claircir|[ée]claircissant|blanchir|blanchissant|d[ée]pigment/i;
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const files = []; (function walk(d) { for (const f of fs.readdirSync(path.join(__dirname, '..', d), { withFileTypes: true })) { const p = d + '/' + f.name; if (f.isDirectory()) walk(p); else if (/\.(js|html)$/.test(f.name)) files.push(p); } })('js');
  files.push('index.html');
  /* js/hair-data.js : couleur de CHEVEUX (« éclaircir demande une décoloration, voyez un coiffeur »), sans rapport avec la peau */
  const allowed = new Set(['js/engine/data/prevention.js', 'js/hair-data.js']);
  for (const f of files.filter(x => !allowed.has(x))) assert.doesNotMatch(strip(read(f)), re, f);
  assert.match(strip(read('js/hair-data.js')), /éclaircir demande une décoloration/);
  /* le seul fichier autorisé n'écrit ces mots que dans des avertissements : chaque chaîne qui les contient porte un marqueur d'avertissement */
  const warn = /(ne conseille pas|évitez|n'utilisez pas|ne le recommande jamais|Méfiez-vous|prudence|promettent|visent)/i;
  const texts = [...Object.values(PV.MESSAGES), PV.GENERAL.title, PV.GENERAL.text, PV.UNVERIFIABLE.warn, PV.GENERIC, PV.TITLES.lightening('x'), PV.BADGE.lightening].filter(t => re.test(t));
  assert.ok(texts.length >= 6);
  for (const t of texts) assert.match(t, warn, t);
});

test('PV10 câblage : module chargé avant son premier lecteur, titres et badges de l\'interface', () => {
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('engine/data/inci-aliases.js') < at('engine/data/prevention.js') && at('engine/data/prevention.js') < at('engine/products.js') && at('engine/data/prevention.js') < at('engine/verif.js') && at('engine/data/prevention.js') < at('declared-concerns.js'));
  const r = read('js/verif-routine.js');
  assert.match(r, /unknownBadge: 'Composition non vérifiable'/); assert.match(r, /PV\.BADGE\.lightening/);
  assert.ok(Buffer.byteLength(read('js/app.js')) <= 149502, 'app.js : plafond de taille non relevé');
});
