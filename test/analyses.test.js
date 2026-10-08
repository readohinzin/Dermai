'use strict';
/* Historique des analyses : client js/account.js contre un faux Supabase (aucun réseau). La vraie RLS et les contraintes sont dans analyses-db.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Account = require('../js/account.js');
const SkinModel = require('../js/skin-model.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const URL = 'https://demo.supabase.co', KEY = 'public-anon-key';
function setup() {
  const fake = createFake(), storage = memoryStorage();
  const mk = st => Account.create({ url: URL, anonKey: KEY, fetch: fake.fetch, storage: st || storage, now: fake.state.now });
  return { fake, storage, mk, acc: mk() };
}
const UUID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sample = (n, over) => Object.assign({
  id: UUID(n), analyzedAt: new Date(1_800_000_000_000 + n * 86400000).toISOString(), globalScore: 61, skinType: 'Combination', skinAge: 31,
  metrics: { acne: 63, pores: 36, hydration: 52, pigmentation: 22, redness: null },
  priorities: [{ id: 'pigmentation', label: 'Pigmentation', score: 22, band: 'low' }, { id: 'pores', label: 'Pores', score: 36, band: 'mid' }], goals: ['hydration', 'tone'], engineVersion: '1.0.0'
}, over || {});

test('H1 les 15 clés du client sont celles du modèle de score et de la migration', () => {
  assert.deepEqual(Account.METRIC_KEYS, SkinModel.METRIC_KEYS);
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261007120000_create_skin_analyses.sql'), 'utf8');
  const list = sql.match(/array\['acne'[^\]]*\]/g);
  assert.equal(list.length, 2);
  for (const l of list) assert.deepEqual(l.match(/'([A-Za-z]+)'/g).map(x => x.slice(1, -1)), SkinModel.METRIC_KEYS);
});

test('H2 enregistrement puis relecture : mêmes scores, priorités, objectifs et version du moteur', async () => {
  const { acc } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.deepEqual(await acc.saveAnalysis(sample(1)), { ok: true });
  const r = await acc.listAnalyses();
  assert.equal(r.ok, true);
  assert.equal(r.analyses.length, 1);
  const a = r.analyses[0];
  assert.equal(a.id, UUID(1)); assert.equal(a.globalScore, 61); assert.equal(a.skinType, 'Combination'); assert.equal(a.skinAge, 31);
  assert.equal(a.metrics.acne, 63); assert.equal(a.metrics.redness, null); assert.equal(a.metrics.wrinkles, null, 'indicateur absent : jamais inventé');
  assert.deepEqual(a.priorities, [{ id: 'pigmentation', label: 'Pigmentation', score: 22, band: 'low' }, { id: 'pores', label: 'Pores', score: 36, band: 'mid' }]);
  assert.deepEqual(a.goals, ['hydration', 'tone']); assert.equal(a.engineVersion, '1.0.0');
});

test('H3 le navigateur n\'envoie ni user_id, ni photo, ni masque, ni URL, ni task_id, ni rawScore : liste blanche stricte', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const dirty = sample(1, { user_id: 'autre', photo: 'data:image/jpeg;base64,AAAA', mask_urls: ['https://x'], task_id: 't1', raw: { a: 1 }, rawScore: 12, url: 'https://x',
    metrics: { acne: 63, rawScore: 40, photo: 'data:x', hydration: { uiScore: 5, rawScore: 4 } }, priorities: [{ id: 'pores', label: 'Pores', score: 36, band: 'mid', url: 'https://x', reason: 'x' }, { id: 'inconnu', label: 'Z', score: 1 }, { id: 'acne', score: 5 }] });
  assert.deepEqual(await acc.saveAnalysis(dirty), { ok: true });
  const w = fake.log.filter(l => l.path.startsWith('/rest/v1/skin_analyses') && l.body);
  assert.equal(w.length, 1);
  assert.deepEqual(Object.keys(w[0].body).sort(), ['analyzed_at', 'engine_version', 'global_score', 'goals_snapshot', 'id', 'metrics', 'priorities', 'skin_age', 'skin_type']);
  assert.deepEqual(w[0].body.metrics, { acne: 63, hydration: null });
  assert.deepEqual(w[0].body.priorities, [{ id: 'pores', label: 'Pores', score: 36, band: 'mid' }]);
  assert.doesNotMatch(JSON.stringify(w[0].body), /user_id|photo|mask|task|raw|https?:|data:|url/i);
  for (const l of fake.log) assert.ok(!/service_role/i.test(JSON.stringify(l.headers)));
});

test('H4 valeurs hors échelle ou invalides : devenues « absentes », jamais enregistrées telles quelles', async () => {
  const row = Account.analysisToRow(sample(1, { globalScore: 140, skinAge: 0, metrics: { acne: 55.5, pores: -2, texture: '40', oiliness: 100, hydration: 0 }, goals: ['hydration', 'x', 'hydration', 'tone', 'aging', 'texture'] }));
  assert.equal(row.global_score, null); assert.equal(row.skin_age, null);
  assert.deepEqual(row.metrics, { acne: null, pores: null, texture: null, oiliness: 100, hydration: 0 });
  assert.deepEqual(row.goals_snapshot, ['hydration', 'tone', 'aging']);
  assert.equal(Account.analysisToRow(null), null);
  assert.equal(Account.analysisToRow(sample(1, { engineVersion: '' })), null);
  assert.equal(Account.analysisToRow(sample(1, { metrics: undefined })), null);
});

test('H5 un nouvel essai avec le même identifiant ne crée pas de doublon', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.equal((await acc.saveAnalysis(sample(1))).ok, true);
  assert.equal((await acc.saveAnalysis(sample(1))).ok, true);
  assert.equal((await acc.listAnalyses()).analyses.length, 1);
  assert.ok(fake.log.some(l => l.method === 'POST' && /on_conflict=id/.test(l.path) && /ignore-duplicates/.test(l.headers.prefer)));
});

test('H6 pages de 20 : de la plus récente à la plus ancienne, suite disponible, aucune ligne perdue ni doublée', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  for (const n of [3, 1, 2, 5, 4]) await acc.saveAnalysis(sample(n, { globalScore: 50 + n }));
  const p1 = await acc.listAnalyses({ limit: 2 });
  assert.deepEqual(p1.analyses.map(a => a.globalScore), [55, 54]); assert.equal(p1.hasMore, true);
  const p2 = await acc.listAnalyses({ limit: 2, offset: 2 });
  assert.deepEqual(p2.analyses.map(a => a.globalScore), [53, 52]); assert.equal(p2.hasMore, true);
  const p3 = await acc.listAnalyses({ limit: 2, offset: 4 });
  assert.deepEqual(p3.analyses.map(a => a.globalScore), [51]); assert.equal(p3.hasMore, false);
  const def = fake.log.filter(l => l.method === 'GET' && l.path.startsWith('/rest/v1/skin_analyses')).pop();
  assert.match(def.path, /order=analyzed_at\.desc/);
  assert.doesNotMatch(def.path, /select=\*|photo|task|mask|url/i, 'colonnes utiles seulement');
  assert.match(def.path, /select=id,analyzed_at,global_score,skin_type,skin_age,metrics,priorities,goals_snapshot,engine_version,raw_metrics&/, 'raw_metrics : seule colonne ajoutée (décision du moteur)');
  const big = await acc.listAnalyses({ limit: 5000 });
  assert.match(fake.log[fake.log.length - 1].path, /limit=51\b/, 'jamais plus de 50 par page');
  assert.equal(big.ok, true);
});

test('H7 isolation : un autre compte ne voit rien, ne supprime rien ; il ne peut pas écrire pour autrui', async () => {
  const { fake, mk } = setup();
  const a = mk(memoryStorage()), b = mk(memoryStorage());
  await a.signUp('a@exemple.com', 'motdepasse1'); await b.signUp('b@exemple.com', 'motdepasse1');
  await a.saveAnalysis(sample(1));
  assert.deepEqual((await b.listAnalyses()).analyses, []);
  assert.equal((await b.deleteAnalyses()).ok, true);
  assert.equal((await a.listAnalyses()).analyses.length, 1, 'la suppression de B n\'a rien retiré à A');
  const forged = await fetchAs(fake, b, { user_id: a.user.id, metrics: {}, engine_version: 'v' });
  assert.equal(forged.status, 403);
  assert.deepEqual((await b.listAnalyses()).analyses, []);
});
async function fetchAs(fake, acc, body) {
  const tokenEntry = [...fake.tokens.entries()].find(([, v]) => v.sub === acc.user.id);
  return fake.fetch(URL + '/rest/v1/skin_analyses', { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + tokenEntry[0] }, body: JSON.stringify(body) });
}

test('H8 suppression de son historique : tout disparaît, la relecture est vide, une condition est envoyée', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  await acc.saveAnalysis(sample(1)); await acc.saveAnalysis(sample(2));
  assert.deepEqual(await acc.deleteAnalyses(), { ok: true });
  assert.deepEqual((await acc.listAnalyses()).analyses, []);
  assert.ok(fake.log.some(l => l.method === 'DELETE' && l.path === '/rest/v1/skin_analyses?id=not.is.null'));
});

test('H9 changement de compte et nouvel appareil : l\'historique suit le compte, pas le navigateur', async () => {
  const { mk, storage } = setup();
  const a = mk(storage);
  await a.signUp('a@exemple.com', 'motdepasse1'); await a.saveAnalysis(sample(1)); await a.signOut();
  assert.equal(JSON.stringify(storage.dump()).includes('dermai.session'), false);
  const b = mk(storage); await b.signUp('b@exemple.com', 'motdepasse1');
  assert.deepEqual((await b.listAnalyses()).analyses, []);
  const a2 = mk(memoryStorage()); await a2.signIn('a@exemple.com', 'motdepasse1');                   // second navigateur vierge
  assert.equal((await a2.listAnalyses()).analyses.length, 1);
});

test('H10 pannes : messages humains, aucun détail technique ; session expirée signalée', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  fake.state.failNetwork = true;
  assert.deepEqual(await acc.saveAnalysis(sample(1)), { ok: false, error: Account.MSG.analysisSaveFailed });
  assert.deepEqual(await acc.listAnalyses(), { ok: false, error: Account.MSG.historyLoadFailed });
  assert.deepEqual(await acc.deleteAnalyses(), { ok: false, error: Account.MSG.historyDeleteFailed });
  fake.state.failNetwork = false; fake.state.failAnalyses = true;
  for (const r of [await acc.saveAnalysis(sample(1)), await acc.listAnalyses(), await acc.deleteAnalyses()]) {
    assert.equal(r.ok, false); assert.doesNotMatch(r.error, /\b[45]\d\d\b|PGRST|skin_analyses|relation|42P01|SQL|JWT/i);
  }
  fake.state.failAnalyses = false; fake.tokens.clear(); fake.refresh.clear();
  const e = await acc.saveAnalysis(sample(1));
  assert.deepEqual(e, { ok: false, error: Account.MSG.sessionExpired });
});

test('H11 sans session : rien n\'est envoyé, session expirée', async () => {
  const { acc, fake } = setup();
  assert.deepEqual(await acc.saveAnalysis(sample(1)), { ok: false, error: Account.MSG.sessionExpired });
  assert.deepEqual(await acc.listAnalyses(), { ok: false, error: Account.MSG.sessionExpired });
  assert.equal(fake.log.filter(l => l.path.startsWith('/rest')).length, 0);
});

test('H12 lignes illisibles ignorées, jamais inventées ; aucune valeur hors échelle relue', () => {
  const good = { id: UUID(1), analyzed_at: '2026-10-07T10:00:00Z', global_score: 61, skin_type: 'Dry', skin_age: 30, metrics: { acne: 63, pores: 400 }, priorities: [{ id: 'acne', label: 'Acné', score: 63, band: 'good' }, { id: 'x', label: 'X', score: 1 }, { id: 'pores', score: 3 }], goals_snapshot: ['tone', 'zzz'], engine_version: 'v1' };
  const a = Account.analysisFromRow(good);
  assert.equal(a.metrics.acne, 63); assert.equal(a.metrics.pores, null);
  assert.deepEqual(a.priorities, [{ id: 'acne', label: 'Acné', score: 63, band: 'good' }]); assert.deepEqual(a.goals, ['tone']);
  for (const bad of [null, {}, { id: 'x' }, Object.assign({}, good, { analyzed_at: 'pas une date' }), Object.assign({}, good, { metrics: null }), Object.assign({}, good, { metrics: [1] })]) assert.equal(Account.analysisFromRow(bad), null);
});

/* Étape 25 : le raw_score sert aux décisions du moteur ; il est enregistré pour qu'une analyse relue soit décidée comme le jour même. */
test('H20 raw_metrics : rawScore enregistrés tels quels (jamais arrondis), clés inconnues et valeurs invalides écartées, relus à l\'identique', async () => {
  const { acc, fake } = setup();
  await acc.signUp('a@exemple.com', 'motdepasse1');
  const raw = { acne: 65.8439, pores: 41.18226081132889, hydration: 42.08343029022217, redness: 100, texture: 101, oiliness: -1, wrinkles: '50', inconnu: 12, firmness: null };
  assert.deepEqual(await acc.saveAnalysis(sample(1, { rawMetrics: raw })), { ok: true });
  const w = fake.log.filter(l => l.method === 'POST' && l.path.startsWith('/rest/v1/skin_analyses')).pop();
  assert.deepEqual(w.body.raw_metrics, { acne: 65.8439, pores: 41.18226081132889, hydration: 42.08343029022217, redness: 100 });
  assert.doesNotMatch(JSON.stringify(w.body), /user_id|photo|mask|task|https?:|data:|url/i);
  const back = (await acc.listAnalyses()).analyses[0];
  assert.deepEqual(back.rawMetrics, { acne: 65.8439, pores: 41.18226081132889, hydration: 42.08343029022217, redness: 100 });
  assert.deepEqual(back.metrics.acne, 63, 'le score affiché reste celui enregistré');
  // sans rawScore (analyse ancienne ou incomplète) : aucune colonne raw_metrics envoyée, rien d'inventé à la relecture
  const row = Account.analysisToRow(sample(2));
  assert.equal('raw_metrics' in row, false);
  assert.deepEqual(Account.analysisFromRow(Object.assign({ id: UUID(2), analyzed_at: new Date().toISOString(), metrics: { acne: 50 } })).rawMetrics, {});
});

