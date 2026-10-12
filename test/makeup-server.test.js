'use strict';
/* Studio Beauté : serveur (api/makeup-vto.js, server/makeup.js, server/perfectcorp-makeup.js), TOUT simulé.
   Aucun appel réel à Perfect Corp : globalThis.fetch est remplacé par un faux fournisseur qui enregistre chaque appel, REFUSE tout hôte inconnu, tout appel aux API
   d'analyse et de simulation, et tout téléchargement de l'image résultat. Aucune unité n'est consommée par ce fichier : le compteur d'appels « réels » reste à zéro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');

const auth = require('../server/auth');
const quota = require('../server/quota');
const config = require('../server/config');
const errors = require('../server/errors');
const M = require('../server/makeup');
const studio = require('../server/perfectcorp-makeup');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'TEST_ONLY_KEY_NOT_REAL_9f3a';
const USER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc', TOKEN2 = 'dddddddd.eeeeeeee.ffffffff';
/* JPEG minimal avec un cadre SOF0 aux dimensions voulues (les octets de pixels n'existent pas : seul l'en-tête est lu). */
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const JPEG = jpeg(1200, 1500);
const SB = createFake();
auth.api.fetchImpl = SB.fetch; quota.api.fetchImpl = SB.fetch;
SB.users.set('a@exemple.com', { id: USER, email: 'a@exemple.com', password: 'x', confirmed: true });
SB.users.set('b@exemple.com', { id: OTHER, email: 'b@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER, exp: Number.MAX_SAFE_INTEGER });
SB.tokens.set(TOKEN2, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });

const ENV0 = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key', PERFECT_CORP_API_KEY: KEY };
const open = { DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: USER, DERMAI_MAX_MAKEUP_PER_PERIOD: '100' };
Object.assign(process.env, ENV0);
const handler = require('../api/makeup-vto.js');

/* ───── Faux Perfect Corp ───── */
const BASE = config.PERFECT_CORP_BASE_URL;
const RESULT = 'https://cdn.example-pc.com/out/makeup1.png?Signature=SECRETSIG&Expires=1';
const rec = { calls: [], unexpected: [], real: 0 };
const mock = { status: [{ data: { task_status: 'success', results: [{ download_url: RESULT }] } }], fileFail: false, taskBody: null, taskId: 't-mk-1', taskError: null, noTaskId: false, taskAbort: false };
let polls = 0;
const reset = () => { rec.calls = []; rec.unexpected = []; polls = 0; Object.assign(mock, { status: [{ data: { task_status: 'success', results: [{ download_url: RESULT }] } }], fileFail: false, taskBody: null, taskId: 't-mk-1', taskError: null, noTaskId: false, taskAbort: false }); };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init && init.method) || 'GET';
  rec.calls.push({ url: u, method, auth: init.headers && (init.headers.Authorization || init.headers.authorization), body: init.body });
  if (/skin-analysis|skin-simulation|simulation/.test(u)) { rec.unexpected.push('ANALYSE/SIMULATION ' + u); throw new Error('appel interdit'); }
  if (u === BASE + '/s2s/v2.0/file') {
    if (mock.fileFail) return json(500, { error: 'boom' });
    return json(200, { data: { files: [{ file_id: 'file-1', requests: [{ url: 'https://upload.example-pc.com/put/abc', method: 'PUT', headers: {} }] }] } });
  }
  if (u === 'https://upload.example-pc.com/put/abc') return new Response('', { status: 200 });
  if (/cdn\.example-pc\.com/.test(u)) { rec.unexpected.push('TÉLÉCHARGEMENT du résultat par le serveur ' + u); throw new Error('le serveur ne télécharge pas l\'image'); }
  if (u === BASE + config.MAKEUP_PATHS.task && method === 'POST') {
    mock.taskBody = JSON.parse(init.body);
    if (mock.taskAbort) throw new TypeError('network');
    if (mock.taskError) return json(mock.taskError.status, mock.taskError.body);
    return mock.noTaskId ? json(200, { data: {} }) : json(200, { data: { task_id: mock.taskId } });
  }
  if (u === BASE + config.MAKEUP_PATHS.taskStatus(mock.taskId) && method === 'GET') { const r = mock.status[Math.min(polls++, mock.status.length - 1)]; return json(200, r); }
  rec.unexpected.push(method + ' ' + u); rec.real++; throw new Error('hôte ou chemin inattendu : ' + u);
};

