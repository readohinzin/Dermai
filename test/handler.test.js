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
  env.data.results.output.push({ type: 'skin_type', region: 'forehead', skin_type: 'REGION_INCONNUE_SECRET' }, { type: 'inconnu_type', secret: 'TYPE_SECRET' },
    { type: 'resize_image', url: 'https://cdn.example/RESIZED_SECRET.jpg', score: 1234.5 });
  env.data.results.all = SCORE_INFO.all;                 // clé voisine au format score_info : jamais lue
  return env;
}

test('verrou ouvert : le navigateur reçoit seulement le résultat normalisé { schemaVersion, normalized }', async () => {
  await withEnv({ DERMAI_DEBUG_RAW: undefined }, () => withStub(dirtyEnvelope(), async calls => {
    const [r] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: EXPECTED } });
    const nz = r.body.result.normalized;               // skin_type, all et skin_age sont lus (formes confirmées par l'OpenAPI)
    assert.deepEqual(nz.skinType, { whole: 'Combination', tZone: 'Oily', uZone: 'Dry & Redness' });
    assert.strictEqual(nz.globalScore, JSON_RESP.data.results.output.find(e => e.type === 'all').score);
    assert.strictEqual(nz.skinAge, JSON_RESP.data.results.output.find(e => e.type === 'skin_age').score);
    assert.deepEqual(Object.keys(r.body.result).sort(), ['normalized', 'schemaVersion']);
    assert.equal(r.body.raw, undefined);
    assert.equal(calls(), 1);
    const s = JSON.stringify(r.body);
    for (const interdit of ['MASQUE_SECRET', 'TASKID_SECRET', 'INCONNU_SECRET', 'https', 'task_id', 'task_status', 'mask_urls', 'raw_score', 'ui_score', 'extra_field', 'TYPE_SECRET', 'inconnu_type', 'REGION_INCONNUE_SECRET', 'RESIZED_SECRET', 'resize_image', '1234.5']) assert.ok(!s.includes(interdit), interdit);
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
    /* hors lignes [DIAG] (qui affichent volontairement les valeurs de skin_type, all et skin_age) : aucune valeur */
    const tout = logs.filter(l => !l.startsWith('[DERMAI][DIAG]')).join('\n');
    for (const interdit of ['MASQUE_SECRET', 'TASKID_SECRET', 'TYPE_SECRET', 'cdn.example', 'https://', 'sig=abc', 'CLE_SECRETE_XYZ', 'Oily', 'Combination', 'Dry & Redness', '28.5', String(JSON_RESP.data.results.output[0].raw_score)]) {
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

/* ---------- DIAGNOSTIC TEMPORAIRE : valeurs réelles de skin_type, all, skin_age (voir server/diagnostic.js) ----------
   À retirer avec server/diagnostic.js une fois les valeurs observées. */
const { diagnosticLines } = require('../server/diagnostic');

/* Réponse de forme réelle observée en Production : chaque élément porte type, raw_score, ui_score, score, skin_type, region,
   mask_urls, url ; types supplémentaires skin_type, all, skin_age, resize_image. Valeurs des trois éléments : fictives. */
function realShapedEnvelope() {
  const el = (type, extra) => ({ type, raw_score: null, ui_score: null, score: null, skin_type: null, region: null, mask_urls: [], url: null, ...extra });
  const OUTF = JSON_RESP.data.results.output;
  const output = OUTF.filter(e => METRIC_TYPES.includes(e.type)).map(e => el(e.type, { raw_score: e.raw_score, ui_score: e.ui_score, mask_urls: ['https://cdn.example/MASQUE_SECRET.png?sig=abc'] }));
  for (const e of OUTF.filter(x => x.type === 'skin_type')) output.push(el('skin_type', { skin_type: e.skin_type, region: e.region }));   // un élément par région
  output.push(el('all', { score: OUTF.find(e => e.type === 'all').score }), el('skin_age', { score: OUTF.find(e => e.type === 'skin_age').score }),
    el('resize_image', { url: 'https://cdn.example/RESIZED_SECRET.jpg?sig=zzz', mask_urls: ['https://cdn.example/RESIZE_MASQUE_SECRET.jpg'] }));
  return { status: 200, data: { task_id: 'TASKID_SECRET_123', task_status: 'success', results: { output } } };
}

test('DIAG : lignes pour skin_type, all et skin_age avec leurs champs scalaires explicites', () => {
  const lignes = diagnosticLines(realShapedEnvelope());
  assert.equal(lignes[0], '[DERMAI][DIAG] éléments lus : skin_type=3 all=1 skin_age=1 (sur 21 éléments)');   // 15 métriques + 3 skin_type + all + skin_age + resize_image
  assert.equal(lignes.length, 1 + 5);
  const st = lignes.filter(l => l.includes('type="skin_type"'));
  assert.equal(st.length, 3);
  assert.ok(st[0].includes('skin_type="Combination"') && st[0].includes('region="whole"'));
  assert.ok(st[1].includes('skin_type="Oily"') && st[1].includes('region="t_zone"'));
  assert.ok(st[2].includes('skin_type="Dry & Redness"') && st[2].includes('region="u_zone"'));
  const all = lignes.find(l => l.includes('type="all"'));
  assert.ok(all.includes('score=28.5 ') && all.includes('raw_score=null') && all.includes('ui_score=null') && all.includes('skin_type=null') && all.includes('region=null'));
  const age = lignes.find(l => l.includes('type="skin_age"'));
  assert.ok(age.includes('score=29 ') && age.includes('raw_score=null') && age.includes('ui_score=null'));
});

test('DIAG : champs absents signalés, valeurs non scalaires ou ressemblant à une URL jamais affichées', () => {
  const env = { data: { results: { output: [
    { type: 'all' },
    { type: 'skin_age', score: { a: 1 }, raw_score: [1, 2], ui_score: true, skin_type: 'https://cdn.example/URL_SECRET.png', region: 'x'.repeat(80) },
    { type: 'skin_type', score: NaN, raw_score: Infinity, ui_score: undefined, skin_type: 'Oily', region: 'whole', url: 'https://cdn.example/URL_SECRET2', mask_urls: ['https://cdn.example/M'] }
  ] } } };
  const t = diagnosticLines(env).join('\n');
  assert.ok(t.includes('score=(absent)') && t.includes('raw_score=(absent)'));
  assert.ok(t.includes('score=<objet>') && t.includes('raw_score=<tableau>') && t.includes('ui_score=<booléen>'));
  assert.ok(t.includes('skin_type=<masqué>') && t.includes('region=<masqué>'));
  assert.ok(t.includes('score=<nombre non fini>'));
  for (const interdit of ['URL_SECRET', 'cdn.example', 'https', 'mask_urls', 'url=']) assert.ok(!t.includes(interdit), interdit);
});

test('DIAG : sans tableau data.results.output, aucune ligne ; aucun élément ciblé : seulement le comptage', () => {
  for (const x of [null, undefined, {}, { data: { results: { output: {} } } }, { data: { results: { output: 'x' } } }]) assert.deepEqual(diagnosticLines(x), []);
  assert.deepEqual(diagnosticLines({ data: { results: { output: [{ type: 'acne', raw_score: 1 }, null, 'x'] } } }),
    ['[DERMAI][DIAG] éléments lus : skin_type=0 all=0 skin_age=0 (sur 3 éléments)']);
});

test('DIAG : dans les logs du handler, uniquement ces champs ; aucune fuite (JSON brut, mask_urls, url, task_id, clé, autres scores)', async () => {
  await withEnv({ PERFECT_CORP_API_KEY: 'CLE_SECRETE_XYZ' }, () => withStub(realShapedEnvelope(), async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    const diag = logs.filter(l => l.startsWith('[DERMAI][DIAG]') && !l.includes('répétitions'));   // diagnostic skin_type / all / skin_age, inchangé
    assert.equal(diag.length, 6);
    assert.ok(diag.join('\n').includes('skin_type="Oily"') && diag.join('\n').includes('score=28.5 ') && diag.join('\n').includes('score=29 '));
    const tout = logs.join('\n');
    for (const interdit of ['MASQUE_SECRET', 'RESIZED_SECRET', 'RESIZE_MASQUE', 'TASKID_SECRET', 'CLE_SECRETE_XYZ', 'cdn.example', 'https://', 'sig=abc', 'sig=zzz',
      String(JSON_RESP.data.results.output[0].raw_score), String(JSON_RESP.data.results.output[1].ui_score) + '.']) {
      assert.ok(!tout.includes(interdit), 'fuite dans les logs : ' + interdit);
    }
    assert.ok(!diag.some(l => /resize_image|"acne"|"pore"/.test(l)), 'seuls skin_type, all et skin_age sont journalisés');
    /* le diagnostic n'a aucun effet sur le contrat : la réponse est celle du parseur (15 métriques, skin_type, all, skin_age) */
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: EXPECTED } });
    assert.deepEqual(r.body.result.normalized.skinType, { whole: 'Combination', tZone: 'Oily', uZone: 'Dry & Redness' });
  }));
});

