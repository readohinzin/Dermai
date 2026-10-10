'use strict';
/* Budget de temps global de /api/skin-analysis (server/budget.js). Perfect Corp, Supabase et les masques : toujours SIMULÉS.
   Aucune attente réelle (horloge et pauses simulées), sauf deux tests très courts (< 1 s) qui vérifient l'interruption d'une requête bloquée.
   Aucun appel externe, aucune unité consommée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');

process.env.DERMAI_ANALYSIS_ENABLED = '1';
process.env.SUPABASE_URL = 'https://demo.supabase.co'; process.env.SUPABASE_ANON_KEY = 'public-anon-key';
process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL'; process.env.DERMAI_MAX_ANALYSES_PER_PERIOD = '1000';

const pc = require('../server/perfectcorp');
const { createBudget, clock } = require('../server/budget');
const { TIME_BUDGET } = require('../server/config');
const { AnalysisError, toUserMessage } = require('../server/errors');
const masks = require('../server/masks');
const auth = require('../server/auth');
const quota = require('../server/quota');
const handler = require('../api/skin-analysis.js');
const { createFake } = require('./helpers/fake-supabase.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const KEY = 'TEST_ONLY_KEY_NOT_REAL';
const TASK = 'TASK_SECRET_42';
const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body,
  text: async () => typeof body === 'string' ? body : JSON.stringify(body || '')
});
const fileOk = () => res(200, { data: { files: [{ file_id: 'F1', requests: [{ method: 'PUT', url: 'https://s3.example/up?sig=1', headers: {} }] }] } });
const taskOk = () => res(200, { data: { task_id: TASK } });
const running = () => res(200, { data: { task_status: 'running' } });
const success = () => res(200, { data: { task_status: 'success', results: { output: [] } } });

/* Horloge simulée : le temps ne passe que si le test le fait avancer. */
function fakeTime(start = 1000) {
  let t = start;
  return { now: () => t, advance: ms => { t += ms; } };
}
/* fetch simulé : file de réponses ; `after[i]` = durée (simulée) qui s'écoule pendant l'appel i. */
function mockFetch(responses, time, after = []) {
  const calls = [];
  const fn = async (url, init) => {
    const i = calls.length;
    calls.push({ url, init });
    if (time && after[i]) time.advance(after[i]);
    const r = responses.shift();
    if (!r) throw new Error('réponse simulée manquante pour ' + url);
    return r;
  };
  fn.calls = calls;
  return fn;
}
const envFor = (time, budgetMs, fetch, extra = {}) => {
  const budget = createBudget({ totalMs: budgetMs, now: time.now });
  let sleeps = 0;
  const env = pc.makeEnv({ apiKey: KEY, fetch, now: time.now, budget, sleep: async ms => { sleeps++; time.advance(ms); }, ...extra });
  return { env, budget, sleeps: () => sleeps };
};

/* ---------- Client Perfect Corp ---------- */

test('TB1 fonctionnement nominal : même suite d\'appels, chaque requête reçoit un signal d\'interruption, budget non entamé', async () => {
  const time = fakeTime();
  const f = mockFetch([fileOk(), res(200, ''), taskOk(), running(), success()], time);
  const { budget } = envFor(time, TIME_BUDGET.totalMs, f);
  const out = await pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { apiKey: KEY, fetch: f, now: time.now, budget, sleep: async ms => time.advance(ms) });
  assert.equal(out.data.task_status, 'success');
  assert.deepEqual(f.calls.map(c => c.init.method), ['POST', 'PUT', 'POST', 'GET', 'GET']);
  assert.ok(f.calls.every(c => c.init.signal && typeof c.init.signal.aborted === 'boolean'));
  assert.strictEqual(f.calls[1].init.body, JPEG);
  assert.equal(budget.elapsed(), 2000);   // une seule pause simulée de 2 s
});

