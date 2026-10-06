'use strict';
/* 6D.1 : le rétinoïde cosmétique reste au catalogue (consultable) mais n'est jamais recommandé automatiquement tant qu'une source
   d'efficacité n'est pas retenue. Aucune donnée de santé (grossesse) n'est collectée, stockée ni déduite. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run, randomCase } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const pdata = require('../js/engine/data/products.js');
const actives = require('../js/engine/actives.js');

const tids = r => [...r.activePlan.treatments, ...r.activePlan.supports].map(t => t.activeId);
const ROOT = path.join(__dirname, '..');

test('RT1 rides et fermeté faibles : aucun rétinoïde auto-sélectionné (tous niveaux)', () => {
  for (const level of ['none', 'simple', 'full']) for (const v of [0, 15, 30, 50, 60])
    assert.ok(!tids(run({ wrinkles: v, firmness: v }, {}, { level })).includes('retinoid'), level + v);
  assert.ok(tids(run({ wrinkles: 20, firmness: 20 }, {}, { level: 'simple' })).includes('vitamin_c'), 'le moteur reste utile : autre levier validé');
});

test('RT2 texture faible : aucun rétinoïde auto-sélectionné', () => {
  for (const v of [0, 20, 40, 60]) assert.ok(!tids(run({ texture: v })).includes('retinoid'));
});

test('RT3 routine « none » et RT4 mode confort : aucun rétinoïde', () => {
  for (const ind of ['wrinkles', 'firmness', 'texture']) {
    assert.ok(!tids(run({ [ind]: 10 }, {}, { level: 'none' })).includes('retinoid'));
    for (const skin of ['Redness', 'Dry & Redness', 'Oily & Redness']) assert.ok(!tids(run({ [ind]: 10 }, { skin })).includes('retinoid'));
    assert.ok(!tids(run({ [ind]: 10, redness: 5 })).includes('retinoid'));
  }
});

test('RT5 score global très faible et RT6 âge cutané élevé : aucun rétinoïde', () => {
  for (const g of [0, 5, 20]) assert.ok(!tids(run({}, { global: g })).includes('retinoid'));
  for (const age of [60, 75, 90]) assert.ok(!tids(run({}, { age })).includes('retinoid'));
  const a = run({ wrinkles: 30 }, { global: 5, age: 80 }), b = run({ wrinkles: 30 }, { global: 95, age: 20 });
  assert.deepEqual(a.activePlan, b.activePlan);
});

test('RT7 le rétinoïde est au catalogue avec le statut « à_valider », consultable, sans médicament', () => {
  const r = actives.byId('retinoid');
  assert.ok(r);
  assert.equal(r.status, 'à_valider');
  assert.equal(r.consultable, true);
  assert.equal(r.label, 'Rétinoïde cosmétique');
  assert.equal(actives.isValidated(r), false);
  assert.match(r.cautions[0], /ne sont pas proposés automatiquement par DERMAI/);
  assert.match(r.cautions[0], /grossesse ou de projet de grossesse, demandez conseil à un professionnel de santé/);
  assert.doesNotMatch(r.cautions[0], /vous (êtes|etes)|votre grossesse/i, 'ne prétend pas connaître la situation de l\'utilisateur');
  assert.deepEqual(r.groups, ['evening_strong']);
  assert.equal(r.irritation, 'high');
  for (const x of ['tretinoin', 'adapalene', 'corticoids', 'hydroquinone']) assert.ok(data.EXCLUDED.includes(x));
  assert.doesNotMatch(JSON.stringify(r) + JSON.stringify(pdata.PRODUCTS), /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon|mercure/i);
});

test('RT8 aucun actif « à_valider » ne peut être auto-sélectionné, même placé en tête de préférence', () => {
  const pending = data.ACTIVES.filter(a => a.status === 'à_valider');
  assert.ok(pending.some(a => a.id === 'retinoid'));
  const saved = { ...data.PREFERENCE };
  try {
    for (const k of Object.keys(data.PREFERENCE)) data.PREFERENCE[k] = [...pending.filter(a => a.targets.includes(k)).map(a => a.id), ...data.PREFERENCE[k]];
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
      for (const id of tids(r)) assert.equal(actives.byId(id).status, 'validated', `seed ${seed} ${id}`);
    }
  } finally { Object.assign(data.PREFERENCE, saved); }
});

test('RT9 aucune donnée de santé : ni état de grossesse, ni champ de profil, ni stockage', () => {
  const files = ['js/app.js', 'js/skin-model.js', 'js/engine/index.js', 'js/engine/interpret.js', 'js/engine/actives.js', 'js/engine/routine.js', 'js/engine/priorities.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /pregnan(t|cy)[_a-z]*\s*[:=]|enceinte\s*[:=]|grossesse\s*[:=]|isPregnant|pregnancyStatus/i, f);
  }
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.doesNotMatch(app, /localStorage[^;\n]*(pregnan|grossesse)/i);
});

test('RT10 la fiche du rétinoïde reste accessible (consultation) avec la précaution, sans le proposer dans la routine', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.match(app, /A\.isValidated\(a\)\|\|a\.consultable/);
  const r = run({ wrinkles: 10, firmness: 10, texture: 10 }, {}, { level: 'full' });
  assert.ok(!JSON.stringify(r.routinePlan.slots).includes('retinoid'));
  assert.ok(!r.explanations.some(e => e.activeId === 'retinoid' && e.kind === 'active'));
});

test('RT11 simulation 6000 profils : 0 violation', () => {
  const eyes = ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
  const MED = /tr[ée]tino[iï]ne|adapal[eè]ne|cortico|hydroquinon|mercure/i;
  let n = 0, violations = [];
  for (let seed = 1; seed <= 6000; seed++) {
    const c = randomCase(seed * 17 + 9), r = run(c.ui, c.o, c.profile);
    n++;
    const ids = tids(r);
    if (ids.includes('retinoid')) violations.push(seed + ' rétinoïde');
    for (const id of ids) if (actives.byId(id).status !== 'validated') violations.push(seed + ' à_valider ' + id);
    if (MED.test(JSON.stringify([r.explanations, r.routinePlan, r.productMatches]))) violations.push(seed + ' médicament');
    const flip = run(c.ui, { ...c.o, global: 3, age: 88 }, c.profile), flip2 = run(c.ui, { ...c.o, global: 97, age: 18 }, c.profile);
    if (JSON.stringify(flip.activePlan) !== JSON.stringify(flip2.activePlan)) violations.push(seed + ' all/skin_age');
    for (const t of r.activePlan.treatments) if (t.indicators.some(i => eyes.includes(i))) violations.push(seed + ' yeux');
  }
  assert.equal(n, 6000);
  assert.deepEqual(violations, []);
});
