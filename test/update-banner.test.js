'use strict';
/* Bannière « Nouvelle version disponible » : la page ouverte apprend qu'une version est déployée et propose « Mettre à jour », sans jamais recharger de force. Aucun réseau hors du banc d'essai. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const U = require('../js/update-banner.js');
const version = require('../api/version.js');
const H = require('./helpers/browser-harness.js');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const call = (method, env) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; const old = Object.assign({}, process.env); Object.assign(process.env, env || {}); try { version({ method }, res); } finally { for (const k of Object.keys(env || {})) { if (k in old) process.env[k] = old[k]; else delete process.env[k]; } } return res; };

test('UB1 api/version : identifiant public du dernier déploiement, jamais mis en cache, GET et HEAD seulement, rien d\'autre', () => {
  const ok = call('GET', { VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123' }); assert.equal(ok.statusCode, 200); assert.deepEqual(JSON.parse(ok.body), { version: '0123456789ab' });
  assert.match(ok.headers['Cache-Control'], /no-store/); assert.match(ok.headers['Content-Type'], /application\/json/);
  assert.equal(version.currentVersion({ VERCEL_DEPLOYMENT_ID: 'dpl_ABCdef123' }), 'dpl_ABCdef123'); assert.equal(version.currentVersion({}), 'dev', 'en local : jamais de mise à jour annoncée');
  assert.equal(version.currentVersion({ VERCEL_GIT_COMMIT_SHA: '<script>alert(1)</script>' }), 'dev', 'valeur non sûre ignorée');
  assert.equal(call('POST').statusCode, 405); assert.equal(call('HEAD', {}).body, undefined);
  const src = read('api/version.js'); assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /KEY|SECRET|TOKEN|SUPABASE|PERFECT/i, 'aucun secret lu');
  assert.ok(Object.keys(JSON.parse(ok.body)).join() === 'version');
});

/* faux navigateur */
function fake({ versions = ['v1'], online = true, visibility = 'visible', controller = false } = {}) {
  const body = { children: [], appendChild(el) { this.children.push(el); } }, listeners = {}, docL = {}, swL = {};
  const mkEl = html => { const el = { html, handlers: {}, removed: false, remove() { this.removed = true; const i = body.children.indexOf(this); if (i >= 0) body.children.splice(i, 1); }, querySelector(sel) { const k = sel.match(/data-update-(\w+)/)[1]; return html.includes(sel.slice(1, -1)) ? { addEventListener: (t, fn) => { el.handlers[k] = fn; } } : null; } }; el.firstElementChild = el; return el; };
  const doc = { body, visibilityState: visibility, createElement: () => ({ set innerHTML(v) { this.el = mkEl(v); }, get firstElementChild() { return this.el; } }), addEventListener: (t, fn) => { docL[t] = fn; } };
  const calls = []; let i = 0, mode = 'ok', updates = 0, reloaded = 0;
  const win = { navigator: { onLine: online, serviceWorker: { controller: controller ? {} : null, getRegistration: async () => ({ update: () => { updates++; return Promise.resolve(); } }), addEventListener: (t, fn) => { swL[t] = fn; } } },
    fetch: async (u, o) => { calls.push([u, o]); if (mode === 'throw') throw new Error('réseau'); if (mode === '404') return { ok: false, status: 404 }; if (mode === 'junk') return { ok: true, json: async () => { throw new Error('json'); } }; if (mode === 'bad') return { ok: true, json: async () => ({ version: '<b>x</b>' }) };
      const v = versions[Math.min(i++, versions.length - 1)]; return { ok: true, json: async () => ({ version: v }) }; },
    setInterval: (fn, ms) => { win.__tick = fn; win.__ms = ms; return 7; }, clearInterval: () => { win.__cleared = true; }, addEventListener: (t, fn) => { listeners[t] = fn; }, location: { reload: () => { reloaded++; } } };
  return { win, doc, body, calls, listeners, docL, swL, set mode(m) { mode = m; }, get updates() { return updates; }, get reloaded() { return reloaded; } };
}
const flush = () => new Promise(r => setTimeout(r, 5));
const w = (f, extra) => U.watch(f.win, f.doc, Object.assign({ now: () => f.t = (f.t || 0) + 10000 }, extra || {}));

