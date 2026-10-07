'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, Engine, norm, run, randomCase } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const actives = require('../js/engine/actives.js');
const products = require('../js/engine/products.js');

const steps = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
const treat = r => steps(r).filter(s => s.kind === 'treatment');
const kinds = (r, slot) => r.routinePlan.slots[slot].map(s => s.kind);
const WEAK = { acne: 30, pigmentation: 40, wrinkles: 45, redness: 50 };

test('RO1 routine minimale possible : maintenance → nettoyage, hydratation, protection solaire, rien d\'autre', () => {
  const r = run({});
  assert.deepEqual(kinds(r, 'morning'), ['cleanse', 'moisturize', 'spf']);
  assert.deepEqual(kinds(r, 'evening'), ['cleanse', 'moisturize']);
  assert.equal(r.routinePlan.mode, 'maintenance');
  assert.match(r.routinePlan.summary, /routine d'entretien/);
});

test('RO2 niveau de routine : aucune → 1 soin ciblé au plus, simple → 2, complète → 3 ; niveau inconnu → simple', () => {
  const ui = { acne: 30, pigmentation: 40, redness: 50 };
  const cap = { none: 1, simple: 2, full: 3 };
  for (const [level, n] of Object.entries(cap)) {
    const r = run(ui, {}, { level });
    assert.ok(treat(r).length <= n, level);
    assert.equal(treat(r).length, n, level);
    assert.equal(r.routinePlan.level, level);
  }
  assert.equal(run(ui, {}, { level: 'zzz' }).routinePlan.level, 'simple');
  assert.equal(run(ui, {}, { level: '' }).routinePlan.level, 'simple');
  assert.ok(run(ui, {}, { level: 'none' }).routinePlan.notes[0].includes('minimale'));
});

test('RO3 jamais de longue routine : peu d\'étapes par créneau quels que soient les scores (300 jeux)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile), cap = data.LIMITS[r.profile.level];
    for (const slot of ['morning', 'evening']) {
      const list = r.routinePlan.slots[slot];
      assert.ok(list.filter(s => s.kind === 'treatment').length <= cap.perSlot, `seed ${seed} ${slot} perSlot`);
      assert.ok(list.length <= 3 + cap.perSlot + 1, `seed ${seed} ${slot} longueur`);
    }
    assert.ok(treat(r).length <= cap.treatments, `seed ${seed}`);
    assert.ok(steps(r).length <= 12);
  }
});

test('RO4 protection solaire le matin seulement ; nettoyage et hydratation matin et soir', () => {
  const r = run(WEAK);
  assert.ok(kinds(r, 'morning').includes('spf'));
  assert.ok(!kinds(r, 'evening').includes('spf'));
  for (const slot of ['morning', 'evening']) { assert.ok(kinds(r, slot).includes('cleanse')); assert.ok(kinds(r, slot).includes('moisturize')); }
  assert.deepEqual(kinds(r, 'morning')[0], 'cleanse');
  assert.deepEqual(kinds(r, 'morning').slice(-2), ['moisturize', 'spf']);
});

test('RO5 soins ciblés placés dans leur créneau (vitamine C le matin, salicylique le soir), un seul exfoliant ou rétinoïde par soir', () => {
  const r = run({ acne: 30, wrinkles: 40 }, {}, { level: 'full' });
  const by = id => treat(r).find(s => s.activeId === id);
  assert.equal(by('salicylic').slot, 'evening');
  assert.equal(by('vitamin_c').slot, 'morning');
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed), x = run(c.ui, c.o, c.profile);
    const strong = x.routinePlan.slots.evening.filter(s => s.kind === 'treatment' && actives.byId(s.activeId).groups.includes('evening_strong'));
    assert.ok(strong.length <= 1, 'seed ' + seed);
  }
});

test('RO6 niveau « routine complète » : un créneau peut recevoir deux soins ; sinon un seul par créneau (créneau chargé → écarté ou déplacé)', () => {
  const ui = { acne: 30, pigmentation: 40, redness: 50 };       // salicylique (soir), vitamine C (matin), niacinamide (matin ou soir)
  const simple = run(ui, {}, { level: 'simple' });
  for (const slot of ['morning', 'evening']) assert.ok(simple.routinePlan.slots[slot].filter(s => s.kind === 'treatment').length <= 1);
  const full = run(ui, {}, { level: 'full' });
  assert.equal(treat(full).length, 3);
  const morning = full.routinePlan.slots.morning.filter(s => s.kind === 'treatment');
  assert.ok(morning.length <= 2);
});

