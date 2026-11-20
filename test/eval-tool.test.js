'use strict';
/* Lot 9 : outil INTERNE d'évaluation (tools/eval), hors production. Comparaison moteur / regard humain par groupe de teint, consentement obligatoire, données hors git,
   serveur local seulement. Données FICTIVES uniquement : aucune photo, aucun réseau sortant. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const L = require('../tools/eval/lib.js');
const { createServer } = require('../tools/eval/serve.js');
const H = require('./helpers/browser-harness.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const consent = { given: true, date: '2026-11-01', scope: 'évaluation interne, données fictives' };
const item = (id, monk, human, engine, extra) => Object.assign({ id, monk, photo: id + '.jpg', consent, engine: Object.fromEntries(Object.entries(engine).map(([k, v]) => [k, { rawScore: v, uiScore: Math.min(100, v + 8) }])), raters: { R1: { levels: human, only: {} } } }, extra || {});

test('EV1 consentement obligatoire : sans lui, retiré ou invalide, la photo est EXCLUE de la comparaison', () => {
  const ok = item('P1', 7, { acne: 3 }, { acne: 30 });
  assert.equal(L.checkItem(ok).ok, true);
  for (const [bad, code] of [[Object.assign({}, ok, { consent: undefined }), 'no_consent'], [Object.assign({}, ok, { consent: { given: false, date: '2026-11-01', scope: 'x' } }), 'no_consent'],
    [Object.assign({}, ok, { consent: { given: true, date: 'hier', scope: 'x' } }), 'no_consent'], [Object.assign({}, ok, { consent: { given: true, date: '2026-11-01', scope: ' ' } }), 'no_consent'],
    [Object.assign({}, ok, { withdrawn: true }), 'withdrawn'], [Object.assign({}, ok, { id: 'Marie Dupont' }), 'invalid'], [Object.assign({}, ok, { monk: 11 }), 'invalid'],
    [Object.assign({}, ok, { photo: '../../etc/passwd' }), 'invalid'], [null, 'invalid'], ['x', 'invalid']]) assert.equal(L.checkItem(bad).code, code, JSON.stringify(bad));
  const c = L.compare([ok, Object.assign({}, ok, { id: 'P2', consent: undefined }), Object.assign({}, ok, { id: 'P3', withdrawn: true })]);
  assert.equal(c.included, 1); assert.deepEqual(c.excluded.map(e => e.code).sort(), ['no_consent', 'withdrawn']);
});

test('EV2 fausse rassurance : le moteur dit « bon » (raw 50 ou plus) alors que la personne voit un signe modéré ou marqué ; par groupe de teint', () => {
  const deep = [], light = [];
  for (let i = 0; i < 12; i++) { deep.push(item('D' + i, 7, { acne: i % 4 === 0 ? 1 : 3 }, { acne: i % 4 === 0 ? 70 : 65 })); light.push(item('L' + i, 2, { acne: i % 2 ? 3 : 0 }, { acne: i % 2 ? 20 : 85 })); }
  const c = L.compare([...deep, ...light]);
  assert.equal(c.groups.deep.n, 12); assert.equal(c.groups.light.n, 12); assert.equal(c.groups.medium.n, 0);
  assert.equal(c.groups.deep.metrics.acne.falseReassurance, 1, 'toutes les acnés marquées sont jugées « bonnes » par le moteur'); assert.equal(c.groups.light.metrics.acne.falseReassurance, 0);
  assert.equal(c.groups.light.metrics.acne.sensitivity, 1); assert.equal(c.groups.light.metrics.acne.falseAlarm, 0);
  assert.ok(c.alerts.some(a => a.group === 'deep' && a.metric === 'acne' && /Teints 6 à 10/.test(a.text) && /100 %/.test(a.text)));
  assert.ok(!c.alerts.some(a => a.group === 'light'));
  assert.ok(c.groups.light.metrics.acne.spearman > 0.9, 'accord de rang élevé quand le moteur suit l\'humain');
  assert.deepEqual(L.groupOf(3) + L.groupOf(4) + L.groupOf(5) + L.groupOf(6), 'lightmediummediumdeep');
});

test('EV3 petit échantillon : « trop petit pour conclure », aucune alerte, aucun seuil suggéré', () => {
  const few = [item('A', 8, { acne: 3 }, { acne: 90 }), item('B', 8, { acne: 3 }, { acne: 95 })];
  const c = L.compare(few);
  assert.equal(c.groups.deep.reliable, false); assert.equal(c.groups.deep.metrics.acne.reliable, false); assert.deepEqual(c.alerts, []); assert.equal(c.groups.deep.metrics.acne.suggested, null);
  assert.equal(c.groups.deep.metrics.acne.falseReassurance, 1, 'le chiffre existe mais n\'est pas présenté comme fiable');
});

test('EV4 seuil SUGGÉRÉ : le raw_score qui sépare le mieux « sans signe » de « signe marqué » ; jamais appliqué', () => {
  const rows = []; for (let i = 0; i < 20; i++) rows.push(item('T' + i, 7, { acne: i < 10 ? 3 : 0 }, { acne: i < 10 ? 55 + i : 85 + (i % 5) }));
  const s = L.compare(rows).groups.deep.metrics.acne.suggested;
  assert.ok(s && s.cutoff >= 65 && s.cutoff <= 85 && s.balanced === 1, JSON.stringify(s));
  assert.equal(require('../js/engine/data/decision.js').RAW_BANDS[0].min, 50, 'decision.js n\'est pas modifié par l\'outil');
  assert.doesNotMatch(read('tools/eval/lib.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1'), /decision\.js|require\(|writeFile|fetch\(/);
});

test('EV5 ce que le moteur ne mesure pas : marques après bouton, boutons de rasage, cicatrices, aspect cendré ; évaluations à plusieurs : médiane et accord', () => {
  const a = item('A', 8, { acne: 2 }, { acne: 60 }); a.raters = { R1: { levels: { acne: 3 }, only: { postAcneMarks: true, scars: false } }, R2: { levels: { acne: 3 }, only: { postAcneMarks: true } } };
  const b = item('B', 8, { acne: 0 }, { acne: 80 }); b.raters = { R1: { levels: { acne: 0 }, only: { postAcneMarks: false } }, R2: { levels: { acne: 1 }, only: { postAcneMarks: false } } };
  const c = L.compare([a, b]);
  assert.deepEqual(c.humanOnly.deep.postAcneMarks, { n: 2, present: 1 }); assert.deepEqual(c.humanOnly.deep.scars, { n: 1, present: 0 });
  assert.equal(L.humanLevel(b.raters, 'acne'), 1, 'égalité : on arrondit vers le haut, un signe n\'est pas minimisé'); assert.equal(L.humanLevel({}, 'acne'), null);
  assert.deepEqual(L.interRater([a, b]), { total: 2, exact: 0.5 });
  assert.equal(L.interRater([item('Z', 7, { acne: 1 }, { acne: 50 })]), null);
  assert.deepEqual(Object.keys(L.HUMAN_ONLY_LABELS).sort(), [...L.HUMAN_ONLY].sort());
});

test('EV6 le score affiché n\'est jamais utilisé : seul le raw_score compte ; valeur hors plage ou absente = non comparée', () => {
  assert.equal(L.engineValue({ acne: { uiScore: 80 } }, 'acne'), null); assert.equal(L.engineValue({ acne: { rawScore: 101 } }, 'acne'), null);
  assert.equal(L.engineValue({ acne: { rawScore: 42.5 } }, 'acne'), 42.5); assert.equal(L.engineValue(null, 'acne'), null);
  const c = L.compare([item('X', 7, { acne: 3 }, {})]); assert.equal(c.groups.deep.metrics.acne.n, 0); assert.equal(c.groups.deep.metrics.acne.engineMissing, 1);
});

test('EV7 hors production et hors git : dossiers ignorés, exclus du déploiement, aucun lien depuis l\'application, aucun réseau sortant', () => {
  assert.match(read('.gitignore'), /^eval-data\/$/m); assert.match(read('.vercelignore'), /^tools\/eval$/m); assert.match(read('.vercelignore'), /^eval-data$/m);
  for (const f of ['index.html', 'sw.js', 'manifest.json', 'vercel.json']) assert.doesNotMatch(read(f), /tools\/eval|eval-data/, f + ' : aucun lien vers l\'outil');
  for (const f of fs.readdirSync(path.join(__dirname, '../js')).filter(x => x.endsWith('.js'))) assert.doesNotMatch(read('js/' + f), /tools\/eval|DermaiEval/, f);
  const page = read('tools/eval/page.js') + read('tools/eval/index.html');
  assert.doesNotMatch(page, /https?:\/\/(?!127\.0\.0\.1)/, 'aucune adresse externe'); assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML|document\.write/);
  const fetches = [...page.matchAll(/fetch\('([^']+)'/g)].map(m => m[1]); assert.ok(fetches.length >= 2 && fetches.every(u => u.startsWith('/')), fetches.join());
  assert.doesNotMatch(read('tools/eval/serve.js'), /require\('node:https?'\)\.(request|get)|fetch\(|https:\/\//);
  assert.match(read('tools/eval/README.md'), /Faites valider le formulaire de consentement/); assert.match(read('tools/eval/README.md'), /ignoré par git/);
  const tracked = require('node:child_process').execSync('git ls-files tools/eval', { cwd: path.join(__dirname, '..') }).toString().split('\n').filter(Boolean);
  assert.ok(!tracked.some(f => /\.(jpe?g|png|webp)$/i.test(f)), 'aucune photo suivie par git : ' + tracked.join());
});

/* ---- serveur local ---- */
const call = (srv, opts, body) => new Promise((resolve, reject) => {
  const port = srv.address().port, req = http.request(Object.assign({ host: '127.0.0.1', port, headers: { Host: '127.0.0.1:' + port } }, opts), res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch).toString('utf8') })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));

