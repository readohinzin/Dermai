'use strict';
/* Test d'intégration HTTP LOCAL avec une VRAIE http.IncomingMessage (et non un flux de test) : le vrai handler api/skin-analysis.js reçoit de vraies
   requêtes d'un serveur node:http lié à 127.0.0.1 sur un port éphémère. Supabase est un faux en mémoire, Perfect Corp est remplacé par une fonction
   locale, aucun masque n'est téléchargé. Aucun nom de domaine, aucune résolution DNS, aucun service externe, aucune unité Perfect Corp.
   Il vérifie ce que les flux de test (PassThrough) ne peuvent pas prouver : sur une vraie requête, 'end' précède 'close' (pas de faux
   UPLOAD_INTERRUPTED), et une coupure du client, une lecture incomplète ou un dépassement de taille se comportent comme prévu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const dns = require('node:dns');

process.env.DERMAI_ANALYSIS_ENABLED = '1';
process.env.SUPABASE_URL = 'https://demo.supabase.co'; process.env.SUPABASE_ANON_KEY = 'public-anon-key';
process.env.PERFECT_CORP_API_KEY = 'TEST_ONLY_KEY_NOT_REAL'; process.env.DERMAI_MAX_ANALYSES_PER_PERIOD = '1000';

const auth = require('../server/auth');
const quota = require('../server/quota');
const pc = require('../server/perfectcorp');
const masks = require('../server/masks');
const { TIME_BUDGET, IMAGE } = require('../server/config');
const { toUserMessage } = require('../server/errors');
const handler = require('../api/skin-analysis.js');
const { createFake } = require('./helpers/fake-supabase.js');

const TOKEN = 'aaaaaaaa.bbbbbbbb.cccccccc';
const USER_ID = '11111111-1111-4111-8111-111111111111';

/* Tout appel externe est un échec explicite : fetch global, téléchargement de masque, résolution DNS. Les compteurs sont vérifiés par le dernier test. */
const NET = { fetch: 0, masks: 0, dns: 0 };
const ORIGINAL = { fetch: globalThis.fetch, masks: masks.api.fetchImpl, authFetch: auth.api.fetchImpl, quotaFetch: quota.api.fetchImpl };
globalThis.fetch = async () => { NET.fetch++; throw new Error('réseau externe interdit (test)'); };
masks.api.fetchImpl = async () => { NET.masks++; throw new Error('réseau externe interdit (test)'); };
/* Node appelle dns.lookup même pour une adresse IP littérale (il la renvoie aussitôt, sans requête réseau) : seul un NOM DE DOMAINE est interdit. */
const realLookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (net.isIP(String(hostname)) === 0) { NET.dns++; throw new Error('résolution DNS interdite (test) : ' + hostname); }
  return realLookup.call(this, hostname, ...rest);
};
test.after(() => { dns.lookup = realLookup; globalThis.fetch = ORIGINAL.fetch; masks.api.fetchImpl = ORIGINAL.masks; auth.api.fetchImpl = ORIGINAL.authFetch; quota.api.fetchImpl = ORIGINAL.quotaFetch; });   // tout est restauré en fin de fichier

const SB = createFake();
SB.users.set('t@exemple.com', { id: USER_ID, email: 't@exemple.com', password: 'x', confirmed: true });
SB.tokens.set(TOKEN, { sub: USER_ID, exp: Number.MAX_SAFE_INTEGER });
auth.api.fetchImpl = SB.fetch;
let quotaCalls = 0;
quota.api.fetchImpl = (...a) => { quotaCalls++; return SB.fetch(...a); };

/* Résultat « Perfect Corp » simulé : la fixture, sans adresses de masques (le téléchargement n'est donc jamais sollicité). */
const ENVELOPE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/perfectcorp-json-response.json'), 'utf8'));
ENVELOPE.data.results.output.forEach(e => { delete e.mask_urls; });

/* Image de test : signature JPEG valide puis octets reconnaissables (le contenu reçu est comparé octet par octet). */
function makeJpeg(size) {
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + 7) & 0xff;
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  return b;
}

/* ---------- outillage ---------- */
const deadline = (ms, label, p) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('ÉCHÉANCE DÉPASSÉE : ' + label)), ms); })]).finally(() => clearTimeout(t)); };
const turn = () => new Promise(r => setImmediate(r));
/* Attend une condition par tours de boucle d'événements, bornée en durée : jamais d'attente indéfinie. */
async function until(cond, label, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('CONDITION JAMAIS ATTEINTE : ' + label); await turn(); }
}
const timers = () => process.getActiveResourcesInfo().filter(x => x === 'Timeout').length;

