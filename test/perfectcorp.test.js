'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../server/perfectcorp');
const { PERFECT_CORP_SKIN_ACTIONS } = require('../server/config');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const BASE = 'https://yce-api-01.makeupar.com';
const KEY = 'test-key-123';

const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => { if (body === undefined) throw new Error('no json'); return body; },
  text: async () => typeof body === 'string' ? body : JSON.stringify(body || '')
});

/* fetch simulé : file de réponses, enregistre les appels. */
function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    if (!r) throw new Error('réponse simulée manquante pour ' + url);
    return r;
  };
  fn.calls = calls;
  return fn;
}

const fileOk = () => res(200, { data: { files: [{ file_id: 'F1', requests: [{ method: 'PUT', url: 'https://s3.example/up?sig=1', headers: { 'Content-Type': 'image/jpeg' } }] }] } });
const taskOk = () => res(200, { data: { task_id: 'T1' } });
const running = () => res(200, { data: { task_status: 'running' } });
const success = payload => res(200, { data: { task_status: 'success', results: payload || { fake: true } } });
const noSleep = { sleep: async () => {}, apiKey: KEY };

test('requestUploadUrl : POST /s2s/v2.0/file avec Bearer, extrait file_id et url', async () => {
  const f = mockFetch([fileOk()]);
  const r = await pc.requestUploadUrl({ size: JPEG.length, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f }));
  assert.equal(r.fileId, 'F1');
  assert.equal(r.url, 'https://s3.example/up?sig=1');
  assert.equal(f.calls[0].url, BASE + '/s2s/v2.0/file');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
});

test('requestUploadUrl : réponse sans file_id/url → erreur générique', async () => {
  const f = mockFetch([res(200, { data: { files: [{}] } })]);
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f })), { code: 'SERVICE_UNAVAILABLE' });
});

test('requestUploadUrl : HTTP 401 → SERVICE_UNAVAILABLE, détail gardé côté serveur', async () => {
  const f = mockFetch([res(401, 'invalid api key')]);
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f })),
    e => e.code === 'SERVICE_UNAVAILABLE' && /HTTP 401/.test(e.detail));
});

test('clé absente → SERVICE_UNAVAILABLE sans appel réseau', async () => {
  const f = mockFetch([]);
  await assert.rejects(pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { fetch: f, apiKey: '' }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.calls.length, 0);
});

test('uploadFile : PUT des octets exacts, sans clé API', async () => {
  const f = mockFetch([res(200, '')]);
  await pc.uploadFile({ url: 'https://s3.example/up', method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, buffer: JPEG, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f }));
  const c = f.calls[0];
  assert.equal(c.init.method, 'PUT');
  assert.strictEqual(c.init.body, JPEG);
  assert.equal(c.init.headers.Authorization, undefined);
});

test('uploadFile : échec HTTP', async () => {
  const f = mockFetch([res(403, 'denied')]);
  await assert.rejects(pc.uploadFile({ url: 'https://s3.example/up', buffer: JPEG, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f })), { code: 'SERVICE_UNAVAILABLE' });
});

test('createSkinAnalysisTask : src_file_id, actions SD, format json', async () => {
  const f = mockFetch([taskOk()]);
  const id = await pc.createSkinAnalysisTask({ fileId: 'F1' }, pc.makeEnv({ ...noSleep, fetch: f }));
  assert.equal(id, 'T1');
  assert.equal(f.calls[0].url, BASE + '/s2s/v2.1/task/skin-analysis');
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.src_file_id, 'F1');
  assert.equal(body.format, 'json');
  assert.deepEqual(body.dst_actions, PERFECT_CORP_SKIN_ACTIONS);
  assert.equal(body.src_file_url, undefined);
});

test('createSkinAnalysisTask : task_id absent', async () => {
  const f = mockFetch([res(200, { data: {} })]);
  await assert.rejects(pc.createSkinAnalysisTask({ fileId: 'F1' }, pc.makeEnv({ ...noSleep, fetch: f })), { code: 'SERVICE_UNAVAILABLE' });
});

test('getSkinAnalysisTask : GET sur /task/skin-analysis/{task_id}', async () => {
  const f = mockFetch([running()]);
  await pc.getSkinAnalysisTask('T 1', pc.makeEnv({ ...noSleep, fetch: f }));
  assert.equal(f.calls[0].url, BASE + '/s2s/v2.1/task/skin-analysis/T%201');
  assert.equal(f.calls[0].init.method, 'GET');
});