test('DIAG : le diagnostic journalise aussi quand le résultat est refusé (ambigu), avant l\'erreur', async () => {
  const env = realShapedEnvelope(); env.data.results.output.push({ type: 'acne', raw_score: 1, ui_score: 2 });
  await withStub(env, async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.equal(r.status, 502);
    assert.ok(logs.some(l => l.startsWith('[DERMAI][DIAG] éléments lus : skin_type=3 all=1 skin_age=1')));
  });
});

/* ---------- DIAGNOSTIC TEMPORAIRE : comptage des répétitions par type (voir server/diagnostic.js) ---------- */
const { repetitionLine, METRIC_TYPES } = require('../server/diagnostic');
const REP_ATTENDU = '[DERMAI][DIAG] répétitions : ' + [...METRIC_TYPES].map(t => `${t}=1`).join(', ');

test('REP : 15 types de métriques connus, ordre du parseur, une occurrence chacun', () => {
  assert.equal(METRIC_TYPES.length, 15);
  assert.deepEqual([...METRIC_TYPES].sort(), JSON_RESP.data.results.output.map(e => e.type).filter(t => !['skin_type', 'all', 'skin_age'].includes(t)).sort());   // les 15 métriques de la fixture
  assert.equal(repetitionLine(realShapedEnvelope()), REP_ATTENDU);
  assert.equal(repetitionLine(JSON_RESP), REP_ATTENDU);
  assert.deepEqual([...METRIC_TYPES], skinModel.METRICS.map(m => m[0]), 'ordre et liste = ceux de la table du parseur');
});

