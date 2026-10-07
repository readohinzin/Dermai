'use strict';
/* Carte du visage : seuls les masques RÉELS de Perfect Corp sont affichés ; aucune zone n'est jamais inventée.
   Les masques de ces tests sont des PNG générés ici (fixtures de test), servis par un faux réseau : aucun appel Perfect Corp réel. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('stream');
const FM = require('../js/face-map.js');
const masks = require('../server/masks.js');
const skinModel = require('../js/skin-model.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* PNG minimal (RGBA 8 bits) */
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = fn(x, y); raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4); } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ZONE = png(30, 40, (x, y) => (x > 5 && x < 15 && y > 10 && y < 20 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
const ZONE2 = png(30, 40, (x, y) => (x > 18 && y > 25 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
const fakeNet = (files, seen = []) => async (url, init) => {
  seen.push({ url, init });
  const f = files[url];
  if (!f) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, url, headers: { get: k => (k === 'content-length' ? String(f.length) : null) }, arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.length) };
};
const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');
function envelope(edit) { const e = JSON.parse(JSON.stringify(JSON_RESP)); for (const el of e.data.results.output) if (el.mask_urls) el.mask_urls = []; if (edit) edit(e.data.results.output); return e; }
const el = (out, type) => out.find(e => e.type === type);

test('FM1 masque réel : un masque Perfect Corp fourni est téléchargé côté serveur et rendu en data URL (octets identiques)', async () => {
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/acne.png': ZONE });
  const { localization, stats } = await masks.collect(envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png']; }));
  assert.deepEqual(Object.keys(localization), ['acne']);
  assert.equal(localization.acne.length, 1);
  assert.ok(localization.acne[0].startsWith('data:image/png;base64,'));
  assert.deepEqual(Buffer.from(localization.acne[0].split(',')[1], 'base64'), ZONE);
  assert.deepEqual(stats, { metrics: 1, listed: 1, kept: 1 });
  assert.deepEqual(FM.sanitize(localization, skinModel.METRIC_KEYS), localization);
});

test('FM2 aucun masque : rien n\'est renvoyé, rien n\'est proposé à l\'affichage', async () => {
  masks.api.fetchImpl = fakeNet({});
  assert.deepEqual((await masks.collect(envelope())).localization, {});
  assert.equal(FM.sanitize({}, skinModel.METRIC_KEYS), null);
  assert.equal(FM.sanitize(undefined, skinModel.METRIC_KEYS), null);
  const app = read('js/app.js');
  assert.match(app, /const fmKeys=!H&&!DEMO_MODE&&s\.photo&&s\.localization\?SkinModel\.METRIC_KEYS\.filter\(k=>s\.localization\[k\]\):\[\];/);
  assert.match(app, /\$\{fmKeys\.length\?faceMapHtml\(s,fmKeys\):``\}/);
});

test('FM3 pas d\'invention : les scores ne créent ni ne modifient aucune zone', async () => {
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/acne.png': ZONE });
  const a = await masks.collect(envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png']; }));
  const b = await masks.collect(envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png']; for (const e of o) if ('ui_score' in e) { e.ui_score = 3; e.raw_score = 97; } }));
  assert.deepEqual(a.localization, b.localization);
  const c = await masks.collect(envelope(o => { for (const e of o) if ('ui_score' in e) e.ui_score = 1; }));   // scores très bas, aucun masque
  assert.deepEqual(c.localization, {});
  // le module d'affichage ne lit aucun score, priorité, type de peau, pays ou moteur
  for (const f of ['js/face-map.js', 'server/masks.js']) assert.doesNotMatch(code(f), /ui_score|uiScore|raw_score|priorit|skin_?type|market|country|pays|Engine|routine|catalog/i, f);
  assert.equal(FM.paint.length, 3, 'paint(alpha, w, h) : aucune entrée de score');
});

test('FM4 / FM5 priorités et type de peau : n\'ont aucun effet sur la localisation', async () => {
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/pore.png': ZONE });
  const base = o => { el(o, 'pore').mask_urls = ['https://cdn.pc-results.com/pore.png']; };
  const a = await masks.collect(envelope(base));
  const b = await masks.collect(envelope(o => { base(o); for (const e of o) if (e.type === 'skin_type') e.skin_type = 'Dry & Redness'; el(o, 'moisture').ui_score = 5; }));
  assert.deepEqual(a.localization, b.localization);
  assert.deepEqual(Object.keys(b.localization), ['pores']);   // la priorité « hydratation » (score 5) n'a reçu aucune zone
});

test('FM6 pays : le choix du pays ne touche pas aux masques (aucune dépendance)', () => {
  const app = read('js/app.js');
  assert.match(app, /DermaiFaceMap\.mount\(fm,\{items,hidden:!!state\.faceHide,onStatus:/);
  assert.match(app, /const items=keys\.map\(k=>\(\{key:k,label:SkinModel\.METRIC_LABELS\[k\],score:SkinModel\.displayScore\(sc\.normalized\[k\]&&sc\.normalized\[k\]\.uiScore\),masks:loc\[k\]\}\)\)/);
  assert.doesNotMatch(code('js/face-map.js'), /market|country|MK\./i);
});

test('FM7 historique : une analyse sans masque fonctionne ; l\'historique n\'enregistre jamais de masque', () => {
  const app = read('js/app.js');
  const rec = app.slice(app.indexOf('function recordOfScan'), app.indexOf('function isRecordable'));
  assert.doesNotMatch(rec, /localization|mask|photo/i);
  assert.match(app, /!H&&!DEMO_MODE&&s\.photo&&s\.localization/);   // analyse ancienne (H) ou sans photo : aucune carte
});

test('FM8 plusieurs masques : conservés, dans l\'ordre, sans être fusionnés', async () => {
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/w1.png': ZONE, 'https://cdn.pc-results.com/w2.png': ZONE2 });
  const { localization } = await masks.collect(envelope(o => { el(o, 'wrinkle').mask_urls = ['https://cdn.pc-results.com/w1.png', 'https://cdn.pc-results.com/w2.png']; }));
  assert.equal(localization.wrinkles.length, 2);
  assert.deepEqual(Buffer.from(localization.wrinkles[0].split(',')[1], 'base64'), ZONE);
  assert.deepEqual(Buffer.from(localization.wrinkles[1].split(',')[1], 'base64'), ZONE2);
  assert.equal(FM.sanitize(localization, skinModel.METRIC_KEYS).wrinkles.length, 2);
});

test('FM9 alignement : un masque n\'est superposé que s\'il a les mêmes proportions que la photo (même boîte, aucun recadrage)', () => {
  assert.equal(FM.ratioMatches(1200, 1600, 600, 800), true);
  assert.equal(FM.ratioMatches(1200, 1600, 603, 800), true);     // < 1 %
  assert.equal(FM.ratioMatches(1200, 1600, 800, 800), false);    // recadré : refusé
  assert.equal(FM.ratioMatches(0, 1600, 600, 800), false);
  const css = read('css/components/face-map.css');
  assert.match(css, /\.c-facemap__frame img\{display:block;width:100%;height:auto\}/);
  assert.match(css, /\.c-facemap__frame canvas,\.c-facemap__lines\{position:absolute;inset:0;width:100%;height:100%;pointer-events:none\}/);
  assert.doesNotMatch(css, /object-fit/);
});

test('FM10 erreurs : masque absent, inaccessible, non image, trop lourd, http, IP privée → ignoré, sans exception', async () => {
  const big = Buffer.concat([ZONE, Buffer.alloc(masks.LIMITS.maxBytesEach)]);
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/txt.png': Buffer.from('<html>not an image</html>'), 'https://cdn.pc-results.com/big.png': big });
  const { localization } = await masks.collect(envelope(o => {
    el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/404.png'];
    el(o, 'pore').mask_urls = ['https://cdn.pc-results.com/txt.png'];
    el(o, 'redness').mask_urls = ['https://cdn.pc-results.com/big.png'];
    el(o, 'moisture').mask_urls = ['http://cdn.pc-results.com/a.png', 'https://10.0.0.1/a.png', 'https://localhost/a.png', 42, null];
  }));
  assert.deepEqual(localization, {});
  masks.api.fetchImpl = async () => { throw new Error('réseau'); };
  assert.deepEqual((await masks.collect(envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/a.png']; }))).localization, {});
  assert.deepEqual((await masks.collect({ nope: 1 })).localization, {});
  // côté navigateur : entrées douteuses écartées
  assert.equal(FM.sanitize({ acne: ['https://cdn.pc-results.com/a.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA'] }, skinModel.METRIC_KEYS), null);
  assert.equal(FM.sanitize({ inconnu: ['data:image/png;base64,AAAA'] }, skinModel.METRIC_KEYS), null);
});

test('FM10b lecture du masque : transparent ou niveaux de gris reconnus ; photo en couleurs, cadre plein ou vide : rien n\'est dessiné', () => {
  const W = 20, H = 20, mk = fn => { const a = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) a.set(fn(i % W, Math.floor(i / W)), i * 4); return a; };
  const alpha = FM.interpretMask(mk((x, y) => (x < 5 && y < 5 ? [255, 0, 0, 255] : [0, 0, 0, 0])), W, H);
  assert.equal(alpha.mode, 'alpha'); assert.equal(alpha.coverage, 25 / 400);
  const lum = FM.interpretMask(mk((x, y) => (x >= 15 ? [255, 255, 255, 255] : [0, 0, 0, 255])), W, H);
  assert.equal(lum.mode, 'luminance'); assert.equal(lum.coverage, 100 / 400);
  assert.equal(FM.interpretMask(mk((x, y) => [180 + x, 120, 90 + y, 255]), W, H).mode, 'unknown');      // image en couleurs (photo)
  assert.equal(FM.interpretMask(mk(() => [255, 255, 255, 255]), W, H).mode, 'unknown');               // tout le cadre
  assert.equal(FM.interpretMask(mk(() => [0, 0, 0, 0]), W, H).empty, true);                            // vide : aucune zone
  // couleur et opacité fixes, indépendantes de tout score
  const out = FM.paint(alpha.alpha, W, H);
  assert.deepEqual([...out.slice((2 * W + 2) * 4, (2 * W + 2) * 4 + 3)], FM.COLOR);
  assert.equal(out[(2 * W + 2) * 4 + 3], Math.round(255 * FM.FILL));     // intérieur : remplissage rose
  assert.deepEqual([...out.slice((4 * W + 2) * 4, (4 * W + 2) * 4 + 3)], FM.EDGE_COLOR);
  assert.equal(out[(4 * W + 2) * 4 + 3], Math.round(255 * FM.EDGE));     // bord : liseré clair
  assert.equal(out[(10 * W + 10) * 4 + 3], 0);                          // hors zone : rien
});

test('FM11 sécurité : aucune clé ni jeton envoyé au téléchargement des masques ; aucune URL renvoyée au navigateur', async () => {
  const seen = [];
  masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/acne.png': ZONE }, seen);
  process.env.PERFECT_CORP_API_KEY = 'CLE_SECRETE_TEST';
  const r = await masks.collect(envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png?sig=SIGNATURE_SECRETE']; }));
  assert.equal(seen.length, 1);
  assert.doesNotMatch(JSON.stringify(seen[0].init), /Authorization|Bearer|CLE_SECRETE|apikey/i);
  assert.doesNotMatch(code('server/masks.js'), /process\.env|Authorization|apiKey/);
  assert.doesNotMatch(JSON.stringify(r.localization), /https?:|SIGNATURE_SECRETE|cdn\.pc-results/);
  assert.doesNotMatch(read('js/face-map.js'), /PERFECT_CORP|apiKey|Authorization/);
});

test('FM12 persistance : aucun masque dans l\'historique, le stockage du navigateur, l\'URL ou la base', () => {
  const app = code('js/app.js');
  for (const m of app.matchAll(/(localStorage|sessionStorage)\.setItem\(([^)]*)\)/g)) assert.doesNotMatch(m[2], /localization|mask|facemap/i);
  assert.doesNotMatch(app, /history\.(push|replace)State\([^)]*(localization|faceKey)/);
  assert.doesNotMatch(code('js/face-map.js'), /localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/);
  assert.doesNotMatch(read('js/account.js').replace(/\/\*[\s\S]*?\*\//g, ''), /localization/);
});

/* ---------- handler : la réponse contient les masques réels, sans URL ---------- */
const auth = require('../server/auth');
const { createFake } = require('./helpers/fake-supabase.js');
process.env.SUPABASE_URL = 'https://demo.supabase.co'; process.env.SUPABASE_ANON_KEY = 'public-anon-key';
process.env.DERMAI_ANALYSIS_ENABLED = '1'; process.env.DERMAI_MAX_ANALYSES_PER_PERIOD = '1000';
const SB = createFake(); auth.api.fetchImpl = SB.fetch; require('../server/quota').api.fetchImpl = SB.fetch;
SB.users.set('fm@exemple.com', { id: '22222222-2222-4222-8222-222222222222', email: 'fm@exemple.com', password: 'x', confirmed: true });
SB.tokens.set('dddddddd.eeeeeeee.ffffffff', { sub: '22222222-2222-4222-8222-222222222222', exp: Number.MAX_SAFE_INTEGER });
const perfectcorp = require('../server/perfectcorp');
const handler = require('../api/skin-analysis.js');
const call = data => new Promise(resolve => {
  const req = Readable.from([data]); req.method = 'POST'; req.headers = { authorization: 'Bearer dddddddd.eeeeeeee.ffffffff', 'content-type': 'image/jpeg' };
  handler(req, { setHeader() {}, end(b) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } });
});
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);

test('FM13 handler : masques réels présents → `localization` (data URL) à côté du résultat inchangé ; aucun masque → clé absente', async () => {
  const orig = perfectcorp.analyzeSkin; process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL';
  const quiet = console.log; console.log = () => {};
  try {
    masks.api.fetchImpl = fakeNet({ 'https://cdn.pc-results.com/acne.png?sig=S': ZONE });
    perfectcorp.analyzeSkin = async () => envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png?sig=S'];
      o.push({ type: 'resize_image', url: 'https://cdn.pc-results.com/resized.jpg' }); });
    const r = await call(JPEG);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.result.normalized, skinModel.parseSkinResponse(JSON_RESP).normalized);   // scores strictement inchangés
    assert.deepEqual(Object.keys(r.body.localization), ['acne']);
    assert.doesNotMatch(JSON.stringify(r.body), /https?:|mask_urls|resize|sig=/);
    perfectcorp.analyzeSkin = async () => envelope();
    const r2 = await call(JPEG);
    assert.equal(r2.status, 200); assert.equal(r2.body.localization, undefined);
    masks.api.fetchImpl = async () => { throw new Error('réseau'); };
    perfectcorp.analyzeSkin = async () => envelope(o => { el(o, 'acne').mask_urls = ['https://cdn.pc-results.com/acne.png']; });
    const r3 = await call(JPEG);
    assert.equal(r3.status, 200); assert.equal(r3.body.localization, undefined);   // l'analyse n'échoue jamais à cause d'un masque
  } finally { perfectcorp.analyzeSkin = orig; console.log = quiet; }
});

test('FM14 étiquettes : accrochées à un VRAI pixel de la zone, côté choisi par la zone, jamais de chevauchement ni de sortie du cadre', () => {
  const W = 40, H = 40;
  // deux zones séparées (joues) dans un même masque : le centre de masse (milieu) n'est PAS dans la zone, le point d'accroche oui
  const a = new Uint8ClampedArray(W * H);for (let y = 15; y < 25; y++) { for (let x = 4; x < 10; x++) a[y * W + x] = 255; for (let x = 30; x < 36; x++) a[y * W + x] = 255; }
  const g = FM.zoneGeometry(a, W, H);
  const inZone = p => a[Math.floor(p.y * H) * W + Math.floor(p.x * W)] >= 128;
  assert.ok(Math.abs(g.cx - .5) < .05, 'centre de masse au milieu (hors zone)');
  assert.ok(inZone(g.left) && inZone(g.right), 'points d\'accroche dans la zone réelle');
  assert.ok(g.left.x < .3 && g.right.x > .7);
  assert.equal(FM.zoneGeometry(new Uint8ClampedArray(W * H), W, H), null);
  const tops = FM.layoutTags([100, 104, 108, 112], 400, 60);
  for (let i = 1; i < tops.length; i++) assert.ok(tops[i] >= tops[i - 1] + 60, 'pas de chevauchement');
  assert.ok(tops.every(t => t >= 8 && t + 60 <= 392), 'dans le cadre');
  const low = FM.layoutTags([395, 398], 400, 60);assert.ok(low[1] + 60 <= 392 && low[0] + 60 <= low[1]);
  // texte affiché tel quel, échappé
  assert.match(read('js/face-map.js'), /escTxt\(it\.label\)/);
});