async function captureLogs(fn) {
  const lines = []; const o = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { return [await fn(), lines]; } finally { Object.assign(console, o); }
}
/* Écouteurs temporaires : toute exception ou rejet non géré pendant un scénario est consigné puis les écouteurs sont retirés. */
function guardProcess() {
  const events = [];
  const onRej = e => events.push('unhandledRejection: ' + (e && e.message || e));
  const onExc = e => events.push('uncaughtException: ' + (e && e.message || e));
  process.on('unhandledRejection', onRej); process.on('uncaughtException', onExc);
  return { events, restore: () => { process.off('unhandledRejection', onRej); process.off('uncaughtException', onExc); } };
}
async function withTotal(ms, fn) { const s = TIME_BUDGET.totalMs; TIME_BUDGET.totalMs = ms; try { return await fn(); } finally { TIME_BUDGET.totalMs = s; } }
/* analyzeSkin simulé : mémorise l'image reçue, ne contacte rien. */
async function withAnalyze(fn) {
  const orig = pc.analyzeSkin; const seen = { calls: 0, image: null };
  pc.analyzeSkin = async image => { seen.calls++; seen.image = image; return ENVELOPE; };
  try { return await fn(seen); } finally { pc.analyzeSkin = orig; }
}

/* Serveur HTTP local : le VRAI handler reçoit la VRAIE IncomingMessage. Chaque requête est consignée (événements, nombre de réponses). */
const ADDRESSES = new Set();
async function withServer(fn) {
  const reqs = [], sockets = new Set();
  const server = http.createServer((req, res) => {
    const r = { req, res, events: [], ends: 0, handlerError: null,
      real: req instanceof http.IncomingMessage && req.socket instanceof net.Socket, ctor: req.constructor.name, remote: req.socket.remoteAddress };
    ADDRESSES.add(r.remote);
    for (const ev of ['end', 'close', 'aborted']) req.on(ev, () => r.events.push(ev));   // jamais 'data' ni 'error' : ils changeraient le comportement observé
    const end = res.end.bind(res); res.end = (...a) => { r.ends++; return end(...a); };
    r.done = handler(req, res).then(() => 'réglé', e => { r.handlerError = e; return 'rejeté'; });
    reqs.push(r);
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((ok, ko) => { server.once('error', ko); server.listen(0, '127.0.0.1', ok); });
  const timersBefore = timers();
  try {
    return await fn({ port: server.address().port, reqs, sockets });
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    for (let i = 0; i < 20 && sockets.size; i++) await turn();
    assert.equal(server.listening, false, 'serveur fermé');
    assert.equal(sockets.size, 0, 'aucune socket ouverte après fermeture');
    for (let i = 0; i < 20 && timers() > timersBefore; i++) await turn();
    assert.ok(timers() <= timersBefore, `fuite de minuteur : ${timers()} actifs contre ${timersBefore} avant le serveur`);
  }
}

/* Client HTTP local (127.0.0.1, port éphémère, connexion dédiée). */
function client(port, headers) {
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/skin-analysis', agent: false,
    headers: Object.assign({ authorization: 'Bearer ' + TOKEN, 'content-type': 'image/jpeg' }, headers) });
  const c = { req, error: null, socketClosed: false };
  c.response = new Promise(resolve => {
    req.on('response', res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => { let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch (e) { /* corps non JSON */ } resolve({ status: res.statusCode, body, headers: res.headers, socketOpen: !req.socket.destroyed }); });
      res.on('error', () => resolve(null));
    });
    req.on('error', e => { c.error = e; resolve(null); });
  });
  c.closed = new Promise(r => req.on('close', () => { c.socketClosed = true; r(); }));
  return c;
}
/* Écriture client bornée : le serveur peut avoir répondu puis fermé la connexion ; le rappel d'écriture ne viendrait alors peut-être jamais. On sort aussi sur
   'close' et 'error' de la requête cliente, et par une échéance. Renvoie l'erreur d'écriture éventuelle (jamais d'attente indéfinie). */
const write = (req, chunk) => deadline(3000, 'écriture client', new Promise(resolve => {
  const finish = err => { req.off('close', onClose); req.off('error', finish); resolve(err || null); };
  const onClose = () => finish(null);
  req.once('close', onClose); req.once('error', finish);
  req.write(chunk, err => finish(err));
}));

/* =================== A : requête nominale complète =================== */

