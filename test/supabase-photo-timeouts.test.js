'use strict';
/* D2 : délais de la vérification de session, de la réservation du quota et de la lecture de la photo. Tout est local : Supabase est un faux en
   mémoire, la requête est un flux Node. Aucun réseau, aucune unité Perfect Corp.
   Les corps bloqués sont SIMULÉS APRÈS LES EN-TÊTES : fetch répond tout de suite (statut 200) et c'est res.text() qui ne se termine que si le
   signal d'interruption est levé. Un minuteur annulé dès les en-têtes (l'ancien code) laisserait donc ces tests échouer, pas passer. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mock } = require('node:test');
const { PassThrough, Readable } = require('node:stream');

process.env.DERMAI_ANALYSIS_ENABLED = '1';
process.env.SUPABASE_URL = 'https://demo.supabase.co'; process.env.SUPABASE_ANON_KEY = 'public-anon-key';
process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL'; process.env.DERMAI_MAX_ANALYSES_PER_PERIOD = '1000';

const auth = require('../server/auth');
const quota = require('../server/quota');
const pc = require('../server/perfectcorp');
const { readBody } = require('../server/validation');
const { createBudget, clock } = require('../server/budget');
const { TIME_BUDGET } = require('../server/config');
const { AnalysisError, toUserMessage } = require('../server/errors');
const handler = require('../api/skin-analysis.js');
const { createFake } = require('./helpers/fake-supabase.js');

const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/perfectcorp-json-response.json'), 'utf8'));
const authReq = () => ({ headers: { authorization: 'Bearer ' + TOKEN } });

/* Réseau INTERDIT pour tout le fichier : fetch global et téléchargement des masques sont des pièges qui comptent leurs appels (le test final D2-19 exige
   zéro). Aucun test ne doit atteindre un vrai service, pas même un domaine .invalid. Les tests qui ont besoin d'une réponse installent leur
   propre simulation et la retirent dans un finally. */
const masks = require('../server/masks');
const NET = { global: 0, masks: 0 };
globalThis.fetch = async () => { NET.global++; throw new Error('réseau interdit (test)'); };
const MASKS_TRAP = async () => { NET.masks++; throw new Error('réseau interdit (test)'); };
masks.api.fetchImpl = MASKS_TRAP;

const SB = createFake();
SB.users.set('t@exemple.com', { id: USER_ID, email: 't@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER_ID, exp: Number.MAX_SAFE_INTEGER });
const REAL_AUTH_FETCH = SB.fetch;
auth.api.fetchImpl = REAL_AUTH_FETCH;
let quotaCalls = 0;
quota.api.fetchImpl = (...a) => { quotaCalls++; return SB.fetch(...a); };
const REAL_QUOTA_FETCH = quota.api.fetchImpl;

/* ---------- simulations ---------- */
const abortError = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
/* Promesse qui ne se termine que par l'interruption du signal (jamais seule). */
const untilAbort = signal => new Promise((_, reject) => {
  if (signal.aborted) return reject(abortError());
  signal.addEventListener('abort', () => reject(abortError()));
});
/* Réponse dont les EN-TÊTES sont arrivés (statut) et dont le CORPS se bloque. */
const headersThenStall = (status = 200, counter = { n: 0 }) => (url, init) => {
  counter.n++;
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => untilAbort(init.signal) });
};
const withBody = (status, text, counter = { n: 0 }) => () => { counter.n++; return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => text }); };
const bodyFails = (counter = { n: 0 }) => () => { counter.n++; return Promise.resolve({ ok: true, status: 200, text: async () => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); } }); };
const within = (ms, p, label) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('BLOQUÉ : ' + label)), ms); })]).finally(() => clearTimeout(t)); };
const tick = () => new Promise(r => setImmediate(r));
const settle = async p => { const o = {}; p.then(v => { o.value = v; o.done = true; }, e => { o.error = e; o.done = true; }); for (let i = 0; i < 20; i++) await tick(); return o; };