test('EV8 serveur local : hôte localhost seulement, pas de sortie de dossier, en-têtes de sécurité, données fictives en lecture seule', async () => {
  const srv = await listen(createServer({ sample: true }));
  try {
    const m = await call(srv, { path: '/api/manifest' }); const j = JSON.parse(m.body);
    assert.equal(m.status, 200); assert.equal(j.mode, 'sample'); assert.equal(j.readOnly, true); assert.equal(j.fictive, true); assert.match(j.note, /DONNÉES FICTIVES/);
    assert.ok(j.items.length >= 30 && j.items.every(i => !/\.(jpe?g|png)$/.test(JSON.stringify(i.engine))));
    assert.match(m.headers['content-security-policy'], /default-src 'self'/); assert.match(m.headers['content-security-policy'], /connect-src 'self'/); assert.equal(m.headers['x-robots-tag'], 'noindex, nofollow'); assert.equal(m.headers['cache-control'], 'no-store');
    assert.equal((await call(srv, { path: '/api/manifest', headers: { Host: 'evil.example.com' } })).status, 403, 'hôte étranger refusé (détournement de DNS)');
    assert.equal((await call(srv, { path: '/api/manifest', headers: { Host: '127.0.0.1:' + srv.address().port, Origin: 'https://evil.example.com' } })).status, 403);
    for (const p of ['/photos/../manifest.json', '/photos/..%2Fmanifest.json', '/photos/a.txt', '/api/../server.js', '/photos/']) assert.ok([403, 404].includes((await call(srv, { path: p })).status), p);
    assert.equal((await call(srv, { path: '/photos/absente.jpg' })).status, 404);
    assert.equal((await call(srv, { path: '/', method: 'GET' })).status, 200);
    assert.equal((await call(srv, { path: '/api/ratings', method: 'POST', headers: { Host: '127.0.0.1:' + srv.address().port, 'Content-Type': 'application/json' } }, '{}')).status, 403, 'données fictives : jamais d\'écriture');
  } finally { srv.close(); }
});

