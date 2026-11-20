'use strict';
/* DermAI, outil INTERNE d'évaluation : serveur LOCAL (127.0.0.1 seulement). HORS PRODUCTION : jamais déployé (voir .vercelignore), jamais lié depuis l'application.
   node tools/eval/serve.js            : lit eval-data/manifest.json et eval-data/photos/ (dossier ignoré par git : photos et notes ne vont JAMAIS dans le dépôt)
   node tools/eval/serve.js --sample   : données FICTIVES de démonstration (lecture seule, aucune photo)
   Aucune requête sortante. Refuse toute requête dont l'hôte n'est pas localhost (protection contre le détournement de DNS). */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const TOOL = __dirname;
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/page.js': ['page.js', 'text/javascript; charset=utf-8'], '/lib.js': ['lib.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'
};
const RATER = /^[A-Za-z0-9_-]{1,16}$/;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }

/* options : { dataDir, sample } ; renvoie un http.Server (non démarré). */
function createServer(options) {
  const sample = !!(options && options.sample);
  const dataDir = sample ? path.join(TOOL, 'sample') : path.resolve((options && options.dataDir) || path.join(TOOL, '..', '..', 'eval-data'));
  const manifestFile = path.join(dataDir, 'manifest.json'), ratingsFile = path.join(dataDir, 'ratings.json'), photosDir = path.join(dataDir, 'photos');
  const send = (res, status, body, type) => { res.writeHead(status, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8' }, HEADERS)); res.end(body); };
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj));

  /* Manifeste + notes (ratings.json) fusionnées : le manifeste lui-même n'est jamais réécrit. */
  function load() {
    const m = readJson(manifestFile, { items: [] }), ratings = readJson(ratingsFile, {});
    const items = (Array.isArray(m.items) ? m.items : []).map(it => {
      const raters = Object.assign({}, it && it.raters, (ratings && it && ratings[it.id]) || {});
      return Object.assign({}, it, { raters });
    });
    return { fictive: !!m.fictive, note: typeof m.note === 'string' ? m.note : '', items };
  }

  return http.createServer((req, res) => {
    const host = String(req.headers.host || ''), port = req.socket.localPort;
    if (!(host === '127.0.0.1:' + port || host === 'localhost:' + port)) return json(res, 403, { error: 'hôte refusé : outil local' });
    const origin = req.headers.origin; if (origin && origin !== 'http://' + host) return json(res, 403, { error: 'origine refusée' });
    const url = new URL(req.url, 'http://' + host);
    try {
      if (req.method === 'GET' && STATIC[url.pathname]) return send(res, 200, fs.readFileSync(path.join(TOOL, STATIC[url.pathname][0])), STATIC[url.pathname][1]);
      if (req.method === 'GET' && url.pathname === '/api/manifest') { const d = load(); return json(res, 200, { mode: sample ? 'sample' : 'local', readOnly: sample, fictive: d.fictive, note: d.note, items: d.items }); }
      const ph = /^\/photos\/([\w.-]{1,80}\.(jpe?g|png|webp))$/i.exec(url.pathname);
      if (req.method === 'GET' && ph) {
        const file = path.join(photosDir, ph[1]);
        if (path.dirname(file) !== photosDir || !fs.existsSync(file)) return json(res, 404, { error: 'photo introuvable' });
        return send(res, 200, fs.readFileSync(file), MIME[ph[2].toLowerCase()]);
      }
      if (req.method === 'POST' && url.pathname === '/api/ratings') {
        if (sample) return json(res, 403, { error: 'données fictives : lecture seule' });
        let size = 0; const chunks = [];
        req.on('data', c => { size += c.length; if (size > 16384) { req.destroy(); } else chunks.push(c); });
        req.on('end', () => {
          let b; try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return json(res, 400, { error: 'JSON invalide' }); }
          const d = load(), it = d.items.find(x => x && b && x.id === b.id);
          if (!it) return json(res, 404, { error: 'photo inconnue' });
          if (!L.checkItem(it).ok) return json(res, 403, { error: 'photo exclue (consentement absent ou retiré) : aucune évaluation enregistrée' });
          if (typeof b.rater !== 'string' || !RATER.test(b.rater)) return json(res, 400, { error: 'évaluatrice invalide' });
          const levels = {}, only = {};
          for (const m of L.HUMAN_METRICS) { const v = b.levels && b.levels[m]; if (v !== undefined) { if (!Number.isInteger(v) || v < 0 || v > 3) return json(res, 400, { error: 'niveau invalide : ' + m }); levels[m] = v; } }
          for (const k of L.HUMAN_ONLY) { const v = b.only && b.only[k]; if (v !== undefined) { if (typeof v !== 'boolean') return json(res, 400, { error: 'valeur invalide : ' + k }); only[k] = v; } }
          const ratings = readJson(ratingsFile, {});
          ratings[it.id] = Object.assign({}, ratings[it.id], { [b.rater]: { levels, only } });
          fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 1));
          return json(res, 200, { ok: true });
        });
        return;
      }
      return json(res, 404, { error: 'introuvable' });
    } catch (e) { return json(res, 500, { error: 'erreur locale' }); }
  });
}

if (require.main === module) {
  const args = process.argv.slice(2), sample = args.includes('--sample'), pi = args.indexOf('--port'), port = pi >= 0 ? Number(args[pi + 1]) : 8787;
  const srv = createServer({ sample });
  srv.listen(port, '127.0.0.1', () => console.log('DermAI, outil interne d\'évaluation (hors production) : http://127.0.0.1:' + port + (sample ? '  [données FICTIVES, lecture seule]' : '  [données locales : eval-data/]')));
}
module.exports = { createServer };
