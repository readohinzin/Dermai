'use strict';
/* Vérif'Routine : moteur d'analyse pur (js/engine/verif.js) et alias INCI (js/engine/data/inci-aliases.js). Sans navigateur ni réseau.
   Vérifie : provenance de chaque alias, reconnaissance exacte seulement, produit au nom seul sans composition, règles R1 à R5 (cas positifs et négatifs), liste EXCLUDED,
   aucune fréquence inventée, aucun mot absolu ou médical, pureté du moteur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../js/engine/verif.js');
const AL = require('../js/engine/data/inci-aliases.js');
const A = require('../js/engine/data/actives.js');
const CATALOG = require('../js/engine/data/catalog.js').PRODUCTS;
const N = require('../tools/market/normalize.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Les identifiants de produit font au moins 2 caractères : « p » + le code court donné ici. */
const mk = (id, name, category, slots, inci, extra) => Object.assign({ id: 'p' + id, name, category, slots, inci, origin: { kind: 'user' } }, extra || {});
const pts = (products, rule) => E.analyze(products).points.filter(p => !rule || p.rule === rule);
const activeLabel = id => A.ACTIVES.find(a => a.id === id).label;

test('VE1 alias : clés normalisées et uniques, actifs existants, provenance écrite et vérifiable dans les données du projet', () => {
  const keys = AL.ALIASES.map(a => a.key);
  assert.equal(new Set(keys).size, keys.length, 'aucune clé en double');
  const lexicon = new Set([...N.PHRASES.map(p => p[0]), ...N.INGREDIENTS.map(i => i.tokens.join(' ')), ...Object.keys(N.WORDS)]);
  for (const a of AL.ALIASES) {
    assert.equal(E.normalizeName(a.key), a.key, `clé déjà normalisée : ${a.key}`);
    assert.ok(A.ACTIVES.some(x => x.id === a.activeId), `actif existant pour ${a.key}`);
    assert.ok(['catalogue', 'lexique', 'a_relire'].includes(a.validation), a.key); assert.ok(a.source && a.source.length > 10, `source écrite pour ${a.key}`);
    if (a.validation === 'catalogue') {
      const hit = CATALOG.filter(p => (p.inci || []).some(t => E.normalizeName(t) === a.key));
      assert.ok(hit.length, `${a.key} figure dans l'INCI d'un produit du catalogue`);
      assert.ok(hit.some(p => p.ingredients.some(i => i.activeId === a.activeId)), `${a.key} : au moins un de ces produits relie l'ingrédient à l'actif ${a.activeId}`);
    }
    if (a.validation === 'lexique') assert.ok(lexicon.has(a.key), `${a.key} figure dans le lexique FR/EN du projet`);
  }
  assert.ok(AL.ALIASES.filter(a => a.validation === 'a_relire').length > 0, 'les correspondances sans attestation sont marquées « à relire »');
});

test('VE2 substances EXCLUDED : chaque identifiant de la liste du moteur est couvert, par nom exact seulement', () => {
  const ids = AL.EXCLUDED_NAMES.map(e => e.id).sort();
  assert.deepEqual(ids, [...A.EXCLUDED].sort(), 'tous les identifiants de EXCLUDED, et eux seuls');
  for (const e of AL.EXCLUDED_NAMES) { assert.ok(e.names.length && e.validation === 'a_relire' && e.source); e.names.forEach(n => assert.equal(E.normalizeName(n), n)); }
  const all = AL.EXCLUDED_NAMES.flatMap(e => e.names); assert.equal(new Set(all).size, all.length);
  assert.ok(!AL.ALIASES.some(a => all.includes(a.key)), 'une substance exclue n\'est jamais aussi un alias d\'actif');
});