test('TB2 budget épuisé AVANT l\'envoi de la photo : erreur contrôlée, la photo n\'est jamais envoyée', async () => {
  const time = fakeTime();
  const f = mockFetch([fileOk(), res(200, ''), taskOk()], time, [50000]);   // la demande de fichier « dure » 50 s sur un budget de 52 s
  const { env } = envFor(time, 52000, f);
  await assert.rejects(pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { apiKey: KEY, fetch: f, now: time.now, budget: env.budget }),
    e => e instanceof AnalysisError && e.code === 'TIME_BUDGET' && e.status === 504 && /étape upload/.test(e.detail) && /tâche créée : non/.test(e.detail));
  assert.equal(f.calls.length, 1);
  assert.ok(!f.calls.some(c => c.init.method === 'PUT'));
});

test('TB3 budget épuisé avant la création de la tâche : aucune tâche n\'est créée', async () => {
  const time = fakeTime();
  const f = mockFetch([fileOk(), res(200, ''), taskOk()], time, [0, 50000]);
  const { env } = envFor(time, 52000, f);
  await assert.rejects(pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { apiKey: KEY, fetch: f, now: time.now, budget: env.budget }),
    e => e.code === 'TIME_BUDGET' && /étape task/.test(e.detail) && /tâche créée : non/.test(e.detail));
  assert.equal(f.calls.length, 2);
});

test('TB4 budget épuisé PENDANT le polling : arrêt net, plus aucune requête ni pause, détail sans identifiant de tâche', async () => {
  const time = fakeTime();
  const f = mockFetch([fileOk(), res(200, ''), taskOk(), ...Array.from({ length: 40 }, running)], time, [1000, 1000, 1000]);
  const { env } = envFor(time, 20000, f);
  let pauses = 0;
  await assert.rejects(pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { apiKey: KEY, fetch: f, now: time.now, budget: env.budget, sleep: async ms => { pauses++; time.advance(ms); } }),
    e => {
      assert.equal(e.code, 'TIME_BUDGET'); assert.equal(e.status, 504);
      assert.match(e.detail, /étape status/); assert.match(e.detail, /tâche créée : oui/);
      assert.ok(!String(e.detail).includes(TASK) && !JSON.stringify(e).includes(TASK) && !String(e.message).includes(TASK));
      return true;
    });
  /* 3 étapes de 1 s, puis une interrogation toutes les 2 s tant qu'il reste de quoi en faire une autre : arrêt dès qu'il reste moins de 5 s. */
  assert.equal(f.calls.length, 3 + 8);
  assert.deepEqual(f.calls.slice(3).map(c => c.init.method), Array(8).fill('GET'));
  assert.ok(env.budget.remaining() < 5000);   // arrêt volontaire : il ne restait plus de quoi pauser puis interroger à nouveau
  assert.equal(pauses, 7);                      // 8 interrogations = 7 pauses ; aucune pause inutile après la dernière
  assert.equal(env.budget.elapsed(), 3000 + 7 * 2000);
  const before = f.calls.length;
  time.advance(5000);                           // le budget est maintenant réellement épuisé
  await assert.rejects(pc.getSkinAnalysisTask('T', env), { code: 'TIME_BUDGET' });
  await assert.rejects(pc.pollSkinAnalysisTask('T', env), { code: 'TIME_BUDGET' });
  assert.equal(f.calls.length, before);         // plus aucune requête réseau après l'expiration
});

test('TB5 budget insuffisant avant la première interrogation : zéro requête', async () => {
  const time = fakeTime();
  const f = mockFetch([running()], time);
  const { env } = envFor(time, 2999, f);
  await assert.rejects(pc.pollSkinAnalysisTask('T', env), { code: 'TIME_BUDGET' });
  assert.equal(f.calls.length, 0);
});

test('TB6 une requête bloquée est interrompue à l\'échéance du budget (AbortController), sans attendre le délai du fournisseur', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  let n = 0;
  const f = (...a) => { n++; return hang(...a); };
  const budget = createBudget({ totalMs: 120, minStepMs: 10 });
  const t0 = Date.now();
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ apiKey: KEY, fetch: f, budget })), { code: 'TIME_BUDGET' });
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(n, 1);
});