const CFG_ALL = { v: 1, foundation: { color: '#C38A5E', colorIntensity: 40, glowIntensity: 30, coverageIntensity: 40 }, lips: { color: '#8E5440', texture: 'satin', colorIntensity: 65 }, blush: { color: '#C0634A', texture: 'matte', colorIntensity: 45 }, eyes: { color: '#4B3025', texture: 'shimmer', colorIntensity: 45 } };
const cfgQ = c => 'cfg=' + encodeURIComponent(typeof c === 'string' ? c : JSON.stringify(c));
function call(method, { token = TOKEN, query = cfgQ(CFG_ALL), headers = {}, data = JPEG } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.url = '/api/makeup-vto' + (query ? '?' + query : '');
    req.headers = Object.assign({ 'content-type': 'image/jpeg' }, token ? { authorization: 'Bearer ' + token } : {}, headers);
    const sent = {};
    const res = { setHeader(k, v) { sent[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: sent, raw: b }); } };
    handler(req, res);
  });
}
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
let logs = [];
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { Object.assign(console, o); } };
const run = async (env, fn) => { reset(); SB.state.rpcCalls = []; SB.mkUsage.clear(); SB.simUsage.clear(); SB.usage.clear(); SB.state.makeupQuotaMissing = false; SB.state.failQuota = false; return withEnv(Object.assign({}, open, env), async () => { const [r, l] = await quiet(fn); logs = l; return r; }); };
const rpc = () => SB.state.rpcCalls || [];
const taskPosts = () => rec.calls.filter(c => c.url === BASE + config.MAKEUP_PATHS.task && c.method === 'POST');

test('MK-S1 méthode et session : seuls GET et POST (405), session valide exigée AVANT tout, même verrou fermé ; rien n\'est appelé ni réservé', async () => {
  let r = await run({}, () => call('DELETE'));
  assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, POST'); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  for (const env of [{}, { DERMAI_MAKEUP_ENABLED: undefined }]) {
    for (const t of [null, 'zzz', 'aaaaaaaa.bbbbbbbb.invalid0']) {
      for (const m of ['POST', 'GET']) {
        r = await run(env, () => call(m, { token: t }));
        assert.equal(r.status, 401, `${m} ${t}`); assert.equal(r.headers['WWW-Authenticate'], 'Bearer'); assert.equal(r.body.error, errors.toMakeupMessage('AUTH_REQUIRED'));
        assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
      }
    }
  }
});

test('MK-S2 GET « disponible ? » : propre à chaque compte, sans fournisseur ni quota ; fermé par défaut', async () => {
  let r = await run({}, () => call('GET')); assert.deepEqual(r.body, { ok: true, available: true });
  r = await run({}, () => call('GET', { token: TOKEN2 })); assert.equal(r.body.available, false, 'compte non listé');
  for (const v of [undefined, '', '0', 'false', 'non']) { r = await run({ DERMAI_MAKEUP_ENABLED: v }, () => call('GET')); assert.equal(r.body.available, false, 'verrou fermé : ' + v); }
  r = await run({ DERMAI_MAKEUP_ALLOWED_USER_IDS: undefined }, () => call('GET')); assert.equal(r.body.available, false, 'liste vide = personne');
  r = await run({ DERMAI_MAKEUP_ALLOWED_USER_IDS: 'x,' + USER + ' , y' }, () => call('GET')); assert.equal(r.body.available, true);
  r = await run({ DERMAI_MAKEUP_ALLOWED_USER_IDS: '*' }, () => call('GET', { token: TOKEN2 })); assert.equal(r.body.available, true, '« * » : tout compte connecté');
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  try { r = await run({}, () => call('GET')); assert.equal(r.body.available, false, 'clé non configurée'); } finally { process.env.PERFECT_CORP_API_KEY = saved; }
  assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
});