test('VE3 découpe de la liste INCI : séparateurs, préfixe, doublons, plafonds', () => {
  const r = E.parseInci('Ingrédients : Aqua (Water), Salicylic Acid 2%, Glycerin; Ethylhexylglycerin\nNiacinamide • niacinamide.');
  assert.deepEqual(r.tokens, ['Aqua (Water)', 'Salicylic Acid 2%', 'Glycerin', 'Ethylhexylglycerin', 'Niacinamide']);
  assert.deepEqual(E.parseInci('').tokens, []); assert.deepEqual(E.parseInci(null).tokens, []); assert.deepEqual(E.parseInci(' , ;; \n ').tokens, []);
  assert.deepEqual(E.parseInci('INCI: A, B.').tokens, ['A', 'B']);
  const many = E.parseInci(Array.from({ length: 200 }, (_, i) => 'ing' + i).join(','));
  assert.equal(many.tokens.length, E.MAX_INCI); assert.equal(many.truncated, true);
  const long = E.parseInci('x'.repeat(200)); assert.equal(long.tokens[0].length, E.MAX_TOKEN); assert.equal(long.tooLong, true);
});

test('VE4 reconnaissance : correspondance EXACTE seulement, jamais par ressemblance ; un inconnu reste « unknown » sans fonction ni risque', () => {
  const ok = (raw, id) => { const r = E.recognize(raw); assert.equal(r.kind, 'active', raw); assert.equal(r.activeId, id, raw); assert.ok(r.source && r.validation, raw); };
  ok('Salicylic Acid 2%', 'salicylic'); ok('SALICYLIC ACID', 'salicylic'); ok('Acide Azélaïque', 'azelaic'); ok('Vitamin C', 'vitamin_c'); ok('Sodium Hyaluronate Crosspolymer', 'hyaluronic');
  ok('Hyaluronic Acid (5 forms)', 'hyaluronic'); ok('Glycerin', 'glycerin'); ok('Niacinamide 10 %', 'niacinamide'); ok('Retinol', 'retinoid'); ok('Ceramide NP', 'ceramides');
  const ex = E.recognize('Hydroquinone'); assert.equal(ex.kind, 'excluded'); assert.equal(ex.excludedId, 'hydroquinone');
  for (const raw of ['Ethylhexylglycerin', 'Glyceryl Stearate', 'Salicylic Acid Derivative', 'Retinyl Linoleate', 'Ascorbyl Palmitate', 'Sodium Ascorbyl Phosphate', 'Aqua (Water)', 'Parfum', 'Alcohol Denat.', 'Hydroxyethylcellulose', 'Niacinamidex', 'Zinc Oxide', '']) {
    const r = E.recognize(raw);
    assert.equal(r.kind, 'unknown', raw); assert.deepEqual(Object.keys(r).sort(), ['kind', 'raw'], `aucune fonction, aucun risque, aucune efficacité attribués : ${raw}`);
  }
});

test('VE5 produit nettoyé : identifiant, nom, créneaux obligatoires ; liste dédoublonnée et plafonnée ; origine catalogue seulement avec INCI', () => {
  const base = { id: 'ab12', name: '  Mon   sérum ', category: 'serum', slots: ['evening', 'morning', 'x'], inci: ['Aqua', 'aqua', ' Glycerin ', ''] };
  const c = E.cleanProduct(base);
  assert.equal(c.name, 'Mon sérum'); assert.deepEqual(c.slots, ['morning', 'evening']); assert.deepEqual(c.inci, ['Aqua', 'Glycerin']); assert.deepEqual(c.origin, { kind: 'user' }); assert.equal(c.irritated, false);
  assert.equal(E.cleanProduct(Object.assign({}, base, { category: 'nimportequoi' })).category, 'other');
  for (const bad of [null, [], 'x', {}, Object.assign({}, base, { id: '' }), Object.assign({}, base, { id: 'a b' }), Object.assign({}, base, { name: '' }), Object.assign({}, base, { name: 'n'.repeat(81) }), Object.assign({}, base, { slots: [] }), Object.assign({}, base, { slots: ['soir'] })]) assert.equal(E.cleanProduct(bad), null, JSON.stringify(bad));
  const cat = E.cleanProduct(Object.assign({}, base, { origin: { kind: 'catalog', productId: 'to-x', label: 'Fiche', checkedAt: '2026-10-06' }, irritated: true }));
  assert.deepEqual(cat.origin, { kind: 'catalog', productId: 'to-x', label: 'Fiche', checkedAt: '2026-10-06' }); assert.equal(cat.irritated, true);
  assert.deepEqual(E.cleanProduct(Object.assign({}, base, { inci: [], origin: { kind: 'catalog', productId: 'to-x' } })).origin, { kind: 'user' }, 'origine « catalogue » sans INCI refusée');
  assert.equal(E.cleanProduct(Object.assign({}, base, { inci: Array.from({ length: 300 }, (_, i) => 'i' + i) })).inci.length, E.MAX_INCI);
  assert.equal(E.cleanProduct(Object.assign({}, base, { irritated: 'oui' })).irritated, false);
});