test('TB7 le budget couvre aussi la lecture du corps de la réponse', async () => {
  const f = async (url, init) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('lecture interrompue')))), text: async () => '' });
  const budget = createBudget({ totalMs: 120, minStepMs: 10 });
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ apiKey: KEY, fetch: f, budget })), { code: 'TIME_BUDGET' });
});

test('TB8 aucune répétition automatique : une erreur réseau ou HTTP reste UN seul appel', async () => {
  const time = fakeTime();
  const f = mockFetch([res(500, 'boom')], time);
  const { env } = envFor(time, 52000, f);
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, env), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.calls.length, 1);
});

/* ---------- Masques ---------- */

const ENVELOPE = { data: { results: { output: [{ type: 'acne', mask_urls: ['https://cdn.example/m1.png'] }] } } };

test('TB9 budget insuffisant avant les masques : aucune requête, localisation absente, pas d\'erreur', async () => {
  const time = fakeTime();
  let n = 0;
  const saved = masks.api.fetchImpl; masks.api.fetchImpl = async () => { n++; throw new Error('ne doit pas être appelé'); };
  try {
    const budget = createBudget({ totalMs: 52000, now: time.now });
    time.advance(52000 - (TIME_BUDGET.minMasksMs - 1));
    const m = await masks.collect(ENVELOPE, { budget });
    assert.deepEqual(m.localization, {});
    assert.equal(m.stats.skipped, true);
    assert.equal(n, 0);
  } finally { masks.api.fetchImpl = saved; }
});

