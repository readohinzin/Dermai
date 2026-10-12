'use strict';
/* Studio Beauté, volet capillaire : serveur (api/hair-vto.js, server/hair.js, server/perfectcorp-hair.js), TOUT simulé.
   Aucun appel réel à Perfect Corp : globalThis.fetch est remplacé par un faux fournisseur qui enregistre chaque appel, REFUSE tout hôte inconnu, tout appel aux API d'analyse, de simulation
   et de maquillage, et tout téléchargement de l'image résultat. Aucune unité n'est consommée par ce fichier : le compteur d'appels « réels » reste à zéro. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('stream');

const auth = require('../server/auth');
const quota = require('../server/quota');
const config = require('../server/config');
const errors = require('../server/errors');
const H = require('../server/hair');
const provider = require('../server/perfectcorp-hair');
const { createFake } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEY = 'TEST_ONLY_KEY_NOT_REAL_9f3a';
const USER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc', TOKEN2 = 'dddddddd.eeeeeeee.ffffffff';
const jpeg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const JPEG = jpeg(768, 1024);
const SB = createFake();
auth.api.fetchImpl = SB.fetch; quota.api.fetchImpl = SB.fetch;
SB.users.set('a@exemple.com', { id: USER, email: 'a@exemple.com', password: 'x', confirmed: true });
SB.users.set('b@exemple.com', { id: OTHER, email: 'b@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER, exp: Number.MAX_SAFE_INTEGER });
SB.tokens.set(TOKEN2, { sub: OTHER, exp: Number.MAX_SAFE_INTEGER });

const ENV0 = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key', PERFECT_CORP_API_KEY: KEY };
const open = { DERMAI_HAIR_ENABLED: '1', DERMAI_HAIR_ALLOWED_USER_IDS: USER, DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '100', DERMAI_HAIR_ALLOW_UNCONFIRMED: undefined, DERMAI_HAIR_FEATURES: undefined };
Object.assign(process.env, ENV0);
const handler = require('../api/hair-vto.js');

/* ───── Faux Perfect Corp ───── */
const BASE = config.PERFECT_CORP_BASE_URL;
const RESULT = 'https://cdn.example-pc.com/out/hair1.png?Signature=SECRETSIG&Expires=1';
const rec = { calls: [], unexpected: [], real: 0 };
const TEMPLATES = { data: { templates: [{ id: 'tpl_001', title: 'Tresses longues', category_name: 'Longues', thumb: 'https://cdn.example-pc.com/t/1.jpg' }, { id: 'tpl_002', name: 'Afro naturel', category: 'Afro', thumbnail: 'http://insecure.example.com/t/2.jpg' }, { id: '<script>', title: 'piège' }, { title: 'sans id' }, null], next_token: 'NEXT-1' } };
const mock = {};
let polls = 0, files = 0;
const reset = () => { rec.calls = []; rec.unexpected = []; polls = 0; files = 0; Object.assign(mock, { status: [{ data: { task_status: 'success', results: { url: RESULT } } }], fileFail: false, taskBody: null, taskPath: null, taskId: 't-hr-1', taskError: null, noTaskId: false, taskAbort: false, templates: TEMPLATES, templatesStatus: 200, templatesQuery: null }); };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const TASK_PATHS = new Set(['/s2s/v2.1/task/hair-transfer', '/s2s/v2.0/task/hair-color', '/s2s/v2.0/task/hair-extension', '/s2s/v2.0/task/bangs', '/s2s/v2.0/task/wavy-hair', '/s2s/v2.0/task/hair-volume', '/s2s/v2.0/task/custom-bangs']);
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), method = (init && init.method) || 'GET';
  rec.calls.push({ url: u, method, auth: init.headers && (init.headers.Authorization || init.headers.authorization), body: init.body });
  if (/skin-analysis|skin-simulation|simulation|makeup-vto/.test(u)) { rec.unexpected.push('AUTRE FONCTION ' + u); throw new Error('appel interdit'); }
  if (u === BASE + '/s2s/v2.0/file') {
    if (mock.fileFail) return json(500, { error: 'boom' });
    const n = ++files;
    return json(200, { data: { files: [{ file_id: 'file-' + n, requests: [{ url: 'https://upload.example-pc.com/put/' + n, method: 'PUT', headers: {} }] }] } });
  }
  if (/^https:\/\/upload\.example-pc\.com\/put\//.test(u)) return new Response('', { status: 200 });
  if (/cdn\.example-pc\.com/.test(u)) { rec.unexpected.push('TÉLÉCHARGEMENT du résultat par le serveur ' + u); throw new Error('le serveur ne télécharge pas l\'image'); }
  const rel = u.startsWith(BASE) ? u.slice(BASE.length) : null;
  if (rel && method === 'GET' && /^\/s2s\/v\d\.\d\/task\/template\//.test(rel)) { mock.templatesQuery = rel; return json(mock.templatesStatus, mock.templates); }
  if (rel && method === 'POST' && TASK_PATHS.has(rel)) {
    mock.taskBody = JSON.parse(init.body); mock.taskPath = rel;
    if (mock.taskAbort) throw new TypeError('network');
    if (mock.taskError) return json(mock.taskError.status, mock.taskError.body);
    return mock.noTaskId ? json(200, { data: {} }) : json(200, { data: { task_id: mock.taskId } });
  }
  if (rel && method === 'GET' && rel.endsWith('/' + mock.taskId) && TASK_PATHS.has(rel.slice(0, -mock.taskId.length - 1))) { const r = mock.status[Math.min(polls++, mock.status.length - 1)]; return json(200, r); }
  rec.unexpected.push(method + ' ' + u); rec.real++; throw new Error('hôte ou chemin inattendu : ' + u);
};

const cfgQ = c => encodeURIComponent(typeof c === 'string' ? c : JSON.stringify(c));
const STYLE = { v: 1, template: { id: 'tpl_001' } };
function call(method, { token = TOKEN, query = 'feature=hairstyle&cfg=' + cfgQ(STYLE), headers = {}, data = JPEG } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(data ? [data] : []);
    req.method = method; req.url = '/api/hair-vto' + (query ? '?' + query : '');
    req.headers = Object.assign({ 'content-type': 'image/jpeg' }, token ? { authorization: 'Bearer ' + token } : {}, headers);
    const sent = {};
    const res = { setHeader(k, v) { sent[k] = v; }, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b), headers: sent, raw: b }); } };
    handler(req, res);
  });
}
const post = (feature, cfg, o = {}) => call('POST', Object.assign({ query: `feature=${feature}&cfg=${cfgQ(cfg)}` }, o));
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
let logs = [];
const quiet = async fn => { const o = { log: console.log, warn: console.warn, error: console.error }; const lines = []; console.log = console.warn = console.error = (...a) => lines.push(a.join(' ')); try { return [await fn(), lines]; } finally { Object.assign(console, o); } };
const run = async (env, fn) => { reset(); handler._templateCache.clear(); SB.state.rpcCalls = []; SB.state.hairUnits = []; SB.hairUsage.clear(); SB.mkUsage.clear(); SB.usage.clear(); SB.simUsage.clear(); SB.state.hairQuotaMissing = false; SB.state.failQuota = false; return withEnv(Object.assign({}, open, env), async () => { const [r, l] = await quiet(fn); logs = l; return r; }); };
const rpc = () => SB.state.rpcCalls || [];
const taskPosts = () => rec.calls.filter(c => c.method === 'POST' && TASK_PATHS.has(c.url.slice(BASE.length)));
const ALL = { DERMAI_HAIR_ALLOW_UNCONFIRMED: '1' };
const FULL = { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#3B2417', color_intensity: 60, shine_intensity: 30 }] };
const OMBRE = { v: 1, pattern: { name: 'ombre', blend_strength: 50, line_offset: 0.2, coloring_section: 'top' }, palettes: [{ color: '#2b1b12' }, { color: '#C99A3C' }] };

test('HR-S1 méthode et session : seuls GET et POST (405), session valide exigée AVANT tout, même verrou fermé ; rien n\'est appelé ni réservé', async () => {
  let r = await run({}, () => call('DELETE'));
  assert.equal(r.status, 405); assert.equal(r.headers.Allow, 'GET, POST'); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  for (const env of [{}, { DERMAI_HAIR_ENABLED: undefined }]) for (const t of [null, 'zzz', 'aaaaaaaa.bbbbbbbb.invalid0']) for (const q of [undefined, 'templates=hairstyle', 'feature=hairstyle&cfg=x']) {
    for (const m of ['POST', 'GET']) {
      r = await run(env, () => call(m, { token: t, query: q }));
      assert.equal(r.status, 401, `${m} ${t} ${q}`); assert.equal(r.headers['WWW-Authenticate'], 'Bearer'); assert.equal(r.body.error, errors.toHairMessage('AUTH_REQUIRED'));
      assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
    }
  }
});

test('HR-S2 GET « disponible ? » : propre à chaque compte, fermé par défaut ; seules les fonctions CONFIRMÉES sont ouvertes, les autres sur drapeau explicite ; aucun fournisseur ni quota', async () => {
  let r = await run({}, () => call('GET', { query: undefined }));
  assert.equal(r.body.available, true); assert.deepEqual(r.body.features.map(f => f.id), ['hairstyle', 'haircolor'], 'seuls les chemins confirmés par une source officielle');
  assert.deepEqual(r.body.features.map(f => f.units), [2, 1]); assert.equal(r.body.features[0].templates, true); assert.equal(r.body.features[1].templates, false);
  r = await run(ALL, () => call('GET', { query: undefined })); assert.deepEqual(r.body.features.map(f => [f.id, f.units]), [['hairstyle', 2], ['haircolor', 1], ['extensions', 1], ['bangs', 1], ['wavy', 1], ['volume', 2]]);
  r = await run({ ...ALL, DERMAI_HAIR_FEATURES: 'haircolor, wavy' }, () => call('GET', { query: undefined })); assert.deepEqual(r.body.features.map(f => f.id), ['haircolor', 'wavy']);
  r = await run({ DERMAI_HAIR_PATH_BANGS: '/s2s/v2.0/task/custom-bangs' }, () => call('GET', { query: undefined })); assert.deepEqual(r.body.features.map(f => f.id), ['hairstyle', 'haircolor', 'bangs'], 'un chemin corrigé et valide ouvre la fonction');
  r = await run({ DERMAI_HAIR_PATH_BANGS: 'https://evil.example/x' }, () => call('GET', { query: undefined })); assert.deepEqual(r.body.features.map(f => f.id), ['hairstyle', 'haircolor'], 'un chemin invalide est ignoré');
  r = await run({}, () => call('GET', { token: TOKEN2, query: undefined })); assert.deepEqual(r.body, { ok: true, available: false, features: [] }, 'compte non listé');
  for (const v of [undefined, '', '0', 'false']) { r = await run({ DERMAI_HAIR_ENABLED: v }, () => call('GET', { query: undefined })); assert.equal(r.body.available, false, 'verrou fermé : ' + v); }
  r = await run({ DERMAI_HAIR_ALLOWED_USER_IDS: '*' }, () => call('GET', { token: TOKEN2, query: undefined })); assert.equal(r.body.available, true);
  r = await run({ DERMAI_HAIR_ALLOWED_USER_IDS: undefined }, () => call('GET', { query: undefined })); assert.equal(r.body.available, false, 'liste vide = personne');
  const saved = process.env.PERFECT_CORP_API_KEY; delete process.env.PERFECT_CORP_API_KEY;
  try { r = await run({}, () => call('GET', { query: undefined })); assert.equal(r.body.available, false, 'clé non configurée'); } finally { process.env.PERFECT_CORP_API_KEY = saved; }
  assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
});

test('HR-S3 interrupteur : désactivé par défaut (503), compte non autorisé (403) ; la photo n\'est pas lue, rien n\'est appelé ni réservé (essais et liste des modèles)', async () => {
  for (const q of ['feature=haircolor&cfg=' + cfgQ({ v: 1, preset: 'Jet Black' }), 'templates=hairstyle']) {
    for (const v of [undefined, '', '0', 'false']) {
      const r = await run({ DERMAI_HAIR_ENABLED: v }, () => call(q.startsWith('templates') ? 'GET' : 'POST', { query: q, headers: { 'content-type': 'image/png' }, data: Buffer.from([1, 2, 3]) }));
      assert.equal(r.status, 503, String(v)); assert.equal(r.body.error, errors.MESSAGES.HR_DISABLED); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
    }
    for (const list of [undefined, '', OTHER, 'tous', 'all']) {
      const r = await run({ DERMAI_HAIR_ALLOWED_USER_IDS: list }, () => call(q.startsWith('templates') ? 'GET' : 'POST', { query: q }));
      assert.equal(r.status, 403, String(list)); assert.equal(r.body.error, errors.MESSAGES.HR_DISABLED); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
    }
  }
  assert.equal(config.isHairEnabled({}), false); assert.equal(config.isHairAllowed(USER, {}), false); assert.equal(config.isHairAllowed('', { DERMAI_HAIR_ALLOWED_USER_IDS: '*' }), false);
});

test('HR-S4 sélection : validation STRICTE par fonction, avant la photo, le quota et le fournisseur ; fonction inconnue ou fermée, preset ET couleur libre, URL ou corps fournisseur refusés', async () => {
  const bad = [
    ['hairstyle', ''], ['hairstyle', '{'], ['hairstyle', '{}'], ['hairstyle', { v: 1 }], ['hairstyle', { v: 2, template: { id: 'a' } }],
    ['hairstyle', { v: 1, template: { id: 'a' }, reference: true }, 'modèle ET référence'], ['hairstyle', { v: 1, reference: false }], ['hairstyle', { v: 1, template: { id: '../x' } }], ['hairstyle', { v: 1, template: { id: 'a b' } }],
    ['hairstyle', { v: 1, template: { id: 'x'.repeat(121) } }], ['hairstyle', { v: 1, template: { id: 'a', hair_color: 'blue' } }], ['hairstyle', { v: 1, template: { id: 'a', url: 'http://x' } }],
    ['hairstyle', { v: 1, template: { id: 'a' }, src_file_url: 'http://169.254.169.254/' }], ['hairstyle', { v: 1, template: { id: 'a' }, src_file_id: 'abc' }], ['hairstyle', { v: 1, template: { id: 'a' }, ref_file_url: 'https://evil.example/x.jpg' }],
    ['haircolor', { v: 1 }], ['haircolor', { v: 1, preset: 'Neon Green' }], ['haircolor', { v: 1, preset: 'Jet Black', pattern: { name: 'full' }, palettes: [{ color: '#000000' }] }, 'preset ET couleur libre'],
    ['haircolor', { v: 1, preset: 'Jet Black', palettes: [{ color: '#000000' }] }], ['haircolor', { v: 1, pattern: { name: 'full' } }], ['haircolor', { v: 1, pattern: { name: 'full' }, palettes: [] }],
    ['haircolor', { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#000000' }, { color: '#111111' }] }, 'deux palettes pour full'], ['haircolor', { v: 1, pattern: { name: 'full' }, palettes: [{ color: 'red' }] }],
    ['haircolor', { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#000000', color_intensity: 101 }] }], ['haircolor', { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#000000', shine_intensity: 1.5 }] }],
    ['haircolor', { v: 1, pattern: { name: 'full', blend_strength: 10 }, palettes: [{ color: '#000000' }] }, 'blend pour full'], ['haircolor', { v: 1, pattern: { name: 'ombre', blend_strength: 50, line_offset: 0.2, coloring_section: 'top' }, palettes: [{ color: '#000000' }] }, 'une palette pour ombre'],
    ['haircolor', { ...OMBRE, pattern: { ...OMBRE.pattern, line_offset: 1 } }], ['haircolor', { ...OMBRE, pattern: { ...OMBRE.pattern, line_offset: '0.2' } }], ['haircolor', { ...OMBRE, pattern: { ...OMBRE.pattern, coloring_section: 'bottom' } }],
    ['haircolor', { ...OMBRE, pattern: { ...OMBRE.pattern, blend_strength: -1 } }], ['haircolor', { v: 1, pattern: { name: 'stripes' }, palettes: [{ color: '#000000' }] }], ['haircolor', { v: 1, preset: 'Jet Black', template: { id: 'a' } }],
    ['extensions', { v: 1 }], ['extensions', { v: 1, reference: true }], ['extensions', { v: 1, template: { id: 'a', hair_color: 'ref' } }], ['bangs', { v: 1, preset: 'Jet Black' }], ['wavy', { v: 1, template: {} }], ['volume', { v: 1, template: { id: null } }]
  ];
  for (const [f, c] of bad) {
    const r = await run(ALL, () => post(f, c));
    assert.equal(r.status, 400, f + ' ' + JSON.stringify(c).slice(0, 90)); assert.equal(r.body.error, errors.MESSAGES.HR_INVALID_REQUEST);
    assert.equal(rec.calls.length, 0, 'rien n\'est appelé'); assert.deepEqual(rpc(), []);
  }
  for (const q of ['', 'cfg=' + cfgQ(STYLE), 'feature=inconnue&cfg=' + cfgQ(STYLE), 'feature=__proto__&cfg=' + cfgQ(STYLE), 'feature=hairstyle', 'feature=hairstyle&feature=haircolor&cfg=' + cfgQ(STYLE), 'feature=hairstyle&cfg=' + cfgQ(STYLE) + '&cfg=' + cfgQ(STYLE), 'feature=HAIRSTYLE&cfg=' + cfgQ(STYLE)]) {
    const r = await run({}, () => call('POST', { query: q })); assert.equal(r.status, 400, q); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  let r = await run({}, () => post('bangs', { v: 1, template: { id: 'a' } })); assert.equal(r.status, 400, 'fonction au chemin non confirmé : fermée par défaut'); assert.equal(rec.calls.length, 0);
  r = await run({}, () => post('hairstyle', { v: 1, template: { id: 'a' } }, { query: 'feature=hairstyle&cfg=' + cfgQ({ v: 1, template: { id: 'a' }, pad: 'x'.repeat(2000) }) })); assert.equal(r.status, 400);
  assert.ok(!/src_file_url|ref_file_url|image_url|searchParams\.get\('(url|image)/.test(read('api/hair-vto.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'le handler ne lit aucune URL fournie');
});

test('HR-S5 photos : JPEG réel, grand côté ≤ 1 024 px, petit côté ≥ 256 px ; référence découpée à ref_at ; tout refus AVANT le quota et le fournisseur', async () => {
  const cases = [
    [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg', 415], [JPEG, 'image/png', 415], [jpeg(1200, 1500), 'image/jpeg', 400], [jpeg(1025, 800), 'image/jpeg', 400], [jpeg(200, 200), 'image/jpeg', 400],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), 'image/jpeg', 400], [Buffer.concat([JPEG, Buffer.alloc(4 * 1024 * 1024)]), 'image/jpeg', 413]
  ];
  for (const [data, type, status] of cases) {
    const r = await run({}, () => post('haircolor', { v: 1, preset: 'Jet Black' }, { data, headers: { 'content-type': type } }));
    assert.equal(r.status, status, `${type} ${data.length} octets`); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  for (const [w, h] of [[1024, 768], [768, 1024], [256, 256], [600, 900]]) { const r = await run({}, () => post('haircolor', { v: 1, preset: 'Jet Black' }, { data: jpeg(w, h) })); assert.equal(r.status, 200, `${w}x${h}`); }
  /* Référence : deux JPEG à la suite, ref_at = taille de la première. */
  const A = jpeg(700, 900), B = jpeg(640, 800), REF = { v: 1, reference: true }, both = Buffer.concat([A, B]);
  let r = await run({}, () => post('hairstyle', REF, { data: both, query: `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${A.length}` })); assert.equal(r.status, 200);
  for (const q of [`feature=hairstyle&cfg=${cfgQ(REF)}`, `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=0`, `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${both.length}`, `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=abc`, `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${A.length}&ref_at=${A.length}`,
    `feature=hairstyle&cfg=${cfgQ(STYLE)}&ref_at=${A.length}`, `feature=haircolor&cfg=${cfgQ({ v: 1, preset: 'Jet Black' })}&ref_at=${A.length}`]) {
    r = await run({}, () => post('hairstyle', REF, { data: both, query: q })); assert.equal(r.status, 400, q); assert.equal(rec.calls.length, 0); assert.deepEqual(rpc(), []);
  }
  r = await run({}, () => post('hairstyle', REF, { data: Buffer.concat([A, Buffer.from([9, 9, 9, 9, 9, 9])]), query: `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${A.length}` })); assert.ok(r.status === 415 || r.status === 400, 'seconde partie non JPEG'); assert.equal(rec.calls.length, 0);
  r = await run({}, () => post('hairstyle', REF, { data: Buffer.concat([A, jpeg(2000, 900)]), query: `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${A.length}` })); assert.equal(r.status, 400, 'référence trop grande'); assert.equal(rec.calls.length, 0);
});

test('HR-S6 corps du fournisseur par fonction : chemins, photo par file_id, UNE tâche, aucun mélange de champs ; coiffure par modèle ou par référence, couleur par preset OU palettes', async () => {
  const body = () => mock.taskBody, only = (o, keys) => assert.deepEqual(Object.keys(o).sort(), keys.sort());
  let r = await run({}, () => post('hairstyle', STYLE)); assert.equal(r.status, 200);
  assert.equal(mock.taskPath, '/s2s/v2.1/task/hair-transfer'); only(body(), ['src_file_id', 'template_id']); assert.equal(body().src_file_id, 'file-1'); assert.equal(body().template_id, 'tpl_001'); assert.equal(taskPosts().length, 1);
  r = await run({}, () => post('hairstyle', { v: 1, template: { id: 'tpl_002', hair_color: 'src' } })); only(body(), ['hair_color', 'src_file_id', 'template_id']); assert.equal(body().hair_color, 'src');
  const A = jpeg(700, 900), B = jpeg(640, 800), REF = { v: 1, reference: true };
  r = await run({}, () => post('hairstyle', REF, { data: Buffer.concat([A, B]), query: `feature=hairstyle&cfg=${cfgQ(REF)}&ref_at=${A.length}` }));
  assert.equal(r.status, 200); only(body(), ['ref_file_id', 'src_file_id']); assert.deepEqual([body().src_file_id, body().ref_file_id], ['file-1', 'file-2']); assert.equal(taskPosts().length, 1, 'une seule tâche');
  assert.equal(rec.calls.filter(c => c.method === 'POST' && c.url.endsWith('/s2s/v2.0/file')).length, 2, 'deux envois de fichier (photo et référence)');
  r = await run({}, () => post('haircolor', { v: 1, preset: 'Burgundy' })); assert.equal(mock.taskPath, '/s2s/v2.0/task/hair-color'); assert.deepEqual(body(), { src_file_id: 'file-1', preset: 'Burgundy' }, 'preset seul : jamais de pattern ni de palettes');
  r = await run({}, () => post('haircolor', { v: 1, preset: 'Dark Brown/Caramel Blonde' })); assert.equal(body().preset, 'Dark Brown/Caramel Blonde');
  r = await run({}, () => post('haircolor', FULL)); assert.deepEqual(body(), { src_file_id: 'file-1', pattern: { name: 'full' }, palettes: [{ color: '#3b2417', color_intensity: 60, shine_intensity: 30 }] }, 'personnalisée : jamais de preset');
  r = await run({}, () => post('haircolor', OMBRE)); assert.deepEqual(body(), { src_file_id: 'file-1', pattern: { name: 'ombre', blend_strength: 50, line_offset: 0.2, coloring_section: 'top' }, palettes: [{ color: '#2b1b12' }, { color: '#c99a3c' }] });
  for (const [f, p] of [['extensions', '/s2s/v2.0/task/hair-extension'], ['bangs', '/s2s/v2.0/task/bangs'], ['wavy', '/s2s/v2.0/task/wavy-hair'], ['volume', '/s2s/v2.0/task/hair-volume']]) {
    r = await run(ALL, () => post(f, { v: 1, template: { id: 'tpl_009' } })); assert.equal(r.status, 200, f); assert.equal(mock.taskPath, p); assert.deepEqual(body(), { src_file_id: 'file-1', template_id: 'tpl_009' }, f); assert.equal(taskPosts().length, 1);
  }
  r = await run({ DERMAI_HAIR_PATH_BANGS: '/s2s/v2.0/task/custom-bangs' }, () => post('bangs', { v: 1, template: { id: 'tpl_009' } })); assert.equal(r.status, 200); assert.equal(mock.taskPath, '/s2s/v2.0/task/custom-bangs', 'chemin corrigé par variable');
  assert.ok(rec.calls.every(c => !/src_file_url/.test(String(c.body || ''))), 'jamais d\'URL de photo');
  assert.deepEqual(H.IDS.map(i => H.FEATURES[i].units), [2, 1, 1, 1, 1, 2], 'unités annoncées');
  assert.deepEqual(H.IDS.filter(i => H.FEATURES[i].pathConfirmed), ['hairstyle', 'haircolor']);
  assert.throws(() => H.buildTaskBody('hairstyle', REF, { src: 'a' }), e => e.code === 'HR_INVALID_REQUEST' && /référence/.test(e.detail), 'jamais de référence sans second fichier');
});

test('HR-S7 liste des modèles : chemin confirmé, lecture prudente (identifiants sûrs, miniatures https), cache, page suivante fournie par le fournisseur, forme inconnue refusée', async () => {
  let r = await run({}, () => call('GET', { query: 'templates=hairstyle' }));
  assert.equal(r.status, 200); assert.equal(mock.templatesQuery, '/s2s/v2.1/task/template/hair-transfer'); assert.equal(rec.calls[0].auth, 'Bearer ' + KEY);
  assert.deepEqual(r.body.templates, [{ id: 'tpl_001', title: 'Tresses longues', category: 'Longues', thumb: 'https://cdn.example-pc.com/t/1.jpg' }, { id: 'tpl_002', title: 'Afro naturel', category: 'Afro', thumb: null }], 'identifiants piégés ignorés, miniature http refusée');
  assert.equal(r.body.next, 'NEXT-1'); assert.deepEqual(rpc(), [], 'aucun quota pour lister'); assert.equal(taskPosts().length, 0, 'aucune tâche');
  /* cache : la deuxième lecture ne rappelle pas le fournisseur ; page suivante : jeton transmis tel que reçu, validé */
  const first = await run({}, async () => { const a = await call('GET', { query: 'templates=hairstyle' }); const n = rec.calls.length; const b = await call('GET', { query: 'templates=hairstyle' }); return [a, b, n, rec.calls.length]; });
  assert.deepEqual(first[0].body, first[1].body); assert.equal(first[2], first[3], 'cache : aucun nouvel appel');
  r = await run({}, () => call('GET', { query: 'templates=hairstyle&next=NEXT-1' })); assert.equal(mock.templatesQuery, '/s2s/v2.1/task/template/hair-transfer?starting_token=NEXT-1');
  for (const q of ['templates=hairstyle&next=' + encodeURIComponent('a b<'), 'templates=hairstyle&next=' + 'x'.repeat(301), 'templates=hairstyle&next=', 'templates=haircolor', 'templates=inconnue', 'templates=bangs', 'templates=hairstyle&templates=bangs']) {
    r = await run({}, () => call('GET', { query: q })); assert.equal(r.status, 400, q); assert.equal(rec.calls.length, 0);
  }
  for (const bad of [{ data: {} }, { data: { templates: 'x' } }, { data: { templates: [] } }, { data: { templates: [{ title: 'sans id' }, { id: '<x>' }] } }, {}, { items: [{ id: 'a' }] }]) {
    r = await run({}, async () => { mock.templates = bad; return call('GET', { query: 'templates=hairstyle' }); });
    assert.equal(r.status, 502, JSON.stringify(bad)); assert.equal(r.body.error, errors.MESSAGES.HR_TEMPLATES_UNAVAILABLE); assert.match(logs.join('\n'), /structure/);
  }
  r = await run({}, async () => { mock.templatesStatus = 500; return call('GET', { query: 'templates=hairstyle' }); }); assert.ok(r.status >= 500);
  r = await run(ALL, () => call('GET', { query: 'templates=extensions' })); assert.equal(r.status, 200); assert.equal(mock.templatesQuery, '/s2s/v2.0/task/template/hair-extension', 'motif confirmé « /task/template/<fonction> »');
  assert.equal(H.parseTemplates({ data: { templates: [{ id: 'a'.repeat(200) }] } }).templates.length, 0);
});

test('HR-S8 flux fournisseur : fichier(s) → PUT → UNE tâche → statut ; clé seulement vers Perfect Corp ; jamais une autre API ; l\'image n\'est pas téléchargée ; réponse minimale', async () => {
  const r = await run({}, () => post('haircolor', { v: 1, preset: 'Jet Black' }));
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, hair: { feature: 'haircolor', image: new URL(RESULT).toString() } });
  assert.deepEqual(rec.unexpected, []); assert.equal(rec.real, 0);
  assert.deepEqual(rec.calls.map(c => c.method + ' ' + c.url.replace(BASE, '')), ['POST /s2s/v2.0/file', 'PUT https://upload.example-pc.com/put/1', 'POST /s2s/v2.0/task/hair-color', 'GET /s2s/v2.0/task/hair-color/t-hr-1']);
  for (const c of rec.calls) { if (c.url.startsWith(BASE)) assert.equal(c.auth, 'Bearer ' + KEY); else assert.ok(!c.auth, 'la clé ne part pas vers l\'URL présignée'); }
  assert.ok(!r.raw.includes(KEY) && !/task_id|t-hr-1|file-1|envelope/.test(r.raw), 'le navigateur ne reçoit ni clé, ni task_id, ni enveloppe');
  assert.equal(H.extractResultUrl({ data: { results: { url: 'https://cdn.example-pc.com/a.png' } } }), 'https://cdn.example-pc.com/a.png');
  assert.equal(H.extractResultUrl({ data: { results: { url: 'http://cdn.example-pc.com/a.png' } } }), null); assert.equal(H.extractResultUrl({ data: { results: { url: 'https://127.0.0.1/a.png' } } }), null); assert.equal(H.extractResultUrl({ data: { output: [{ url: 'https://x.example.com/a' }] } }), null);
});

test('HR-S9 quota en UNITÉS, propre au volet capillaire : réservé APRÈS les validations et AVANT le fournisseur ; 2 pour une coiffure, 1 pour une couleur ; distinct des autres quotas ; épuisé → 429 ; fonction absente → 503', async () => {
  let r = await run({}, () => post('hairstyle', STYLE)); assert.equal(r.status, 200);
  assert.deepEqual(rpc(), ['reserve_hair']); assert.deepEqual(SB.state.hairUnits, [2]); assert.equal(SB.hairUsage.get(USER)[0].units, 2);
  assert.equal(SB.usage.get(USER), undefined); assert.equal(SB.simUsage.get(USER), undefined); assert.equal(SB.mkUsage.get(USER), undefined, 'ni analyses, ni simulations, ni maquillage');
  r = await run(ALL, () => post('volume', { v: 1, template: { id: 'a' } })); assert.deepEqual(SB.state.hairUnits, [2], 'volume : 2 unités');
  r = await run({}, () => post('haircolor', { v: 1, preset: 'Jet Black' })); assert.deepEqual(SB.state.hairUnits, [1]);
  const a = await run({ DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '5' }, async () => [await post('hairstyle', STYLE), await post('hairstyle', STYLE), await post('haircolor', { v: 1, preset: 'Jet Black' }), await post('haircolor', { v: 1, preset: 'Jet Black' })]);
  assert.deepEqual(a.map(x => x.status), [200, 200, 200, 429], '2 + 2 + 1 = 5 unités ; la suivante dépasse');
  assert.equal(a[3].body.error, errors.MESSAGES.HR_QUOTA_EXCEEDED); assert.ok(a[3].headers['Retry-After']); assert.equal(taskPosts().length, 3, 'le refus n\'appelle pas le fournisseur');
  const b = await run({ DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '3' }, async () => [await post('hairstyle', STYLE), await post('haircolor', { v: 1, preset: 'Jet Black' }), await post('hairstyle', STYLE)]);
  assert.deepEqual(b.map(x => x.status), [200, 200, 429], '2 + 1 = 3 ; une coiffure (2) ne passe plus');
  SB.usage.set(USER, Array.from({ length: 50 }, () => SB.state.now())); SB.simUsage.set(USER, Array.from({ length: 50 }, () => SB.state.now())); SB.mkUsage.set(USER, Array.from({ length: 50 }, () => SB.state.now()));
  r = await withEnv(open, async () => (await quiet(() => post('hairstyle', STYLE)))[0]); assert.equal(r.status, 200, 'les autres quotas épuisés ne bloquent pas les essais capillaires');
  assert.deepEqual(config.hairQuota({}), { limit: 6, windowSeconds: 86400 }); assert.deepEqual(config.hairQuota({ DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '10', DERMAI_HAIR_PERIOD_HOURS: '12' }), { limit: 10, windowSeconds: 43200 });
  assert.deepEqual(config.hairQuota({ DERMAI_MAX_HAIR_UNITS_PER_PERIOD: 'abc', DERMAI_HAIR_PERIOD_HOURS: '-3' }), { limit: 6, windowSeconds: 86400 }, 'valeurs invalides : défaut prudent');
  r = await run({}, async () => { SB.state.hairQuotaMissing = true; return post('hairstyle', STYLE); }); assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.HR_QUOTA_UNAVAILABLE); assert.equal(taskPosts().length, 0, 'fonction SQL absente : rien n\'est appelé');
  r = await run({}, async () => { SB.state.failQuota = true; return post('hairstyle', STYLE); }); assert.equal(r.status, 503); assert.equal(rec.calls.length, 0);
  await assert.rejects(() => quota.reserveHair('t', 0), /./); await assert.rejects(() => quota.reserveHair('t', 11), /./); await assert.rejects(() => quota.reserveHair('t', 1.5), /./);
});

test('HR-S10 aucune relance automatique : réseau coupé, erreur de tâche, délai dépassé → UNE seule tâche, jamais recréée ; erreurs claires et neutres', async () => {
  let r = await run({}, async () => { mock.taskAbort = true; return post('hairstyle', STYLE); });
  assert.notEqual(r.status, 200); assert.equal(taskPosts().length, 1, 'création incertaine : aucune seconde tâche');
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'InvalidFace', error_message: 'no face detected' } }]; return post('hairstyle', STYLE); });
  assert.equal(r.status, 422); assert.match(r.body.error, /visage/i); assert.equal(taskPosts().length, 1);
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'error', error: 'Internal', error_message: 'worker crashed' } }]; return post('hairstyle', STYLE); });
  assert.equal(r.status, 422); assert.equal(r.body.error, errors.MESSAGES.HR_TASK_ERROR); assert.ok(!/worker/.test(r.raw));
  r = await run({}, async () => { mock.fileFail = true; return post('hairstyle', STYLE); }); assert.notEqual(r.status, 200); assert.equal(taskPosts().length, 0);
  r = await run({}, async () => { mock.noTaskId = true; return post('hairstyle', STYLE); }); assert.equal(r.status, 502); assert.equal(taskPosts().length, 1);
  r = await run({}, async () => { mock.status = [{ data: { task_status: 'success', results: { image: { link: 'https://cdn.example-pc.com/SECRET-PATH.png' } } } }]; return post('hairstyle', STYLE); });
  assert.equal(r.status, 502); assert.equal(r.body.error, errors.MESSAGES.HR_RESULT_INVALID); assert.equal(taskPosts().length, 1); assert.ok(!/SECRET-PATH|cdn\.example-pc\.com/.test(logs.join('\n')), 'aucune valeur ni URL dans les journaux'); assert.match(logs.join('\n'), /structure/);
  let slept = 0; reset(); mock.status = [{ data: { task_status: 'running' } }];
  const feature = H.findFeature('hairstyle');
  const [err] = await quiet(() => provider.tryOn({ feature, buffer: JPEG, mime: 'image/jpeg', config: STYLE }, { apiKey: KEY, sleep: async () => { slept++; }, polling: { intervalMs: 1, maxAttempts: 4, totalTimeoutMs: 100000 } }).then(() => null, e => e));
  assert.equal(err.code, 'TIMEOUT'); assert.equal(err.status, 504); assert.equal(polls, 4); assert.equal(slept, 3); assert.equal(taskPosts().length, 1);
  assert.equal(errors.toHairMessage('TIMEOUT'), errors.MESSAGES.HR_TIMEOUT);
  for (const body of [{ error: 'insufficient credit', error_message: 'not enough units on account ACME-1234' }]) {
    r = await run({}, async () => { mock.taskError = { status: 402, body }; return post('hairstyle', STYLE); });
    assert.equal(r.status, 503); assert.equal(r.body.error, errors.MESSAGES.HR_PROVIDER_CREDIT); assert.ok(!/ACME|credit|units/i.test(r.raw));
  }
});