test('VE6 un nom seul ne donne aucune composition : aucun actif, aucune précaution, aucune fréquence, seulement « information manquante » R4', () => {
  const p = mk('n1', 'Sérum Vitamine C Retinol Salicylic Acid Hydroquinone', 'serum', ['morning', 'evening'], []);
  const r = E.analyze([p]);
  assert.equal(r.products[0].known, false); assert.deepEqual(r.products[0].actives, []); assert.deepEqual(r.products[0].tokens, []); assert.deepEqual(r.products[0].cautions, []); assert.deepEqual(r.products[0].excluded, []);
  assert.deepEqual(r.products[0].frequency, { kind: 'unknown' });
  assert.deepEqual(r.points.map(x => x.rule), ['R4']); assert.equal(r.points[0].level, 'missing'); assert.match(r.points[0].text, /composition .* est inconnue.*ne peut rien vérifier/);
  assert.match(r.points[0].why.rule, /ne déduit jamais la composition/);
});

test('VE7 R1 : actif ciblé dans plusieurs produits = information neutre, jamais précaution ; pas pour un seul produit, ni pour les hydratants', () => {
  const two = pts([mk('a', 'Sérum A', 'serum', ['morning'], ['Niacinamide']), mk('b', 'Crème B', 'moisturizer', ['evening'], ['Niacinamide', 'Glycerin'])], 'R1');
  assert.equal(two.length, 1); assert.equal(two[0].level, 'info'); assert.equal(two[0].id, 'R1:niacinamide'); assert.deepEqual(two[0].productIds, ['pa', 'pb']);
  assert.match(two[0].text, /Ce n'est pas une incompatibilité/); assert.match(two[0].title, /Niacinamide dans 2 produits/);
  assert.equal(pts([mk('a', 'A', 'serum', ['morning'], ['Niacinamide'])], 'R1').length, 0, 'un seul produit');
  assert.equal(pts([mk('a', 'A', 'serum', ['morning'], ['Niacinamide']), mk('b', 'B', 'serum', ['morning'], ['Azelaic Acid'])], 'R1').length, 0, 'actifs différents');
  assert.equal(pts([mk('a', 'A', 'moisturizer', ['morning'], ['Glycerin']), mk('b', 'B', 'moisturizer', ['evening'], ['Glycerin'])], 'R1').length, 0, 'glycérine : ingrédient de soutien, jamais signalé');
  assert.equal(pts([mk('a', 'A', 'serum', ['morning'], ['Aqua']), mk('b', 'B', 'serum', ['morning'], ['Aqua'])], 'R1').length, 0, 'ingrédients non reconnus : jamais regroupés');
  assert.equal(pts([mk('a', 'A', 'serum', ['morning'], ['Ethylhexylglycerin']), mk('b', 'B', 'serum', ['morning'], ['Glycerin'])], 'R1').length, 0);
});

test('VE8 R2 : un seul exfoliant ou rétinoïde par soir (règle strong_evening validée) ; cas positifs et négatifs', () => {
  const rule = A.CONFLICT_RULES.find(r => r.id === 'strong_evening');
  assert.equal(rule.status, 'validated'); assert.equal(rule.group, 'evening_strong'); assert.equal(rule.max, 1);
  const pos = pts([mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid']), mk('b', 'BHA', 'serum', ['evening', 'morning'], ['Salicylic Acid'])], 'R2');
  assert.equal(pos.length, 1); assert.equal(pos[0].level, 'precaution'); assert.deepEqual(pos[0].productIds, ['pa', 'pb']);
  assert.ok(pos[0].text.includes(rule.text)); assert.equal(pos[0].why.rule, rule.text); assert.match(pos[0].why.validation, /validée/);
  assert.equal(pts([mk('a', 'Peeling', 'serum', ['evening'], ['Retinol']), mk('b', 'BHA', 'serum', ['evening'], ['Salicylic Acid'])], 'R2').length, 1, 'rétinoïde + exfoliant');
  assert.equal(pts([mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid']), mk('b', 'BHA', 'serum', ['morning'], ['Salicylic Acid'])], 'R2').length, 0, 'un seul le soir');
  assert.equal(pts([mk('a', 'Gel', 'serum', ['evening'], ['Salicylic Acid', 'Glycolic Acid', 'Lactic Acid'])], 'R2').length, 0, 'un seul produit, même à plusieurs exfoliants : la règle compte les produits');
  assert.equal(pts([mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid']), mk('b', 'Niacinamide', 'serum', ['evening'], ['Niacinamide'])], 'R2').length, 0, 'un exfoliant et un actif hors groupe');
  assert.equal(pts([mk('a', 'Azélaïque', 'serum', ['evening'], ['Azelaic Acid']), mk('b', 'BHA', 'serum', ['evening'], ['Salicylic Acid'])], 'R2').length, 0, 'l\'acide azélaïque n\'appartient pas au groupe');
  assert.equal(pts([mk('a', 'Peeling', 'serum', ['evening'], ['Unknown Acid']), mk('b', 'BHA', 'serum', ['evening'], ['Salicylic Acid'])], 'R2').length, 0, 'ingrédient non reconnu : aucune règle');
  const saved = rule.status; rule.status = 'à_valider';
  try { assert.equal(pts([mk('a', 'P', 'serum', ['evening'], ['Glycolic Acid']), mk('b', 'B', 'serum', ['evening'], ['Salicylic Acid'])], 'R2').length, 0, 'règle non validée : jamais appliquée'); } finally { rule.status = saved; }
});

test('VE9 R3 : protection solaire seulement si une fiche la demande ET qu\'aucun produit déclaré « Protection solaire » n\'est placé le matin', () => {
  const aha = mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid']);
  const none = pts([aha], 'R3');
  assert.equal(none.length, 1); assert.equal(none[0].level, 'precaution'); assert.ok(none[0].text.includes('Protection solaire indispensable.'), 'texte de la fiche repris tel quel');
  assert.match(none[0].why.validation, /Exfoliants chimiques AHA ou PHA : sources partielles/); assert.deepEqual(none[0].productIds, ['pa']);
  assert.equal(pts([aha, mk('s', 'Écran', 'spf', ['morning'], [])], 'R3').length, 0, 'produit solaire déclaré le matin');
  assert.equal(pts([aha, mk('s', 'Écran', 'spf', ['evening'], [])], 'R3').length, 1, 'un produit solaire du soir ne compte pas');
  assert.equal(pts([aha, mk('s', 'Écran SPF 50', 'other', ['morning'], ['Aqua'])], 'R3').length, 1, 'le nom ou la catégorie « Autre » ne prouve rien : seule la catégorie déclarée compte');
  assert.equal(pts([mk('a', 'Niacinamide', 'serum', ['morning'], ['Niacinamide'])], 'R3').length, 0, 'aucune fiche ne demande de protection solaire');
  assert.equal(pts([mk('a', 'Hydratant', 'moisturizer', ['morning'], ['Glycerin', 'Aqua'])], 'R3').length, 0);
  assert.equal(pts([mk('a', 'Rétinol', 'serum', ['evening'], ['Retinol'])], 'R3').length, 1, 'rétinoïde : fiche à valider, niveau indiqué');
  assert.match(pts([mk('a', 'Rétinol', 'serum', ['evening'], ['Retinol'])], 'R3')[0].why.validation, /Rétinoïdes?.*source à ajouter, fiche à valider|source à ajouter/i);
  assert.equal(pts([aha, mk('r', 'Rétinol', 'serum', ['evening'], ['Retinol'])], 'R3').length, 1, 'un seul message pour plusieurs actifs');
  assert.equal(pts([mk('a', 'Peeling', 'serum', ['evening'], [])], 'R3').length, 0, 'composition inconnue : aucune précaution déduite');
});

test('VE10 R4 : composition inconnue ou sans aucun ingrédient reconnu = vérification impossible ou limitée ; rien si au moins un ingrédient est reconnu', () => {
  const unk = pts([mk('a', 'Sans liste', 'serum', ['morning'], [])], 'R4'); assert.equal(unk.length, 1); assert.match(unk[0].title, /Composition inconnue/);
  const none = pts([mk('b', 'Liste inconnue', 'serum', ['morning'], ['Aqua', 'Parfum', 'Phenoxyethanol'])], 'R4'); assert.equal(none.length, 1); assert.match(none[0].title, /Aucun ingrédient reconnu/); assert.match(none[0].text, /ni bons ni mauvais/);
  assert.equal(pts([mk('c', 'Liste', 'serum', ['morning'], ['Aqua', 'Glycerin'])], 'R4').length, 0);
  assert.equal(pts([mk('d', 'Substance', 'serum', ['morning'], ['Hydroquinone'])], 'R4').length, 0, 'une substance de EXCLUDED est « reconnue » : seul le message de prudence s\'applique');
});

test('VE11 R5 : vitamine C et rétinoïde au même moment = « à valider », jamais une incompatibilité établie', () => {
  const rule = A.CONFLICT_RULES.find(r => r.id === 'vitamin_c_retinoid'); assert.equal(rule.status, 'à_valider');
  const pos = pts([mk('a', 'Vit C', 'serum', ['morning', 'evening'], ['Ascorbic Acid']), mk('b', 'Rétinol', 'serum', ['evening'], ['Retinol'])], 'R5');
  assert.equal(pos.length, 1); assert.equal(pos[0].id, 'R5:evening'); assert.equal(pos[0].level, 'to_validate'); assert.equal(pos[0].levelLabel, 'À valider');
  assert.match(pos[0].text, /n'a pas validé de règle à ce sujet et n'en tire aucune conclusion/); assert.match(pos[0].why.validation, /À valider/); assert.equal(pos[0].why.rule, rule.text);
  assert.ok(!pos.some(p => p.level === 'precaution' || p.level === 'prudence'));
  assert.equal(pts([mk('a', 'Vit C', 'serum', ['morning'], ['Ascorbic Acid']), mk('b', 'Rétinol', 'serum', ['evening'], ['Retinol'])], 'R5').length, 0, 'créneaux différents');
  assert.equal(pts([mk('a', 'Vit C', 'serum', ['evening'], ['Ascorbic Acid'])], 'R5').length, 0);
  assert.equal(pts([mk('a', 'Les deux', 'serum', ['evening'], ['Ascorbic Acid', 'Retinol'])], 'R5').length, 1, 'dans un même produit');
  assert.equal(pts([mk('a', 'Vit C', 'serum', ['morning', 'evening'], ['Ascorbic Acid']), mk('b', 'Rétinol', 'serum', ['morning', 'evening'], ['Retinol'])], 'R5').length, 2, 'matin et soir, chacun signalé');
  const saved = rule.status; rule.status = 'validated';
  try { assert.equal(pts([mk('a', 'V', 'serum', ['evening'], ['Ascorbic Acid']), mk('b', 'R', 'serum', ['evening'], ['Retinol'])], 'R5')[0].level, 'precaution', 'le niveau suit le statut de la règle'); } finally { rule.status = saved; }
});

test('VE12 substances EXCLUDED : message de prudence neutre, sans recommandation supplémentaire ; aucune autre détection par ressemblance', () => {
  const r = pts([mk('a', 'Crème', 'moisturizer', ['evening'], ['Aqua', 'Hydroquinone', 'Mercuric Chloride'])], 'EXCLUDED');
  assert.equal(r.length, 2); r.forEach(p => { assert.equal(p.level, 'prudence'); assert.match(p.text, /fait partie des substances sur lesquelles DERMAI ne donne pas de conseil\. Demandez l'avis d'un professionnel \(pharmacien, médecin\)\.$/); });
  assert.ok(r[0].text.startsWith('« Hydroquinone »')); assert.match(r[0].why.source, /EXCLUDED/);
  assert.equal(pts([mk('a', 'Crème', 'moisturizer', ['evening'], ['Hydroxyethylcellulose', 'Hydrogenated Lecithin', 'Mercaptoethanol'])], 'EXCLUDED').length, 0);
  assert.equal(E.analyze([mk('a', 'Crème', 'moisturizer', ['evening'], ['Hydroquinone'])]).points[0].level, 'prudence', 'la prudence passe avant les autres niveaux');
});

test('VE13 fréquence : seulement la fiche d\'UN actif ciblé validé ; jamais globale pour plusieurs actifs ; jamais inventée', () => {
  const sal = A.ACTIVES.find(a => a.id === 'salicylic');
  const f = id => E.analyze([mk('a', 'P', 'serum', ['evening'], id)]).products[0].frequency;
  const one = f(['Aqua', 'Salicylic Acid 2%']);
  assert.equal(one.kind, 'single'); assert.equal(one.text, sal.introduction.frequency, 'identique à la fiche, jamais reformulée ni calculée'); assert.equal(one.activeId, 'salicylic');
  assert.equal(f(['Niacinamide', 'Salicylic Acid']).kind, 'multiple'); assert.deepEqual(f(['Niacinamide', 'Salicylic Acid']).text, undefined);
  assert.equal(f(['Retinol']).kind, 'unvalidated', 'fiche à valider : aucun repère'); assert.equal(f(['Retinol']).text, undefined);
  assert.equal(f(['Glycerin', 'Hyaluronic Acid']).kind, 'none', 'hydratants : aucune fréquence');
  assert.equal(f(['Aqua', 'Parfum']).kind, 'none'); assert.equal(f([]).kind, 'unknown');
  const texts = new Set(A.ACTIVES.map(a => a.introduction && a.introduction.frequency).filter(Boolean));
  for (const c of CATALOG.filter(p => p.inci)) { const x = E.analyze([mk('c', 'Cat', 'serum', ['morning'], c.inci)]).products[0].frequency; if (x.text) assert.ok(texts.has(x.text), c.id); }
});

test('VE14 précautions : celles des fiches seulement, pour les actifs reconnus ; la phrase « aucune précaution particulière » n\'est pas une précaution', () => {
  const x = E.analyze([mk('a', 'P', 'serum', ['evening'], ['Glycolic Acid', 'Glycerin', 'Aqua'])]).products[0];
  const aha = A.ACTIVES.find(a => a.id === 'aha_pha');
  assert.deepEqual(x.cautions.map(c => c.activeId), ['aha_pha']); assert.deepEqual(x.cautions[0].texts, aha.cautions);
  assert.deepEqual(E.analyze([mk('a', 'P', 'moisturizer', ['evening'], ['Glycerin'])]).products[0].cautions, []);
  assert.deepEqual(E.analyze([mk('a', 'P', 'serum', ['evening'], ['Parfum'])]).products[0].cautions, [], 'ingrédient non reconnu : aucune précaution inventée');
});

test('VE15 chaque point porte motif, source et validation ; ordre par gravité ; moteur pur et déterministe', () => {
  const routine = [mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid', 'Aqua']), mk('b', 'BHA', 'serum', ['evening'], ['Salicylic Acid']), mk('c', 'Vit C', 'serum', ['morning', 'evening'], ['Ascorbic Acid', 'Niacinamide']),
    mk('d', 'Rétinol', 'serum', ['evening'], ['Retinol', 'Niacinamide']), mk('e', 'Nom seul', 'other', ['morning'], []), mk('f', 'Crème', 'moisturizer', ['evening'], ['Hydroquinone']), mk('g', 'Irritant', 'serum', ['morning'], ['Aqua'], { irritated: true })];
  const frozen = JSON.parse(JSON.stringify(routine)); routine.forEach(p => { Object.freeze(p); Object.freeze(p.inci); Object.freeze(p.slots); });
  const r1 = E.analyze(routine), r2 = E.analyze(JSON.parse(JSON.stringify(frozen)));
  assert.deepEqual(r1, r2, 'même entrée, même sortie'); assert.deepEqual(JSON.parse(JSON.stringify(routine)), frozen, 'entrée non modifiée');
  const rank = { prudence: 0, precaution: 1, to_validate: 2, info: 3, missing: 4 };
  assert.deepEqual(r1.points.map(p => rank[p.level]), r1.points.map(p => rank[p.level]).slice().sort((x, y) => x - y));
  assert.deepEqual([...new Set(r1.points.map(p => p.rule))].sort(), ['EXCLUDED', 'R1', 'R2', 'R3', 'R4', 'R5', 'USER'].sort());
  for (const p of r1.points) { assert.ok(p.id && p.title && p.text && p.levelLabel, p.id); assert.ok(p.why.rule && p.why.source && p.why.validation, `motif, source, validation : ${p.id}`); assert.ok(Array.isArray(p.productIds) && p.productIds.length, p.id); }
  assert.equal(new Set(r1.points.map(p => p.id)).size, r1.points.length, 'identifiants uniques');
  assert.deepEqual(E.analyze(null).points, []); assert.deepEqual(E.analyze([null, {}, 'x']).products, []);
  assert.equal(E.analyze(Array.from({ length: 30 }, (_, i) => mk('p' + i, 'P' + i, 'serum', ['morning'], ['Aqua']))).products.length, E.MAX_PRODUCTS);
});

test('VE16 ordre matin / soir : ordre DERMAI des catégories, « Autre » à la fin, créneaux respectés', () => {
  const list = ['spf', 'other', 'moisturizer', 'cleanser', 'serum'].map((c, i) => E.cleanProduct(mk('p' + i, c, c, i === 0 ? ['morning'] : ['morning', 'evening'], [])));
  assert.deepEqual(E.bySlot(list, 'morning').map(p => p.category), ['cleanser', 'serum', 'moisturizer', 'spf', 'other']);
  assert.deepEqual(E.bySlot(list, 'evening').map(p => p.category), ['cleanser', 'serum', 'moisturizer', 'other']);
  assert.deepEqual(E.bySlot([], 'morning'), []);
});

test('VE17 le catalogue vérifié est exploitable tel quel : chaque produit utilisable entre dans la routine et s\'analyse sans erreur', () => {
  const usable = CATALOG.filter(p => p.active !== false && p.status !== 'to_verify' && Array.isArray(p.inci) && p.inci.length);
  assert.equal(usable.length, 11);
  for (const c of usable) {
    const name = `${c.brand} ${c.name}`;
    assert.ok(name.length <= E.MAX_NAME, `nom assez court : ${name}`); assert.ok(c.inci.length <= E.MAX_INCI && c.inci.every(t => t.length <= E.MAX_TOKEN), c.id);
    const p = E.cleanProduct({ id: 'x' + c.id.slice(0, 20), name, category: c.category, slots: ['morning'], inci: c.inci, origin: { kind: 'catalog', productId: c.id, label: c.sources[0].label, checkedAt: c.sources[0].checkedAt } });
    assert.ok(p && p.origin.kind === 'catalog' && p.inci.length === new Set(c.inci.map(E.normalizeName)).size, c.id);
    const a = E.analyzeProduct(p); assert.ok(a.known && a.actives.length >= 1, `au moins un actif reconnu : ${c.id}`); assert.equal(a.excluded.length, 0, c.id);
    /* Chaque actif validé que le catalogue relie au produit est reconnu dans son INCI, sauf un cas connu et documenté : « Céramides » du produit The Ordinary HA + B5, dont l'INCI
       ne liste que « Phospholipids » et « Sphingolipids » : DERMAI ne devine pas, l'actif reste non reconnu pour ce produit. */
    for (const link of c.ingredients.filter(i => i.activeId && A.ACTIVES.find(x => x.id === i.activeId).status === 'validated')) {
      const known = c.id === 'to-hyaluronic-b5-ceramides' && link.activeId === 'ceramides';
      assert.equal(a.actives.some(x => x.id === link.activeId), !known, `${c.id} : actif ${link.activeId}`);
    }
  }
});

test('VE18 textes : aucun mot absolu, médical ou promesse ; le message d\'avertissement est présent ; pas de tiret cadratin', () => {
  const routine = [mk('a', 'Peeling', 'serum', ['evening'], ['Glycolic Acid']), mk('b', 'BHA', 'serum', ['evening'], ['Salicylic Acid']), mk('c', 'Vit C', 'serum', ['morning', 'evening'], ['Ascorbic Acid']),
    mk('d', 'Rétinol', 'serum', ['evening'], ['Retinol']), mk('e', 'Nom seul', 'other', ['morning'], []), mk('f', 'Crème', 'moisturizer', ['evening'], ['Hydroquinone']), mk('g', 'Irritant', 'serum', ['morning'], ['Aqua'], { irritated: true }),
    mk('h', 'Niacine 1', 'serum', ['morning'], ['Niacinamide']), mk('i', 'Niacine 2', 'serum', ['evening'], ['Niacinamide'])];
  const strings = [];
  const walk = v => { if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  /* Textes réellement affichés : points d'attention, textes de l'écran, et les champs des fiches d'actifs que l'écran montre (nom, résumé, précautions, repère de fréquence). */
  walk(E.analyze(routine).points); const UI = require('../js/verif-routine.js'); walk(UI.COPY); strings.push(E.DISCLAIMER); walk(E.LEVEL_LABEL);
  walk(A.ACTIVES.map(a => ({ label: a.label, summary: a.summary, cautions: a.cautions, introduction: a.introduction })));
  const body = strings.join('\n').split(E.DISCLAIMER).join('');
  assert.doesNotMatch(body, /diagnostic|gravité|maladie|traiter|traitement|médical|guéri|guérison|disparition|disparaît|garanti|favorable|résultat assuré|élimine|miracle|définitiv|sans risque|prouvé|efficacité|efficace|sûr\b/i, 'aucun mot absolu ou médical hors de l\'avertissement');
  assert.match(E.DISCLAIMER, /n'est pas un avis médical/); assert.match(E.DISCLAIMER, /ne promet pas qu'un produit soit sûr ou efficace/);
  assert.ok(!/ — | – /.test(strings.join('\n')), 'pas de tiret cadratin');
  assert.ok(!/incompatib/i.test(E.analyze(routine).points.filter(p => p.rule !== 'R1').map(p => p.text).join(' ')), 'aucun point autre que R1 ne parle d\'incompatibilité');
});

test('VE19 le moteur et les alias n\'ont aucun accès réseau, stockage, horloge ni hasard', () => {
  for (const f of ['js/engine/verif.js', 'js/engine/data/inci-aliases.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|Date\.now|new Date|Math\.random|document\.|window\./.test(src), f);
  }
});