test('UB2 même version : rien ; version différente : bannière avec « Mettre à jour » et « Plus tard », annoncée sans alerte sonore', async () => {
  const f = fake({ versions: ['v1', 'v1', 'v2'] }); const s = w(f); await flush();
  assert.equal(s.state.baseline, 'v1'); assert.equal(f.body.children.length, 0, 'la version de référence ne montre rien');
  await s.check(true); await flush(); assert.equal(f.body.children.length, 0, 'même version : rien');
  await s.check(true); await flush(); assert.equal(f.body.children.length, 1); const html = f.body.children[0].html;
  assert.match(html, /role="status"/); assert.match(html, /aria-live="polite"/); assert.doesNotMatch(html, /role="alert"/); assert.match(html, /Nouvelle version disponible/); assert.match(html, /Mettre à jour/); assert.match(html, /Plus tard/);
  assert.equal(f.calls[0][0], '/api/version'); assert.equal(f.calls[0][1].cache, 'no-store'); assert.ok(f.updates >= 1, 'le service worker est aussi interrogé');
});

test('UB3 « Mettre à jour » recharge ; « Plus tard » masque jusqu\'à la version SUIVANTE ; jamais de rechargement automatique', async () => {
  const f = fake({ versions: ['v1', 'v2', 'v2', 'v3'] }); const s = w(f); await flush();
  await s.check(true); await flush(); assert.equal(f.body.children.length, 1); assert.equal(f.reloaded, 0, 'aucun rechargement tout seul');
  f.body.children[0].handlers.later(); assert.equal(f.body.children.length, 0);
  await s.check(true); await flush(); assert.equal(f.body.children.length, 0, 'même version écartée : silence');
  await s.check(true); await flush(); assert.equal(f.body.children.length, 1, 'une version plus récente : la bannière revient');
  f.body.children[0].handlers.apply(); assert.equal(f.reloaded, 1);
});

test('UB4 fiable : réseau coupé, API absente (local), réponse invalide ou dangereuse : rien n\'est montré, aucune erreur ; hors ligne : aucune requête', async () => {
  for (const mode of ['throw', '404', 'junk', 'bad']) { const f = fake({ versions: ['v1'] }); f.mode = mode; const s = w(f); await flush(); await s.check(true); await flush(); assert.equal(f.body.children.length, 0, mode); assert.equal(s.state.baseline, null, mode); }
  const off = fake({ online: false }); const s = w(off); await flush(); assert.equal(off.calls.length, 0, 'hors ligne : aucune requête'); void s;
  const v = fake({ versions: ['v1', 'dev/../x'] }); const sv = w(v); await flush(); await sv.check(true); await flush(); assert.equal(v.body.children.length, 0, 'identifiant non sûr ignoré');
});

test('UB5 temps réel : contrôle toutes les 5 s seulement si la page est visible, au retour au premier plan, au retour du réseau et à chaque toucher dans l\'application ; pas plus d\'un contrôle toutes les 4 s', async () => {
  assert.equal(U.INTERVAL_MS, 5000); assert.equal(U.MIN_GAP_MS, 4000); assert.ok(U.MIN_GAP_MS < U.INTERVAL_MS, 'un léger retard du minuteur ne fait pas sauter de contrôle');
  const f = fake({ versions: ['v1', 'v2'] }); f.t = 0; const s = U.watch(f.win, f.doc, { now: () => f.t }); await flush(); assert.equal(f.win.__ms, 5000);
  f.doc.visibilityState = 'hidden'; f.t += 40000; f.win.__tick(); await flush(); assert.equal(f.calls.length, 1, 'page cachée : pas de contrôle');
  f.doc.visibilityState = 'visible'; f.t += 6000; f.listeners.focus(); await flush(); assert.equal(f.calls.length, 2); assert.equal(f.body.children.length, 1, 'retour au premier plan : nouvelle version vue tout de suite');
  f.t += 1000; f.listeners.focus(); await flush(); assert.equal(f.calls.length, 2, 'moins de 4 s depuis le dernier contrôle : rien');
  f.listeners.online(); await flush(); assert.ok(f.calls.length >= 3, 'retour du réseau : contrôle forcé');
  const c0 = f.calls.length; f.t += 1000; f.docL.click(); await flush(); assert.equal(f.calls.length, c0, 'toucher moins de 4 s après un contrôle : rien'); f.t += 6000; f.docL.click(); await flush(); assert.equal(f.calls.length, c0 + 1, 'toucher dans l\'application : contrôle'); s.stop(); assert.equal(f.win.__cleared, true);
});

