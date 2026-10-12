'use strict';
/* Studio Beauté, volet capillaire dans l'écran du Studio (js/hair-studio.js intégré par js/makeup-studio.js), sans navigateur. Aucune requête réelle : fetchImpl est un faux qui enregistre chaque appel.
   Les parcours complets (clics, photo réelle, comparaison, 420 px) sont dans test/hair-studio-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/makeup-studio.js');
const HS = require('../js/hair-studio.js');
const D = require('../js/hair-data.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const memStorage = () => { const m = new Map(), writes = []; return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push(k); m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()], writes, dump: () => Object.fromEntries(m) }; };
const IMG = 'https://vto-images.example.com/out/hair1.png?Signature=abc';
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const TPL = [{ id: 'tpl_001', title: 'Tresses longues', category: 'Longues', thumb: 'https://cdn.example-pc.com/t/1.jpg' }, { id: 'tpl_002', title: '<b>Afro</b>', category: 'Afro', thumb: 'http://insecure.example.com/t/2.jpg' }, { id: 'tpl_003', title: '', category: 'Courtes', thumb: '' }];
const FEATS = [{ id: 'hairstyle', units: 2, templates: true }, { id: 'haircolor', units: 1, templates: false }, { id: 'extensions', units: 1, templates: true }, { id: 'wavy', units: 1, templates: true }, { id: 'volume', units: 2, templates: true }];

function setup(o = {}) {
  const ctx = Object.assign({ uid: 'u1', token: 'tok-1', epoch: 0, renders: 0, calls: [], makeup: false, hair: FEATS, local: memStorage(), sess: memStorage(), templates: () => json(200, { ok: true, templates: TPL, next: null }), post: () => json(200, { ok: true, hair: { feature: ctx.lastFeature, image: IMG } }) }, o);
  const acct = () => (ctx.uid ? { user: { id: ctx.uid }, accessToken: async () => ctx.token } : null);
  const fetchImpl = async (url, init = {}) => {
    const rec = { url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body }; ctx.calls.push(rec);
    if (rec.url.startsWith('/api/makeup-vto') && rec.method === 'GET') return json(200, { ok: true, available: ctx.makeup });
    if (rec.url.startsWith('/api/makeup-vto') && rec.method === 'POST') return json(200, { ok: true, makeup: { image: IMG } });
    if (rec.url.startsWith('/api/hair-vto?templates=')) { const r = ctx.templates(rec); if (r instanceof Error) throw r; return r; }
    if (rec.url.startsWith('/api/hair-vto') && rec.method === 'GET') return json(200, { ok: true, available: !!ctx.hair, features: ctx.hair || [] });
    if (rec.url.startsWith('/api/hair-vto') && rec.method === 'POST') { ctx.lastFeature = (rec.url.match(/feature=([a-z]+)/) || [])[1]; const r = ctx.post(rec); if (r instanceof Error) throw r; return r; }
    throw new Error('requête inattendue : ' + rec.url);
  };
  ctx.st = S.create({ account: acct, epoch: () => ctx.epoch, render: () => { ctx.renders++; }, fetchImpl, storage: () => ctx.local, session: () => ctx.sess, toJpeg: async f => f, shrink: async b => b, inspect: async () => null });
  return ctx;
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const ready = async ctx => { ctx.st.page(); await tick(); await tick(); };
const hairPosts = ctx => ctx.calls.filter(c => c.url.startsWith('/api/hair-vto') && c.method === 'POST');
const tplCalls = ctx => ctx.calls.filter(c => c.url.startsWith('/api/hair-vto?templates='));
const photo = n => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const withPhoto = ctx => { ctx.st.state().photo = photo(4); ctx.st.state().photoUrl = 'blob:x'; };
function fakeDoc() {
  const h = {}, els = {};
  const doc = { addEventListener: (t, fn) => { (h[t] = h[t] || []).push(fn); }, getElementById: id => els[id] || null, querySelector: () => null, querySelectorAll: () => [], els };
  doc.fire = (type, target) => (h[type] || []).forEach(fn => fn({ target }));
  return doc;
}
const el = (attrs, extra = {}) => { const e = Object.assign({ tagName: 'BUTTON', disabled: false, getAttribute: k => (k in attrs ? attrs[k] : null), closest: () => e }, extra); return e; };
const open = async (ctx, tab) => { await ready(ctx); const doc = fakeDoc(); ctx.doc = doc; ctx.st.attach(doc); doc.fire('click', el({ 'data-ms': 'mode', 'data-v': tab })); ctx.st.page(); await tick(); await tick(); return doc; };
const hs = (doc, a, attrs = {}) => doc.fire('click', el(Object.assign({ 'data-hs': a }, attrs)));
const txt = ctx => ctx.st.page().replace(/&#39;/g, '\'');

test('HS1 onglets : fermé → aucun onglet capillaire ; capillaire seul → pas de « Maquillage » ; les deux → Maquillage puis les cinq espaces ; entrée de menu ouverte par l\'un OU l\'autre', async () => {
  const closed = setup({ hair: null, makeup: true }); await ready(closed); assert.ok(!/data-ms="mode"/.test(closed.st.page()), 'un seul espace : aucune barre d\'onglets'); assert.equal(closed.st.ready(), true);
  const hairOnly = setup({ makeup: false }); await ready(hairOnly); const h = hairOnly.st.page();
  assert.ok(!/data-v="makeup"/.test(h)); for (const l of ['Coiffures et perruques', 'Couleurs de cheveux', 'Extensions', 'Boucles et volume']) assert.match(h, new RegExp(l)); assert.ok(!/>Franges</.test(h), 'franges : fonction fermée pour ce compte, aucun onglet inutile');
  assert.equal(hairOnly.st.ready(), true, 'le menu s\'ouvre pour le volet capillaire seul'); assert.equal(hairOnly.st.state().mode, 'hairstyle');
  const both = setup({ makeup: true }); await ready(both); const b = both.st.page(); assert.match(b, /data-v="makeup"/); assert.ok(b.indexOf('Maquillage') < b.indexOf('Coiffures et perruques')); assert.equal(both.st.state().mode, 'makeup', 'le maquillage reste l\'espace par défaut');
  const none = setup({ makeup: false, hair: null }); await ready(none); assert.match(none.st.page(), /pas disponible pour votre compte/); assert.equal(none.st.ready(), false);
  const v = setup({ uid: null }); assert.match(v.st.page(), /Connectez-vous ou créez un compte/); assert.equal(v.calls.length, 0);
  const bad = setup({ hair: [{ id: 'inconnue', units: 2 }, { id: 'bangs', units: 99 }, null] }); await ready(bad); assert.equal(bad.st.state().hair, 'no', 'fonctions inconnues ou unités incohérentes ignorées');
});

test('HS2 disponibilité : UNE lecture GET de chaque côté, avec le jeton, jamais de POST ; changer d\'onglet ne lance AUCUNE tâche (seule la liste des modèles, en lecture seule, est lue)', async () => {
  const c = setup({ makeup: true }); const doc = await open(c, 'hairstyle');
  const gets = c.calls.filter(x => x.method === 'GET' && !x.url.includes('templates=')); assert.deepEqual(gets.map(g => g.url).sort(), ['/api/hair-vto', '/api/makeup-vto']); assert.ok(gets.every(g => g.headers.Authorization === 'Bearer tok-1'));
  assert.equal(tplCalls(c).length, 1); assert.equal(tplCalls(c)[0].url, '/api/hair-vto?templates=hairstyle'); assert.equal(tplCalls(c)[0].headers.Authorization, 'Bearer tok-1');
  for (const t of ['haircolor', 'extensions', 'curls', 'makeup', 'hairstyle', 'extensions']) { doc.fire('click', el({ 'data-ms': 'mode', 'data-v': t })); c.st.page(); await tick(); }
  assert.equal(c.calls.filter(x => x.method === 'POST').length, 0, 'aucune tâche, aucune demande payante');
  assert.equal(tplCalls(c).filter(x => /haircolor/.test(x.url)).length, 0, 'la couleur n\'a pas de modèles : aucune lecture');
  assert.equal(tplCalls(c).filter(x => /extensions/.test(x.url)).length, 1, 'une liste n\'est lue qu\'une fois par session');
  const g = setup({ hair: FEATS, token: null }); await ready(g); assert.equal(g.calls.length, 0, 'sans jeton : aucune requête');
});

test('HS3 liste des modèles : cartes échappées, miniatures https seulement, catégories du fournisseur, pagination par le jeton reçu, erreur avec réessai', async () => {
  const c = setup(); await open(c, 'hairstyle');
  const h = txt(c); assert.match(h, /Tresses longues/); assert.ok(!/<b>Afro<\/b>/.test(h)); assert.match(h, /&lt;b&gt;Afro&lt;\/b&gt;/); assert.match(h, /Modèle 3/, 'titre absent : libellé neutre, rien d\'inventé');
  assert.match(h, /<img src="https:\/\/cdn\.example-pc\.com\/t\/1\.jpg"/); assert.ok(!/insecure\.example\.com/.test(h), 'miniature http refusée');
  for (const k of ['Longues', 'Afro', 'Courtes', 'Tous']) assert.match(h, new RegExp('>' + k + '<'));
  assert.match(h, /3 modèles proposés par le service/);
  const doc = c.doc; hs(doc, 'cat', { 'data-f': 'hairstyle', 'data-v': 'Afro' }); const f = txt(c); assert.match(f, /data-id="tpl_002"/); assert.ok(!/data-id="tpl_001"/.test(f), 'filtre par catégorie');
  /* pagination */
  const p = setup({ templates: r => json(200, { ok: true, templates: /next=N1/.test(r.url) ? [TPL[0], { id: 'tpl_004', title: 'Suite' }] : [TPL[0]], next: /next=N1/.test(r.url) ? null : 'N1' }) });
  const d2 = await open(p, 'hairstyle'); assert.match(txt(p), /Voir plus de modèles/); hs(d2, 'more-templates', { 'data-f': 'hairstyle' }); await tick(); await tick();
  assert.equal(tplCalls(p)[1].url, '/api/hair-vto?templates=hairstyle&next=N1'); const t = txt(p); assert.match(t, /tpl_004/); assert.equal((t.match(/data-id="tpl_001"/g) || []).length, 1, 'pas de doublon'); assert.ok(!/Voir plus de modèles/.test(t));
  /* erreur */
  let ok = false; const e = setup({ templates: () => (ok ? json(200, { ok: true, templates: TPL, next: null }) : json(502, { ok: false, error: 'Les modèles ne sont pas disponibles pour le moment. Réessayez plus tard.' })) });
  const d3 = await open(e, 'hairstyle'); assert.match(txt(e), /modèles ne sont pas disponibles/); assert.match(txt(e), /data-hs="retry-templates"/); assert.ok(!/data-hs="tpl"/.test(txt(e)));
  ok = true; hs(d3, 'retry-templates', { 'data-f': 'hairstyle' }); await tick(); await tick(); assert.match(txt(e), /Tresses longues/);
  const n = setup({ templates: () => new TypeError('network') }); await open(n, 'hairstyle'); assert.match(txt(n), /Les modèles n'ont pas pu être chargés/);
});