test('pollSkinAnalysisTask : attend puis renvoie le JSON brut en success', async () => {
  const payload = { skin_type: { x: 1 } };
  const f = mockFetch([running(), running(), success(payload)]);
  let sleeps = 0;
  const out = await pc.pollSkinAnalysisTask('T1', pc.makeEnv({ apiKey: KEY, fetch: f, sleep: async () => { sleeps++; } }));
  assert.deepEqual(out.data.results, payload);
  assert.equal(f.calls.length, 3);
  assert.equal(sleeps, 2);
});

test('pollSkinAnalysisTask : task_status error → TASK_ERROR', async () => {
  const f = mockFetch([res(200, { data: { task_status: 'error', error: 'exceed_max_retry' } })]);
  await assert.rejects(pc.pollSkinAnalysisTask('T1', pc.makeEnv({ ...noSleep, fetch: f })), { code: 'TASK_ERROR' });
});

test('pollSkinAnalysisTask : erreur de tâche reconnue (visage)', async () => {
  const f = mockFetch([res(200, { data: { task_status: 'error', error: 'error_no_face' } })]);
  await assert.rejects(pc.pollSkinAnalysisTask('T1', pc.makeEnv({ ...noSleep, fetch: f })), { code: 'NO_FACE' });
});

test('pollSkinAnalysisTask : max 25 tentatives puis TIMEOUT', async () => {
  const f = mockFetch(Array.from({ length: 40 }, running));
  await assert.rejects(pc.pollSkinAnalysisTask('T1', pc.makeEnv({ ...noSleep, fetch: f })), { code: 'TIMEOUT' });
  assert.equal(f.calls.length, 25);
});

test('pollSkinAnalysisTask : timeout global respecté', async () => {
  let t = 0;
  const f = mockFetch(Array.from({ length: 40 }, running));
  const env = pc.makeEnv({ apiKey: KEY, fetch: f, now: () => t, sleep: async ms => { t += ms; }, polling: { intervalMs: 2000, maxAttempts: 25, totalTimeoutMs: 6000 } });
  await assert.rejects(pc.pollSkinAnalysisTask('T1', env), { code: 'TIMEOUT' });
  assert.equal(f.calls.length, 3);
});

test('défauts compatibles maxDuration=60 : 25 × 2 s, timeout global 50 s', () => {
  const p = pc.makeEnv({ apiKey: KEY }).polling;
  assert.equal(p.maxAttempts, 25);
  assert.equal(p.intervalMs, 2000);
  assert.ok(p.totalTimeoutMs < 60000);
});

test('erreur réseau → SERVICE_UNAVAILABLE', async () => {
  const f = mockFetch([new Error('ECONNRESET')]);
  await assert.rejects(pc.requestUploadUrl({ size: 1, mime: 'image/jpeg' }, pc.makeEnv({ ...noSleep, fetch: f })), { code: 'SERVICE_UNAVAILABLE' });
});

test('analyzeSkin : flux complet dans le bon ordre, renvoie le JSON brut', async () => {
  const payload = { all: { score: 70 } };
  const f = mockFetch([fileOk(), res(200, ''), taskOk(), running(), success(payload)]);
  const out = await pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { ...noSleep, fetch: f });
  assert.deepEqual(out.data.results, payload);
  assert.deepEqual(f.calls.map(c => c.init.method), ['POST', 'PUT', 'POST', 'GET', 'GET']);
  assert.strictEqual(f.calls[1].init.body, JPEG);
  assert.equal(JSON.parse(f.calls[0].init.body).files[0].file_size, JPEG.length);
});

test('analyzeSkin : un échec d\'upload arrête le flux avant la création du task', async () => {
  const f = mockFetch([fileOk(), res(500, 'boom')]);
  await assert.rejects(pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { ...noSleep, fetch: f }), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(f.calls.length, 2);
});

test('la clé API n\'apparaît dans aucun message d\'erreur renvoyé', async () => {
  const f = mockFetch([res(401, 'nope')]);
  try { await pc.analyzeSkin({ buffer: JPEG, mime: 'image/jpeg' }, { ...noSleep, fetch: f }); }
  catch (e) { assert.ok(!String(e.message).includes(KEY)); assert.ok(!String(e.detail).includes(KEY)); }
});
