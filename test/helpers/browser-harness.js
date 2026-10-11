'use strict';
/* Banc d'essai navigateur : le VRAI index.html et le VRAI js/app.js tournent dans Chromium, mais AUCUN service externe n'est joignable.
   - /api/config-js est servi par un petit serveur local (mode réel, projet Supabase factice) ;
   - tout /api/skin-analysis est intercepté par le navigateur : aucune requête ne part vers le serveur, encore moins vers Perfect Corp ;
   - Supabase est remplacé par test/helpers/fake-supabase.js ;
   - toute autre requête sortante est bloquée et comptée (stats.escaped doit rester vide).
   Playwright et Chromium viennent de l'environnement (pas de dépendance du projet) : sans eux, available() renvoie false et les tests sont ignorés. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createFake } = require('./fake-supabase.js');
const SkinModel = require('../../js/skin-model.js');

const ROOT = path.join(__dirname, '..', '..');
const SB = 'https://demo.supabase.co';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright']) { try { return require(p); } catch (e) { /* suivant */ } }
  return null;
}
function available() {
  const pw = loadPlaywright();
  if (!pw) return false;
  try { return fs.existsSync(pw.chromium.executablePath()); } catch (e) { return false; }
}

/* Réponse d'analyse valide (même forme que le backend : { ok, result: { schemaVersion, normalized } }). */
function analysisPayload(seed = 60) {
  const normalized = { globalScore: seed + 5, skinAge: 31, skinType: { whole: 'combination' } };
  SkinModel.METRIC_KEYS.forEach((k, i) => { normalized[k] = { uiScore: Math.min(100, seed + ((i * 7) % 30)), rawScore: Math.min(100, seed + ((i * 7) % 30)) - 0.5 }; });
  return { ok: true, result: { schemaVersion: SkinModel.SCHEMA_VERSION, normalized } };
}

function startServer(stats) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/api/config-js') { res.setHeader('Content-Type', MIME['.js']); return res.end(`window.DERMAI_CONFIG={demoMode:false,supabaseUrl:${JSON.stringify(SB)},supabaseAnonKey:"anon-key-for-tests"};`); }
      if (url.pathname.startsWith('/api/')) { stats.serverApi.push(url.pathname); res.statusCode = 599; return res.end('blocked by test'); }   // ne doit jamais arriver
      let file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');   // comme vercel.json
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* Un JPEG de test (bruit sur fond couleur peau), produit par le navigateur lui-même. */
async function makeJpeg(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 800; const g = c.getContext('2d');
    g.fillStyle = '#b07a5a'; g.fillRect(0, 0, 640, 800);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgb(${120 + (i * 37) % 90},${80 + (i * 53) % 70},${60 + (i * 29) % 60})`; g.fillRect((i * 97) % 640, (i * 61) % 800, 6, 6); }
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/* options : { fake, behaviors } ; behaviors = file d'actions pour les appels à /api/skin-analysis (la dernière se répète) :
   { status, body, delay } | { abort: true } | { never: true }. */
async function open(browser, server, { fake = createFake(), behaviors = [{ status: 200, body: analysisPayload() }], user = null, preload = null } = {}) {
  const stats = { skin: [], escaped: [], serverApi: server.stats.serverApi, supabase: [] };
  const context = await browser.newContext({ baseURL: `http://127.0.0.1:${server.address().port}`, viewport: { width: 420, height: 900 } });
  const hold = [];
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === `http://127.0.0.1:${server.address().port}`) {
      if (url.pathname === '/api/skin-analysis') {
        const n = stats.skin.push({ at: Date.now(), size: (req.postDataBuffer() || Buffer.alloc(0)).length, auth: !!req.headers().authorization });
        const b = behaviors[Math.min(n - 1, behaviors.length - 1)];
        if (b.abort) return route.abort('connectionreset');
        if (b.never) { hold.push(route); return; }
        if (b.delay) await new Promise(r => setTimeout(r, b.delay));
        return route.fulfill({ status: b.status || 200, contentType: b.contentType || 'application/json', body: typeof b.body === 'string' ? b.body : JSON.stringify(b.body) });
      }
      return route.continue();
    }
    if (url.origin === SB) {
      stats.supabase.push(`${req.method()} ${url.pathname}`);
      const r = await fake.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() || undefined });
      return route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text() });
    }
    stats.escaped.push(req.url());
    return route.abort('blockedbyclient');
  });
  if (user) {
    const r = await fake.fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: user.email, password: user.password || 'motdepasse1' }) });
    const session = JSON.parse(await r.text());
    await context.addInitScript(s => { try { if (!localStorage.getItem('dermai.session') && !sessionStorage.getItem('__booted')) localStorage.setItem('dermai.session', s); sessionStorage.setItem('__booted', '1'); } catch (e) { /* */ } }, JSON.stringify(session));
    stats.session = session;
  }
  if (preload) await context.addInitScript(preload);
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await (page.__dialogAnswer === false ? d.dismiss() : d.accept()); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  return { context, page, fake, stats, dialogs, errors, hold, close: () => context.close() };
}

module.exports = { available, loadPlaywright, startServer, open, makeJpeg, analysisPayload, SB, createFake };
