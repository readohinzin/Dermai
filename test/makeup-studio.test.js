'use strict';
/* Studio Beauté : module d'écran (js/makeup-studio.js), sans navigateur. Aucune requête réelle : fetchImpl est un faux qui enregistre chaque appel.
   Les parcours complets (clics, photo réelle, comparaison, 420 px) sont dans test/makeup-studio-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/makeup-studio.js');
const D = require('../js/makeup-data.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const memStorage = () => { const m = new Map(), writes = []; return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push(k); m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()], writes, dump: () => Object.fromEntries(m) }; };
const IMG = 'https://vto-images.example.com/out/result1.png?Signature=abc';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup(o = {}) {
  const ctx = Object.assign({ uid: 'u1', token: 'tok-1', epoch: 0, renders: 0, calls: [], avail: true, post: () => json(200, { ok: true, makeup: { image: IMG } }), local: memStorage(), sess: memStorage() }, o);
  const acct = () => (ctx.uid ? { user: { id: ctx.uid }, accessToken: async () => ctx.token } : null);
  const fetchImpl = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body }; ctx.calls.push(rec);
    if (rec.url.startsWith('/api/makeup-vto') && rec.method === 'GET') return json(200, { ok: true, available: ctx.avail });
    if (rec.url.startsWith('/api/hair-vto') && rec.method === 'GET') return json(200, { ok: true, available: false, features: [] });   // volet capillaire fermé : testé dans test/hair-studio*.test.js
    if (rec.url.startsWith('/api/makeup-vto') && rec.method === 'POST') { const r = ctx.post(rec); if (r instanceof Error) throw r; return r; }
    throw new Error('requête inattendue : ' + rec.url);
  };
  ctx.st = S.create({ account: acct, epoch: () => ctx.epoch, render: () => { ctx.renders++; }, fetchImpl, storage: () => ctx.local, session: () => ctx.sess, toJpeg: async f => f, inspect: async () => (ctx.check || null) });
  return ctx;
}
const ready = async ctx => { ctx.st.page(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r)); };
const posts = ctx => ctx.calls.filter(c => c.method === 'POST');
const mkCalls = ctx => ctx.calls.filter(c => c.url.startsWith('/api/makeup-vto'));
const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
const withPhoto = async (ctx, f) => { ctx.st.state().photo = photo(); ctx.st.state().photoUrl = 'blob:x'; return f ? f() : undefined; };
/* Faux document : relaie click / change / input vers les gestionnaires installés par attach(). */
function fakeDoc() {
  const h = {}, els = {};
  const doc = { addEventListener: (t, fn) => { (h[t] = h[t] || []).push(fn); }, getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], els };
  doc.fire = (type, target) => (h[type] || []).forEach(fn => fn({ target }));
  return doc;
}
const el = (attrs, extra = {}) => { const e = Object.assign({ tagName: 'BUTTON', disabled: false, getAttribute: k => (k in attrs ? attrs[k] : null), closest: () => e }, extra); return e; };