test('EV9 enregistrement d\'une évaluation : validée, écrite dans ratings.json seulement, refusée sans consentement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-eval-'));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ items: [item('P1', 7, {}, { acne: 70 }, { raters: {} }), Object.assign(item('P2', 7, {}, { acne: 70 }, { raters: {} }), { consent: undefined })] }));
  const srv = await listen(createServer({ dataDir: dir }));
  const post = b => call(srv, { path: '/api/ratings', method: 'POST', headers: { Host: '127.0.0.1:' + srv.address().port, 'Content-Type': 'application/json' } }, JSON.stringify(b));
  try {
    assert.equal((await post({ id: 'P1', rater: 'R1', levels: { acne: 3 }, only: { scars: true } })).status, 200);
    assert.equal((await post({ id: 'P2', rater: 'R1', levels: { acne: 3 } })).status, 403, 'sans consentement : rien d\'enregistré');
    assert.equal((await post({ id: 'P1', rater: 'R1', levels: { acne: 9 } })).status, 400); assert.equal((await post({ id: 'P1', rater: '../x', levels: {} })).status, 400);
    assert.equal((await post({ id: 'P1', rater: 'R1', levels: { acne: 1 }, only: { scars: 'oui' } })).status, 400); assert.equal((await post({ id: 'ZZ', rater: 'R1', levels: {} })).status, 404);
    const ratings = JSON.parse(fs.readFileSync(path.join(dir, 'ratings.json'), 'utf8')); assert.deepEqual(ratings, { P1: { R1: { levels: { acne: 3 }, only: { scars: true } } } });
    assert.ok(!('P2' in ratings)); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).items[0].raters && Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).items[0].raters).length, 0, 'le manifeste n\'est pas réécrit');
    const j = JSON.parse((await call(srv, { path: '/api/manifest' })).body); assert.equal(j.mode, 'local'); assert.equal(j.items[0].raters.R1.levels.acne, 3, 'évaluations fusionnées à la lecture');
    const big = await post({ id: 'P1', rater: 'R1', levels: { acne: 1 }, pad: 'x'.repeat(40000) }).catch(e => ({ status: 0, err: e.code })); assert.ok(big.status === 0 || big.status >= 400, 'corps trop gros refusé');
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