test('MK-S3 interrupteur : désactivé par défaut (503) puis compte non autorisé (403) ; la photo n\'est pas lue, rien n\'est appelé ni réservé', async () => {
  for (const v of [undefined, '', '0', 'false']) {
    const r = await run({ DERMAI_MAKEUP_ENABLED: v }, () => call('POST', { headers: { 'content-type': 'image/png' }, data: Buffer.from([1, 2, 3]) }));
    assert.equal(r.status, 503, String(v)); assert.equal(r.body.error, errors.MESSAGES.MK_DISABLED); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  for (const list of [undefined, '', OTHER, 'tous', 'all', USER.slice(0, 20)]) {
    const r = await run({ DERMAI_MAKEUP_ALLOWED_USER_IDS: list }, () => call('POST'));
    assert.equal(r.status, 403, String(list)); assert.equal(r.body.error, errors.MESSAGES.MK_DISABLED); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  assert.equal(config.isMakeupEnabled({}), false, 'défaut : fermé'); assert.equal(config.isMakeupAllowed(USER, {}), false); assert.equal(config.isMakeupAllowed('', { DERMAI_MAKEUP_ALLOWED_USER_IDS: '*' }), false);
});

test('MK-S4 sélection de maquillage : validation STRICTE avant la photo, le quota et le fournisseur ; aucune URL ni corps fournisseur acceptés', async () => {
  const bad = [
    '', '{', 'null', '[]', '"x"', '{}', '{"v":1}', JSON.stringify({ v: 2, lips: CFG_ALL.lips }), JSON.stringify({ lips: CFG_ALL.lips }),
    JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { color: 'red' }) }), JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { color: '#FFF' }) }),
    JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { texture: 'glitter' }) }), JSON.stringify({ v: 1, blush: Object.assign({}, CFG_ALL.blush, { texture: 'gloss' }) }),
    JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { colorIntensity: 101 }) }), JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { colorIntensity: -1 }) }),
    JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { colorIntensity: 50.5 }) }), JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { colorIntensity: '50' }) }),
    JSON.stringify({ v: 1, lips: Object.assign({}, CFG_ALL.lips, { shimmerColor: '#ffffff' }) }),
    JSON.stringify({ v: 1, lips: CFG_ALL.lips, src_file_url: 'http://169.254.169.254/latest/meta-data' }), JSON.stringify({ v: 1, lips: CFG_ALL.lips, src_file_id: 'abc' }),
    JSON.stringify({ v: 1, lips: CFG_ALL.lips, effects: [{ category: 'skin_smooth', skinSmoothStrength: 100 }] }), JSON.stringify({ v: 1, lips: CFG_ALL.lips, image_url: 'https://evil.example/x.jpg' }),
    JSON.stringify({ v: 1, lips: CFG_ALL.lips, version: '2.0' }), JSON.stringify({ v: 1, skin_smooth: { skinSmoothStrength: 80 } }), JSON.stringify({ v: 1, __proto__x: 1, lips: CFG_ALL.lips }),
    JSON.stringify({ v: 1, foundation: { color: '#C38A5E', colorIntensity: 40 } }), JSON.stringify({ v: 1, foundation: Object.assign({}, CFG_ALL.foundation, { texture: 'matte' }) }),
    JSON.stringify({ v: 1, lips: CFG_ALL.lips, pad: 'x'.repeat(3000) })
  ];
  for (const c of bad) {
    const r = await run({}, () => call('POST', { query: cfgQ(c) }));
    assert.equal(r.status, 400, c.slice(0, 80)); assert.equal(r.body.error, errors.MESSAGES.MK_INVALID_REQUEST);
    assert.equal(rec.calls.length, 0, 'rien n\'est appelé : ' + c.slice(0, 60)); assert.deepEqual(rpc(), []);
  }
  for (const q of ['', 'cfg=', cfgQ(CFG_ALL) + '&' + cfgQ(CFG_ALL), 'x=' + encodeURIComponent(JSON.stringify(CFG_ALL))]) {
    const r = await run({}, () => call('POST', { query: q })); assert.equal(r.status, 400, q.slice(0, 40)); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  assert.ok(!/src_file_url|image_url|\.src_file_id\s*=\s*req|searchParams\.get\('(url|image)/.test(read('api/makeup-vto.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'le handler ne lit aucune URL fournie');
});