test('RO7 produits déjà utilisés : l\'étape est marquée « déjà utilisée » et ne reçoit aucun produit proposé', () => {
  const r = run(WEAK, {}, { cats: ['cleanser', 'moisturizer', 'spf'] });
  for (const s of steps(r).filter(x => ['cleanse', 'moisturize', 'spf'].includes(x.kind))) {
    assert.equal(s.owned, true, s.id);
    assert.match(s.reason, /déjà cette catégorie/);
    assert.ok(!r.productMatches.some(m => m.stepId === s.id), s.id);
  }
  const none = run(WEAK, {}, { cats: [] });
  assert.ok(steps(none).filter(x => ['cleanse', 'moisturize', 'spf'].includes(x.kind)).every(s => s.owned === false));
});

test('RO8 type de peau : texture de l\'hydratant adaptée, jamais une règle de classement', () => {
  const tex = skin => run({}, { skin }).routinePlan.slots.morning.find(s => s.kind === 'moisturize').texture;
  assert.match(tex('Oily'), /adaptée à votre peau/);          // aucune promesse de texture (ni « légère », ni « non comédogène »)
  assert.match(tex('Dry'), /plus riche/);
  assert.match(tex('Combination'), /adaptée à votre peau/);
  assert.match(tex('Normal'), /standard/);
  assert.match(tex(null), /adaptée à votre peau/);
  assert.match(tex('Redness'), /adaptée à votre peau/);
});

test('RO9 mode confort et peau sèche : notes de prudence, introduction ralentie pour les actifs exigeants', () => {
  const c = run({ wrinkles: 40 }, { skin: 'Dry & Redness' });
  assert.ok(c.routinePlan.notes.some(n => /privilégier le confort/.test(n)));
  assert.ok(c.routinePlan.notes.some(n => /espacer davantage/.test(n)));
  assert.equal(c.routinePlan.comfortMode, true);
  const t = treat(c)[0];
  assert.equal(t.slowDown, true);
  assert.match(t.reason, /très doucement/);
  const std = run({ wrinkles: 40 }, { skin: 'Normal' });
  assert.equal(treat(std)[0].slowDown, false);
  assert.ok(!std.routinePlan.notes.some(n => /confort|espacer/.test(n)));
});

test('RO10 un nouvel actif à la fois : la note est présente dès qu\'un actif exigeant ou plusieurs soins sont prévus', () => {
  assert.ok(run({ acne: 30, wrinkles: 40 }, {}, { level: 'full' }).routinePlan.notes.includes(require('../js/engine/copy.fr.js').NOTES.oneAtATime));
  assert.ok(!run({}).routinePlan.notes.includes(require('../js/engine/copy.fr.js').NOTES.oneAtATime));
});

test('RO11 produits : reliés par activeId (jamais par texte), sans score ni pourcentage, marqués démonstration', () => {
  const r = run({ acne: 30, wrinkles: 40 }, {}, { level: 'full' });
  assert.ok(r.productMatches.length > 0);
  for (const m of r.productMatches) {
    assert.equal(m.demo, true);
    assert.deepEqual(Object.keys(m).sort(), ['activeIds', 'because', 'demo', 'kind', 'productId', 'stepId']);
    const p = products.byId(m.productId), step = steps(r).find(s => s.id === m.stepId);
    assert.ok(p, m.productId);
    if (step.kind === 'treatment') assert.ok(products.ids(p).includes(step.activeId), `${m.stepId} → ${p.id}`);
    assert.equal(JSON.stringify(m).includes('%'), false);
  }
  for (const p of products.PRODUCTS) { assert.equal('match' in p, false); assert.equal(p.demo, true); assert.equal(p.vendor, null); assert.equal(p.url, null); assert.equal(p.availability, null); }
  const sal = r.productMatches.find(m => m.stepId === 'evening:treatment:salicylic');
  assert.equal(sal.productId, 'p4');
});