async function withAuthFetch(impl, fn) { const s = auth.api.fetchImpl; auth.api.fetchImpl = impl; try { return await fn(); } finally { auth.api.fetchImpl = s; } }
async function withQuotaFetch(impl, fn) { const s = quota.api.fetchImpl; quota.api.fetchImpl = impl; try { return await fn(); } finally { quota.api.fetchImpl = s; } }
async function captureLogs(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { return [await fn(), lines]; } finally { Object.assign(console, o); }
}
const noLeak = lines => {
  const all = lines.join('\n');
  for (const secret of [TOKEN, 'TEST_ONLY_KEY_NOT_REAL', USER_ID, 't@exemple.com', 'public-anon-key', 'demo.supabase.co', 'https://']) assert.ok(!all.includes(secret), 'fuite : ' + secret);
};
async function withTotal(ms, fn) { const s = TIME_BUDGET.totalMs; TIME_BUDGET.totalMs = ms; try { return await fn(); } finally { TIME_BUDGET.totalMs = s; } }
async function withClock(fn) { let t = 1000; const s = clock.now; clock.now = () => t; try { return await fn({ advance: ms => { t += ms; } }); } finally { clock.now = s; } }
async function withAnalyze(impl, fn) {
  const orig = pc.analyzeSkin; let calls = 0;
  pc.analyzeSkin = async (...a) => { calls++; return impl(...a); };
  try { return await fn(() => calls); } finally { pc.analyzeSkin = orig; }
}

/* Requête de handler en flux, réponse comptée (jamais deux réponses). */
function makeReq(headers = {}) {
  const req = new PassThrough();
  req.method = 'POST'; req.headers = Object.assign({ authorization: 'Bearer ' + TOKEN, 'content-type': 'image/jpeg' }, headers);
  return req;
}
function run(req) {
  const out = { ends: 0, headers: {}, status: null, body: null };
  const done = new Promise(resolve => {
    const res = { setHeader(k, v) { out.headers[k] = v; }, end(b) { out.ends++; if (out.ends === 1) { out.status = this.statusCode; out.body = JSON.parse(b); out.destroyedAtResponse = req.destroyed; resolve(out); } } };
    handler(req, res);
  });
  return done;
}

/* =================== T1 : vérification de session =================== */

test('D2-1 session : le corps de la réponse se bloque APRÈS les en-têtes → interrompu par le budget (504), une seule requête', async () => {
  const c = { n: 0 };
  await withAuthFetch(headersThenStall(200, c), async () => {
    const budget = createBudget({ totalMs: 150 });
    const t0 = Date.now();
    await within(3000, assert.rejects(auth.verifyUser(authReq(), ENV, { budget }), e => e instanceof AnalysisError && e.code === 'TIME_BUDGET' && e.status === 504 && /lecture de la réponse/.test(e.detail)), 'auth.text()');
    assert.ok(Date.now() - t0 < 1500);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(c.n, 1, 'aucune nouvelle requête après expiration');
  });
});

test('D2-1b session : sans budget fourni, le plafond fixe de 5 s s\'applique aussi à la lecture du corps (503, jamais plus long)', async () => {
  const c = { n: 0 };
  await withAuthFetch(headersThenStall(200, c), async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = auth.verifyUser(authReq(), ENV);
      const o = {}; p.then(v => { o.done = true; o.value = v; }, e => { o.done = true; o.error = e; });
      await tick(); mock.timers.tick(4999); for (let i = 0; i < 10; i++) await tick();
      assert.ok(!o.done, 'pas d\'expiration avant 5 s');
      mock.timers.tick(1); for (let i = 0; i < 10; i++) await tick();
      assert.ok(o.done, 'corps toujours bloqué après 5 s : le minuteur n\'a pas couvert la lecture');
      assert.equal(o.error.code, 'AUTH_UNAVAILABLE'); assert.equal(o.error.status, 503);
      assert.equal(c.n, 1);
    } finally { mock.timers.reset(); }
  });
});