test('HTTP-A requête complète : le corps est lu en entier sur une vraie IncomingMessage, réponse 200, aucun UPLOAD_INTERRUPTED', async () => {
  const guard = guardProcess();
  quotaCalls = 0;
  try {
    const image = makeJpeg(300 * 1024);   // plusieurs segments TCP
    await withAnalyze(seen => withServer(async ({ port, reqs }) => {
      const [out, lines] = await captureLogs(async () => {
        const c = client(port, { 'content-length': String(image.length) });
        c.req.end(image);
        const r = await deadline(8000, 'A/réponse', c.response);
        await deadline(3000, 'A/handler', reqs[0].done);
        await deadline(3000, 'A/fermeture client', c.closed);
        return r;
      });
      const r0 = reqs[0];
      assert.equal(r0.real, true, 'la requête est une http.IncomingMessage liée à une vraie socket TCP');
      assert.equal(r0.ctor, 'IncomingMessage');
      assert.equal(r0.remote, '127.0.0.1');
      assert.equal(out.status, 200); assert.equal(out.body.ok, true);
      assert.ok(out.body.result.normalized.acne, 'résultat normalisé attendu');
      assert.equal(out.body.localization, undefined, 'aucun masque');
      assert.equal(seen.calls, 1);
      assert.equal(seen.image.buffer.length, image.length, 'corps lu intégralement');
      assert.ok(seen.image.buffer.equals(image), 'octets identiques à ceux envoyés');
      assert.equal(quotaCalls, 1, 'une seule réservation, après la lecture complète');
      assert.equal(r0.ends, 1, 'une seule réponse');
      assert.ok(r0.events.includes('end'), 'end émis sur la vraie requête');
      assert.ok(!r0.events.includes('aborted'));
      if (r0.events.includes('close')) assert.ok(r0.events.indexOf('end') < r0.events.indexOf('close'), 'end précède close : ' + r0.events.join(','));
      assert.ok(!lines.some(l => /UPLOAD_INTERRUPTED/.test(l)));
      assert.ok(!JSON.stringify(out.body).includes('interrompu'));
    }));
    await turn(); await turn();
    assert.deepEqual(guard.events, []);
  } finally { guard.restore(); }
});

/* =================== B : envoi interrompu pendant la lecture =================== */

test('HTTP-B coupure réelle du client pendant la lecture : traitement réglé une fois, aucun crédit réservé, aucune exception non gérée', async () => {
  const guard = guardProcess();
  quotaCalls = 0;
  try {
    await withAnalyze(seen => withServer(async ({ port, reqs }) => {
      const [, lines] = await captureLogs(async () => {
        const c = client(port, { 'content-length': '5000' });
        c.req.flushHeaders();
        await write(c.req, makeJpeg(1000));                                            // en-têtes + 1000 octets sur 5000
        await until(() => reqs.length === 1 && reqs[0].req.socket.bytesRead >= 1100, 'B/octets reçus par le serveur');
        await until(() => true, 'B/tour');
        c.req.destroy();                                                               // coupure RÉELLE de la connexion cliente
        await deadline(3000, 'B/fermeture client', c.closed);
        assert.equal(await deadline(3000, 'B/handler', reqs[0].done), 'réglé');
        return null;
      });
      const r0 = reqs[0];
      assert.equal(r0.real, true);
      assert.equal(r0.ends, 1, 'le handler a terminé son traitement une seule fois');
      assert.equal(r0.handlerError, null);
      assert.ok(r0.events.includes('close'), 'close émis sur la vraie requête interrompue : ' + r0.events.join(','));
      assert.ok(!r0.events.includes('end'), 'end jamais émis : le corps était incomplet');
      assert.ok(lines.some(l => /Skin analysis started/.test(l)), 'le traitement avait bien commencé la lecture');
      assert.ok(lines.some(l => /UPLOAD_INTERRUPTED/.test(l)), 'issue : UPLOAD_INTERRUPTED');
      assert.equal(quotaCalls, 0, 'aucune réservation');
      assert.equal(seen.calls, 0, 'aucune analyse');
    }));
    await turn(); await turn();
    assert.deepEqual(guard.events, [], 'aucune exception ni rejet non gérés');
  } finally { guard.restore(); }
});

/* =================== C : corps incomplet, connexion ouverte, fenêtre courte =================== */