test('TB10 masques : le délai de téléchargement ne dépasse jamais le temps restant', async () => {
  const savedFetch = masks.api.fetchImpl, savedMin = TIME_BUDGET.minMasksMs;
  TIME_BUDGET.minMasksMs = 10;
  let sawSignal = false;
  masks.api.fetchImpl = (url, init) => new Promise((_, reject) => { sawSignal = !!init.signal; init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  try {
    const budget = createBudget({ totalMs: 150 });
    const t0 = Date.now();
    const m = await masks.collect(ENVELOPE, { budget });
    assert.ok(sawSignal);
    assert.deepEqual(m.localization, {});
    assert.ok(Date.now() - t0 < 2000, 'le délai (5 s) du téléchargement n\'a pas été attendu');
  } finally { masks.api.fetchImpl = savedFetch; TIME_BUDGET.minMasksMs = savedMin; }
});

test('TB11 sans budget fourni, les masques gardent leur comportement d\'origine', async () => {
  const saved = masks.api.fetchImpl;
  masks.api.fetchImpl = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  try {
    const m = await masks.collect(ENVELOPE);
    assert.deepEqual(m.localization, {});
    assert.equal(m.stats.skipped, undefined);
    assert.equal(m.stats.listed, 1);
  } finally { masks.api.fetchImpl = saved; }
});

/* ---------- Handler ---------- */

const SB = createFake();
auth.api.fetchImpl = SB.fetch;
const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc';
const USER_ID = '11111111-1111-4111-8111-111111111111';
SB.users.set('t@exemple.com', { id: USER_ID, email: 't@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER_ID, exp: Number.MAX_SAFE_INTEGER });
let quotaCalls = 0;
quota.api.fetchImpl = (...a) => { quotaCalls++; return SB.fetch(...a); };

function call(data) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = 'POST'; req.headers = { authorization: 'Bearer ' + TOKEN, 'content-type': 'image/jpeg' };
    const r = { setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(req, r);
  });
}
async function captureLogs(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { return [await fn(), lines]; } finally { Object.assign(console, o); }
}
/* Horloge du budget du handler pilotée par le test. */
async function withClock(fn) {
  const time = fakeTime();
  const saved = clock.now; clock.now = time.now;
  try { return await fn(time); } finally { clock.now = saved; }
}
async function withAnalyze(impl, fn) {
  const orig = pc.analyzeSkin; let calls = 0, lastOpts = null;
  pc.analyzeSkin = async (image, opts) => { calls++; lastOpts = opts; return impl(image, opts); };
  try { return await fn(() => calls, () => lastOpts); } finally { pc.analyzeSkin = orig; }
}
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/perfectcorp-json-response.json'), 'utf8'));
const noLeak = lines => {
  const all = lines.join('\n');
  for (const secret of [TOKEN, KEY, TASK, USER_ID, 't@exemple.com', 'public-anon-key', 'cdn.example', 'https://']) assert.ok(!all.includes(secret), 'fuite : ' + secret);
};

test('TB12 handler : budget insuffisant avant le quota → 504 contrôlé, AUCUN crédit réservé, AUCUN appel au fournisseur', async () => {
  await withClock(async time => {
    const savedAuth = auth.api.fetchImpl;
    auth.api.fetchImpl = async (...a) => { time.advance(TIME_BUDGET.totalMs - TIME_BUDGET.minStartMs + 1000); return savedAuth(...a); };   // la vérification de session est très lente
    quotaCalls = 0;
    try {
      await withAnalyze(async () => REAL, async calls => {
        const [r, lines] = await captureLogs(() => call(JPEG));
        assert.equal(r.status, 504);
        assert.equal(r.body.error, toUserMessage('TIME_BUDGET'));
        assert.equal(quotaCalls, 0);
        assert.equal(calls(), 0);
        noLeak(lines);
      });
    } finally { auth.api.fetchImpl = savedAuth; }
  });
});

test('TB13 handler : le budget du handler est transmis au fournisseur ; budget épuisé en cours d\'analyse → 504 contrôlé, message neutre', async () => {
  await withClock(async () => {
    quotaCalls = 0;
    await withAnalyze(async () => { throw new AnalysisError('TIME_BUDGET', { status: 504, detail: 'budget de temps épuisé (étape status, 52000 ms écoulées, tâche créée : oui)' }); }, async (calls, opts) => {
      const [r, lines] = await captureLogs(() => call(JPEG));
      assert.equal(r.status, 504);
      assert.deepEqual(Object.keys(r.body).sort(), ['error', 'ok']);
      assert.equal(r.body.error, toUserMessage('TIME_BUDGET'));
      assert.doesNotMatch(r.body.error, /rembours/i);   // aucun remboursement n'est promis
      assert.equal(quotaCalls, 1);                       // le crédit réservé n'est pas rendu (aucun mécanisme vérifié)
      assert.equal(calls(), 1);
      assert.equal(typeof opts().budget.remaining, 'function');
      assert.ok(lines.some(l => /TIME_BUDGET/.test(l)));
      noLeak(lines);
    });
  });
});

test('TB14 handler : analyse terminée mais budget épuisé avant les masques → 200, résultat complet, sans localisation, aucun téléchargement', async () => {
  await withClock(async time => {
    const saved = masks.api.fetchImpl; let downloads = 0;
    masks.api.fetchImpl = async () => { downloads++; throw new Error('ne doit pas être appelé'); };
    try {
      const withUrls = JSON.parse(JSON.stringify(REAL));
      withUrls.data.results.output.forEach(e => { if (e.mask_urls) e.mask_urls = ['https://cdn.example/m.png']; });
      await withAnalyze(async () => { time.advance(TIME_BUDGET.totalMs - 1000); return withUrls; }, async () => {
        const [r, lines] = await captureLogs(() => call(JPEG));
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.ok(r.body.result && r.body.result.normalized && r.body.result.normalized.acne);
        assert.equal(r.body.localization, undefined);
        assert.equal(downloads, 0);
        assert.ok(lines.some(l => /Localization skipped: time budget/.test(l)));
        noLeak(lines);
      });
    } finally { masks.api.fetchImpl = saved; }
  });
});

test('TB15 handler : fonctionnement nominal inchangé (résultat normalisé, masques téléchargés dans le budget)', async () => {
  await withClock(async () => {
    const saved = masks.api.fetchImpl; let downloads = 0;
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    masks.api.fetchImpl = async () => { downloads++; return { ok: true, status: 200, url: 'https://cdn.example/m.png', headers: { get: () => String(PNG.length) }, arrayBuffer: async () => PNG }; };
    try {
      const withUrls = JSON.parse(JSON.stringify(REAL));
      withUrls.data.results.output.forEach(e => { if (e.mask_urls) e.mask_urls = ['https://cdn.example/m.png']; });
      await withAnalyze(async () => withUrls, async () => {
        const [r] = await captureLogs(() => call(JPEG));
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.ok(downloads > 0);
        assert.ok(r.body.localization && Object.keys(r.body.localization).length > 0);
        assert.equal(r.body.raw, undefined);
      });
    } finally { masks.api.fetchImpl = saved; }
  });
});

/* ---------- Cohérence de la configuration ---------- */

test('TB16 le budget global laisse au moins 5 s de marge sous maxDuration et dépasse le plafond propre du polling', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const maxMs = vercel.functions['api/skin-analysis.js'].maxDuration * 1000;
  assert.ok(TIME_BUDGET.totalMs <= maxMs - 5000, `budget ${TIME_BUDGET.totalMs} ms, maxDuration ${maxMs} ms`);
  assert.ok(pc.makeEnv({ apiKey: KEY }).polling.totalTimeoutMs <= TIME_BUDGET.totalMs);
  assert.ok(TIME_BUDGET.minStartMs > TIME_BUDGET.minStepMs && TIME_BUDGET.minStartMs < TIME_BUDGET.totalMs);
});

test('TB17 source : le handler crée le budget avant toute opération réseau et le transmet au fournisseur et aux masques', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/skin-analysis.js'), 'utf8');
  assert.ok(src.indexOf('createBudget()') < src.indexOf('auth.verifyUser'));
  assert.ok(src.indexOf('TIME_BUDGET.minStartMs') < src.indexOf('quota.reserve('));
  assert.match(src, /analyzeSkin\(image, \{ budget \}\)/);
  assert.match(src, /masks\.collect\(envelope, \{ budget \}\)/);
});