test('D2-2 session : un corps illisible ou un JSON invalide n\'est PAS une session invalide (503, pas 401)', async () => {
  for (const [label, impl] of [
    ['lecture du corps en échec (connexion coupée)', bodyFails()],
    ['corps non JSON (page d\'erreur)', withBody(200, '<html>502 Bad Gateway</html>')],
    ['corps vide', withBody(200, '')]
  ]) {
    await withAuthFetch(impl, async () => {
      await assert.rejects(auth.verifyUser(authReq(), ENV), e => { assert.equal(e.code, 'AUTH_UNAVAILABLE', label); assert.equal(e.status, 503, label); return true; });
    });
  }
  await withAuthFetch(async () => { throw new TypeError('network'); }, async () => {
    await assert.rejects(auth.verifyUser(authReq(), ENV), { code: 'AUTH_UNAVAILABLE', status: 503 });   // panne réseau : jamais une déconnexion certaine
  });
});

test('D2-3 session : une réponse LISIBLE indiquant une session invalide reste 401 AUTH_REQUIRED ; une réponse valide est acceptée', async () => {
  for (const [label, impl] of [
    ['statut 401', withBody(401, '{"msg":"invalid"}')],
    ['statut 403', withBody(403, '{}')],
    ['200 sans identifiant', withBody(200, '{}')],
    ['200 avec identifiant mal formé', withBody(200, '{"id":"pas un id !"}')],
    ['200 JSON null', withBody(200, 'null')]
  ]) {
    await withAuthFetch(impl, async () => {
      await assert.rejects(auth.verifyUser(authReq(), ENV), e => { assert.equal(e.code, 'AUTH_REQUIRED', label); assert.equal(e.status, 401, label); return true; });
    });
  }
  await withAuthFetch(withBody(500, 'boom'), async () => { await assert.rejects(auth.verifyUser(authReq(), ENV), { code: 'AUTH_UNAVAILABLE', status: 503 }); });
  await withAuthFetch(withBody(200, JSON.stringify({ id: USER_ID })), async () => { assert.deepEqual(await auth.verifyUser(authReq(), ENV, { budget: createBudget() }), { id: USER_ID }); });
});

test('D2-4 session via le handler : réponse illisible → 503 AUTH_UNAVAILABLE, aucun 401, aucun WWW-Authenticate, rien n\'est réservé', async () => {
  quotaCalls = 0;
  await withAuthFetch(bodyFails(), () => withAnalyze(async () => REAL, async calls => {
    const req = makeReq(); req.end(JPEG);
    const [r, lines] = await captureLogs(() => run(req));
    assert.equal(r.status, 503);
    assert.equal(r.body.error, toUserMessage('AUTH_UNAVAILABLE'));
    assert.equal(r.headers['WWW-Authenticate'], undefined);
    assert.equal(quotaCalls, 0); assert.equal(calls(), 0);
    noLeak(lines);
  }));
});

test('D2-5 session via le handler : corps bloqué et budget presque épuisé → 504 TIME_BUDGET contrôlé, une seule réponse', async () => {
  quotaCalls = 0;
  await withTotal(150, () => withAuthFetch(headersThenStall(), () => withAnalyze(async () => REAL, async calls => {
    const req = makeReq(); req.end(JPEG);
    const [r, lines] = await captureLogs(() => within(4000, run(req), 'handler/auth'));
    await new Promise(x => setTimeout(x, 100));
    assert.equal(r.status, 504); assert.equal(r.body.error, toUserMessage('TIME_BUDGET')); assert.equal(r.ends, 1);
    assert.equal(quotaCalls, 0); assert.equal(calls(), 0);
    noLeak(lines);
  })));
});

test('D2-6 navigateur : seul un 401 déconnecte ; un 503 ou un 504 affiche le message sans toucher à la session', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
  assert.equal((app.match(/authRequired:true/g) || []).length, 1);
  assert.match(app, /if\(x\.status===401\)return reject\(Object\.assign\(userError\(AUTH_NEEDED\),\{authRequired:true\}\)\)/);
  assert.match(app, /reject\(Object\.assign\(userError\(j&&typeof j\.error===`string`&&j\.error\?j\.error:[^\n]*\{noVerdict:nv\}\)\)/);   // tout autre statut : le message du serveur, sans authRequired (seul le drapeau d'issue incertaine s'y ajoute)
});