test('MS1 écran selon l\'état : visiteur invité à se connecter, vérification en cours, indisponible sans entrée de menu, disponible avec les quatre catégories', async () => {
  const v = setup({ uid: null }); assert.match(v.st.page(), /Connectez-vous ou créez un compte/); assert.match(v.st.page(), /data-go="signup"/); assert.equal(v.calls.length, 0, 'aucune requête sans compte'); assert.equal(v.st.ready(), false);
  const c = setup(); assert.match(c.st.page(), /Vérification de votre accès/); await ready(c);
  assert.match(c.st.page(), /Photo|Votre photo/);
  const n = setup({ avail: false }); await ready(n); assert.match(n.st.page(), /pas disponible pour votre compte/); assert.ok(!/data-ms="run"/.test(n.st.page())); assert.equal(n.st.ready(), false);
  const y = setup(); await ready(y); const h = y.st.page();
  for (const l of ['Teint', 'Lèvres', 'Blush', 'Yeux', 'Naturel', 'Élégant', 'Glamour', 'Soirée', 'Claire', 'Médium', 'Foncée']) assert.match(h, new RegExp(l));
  assert.match(h, /Essayer ce maquillage/); assert.match(h, /Votre peau n'est pas retouchée/); assert.equal(y.st.ready(), true);
});

test('MS2 disponibilité : UNE requête GET légère avec le jeton, jamais de POST ; répétée pour un autre compte, jamais pour le même ; échec = indisponible', async () => {
  const c = setup(); await ready(c); c.st.page(); c.st.ready(); await ready(c);
  assert.equal(mkCalls(c).length, 1); assert.equal(mkCalls(c)[0].method, 'GET'); assert.equal(mkCalls(c)[0].headers.Authorization, 'Bearer tok-1'); assert.equal(mkCalls(c)[0].url, '/api/makeup-vto'); assert.equal(posts(c).length, 0);
  c.uid = 'u2'; c.token = 'tok-2'; await ready(c); assert.equal(mkCalls(c).length, 2); assert.equal(mkCalls(c)[1].headers.Authorization, 'Bearer tok-2');
  const bad = setup({ token: null }); await ready(bad); assert.equal(bad.calls.length, 0, 'pas de jeton, pas de requête'); assert.match(bad.st.page(), /pas disponible/);
});

test('MS3 AUCUNE requête payante à l\'ouverture ni au choix d\'un look, d\'une couleur, d\'une texture, d\'une intensité, d\'un favori ou d\'un onglet', async () => {
  const c = setup(); await ready(c); await withPhoto(c); const doc = fakeDoc(); c.st.attach(doc);
  const click = (a, attrs = {}) => doc.fire('click', el(Object.assign({ 'data-ms': a }, attrs)));
  click('look', { 'data-id': 'glamour' }); click('tone', { 'data-t': 'deep' }); click('tab', { 'data-cat': 'eyes' }); click('toggle', { 'data-cat': 'eyes' });
  click('color', { 'data-cat': 'lips', 'data-c': '#8e5440' }); click('texture', { 'data-cat': 'lips', 'data-t': 'gloss' }); click('show', { 'data-i': '0' });
  doc.fire('input', el({ 'data-ms': 'range', 'data-cat': 'lips', 'data-f': 'colorIntensity' }, { tagName: 'INPUT', value: '77' }));
  doc.fire('change', el({ 'data-ms': 'custom', 'data-cat': 'lips' }, { tagName: 'INPUT', value: '#112233' }));
  doc.fire('change', el({ 'data-ms': 'toggle', 'data-cat': 'blush' }, { tagName: 'INPUT', checked: true }));
  assert.equal(posts(c).length, 0, 'aucun envoi'); assert.equal(mkCalls(c).length, 1, 'seule la requête de disponibilité a eu lieu');
  const s = c.st.state(); assert.equal(s.sel.lips.colorIntensity, 77); assert.equal(s.sel.lips.color, '#112233'); assert.equal(s.look, null, 'une modification manuelle sort du look');
  assert.equal(s.status, 'idle');
});

test('MS4 essayage : UNE demande avec la photo et TOUS les effets choisis, le jeton, aucune URL fournie ; bouton désactivé sans photo ni maquillage', async () => {
  const c = setup(); await ready(c);
  assert.match(c.st.page(), /data-ms="run" disabled/, 'sans photo : désactivé'); await c.st.state().sel; await withPhoto(c);
  assert.match(c.st.page(), /data-ms="run" disabled/, 'photo mais aucune catégorie : désactivé');
  const doc = fakeDoc(); c.st.attach(doc); doc.fire('click', el({ 'data-ms': 'look', 'data-id': 'elegant' }));
  assert.ok(!/data-ms="run" disabled/.test(c.st.page()), 'prêt');
  doc.fire('click', el({ 'data-ms': 'run' })); doc.fire('click', el({ 'data-ms': 'run' })); await new Promise(r => setTimeout(r, 20));
  assert.equal(posts(c).length, 1, 'un double clic ne lance pas deux essayages');
  const p = posts(c)[0]; assert.match(p.url, /^\/api\/makeup-vto\?cfg=/); assert.equal(p.headers.Authorization, 'Bearer tok-1'); assert.equal(p.headers['Content-Type'], 'image/jpeg'); assert.ok(p.body instanceof Blob);
  const cfg = JSON.parse(decodeURIComponent(p.url.split('cfg=')[1])); assert.deepEqual(Object.keys(cfg).sort(), ['blush', 'eyes', 'lips', 'v'], 'tous les effets dans une seule demande');
  assert.ok(!/src_file|image_url|effects|skin_smooth/.test(p.url), 'le navigateur n\'envoie ni URL ni corps fournisseur');
  const s = c.st.state(); assert.equal(s.status, 'done'); assert.equal(s.results.length, 1); assert.equal(s.results[0].image, IMG); assert.equal(s.results[0].label, 'Élégant');
  assert.match(c.st.page(), /Avant/); assert.match(c.st.page(), /Avec maquillage/); assert.match(c.st.page(), /Télécharger l'image/); assert.match(c.st.page(), /Recommencer avec d'autres couleurs/); assert.equal(c.sess.getItem('dermai.studio.pending.u1'), null, 'réponse reçue : marqueur levé');
});

test('MS5 erreurs : session expirée (401), refus du serveur (message affiché tel quel), image inutilisable, réseau coupé (essayage peut-être compté, relance bloquée jusqu\'à confirmation)', async () => {
  const mk = async post => { const c = setup({ post }); await ready(c); await withPhoto(c); c.st.state().sel.lips.on = true; await c.st.attach(fakeDoc()); return c; };
  let c = await mk(() => json(401, { ok: false, error: 'Connectez-vous pour utiliser le Studio Beauté.' })); await c.st.state(); await runIt(c);
  assert.equal(c.st.state().status, 'error'); assert.equal(c.st.state().error, S.MSG.sessionExpired); assert.equal(c.sess.getItem('dermai.studio.pending.u1'), null);
  c = await mk(() => json(429, { ok: false, error: 'Le nombre d\'essayages disponibles est atteint pour le moment. Réessayez plus tard.' })); await runIt(c);
  assert.match(c.st.state().error, /essayages disponibles est atteint/); assert.equal(c.st.state().unsure, false);
  c = await mk(() => json(200, { ok: true, makeup: { image: 'http://insecure.example.com/a.png' } })); await runIt(c); assert.equal(c.st.state().error, S.MSG.badImage); assert.equal(c.st.state().results.length, 0);
  for (const bad of ['javascript:alert(1)', 'https://127.0.0.1/a.png', 'https://user:pw@vto-images.example.com/a.png', 'data:image/png;base64,AAAA', 42, null]) { c = await mk(() => json(200, { ok: true, makeup: { image: bad } })); await runIt(c); assert.equal(c.st.state().results.length, 0, String(bad)); }
  c = await mk(() => new TypeError('network')); await runIt(c);
  assert.equal(c.st.state().status, 'error'); assert.equal(c.st.state().unsure, true); assert.equal(c.st.state().error, S.MSG.unsure); assert.ok(c.sess.getItem('dermai.studio.pending.u1'), 'trace de la demande sans réponse');
  const before = posts(c).length; await c.st.state(); await runIt(c);
  assert.equal(posts(c).length, before, 'aucune relance automatique ni sans confirmation'); assert.match(c.st.page(), /resté sans réponse/);
  const doc = fakeDoc(); c.st.attach(doc); doc.fire('click', el({ 'data-ms': 'ack' })); assert.equal(c.st.state().acked, true);
  c.post = () => json(200, { ok: true, makeup: { image: IMG } }); await runIt(c); assert.equal(posts(c).length, before + 1, 'relance explicite après confirmation');
});
async function runIt(c) { const doc = fakeDoc(); c.st.attach(doc); doc.fire('click', el({ 'data-ms': 'run' })); await new Promise(r => setTimeout(r, 25)); }

test('MS6 favoris : réglages seulement, une clé par compte, limite de 12, lecture assainie, suppression ; aucune image ni photo stockée', async () => {
  const c = setup(); await ready(c); const doc = fakeDoc(); doc.els['ms-favname'] = { value: 'Mon look du soir' }; c.st.attach(doc);
  const s = c.st.state(); Object.assign(s.sel.lips, { on: true, color: '#6e2150', texture: 'satin', colorIntensity: 80 });
  doc.fire('click', el({ 'data-ms': 'fav-save' }));
  assert.deepEqual(c.local.keys(), ['dermai.studio.u1']); const stored = JSON.parse(c.local.getItem('dermai.studio.u1'));
  assert.equal(stored.v, 1); assert.equal(stored.favorites.length, 1); assert.equal(stored.favorites[0].name, 'Mon look du soir'); assert.equal(stored.favorites[0].sel.lips.color, '#6e2150');
  assert.ok(!/blob:|data:image|https?:|photo|image/i.test(c.local.getItem('dermai.studio.u1')), 'aucune image ni lien dans le favori');
  doc.els['ms-favname'].value = '  '; doc.fire('click', el({ 'data-ms': 'fav-save' })); assert.match(c.st.state().favMsg, /Donnez un nom/); assert.equal(c.st.favorites().length, 1);
  c.uid = 'u2'; assert.deepEqual(c.st.favorites(), [], 'un autre compte ne voit pas les favoris');
  c.uid = 'u1'; const id = c.st.favorites()[0].id; Object.assign(c.st.state().sel.lips, { color: '#ffffff' });
  doc.fire('click', el({ 'data-ms': 'fav-use', 'data-id': id })); assert.equal(c.st.state().sel.lips.color, '#6e2150');
  c.local.setItem('dermai.studio.u1', JSON.stringify({ v: 1, favorites: Array.from({ length: 20 }, (_, i) => ({ id: 'id' + (i + 10), name: 'F' + i, sel: { lips: { on: true, color: 'zzz', texture: 'glitter', colorIntensity: 900 } } })).concat([{ id: '<x>', name: 'pirate', sel: {} }, null, { id: 'ok12', name: '', sel: {} }]) }));
  const list = c.st.favorites(); assert.equal(list.length, S.MAX_FAVORITES); assert.ok(list.every(f => /^[a-z0-9_-]+$/i.test(f.id) && f.sel.lips.color === D.DEFAULTS.lips.color), 'valeurs invalides ramenées aux défauts');
  assert.ok(!/<x>/.test(c.st.page()));
  c.local.setItem('dermai.studio.u1', '{pas du json'); assert.deepEqual(c.st.favorites(), []);
  c.local.setItem('dermai.studio.u1', JSON.stringify({ v: 2, favorites: [{ id: 'aa', name: 'x', sel: {} }] })); assert.deepEqual(c.st.favorites(), [], 'version inconnue ignorée');
  c.local.setItem('dermai.studio.u1', JSON.stringify({ v: 1, favorites: [{ id: 'aa', name: '<img src=x onerror=alert(1)>', sel: { lips: { on: true } } }] })); await ready(c);
  const h = c.st.page(); assert.ok(!/<img src=x/.test(h)); assert.match(h, /&lt;img src=x/);
});

test('MS7 stockage : ni photo ni résultat dans localStorage / sessionStorage (seul le marqueur de demande sans réponse, sans donnée) ; effacement avec le compte', async () => {
  const c = setup(); await ready(c); await withPhoto(c); c.st.state().sel.lips.on = true; await runIt(c);
  assert.equal(c.st.state().results.length, 1); assert.deepEqual(c.local.writes, [], 'localStorage jamais écrit par un essayage'); assert.deepEqual(c.sess.writes.filter(k => !k.startsWith('dermai.studio.pending.')), []);
  const c2 = setup({ post: () => new TypeError('network') }); await ready(c2); await withPhoto(c2); c2.st.state().sel.lips.on = true; await runIt(c2);
  const marker = c2.sess.getItem('dermai.studio.pending.u1'); assert.match(marker, /^\d+$/, 'un horodatage seulement');
  c2.local.setItem('dermai.studio.u1', JSON.stringify({ v: 1, favorites: [] })); c2.local.setItem('dermai.studio.u2', 'x');
  c2.st.clear(); assert.equal(c2.local.getItem('dermai.studio.u1'), null); assert.equal(c2.local.getItem('dermai.studio.u2'), 'x', 'l\'autre compte n\'est pas touché'); assert.equal(c2.sess.getItem('dermai.studio.pending.u1'), null);
  assert.equal(c2.st.state().photo, null); assert.equal(c2.st.state().results.length, 0);
  const g = setup({ uid: 'u9' }); await ready(g); g.st.page(); g.uid = null; g.local.setItem('dermai.studio.u9', '{}'); g.st.clear(); assert.equal(g.local.getItem('dermai.studio.u9'), null, 'compte supprimé : dernier compte connu effacé');
});

test('MS8 changement de compte ou déconnexion : photo, sélection et résultats ne passent jamais à un autre compte ; un résultat tardif d\'une ancienne session est ignoré', async () => {
  const c = setup(); await ready(c); await withPhoto(c); c.st.state().sel.lips.on = true; c.st.state().results.push({ id: 1, image: IMG, label: 'x', expired: false });
  c.uid = 'u2'; c.token = 'tok-2'; c.st.page(); assert.equal(c.st.state().photo, null); assert.equal(c.st.state().results.length, 0); assert.equal(c.st.state().sel.lips.on, false);
  const slow = setup({ post: () => new Promise(r => setTimeout(() => r(json(200, { ok: true, makeup: { image: IMG } })), 30)) }); await ready(slow); await withPhoto(slow); slow.st.state().sel.lips.on = true;
  const doc = fakeDoc(); slow.st.attach(doc); doc.fire('click', el({ 'data-ms': 'run' })); await new Promise(r => setTimeout(r, 5)); slow.epoch++; await new Promise(r => setTimeout(r, 60));
  assert.equal(slow.st.state().results.length, 0, 'résultat de l\'ancienne session ignoré');
});

test('MS9 photo : JPEG ou PNG de moins de 10 Mo seulement ; contrôle local (bloquant / avertissement) ; l\'aperçu est un lien objet révoqué au retrait', async () => {
  const c = setup(); await ready(c);
  const pick = async file => { const input = { files: [file] }; const doc = fakeDoc(); c.st.attach(doc); doc.fire('change', el({ 'data-ms': 'file' }, { tagName: 'INPUT', files: [file] })); await new Promise(r => setTimeout(r, 15)); return input; };
  await pick({ name: 'a.gif', type: 'image/gif', size: 10 }); assert.equal(c.st.state().photoError, S.MSG.format); assert.equal(c.st.state().photo, null);
  await pick({ name: 'a.jpg', type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }); assert.equal(c.st.state().photoError, S.MSG.tooBig);
  await pick({ name: 'a.webp', type: '', size: 10 }); assert.equal(c.st.state().photoError, S.MSG.format);
  c.check = { level: 'block', title: 't', body: 'b', issues: [{ text: 'Photo trop petite.' }] }; await pick(Object.assign(photo(), { name: 'a.jpg' })); assert.equal(c.st.state().photoError, 'Photo trop petite.'); assert.equal(c.st.state().photo, null);
  c.check = { level: 'warn', title: 'Photo à améliorer', body: 'b', issues: [{ text: 'Image un peu floue.' }] }; await pick(Object.assign(photo(), { name: 'a.jpg' }));
  assert.ok(c.st.state().photo); assert.match(c.st.state().photoUrl, /^blob:/); assert.match(c.st.page(), /Image un peu floue/); assert.equal(c.st.state().photoError, '');
  const doc = fakeDoc(); c.st.attach(doc); doc.fire('click', el({ 'data-ms': 'photo-remove' })); assert.equal(c.st.state().photo, null); assert.equal(c.st.state().photoUrl, '');
  assert.deepEqual(c.local.writes, [], 'aucune photo dans localStorage'); assert.equal(posts(c).length, 0, 'choisir une photo n\'envoie rien');
});

test('MS10 résultats : quatre au plus en mémoire, navigation entre essais, aperçu avant/après, mention de rendu indicatif et de peau non retouchée', async () => {
  let n = 0; const c = setup({ post: () => json(200, { ok: true, makeup: { image: 'https://vto-images.example.com/out/r' + (++n) + '.png' } }) }); await ready(c); await withPhoto(c); c.st.state().sel.lips.on = true;
  for (let i = 0; i < 6; i++) await runIt(c);
  const s = c.st.state(); assert.equal(s.results.length, S.MAX_RESULTS); assert.equal(s.results[3].image, 'https://vto-images.example.com/out/r6.png'); assert.equal(s.shown, 3);
  const doc = fakeDoc(); c.st.attach(doc); doc.fire('click', el({ 'data-ms': 'show', 'data-i': '0' })); assert.equal(c.st.state().shown, 0); doc.fire('click', el({ 'data-ms': 'show', 'data-i': '99' })); assert.equal(c.st.state().shown, 0);
  const h = c.st.page().replace(/&#39;/g, '\''); assert.match(h, /out\/r3\.png/); assert.match(h, /Essai 1/); assert.match(h, /Aperçu généré par ordinateur/); assert.match(h, /n'applique aucun lissage/); assert.match(h, /ne modifie ni vos scores ni votre analyse/);
  assert.match(h, /Chaque essayage compte dans votre quota d'essayages, même s'il échoue/, 'consommation annoncée sans prétendre à une mesure');
});

test('MS11 module : un seul point d\'entrée réseau (/api/makeup-vto), aucune écriture HTML directe, aucun fournisseur, clés de stockage limitées', () => {
  const src = read('js/makeup-studio.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual([...new Set(src.match(/\/api\/[a-z-]+/g))].sort(), ['/api/hair-vto', '/api/makeup-vto'], 'seulement les deux points d\'entrée du Studio');
  assert.ok(!/perfectcorp|youcam|makeupar|supabase|skin-analysis|skin-simulation|anthropic|openai|XMLHttpRequest|sendBeacon|WebSocket|eval\(|new Function|document\.write|innerHTML|outerHTML|insertAdjacentHTML/i.test(src));
  const keys = new Set((src.match(/(?:getItem|setItem|removeItem)\(([A-Za-z_]+)/g) || []).map(x => x.replace(/^[a-zA-Z]+\(/, '')));
  assert.deepEqual([...keys].sort(), ['FAV_PREFIX', 'PENDING'], 'seules clés de stockage : favoris et marqueur de demande');
  assert.ok(!/localStorage\.setItem|sessionStorage\.setItem/.test(src), 'jamais d\'accès direct : toujours via les dépendances');
  assert.equal(S.FAV_PREFIX, 'dermai.studio.');
  assert.ok(!/prix|€|achet|acheter|boutique|promo/i.test(S.DATA_NOTE + Object.values(S.MSG).join(' ')));
});