test('RO12 mode confort : aucun produit contenant un actif plus exigeant que celui du pas (ni cachés dans un autre produit)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    for (const m of r.productMatches) {
      const step = steps(r).find(s => s.id === m.stepId), p = products.byId(m.productId);
      if (r.routinePlan.comfortMode) for (const id of products.ids(p)) if (id !== step.activeId) assert.equal(actives.byId(id).irritation, 'low', `seed ${seed} ${p.id} ${id}`);
      const strongEvening = r.routinePlan.slots.evening.some(s => s.kind === 'treatment' && actives.byId(s.activeId).groups.length);
      if (step.kind !== 'treatment' && step.slot === 'evening' && strongEvening) assert.ok(!products.ids(p).some(id => actives.byId(id) && actives.byId(id).groups.length), `seed ${seed} ${p.id}`);
    }
  }
});

test('RO13 hydratation : l\'hydratant proposé contient au moins un ingrédient recherché (si un produit en contient)', () => {
  const r = run({ hydration: 25 });
  const step = r.routinePlan.slots.morning.find(s => s.kind === 'moisturize');
  assert.deepEqual(step.supportIds, ['hyaluronic', 'ceramides']);
  const m = r.productMatches.find(x => x.stepId === 'morning:moisturize');
  assert.ok(m.activeIds.length > 0);
  assert.match(m.because, /^Contient : /);
});

test('RO14 données absentes : routine toujours produite, sans NaN ni valeur inventée', () => {
  const r = Engine.run(null, null);
  assert.equal(r.routinePlan.mode, 'maintenance');
  assert.equal(JSON.stringify(r).includes('NaN'), false);
  assert.equal(JSON.stringify(r).includes('undefined'), false);
  assert.ok(r.routinePlan.slots.morning.length >= 3);
});

test('RO15 un produit n\'introduit jamais un actif non prévu : p1 (salicylique) n\'est jamais un nettoyant (400 jeux)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    const planned = new Set(treat(r).map(s => s.activeId));
    for (const m of r.productMatches) {
      const step = steps(r).find(s => s.id === m.stepId), p = products.byId(m.productId);
      if (step.kind !== 'treatment') assert.ok(products.ids(p).every(id => actives.byId(id).kind === 'support'), `seed ${seed} ${p.id} sur ${step.kind}`);
      else for (const id of products.ids(p)) if (id !== step.activeId) {
        const a = actives.byId(id);
        assert.ok(a.groups.length === 0 && (a.kind === 'support' || planned.has(id)), `seed ${seed} ${p.id} ${id}`);
      }
    }
  }
  const r = run({ acne: 20, pores: 25 }, {}, { level: 'full' });
  assert.ok(!r.productMatches.some(m => m.productId === 'p1'));
});

test('RO16 créneaux : la niacinamide (flexible) ne prend pas le matin de la vitamine C (contrainte)', () => {
  const r = run({ pores: 30, pigmentation: 40 }, {}, { level: 'simple' });
  const at = id => treat(r).find(s => s.activeId === id);
  assert.equal(at('vitamin_c').slot, 'morning');
  assert.equal(at('niacinamide').slot, 'evening');
  assert.equal(r.routinePlan.deferred.some(d => d.kind === 'slot'), false);
});

test('RO17 créneaux : vitamine C matin, exfoliants et rétinoïde soir, un seul fort par soir (300 jeux)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    for (const s of treat(r)) {
      if (s.activeId === 'vitamin_c') assert.equal(s.slot, 'morning', 'seed ' + seed);
      if (actives.byId(s.activeId).groups.length) assert.equal(s.slot, 'evening', 'seed ' + seed);
    }
    assert.ok(treat(r).filter(s => actives.byId(s.activeId).groups.length).length <= 1);
  }
});

test('RO18 précaution « peaux qui marquent » dès qu\'un actif exigeant est placé', () => {
  const r = run({ acne: 30 });
  assert.ok(r.routinePlan.notes.some(n => /marque facilement/.test(n)));
  const soft = run({ hydration: 20 });
  assert.ok(!soft.routinePlan.notes.some(n => /marque facilement/.test(n)));
});