/* =================== T1 : réservation du quota =================== */

test('D2-7 quota : le corps de la réponse se bloque APRÈS les en-têtes → interrompu par le budget (504), une seule requête', async () => {
  const c = { n: 0 };
  await withQuotaFetch(headersThenStall(200, c), async () => {
    const budget = createBudget({ totalMs: 150 });
    const t0 = Date.now();
    await within(3000, assert.rejects(quota.reserve(TOKEN, ENV, { budget }), e => e.code === 'TIME_BUDGET' && e.status === 504 && /possiblement exécutée/.test(e.detail)), 'quota.text()');
    assert.ok(Date.now() - t0 < 1500);
    await new Promise(r => setTimeout(r, 200));
    assert.equal(c.n, 1, 'aucune nouvelle tentative (ni nouvelle réservation) après expiration');
  });
});

test('D2-7b quota : sans budget, plafond fixe de 5 s sur la lecture du corps (503 QUOTA_UNAVAILABLE), jamais plus long', async () => {
  const c = { n: 0 };
  await withQuotaFetch(headersThenStall(200, c), async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = quota.reserve(TOKEN, ENV);
      const o = {}; p.then(v => { o.done = true; o.value = v; }, e => { o.done = true; o.error = e; });
      await tick(); mock.timers.tick(4999); for (let i = 0; i < 10; i++) await tick();
      assert.ok(!o.done, 'pas d\'expiration avant 5 s');
      mock.timers.tick(1); for (let i = 0; i < 10; i++) await tick();
      assert.ok(o.done, 'corps toujours bloqué après 5 s');
      assert.equal(o.error.code, 'QUOTA_UNAVAILABLE'); assert.equal(o.error.status, 503);
      assert.equal(c.n, 1);
    } finally { mock.timers.reset(); }
  });
});

test('D2-8 quota : comportements existants préservés (réponse normale, refus, panne, corps illisible)', async () => {
  await withQuotaFetch(withBody(200, '{"ok":true,"used":2}'), async () => { assert.deepEqual(await quota.reserve(TOKEN, ENV, { budget: createBudget() }), { used: 2, limit: 3 }); });
  await withQuotaFetch(withBody(200, '{"ok":false,"retry_after":120}'), async () => { await assert.rejects(quota.reserve(TOKEN, ENV), e => e.code === 'QUOTA_EXCEEDED' && e.status === 429 && e.retryAfter === 120); });
  await withQuotaFetch(withBody(401, ''), async () => { await assert.rejects(quota.reserve(TOKEN, ENV), { code: 'AUTH_REQUIRED', status: 401 }); });
  await withQuotaFetch(withBody(404, 'x'), async () => { await assert.rejects(quota.reserve(TOKEN, ENV), { code: 'QUOTA_UNAVAILABLE', status: 503 }); });
  await withQuotaFetch(withBody(200, '<html>'), async () => { await assert.rejects(quota.reserve(TOKEN, ENV), { code: 'QUOTA_UNAVAILABLE', status: 503 }); });
  await withQuotaFetch(bodyFails(), async () => { await assert.rejects(quota.reserve(TOKEN, ENV), { code: 'QUOTA_UNAVAILABLE', status: 503 }); });
  await withQuotaFetch(async () => { throw new TypeError('network'); }, async () => { await assert.rejects(quota.reserve(TOKEN, ENV), { code: 'QUOTA_UNAVAILABLE', status: 503 }); });
  assert.equal(quota.TIMEOUT_MS, 5000);   // le délai maximal n'a pas été allongé
});

