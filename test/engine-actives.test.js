'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { M, Engine, norm, run, ids, randomCase, withStatus, withRetinoidFirst } = require('./helpers/engine.js');
const data = require('../js/engine/data/actives.js');
const pdata = require('../js/engine/data/products.js');
const actives = require('../js/engine/actives.js');
const { interpret } = require('../js/engine/interpret.js');

const ctxOf = (ui, o) => interpret(norm(ui, o));
const sel = (items, o = {}, profile = {}) => actives.select(items.map(indicator => ({ indicator })), ctxOf({}, o), { level: 'simple', cats: [], ...profile });
const copyText = k => require('../js/engine/copy.fr.js').DEFERRED[k];
const tids = r => r.treatments.map(t => t.activeId);

test('AC1 intégrité du catalogue : statuts, sources, cautions, préférences cohérentes', () => {
  const seen = new Set();
  for (const a of data.ACTIVES) {
    assert.ok(!seen.has(a.id), 'id unique ' + a.id); seen.add(a.id);
    assert.ok(['validated', 'à_valider'].includes(a.status), a.id);
    for (const f of ['id', 'label', 'targets', 'objectives', 'confidence', 'status', 'source', 'cautions', 'when', 'introduction', 'kind', 'role', 'irritation'])
      assert.ok(f in a, `${a.id}.${f}`);
    assert.ok(typeof a.source === 'string' && a.source.length > 0);
    assert.ok(a.targets.every(t => M.METRIC_KEYS.includes(t)), a.id);
    assert.ok(!('conflicts' in a) && !('pairsWith' in a), a.id + ' : champs non exécutés retirés');
    if (a.status === 'validated') assert.ok(a.cautions.length > 0, a.id + ' : précautions requises');
  }
  for (const [ind, list] of Object.entries(data.PREFERENCE)) {
    assert.ok(M.METRIC_KEYS.includes(ind), ind);
    for (const id of list) { const a = actives.byId(id); assert.ok(a && a.targets.includes(ind), `${ind} → ${id}`); }
  }
  assert.ok(data.ACTIVES.some(a => a.status === 'à_valider'), 'des actifs à valider existent pour mémoire');
});

test('AC2 un actif « à_valider » n\'est jamais sélectionné, même s\'il figure dans une préférence', () => {
  const saved = data.PREFERENCE.firmness;
  try {
    data.PREFERENCE.firmness = ['peptides', 'retinoid', 'vitamin_c'];
    const r = sel(['firmness']);
    assert.ok(!tids(r).includes('peptides') && !tids(r).includes('retinoid'));
    assert.deepEqual(tids(r), ['vitamin_c']);
  } finally { data.PREFERENCE.firmness = saved; }
  for (let seed = 1; seed <= 150; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    for (const id of [...r.activePlan.treatments, ...r.activePlan.supports].map(x => x.activeId)) assert.equal(actives.byId(id).status, 'validated', `seed ${seed} ${id}`);
  }
  assert.equal(actives.hasLever('darkCircle'), false);
  for (const k of Object.keys(data.PREFERENCE)) assert.equal(actives.hasLever(k), true, k);
});

test('AC3 conflit : un seul exfoliant ou rétinoïde par soir (le second est écarté avec sa raison)', () => {
  assert.deepEqual(tids(sel(['acne', 'wrinkles'])), ['salicylic', 'vitamin_c']);
  withRetinoidFirst(() => {            // garde-fou conservé pour le jour où le rétinoïde serait validé
    const r = sel(['acne', 'wrinkles']);
    assert.deepEqual(tids(r), ['salicylic']);
    assert.ok(r.deferred.some(d => d.activeId === 'retinoid' && d.kind === 'conflict'));
    assert.ok(r.treatments.filter(t => t.groups.includes('evening_strong')).length <= 1);
  });
});

test('AC4 doublon de rôle : un seul actif par rôle (exfoliation, rénovation…)', () => {
  const saved = { texture: data.PREFERENCE.texture, acne: data.PREFERENCE.acne };
  try {
    data.PREFERENCE.texture = ['aha_pha'];
    data.PREFERENCE.acne = ['salicylic'];
    const r = sel(['acne', 'texture']);
    assert.deepEqual(tids(r), ['salicylic']);
    assert.ok(r.deferred.some(d => d.activeId === 'aha_pha' && d.kind === 'duplicate'));
  } finally { Object.assign(data.PREFERENCE, saved); }
});

test('AC5 un même actif utile à deux priorités n\'apparaît qu\'une fois, avec ses deux indicateurs', () => {
  const r = sel(['pores', 'oiliness']);
  assert.deepEqual(tids(r), ['niacinamide']);
  assert.deepEqual(r.treatments[0].indicators, ['pores', 'oiliness']);
});