const OK = H.available();
test('EVB1 la page dans Chromium : données fictives signalées, évaluation à l\'aveugle, comparaison par groupe avec alerte, aucun appel externe', { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 }, async () => {
  const srv = await listen(createServer({ sample: true })), browser = await H.loadPlaywright().chromium.launch(), external = [], errors = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:' + srv.address().port)) external.push(r.url()); });
    await page.addInitScript(() => localStorage.setItem('dermai.eval.rater', 'R9'));   // une évaluatrice qui n'a encore rien évalué : le moteur reste caché
    await page.goto('http://127.0.0.1:' + srv.address().port + '/'); await page.waitForSelector('select[data-m]');
    const t = await page.locator('body').innerText();
    assert.match(t, /INTERNE/); assert.match(t, /DONNÉES FICTIVES/); assert.match(t, /Évaluation à l'aveugle/); assert.doesNotMatch(t, /Moteur \(raw_score\)/, 'le moteur est caché avant l\'évaluation');
    await page.getByRole('button', { name: 'Comparaison' }).click(); await page.waitForSelector('table');
    const c = await page.locator('main').innerText();
    assert.match(c, /Écarts à regarder \(fausse rassurance\)/); assert.match(c, /Teints 6 à 10/); assert.match(c, /exclue\(s\)/); assert.match(c, /jamais appliqué|JAMAIS appliqué/i);
    assert.deepEqual(external, [], 'aucune requête hors du serveur local'); assert.deepEqual(errors, []);
  } finally { await browser.close(); srv.close(); }
});