test('D2-9 quota via le handler : corps bloqué → interrompu à 5 s, 503 contrôlé, aucune analyse lancée, une seule réponse', async () => {
  let reached = false;
  await withQuotaFetch((url, init) => { reached = true; return headersThenStall()(url, init); }, () => withAnalyze(async () => REAL, async calls => {
    mock.timers.enable({ apis: ['setTimeout'] });   // setTimeout simulé : aucun garde-fou fondé sur setTimeout ne peut fonctionner ici, seulement tick()
    try {
      const req = makeReq(); req.end(JPEG);
      const [r, lines] = await captureLogs(async () => {
        const p = run(req);
        const o = {}; p.then(v => { o.done = true; o.value = v; });
        for (let i = 0; i < 200 && !reached; i++) await tick();
        assert.ok(reached, 'le handler n\'a pas atteint la réservation');
        mock.timers.tick(4999); for (let i = 0; i < 20; i++) await tick();
        assert.ok(!o.done, 'aucune réponse avant 5 s : le plafond n\'est pas raccourci');
        mock.timers.tick(1);
        for (let i = 0; i < 100 && !o.done; i++) await tick();                       // attente bornée par itérations, pas par minuteur
        assert.ok(o.done, 'le handler attend encore le corps de la réponse du quota après 5 s : interruption manquante');
        return o.value;
      });
      for (let i = 0; i < 10; i++) await tick();
      assert.equal(r.status, 503); assert.equal(r.body.error, toUserMessage('QUOTA_UNAVAILABLE')); assert.equal(r.ends, 1);
      assert.equal(calls(), 0);
      noLeak(lines);
    } finally { mock.timers.reset(); }
  }));
});

/* =================== T3 : lecture de la photo =================== */

test('D2-10 photo : un flux qui ne se termine pas est interrompu au terme du délai (TIME_BUDGET 504), sans détruire la connexion', async () => {
  const req = new PassThrough(); req.headers = {};
  req.write(JPEG);   // quelques octets arrivent, puis plus rien
  const t0 = Date.now();
  await within(3000, assert.rejects(readBody(req, undefined, { timeoutMs: 80 }), e => e.code === 'TIME_BUDGET' && e.status === 504 && /8 octets reçus/.test(e.detail)), 'readBody');
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(req.destroyed, false, 'la connexion n\'est pas détruite : la réponse d\'erreur doit pouvoir partir');
  assert.equal(req.listenerCount('data'), 0);
  assert.doesNotThrow(() => req.write(Buffer.alloc(10)));                       // la suite de l'envoi est écartée sans effet
  assert.doesNotThrow(() => req.emit('error', new Error('erreur tardive')));   // jamais d'exception non gérée après l'issue
});

test('D2-11 photo : flux interrompu par le client (fermeture, coupure) → UPLOAD_INTERRUPTED 400, sans exception non gérée', async () => {
  const closed = new PassThrough(); closed.headers = {}; closed.write(JPEG);
  const p1 = readBody(closed, undefined, { timeoutMs: 5000 });
  closed.destroy();                                                             // fermeture sans 'end'
  await within(2000, assert.rejects(p1, { code: 'UPLOAD_INTERRUPTED', status: 400 }), 'close');

  const reset = new PassThrough(); reset.headers = {}; reset.write(JPEG);
  const p2 = readBody(reset);
  reset.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));   // ce que Node émet quand le client coupe
  await within(2000, assert.rejects(p2, { code: 'UPLOAD_INTERRUPTED', status: 400 }), 'ECONNRESET');
  assert.doesNotThrow(() => reset.emit('error', new Error('encore')));

  const odd = new PassThrough(); odd.headers = {};
  const p3 = readBody(odd);
  odd.destroy(new Error('erreur inattendue'));
  await within(2000, assert.rejects(p3, { code: 'UNKNOWN' }), 'erreur');   // comportement d'origine conservé
});

