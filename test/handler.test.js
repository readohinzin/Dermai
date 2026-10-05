'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('stream');
const { toUserMessage } = require('../server/errors');
const { validateImage, readBody } = require('../server/validation');

process.env.DERMAI_ANALYSIS_ENABLED = '1';   // verrou ouvert pour les tests ; les tests du verrou le referment explicitement
const perfectcorp = require('../server/perfectcorp');
const handler = require('../api/skin-analysis.js');

function call(method, headers, data) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.headers = headers;
    const res = { setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
    handler(req, res);
  });
}

test('méthode GET refusée', async () => assert.equal((await call('GET', {})).status, 405));
test('image absente → 400', async () => assert.equal((await call('POST', { 'content-type': 'image/jpeg' })).status, 400));
test('mauvais MIME → 415', async () => assert.equal((await call('POST', { 'content-type': 'image/png' }, Buffer.from([0xff, 0xd8, 0xff, 1]))).status, 415));
test('faux JPEG → 415', async () => assert.equal((await call('POST', { 'content-type': 'image/jpeg' }, Buffer.from([1, 2, 3, 4]))).status, 415));

test('fichier trop volumineux → 413', async () => {
  const r = await call('POST', { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) }, Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, toUserMessage('TOO_LARGE'));
});

test('corps dépassant la limite sans content-length → refusé', async () => {
  const req = Readable.from([Buffer.alloc(3000), Buffer.alloc(3000)]);
  req.headers = {};
  await assert.rejects(readBody(req, 4000), { code: 'TOO_LARGE' });
});

test('JPEG valide accepté par validateImage', () => {
  assert.equal(validateImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg').mime, 'image/jpeg');
});

test('sans clé API, le handler répond une erreur générique sans détail technique', async () => {
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  const r = await call('POST', { 'content-type': 'image/jpeg' }, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]));
  if (saved !== undefined) process.env.PERFECT_CORP_API_KEY = saved;
  assert.equal(r.status, 503);
  assert.equal(r.body.error, toUserMessage('SERVICE_UNAVAILABLE'));
  assert.ok(!/PERFECT_CORP|key/i.test(r.body.error));
});

/* ---------- verrou DERMAI_ANALYSIS_ENABLED ---------- */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); }
  finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
async function withStub(result, fn) {
  const orig = perfectcorp.analyzeSkin; let calls = 0;
  perfectcorp.analyzeSkin = async () => { calls++; if (result instanceof Error) throw result; return result; };
  try { return await fn(() => calls); } finally { perfectcorp.analyzeSkin = orig; }
}
async function captureLogs(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { return [await fn(), lines]; } finally { Object.assign(console, o); }
}

test('verrou fermé par défaut : 503, aucune analyse lancée, même avec un JPEG valide', async () => {
  await withEnv({ DERMAI_ANALYSIS_ENABLED: undefined }, () => withStub({ any: 1 }, async calls => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 503);
    assert.equal(r.body.error, toUserMessage('ANALYSIS_DISABLED'));
    assert.equal(calls(), 0);
  }));
});

test('verrou : valeurs non activantes (vide, 0, false) restent fermées', async () => {
  for (const v of ['', '0', 'false', 'non']) {
    await withEnv({ DERMAI_ANALYSIS_ENABLED: v }, () => withStub({ any: 1 }, async calls => {
      const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
      assert.equal(r.status, 503, `valeur « ${v} »`);
      assert.equal(calls(), 0);
    }));
  }
});

test('verrou fermé : la requête n\'est même pas lue (pas de validation, pas de 415)', async () => {
  await withEnv({ DERMAI_ANALYSIS_ENABLED: undefined }, async () => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/png' }, Buffer.from([1, 2, 3])));
    assert.equal(r.status, 503);
  });
});

test('verrou ouvert : succès sans raw dans la réponse (production normale)', async () => {
  const fake = { data: { task_status: 'success', results: { acne: { raw_score: 74, mask_urls: ['https://cdn.example/MASQUE_SECRET.png?sig=abc'] } } } };
  await withEnv({ DERMAI_DEBUG_RAW: undefined }, () => withStub(fake, async calls => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });
    assert.equal(r.body.raw, undefined);
    assert.equal(calls(), 1);
    assert.ok(!JSON.stringify(r.body).includes('MASQUE_SECRET'));
  }));
});

test('DERMAI_DEBUG_RAW=1 : le JSON brut est renvoyé (diagnostic explicite seulement)', async () => {
  const fake = { data: { task_status: 'success' } };
  await withEnv({ DERMAI_DEBUG_RAW: '1' }, () => withStub(fake, async () => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.deepEqual(r.body, { ok: true, raw: fake });
  }));
});

test('log de structure : noms de champs et types, jamais de valeurs ni d\'URL', async () => {
  const fake = { data: { task_status: 'success', task_id: 'TASKID_SECRET_123', results: { acne: { raw_score: 74.2, ui_score: 60, mask_urls: ['https://cdn.example/MASQUE_SECRET.png?sig=abc'] }, skin_type: { type: 'oily' } } } };
  await withEnv({ PERFECT_CORP_API_KEY: 'CLE_SECRETE_XYZ' }, () => withStub(fake, async () => {
    const [, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    const line = logs.find(l => l.includes('Perfect Corp result structure'));
    assert.ok(line, 'ligne de structure absente');
    for (const attendu of ['data.results.acne.raw_score: number', 'data.results.acne.mask_urls[]: string', 'data.results.skin_type.type: string', 'data.task_status: string']) {
      assert.ok(line.includes(attendu), 'manque : ' + attendu);
    }
    const tout = logs.join('\n');
    for (const interdit of ['MASQUE_SECRET', 'TASKID_SECRET', 'cdn.example', 'https://', 'oily', '74.2', 'CLE_SECRETE_XYZ', 'sig=abc']) {
      assert.ok(!tout.includes(interdit), 'fuite dans les logs : ' + interdit);
    }
  }));
});

test('échec Perfect Corp : message générique, aucun détail interne ni raw', async () => {
  const { AnalysisError } = require('../server/errors');
  await withStub(new AnalysisError('TASK_ERROR', { status: 422, detail: 'détail interne Perfect Corp' }), async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 422);
    assert.equal(r.body.error, toUserMessage('TASK_ERROR'));
    assert.ok(!JSON.stringify(r.body).includes('interne'));
    assert.ok(logs.some(l => l.includes('détail interne')), 'le détail doit rester dans les logs serveur');
  });
});