test('AC6 routine trop chargée : le nombre de soins ciblés est plafonné par niveau (none 1, simple 2, full 3)', () => {
  const caps = { none: 1, simple: 2, full: 3 };
  const saved = { ...data.PREFERENCE };
  try {                                                      // préférences disjointes : aucun actif ne couvre plusieurs priorités
    Object.assign(data.PREFERENCE, { acne: ['salicylic'], pigmentation: ['vitamin_c'], texture: ['aha_pha'], pores: ['niacinamide'] });
    for (const [level, cap] of Object.entries(caps)) {
      const r = sel(['acne', 'pigmentation', 'pores'], {}, { level });
      assert.ok(r.treatments.length <= cap, level);
      if (level !== 'none') assert.equal(r.treatments.length, cap, level + ' : le plafond est atteint');
    }
  } finally { Object.assign(data.PREFERENCE, saved); }
  /* Routine minimale : seulement un soin ciblé très doux (irritation faible), les actifs plus exigeants sont mis de côté. */
  const none = sel(['acne', 'pigmentation'], {}, { level: 'none' });
  assert.deepEqual(tids(none), ['niacinamide']);
  assert.ok(none.deferred.some(d => d.activeId === 'vitamin_c' && d.kind === 'minimal'));
  assert.ok(none.treatments.every(t => t.irritation === 'low'));
});

test('AC7 mode confort : actifs doux d\'abord, l\'actif plus exigeant est mis de côté (pas supprimé sans raison), base d\'hydratation ajoutée', () => {
  const r = sel(['acne'], { skin: 'Redness' });
  assert.deepEqual(tids(r), ['niacinamide']);
  assert.ok(r.deferred.some(d => d.activeId === 'salicylic' && d.kind === 'comfort'));
  const roles = r.supports.map(s => s.role);
  assert.ok(roles.includes('humectant') && roles.includes('barrier'));
  assert.ok(r.supports.every(s => s.context === true));
  const low = ctxOf({ redness: 20 });
  assert.equal(low.context.comfortMode, true);
});

test('AC8 le rétinoïde est « à_valider » : jamais sélectionné ; si un jour validé, jamais en mode confort (mis de côté avec explication)', () => {
  const cases = [
    [['wrinkles'], { skin: 'Dry & Redness' }], [['wrinkles'], { skin: 'Redness' }], [['firmness'], { skin: 'Redness' }],
    [['texture'], { skin: 'Redness' }], [['texture', 'wrinkles', 'firmness'], { skin: 'Redness' }], [['wrinkles'], {}, { redness: 5 }]
  ];
  const go = (items, o, ui) => actives.select(items.map(indicator => ({ indicator })), ctxOf(ui || {}, o), { level: 'full', cats: [] });
  for (const [items, o, ui] of cases) {
    assert.ok(!go(items, o, ui).treatments.some(t => t.activeId === 'retinoid'), items.join());
    withRetinoidFirst(() => {
      const r = go(items, o, ui);
      assert.equal(r.treatments.some(t => data.ACTIVES.find(a => a.id === t.activeId).irritation === 'high'), false, items.join());
      if (items[0] !== 'texture') assert.ok(r.deferred.some(d => d.activeId === 'retinoid' && d.kind === 'gentle'), items.join());
    });
  }
  assert.match(copyText('gentle'), /approche plus douce/);
});

test('AC8b le rétinoïde reste au catalogue (« à_valider », consultable) et n\'est jamais auto-sélectionné ; validé, il serait sélectionnable hors confort', () => {
  assert.ok(actives.byId('retinoid'));
  assert.equal(actives.byId('retinoid').status, 'à_valider');
  for (const ind of ['wrinkles', 'firmness']) assert.ok(!tids(sel([ind])).includes('retinoid'), ind);
  withRetinoidFirst(() => {
    for (const ind of ['wrinkles', 'firmness']) assert.ok(tids(sel([ind])).includes('retinoid'), ind);
    assert.equal(sel(['wrinkles']).treatments[0].gentleFallback, false);
  });
});

test('AC8c invariant : en mode confort, jamais d\'actif à irritation forte (1000 jeux)', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    if (!r.routinePlan.comfortMode) continue;
    for (const t of r.activePlan.treatments) assert.notEqual(actives.byId(t.activeId).irritation, 'high', 'seed ' + seed);
  }
});

test('AC9 exfoliant déjà utilisé : aucun exfoliant ni rétinoïde ajouté', () => {
  const r = sel(['acne'], {}, { cats: ['exfoliant'] });
  assert.deepEqual(tids(r), ['azelaic']);   // ni exfoliant ni rétinoïde : plus écarté comme tel
  assert.ok(r.deferred.some(d => d.activeId === 'salicylic' && d.kind === 'owned'));
  assert.ok(!r.deferred.some(d => d.activeId === 'azelaic' && d.kind === 'owned'), 'azélaïque n\'est ni exfoliant ni rétinoïde');
});

