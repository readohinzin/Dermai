'use strict';
/* Simulations ciblées de l'étape 11 (pas de profils en masse) : plusieurs utilisateurs, ordre chronologique, métriques manquantes,
   comparaison, absence de fuite entre comptes. Faux Supabase en mémoire + modèle de score réel. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Account = require('../js/account.js');
const SkinModel = require('../js/skin-model.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const normalizedOf = a => SkinModel.sanitizeNormalized({ schemaVersion: SkinModel.SCHEMA_VERSION, normalized: Object.assign({ globalScore: a.globalScore, skinAge: a.skinAge, skinType: { whole: a.skinType } },
  Object.fromEntries(SkinModel.METRIC_KEYS.map(k => [k, { uiScore: a.metrics[k] }]))) });

function randomAnalysis(id, dayOffset) {
  const metrics = {};
  for (const k of SkinModel.METRIC_KEYS) metrics[k] = rnd() < 0.25 ? null : Math.floor(rnd() * 101);
  return { id, analyzedAt: new Date(1_800_000_000_000 + dayOffset * 86400000).toISOString(), globalScore: rnd() < 0.1 ? null : Math.floor(rnd() * 101), skinType: ['Normal', 'Dry', 'Oily', 'Combination'][Math.floor(rnd() * 4)],
    skinAge: 20 + Math.floor(rnd() * 30), metrics, priorities: [{ id: 'acne', label: 'Acné', score: metrics.acne, band: 'mid' }], goals: ['hydration'], engineVersion: '1.0.0' };
}

test('HS1 plusieurs utilisateurs, enregistrements dans le désordre : chaque historique est le sien, trié du plus récent au plus ancien, sans fuite', async () => {
  const fake = createFake();
  const users = [];
  for (let u = 0; u < 4; u++) {
    const acc = Account.create({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now });
    await acc.signUp(`u${u}@exemple.com`, 'motdepasse1');
    const mine = Array.from({ length: 5 + u * 3 }, (_, i) => randomAnalysis(uuid(u * 1000 + i + 1), i * 3));
    for (const a of [...mine].sort(() => rnd() - 0.5)) assert.equal((await acc.saveAnalysis(a)).ok, true);
    users.push({ acc, mine });
  }
  for (const { acc, mine } of users) {
    const all = [];
    for (let off = 0; ; off += 4) { const p = await acc.listAnalyses({ limit: 4, offset: off }); assert.equal(p.ok, true); all.push(...p.analyses); if (!p.hasMore) break; }
    assert.deepEqual(all.map(a => a.id), [...mine].sort((a, b) => Date.parse(b.analyzedAt) - Date.parse(a.analyzedAt)).map(a => a.id));
    const own = new Set(mine.map(a => a.id));
    assert.ok(all.every(a => own.has(a.id)), 'aucune analyse d\'un autre compte');
    for (const a of all) { const src = mine.find(m => m.id === a.id); assert.deepEqual(a.metrics, src.metrics); assert.equal(a.globalScore, src.globalScore); }
  }
});

test('HS2 comparaison sur des analyses rechargées : rien n\'est inventé, seuil ±2 inchangé, métriques manquantes indisponibles', () => {
  for (let i = 0; i < 200; i++) {
    const a = randomAnalysis(uuid(1), 0), b = randomAnalysis(uuid(2), 7);
    const cmp = SkinModel.compareScans(normalizedOf(Account.analysisFromRow(toRow(a))), normalizedOf(Account.analysisFromRow(toRow(b))));
    for (const m of cmp.metrics) {
      const x = a.metrics[m.key], y = b.metrics[m.key];
      if (x === null || y === null) { assert.equal(m.available, false); assert.equal(m.delta, null); assert.equal(m.trend, null); continue; }
      assert.equal(m.available, true); assert.equal(m.delta, y - x);
      assert.equal(m.trend, y - x > 2 ? 'up' : y - x < -2 ? 'down' : 'same');
    }
    if (a.globalScore === null || b.globalScore === null) assert.equal(cmp.global.available, false);
    else assert.equal(cmp.global.delta, b.globalScore - a.globalScore);
  }
});
function toRow(a) { return Object.assign({ id: a.id, analyzed_at: a.analyzedAt, global_score: a.globalScore, skin_type: a.skinType, skin_age: a.skinAge, metrics: a.metrics, priorities: a.priorities, goals_snapshot: a.goals, engine_version: a.engineVersion }); }

test('HS3 données incomplètes : une métrique indisponible est conservée comme absente, jamais remplacée par 0', async () => {
  const fake = createFake(), acc = Account.create({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now });
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const a = randomAnalysis(uuid(1), 0); a.metrics = { acne: 40, texture: null }; a.globalScore = null;
  await acc.saveAnalysis(a);
  const r = (await acc.listAnalyses()).analyses[0];
  assert.equal(r.metrics.acne, 40); assert.equal(r.metrics.texture, null); assert.equal(r.metrics.pores, null); assert.equal(r.globalScore, null);
  const view = SkinModel.toResultView(normalizedOf(r));
  assert.equal(view.global.score, null);
  assert.ok(view.priorities.every(p => p.score !== null) && view.priorities.length === 1);
});

test('HS4 une analyse enregistrée n\'est jamais recalculée : relire donne exactement ce qui a été écrit, même après un changement de règles', async () => {
  const fake = createFake(), acc = Account.create({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now });
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const a = randomAnalysis(uuid(1), 0); a.engineVersion = '0.9.0'; a.priorities = [{ id: 'pores', label: 'Pores', score: 12, band: 'low' }];
  await acc.saveAnalysis(a);
  const r = (await acc.listAnalyses()).analyses[0];
  assert.equal(r.engineVersion, '0.9.0'); assert.deepEqual(r.priorities, a.priorities);
});