test('HS4 AUCUNE tâche au chargement, au choix d\'un modèle, d\'une couleur, d\'un réglage ou d\'un favori ; essai : UNE demande, un seul clic effectif, tâche explicite', async () => {
  const c = setup(); const doc = await open(c, 'hairstyle'); withPhoto(c);
  hs(doc, 'tpl', { 'data-f': 'hairstyle', 'data-id': 'tpl_001' }); hs(doc, 'haircolor-src', { 'data-f': 'hairstyle', 'data-v': 'src' }); hs(doc, 'mode', { 'data-f': 'hairstyle', 'data-v': 'reference' }); hs(doc, 'mode', { 'data-f': 'hairstyle', 'data-v': 'template' });
  doc.fire('click', el({ 'data-ms': 'mode', 'data-v': 'haircolor' })); c.st.page();
  hs(doc, 'mode', { 'data-f': 'haircolor', 'data-v': 'full' }); hs(doc, 'color', { 'data-f': 'haircolor', 'data-k': 'color', 'data-c': '#5A2A1F' }); hs(doc, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' });
  doc.fire('input', el({ 'data-hs': 'range', 'data-f': 'haircolor', 'data-k': 'colorIntensity' }, { tagName: 'INPUT', value: '77' }));
  assert.equal(hairPosts(c).length, 0, 'aucune tâche'); assert.equal(c.st.hair.state().haircolor.sel.colorIntensity, 77);
  doc.fire('click', el({ 'data-ms': 'mode', 'data-v': 'hairstyle' })); c.st.page();
  assert.ok(!/data-hs="run" data-f="hairstyle" disabled/.test(c.st.page()), 'modèle + photo : prêt'); hs(doc, 'run', { 'data-f': 'hairstyle' }); hs(doc, 'run', { 'data-f': 'hairstyle' }); await tick(30);
  assert.equal(hairPosts(c).length, 1, 'un double clic ne lance pas deux essais');
  const p = hairPosts(c)[0]; assert.match(p.url, /^\/api\/hair-vto\?feature=hairstyle&cfg=/); assert.equal(p.headers.Authorization, 'Bearer tok-1'); assert.equal(p.headers['Content-Type'], 'image/jpeg'); assert.ok(p.body instanceof Blob);
  assert.deepEqual(JSON.parse(decodeURIComponent(p.url.split('cfg=')[1])), { v: 1, template: { id: 'tpl_001', hair_color: 'src' } }); assert.ok(!/ref_at|src_file|image_url|http/.test(decodeURIComponent(p.url.split('cfg=')[1])));
  const r = c.st.hair.state().hairstyle; assert.equal(r.status, 'done'); assert.equal(r.results.length, 1); assert.equal(r.results[0].image, IMG); assert.equal(r.results[0].label, 'Tresses longues');
  const h = txt(c); assert.match(h, /Avant/); assert.match(h, /Coiffure/); assert.match(h, /Télécharger l'image/); assert.match(h, /Changer de modèle ou de couleur/); assert.match(h, /Aperçu généré par ordinateur/); assert.equal(c.sess.getItem('dermai.studio.pending.u1'), null);
});

test('HS5 couleur : preset, couleur personnalisée, dégradé : une seule demande, jamais preset ET palettes ; sans photo ou sans choix → bouton désactivé', async () => {
  const mk = async () => { const c = setup(); const doc = await open(c, 'haircolor'); withPhoto(c); return [c, doc]; };
  let [c, doc] = await mk(); assert.match(c.st.page(), /data-hs="run" data-f="haircolor"/);
  hs(doc, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' }); hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30);
  assert.deepEqual(JSON.parse(decodeURIComponent(hairPosts(c)[0].url.split('cfg=')[1])), { v: 1, preset: 'Burgundy' }); assert.equal(c.st.hair.state().haircolor.results[0].label, 'Bordeaux');
  [c, doc] = await mk(); hs(doc, 'mode', { 'data-f': 'haircolor', 'data-v': 'full' }); hs(doc, 'color', { 'data-f': 'haircolor', 'data-k': 'color', 'data-c': '#5A2A1F' }); hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30);
  assert.deepEqual(JSON.parse(decodeURIComponent(hairPosts(c)[0].url.split('cfg=')[1])), { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#5a2a1f', color_intensity: 70, shine_intensity: 40 }] });
  [c, doc] = await mk(); hs(doc, 'mode', { 'data-f': 'haircolor', 'data-v': 'ombre' }); doc.fire('input', el({ 'data-hs': 'range', 'data-f': 'haircolor', 'data-k': 'offset' }, { tagName: 'INPUT', value: '-30' })); hs(doc, 'color', { 'data-f': 'haircolor', 'data-k': 'color2', 'data-c': '#D9B25F' }); hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30);
  const cfg = JSON.parse(decodeURIComponent(hairPosts(c)[0].url.split('cfg=')[1])); assert.equal(cfg.pattern.name, 'ombre'); assert.equal(cfg.pattern.line_offset, -0.3); assert.equal(cfg.palettes[1].color, '#d9b25f'); assert.ok(!('preset' in cfg));
  const n = setup(); await open(n, 'haircolor'); assert.match(n.st.page(), /data-hs="run" data-f="haircolor" disabled/, 'sans photo');
});

test('HS6 coiffure par photo de référence : référence en mémoire, UNE demande avec les deux images à la suite et ref_at = taille de la première ; jamais d\'URL', async () => {
  const c = setup(); const doc = await open(c, 'hairstyle'); withPhoto(c);
  hs(doc, 'mode', { 'data-f': 'hairstyle', 'data-v': 'reference' }); assert.match(c.st.page(), /data-hs="run" data-f="hairstyle" disabled/, 'sans référence');
  doc.fire('change', el({ 'data-hs': 'ref-file' }, { tagName: 'INPUT', files: [{ name: 'a.gif', type: 'image/gif', size: 5 }] })); await tick(15); assert.equal(c.st.hair.state().hairstyle.refError, HS.MSG.format);
  doc.fire('change', el({ 'data-hs': 'ref-file' }, { tagName: 'INPUT', files: [{ name: 'a.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 }] })); await tick(15); assert.equal(c.st.hair.state().hairstyle.refError, HS.MSG.tooBig);
  doc.fire('change', el({ 'data-hs': 'ref-file' }, { tagName: 'INPUT', files: [Object.assign(photo(6), { name: 'ref.jpg' })] })); await tick(15);
  assert.match(c.st.hair.state().hairstyle.refUrl, /^blob:/); assert.ok(!/data-hs="run" data-f="hairstyle" disabled/.test(c.st.page()));
  hs(doc, 'run', { 'data-f': 'hairstyle' }); await tick(30);
  const p = hairPosts(c)[0]; assert.match(p.url, /&ref_at=4$/); assert.equal(p.body.size, 10); assert.deepEqual(JSON.parse(decodeURIComponent(p.url.split('cfg=')[1].split('&')[0])), { v: 1, reference: true });
  assert.equal(c.st.hair.state().hairstyle.results[0].label, 'Photo de référence');
  hs(doc, 'ref-remove', { 'data-f': 'hairstyle' }); assert.equal(c.st.hair.state().hairstyle.refBlob, null); assert.deepEqual(c.local.writes, [], 'la référence n\'est jamais stockée');
});

test('HS7 sous-onglets « Boucles et volume » : une fonction à la fois, chacune avec ses unités et sa mention ; extensions ≠ perruque ; coût annoncé avant l\'essai, sans prétendre à une mesure', async () => {
  const c = setup(); const doc = await open(c, 'curls'); let h = txt(c);
  assert.match(h, /Boucles et ondulations/); assert.match(h, /Volume/); assert.match(h, /ne couvre pas forcément toutes les textures ni tous les styles afro/); assert.match(h, /consomme 1 unité chez le fournisseur/); assert.match(h, /non mesurée par DERMAI/);
  hs(doc, 'sub', { 'data-t': 'curls', 'data-f': 'volume' }); await tick(); h = txt(c); assert.match(h, /consomme 2 unités/); assert.match(h, /ni un diagnostic de chute de cheveux ni une solution médicale/);
  await tick(); assert.deepEqual(tplCalls(c).map(x => x.url.match(/templates=([a-z]+)/)[1]).sort(), ['volume', 'wavy'], 'chaque liste est lue une fois, à l\'affichage de la fonction');
  const ex = setup(); await open(ex, 'extensions'); assert.match(txt(ex), /ne remplacent pas votre coiffure/); assert.match(txt(ex), /pas l'essai d'une perruque complète/);
  const st = setup(); await open(st, 'hairstyle'); assert.match(txt(st), /consomme 2 unités/); assert.match(txt(st), /pas l'essai d'un modèle précis de perruque/);
  const hc = setup(); await open(hc, 'haircolor'); assert.match(txt(hc), /consomme 1 unité/);
});

test('HS8 erreurs : session expirée, quota, refus du serveur, image inutilisable, réseau coupé (essai peut-être compté, relance bloquée jusqu\'à confirmation, partagé avec le maquillage)', async () => {
  const go = async post => { const c = setup({ post, makeup: true }); const doc = await open(c, 'haircolor'); withPhoto(c); hs(doc, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' }); return [c, doc]; };
  const runIt = async (c, doc) => { hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30); };
  let [c, doc] = await go(() => json(401, { ok: false, error: 'x' })); await runIt(c, doc); assert.equal(c.st.hair.state().haircolor.error, HS.MSG.sessionExpired); assert.equal(c.sess.getItem('dermai.studio.pending.u1'), null);
  [c, doc] = await go(() => json(429, { ok: false, error: 'Le nombre d\'essais capillaires disponibles est atteint pour le moment. Réessayez plus tard.' })); await runIt(c, doc); assert.match(c.st.hair.state().haircolor.error, /essais capillaires disponibles est atteint/); assert.equal(c.st.hair.state().haircolor.unsure, false);
  [c, doc] = await go(() => json(200, { ok: true, hair: { feature: 'haircolor', image: 'http://insecure.example.com/a.png' } })); await runIt(c, doc); assert.equal(c.st.hair.state().haircolor.error, HS.MSG.badImage);
  for (const bad of ['javascript:alert(1)', 'https://127.0.0.1/a.png', 'https://user:pw@vto-images.example.com/a.png', 'data:image/png;base64,AAAA', 42, null]) { [c, doc] = await go(() => json(200, { ok: true, hair: { feature: 'haircolor', image: bad } })); await runIt(c, doc); assert.equal(c.st.hair.state().haircolor.results.length, 0, String(bad)); }
  [c, doc] = await go(() => json(200, { ok: true, hair: { feature: 'bangs', image: IMG } })); await runIt(c, doc); assert.equal(c.st.hair.state().haircolor.results.length, 0, 'résultat d\'une autre fonction refusé');
  [c, doc] = await go(() => new TypeError('network')); await runIt(c, doc);
  const s = c.st.hair.state().haircolor; assert.equal(s.unsure, true); assert.equal(s.error, HS.MSG.unsure); assert.ok(c.sess.getItem('dermai.studio.pending.u1'));
  const before = hairPosts(c).length; await runIt(c, doc); assert.equal(hairPosts(c).length, before, 'aucune relance sans confirmation'); assert.match(txt(c), /resté sans réponse/);
  const mkDoc = fakeDoc(); c.st.attach(mkDoc); c.st.state().sel.lips.on = true; mkDoc.fire('click', el({ 'data-ms': 'run' })); await tick(20); assert.equal(c.calls.filter(x => x.url.startsWith('/api/makeup-vto') && x.method === 'POST').length, 0, 'la trace d\'un essai capillaire sans réponse bloque aussi le maquillage');
  hs(doc, 'ack', { 'data-f': 'haircolor' }); c.post = () => json(200, { ok: true, hair: { feature: 'haircolor', image: IMG } }); await runIt(c, doc); assert.equal(hairPosts(c).length, before + 1, 'relance explicite après confirmation');
});

test('HS9 une seule demande à la fois, tous modules confondus : essai capillaire en cours → maquillage et autre essai bloqués, et inversement', async () => {
  const c = setup({ makeup: true, post: () => new Promise(r => setTimeout(() => r(json(200, { ok: true, hair: { feature: 'haircolor', image: IMG } })), 40)) });
  const doc = await open(c, 'haircolor'); withPhoto(c); hs(doc, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' });
  hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(5); assert.equal(c.st.hair.busy(), true);
  const mk = fakeDoc(); c.st.attach(mk); c.st.state().sel.lips.on = true; mk.fire('click', el({ 'data-ms': 'run' })); hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(5);
  assert.equal(c.calls.filter(x => x.url.startsWith('/api/makeup-vto') && x.method === 'POST').length, 0, 'maquillage bloqué'); assert.equal(hairPosts(c).length, 1);
  await tick(80); assert.equal(c.st.hair.busy(), false);
  const d = setup({ makeup: true }); await open(d, 'haircolor'); withPhoto(d); d.st.state().status = 'running'; const dd = fakeDoc(); d.st.attach(dd); hs(dd, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' }); hs(dd, 'run', { 'data-f': 'haircolor' }); await tick(10); assert.equal(hairPosts(d).length, 0, 'essai capillaire bloqué pendant un essayage de maquillage');
});

test('HS10 favoris : réglages seulement (couleur ou identifiant de modèle), une clé par compte, limite de 12, lecture assainie ; aucune photo ni image stockée ; effacés avec le compte', async () => {
  const c = setup(); const doc = await open(c, 'haircolor'); doc.els['hs-favname'] = { value: 'Mon brun chocolat' };
  hs(doc, 'mode', { 'data-f': 'haircolor', 'data-v': 'full' }); hs(doc, 'color', { 'data-f': 'haircolor', 'data-k': 'color', 'data-c': '#5A2A1F' }); hs(doc, 'fav-save', { 'data-f': 'haircolor' });
  assert.deepEqual(c.local.keys(), ['dermai.studio.hair.u1']); const stored = JSON.parse(c.local.getItem('dermai.studio.hair.u1'));
  assert.equal(stored.v, 1); assert.equal(stored.favorites[0].feature, 'haircolor'); assert.equal(stored.favorites[0].sel.color, '#5a2a1f'); assert.ok(!/blob:|data:image|https?:|photo|image/i.test(c.local.getItem('dermai.studio.hair.u1')));
  doc.els['hs-favname'].value = ' '; hs(doc, 'fav-save', { 'data-f': 'haircolor' }); assert.equal(c.st.hair.favorites().length, 1);
  c.uid = 'u2'; assert.deepEqual(c.st.hair.favorites(), [], 'un autre compte ne voit pas les favoris'); c.uid = 'u1';
  c.st.hair.state().haircolor.sel.color = '#ffffff'; hs(doc, 'fav-use', { 'data-id': c.st.hair.favorites()[0].id }); assert.equal(c.st.hair.state().haircolor.sel.color, '#5a2a1f');
  c.local.setItem('dermai.studio.hair.u1', JSON.stringify({ v: 1, favorites: Array.from({ length: 20 }, (_, i) => ({ id: 'id' + (i + 10), name: 'F' + i, feature: 'haircolor', sel: { mode: 'full', color: 'zzz', colorIntensity: 900 } })).concat([{ id: '<x>', name: 'pirate', feature: 'haircolor', sel: {} }, null, { id: 'ok12', name: 'x', feature: 'inconnue', sel: {} }, { id: 'ok13', name: 'sans modèle', feature: 'wavy', sel: {} }]) }));
  const list = c.st.hair.favorites(); assert.equal(list.length, HS.MAX_FAVORITES); assert.ok(list.every(f => f.sel.color === D.DEFAULTS.haircolor.color && f.sel.colorIntensity === D.DEFAULTS.haircolor.colorIntensity), 'valeurs invalides ramenées aux défauts');
  c.local.setItem('dermai.studio.hair.u1', '{pas du json'); assert.deepEqual(c.st.hair.favorites(), []); c.local.setItem('dermai.studio.hair.u1', JSON.stringify({ v: 2, favorites: [] })); assert.deepEqual(c.st.hair.favorites(), []);
  c.local.setItem('dermai.studio.hair.u1', JSON.stringify({ v: 1, favorites: [{ id: 'aa', name: '<img src=x onerror=alert(1)>', feature: 'haircolor', sel: { mode: 'preset', preset: 'Burgundy' } }] })); assert.ok(!/<img src=x/.test(txt(c))); assert.match(txt(c), /&lt;img src=x/);
  c.local.setItem('dermai.studio.hair.u2', 'x'); c.local.setItem('dermai.studio.u1', 'makeup-favoris'); c.st.clear();
  assert.equal(c.local.getItem('dermai.studio.hair.u1'), null, 'favoris capillaires effacés avec le compte'); assert.equal(c.local.getItem('dermai.studio.hair.u2'), 'x', 'l\'autre compte n\'est pas touché');
});

test('HS11 mémoire : ni photo ni résultat dans localStorage / sessionStorage ; résultats oubliés quand la photo change ; changement de compte → tout est réinitialisé', async () => {
  const c = setup(); const doc = await open(c, 'haircolor'); withPhoto(c); hs(doc, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' }); hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30);
  assert.equal(c.st.hair.state().haircolor.results.length, 1); assert.deepEqual(c.local.writes, [], 'localStorage jamais écrit par un essai'); assert.deepEqual(c.sess.writes.filter(k => !k.startsWith('dermai.studio.pending.')), []);
  doc.fire('change', el({ 'data-ms': 'file' }, { tagName: 'INPUT', files: [Object.assign(photo(8), { name: 'b.jpg' })] })); await tick(20);
  assert.equal(c.st.hair.state().haircolor.results.length, 0, 'photo remplacée : les résultats ne se comparent plus à la bonne photo');
  hs(doc, 'run', { 'data-f': 'haircolor' }); await tick(30); assert.equal(c.st.hair.state().haircolor.results.length, 1); doc.fire('click', el({ 'data-ms': 'photo-remove' })); assert.equal(c.st.hair.state().haircolor.results.length, 0);
  c.uid = 'u2'; c.token = 'tok-2'; c.st.page(); assert.deepEqual(Object.keys(c.st.hair.state()), [], 'autre compte : état capillaire vide');
  const slow = setup({ post: () => new Promise(r => setTimeout(() => r(json(200, { ok: true, hair: { feature: 'haircolor', image: IMG } })), 30)) }); const d2 = await open(slow, 'haircolor'); withPhoto(slow); hs(d2, 'preset', { 'data-f': 'haircolor', 'data-v': 'Burgundy' });
  hs(d2, 'run', { 'data-f': 'haircolor' }); await tick(5); slow.epoch++; await tick(60); assert.equal((slow.st.hair.state().haircolor || { results: [] }).results.length, 0, 'résultat d\'une ancienne session ignoré');
});

test('HS12 module : un seul point d\'entrée réseau (/api/hair-vto), aucune écriture HTML directe, aucun fournisseur, une seule clé de stockage propre', () => {
  const src = read('js/hair-studio.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual([...new Set(src.match(/\/api\/[a-z-]+/g))], ['/api/hair-vto']);
  assert.ok(!/perfectcorp|youcam|makeupar|supabase|skin-analysis|skin-simulation|makeup-vto|anthropic|openai|XMLHttpRequest|sendBeacon|WebSocket|eval\(|new Function|document\.write|innerHTML|outerHTML|insertAdjacentHTML/i.test(src));
  const keys = new Set((src.match(/(?:getItem|setItem|removeItem)\(([A-Za-z_]+)/g) || []).map(x => x.replace(/^[a-zA-Z]+\(/, ''))); assert.deepEqual([...keys], ['FAV_PREFIX']);
  assert.ok(!/localStorage\.setItem|sessionStorage\.setItem/.test(src)); assert.equal(HS.FAV_PREFIX, 'dermai.studio.hair.'); assert.equal(HS.MAX_SIDE, 1024);
  assert.ok(!/prix|€|achet|acheter|boutique|promo/i.test(HS.DATA_NOTE + Object.values(HS.MSG).join(' ')));
});

test('HS13 conseils photo adaptés : maquillage = cheveux écartés ; capillaire = cheveux entiers dans le cadre et épaules visibles (le contraire) ; bandeau « Maquillage et cheveux » seulement si le volet est ouvert', async () => {
  const c = setup({ makeup: true }); await ready(c);
  assert.match(txt(c), /cheveux, mains et lunettes écartés/); assert.match(txt(c), /Maquillage et cheveux/);
  const doc = await open(c, 'hairstyle'); assert.ok(doc); const h = txt(c);
  assert.match(h, /Cheveux entiers dans le cadre et épaules visibles/); assert.ok(!/cheveux, mains et lunettes écartés/.test(h));
  const m = setup({ hair: null, makeup: true }); await ready(m); assert.match(txt(m), /Maquillage virtuel/); assert.ok(!/Maquillage et cheveux/.test(txt(m)));
});