/* ---------- D1 : seuil de création de la tâche et seuil avant la réservation du quota ---------- */

/* Parcourt fichier puis envoi avec des durées simulées, puis demande la suite avec le budget restant voulu. */
async function runUntilTask(remainingAtTask, responses = [fileOk(), res(200, ''), taskOk(), success()]) {
  const time = fakeTime();
  const total = 40000;
  const spent = total - remainingAtTask;                // temps consommé avant la création de la tâche
  const f = mockFetch(responses, time, [Math.floor(spent / 2), spent - Math.floor(spent / 2)]);
  const budget = createBudget({ totalMs: total, now: time.now });
  const p = pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { apiKey: KEY, fetch: f, now: time.now, budget, sleep: async ms => time.advance(ms) });
  return { f, p, budget };
}

test('TD1 le seuil de création de la tâche est plus haut que celui des autres étapes, et laisse de quoi interroger une fois', () => {
  assert.ok(TIME_BUDGET.minTaskMs > TIME_BUDGET.minStepMs);
  assert.ok(TIME_BUDGET.minTaskMs >= TIME_BUDGET.minStepMs + 3000, 'une interrogation (minStepMs) + une requête de création');
  assert.ok(TIME_BUDGET.minTaskMs < TIME_BUDGET.minStartMs);
  assert.equal(createBudget().minTaskMs, TIME_BUDGET.minTaskMs);   // le mécanisme de budget existant porte le seuil
});

test('TD2 temps restant juste sous le seuil : la tâche N\'EST PAS créée (aucune requête de création, crédit non engagé chez le fournisseur)', async () => {
  const { f, p } = await runUntilTask(TIME_BUDGET.minTaskMs - 1);
  await assert.rejects(p, e => e.code === 'TIME_BUDGET' && e.status === 504 && /étape task/.test(e.detail) && /tâche créée : non/.test(e.detail));
  assert.equal(f.calls.length, 2);                                       // fichier + envoi seulement
  assert.deepEqual(f.calls.map(c => c.init.method), ['POST', 'PUT']);
  assert.ok(!f.calls.some(c => /skin-analysis/.test(c.url)), 'aucune requête vers l\'API de tâche');
});

test('TD3 temps restant exactement au seuil : la tâche est créée, interrogée, et le résultat est rendu (parcours nominal)', async () => {
  const { f, p } = await runUntilTask(TIME_BUDGET.minTaskMs);
  const out = await p;
  assert.equal(out.data.task_status, 'success');
  assert.deepEqual(f.calls.map(c => c.init.method), ['POST', 'PUT', 'POST', 'GET']);
});