test('REP : un type répété apparaît avec son nombre (2, 3…), les autres restent à 1', () => {
  const env = realShapedEnvelope();
  env.data.results.output.push({ type: 'pore', raw_score: 1 }, { type: 'pore', raw_score: 2 }, { type: 'acne', raw_score: 3 });
  const l = repetitionLine(env);
  assert.ok(l.includes('pores') === false && l.includes('pore=3'));
  assert.ok(l.includes('acne=2'));
  assert.ok(l.includes('texture=1') && l.includes('moisture=1'));
  assert.equal((l.match(/=1/g) || []).length, 13);
});

test('REP : un type absent vaut 0 ; les types inconnus (skin_type, all, skin_age, resize_image…) sont ignorés', () => {
  const env = { data: { results: { output: [{ type: 'acne' }, { type: 'skin_type' }, { type: 'all' }, { type: 'skin_age' }, { type: 'resize_image' }, { type: 'inconnu' }] } } };
  const l = repetitionLine(env);
  assert.ok(l.includes('acne=1') && l.includes('pore=0') && l.includes('moisture=0'));
  for (const t of ['skin_type', 'all=', 'skin_age', 'resize_image', 'inconnu']) assert.ok(!l.includes(t), t);
  assert.equal(l.split(', ').length, 15);
});

test('REP : sans tableau data.results.output → null ; éléments hostiles ignorés sans exception', () => {
  for (const x of [null, undefined, {}, { data: { results: { output: {} } } }, { data: { results: { output: 'x' } } }]) assert.equal(repetitionLine(x), null);
  const l = repetitionLine({ data: { results: { output: [null, 'x', 7, [], { type: 7 }, { type: null }, { type: ['acne'] }, { type: 'acne' }] } } });
  assert.ok(l.includes('acne=1'));
});

test('REP : la ligne ne contient que des noms de types et des nombres : jamais valeurs, URL, task_id, clé ni JSON', () => {
  const l = repetitionLine(realShapedEnvelope());
  assert.match(l, /^\[DERMAI\]\[DIAG\] répétitions : [a-z_0-9]+=\d+(, [a-z_0-9]+=\d+)*$/);
  for (const interdit of ['https', 'cdn.example', 'MASQUE', 'RESIZED', 'TASKID', 'Oily', '61.5', '{', '[]']) assert.ok(!l.includes(interdit), interdit);
});

test('REP : dans les logs du handler, une seule ligne de répétitions, sans fuite, contrat métier inchangé', async () => {
  await withEnv({ PERFECT_CORP_API_KEY: 'CLE_SECRETE_XYZ' }, () => withStub(realShapedEnvelope(), async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    const rep = logs.filter(l => l.includes('répétitions'));
    assert.deepEqual(rep, [REP_ATTENDU]);
    for (const interdit of ['CLE_SECRETE_XYZ', 'TASKID_SECRET', 'MASQUE_SECRET', 'RESIZED_SECRET']) assert.ok(!rep[0].includes(interdit), interdit);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, result: { schemaVersion: 1, normalized: EXPECTED } });
  }));
});

test('REP : le comptage est journalisé même quand le résultat est refusé (métrique répétée), sans rien modifier au verdict', async () => {
  const env = realShapedEnvelope();
  env.data.results.output.push({ type: 'pore', raw_score: 9, ui_score: 9 });
  await withStub(env, async () => {
    const [r, logs] = await captureLogs(() => call('POST', { 'content-type': 'image/jpeg' }, JPEG));
    assert.ok(logs.some(l => l.includes('répétitions') && l.includes('pore=2')));
    assert.equal(r.status, 502);                                   // le parseur reste strict : aucun changement automatique
    assert.equal(r.body.error, toUserMessage('RESULT_AMBIGUOUS'));
    assert.equal(r.body.result, undefined);
  });
});