test('MK-S5 photo : JPEG réel, moins de 4 Mo reçus, grand côté < 1 920 px, petit côté ≥ 256 px ; refus AVANT le quota et le fournisseur', async () => {
  const cases = [
    [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg', 415], [jpeg(1200, 1500), 'image/png', 415], [jpeg(1920, 1080), 'image/jpeg', 400], [jpeg(1000, 3000), 'image/jpeg', 400],
    [jpeg(200, 200), 'image/jpeg', 400], [jpeg(255, 900), 'image/jpeg', 400], [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), 'image/jpeg', 400], [Buffer.concat([jpeg(1200, 1500), Buffer.alloc(4 * 1024 * 1024)]), 'image/jpeg', 413]
  ];
  for (const [data, type, status] of cases) {
    const r = await run({}, () => call('POST', { data, headers: { 'content-type': type } }));
    assert.equal(r.status, status, `${type} ${data.length} octets`); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  for (const [w, h] of [[1919, 1080], [256, 256], [1200, 1500], [900, 1919]]) { const r = await run({}, () => call('POST', { data: jpeg(w, h) })); assert.equal(r.status, 200, `${w}x${h}`); }
  assert.deepEqual(M.jpegSize(jpeg(321, 654)), { width: 321, height: 654 }); assert.equal(M.jpegSize(Buffer.from([1, 2])), null);
});

test('MK-S6 corps du fournisseur : UNE tâche, skin_smooth explicite à 0 en premier, tous les effets dans un seul tableau, noms et champs du schéma officiel, photo par file_id', async () => {
  const r = await run({}, () => call('POST'));
  assert.equal(r.status, 200);
  assert.equal(taskPosts().length, 1, 'une seule tâche pour tous les effets');
  const b = mock.taskBody;
  assert.deepEqual(Object.keys(b).sort(), ['effects', 'src_file_id', 'version']); assert.equal(b.src_file_id, 'file-1'); assert.equal(b.version, '1.0'); assert.ok(!('src_file_url' in b));
  assert.deepEqual(b.effects.map(e => e.category), ['skin_smooth', 'foundation', 'eye_shadow', 'blush', 'lip_color']);
  assert.deepEqual(b.effects[0], { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 }, 'aucun lissage involontaire');
  const by = c => b.effects.find(e => e.category === c);
  assert.deepEqual(by('foundation').palettes, [{ color: '#c38a5e', colorIntensity: 40, glowIntensity: 30, coverageIntensity: 40 }]);
  assert.deepEqual(by('lip_color').palettes, [{ color: '#8e5440', texture: 'satin', colorIntensity: 65 }]); assert.deepEqual(by('lip_color').shape, { name: 'original' }); assert.deepEqual(by('lip_color').style, { type: 'full' });
  assert.deepEqual(by('blush').palettes, [{ color: '#c0634a', texture: 'matte', colorIntensity: 45 }]); assert.deepEqual(by('blush').pattern, { name: '1color1' });
  const eye = by('eye_shadow').palettes[0]; assert.equal(eye.texture, 'shimmer'); assert.equal(eye.color, '#4b3025'); assert.match(eye.shimmerColor, /^#[0-9a-f]{6}$/); assert.ok(Number.isInteger(eye.shimmerIntensity));
  /* Chaque texture porte ses champs propres, tous entiers 0 à 100 ou couleurs. */
  for (const [cat, key] of [['lips', 'lip_color'], ['blush', 'blush'], ['eyes', 'eye_shadow']]) {
    for (const t of M.TEXTURES[cat]) {
      const e = M.buildEffects({ v: 1, [cat]: { color: '#aabbcc', texture: t, colorIntensity: 50 } }).find(x => x.category === key), p = e.palettes[0];
      assert.deepEqual(Object.keys(p).sort(), ['color', 'colorIntensity', 'texture', ...M.COMPANIONS[cat][t]].sort(), `${cat}/${t}`);
      for (const [k, v] of Object.entries(p)) { if (k === 'color' || k === 'shimmerColor') assert.match(v, /^#[0-9a-f]{6}$/); else if (k !== 'texture') assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${cat}/${t}/${k}`); }
    }
  }
  /* Un seul effet choisi : skin_smooth + cet effet, rien d'autre. */
  assert.deepEqual(M.buildEffects({ v: 1, lips: CFG_ALL.lips }).map(e => e.category), ['skin_smooth', 'lip_color']);
});

test('MK-S7 flux fournisseur : fichier (file_id) → PUT → UNE tâche → statut ; clé seulement vers Perfect Corp ; jamais d\'API d\'analyse ni de simulation ; l\'image n\'est pas téléchargée', async () => {
  const r = await run({}, () => call('POST'));
  assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.body).sort(), ['makeup', 'ok']); assert.deepEqual(Object.keys(r.body.makeup), ['image']);
  assert.equal(r.body.makeup.image, new URL(RESULT).toString());
  assert.deepEqual(rec.unexpected, []); assert.equal(rec.real, 0);
  assert.deepEqual(rec.calls.map(c => c.method + ' ' + c.url.replace(BASE, '')), ['POST /s2s/v2.0/file', 'PUT https://upload.example-pc.com/put/abc', 'POST ' + config.MAKEUP_PATHS.task, 'GET ' + config.MAKEUP_PATHS.taskStatus('t-mk-1')]);
  for (const c of rec.calls) { if (c.url.startsWith(BASE)) assert.equal(c.auth, 'Bearer ' + KEY); else assert.ok(!c.auth, 'la clé ne part pas vers l\'URL présignée'); }
  assert.ok(!r.raw.includes(KEY) && !/task_id|t-mk-1|file-1|envelope/.test(r.raw), 'le navigateur ne reçoit ni clé, ni task_id, ni enveloppe');
});

test('MK-S8 extraction du résultat : deux formes documentées seulement, https public, aucun parcours libre', () => {
  const U = 'https://cdn.example-pc.com/a/b.png?X=1';
  assert.equal(M.extractResultUrl({ data: { results: [{ download_url: U }] } }), U);
  assert.equal(M.extractResultUrl({ data: { results: [{ x: 1 }, { download_url: U }] } }), U, 'premier élément exploitable');
  assert.equal(M.extractResultUrl({ data: { results: { url: U } } }), U);
  for (const v of [undefined, null, {}, { data: {} }, { data: { results: [] } }, { data: { results: [{}] } }, { data: { results: {} } }, { data: { results: 'x' } },
    { data: { results: [{ download_url: 'http://cdn.example-pc.com/a.png' }] } }, { data: { results: [{ download_url: 'https://127.0.0.1/a.png' }] } }, { data: { results: [{ download_url: 'https://169.254.169.254/a' }] } },
    { data: { results: [{ download_url: 'https://localhost/a' }] } }, { data: { results: [{ download_url: 'https://user:pw@cdn.example-pc.com/a' }] } }, { data: { results: [{ download_url: 'javascript:alert(1)' }] } },
    { data: { results: [{ download_url: 'https://cdn.example-pc.com:8443/a' }] } }, { data: { results: { download_url: U } } }, { data: { results: [{ url: U }] } },
    { data: { output: [{ url: U }] } }, { data: { results: { nested: { url: U } } } }, { results: { url: U } }]) assert.equal(M.extractResultUrl(v), null, JSON.stringify(v));
});

test('MK-S9 résultat inutilisable : 502 avec message neutre, la STRUCTURE seulement est journalisée (jamais l\'URL ni la valeur), aucune relance', async () => {
  mock.status = null;
  const r = await run({}, async () => { mock.status = [{ data: { task_status: 'success', results: { image: { link: 'https://cdn.example-pc.com/SECRET-PATH.png?Signature=ABC' } } } }]; return call('POST'); });
  assert.equal(r.status, 502); assert.equal(r.body.error, errors.MESSAGES.MK_RESULT_INVALID);
  assert.equal(taskPosts().length, 1);
  const log = logs.join('\n'); assert.ok(!/SECRET-PATH|Signature=ABC|cdn\.example-pc\.com/.test(log), 'aucune valeur ni URL dans les journaux'); assert.match(log, /structure/);
});

test('MK-S10 quota PROPRE au maquillage : réservé APRÈS les validations et AVANT le fournisseur ; distinct de l\'analyse et de la simulation ; épuisé → 429 sans fournisseur', async () => {
  let r = await run({}, () => call('POST'));
  assert.equal(r.status, 200); assert.deepEqual(rpc(), ['reserve_makeup'], 'une seule réservation, de la fonction du maquillage');
  assert.equal(SB.mkUsage.get(USER).length, 1); assert.equal(SB.usage.get(USER), undefined); assert.equal(SB.simUsage.get(USER), undefined);
  assert.ok(rec.calls.length > 0 && rpc().length === 1);
  const a = await run({ DERMAI_MAX_MAKEUP_PER_PERIOD: '2' }, async () => [await call('POST'), await call('POST'), await call('POST')]);
  assert.deepEqual(a.map(x => x.status), [200, 200, 429]); assert.equal(a[2].body.error, errors.MESSAGES.MK_QUOTA_EXCEEDED); assert.ok(a[2].headers['Retry-After']);
  assert.equal(taskPosts().length, 2, 'le troisième essayage n\'appelle pas le fournisseur');
  /* Réglage propre : épuiser les analyses ou les simulations ne bloque pas le maquillage, et inversement. */
  SB.usage.set(USER, Array.from({ length: 50 }, () => SB.state.now())); SB.simUsage.set(USER, Array.from({ length: 50 }, () => SB.state.now()));
  r = await withEnv(Object.assign({}, open), async () => (await quiet(() => call('POST')))[0]); assert.equal(r.status, 200);
  assert.deepEqual(config.makeupQuota({}), { limit: 3, windowSeconds: 86400 }); assert.deepEqual(config.makeupQuota({ DERMAI_MAX_MAKEUP_PER_PERIOD: '5', DERMAI_MAKEUP_PERIOD_HOURS: '12' }), { limit: 5, windowSeconds: 43200 });
  /* Erreurs de quota : fermé par défaut (fail closed). */
  r = await run({}, async () => { SB.state.makeupQuotaMissing = true; return call('POST'); }); assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.MK_QUOTA_UNAVAILABLE); assert.equal(taskPosts().length, 0, 'fonction SQL absente : rien n\'est appelé');
  r = await run({}, async () => { SB.state.failQuota = true; return call('POST'); }); assert.equal(r.status, 503); assert.equal(rec.calls.length, 0);
});

test('MK-S11 aucune relance automatique : réseau coupé à la création, erreur de tâche, délai dépassé → UNE seule tâche, jamais recréée', async () => {
  let r = await run({}, async () => { mock.taskAbort = true; return call('POST'); });
  assert.notEqual(r.status, 200); assert.equal(taskPosts().length, 1, 'création incertaine : aucune seconde tâche');
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'InvalidFace', error_message: 'no face detected' } }]; return call('POST'); });
  assert.equal(r.status, 422); assert.match(r.body.error, /visage/i, 'visage non détecté : message précis, la photo est à changer'); assert.equal(taskPosts().length, 1);
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'Internal', error_message: 'worker crashed' } }]; return call('POST'); });
  assert.equal(r.status, 422); assert.equal(r.body.error, errors.MESSAGES.MK_TASK_ERROR); assert.equal(taskPosts().length, 1); assert.ok(!/worker/.test(r.raw));
  r = await run({}, async () => { mock.fileFail = true; return call('POST'); }); assert.notEqual(r.status, 200); assert.equal(taskPosts().length, 0);
  r = await run({}, async () => { mock.noTaskId = true; return call('POST'); }); assert.equal(r.status, 502); assert.equal(taskPosts().length, 1);
  /* Polling borné : jamais plus de tentatives que le plafond, jamais de nouvelle création. */
  let slept = 0; reset(); mock.status = [{ data: { task_status: 'running' } }];
  const [err] = await quiet(() => studio.tryOn({ buffer: JPEG, mime: 'image/jpeg', config: CFG_ALL }, { apiKey: KEY, sleep: async () => { slept++; }, polling: { intervalMs: 1, maxAttempts: 4, totalTimeoutMs: 100000 } }).then(() => null, e => e));
  assert.equal(err.code, 'TIMEOUT'); assert.equal(err.status, 504); assert.equal(polls, 4); assert.equal(slept, 3); assert.equal(taskPosts().length, 1);
  assert.equal(errors.toMakeupMessage('TIMEOUT'), errors.MESSAGES.MK_TIMEOUT);
});