test('D2-12 photo : sans temps disponible, la photo n\'est même pas lue ; nominal, limite de taille et signature inchangés', async () => {
  const idle = new PassThrough(); idle.headers = {};
  await assert.rejects(readBody(idle, undefined, { timeoutMs: 0 }), { code: 'TIME_BUDGET', status: 504 });
  assert.equal(idle.listenerCount('data'), 0);

  const ok = Readable.from([JPEG]); ok.headers = {};
  assert.deepEqual(await readBody(ok, undefined, { timeoutMs: 5000 }), JPEG);
  const old = Readable.from([JPEG]); old.headers = {};
  assert.deepEqual(await readBody(old), JPEG);                                  // ancien appel sans option

  const big = Readable.from([Buffer.alloc(3000), Buffer.alloc(3000)]); big.headers = {};
  await assert.rejects(readBody(big, 4000, { timeoutMs: 5000 }), { code: 'TOO_LARGE', status: 413 });
  const declared = Readable.from([JPEG]); declared.headers = { 'content-length': String(5 * 1024 * 1024) };
  await assert.rejects(readBody(declared, undefined, { timeoutMs: 5000 }), { code: 'TOO_LARGE', status: 413 });
});

test('D2-13 handler : photo qui ne se termine pas → 504 TIME_BUDGET à l\'échéance, connexion vivante, UNE réponse, aucun crédit réservé', async () => {
  quotaCalls = 0;
  const total = TIME_BUDGET.minStartMs + quota.TIMEOUT_MS + 120;   // fenêtre de lecture d'environ 120 ms
  await withTotal(total, () => withAnalyze(async () => REAL, async calls => {
    const req = makeReq(); req.write(JPEG);                          // jamais de fin
    const [r, lines] = await captureLogs(() => within(4000, run(req), 'handler/photo'));
    await new Promise(x => setTimeout(x, 150));
    assert.equal(r.status, 504); assert.equal(r.body.error, toUserMessage('TIME_BUDGET'));
    assert.equal(r.ends, 1, 'une seule réponse HTTP');
    assert.equal(r.destroyedAtResponse, false, 'la connexion était encore ouverte quand la réponse est partie');
    assert.equal(quotaCalls, 0, 'aucune réservation : la photo n\'a jamais été lue en entier');
    assert.equal(calls(), 0);
    assert.ok(lines.some(l => /TIME_BUDGET/.test(l)));
    noLeak(lines);
  }));
});

test('D2-14 handler : client qui coupe pendant l\'envoi → 400 UPLOAD_INTERRUPTED, UNE réponse, aucun crédit réservé, rien de non géré', async () => {
  quotaCalls = 0;
  await withAnalyze(async () => REAL, async calls => {
    const req = makeReq(); req.write(JPEG);
    const p = run(req);
    setImmediate(() => req.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })));
    const [r, lines] = await captureLogs(() => within(3000, p, 'handler/coupure'));
    await new Promise(x => setTimeout(x, 100));
    assert.equal(r.status, 400); assert.equal(r.body.error, toUserMessage('UPLOAD_INTERRUPTED')); assert.equal(r.ends, 1);
    assert.equal(quotaCalls, 0); assert.equal(calls(), 0);
    noLeak(lines);
  });
});

test('D2-15 handler : budget déjà consommé avant la lecture (session lente) → 504 sans lire la photo ni réserver', async () => {
  quotaCalls = 0;
  await withClock(async time => {
    await withAuthFetch(async (...a) => { time.advance(TIME_BUDGET.totalMs - (TIME_BUDGET.minStartMs + quota.TIMEOUT_MS) + 500); return REAL_AUTH_FETCH(...a); }, () => withAnalyze(async () => REAL, async calls => {
      const req = makeReq(); req.end(JPEG);
      const [r, lines] = await captureLogs(() => run(req));
      assert.equal(r.status, 504); assert.equal(r.body.error, toUserMessage('TIME_BUDGET'));
      assert.equal(req.listenerCount('data'), 0, 'la photo n\'a pas été lue');
      assert.equal(quotaCalls, 0); assert.equal(calls(), 0);
      noLeak(lines);
    }));
  });
});

