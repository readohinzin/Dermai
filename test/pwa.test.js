'use strict';
/* PWA : l'application s'installe sur iPhone (Partager, « Sur l'écran d'accueil ») et sur Android (invitation d'installation), s'ouvre hors ligne sur une page claire, et le service worker
   ne touche jamais aux données de personne (/api/, autres domaines, méthodes autres que GET). Aucun réseau hors du banc d'essai. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../js/pwa-install.js');
const H = require('./helpers/browser-harness.js');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const png = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b.subarray(1, 4).toString(), 'PNG', f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length }; };
const manifest = JSON.parse(read('manifest.json'));

test('PW1 manifeste : installable sur Android (192 et 512 réelles, maskable séparée), nom DermAI, raccourcis', () => {
  assert.equal(manifest.short_name, 'DermAI'); assert.match(manifest.name, /^DermAI/); assert.equal(manifest.lang, 'fr'); assert.equal(manifest.id, '/'); assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone'); assert.equal(manifest.orientation, 'portrait');
  assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/); assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
  const by = (size, purpose) => manifest.icons.find(i => i.sizes === size && i.purpose === purpose);
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const i = by(size, purpose); assert.ok(i, size + ' ' + purpose); assert.equal(i.type, 'image/png');
    const d = png(i.src.replace(/^\//, '')); assert.deepEqual([d.w, d.h], size.split('x').map(Number), i.src + ' : taille réelle = taille déclarée'); assert.ok(d.size > 2000);
  }
  assert.ok(manifest.icons.every(i => i.purpose !== 'any maskable'), '« any maskable » combinés : refusé, on déclare deux icônes distinctes');
  assert.ok(manifest.shortcuts.length >= 2 && manifest.shortcuts.every(s => s.url.startsWith('/') && s.name && s.icons[0].src.startsWith('/')));
  assert.deepEqual(png('apple-touch-icon.png').w, 180, 'icône iPhone 180 x 180');
  assert.doesNotMatch(read('manifest.json'), /DERMAI|Dermai/);
});

test('PW2 index.html : manifeste, couleurs, balises iPhone et Android, icônes ; plus de code d\'installation en ligne', () => {
  const h = read('index.html');
  assert.match(h, /<link rel="manifest" href="\/manifest\.json">/); assert.match(h, /<meta name="theme-color" content="#FFF9FA">/);
  assert.match(h, /<meta name="apple-mobile-web-app-capable" content="yes">/); assert.match(h, /<meta name="mobile-web-app-capable" content="yes">/); assert.match(h, /<meta name="apple-mobile-web-app-title" content="DermAI">/);
  assert.match(h, /<meta name="apple-mobile-web-app-status-bar-style" content="default">/); assert.match(h, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(h, /viewport-fit=cover/);
  assert.doesNotMatch(h, /pwa-install-btn|beforeinstallprompt|serviceWorker\.register|📲/, 'le code d\'installation est dans js/pwa-install.js');
  assert.ok(h.indexOf('js/app.js') < h.indexOf('js/pwa-install.js'), 'chargé en dernier'); assert.match(read('css/styles.css'), /components\/pwa\.css/);
  assert.ok(fs.existsSync(path.join(ROOT, 'offline.html'))); assert.match(read('offline.html'), /Vous êtes hors ligne/);
  const v = JSON.parse(read('vercel.json')), hd = src => (v.headers.find(x => x.source === src) || {}).headers || [];
  assert.ok(hd('/sw.js').some(x => x.key === 'Cache-Control' && /no-cache/.test(x.value)) && hd('/sw.js').some(x => x.key === 'Service-Worker-Allowed' && x.value === '/'));
  assert.ok(hd('/manifest.json').some(x => x.key === 'Content-Type' && /manifest\+json/.test(x.value)));
});

/* ---- service worker : exécuté dans un faux environnement ---- */
function loadSw(cachesInit = {}, fetchImpl) {
  const listeners = {}, store = new Map(Object.entries(cachesInit).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const mkCache = name => ({
    addAll: async urls => { const c = store.get(name) || new Map(); urls.forEach(u => c.set(u, { url: u })); store.set(name, c); },
    put: async (req, res) => { const c = store.get(name) || new Map(); c.set(typeof req === 'string' ? req : req.url, res); store.set(name, c); },
    keys: async () => [...(store.get(name) || new Map()).keys()], delete: async k => (store.get(name) || new Map()).delete(k)
  });
  const caches = { open: async n => { if (!store.has(n)) store.set(n, new Map()); return mkCache(n); }, keys: async () => [...store.keys()], delete: async n => store.delete(n),
    match: async req => { const u = typeof req === 'string' ? new URL(req, 'https://dermai.test').pathname : new URL(req.url).pathname; for (const c of store.values()) for (const [k, v] of c) { const kp = new URL(typeof k === 'string' ? k : k.url || k, 'https://dermai.test').pathname; if (kp === u) return v; } return undefined; } };
  const calls = [];
  const ctx = { self: { location: { origin: 'https://dermai.test' }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => { ctx.skipped = true; return Promise.resolve(); }, clients: { claim: () => { ctx.claimed = true; return Promise.resolve(); } } },
    caches, fetch: async req => { calls.push(req.url || req); if (fetchImpl) return fetchImpl(req); return { status: 200, type: 'basic', clone() { return this; }, url: req.url }; },
    Request: class { constructor(u) { this.url = new URL(u, 'https://dermai.test').href; this.method = 'GET'; } }, URL, Response: class { constructor(b, o) { this.body = b; this.status = (o && o.status) || 200; this.type = 'basic'; } clone() { return this; } } };
  vm.createContext(ctx); vm.runInContext(read('sw.js'), ctx);
  const fire = async (type, props) => { let waits = [], responded; const ev = Object.assign({ waitUntil: p => waits.push(p), respondWith: p => { responded = p; } }, props); listeners[type](ev); await Promise.all(waits); return { responded: responded ? await responded : undefined, wasHandled: responded !== undefined }; };
  return { ctx, store, calls, fire, listeners };
}
const req = (url, extra) => Object.assign({ url: 'https://dermai.test' + url, method: 'GET', mode: 'cors' }, extra || {});

test('PW3 service worker : précache existant, version, anciens caches supprimés, prise de contrôle immédiate', async () => {
  const src = read('sw.js'); assert.match(src, /const VERSION = 'dermai-v\d+'/);
  const pre = JSON.parse(src.match(/const PRECACHE = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  for (const f of pre) assert.ok(fs.existsSync(path.join(ROOT, f.replace(/^\//, ''))), 'fichier précaché inexistant : ' + f);
  const sw = loadSw({ 'dermai-v1-shell': { a: 1 }, 'autre-site': { b: 1 }, 'dermai-v2-shell': {} });
  await sw.fire('install'); assert.equal(sw.ctx.skipped, true); assert.deepEqual([...sw.store.get('dermai-v2-shell').keys()].sort(), [...pre].sort());
  await sw.fire('activate'); assert.equal(sw.ctx.claimed, true);
  assert.ok(!sw.store.has('dermai-v1-shell'), 'ancien cache supprimé'); assert.ok(sw.store.has('autre-site'), 'un cache étranger n\'est pas touché'); assert.ok(sw.store.has('dermai-v2-shell'));
});

test('PW4 service worker : jamais d\'interception de /api/, d\'un autre domaine, d\'un POST, ni de sw.js', async () => {
  const sw = loadSw();
  for (const r of [req('/api/skin-analysis'), req('/api/config-js'), req('/sw.js'), req('/scan', { method: 'POST' }), { url: 'https://abc.supabase.co/auth/v1/user', method: 'GET', mode: 'cors' }, { url: 'https://fonts.googleapis.com/css2', method: 'GET', mode: 'cors' }]) {
    const out = await sw.fire('fetch', { request: r }); assert.equal(out.wasHandled, false, r.url + ' ' + r.method);
  }
  assert.equal(sw.calls.length, 0, 'aucune requête faite par le service worker');
  assert.doesNotMatch(read('sw.js'), /cache\.(put|add)\(.*api/);
});

test('PW5 service worker : réseau d\'abord pour pages et scripts (jamais périmés), hors ligne = dernière page ou page « hors ligne »', async () => {
  let online = true; const sw = loadSw({}, async r => { if (!online) throw new Error('hors ligne'); return { status: 200, type: 'basic', clone() { return this; }, url: r.url, body: 'frais:' + r.url }; });
  const first = await sw.fire('fetch', { request: req('/js/app.js', { mode: 'no-cors' }) }); assert.match(first.responded.body, /frais:/);
  online = false;
  const cached = await sw.fire('fetch', { request: req('/js/app.js', { mode: 'no-cors' }) }); assert.equal(cached.wasHandled, true); assert.match(cached.responded.body, /frais:/, 'hors ligne : dernière copie');
  await sw.fire('install');
  const nav = await sw.fire('fetch', { request: req('/scan', { mode: 'navigate' }) }); assert.equal(nav.responded.url, '/offline.html', 'navigation hors ligne sans page gardée : page « hors ligne »');
  online = true; await sw.fire('fetch', { request: req('/', { mode: 'navigate' }) }); online = false;
  const home = await sw.fire('fetch', { request: req('/scan', { mode: 'navigate' }) }); assert.match(home.responded.body, /frais:.*\//, 'hors ligne : dernière page d\'accueil gardée');
  online = true; const fresh = await sw.fire('fetch', { request: req('/js/app.js', { mode: 'no-cors' }) }); assert.match(fresh.responded.body, /frais:/);
  assert.ok(sw.calls.filter(c => c.endsWith('/js/app.js')).length >= 3, 'chaque chargement en ligne passe par le réseau');
});

test('PW6 service worker : seules les réponses 200 du site sont gardées ; images et polices locales : copie d\'abord', async () => {
  const sw = loadSw({}, async r => (r.url.endsWith('/bad.js') ? { status: 500, type: 'basic', clone() { return this; } } : r.url.endsWith('/opaque.js') ? { status: 200, type: 'opaque', clone() { return this; } } : { status: 200, type: 'basic', clone() { return this; }, url: r.url, body: 'net' }));
  await sw.fire('fetch', { request: req('/bad.js', { mode: 'no-cors' }) }); await sw.fire('fetch', { request: req('/opaque.js', { mode: 'no-cors' }) });
  assert.ok(!sw.store.has('dermai-v2-runtime') || [...sw.store.get('dermai-v2-runtime').keys()].length === 0, 'ni erreur ni réponse opaque gardées');
  await sw.fire('fetch', { request: req('/img/people/woman-1.webp', { mode: 'no-cors' }) }); await new Promise(r => setTimeout(r, 10));
  const hit = await sw.fire('fetch', { request: req('/img/people/woman-1.webp', { mode: 'no-cors' }) }); assert.equal(hit.responded.body, 'net', 'copie servie');
  assert.ok(read('sw.js').includes('MAX_RUNTIME_ENTRIES'), 'taille du cache bornée');
});

/* ---- invitation d'installation ---- */
function fakeWin({ ua = '', standalone, display = false, touch = 0, store = {}, ready = 'complete' } = {}) {
  const listeners = {}, body = { children: [], appendChild(el) { this.children.push(el); } };
  const mkEl = html => { const el = { html, removed: false, handlers: {}, remove() { this.removed = true; const i = body.children.indexOf(this); if (i >= 0) body.children.splice(i, 1); },
    firstElementChild: null, querySelector(sel) { const m = sel.match(/data-pwa-(later|install)/); const has = html.includes(sel.slice(1, -1)); return has ? { addEventListener: (t, fn) => { el.handlers[m[1]] = fn; } } : null; } }; el.firstElementChild = el; return el; };
  const doc = { readyState: ready, body, createElement: () => { const h = { set innerHTML(v) { this.el = mkEl(v); }, get firstElementChild() { return this.el; } }; return h; }, querySelector: sel => body.children.find(c => c.html.includes(sel.slice(1, -1))) || null };
  const st = Object.assign({}, store), win = { navigator: { userAgent: ua, maxTouchPoints: touch, standalone, serviceWorker: { register: async url => { win.__registered = url; return {}; } } }, document: doc,
    matchMedia: q => ({ matches: display && /standalone/.test(q) }), localStorage: { getItem: k => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); } }, addEventListener: (t, fn) => { listeners[t] = fn; }, __store: st, __listeners: listeners };
  return { win, doc, body };
}
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

test('PW7 iPhone : détection (iPhone, iPad, iPadOS), aucun bouton d\'installation mais un bandeau « Partager », « Sur l\'écran d\'accueil »', async () => {
  assert.equal(P.isIos({ userAgent: IPHONE }), true); assert.equal(P.isIos({ userAgent: ANDROID }), false);
  assert.equal(P.isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true, 'iPadOS se présente comme un Mac'); assert.equal(P.isIos({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), false);
  const { win, body } = fakeWin({ ua: IPHONE, standalone: false }); const s = P.start(win, win.document, { delay: 0 }); await s.registered; await new Promise(r => setTimeout(r, 5));
  assert.equal(s.shown, 'ios'); const html = body.children[0].html;
  assert.match(html, /Installer DermAI sur votre iPhone/); assert.match(html, /Touchez le bouton Partager/); assert.match(html, /<svg class="pwa-share"/); assert.match(html, /Sur l&#39;écran d&#39;accueil/); assert.doesNotMatch(html, /data-pwa-install/);
  assert.equal(win.__registered, '/sw.js', 'service worker enregistré');
  body.children[0].handlers.later(); assert.equal(body.children.length, 0); assert.ok(win.__store[P.KEY], 'fermeture mémorisée sur l\'appareil');
});

test('PW8 déjà installée : rien n\'est affiché ; bandeau fermé : silence 30 jours ; stockage refusé : aucune erreur', async () => {
  for (const o of [{ ua: IPHONE, standalone: true }, { ua: ANDROID, display: true }]) { const { win, body } = fakeWin(o); const s = P.start(win, win.document, { delay: 0 }); await new Promise(r => setTimeout(r, 5)); assert.equal(s.skipped, 'standalone'); assert.equal(body.children.length, 0); }
  const day = 86400000, now = 1700000000000;
  const quiet = fakeWin({ ua: IPHONE, store: { [P.KEY]: String(now - 5 * day) } }); const s1 = P.start(quiet.win, quiet.win.document, { delay: 0, now: () => now }); await new Promise(r => setTimeout(r, 5)); assert.equal(s1.shown, null, 'fermé il y a 5 jours : rien');
  const again = fakeWin({ ua: IPHONE, store: { [P.KEY]: String(now - 31 * day) } }); const s2 = P.start(again.win, again.win.document, { delay: 0, now: () => now }); await new Promise(r => setTimeout(r, 5)); assert.equal(s2.shown, 'ios', 'fermé il y a 31 jours : revient');
  const broken = fakeWin({ ua: IPHONE }); broken.win.localStorage = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); } };
  assert.doesNotThrow(() => { const s = P.start(broken.win, broken.win.document, { delay: 0 }); return s; }); await new Promise(r => setTimeout(r, 5));
  broken.body.children[0] && assert.doesNotThrow(() => broken.body.children[0].handlers.later());
});

test('PW9 Android : l\'invitation du navigateur est retenue, le bandeau l\'ouvre au toucher ; refus = silence ; appinstalled = bandeau retiré', async () => {
  const { win, body } = fakeWin({ ua: ANDROID }); const s = P.start(win, win.document, { delay: 0 });
  assert.equal(s.shown, null, 'rien avant l\'événement du navigateur');
  let prevented = false, prompted = false; const ev = { preventDefault() { prevented = true; }, prompt() { prompted = true; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  win.__listeners.beforeinstallprompt(ev); await new Promise(r => setTimeout(r, 5));
  assert.equal(prevented, true); assert.equal(s.shown, 'android'); assert.match(body.children[0].html, /Installer DermAI/); assert.match(body.children[0].html, /data-pwa-install/); assert.doesNotMatch(body.children[0].html, /Partager/);
  await body.children[0].handlers.install(); assert.equal(prompted, true); assert.equal(body.children.length, 0); assert.ok(win.__store[P.KEY], 'refus : on ne redemande pas tout de suite');
  const b = fakeWin({ ua: ANDROID }); P.start(b.win, b.win.document, { delay: 0 }); b.win.__listeners.beforeinstallprompt({ preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) }); await new Promise(r => setTimeout(r, 5));
  assert.equal(b.body.children.length, 1); b.win.__listeners.appinstalled(); assert.equal(b.body.children.length, 0);
  assert.equal(P.DELAY_MS, 8000); assert.equal(P.QUIET_DAYS, 30);
});

test('PW10 textes : DermAI, tutoiement exclu, aucun tiret cadratin ; module sans réseau ni donnée de personne', () => {
  for (const t of Object.values(P.TEXT)) { assert.ok(!/[—–]/.test(t), t); assert.doesNotMatch(t, /DERMAI|Dermai/, t); }
  assert.doesNotMatch(read('js/pwa-install.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|sendBeacon|sessionStorage|indexedDB|cookie/);
  assert.match(read('js/pwa-install.js'), /dermai\.pwa\.dismissed/);
});

/* ---- Chromium : service worker réel, installation de l'enveloppe, page ouverte hors ligne ---- */
const OK = H.available();
test('PWB1 Chromium : manifeste lu, service worker actif, page hors ligne affichée quand le réseau tombe', { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 }, async () => {
  const srv = http.createServer((q, r) => { const u = new URL(q.url, 'http://x').pathname, f = path.join(ROOT, u === '/' ? 'index.html' : u.replace(/^\//, ''));
    if (u.startsWith('/api/')) { r.writeHead(u === '/api/config-js' ? 200 : 404, { 'Content-Type': 'text/javascript' }); return r.end(u === '/api/config-js' ? 'window.DERMAI_CONFIG={};' : ''); }
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return r.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    const ext = path.extname(f).slice(1), types = { html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', json: 'application/manifest+json', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', ico: 'image/x-icon' };
    r.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await H.loadPlaywright().chromium.launch(), errors = [];
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'allow' }), page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await page.goto(base + '/'); await page.waitForFunction(() => navigator.serviceWorker.ready.then(r => !!r.active), null, { timeout: 15000 });
    const mf = await page.evaluate(async () => { const href = document.querySelector('link[rel=manifest]').href; const r = await fetch(href); return { ok: r.ok, json: await r.json() }; });
    assert.equal(mf.ok, true); assert.equal(mf.json.short_name, 'DermAI');
    await page.reload(); await page.waitForSelector('#app'); await page.waitForTimeout(500);
    const keys = await page.evaluate(() => caches.keys()); assert.ok(keys.some(k => /^dermai-v\d+-shell$/.test(k)), keys.join());
    const shell = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => /-shell$/.test(k))); return (await c.keys()).map(r => new URL(r.url).pathname); });
    assert.ok(shell.includes('/offline.html') && shell.includes('/manifest.json'));
    await ctx.setOffline(true);
    await page.goto(base + '/scan').catch(() => {}); await page.waitForTimeout(500);
    const txt = await page.locator('body').innerText();
    assert.ok(/Vous êtes hors ligne/.test(txt) || (await page.locator('#app').count()) === 1, 'hors ligne : la page gardée ou la page « hors ligne »');
    await ctx.setOffline(false); assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