test('TD4 le seuil n\'est exigé que pour la création de la tâche : l\'interrogation garde minStepMs', async () => {
  const time = fakeTime();
  const f = mockFetch([running()], time);
  const { env } = envFor(time, TIME_BUDGET.minStepMs, f);               // 3 s restantes : assez pour interroger, pas pour créer
  await pc.getSkinAnalysisTask('T', env);
  assert.equal(f.calls.length, 1);
  const g = mockFetch([taskOk()], time);
  const { env: env2 } = envFor(time, TIME_BUDGET.minTaskMs - 1, g);
  await assert.rejects(pc.createSkinAnalysisTask({ fileId: 'F1' }, env2), { code: 'TIME_BUDGET' });
  assert.equal(g.calls.length, 0);
});

test('TD5 handler : le seuil avant la réservation du quota inclut le délai maximal de cette réservation', async () => {
  assert.equal(typeof quota.TIMEOUT_MS, 'number');
  assert.ok(quota.TIMEOUT_MS > 0);
  const threshold = TIME_BUDGET.minStartMs + quota.TIMEOUT_MS;
  const attempt = async remaining => withClock(async time => {
    const savedAuth = auth.api.fetchImpl;
    auth.api.fetchImpl = async (...a) => { time.advance(TIME_BUDGET.totalMs - remaining); return savedAuth(...a); };
    quotaCalls = 0;
    try {
      return await withAnalyze(async () => REAL, async calls => {
        const [r, lines] = await captureLogs(() => call(JPEG));
        noLeak(lines);
        return { r, quotaCalls, analyzeCalls: calls() };
      });
    } finally { auth.api.fetchImpl = savedAuth; }
  });
  /* Juste sous le seuil : refus avant le quota (l'ancien seuil, minStartMs seul, aurait laissé passer). */
  const below = await attempt(threshold - 1);
  assert.ok(threshold - 1 >= TIME_BUDGET.minStartMs);
  assert.equal(below.r.status, 504);
  assert.equal(below.r.body.error, toUserMessage('TIME_BUDGET'));
  assert.equal(below.quotaCalls, 0);
  assert.equal(below.analyzeCalls, 0);
  /* Exactement au seuil : la réservation a lieu et l'analyse (simulée) démarre. */
  const at = await attempt(threshold);
  assert.equal(at.r.status, 200);
  assert.equal(at.quotaCalls, 1);
  assert.equal(at.analyzeCalls, 1);
});

test('TD6 source : le handler lit le délai de la réservation depuis le module du quota (pas de seconde valeur à synchroniser)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/skin-analysis.js'), 'utf8');
  assert.match(src, /budget\.canStart\(TIME_BUDGET\.minStartMs \+ quota\.TIMEOUT_MS\)/);
  const q = fs.readFileSync(path.join(__dirname, '..', 'server/quota.js'), 'utf8');
  assert.match(q, /const TIMEOUT_MS = 5000;/);
  assert.match(q, /module\.exports = \{ reserve, api, TIMEOUT_MS \}/);
});

/* ---------- D3 : état exact de la tâche dans le diagnostic ---------- */

const hangUntilAbort = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));

test('TD7 création de tâche interrompue APRÈS émission : état « inconnu », jamais « non »', async () => {
  let sent = 0;
  const f = (url, init) => { sent++; return hangUntilAbort(url, init); };
  const budget = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
  await assert.rejects(pc.createSkinAnalysisTask({ fileId: 'F1' }, pc.makeEnv({ apiKey: KEY, fetch: f, budget })),
    e => { assert.equal(e.code, 'TIME_BUDGET'); assert.match(e.detail, /étape task/); assert.match(e.detail, /tâche créée : inconnu/); assert.doesNotMatch(e.detail, /tâche créée : non/); return true; });
  assert.equal(sent, 1);                              // la requête est partie une seule fois, sans nouvel essai
});