test('UB6 service worker remplacé pendant que la page tourne : bannière ; premier service worker de la vie de la page : rien', async () => {
  const had = fake({ controller: true }); const a = w(had); await flush(); had.swL.controllerchange(); assert.equal(had.body.children.length, 1, 'le code affiché est ancien'); void a;
  const first = fake({ controller: false }); const b = w(first); await flush(); first.swL.controllerchange(); assert.equal(first.body.children.length, 0, 'premier contrôle : pas une mise à jour'); void b;
});

test('UB7 câblage : module chargé en dernier, textes sans tiret cadratin, aucune donnée de personne ; la page ne met jamais /api/version en cache', () => {
  const h = read('index.html'); assert.ok(h.indexOf('js/pwa-install.js') < h.indexOf('js/update-banner.js')); assert.ok(h.indexOf('js/app.js') < h.indexOf('js/update-banner.js'));
  for (const t of Object.values(U.TEXT)) { assert.ok(!/[—–]/.test(t), t); assert.doesNotMatch(t, /DERM\u0041I/); }
  assert.match(U.TEXT.body, /DermAI vient d'être mis à jour/);
  assert.doesNotMatch(read('js/update-banner.js').replace(/\/\*[\s\S]*?\*\//g, ''), /localStorage|sessionStorage|indexedDB|cookie|sendBeacon|XMLHttpRequest/);
  assert.match(read('sw.js'), /url\.pathname\.startsWith\('\/api\/'\)/, 'le service worker ne touche pas à /api/version');
  const pwaCss = read('css/components/pwa.css');
  assert.match(pwaCss, /\.update-banner\{position:fixed;[^}]*bottom:calc\(12px \+ env\(safe-area-inset-bottom,0px\)\)/, 'en bas de l\'écran');
  assert.doesNotMatch(pwaCss.match(/\.update-banner\{[^}]*\}/)[0], /top:/, 'plus en haut');
  assert.ok(!/scanfab/.test(pwaCss), 'plus de bouton rond à éviter : la bannière reste tout en bas');
  assert.match(pwaCss, /body:has\(\.update-banner\) \.pwa-banner\{display:none\}/, 'ne recouvre pas le bandeau d\'installation : il s\'efface le temps de la mise à jour');
});

/* ---- Chromium : une version déployée pendant que la page est ouverte ---- */
const OK = H.available();
test('UBB1 Chromium : la bannière apparaît toute seule quand la version change, « Mettre à jour » recharge la page', { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 }, async () => {
  let current = 'build-1', hits = 0;
  const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x').pathname;
    if (u === '/api/version') { hits++; r.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return r.end(JSON.stringify({ version: current })); }
    if (u.startsWith('/api/')) { r.writeHead(u === '/api/config-js' ? 200 : 404, { 'Content-Type': 'text/javascript' }); return r.end(u === '/api/config-js' ? 'window.DERMAI_CONFIG={};' : ''); }
    const f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    const ext = path.extname(f).slice(1), types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/json', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', ico: 'image/x-icon' };
    r.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await H.loadPlaywright().chromium.launch(), errors = [];
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(base + '/'); await page.waitForSelector('#app'); await page.waitForFunction(() => window.__dermaiUpdate && window.__dermaiUpdate.state.baseline === 'build-1', null, { timeout: 10000 });
    assert.equal(await page.locator('[data-update-banner]').count(), 0, 'même version : pas de bannière');
    /* un contrôle rapide avec la même page : on branche un second guetteur à 200 ms (le vrai tourne à 5 s) */
    await page.evaluate(() => { window.__w = DermaiUpdate.watch(window, document, { interval: 200 }); });
    await page.waitForTimeout(600); assert.equal(await page.locator('[data-update-banner]').count(), 0);
    current = 'build-2';
    await page.waitForSelector('[data-update-banner]', { timeout: 10000 });
    assert.match(await page.locator('[data-update-banner]').innerText(), /Nouvelle version disponible/);
    const box = await page.locator('[data-update-banner]').boundingBox(), vh = await page.evaluate(() => innerHeight); assert.ok(box.y + box.height > vh - 100 && box.y + box.height <= vh, 'en bas de l\'écran : ' + JSON.stringify(box));
    await page.evaluate(() => { window.__marker = 'avant'; });
    await Promise.all([page.waitForNavigation({ timeout: 10000 }), page.locator('[data-update-apply]').click()]);
    assert.equal(await page.evaluate(() => window.__marker), undefined, 'la page a bien été rechargée');
    await page.waitForFunction(() => window.__dermaiUpdate && window.__dermaiUpdate.state.baseline === 'build-2', null, { timeout: 10000 });
    assert.equal(await page.locator('[data-update-banner]').count(), 0, 'après rechargement : à jour, plus de bannière'); assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