test('D2-16 handler : parcours nominal inchangé (session, photo, quota, analyse simulée, masques SIMULÉS, résultat)', async () => {
  quotaCalls = 0;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  let downloads = 0;
  const simulated = async url => {
    downloads++;
    assert.match(String(url), /^https:\/\/example\.invalid\//);   // la fixture : adresses factices, jamais contactées
    return { ok: true, status: 200, url: String(url), headers: { get: () => String(PNG.length) }, arrayBuffer: async () => PNG };
  };
  masks.api.fetchImpl = simulated;
  try {
    await withAnalyze(async () => REAL, async calls => {
      const req = makeReq(); req.end(JPEG);
      const [r, lines] = await captureLogs(() => run(req));
      assert.equal(r.status, 200); assert.equal(r.body.ok, true);
      assert.ok(r.body.result && r.body.result.normalized && r.body.result.normalized.acne);
      assert.ok(downloads > 0, 'les masques ont été « téléchargés » par la simulation');
      assert.ok(r.body.localization && Object.keys(r.body.localization).length > 0);
      assert.equal(quotaCalls, 1); assert.equal(calls(), 1);
      noLeak(lines);
    });
  } finally { masks.api.fetchImpl = MASKS_TRAP; }
  assert.equal(NET.masks + NET.global, 0, 'aucune tentative réseau réelle');
});

test('D2-17 source : la lecture de la photo est bornée par le seuil du quota, le budget est transmis à la session et à la réservation', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'api/skin-analysis.js'), 'utf8');
  assert.match(src, /readWindowMs = budget\.remaining\(\) - \(TIME_BUDGET\.minStartMs \+ quota\.TIMEOUT_MS\)/);
  assert.match(src, /auth\.verifyUser\(req, process\.env, \{ budget \}\)/);
  assert.match(src, /quota\.reserve\(auth\.bearerToken\(req\), process\.env, \{ budget \}\)/);
  assert.ok(src.indexOf('readBody(req, undefined') < src.indexOf('validateImage(') && src.indexOf('validateImage(') < src.indexOf('quota.reserve('));
});

test('D2-18 aucune nouvelle tentative automatique dans la session, le quota ni la lecture de la photo', () => {
  for (const f of ['server/auth.js', 'server/quota.js', 'server/validation.js']) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /retry(?!After|_after)|attempt|for \(let i|while \(|setInterval/i, f);
  }
});

/* =================== R-3 : budget épuisé = aucune requête émise =================== */

test('D2-20 session et quota : budget déjà épuisé → TIME_BUDGET 504 sans AUCUNE requête (ni contrôleur, ni minuteur créés)', async () => {
  const exhausted = () => { let t = 0; const b = createBudget({ totalMs: 100, now: () => t }); t = 1000; return b; };
  const timers = mock.method(globalThis, 'setTimeout');   // compte les minuteurs réellement posés
  try {
    const ca = { n: 0 };
    await withAuthFetch(withBody(200, JSON.stringify({ id: USER_ID }), ca), async () => {
      await assert.rejects(auth.verifyUser(authReq(), ENV, { budget: exhausted() }), e => e.code === 'TIME_BUDGET' && e.status === 504 && /auth : budget de temps épuisé avant émission/.test(e.detail));
    });
    const cq = { n: 0 };
    await withQuotaFetch(withBody(200, '{"ok":true,"used":1}', cq), async () => {
      await assert.rejects(quota.reserve(TOKEN, ENV, { budget: exhausted() }), e => e.code === 'TIME_BUDGET' && e.status === 504 && /quota : budget de temps épuisé avant émission/.test(e.detail));
    });
    assert.equal(ca.n, 0, 'aucune requête d\'authentification émise');
    assert.equal(cq.n, 0, 'aucune réservation émise');
    assert.equal(timers.mock.callCount(), 0, 'aucun minuteur posé');
  } finally { timers.mock.restore(); }
});

test('D2-21 budget suffisant ou absent : session et quota fonctionnent comme avant (une requête chacun)', async () => {
  const ca = { n: 0 }, cq = { n: 0 };
  await withAuthFetch(withBody(200, JSON.stringify({ id: USER_ID }), ca), async () => {
    assert.deepEqual(await auth.verifyUser(authReq(), ENV, { budget: createBudget() }), { id: USER_ID });
    assert.deepEqual(await auth.verifyUser(authReq(), ENV), { id: USER_ID });
  });
  await withQuotaFetch(withBody(200, '{"ok":true,"used":1}', cq), async () => {
    assert.deepEqual(await quota.reserve(TOKEN, ENV, { budget: createBudget() }), { used: 1, limit: 3 });
    assert.deepEqual(await quota.reserve(TOKEN, ENV), { used: 1, limit: 3 });
  });
  assert.equal(ca.n, 2); assert.equal(cq.n, 2);
});