test('MK-S12 crédits fournisseur épuisés : 503 avec message neutre (le détail reste dans les journaux serveur), jamais le texte du fournisseur', async () => {
  let r = await run({}, async () => { mock.taskError = { status: 402, body: { error: 'insufficient credit', error_message: 'not enough units on account ACME-1234' } }; return call('POST'); });
  assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.MK_PROVIDER_CREDIT); assert.ok(!/ACME|credit|units/i.test(r.raw)); assert.equal(taskPosts().length, 1);
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'out_of_credits' } }]; return call('POST'); });
  assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.MK_PROVIDER_CREDIT);
  assert.equal(errors.isProviderCreditError('InvalidFace: no face'), false); assert.equal(errors.isProviderCreditError('Insufficient credits'), true);
});

test('MK-S13 journaux minimaux : ni clé, ni octets de photo, ni URL signée, ni identifiant de compte ni jeton', async () => {
  const r = await run({}, () => call('POST')); assert.equal(r.status, 200);
  const log = logs.join('\n');
  for (const secret of [KEY, TOKEN, USER, 'SECRETSIG', 'cdn.example-pc.com', 'upload.example-pc.com', 'file-1', 't-mk-1', 'a@exemple.com', '#8e5440', 'colorIntensity']) assert.ok(!log.includes(secret), 'absent des journaux : ' + secret);
  const r2 = await run({}, async () => { mock.taskError = { status: 400, body: { error: 'bad', error_message: 'token ' + TOKEN } }; return call('POST'); });
  assert.notEqual(r2.status, 200); assert.ok(!r2.raw.includes(TOKEN) && !r2.raw.includes(KEY));
});