test('AC10 priorité d\'hydratation : un humectant et une barrière (rôles distincts, pas de doublon)', () => {
  const r = sel(['hydration']);
  assert.deepEqual(r.treatments, []);
  assert.deepEqual(r.supports.map(s => s.activeId), ['hyaluronic', 'ceramides']);
  assert.equal(new Set(r.supports.map(s => s.role)).size, r.supports.length);
});

test('AC11 type de peau sec : base d\'hydratation même sans priorité d\'hydratation ; autres types : pas d\'ajout automatique', () => {
  assert.deepEqual(sel([], { skin: 'Dry' }).supports.map(s => s.role).sort(), ['barrier', 'humectant']);
  for (const skin of ['Normal', 'Oily', 'Combination']) assert.deepEqual(sel([], { skin }).supports, [], skin);
});

test('AC12 ordre d\'introduction : les actifs les plus doux d\'abord, un à la fois', () => {
  const r = sel(['acne', 'wrinkles'], {}, { level: 'full' });
  assert.deepEqual(tids(r), ['salicylic', 'vitamin_c']);
  assert.deepEqual(r.treatments.map(t => t.introductionOrder).sort(), [1, 2]);
  assert.equal(r.treatments.find(t => t.irritation === 'moderate').introductionOrder >= 1, true);
  const mix = sel(['wrinkles', 'pores'], {}, { level: 'full' });
  assert.equal(mix.treatments.find(t => t.activeId === 'niacinamide').introductionOrder, 1);
});

test('AC13 actifs exclus (médicaments, éclaircissants) : jamais dans le catalogue, les produits ni un plan', () => {
  const lowers = s => String(s).toLowerCase();
  for (const bad of data.EXCLUDED) {
    assert.ok(!data.ACTIVES.some(a => a.id === bad), bad);
    for (const p of pdata.PRODUCTS) assert.ok(!p.ingredients.some(i => i.activeId === bad || lowers(i.label).includes(lowers(bad).replace('_', ' '))), `${bad} dans ${p.id}`);
  }
  for (const term of ['hydroquinone', 'corticoïde', 'mercure', 'peroxyde de benzoyle', 'adapalène', 'trétinoïne'])
    for (const p of pdata.PRODUCTS) assert.ok(!p.ingredients.some(i => lowers(i.label).includes(term)), `${term} dans ${p.id}`);
  for (let seed = 200; seed < 260; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    for (const x of [...r.activePlan.treatments, ...r.activePlan.supports]) assert.ok(!data.EXCLUDED.includes(x.activeId));
  }
});

test('AC14 règles de conflit : seules les règles « validated » sont appliquées (association débattue laissée à valider)', () => {
  const pending = data.CONFLICT_RULES.find(r => r.id === 'vitamin_c_retinoid');
  assert.equal(pending.status, 'à_valider');
  withStatus('retinoid', 'validated', () => {                              // retinoid (soir) + vitamin C (matin) : non exclus
    const saved = { ...data.PREFERENCE };
    try {
      Object.assign(data.PREFERENCE, { wrinkles: ['retinoid'], pigmentation: ['vitamin_c'] });
      const r = sel(['wrinkles', 'pigmentation'], {}, { level: 'full' });
      assert.deepEqual(tids(r).sort(), ['retinoid', 'vitamin_c']);
    } finally { Object.assign(data.PREFERENCE, saved); }
  });
});

test('AC15 invariants sur 300 jeux aléatoires : plafond, un seul fort par soir, un actif par rôle, déterminisme', () => {
  for (let seed = 1000; seed < 1300; seed++) {
    const c = randomCase(seed), a = run(c.ui, c.o, c.profile), b = run(c.ui, c.o, c.profile);
    assert.deepEqual(a, b, 'seed ' + seed);
    const cap = data.LIMITS[a.profile.level].treatments, t = a.activePlan.treatments;
    assert.ok(t.length <= cap, `seed ${seed} plafond`);
    assert.ok(t.filter(x => x.groups.includes('evening_strong')).length <= 1, `seed ${seed} fort`);
    assert.equal(new Set(t.map(x => x.role)).size, t.length, `seed ${seed} rôles`);
    assert.ok(a.activePlan.supports.length <= actives.MAX_SUPPORTS);
    if (a.profile.cats.includes('exfoliant')) assert.ok(!t.some(x => x.groups.includes('evening_strong')), `seed ${seed} exfoliant déjà utilisé`);
  }
});