test('H21 base sans la colonne raw_metrics (migration pas encore appliquée) : enregistrement et lecture continuent, sans rawScore', async () => {
  const { acc, fake } = setup();
  fake.state.rawColumn = false;
  await acc.signUp('a@exemple.com', 'motdepasse1');
  assert.deepEqual(await acc.saveAnalysis(sample(1, { rawMetrics: { acne: 40.5 } })), { ok: true });
  const posts = fake.log.filter(l => l.method === 'POST' && l.path.startsWith('/rest/v1/skin_analyses'));
  assert.equal(posts.length, 2, 'un seul nouvel essai, sans la colonne');
  assert.ok(posts[0].body.raw_metrics); assert.equal('raw_metrics' in posts[1].body, false);
  const r = await acc.listAnalyses();
  assert.equal(r.ok, true); assert.equal(r.analyses.length, 1); assert.deepEqual(r.analyses[0].rawMetrics, {});
  const gets = fake.log.filter(l => l.method === 'GET' && l.path.startsWith('/rest/v1/skin_analyses'));
  assert.match(gets[0].path, /raw_metrics/); assert.doesNotMatch(gets[1].path, /raw_metrics/);
  // une autre erreur n'est jamais confondue avec la colonne manquante
  fake.state.failAnalyses = true;
  assert.equal((await acc.saveAnalysis(sample(3, { rawMetrics: { acne: 40.5 } }))).ok, false);
});