test('MK-S14 séparation du code : le handler n\'appelle ni l\'analyse ni la simulation, la clé n\'est jamais dans le navigateur, durée 60 s, env documentées', () => {
  const api = read('api/makeup-vto.js').replace(/\/\*[\s\S]*?\*\//g, ''), prov = read('server/perfectcorp-makeup.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/skin-analysis|skin-simulation|perfectcorp-simulation|SIM_PATHS|PERFECT_CORP_PATHS\.skinTask/.test(api + prov), 'aucun point d\'entrée d\'analyse ni de simulation');
  for (const f of ['js/makeup-studio.js', 'js/makeup-data.js', 'js/app.js', 'index.html']) assert.ok(!/PERFECT_CORP_API_KEY|api\.makeupar|yce\.perfectcorp|s2s\/v2/i.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), f + ' ne connaît ni la clé ni l\'hôte du fournisseur');
  const vercel = JSON.parse(read('vercel.json')); assert.equal(vercel.functions['api/makeup-vto.js'].maxDuration, 60);
  const sql = read('supabase/proposals/20261012120000_makeup_quota.sql'); assert.match(sql, /reserve_makeup/);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /makeup/i.test(f)), [], 'aucune migration appliquée par cette mission');
  const envs = read('.env.example'); for (const k of ['DERMAI_MAKEUP_ENABLED', 'DERMAI_MAKEUP_ALLOWED_USER_IDS', 'DERMAI_MAX_MAKEUP_PER_PERIOD', 'DERMAI_MAKEUP_PERIOD_HOURS']) assert.match(envs, new RegExp(k));
  assert.match(envs, /DERMAI_MAKEUP_ENABLED=\s*(#.*)?$/m, 'valeur par défaut : vide (fermé)');
});
