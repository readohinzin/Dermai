'use strict';
/* 6D : preuves, sécurité des actifs irritants et combinaisons. Trois niveaux distincts : (A) mesure Perfect Corp, (B) preuve cosmétique,
   (C) règle DERMAI. Aucune source n'est inventée : les URL citées doivent être dans la liste des pages réellement consultées. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, run, randomCase, withStatus } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const pdata = require('../js/engine/data/products.js');
const actives = require('../js/engine/actives.js');
const copy = require('../js/engine/copy.fr.js');

const CONSULTED = new Set([
  'https://practicaldermatology.com/topics/esthetics-cosmeceuticals/niacinamide-a-multi-functional-cosmeceutical-ingredient/23720/',
  'https://pubmed.ncbi.nlm.nih.gov/1535287/',
  'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1060517/sag-cs-opinion-05-salicylic-acid-in-cosmetics.pdf',
  'https://jddonline.com/articles/dermatology/S1545961615P0964X',
  'https://www.jabfm.org/content/29/2/254.full.txt',
  'https://jcadonline.com/topical-vitamin-c-and-the-skin/',
  'https://pmc.ncbi.nlm.nih.gov/articles/PMC5605218/',
  'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids',
  'https://scholarlyworks.lvhn.org/medicine/6079',
  'https://www.mdpi.com/2079-9284/10/5/131',
  'https://english.prescrire.org/en/81/168/46046/0/PositionDetails.aspx',
  'https://pubmed.ncbi.nlm.nih.gov/35289059/'
]);
const tids = r => r.activePlan.treatments.map(t => t.activeId);
const withPref = (over, fn) => {
  const saved = {};
  for (const k of Object.keys(over)) { saved[k] = data.PREFERENCE[k]; data.PREFERENCE[k] = over[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) data.PREFERENCE[k] = saved[k]; }
};

test('EV1 chaque actif porte une preuve structurée cohérente avec ses cibles ; rien d\'inventé', () => {
  for (const a of data.ACTIVES.filter(x => x.status === 'validated')) {
    const e = a.evidence;
    assert.ok(e && ['sourced', 'partial', 'to_add'].includes(e.sourceStatus), a.id);
    const all = [...e.direct, ...e.indirect, ...e.editorial].sort();
    assert.deepEqual(all, [...a.targets].sort(), a.id + ' : chaque cible est classée (direct, indirect ou règle DERMAI)');
    for (const r of e.refs) { assert.ok(CONSULTED.has(r.url), a.id + ' : URL non consultée ' + r.url); assert.ok(r.label && r.supports && r.quality, a.id); }
    if (e.sourceStatus === 'to_add') assert.match(a.source, /SOURCE À AJOUTER/, a.id);
    else assert.ok(e.refs.length > 0 && e.direct.length + e.indirect.length > 0, a.id + ' : une source doit soutenir au moins une cible');
    assert.doesNotMatch(a.source, /Connaissance cosmétique générale/);
  }
});

test('EV2 les actifs « à_valider » n\'ont aucune source retenue et ne sont jamais sélectionnés (6000 profils)', () => {
  const pending = data.ACTIVES.filter(a => a.status === 'à_valider');
  assert.ok(pending.length >= 5);
  for (const a of pending) { assert.equal(a.evidence.sourceStatus, 'to_add'); assert.deepEqual([...a.evidence.direct, ...a.evidence.indirect], []); }
  const bad = new Set(pending.map(a => a.id));
  for (let seed = 1; seed <= 6000; seed++) {
    const c = randomCase(seed * 11 + 5), r = run(c.ui, c.o, c.profile);
    for (const t of [...r.activePlan.treatments, ...r.activePlan.supports]) assert.ok(!bad.has(t.activeId), `seed ${seed} ${t.activeId}`);
  }
});

test('EV3 les cibles « règle DERMAI » ne sont jamais présentées comme une relation établie ; rien n\'est attribué à Perfect Corp', () => {
  const r = run({ texture: 30 });
  const step = r.routinePlan.slots.evening.concat(r.routinePlan.slots.morning).find(s => s.kind === 'treatment' && s.activeId === 'niacinamide');
  assert.match(step.reason, /option cosmétique courante/);
  const solid = run({ acne: 30 }).routinePlan.slots.evening.find(s => s.kind === 'treatment');
  assert.doesNotMatch(solid.reason, /option cosmétique courante/);
  assert.doesNotMatch(JSON.stringify(r.explanations) + JSON.stringify(r.routinePlan), /Perfect Corp|YouCam/i);
  assert.match(copy.activeReason(['Texture'], false, ['Texture']), /\(option cosmétique courante\)/);
});

test('EV4 aucun médicament : exclusions explicites, rien dans les actifs ni dans les produits ; libellés neutres', () => {
  for (const x of ['hydroquinone', 'corticoids', 'adapalene', 'tretinoin']) assert.ok(data.EXCLUDED.includes(x), x);
  const MED = /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon|isotr[ée]tino|tazarot|mercure/i;
  for (const a of data.ACTIVES) assert.doesNotMatch([a.label, a.summary, a.description, a.cautions.join(' ')].join(' '), MED, a.id);
  for (const p of pdata.PRODUCTS) assert.doesNotMatch([p.name, ...p.ingredients.map(i => i.label)].join(' '), MED, p.id);
  assert.equal(actives.byId('retinoid').label, 'Rétinoïde cosmétique');
  assert.match(actives.byId('retinoid').description, /jamais un médicament/);
  assert.equal(actives.byId('aha_pha').label, 'Exfoliants chimiques AHA ou PHA');
  assert.doesNotMatch(actives.byId('aha_pha').label + actives.byId('aha_pha').description, /doux/i);
});

test('EV5 combinaisons : un seul exfoliant ou rétinoïde par soir, appliqué par le moteur (pas seulement affiché)', () => {
  const pairs = [
    [{ acne: ['salicylic'], texture: ['aha_pha'] }, { acne: 30, texture: 30 }, 'aha_pha'],
    [{ acne: ['salicylic'], wrinkles: ['retinoid'] }, { acne: 30, wrinkles: 30 }, 'retinoid'],
    [{ texture: ['aha_pha'], wrinkles: ['retinoid'] }, { texture: 30, wrinkles: 30 }, 'retinoid']
  ];
  for (const [pref, ui, dropped] of pairs) withStatus('retinoid', 'validated', () => withPref(pref, () => {
    const r = run(ui, {}, { level: 'full' });
    assert.ok(!tids(r).includes(dropped), dropped);
    assert.ok(r.activePlan.deferred.some(d => d.activeId === dropped && ['conflict', 'duplicate'].includes(d.kind)), dropped);   // même rôle (exfoliation) ou même groupe fort
    assert.equal(r.routinePlan.slots.evening.filter(s => s.kind === 'treatment' && actives.byId(s.activeId).groups.length).length, 1);
  }));
});

test('EV6 l\'azélaïque n\'est pas le « deuxième exfoliant » : il se combine avec un exfoliant ou un rétinoïde, sans interdiction générale', () => {
  withPref({ acne: ['salicylic'], redness: ['azelaic'] }, () => {
    const r = run({ acne: 30, redness: 40 }, {}, { level: 'full' });
    assert.deepEqual(tids(r).sort(), ['azelaic', 'salicylic']);
  });
  withStatus('retinoid', 'validated', () => withPref({ wrinkles: ['retinoid'], redness: ['azelaic'] }, () => {
    const r = run({ wrinkles: 30, redness: 40 }, {}, { level: 'full' });
    assert.deepEqual(tids(r).sort(), ['azelaic', 'retinoid']);
  }));
  assert.deepEqual(actives.byId('azelaic').groups, []);
});

test('EV7 l\'azélaïque est atteignable dans le scénario prévu (acné, exfoliant déjà utilisé) et reste écarté en mode confort', () => {
  assert.deepEqual(tids(run({ acne: 30 }, {}, { cats: ['exfoliant'] })), ['azelaic']);
  const c = run({ acne: 30 }, { skin: 'Redness' }, { cats: ['exfoliant'] });
  assert.ok(!tids(c).includes('azelaic'));
});

test('EV8 rougeurs « À soutenir » sans mode confort : prudence renforcée (introduction plus lente) pour un actif exigeant', () => {
  const soft = run({ acne: 30, redness: 45 }, {}, { level: 'simple' });
  const st = soft.routinePlan.slots.evening.find(s => s.kind === 'treatment' && s.activeId === 'salicylic');
  assert.equal(st.slowDown, true);
  assert.ok(soft.routinePlan.notes.some(n => /à la fois/.test(n)));
  const fine = run({ acne: 30, redness: 90 }, {}, { level: 'simple' });
  assert.equal(fine.routinePlan.slots.evening.find(s => s.activeId === 'salicylic').slowDown, false);
});

test('EV9 skin_age et all n\'influencent jamais le choix des actifs ni le niveau de routine', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const c = randomCase(seed * 3), a = run(c.ui, { ...c.o, age: 20, global: 10 }, c.profile), b = run(c.ui, { ...c.o, age: 75, global: 95 }, c.profile);
    assert.deepEqual(a.activePlan, b.activePlan);
    assert.deepEqual(a.priorities, b.priorities);
    assert.deepEqual(a.routinePlan.slots, b.routinePlan.slots);
  }
});

test('EV10 simulation 6000 profils : exfoliants, médicaments, textes générés', () => {
  const MED = /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon/i;
  const DIAG = /(?<![\p{L}])(diagnostic(?!\s+m[ée]dical)|maladie|pathologi\w*|gu[ée]ri\w*|traitement\w*|prescri\w*|hyperpigmentation|inflamm\w*)(?![\p{L}])/iu;
  for (let seed = 1; seed <= 6000; seed++) {
    const c = randomCase(seed * 13 + 1), r = run(c.ui, c.o, c.profile);
    const t = r.activePlan.treatments;
    assert.ok(t.filter(x => actives.byId(x.activeId).role === 'exfoliation').length <= 1, `seed ${seed} double exfoliation`);
    assert.ok(t.filter(x => actives.byId(x.activeId).groups.includes('evening_strong')).length <= 1, `seed ${seed} double fort`);
    const texts = JSON.stringify([r.explanations.map(e => e.text), r.routinePlan.notes, r.routinePlan.summary, r.routinePlan.slots]);
    assert.doesNotMatch(texts, MED, `seed ${seed}`);
    assert.doesNotMatch(texts.replace(/n'est pas un diagnostic médical/g, ''), DIAG, `seed ${seed} ${(texts.match(DIAG) || [])[0]}`);
    assert.doesNotMatch(texts, /\d\s?%\s?(de )?(correspondance|compatib)/i, `seed ${seed}`);
  }
});