test('HTTP-C corps incomplet, connexion ouverte : 504 TIME_BUDGET reçu par le client, réglé une fois, aucune réservation, ni minuteur ni socket qui fuit', async () => {
  const guard = guardProcess();
  quotaCalls = 0;
  try {
    /* Fenêtre de lecture d'environ 300 ms, par le mécanisme de budget EXISTANT : budget total = seuils de production + 300 ms (aucun seuil modifié). */
    const total = TIME_BUDGET.minStartMs + quota.TIMEOUT_MS + 300;
    await withTotal(total, () => withAnalyze(seen => withServer(async ({ port, reqs }) => {
      const image = makeJpeg(20000);
      const [out, lines] = await captureLogs(async () => {
        const c = client(port, { 'content-length': String(image.length) });
        c.req.flushHeaders();
        await write(c.req, image.subarray(0, 5000));                                   // le reste n'arrive pas : connexion laissée ouverte
        const r = await deadline(5000, 'C/réponse 504', c.response);
        assert.equal(r.socketOpen, true, 'la connexion cliente est encore ouverte quand la réponse arrive');
        await write(c.req, image.subarray(5000));                                      // la suite de l'envoi est écartée sans dommage
        c.req.end();
        await deadline(4000, 'C/fermeture client', c.closed);
        await deadline(3000, 'C/handler', reqs[0].done);
        assert.equal(c.error, null, 'aucune erreur côté client');
        return r;
      });
      const r0 = reqs[0];
      assert.equal(r0.real, true);
      assert.equal(out.status, 504);
      assert.equal(out.body.error, toUserMessage('TIME_BUDGET'));
      assert.equal(r0.ends, 1, 'réglé une seule fois');
      assert.equal(r0.handlerError, null);
      assert.equal(quotaCalls, 0, 'aucune réservation avant la validation complète du corps');
      assert.equal(seen.calls, 0);
      assert.ok(lines.some(l => /TIME_BUDGET/.test(l) && /lecture de la photo/.test(l)), 'échéance de lecture journalisée');
    })));
    await turn(); await turn();
    assert.deepEqual(guard.events, []);
  } finally { guard.restore(); }
});

/* =================== D : dépassement de taille (observation du comportement existant) =================== */

test('HTTP-D dépassement de taille sans Content-Length : observation de ce que le client reçoit réellement (comportement existant, non modifié)', async t => {
  const guard = guardProcess();
  quotaCalls = 0;
  try {
    await withAnalyze(seen => withServer(async ({ port, reqs }) => {
      const [outcome] = await captureLogs(async () => {
        const c = client(port, {});                                                    // pas de content-length : envoi par morceaux (chunked)
        const piece = makeJpeg(256 * 1024);
        let sent = 0;
        for (; sent < IMAGE.maxBytes + 2 * piece.length && !c.req.destroyed; sent += piece.length) {
          const err = await write(c.req, piece);
          if (err) break;
        }
        if (!c.req.destroyed) c.req.end();
        const r = await deadline(8000, 'D/issue client', Promise.race([c.response, c.closed.then(() => null)]));
        await deadline(3000, 'D/handler', reqs[0].done);
        return { response: r, error: c.error && (c.error.code || c.error.message), sent };
      });
      const r0 = reqs[0];
      assert.equal(r0.real, true);
      assert.equal(r0.ends, 1, 'réponse émise une seule fois côté serveur');
      assert.equal(r0.handlerError, null);
      assert.equal(quotaCalls, 0); assert.equal(seen.calls, 0);
      if (outcome.response) { assert.equal(outcome.response.status, 413); assert.equal(outcome.response.body.error, toUserMessage('TOO_LARGE')); }
      else assert.ok(outcome.error, 'la connexion est coupée avec une erreur côté client');
      t.diagnostic('OBSERVÉ (taille) : ' + (outcome.response ? 'la réponse 413 ATTEINT le client' : `la réponse 413 N'ATTEINT PAS le client, connexion coupée (${outcome.error}) après ${outcome.sent} octets envoyés`) + ' ; événements serveur : ' + r0.events.join(','));
    }));
    await turn(); await turn();
    assert.deepEqual(guard.events, []);
  } finally { guard.restore(); }
});

/* =================== Réseau : tout est resté local =================== */

test('HTTP-E aucun appel externe : fetch, masques et DNS à zéro ; toutes les connexions viennent de 127.0.0.1', () => {
  assert.equal(NET.fetch, 0, 'fetch global appelé');
  assert.equal(NET.masks, 0, 'téléchargement de masque tenté');
  assert.equal(NET.dns, 0, 'résolution DNS tentée');
  assert.deepEqual([...ADDRESSES], ['127.0.0.1']);
});
