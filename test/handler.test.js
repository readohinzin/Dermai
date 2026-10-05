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

const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');   // réponse format = "json" : data.results.output[]
const SCORE_INFO = require('./fixtures/perfectcorp-score-info.json');     // score_info.json (ZIP) : non parsé par DERMAI
const skinModel = require('../js/skin-model.js');
const EXPECTED = skinModel.parseSkinResponse(JSON_RESP).normalized;
/* Enveloppe de statut simulée, volontairement « sale » : task_id, URL de masque, champs et éléments inconnus. */
function dirtyEnvelope() {
  const env = JSON.parse(JSON.stringify(JSON_RESP));
  env.data.task_id = 'TASKID_SECRET_123';
  env.data.results.output[0].mask_urls = ['https://cdn.example/MASQUE_SECRET.png?sig=abc'];
  env.data.results.output[0].extra_field = 'INCONNU_SECRET';
  env.data.results.output.push({ type: 'skin_type', whole: 'Oily', t_zone: 'Oily', u_zone: 'Oily' }, { type: 'inconnu_type', secret: 'TYPE_SECRET' });
  env.data.results.all = SCORE_INFO.all;
  return env;
}

test('verrou ouvert : le navigateur reçoit seulement le résultat normalisé { schemaVersion, normalized }', async () => {
  await withEnv({ DERMAI_DEBUG_RAW: undefined }, () => withStub(dirtyEnvelope(), async calls => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: EXPECTED } });
    assert.strictEqual(r.body.result.normalized.globalScore, null);
    assert.strictEqual(r.body.result.normalized.skinAge, null);
    assert.deepEqual(Object.keys(r.body.result).sort(), ['normalized', 'schemaVersion']);
    assert.equal(r.body.raw, undefined);
    assert.equal(calls(), 1);
    const s = JSON.stringify(r.body);
    for (const interdit of ['MASQUE_SECRET', 'TASKID_SECRET', 'INCONNU_SECRET', 'https', 'task_id', 'task_status', 'mask_urls', 'raw_score', 'ui_score', 'extra_field', 'TYPE_SECRET', 'inconnu_type', 'Oily']) assert.ok(!s.includes(interdit), interdit);
  }));
});

async function expectControlledError(env, code, motInterne) {
  await withStub(env, async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 502);
    assert.equal(r.body.error, toUserMessage(code));
    assert.equal(r.body.result, undefined);
    assert.ok(!JSON.stringify(r.body).includes('TASKID_SECRET'));
    assert.ok(!logs.join('\n').includes('TASKID_SECRET'), 'task_id dans les logs');
    assert.ok(logs.some(l => l.includes(motInterne)), `le détail « ${motInterne} » doit rester dans les logs serveur`);
  });
}
const withOutput = output => ({ data: { task_id: 'TASKID_SECRET_123', task_status: 'success', results: { output } } });

test('data.results.output absent (résultat ailleurs ou forme score_info.json) : erreur contrôlée, aucun repli', async () => {
  await expectControlledError({ data: { task_id: 'TASKID_SECRET_123', task_status: 'success', results: { url: 'https://cdn.example/r.zip' } } }, 'RESULT_NOT_FOUND', 'absent');
  await expectControlledError({ data: { task_id: 'TASKID_SECRET_123', task_status: 'success', results: JSON.parse(JSON.stringify(JSON_RESP.data.results.output)) } }, 'RESULT_NOT_FOUND', 'absent');
  await expectControlledError({ data: { task_id: 'TASKID_SECRET_123', task_status: 'success', results: SCORE_INFO } }, 'RESULT_NOT_FOUND', 'absent');
});

test('data.results.output pas un tableau (objet indexé de type score_info.json) : erreur contrôlée', async () => {
  await expectControlledError(withOutput(SCORE_INFO), 'RESULT_INVALID', 'pas un tableau');
});

test('élément de output sans type valide : erreur contrôlée', async () => {
  await expectControlledError(withOutput([...JSON.parse(JSON.stringify(JSON_RESP.data.results.output)), { ui_score: 1, raw_score: 2 }]), 'RESULT_INVALID', 'pas un tableau');
});

test('métrique répétée dans output : erreur contrôlée, aucun résultat choisi', async () => {
  const out = JSON.parse(JSON.stringify(JSON_RESP.data.results.output)); out.push({ type: 'acne', ui_score: 1, raw_score: 2 });
  await expectControlledError(withOutput(out), 'RESULT_AMBIGUOUS', 'métrique répétée');
});

test('tableau sans métrique connue : erreur contrôlée, les types ignorés sont journalisés (noms seulement)', async () => {
  await expectControlledError(withOutput([{ type: 'inconnu_type', raw_score: 1 }]), 'RESULT_NOT_FOUND', 'inconnu_type');
});

test('DERMAI_DEBUG_RAW=1 : l\'enveloppe brute est ajoutée (diagnostic explicite seulement)', async () => {
  const fake = dirtyEnvelope();
  await withEnv({ DERMAI_DEBUG_RAW: '1' }, () => withStub(fake, async () => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.deepEqual(r.body.result, { schemaVersion: 1, normalized: EXPECTED });
    assert.deepEqual(r.body.raw, fake);
  }));
});

test('log : structure (noms et types), chemin et noms de types ; jamais de valeurs ni d\'URL', async () => {
  const fake = dirtyEnvelope();
  await withEnv({ PERFECT_CORP_API_KEY: 'CLE_SECRETE_XYZ' }, () => withStub(fake, async () => {
    const [, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    const line = logs.find(l => l.includes('Perfect Corp result structure'));
    assert.ok(line, 'ligne de structure absente');
    for (const attendu of ['data.results.output: array', 'data.results.output[].type: string', 'data.results.output[].raw_score: number', 'data.results.output[].mask_urls[]: string', 'data.task_status: string']) {
      assert.ok(line.includes(attendu), 'manque : ' + attendu);
    }
    const chemin = logs.find(l => l.includes('Perfect Corp result path: data.results.output'));
    assert.ok(chemin, 'chemin du résultat non journalisé');
    assert.ok(chemin.includes('skin_type') && chemin.includes('inconnu_type'), 'types ignorés non journalisés (noms)');
    const tout = logs.join('\n');
    for (const interdit of ['MASQUE_SECRET', 'TASKID_SECRET', 'TYPE_SECRET', 'cdn.example', 'https://', 'sig=abc', 'CLE_SECRETE_XYZ', 'Oily', String(JSON_RESP.data.results.output[0].raw_score)]) {
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