test('HR-S11 journaux minimaux : ni clé, ni octets de photo, ni URL signée, ni identifiant de compte ni jeton, ni identifiant de modèle ni couleurs', async () => {
  const r = await run({}, () => post('haircolor', FULL)); assert.equal(r.status, 200);
  const log = logs.join('\n');
  for (const secret of [KEY, TOKEN, USER, 'SECRETSIG', 'cdn.example-pc.com', 'upload.example-pc.com', 'file-1', 't-hr-1', 'a@exemple.com', '#3b2417', 'color_intensity', 'tpl_001']) assert.ok(!log.includes(secret), 'absent des journaux : ' + secret);
  const r2 = await run({}, async () => { mock.taskError = { status: 400, body: { error: 'bad', error_message: 'token ' + TOKEN } }; return post('hairstyle', STYLE); });
  assert.notEqual(r2.status, 200); assert.ok(!r2.raw.includes(TOKEN) && !r2.raw.includes(KEY));
});

test('HR-S12 séparation du code : ni analyse, ni simulation, ni maquillage dans le volet capillaire ; clé jamais dans le navigateur ; durée 60 s ; variables et SQL documentés ; aucune migration appliquée', () => {
  const code = ['api/hair-vto.js', 'server/hair.js', 'server/perfectcorp-hair.js'].map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/skin-analysis|skin-simulation|perfectcorp-simulation|perfectcorp-makeup|makeup-vto|SIM_PATHS|MAKEUP_PATHS|PERFECT_CORP_PATHS\.skinTask|reserveMakeup|reserveSimulation|quota\.reserve\(/.test(code), 'aucun point d\'entrée d\'une autre fonction');
  for (const f of ['js/makeup-studio.js', 'js/makeup-data.js', 'js/app.js', 'index.html']) assert.ok(!/PERFECT_CORP_API_KEY|api\.makeupar|yce\.perfectcorp|s2s\/v2/i.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')), f + ' ne connaît ni la clé ni l\'hôte du fournisseur');
  assert.equal(JSON.parse(read('vercel.json')).functions['api/hair-vto.js'].maxDuration, 60);
  assert.match(read('supabase/proposals/20261013120000_hair_quota.sql'), /reserve_hair/);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /hair|makeup/i.test(f)), [], 'aucune migration appliquée par cette mission');
  const envs = read('.env.example'); for (const k of ['DERMAI_HAIR_ENABLED', 'DERMAI_HAIR_ALLOWED_USER_IDS', 'DERMAI_MAX_HAIR_UNITS_PER_PERIOD', 'DERMAI_HAIR_PERIOD_HOURS', 'DERMAI_HAIR_FEATURES', 'DERMAI_HAIR_ALLOW_UNCONFIRMED']) assert.match(envs, new RegExp(k));
  assert.match(envs, /DERMAI_HAIR_ENABLED=\s*(#.*)?$/m, 'valeur par défaut : vide (fermé)'); assert.match(envs, /DERMAI_HAIR_ALLOW_UNCONFIRMED=\s*(#.*)?$/m);
});