test('TD8 création de tâche dont la réponse est interrompue pendant sa lecture : état « inconnu »', async () => {
  const f = async (url, init) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('lecture interrompue')))), text: async () => '' });
  const budget = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
  await assert.rejects(pc.createSkinAnalysisTask({ fileId: 'F1' }, pc.makeEnv({ apiKey: KEY, fetch: f, budget })), e => e.code === 'TIME_BUDGET' && /tâche créée : inconnu/.test(e.detail));
});

test('TD9 les autres états restent exacts : refus avant émission = « non » ; étape status = « oui » ; file et upload = « non »', async () => {
  const time = fakeTime();
  const f0 = mockFetch([taskOk()], time);
  const { env: e0 } = envFor(time, TIME_BUDGET.minTaskMs - 1, f0);
  await assert.rejects(pc.createSkinAnalysisTask({ fileId: 'F1' }, e0), e => /tâche créée : non/.test(e.detail));
  assert.equal(f0.calls.length, 0);
  const budgetS = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
  await assert.rejects(pc.getSkinAnalysisTask('T', pc.makeEnv({ apiKey: KEY, fetch: hangUntilAbort, budget: budgetS })), e => /étape status/.test(e.detail) && /tâche créée : oui/.test(e.detail));
  const budgetF = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ apiKey: KEY, fetch: hangUntilAbort, budget: budgetF })), e => /étape file/.test(e.detail) && /tâche créée : non/.test(e.detail));
  const budgetU = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
  await assert.rejects(pc.uploadFile({ url: 'https://s3.example/up', buffer: JPEG, mime: 'image/jpeg' }, pc.makeEnv({ apiKey: KEY, fetch: hangUntilAbort, budget: budgetU })), e => /étape upload/.test(e.detail) && /tâche créée : non/.test(e.detail));
});

test('TD10 journaux du handler : l\'état « inconnu » est écrit tel quel, sans identifiant de tâche, clé, jeton, adresse ni donnée personnelle', async () => {
  await withClock(async () => {
    const hang = (url, init) => hangUntilAbort(url, init);
    await withAnalyze(async () => {
      const budget = createBudget({ totalMs: 200, minStepMs: 10, minTaskMs: 20 });
      return pc.createSkinAnalysisTask({ fileId: 'F1' }, pc.makeEnv({ apiKey: KEY, fetch: hang, budget }));   // erreur réelle du client, rejetée vers le handler
    }, async () => {
      const [r, lines] = await captureLogs(() => call(JPEG));
      assert.equal(r.status, 504);
      assert.equal(r.body.error, toUserMessage('TIME_BUDGET'));
      assert.deepEqual(Object.keys(r.body).sort(), ['error', 'ok']);
      const failure = lines.find(l => /Skin analysis failed/.test(l));
      assert.ok(failure && /TIME_BUDGET/.test(failure) && /tâche créée : inconnu/.test(failure), failure);
      assert.doesNotMatch(failure, /tâche créée : non/);
      noLeak(lines);
    });
  });
});

test('TD11 journaux du handler : refus avant émission de la tâche (« non ») sans fuite, chemin complet client Perfect Corp simulé', async () => {
  await withClock(async time => {
    const savedFetch = globalThis.fetch;
    const calls = [];
    const queue = [fileOk(), res(200, ''), taskOk()];
    const after = [22000, 23000, 0];   // 45 s écoulées sur 52 s : il reste 7 s, sous minTaskMs (8 s)
    globalThis.fetch = async (url, init) => { const i = calls.length; calls.push(String(url)); time.advance(after[i] || 0); return queue.shift(); };   // Perfect Corp simulé : aucun réseau
    try {
      const [r, lines] = await captureLogs(() => call(JPEG));
      assert.equal(r.status, 504, lines.join(' | '));
      assert.equal(calls.length, 2);                                       // fichier + envoi ; la tâche n'est jamais demandée
      const failure = lines.find(l => /Skin analysis failed/.test(l));
      assert.ok(failure && /étape task/.test(failure) && /tâche créée : non/.test(failure), failure);
      noLeak(lines);
    } finally { globalThis.fetch = savedFetch; }
  });
});
