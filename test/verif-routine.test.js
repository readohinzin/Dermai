'use strict';
/* Vérif'Routine : module d'écran (js/verif-routine.js), stockage local par compte, câblage dans l'application. Tests sans navigateur ;
   les parcours réels (ajout, correction, suppression, 420 px) sont dans test/verif-routine-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const VR = require('../js/verif-routine.js');
const E = require('../js/engine/verif.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, keys: () => [...m.keys()], dump: () => Object.fromEntries(m) }; };
const prod = (id, name, extra) => Object.assign({ id, name, category: 'serum', slots: ['morning'], inci: ['Aqua', 'Niacinamide'], origin: { kind: 'user' }, irritated: false }, extra || {});
const setup = (o = {}) => {
  const ctx = Object.assign({ uid: 'u1', status: 'signedIn', storage: fakeStorage(), renders: 0 }, o);
  const vr = VR.create({ userId: () => ctx.uid, status: () => ctx.status, render: () => { ctx.renders++; }, esc: undefined, ic: n => `<i data-ic="${n}"></i>`, storage: () => ctx.storage, catalog: () => [] });
  ctx.vr = vr; return ctx;
};
/* L'échappement HTML écrit l'apostrophe en &#39; : on la rétablit pour lire le texte comme l'utilisatrice le voit. */
const view = ctx => ctx.vr.page().replace(/&#39;/g, '\'');
const put = (ctx, uid, products) => ctx.storage.setItem('dermai.verif.' + uid, JSON.stringify({ v: 1, products }));

test('VR1 selon l\'état du compte : visiteur invité à se connecter (rien n\'est saisi), vérification en cours, démonstration en mémoire seulement', () => {
  const visitor = view(setup({ status: 'visitor' }));
  assert.match(visitor, /Connectez-vous ou créez un compte pour enregistrer les produits/); assert.match(visitor, /data-go="signup"/); assert.match(visitor, /data-go="login"/); assert.ok(!/data-vr="add"/.test(visitor));
  assert.match(view(setup({ status: 'checking' })), /Vérification de votre session/);
  const demo = setup({ status: 'demo', uid: null });
  assert.match(view(demo), /ne sont pas conservés/); assert.match(view(demo), /data-vr="add"/); assert.deepEqual(demo.storage.keys(), [], 'aucune écriture sans compte');
  const off = setup({ status: 'off', uid: null }); assert.match(view(off), /ne sont pas conservés/);
  const ok = view(setup()); assert.match(ok, /Vérif'Routine/); assert.match(ok, /Aucun produit pour le moment/); assert.match(ok, /data-vr="add"/); assert.match(ok, /pas synchronisés avec vos autres appareils/);
});

test('VR2 stockage : clé distincte par compte, format versionné, lecture nettoyée (JSON abîmé, produits invalides, plafond de 20)', () => {
  const ctx = setup(); put(ctx, 'u1', [prod('p1', 'Sérum A'), { id: 'x', name: '' }, prod('p2', 'Sérum B', { slots: [] }), prod('p3', 'Sérum C')]);
  assert.deepEqual(ctx.vr.state().products.map(p => p.id), ['p1', 'p3'], 'les produits invalides sont ignorés');
  ctx.storage.setItem('dermai.verif.u1', '{pas du json'); assert.deepEqual(ctx.vr.state().products, []);
  ctx.storage.setItem('dermai.verif.u1', JSON.stringify({ v: 2, products: [prod('p1', 'A')] })); assert.deepEqual(ctx.vr.state().products, [], 'version inconnue ignorée');
  put(ctx, 'u1', Array.from({ length: 30 }, (_, i) => prod('p' + (i + 10), 'Produit ' + i))); assert.equal(ctx.vr.state().products.length, E.MAX_PRODUCTS);
  assert.equal(VR.KEY_PREFIX, 'dermai.verif.');
});

test('VR3 comptes : les produits d\'un compte ne sont jamais affichés à un autre sur le même navigateur ; l\'effacement ne touche que le compte concerné', () => {
  const ctx = setup(); put(ctx, 'u1', [prod('p1', 'Sérum de A')]); put(ctx, 'u2', [prod('p2', 'Sérum de B')]);
  assert.match(ctx.vr.page(), /Sérum de A/); assert.ok(!/Sérum de B/.test(ctx.vr.page()));
  ctx.uid = 'u2'; const b = ctx.vr.page(); assert.match(b, /Sérum de B/); assert.ok(!/Sérum de A/.test(b));
  ctx.uid = null; ctx.status = 'visitor'; const out = ctx.vr.page(); assert.ok(!/Sérum de [AB]/.test(out), 'déconnecté : aucun produit');
  ctx.uid = 'u1'; ctx.status = 'signedIn'; assert.match(ctx.vr.page(), /Sérum de A/);
  ctx.vr.clear(); assert.equal(ctx.storage.getItem('dermai.verif.u1'), null, 'compte courant effacé'); assert.ok(ctx.storage.getItem('dermai.verif.u2'), 'l\'autre compte n\'est pas touché');
  assert.deepEqual(ctx.storage.keys(), ['dermai.verif.u2']);
  const gone = setup({ uid: 'u9' }); put(gone, 'u9', [prod('p1', 'X')]); gone.vr.page(); gone.uid = null; gone.status = 'visitor'; gone.vr.clear(); assert.equal(gone.storage.getItem('dermai.verif.u9'), null, 'suppression du compte : dernier compte connu effacé');
});

test('VR4 affichage : noms échappés, origine distinguée (catalogue sourcé / saisi par vous), composition inconnue signalée, ordre matin / soir', () => {
  const ctx = setup(); put(ctx, 'u1', [prod('p1', '<img src=x onerror=alert(1)>', { slots: ['morning', 'evening'] }), prod('p2', 'Catalogue', { origin: { kind: 'catalog', productId: 'to-x', label: 'The Ordinary : fiche', checkedAt: '2026-10-06' } }), prod('p3', 'Sans liste', { inci: [], category: 'moisturizer', slots: ['evening'] })]);
  const h = view(ctx);
  assert.ok(!/<img src=x/.test(h)); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /Catalogue DERMAI sourcé/); assert.match(h, /Saisi par vous/); assert.match(h, /Composition inconnue/);
  assert.ok(h.indexOf('Matin') < h.indexOf('Soir')); assert.match(h, /Ordre indicatif DERMAI/);
  assert.match(h, /Points d'attention/); assert.match(h, /Pourquoi ce message \?/); assert.match(h, /Repères d'information cosmétique/);
  assert.match(h, /3 produits sur 20/);
});

test('VR5 limite de 20 produits : bouton désactivé et message', () => {
  const ctx = setup(); put(ctx, 'u1', Array.from({ length: 20 }, (_, i) => prod('p' + (i + 10), 'Produit ' + i)));
  const h = view(ctx); assert.match(h, /data-vr="add" disabled/); assert.match(h, /contient déjà 20 produits/);
  ctx.vr.handle('add'); assert.equal(ctx.vr.state().view, 'home', 'l\'ajout est refusé');
});

test('VR6 module : aucun réseau, aucune IA, aucun appel au fournisseur d\'analyse ; stockage limité à sa clé', () => {
  for (const f of ['js/verif-routine.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|skin-analysis|skin-simulation|perfect|youcam|makeupar|supabase|anthropic|openai|sessionStorage|indexedDB/i.test(src), f);
    const assigns = (src.match(/innerHTML\s*=\s*[^;]+/g) || []).map(x => x.replace(/innerHTML\s*=\s*/, ''));
    assert.deepEqual(assigns, ['resultsHtml()', 'stateBadge(E.recognize(t.value))'], 'les deux seules écritures HTML directes reçoivent du HTML déjà échappé par le module');
    assert.deepEqual([...new Set(src.match(/(?:getItem|setItem|removeItem)\(([^)]*)\)/g).map(x => x.replace(/^[a-zA-Z]+\(/, '').replace(/,.*$|\)$/g, '')))], ['KEY_PREFIX + w'], 'une seule clé de stockage');
  }
});

test('VR7 câblage : scripts chargés une fois dans le bon ordre, route restaurable, entrée de menu, effacement avec le compte, app.js sous son plafond', () => {
  const html = read('index.html'), at = f => html.indexOf(`<script src="${f}"></script>`);
  for (const f of ['js/engine/data/inci-aliases.js', 'js/engine/verif.js', 'js/verif-routine.js']) assert.equal((html.match(new RegExp(f.replace(/[./]/g, '\\$&'), 'g')) || []).length, 1, f);
  assert.ok(at('js/engine/data/actives.js') < at('js/engine/data/inci-aliases.js') && at('js/engine/data/inci-aliases.js') < at('js/engine/verif.js') && at('js/engine/verif.js') < at('js/verif-routine.js') && at('js/verif-routine.js') < at('js/app.js'));
  assert.match(read('css/styles.css'), /@import url\("components\/verif\.css"\) layer\(components\);/);
  const app = read('js/app.js');
  assert.match(app, /const VR=DermaiVerif\.create\(\{userId:UID,status:\(\)=>DEMO_MODE\?`demo`:state\.account\.status,render:RR,ic,esc,catalog:\(\)=>DEMO_MODE\?\[\]:Engine\.catalogData\.PRODUCTS\}\);VR\.attach\(document\);/);
  assert.match(app, /V\.verif=\(\)=>shell\(VR\.page\(\),\{title:`Vérif'Routine`\}\);/); assert.match(app, /RESTORABLE=new Set\(\[[^\]]*`verif`/);
  assert.match(app, /F\.clear\(\);CP\.clear\(\);VR\.clear\(\);ST\.clear\(\);resetPrivateState\(\)/);
  assert.match(app.slice(app.indexOf('async function bootAccount'), app.indexOf('async function submitForgot')), /`privacy`,`verif`,`program`\]\.includes\(state\.route\)\)render\(true\)/, 'après un rechargement, l\'écran est réaffiché une fois la session restaurée');
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000, 'js/app.js sous 150 000 octets');
  const side = require('../js/sidebar.js'); const e = side.ITEMS.find(i => i.id === 'verif');
  assert.deepEqual([e.label, e.go, e.routes], ['Vérif\'Routine', 'verif', ['verif']]);
  assert.ok(side.ITEMS.findIndex(i => i.id === 'verif') > side.ITEMS.findIndex(i => i.id === 'program'), 'après le programme de soins');
});

test('VR8 aucune table SQL ni migration ajoutée pour cette fonctionnalité', () => {
  const m = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).concat(fs.readdirSync(path.join(ROOT, 'supabase/proposals')));
  assert.ok(!m.some(f => /verif|product|routine/i.test(f)), m.join(', '));
  assert.equal(m.length, 12, 'dont quatre fichiers de proposition (quota du maquillage et quota des essais capillaires, non appliqués)');
});