/* =================== R-4 : requête déjà détruite =================== */

const later = async (n = 2) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };   // laisse passer les événements différés du flux

test('D2-22 photo : requête déjà détruite (fermeture DÉJÀ passée) → UPLOAD_INTERRUPTED immédiat, sans attendre la fenêtre, sans exception non gérée', async () => {
  /* Cas décisif : 'close' (et 'error') ont déjà été émis quand readBody est appelé. Sans détection à l'entrée, aucun événement ne viendrait plus
     et la lecture attendrait toute la fenêtre. */
  const closed = new PassThrough(); closed.headers = {}; closed.destroy();
  await later();
  const errored = new PassThrough(); errored.headers = {}; errored.on('error', () => {});   // écouteur du serveur HTTP, ici celui du test
  errored.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
  await later();
  for (const [label, req] of [['fermée', closed], ['en erreur', errored]]) {
    const t0 = Date.now();
    await within(2000, assert.rejects(readBody(req, undefined, { timeoutMs: 5000 }), { code: 'UPLOAD_INTERRUPTED', status: 400 }), 'requête détruite ' + label);
    assert.ok(Date.now() - t0 < 500, 'refus immédiat (' + label + '), pas après 5 s');
    assert.equal(req.listenerCount('data'), 0);
  }
  /* Destruction avec erreur dans le même tour : l'événement 'error' n'est pas encore parti quand readBody est appelé ; il ne doit rien faire tomber. */
  const fresh = new PassThrough(); fresh.headers = {};
  fresh.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
  await within(2000, assert.rejects(readBody(fresh, undefined, { timeoutMs: 5000 }), { code: 'UPLOAD_INTERRUPTED', status: 400 }), 'même tour');
  await later();
  /* La taille annoncée reste jugée en premier ; une requête saine n'est pas touchée. */
  const big = new PassThrough(); big.headers = { 'content-length': String(5 * 1024 * 1024) }; big.destroy();
  await assert.rejects(readBody(big, undefined, { timeoutMs: 1000 }), { code: 'TOO_LARGE', status: 413 });
  const ok = Readable.from([JPEG]); ok.headers = {};
  assert.deepEqual(await readBody(ok, undefined, { timeoutMs: 5000 }), JPEG);
});

test('D2-23 handler : le client part pendant la vérification de session → 400 immédiat, UNE réponse, aucun crédit réservé', async () => {
  quotaCalls = 0;
  const req = makeReq(); req.write(JPEG);
  await withAuthFetch(async (...a) => { req.destroy(); await later(); return REAL_AUTH_FETCH(...a); }, () => withAnalyze(async () => REAL, async calls => {
    const t0 = Date.now();
    const [r, lines] = await captureLogs(() => within(3000, run(req), 'handler/requête détruite'));
    await new Promise(x => setTimeout(x, 100));
    assert.ok(Date.now() - t0 < 1500, 'pas d\'attente de la fenêtre de lecture (environ 32 s)');
    assert.equal(r.status, 400); assert.equal(r.body.error, toUserMessage('UPLOAD_INTERRUPTED')); assert.equal(r.ends, 1);
    assert.equal(quotaCalls, 0); assert.equal(calls(), 0);
    noLeak(lines);
  }));
});

/* =================== Réseau : zéro tentative dans tout le fichier (doit rester le DERNIER test) =================== */

test('D2-19 aucune tentative réseau réelle dans tout ce fichier (fetch global, masques) : compteurs à zéro', () => {
  assert.equal(NET.global, 0, 'fetch global appelé');
  assert.equal(NET.masks, 0, 'téléchargement de masque non simulé appelé');
});
