'use strict';
/* Phase 1 : lancement unique, tampon des résultats reçus, reprise de l'enregistrement, isolation des comptes.
   js/analysis-flow.js est testé avec des faux (stockage, horloge, minuteurs, enregistrement) : aucun réseau, aucun Perfect Corp.
   Le câblage dans js/app.js est contrôlé ici par la source, et dans un vrai navigateur par analysis-flow-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Flow = require('../js/analysis-flow.js');
const Account = require('../js/account.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T0 = Date.parse('2026-10-11T10:00:00Z'), H = 3600 * 1000;
const METRICS = Account.METRIC_KEYS;
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rec = (n, at = T0, extra = {}) => Object.assign({
  id: uuid(n), analyzedAt: new Date(at).toISOString(), globalScore: 70, skinType: 'combination', skinAge: 30,
  metrics: Object.fromEntries(METRICS.map((k, i) => [k, 50 + i])), rawMetrics: { acne: 41.5 },
  priorities: [{ id: 'acne', label: 'Imperfections', score: 40, band: 'low' }], goals: ['hydration'], engineVersion: '1.0.0'
}, extra);
const tick = () => new Promise(r => setImmediate(r));
/* Pièges réseau : tout appel direct à fetch, XMLHttpRequest, http(s).request serait compté puis refusé (les faux sont injectés, jamais globaux). */
const trap = { calls: [] };
globalThis.fetch = (...a) => { trap.calls.push(['fetch', String(a[0])]); throw new Error('réseau interdit dans ce test'); };
globalThis.XMLHttpRequest = function () { trap.calls.push(['xhr']); throw new Error('réseau interdit dans ce test'); };
for (const m of ['node:http', 'node:https']) { const mod = require(m); for (const f of ['request', 'get']) mod[f] = (...a) => { trap.calls.push([m, f]); throw new Error('réseau interdit dans ce test'); }; }

function env(o = {}) {
  const e = { now: T0, user: 'u-a', toasts: [], confirms: [], answer: true, saves: [], changes: 0, saved: [], expired: 0, timers: [], store: o.store || new Map(), noStorage: false };
  const storage = { getItem: k => (e.store.has(k) ? e.store.get(k) : null), setItem: (k, v) => { if (e.setItemThrows) throw new Error('quota'); e.store.set(k, String(v)); }, removeItem: k => { e.store.delete(k); } };
  e.saveImpl = async () => ({ ok: true });
  const make = () => Flow.create({
    storage: () => (e.noStorage ? null : e.throwStorage ? (() => { throw new Error('denied'); })() : storage), now: () => e.now, userId: () => e.user,
    save: (r, owner) => { e.saves.push({ rec: r, owner, buffered: e.store.get(Flow.PENDING_KEY) || null }); return e.saveImpl(r, owner); },
    confirm: m => { e.confirms.push(m); return e.answer; }, toast: m => e.toasts.push(m), onChange: () => { e.changes++; },
    onSaved: id => e.saved.push(id), onExpired: () => { e.expired++; },
    timer: (fn, ms) => { const h = { fn, ms, on: true }; e.timers.push(h); return h; }, untimer: h => { h.on = false; }
  });
  e.flow = make(); e.reload = () => { e.flow = make(); return e.flow; };   // « rechargement de l'onglet » : même sessionStorage, nouvelle mémoire
  e.add = (r, opt) => e.flow.add(r, Object.assign({ recordable: true, signedIn: true }, opt));
  e.pending = () => (e.store.has(Flow.PENDING_KEY) ? JSON.parse(e.store.get(Flow.PENDING_KEY)) : null);
  e.fireTimers = async () => { for (const h of e.timers.filter(x => x.on)) { h.on = false; h.fn(); await tick(); } };
  return e;
}
const startRun = e => { assert.equal(e.flow.arm(), true); const run = e.flow.begin(); assert.ok(run); return run; };

/* =================== 1. Lancement : une intention explicite, une analyse à la fois =================== */

test('F1 sans intention explicite, rien ne démarre : un rendu répété ne peut jamais lancer', () => {
  const e = env();
  for (let i = 0; i < 100; i++) assert.equal(e.flow.begin(), null);
  assert.equal(e.flow.armed(), false);
});

test('F2 une intention = un seul démarrage ; le verrou est posé avant tout await ; un 2e clic est refusé avec un message', () => {
  const e = env();
  assert.equal(e.flow.arm(), true);
  const run = e.flow.begin();
  assert.ok(run); assert.equal(e.flow.busy(), true);
  assert.equal(e.flow.begin(), null, 'l\'intention est consommée');
  assert.equal(e.flow.arm(), false, 'pas de 2e intention pendant une analyse');
  assert.equal(e.toasts.at(-1), Flow.MSG.busy);
  assert.equal(e.flow.begin(), null);
  run.end(false);
  assert.equal(e.flow.busy(), false);
  assert.equal(e.flow.begin(), null, 'terminer n\'ouvre aucun nouveau démarrage');
});

test('F3 l\'intention expire après 5 s et ne survit pas à l\'annulation', () => {
  const e = env();
  e.flow.arm(); e.now += Flow.INTENT_MS + 1;
  assert.equal(e.flow.armed(), false); assert.equal(e.flow.begin(), null);
  e.flow.arm(); e.flow.disarm();
  assert.equal(e.flow.begin(), null);
  e.flow.arm(); e.now -= 1000;                                       // horloge reculée : jamais d'intention « du futur »
  assert.equal(e.flow.armed(), false);
});

test('F4 issue définitive (succès ou refus du serveur) : aucun blocage, aucun marqueur', () => {
  const e = env();
  startRun(e).end(false);
  assert.equal(e.store.has(Flow.RUN_KEY), false);
  assert.equal(e.flow.arm(), true);
  assert.equal(e.confirms.length, 0);
});

test('F5 issue ambiguë : blocage de 65 s sans relance automatique, puis confirmation explicite ; jamais « échec »', () => {
  const e = env();
  startRun(e).end(true);
  assert.ok(e.store.has(Flow.RUN_KEY));
  e.now += 10 * 1000;
  assert.equal(e.flow.arm(), false);
  assert.match(e.toasts.at(-1), /issue reste incertaine/); assert.match(e.toasts.at(-1), /patientez encore 55 s/);
  assert.equal(e.confirms.length, 0, 'pas de confirmation tant que la fenêtre est ouverte');
  assert.equal(e.flow.begin(), null);
  e.now += 55 * 1000 - 1; assert.equal(e.flow.arm(), false);        // 1 ms avant la fin
  e.now += 1;                                                         // 65 s pile
  e.answer = false;
  assert.equal(e.flow.arm(), false, 'refus de confirmer : rien ne part');
  assert.equal(e.confirms.length, 1); assert.match(e.confirms[0], /reste incertaine/); assert.match(e.confirms[0], /peut-être été réalisée et décomptée/);
  assert.equal(e.flow.begin(), null, 'aucun démarrage automatique après 65 s');
  e.answer = true;
  assert.equal(e.flow.arm(), true); assert.equal(e.confirms.length, 2);
  assert.ok(e.flow.begin());
  for (const m of [Flow.MSG.uncertain, Flow.MSG.confirm, Flow.MSG.blocked(12)]) assert.doesNotMatch(m, /échou|échec|n'a pas fonctionné|a raté/i, 'ne prétend jamais que l\'analyse a échoué');
  assert.match(Flow.MSG.uncertain, /peut-être été réalisée/);
});

test('F6 le blocage survit au rechargement de l\'onglet (marqueur dans sessionStorage), même requête interrompue en plein vol', () => {
  const e = env();
  startRun(e);                                                        // requête partie, page rechargée avant la réponse : aucun end()
  const f = e.reload();
  e.now += 20000;
  assert.equal(f.arm(), false); assert.match(e.toasts.at(-1), /patientez encore 45 s/);
  e.now += 45000; e.answer = false;
  assert.equal(f.arm(), false); assert.equal(e.confirms.length, 1);
});

test('F7 le blocage est propre à chaque compte (le quota aussi) ; l\'autre compte n\'est pas pénalisé', () => {
  const e = env();
  startRun(e).end(true);
  e.user = 'u-b';
  assert.equal(e.flow.arm(), true, 'B n\'est pas bloqué par l\'incertitude de A');
  assert.ok(e.flow.begin());
  e.reload(); e.user = 'u-b'; e.now += 1000;
  assert.equal(e.flow.arm(), false, 'B est bloqué par SA requête sans réponse (marqueur « run » rechargé)');
  e.user = 'u-a';
  assert.equal(e.flow.arm(), false, 'A reste bloqué : son marqueur n\'a pas été écrasé par celui de B');
});

test('F8 marqueur invalide, futur ou illisible : ignoré sans planter ; futur proche (horloge) : blocage plafonné à 65 s', () => {
  const e = env();
  e.store.set(Flow.RUN_KEY, '{not json');
  assert.equal(e.flow.arm(), true);
  e.store.set(Flow.RUN_KEY, JSON.stringify({ 'u-a': { t: T0 + 10 * 60 * 1000, s: 'amb' } }));   // 10 min dans le futur : impossible
  assert.equal(e.reload().arm(), true); assert.equal(e.confirms.length, 0);
  e.store.set(Flow.RUN_KEY, JSON.stringify({ 'u-a': { t: T0 + 60 * 1000, s: 'amb' } }));        // 1 min dans le futur : toléré, mais plafonné
  const f = e.reload(); assert.equal(f.arm(), false); assert.match(e.toasts.at(-1), /patientez encore 65 s/);
  e.store.set(Flow.RUN_KEY, JSON.stringify({ 'u-a': { t: 'x' }, 'u-b': null, 3: [] }));
  assert.equal(e.reload().arm(), true);
  e.store.set(Flow.RUN_KEY, JSON.stringify([1, 2]));
  assert.equal(e.reload().arm(), true);
});

test('F9 sessionStorage indisponible : le verrou de l\'onglet fonctionne toujours, sans exception', () => {
  for (const mode of ['noStorage', 'throwStorage']) {
    const e = env(); e[mode] = true;
    const run = startRun(e);
    assert.equal(e.flow.arm(), false); assert.equal(e.flow.begin(), null);
    run.end(true);
    assert.doesNotThrow(() => e.flow.arm());
    e.add(rec(1)); assert.doesNotThrow(() => e.flow.resume(true));
  }
});

/* =================== 2. Tampon : écriture préalable, liste blanche, effacement =================== */

test('T1 le résultat est écrit dans le tampon AVANT l\'envoi, sans photo, sans masque, sans task_id, sans jeton', async () => {
  const e = env();
  const hostile = rec(1, T0, { photo: 'data:image/jpeg;base64,AAAA', blob: {}, task_id: 'tsk-1', access_token: 'tok', localization: { acne: [1] }, user_id: 'u-x', __proto__: { x: 1 } });
  hostile.metrics.extraMetric = 99; hostile.priorities[0].photo = 'x'; hostile.priorities.push({ id: 'nope', label: 'x', score: 1, band: 'low' });
  e.add(hostile);
  assert.equal(e.saves.length, 1);
  const buffered = JSON.parse(e.saves[0].buffered);                  // contenu du tampon à l'instant de l'envoi
  assert.equal(buffered.items.length, 1); assert.equal(buffered.items[0].uid, 'u-a');
  const text = e.saves[0].buffered;
  assert.doesNotMatch(text, /photo|blob|task|token|localization|user_id|extraMetric|nope|data:image/i);
  assert.deepEqual(Object.keys(buffered.items[0].rec).sort(), ['analyzedAt', 'engineVersion', 'globalScore', 'goals', 'id', 'metrics', 'priorities', 'rawMetrics', 'skinAge', 'skinType']);
  assert.deepEqual(e.saves[0].rec, Flow.cleanRecord(hostile), 'ce qui part est la même liste blanche');
  assert.equal(e.saves[0].owner, 'u-a');
  await tick();
});

test('T2 succès : l\'entrée quitte le tampon, onSaved reçoit l\'identifiant, le même identifiant est utilisé partout', async () => {
  const e = env();
  e.add(rec(1)); await tick();
  assert.equal(e.pending(), null); assert.deepEqual(e.saved, [uuid(1)]);
  assert.equal(e.flow.notice(uuid(1)).status, 'saved');
  assert.equal(e.flow.pending(), 0);
});

test('T3 échec réseau : 2 nouveaux essais automatiques (1 s puis 4 s), puis erreur ; le résultat reste dans le tampon', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: true });
  e.add(rec(1)); await tick();
  assert.equal(e.timers.length, 1); assert.equal(e.timers[0].ms, 1000);
  assert.equal(e.flow.notice(uuid(1)).status, 'saving', 'pas d\'erreur affichée pendant un nouvel essai automatique');
  await e.fireTimers();
  assert.equal(e.timers.length, 2); assert.equal(e.timers[1].ms, 4000);
  await e.fireTimers();
  assert.equal(e.saves.length, 3, '1 + 2 essais, pas un de plus');
  assert.equal(e.timers.length, 2);
  assert.equal(e.flow.notice(uuid(1)).status, 'error'); assert.match(e.flow.notice(uuid(1)).message, /onglet reste ouvert/);
  assert.equal(e.pending().items.length, 1);
  assert.ok(e.saves.every(s => s.rec.id === uuid(1) && s.owner === 'u-a'), 'toujours la même ligne, jamais une nouvelle analyse');
});

test('T4 erreur non passagère (ex. données refusées) : aucun nouvel essai automatique ; reprise manuelle possible', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1)); await tick();
  assert.equal(e.timers.length, 0); assert.equal(e.flow.notice(uuid(1)).status, 'error');
  e.saveImpl = async () => ({ ok: true });
  e.flow.resume(true); await tick();
  assert.equal(e.pending(), null); assert.equal(e.saves.length, 2);
});

test('T5 reprise : un seul envoi à la fois par analyse ; reprises automatiques espacées de 15 s ; bouton « Réessayer » immédiat', async () => {
  const e = env(); let release; e.saveImpl = () => new Promise(r => { release = r; });
  e.add(rec(1));
  e.flow.resume(true); e.flow.resume(true); e.flow.resume(); await tick();
  assert.equal(e.saves.length, 1, 'double clic : un seul envoi en vol');
  release({ ok: false, retryable: false }); await tick();
  e.saveImpl = async () => ({ ok: false, retryable: false });
  e.now += 5000; e.flow.resume(); await tick();
  assert.equal(e.saves.length, 1, 'trop tôt');
  e.now += 10001; e.flow.resume(); await tick();
  assert.equal(e.saves.length, 2);
  e.flow.resume(true); await tick();
  assert.equal(e.saves.length, 3, 'manuel : sans délai');
});

test('T6 aucun chemin de reprise ne peut démarrer une analyse : le module n\'a ni réseau, ni appel à /api/skin-analysis', () => {
  const src = read('js/analysis-flow.js');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ''), /fetch|XMLHttpRequest|skin-analysis|perfect|youcam|provider|analyzeSkin|WebSocket|sendBeacon/i);
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: true });
  e.add(rec(1));
  e.flow.resume(true); e.flow.resume(); e.flow.banner();
  assert.equal(e.flow.begin(), null, 'une reprise n\'arme jamais de lancement');
  assert.equal(e.flow.armed(), false);
});

test('T7 session expirée pendant l\'envoi : l\'entrée reste liée à son compte, onExpired signalé, aucune erreur trompeuse', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, expired: true, error: 'x' });
  e.add(rec(1)); await tick();
  assert.equal(e.expired, 1); assert.equal(e.flow.notice(uuid(1)).status, 'pending');
  assert.equal(e.pending().items[0].uid, 'u-a');
  assert.match(e.flow.note(), /reconnecterez avec ce compte/);
  assert.equal(e.timers.length, 0, 'pas de nouvel essai automatique sans session');
});

test('T8 reconnexion du MÊME compte : flush envoie l\'entrée sous ce compte, une seule fois', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, expired: true });
  e.add(rec(1)); await tick();
  e.reload();                                                         // la page a été rechargée entre-temps
  e.saveImpl = async () => ({ ok: true });
  await e.flow.flush('u-a');
  assert.equal(e.saves.length, 2); assert.equal(e.saves[1].owner, 'u-a'); assert.equal(e.saves[1].rec.id, uuid(1));
  assert.equal(e.pending(), null);
  await e.flow.flush('u-a'); assert.equal(e.saves.length, 2, 'rien de plus à envoyer');
});

test('T9 AUTRE compte après déconnexion ou expiration : l\'entrée n\'est jamais envoyée, jamais listée, effacée avec un message', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1)); e.add(rec(2)); await tick();
  const sent = e.saves.length;
  e.user = 'u-b'; e.saveImpl = async () => ({ ok: true });
  e.flow.resume(true); e.flow.resume(); await e.flow.flush('u-b'); await tick();
  assert.equal(e.saves.length, sent, 'aucun envoi sous la session de B');
  assert.deepEqual(e.flow.list('u-b'), []);
  assert.equal(e.pending(), null);
  assert.equal(e.flow.notice(uuid(1)), null); assert.equal(e.flow.banner(), '');
  assert.ok(e.toasts.includes(Flow.MSG.foreign));
  e.user = 'u-a'; assert.deepEqual(e.flow.list('u-a'), [], 'et A ne les retrouve pas non plus : elles sont abandonnées');
});

test('T10 session de B active alors que A a une entrée (sans passer par list) : attempt refuse d\'envoyer', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1)); await tick();
  const n = e.saves.length;
  e.user = 'u-b';
  e.flow.resume(true); await tick();
  assert.equal(e.saves.length, n);
  e.user = null; e.flow.resume(true); await tick();
  assert.equal(e.saves.length, n, 'visiteur : rien non plus');
});

test('T10b un nouvel essai automatique déjà programmé pour A ne part jamais si B s\'est connecté entre-temps', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: true });
  e.add(rec(1)); await tick();
  assert.equal(e.timers.filter(t => t.on).length, 1);
  const n = e.saves.length;
  e.user = 'u-b'; e.saveImpl = async () => ({ ok: true });         // B est connecté, rien n'a encore purgé le tampon de A
  await e.fireTimers();
  assert.equal(e.saves.length, n, 'le minuteur de A n\'envoie rien sous la session de B');
  assert.equal(e.flow.notice(uuid(1)).status, 'pending', 'en attente pour son propre compte, pas bloquée sur « Enregistrement… »');
});

test('T10c sans compte connecté, list() ne liste ni ne purge rien (une fenêtre de déconnexion ne détruit pas le tampon)', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1)); await tick();
  e.user = null;
  assert.deepEqual(e.flow.list(), []); assert.deepEqual(e.flow.list(undefined), []);
  assert.equal(e.pending().items.length, 1, 'le tampon de A est intact');
  e.user = 'u-a'; assert.equal(e.flow.list().length, 1);
});

test('T11 « foreign » renvoyé par le client de compte : l\'entrée reste en attente (jamais en erreur ni perdue)', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, foreign: true });
  e.add(rec(1)); await tick();
  assert.equal(e.flow.notice(uuid(1)).status, 'pending'); assert.equal(e.pending().items.length, 1);
});

test('T12 déconnexion : confirmation seulement s\'il y a du non enregistré ; refus = rien ne change ; accord = tampon effacé, minuteurs annulés', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: true });
  assert.equal(e.flow.leave(), true); assert.equal(e.confirms.length, 0, 'rien à perdre : pas de question');
  e.add(rec(1)); await tick();
  e.answer = false; assert.equal(e.flow.leave(), false);
  assert.match(e.confirms[0], /sera perdue/); assert.equal(e.pending().items.length, 1);
  e.answer = true; assert.equal(e.flow.leave(), true);
  assert.equal(e.pending(), null); assert.ok(e.timers.every(t => !t.on), 'nouvel essai automatique annulé');
  const n = e.saves.length; e.saveImpl = async () => ({ ok: true });
  await e.fireTimers(); assert.equal(e.saves.length, n);
  assert.equal(e.flow.pending(), 0);
});

test('T13 la déconnexion garde le marqueur d\'issue incertaine du compte (se reconnecter ne contourne pas le blocage)', () => {
  const e = env(); startRun(e).end(true);
  e.flow.leave();
  assert.ok(e.store.has(Flow.RUN_KEY));
  assert.equal(e.reload().arm(), false);
});

test('T14 suppression de l\'historique ou du compte : clear() efface tampon et mémoire', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: true });
  e.add(rec(1)); await tick();
  e.flow.clear();
  assert.equal(e.pending(), null); assert.equal(e.flow.notice(uuid(1)), null); assert.equal(e.flow.pending(), 0);
  e.saveImpl = async () => ({ ok: true }); await e.fireTimers(); e.flow.resume(true); await tick();
  assert.equal(e.saves.length, 1, 'plus rien n\'est renvoyé');
});

test('T15 si l\'entrée est supprimée pendant l\'envoi, une réponse tardive ne la ressuscite pas', async () => {
  const e = env(); let release; e.saveImpl = () => new Promise(r => { release = r; });
  e.add(rec(1)); e.flow.clear(); release({ ok: false, retryable: true }); await tick();
  assert.equal(e.pending(), null); assert.equal(e.timers.length, 0); assert.deepEqual(e.saved, []);
});

/* =================== 3. Tampon : expiration, dates invalides, plafonds, données corrompues =================== */

test('E1 expiration à 23 h d\'après analyzedAt (pas l\'heure d\'écriture) : abandon explicite, rien d\'envoyé', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1)); await tick();
  e.now = T0 + 23 * H;                                                // exactement 23 h : encore valable
  e.flow.resume(true); await tick(); assert.equal(e.saves.length, 2);
  e.now = T0 + 23 * H + 1; const n = e.saves.length;
  e.flow.resume(true); await tick();
  assert.equal(e.saves.length, n, 'au-delà de 23 h, rien n\'est envoyé');
  assert.equal(e.pending(), null); assert.equal(e.flow.notice(uuid(1)), null);
  assert.match(e.toasts.at(-1), /Une analyse non enregistrée a été abandonnée.*plus de 23 heures/);
});

test('E2 au rechargement, les entrées trop anciennes sont abandonnées avec un message, les récentes gardées', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  e.add(rec(1, T0 - 22 * H)); e.add(rec(2, T0 - 1 * H)); await tick();
  e.now = T0 + 2 * H;                                                 // rec 1 a maintenant 24 h, rec 2 en a 3
  const f = e.reload();
  assert.deepEqual(f.list('u-a').map(x => x.rec.id), [uuid(2)]);
  assert.match(e.toasts.at(-1), /Une analyse non enregistrée a été abandonnée/);
  assert.equal(e.pending().items.length, 1);
});

test('E3 dates invalides ou futures : abandon (jamais d\'envoi) ; futur proche (horloge) toléré', () => {
  const e = env();
  const items = [
    { uid: 'u-a', at: T0, rec: rec(1, T0, { analyzedAt: 'pas une date' }) },
    { uid: 'u-a', at: T0, rec: rec(2, T0, { analyzedAt: undefined }) },
    { uid: 'u-a', at: T0, rec: rec(3, T0 + 10 * 60 * 1000) },        // +10 min : futur
    { uid: 'u-a', at: T0, rec: rec(4, T0 + 4 * 60 * 1000) },         // +4 min : tolérance d'horloge
    { uid: 'u-a', at: T0 + 1000 * H, rec: rec(6, T0 - 30 * H) }      // écrite « récemment » mais analyse vieille de 30 h
  ];
  e.store.set(Flow.PENDING_KEY, JSON.stringify({ v: 1, items }));
  const got = e.reload().list('u-a').map(x => x.rec.id);
  assert.deepEqual(got, [uuid(4)]);
  assert.match(e.toasts.at(-1), /4 analyses non enregistrées ont été abandonnées/);
});

test('E4 plafonds : 5 entrées et 16 Ko au plus dans le tampon ; les plus récentes sont gardées', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  for (let i = 1; i <= 8; i++) { e.now = T0 + i * 1000; e.add(rec(i, e.now)); }
  await tick();
  const p = e.pending();
  assert.equal(p.items.length, Flow.MAX_ENTRIES); assert.deepEqual(p.items.map(x => x.rec.id), [8, 7, 6, 5, 4].map(uuid));
  assert.ok(e.store.get(Flow.PENDING_KEY).length <= Flow.MAX_BYTES);
  const big = rec(9, e.now + 1, { priorities: Array.from({ length: 15 }, () => ({ id: 'acne', label: 'x'.repeat(60), score: 1, band: 'low' })) });
  for (let i = 0; i < 6; i++) e.add(Object.assign({}, big, { id: uuid(20 + i) }));
  assert.ok(e.store.get(Flow.PENDING_KEY).length <= Flow.MAX_BYTES);
});

test('E5 données corrompues : jamais d\'exception, tampon vidé, message ; formes inattendues ignorées', () => {
  for (const raw of ['{oops', 'null', '[]', '{"v":2,"items":[]}', '{"v":1,"items":"x"}', '"x"', '123']) {
    const e = env(); e.store.set(Flow.PENDING_KEY, raw);
    assert.doesNotThrow(() => e.flow.list('u-a'), raw);
    assert.equal(e.store.has(Flow.PENDING_KEY), false, raw);
  }
  const e = env();
  e.store.set(Flow.PENDING_KEY, JSON.stringify({ v: 1, items: [null, 5, 'x', { uid: 'u-a' }, { uid: '', rec: rec(1) }, { uid: 'u-a', rec: { id: 'pas-un-uuid' } }, { uid: 'u-a', rec: rec(2, T0, { metrics: {} }) }, { uid: 'u-a', rec: rec(3) }, { uid: 'u-a', rec: rec(3) }] }));
  assert.deepEqual(e.flow.list('u-a').map(x => x.rec.id), [uuid(3)], 'valides et sans doublon seulement');
});

test('E6 stockage plein ou refusé en écriture : l\'analyse reste en mémoire et s\'enregistre quand même', async () => {
  const e = env(); e.setItemThrows = true;
  assert.doesNotThrow(() => e.add(rec(1))); await tick();
  assert.deepEqual(e.saved, [uuid(1)]);
});

test('E7 visiteur ou valeurs inexploitables : jamais dans le tampon, état explicite pour l\'affichage', async () => {
  const e = env();
  e.add(rec(1), { signedIn: false }); e.add(rec(2), { recordable: false }); await tick();
  assert.equal(e.pending(), null); assert.equal(e.saves.length, 0);
  assert.equal(e.flow.notice(uuid(1)).status, 'visitor'); assert.match(e.flow.notice(uuid(1)).message, /disparaîtra quand vous quitterez cette session/);
  assert.equal(e.flow.notice(uuid(2)).status, 'skipped'); assert.match(e.flow.notice(uuid(2)).message, /certaines valeurs ne sont pas exploitables/);
  e.add({ nope: 1 }); e.add(null); e.add(undefined);                  // jamais d'exception sur une entrée absurde
  assert.equal(e.pending(), null);
});

test('E8 bannière : seulement pour les analyses du compte connecté non enregistrées, avec le bouton de reprise', async () => {
  const e = env(); e.saveImpl = async () => ({ ok: false, retryable: false });
  assert.equal(e.flow.banner(), '');
  e.add(rec(1)); e.add(rec(2)); await tick();
  const b = e.flow.banner();
  assert.match(b, /2 analyses ne sont pas encore enregistrées/); assert.match(b, /data-act="retry-analysis"/);
  assert.doesNotMatch(b, /[<>]\s*[^<>]*\$\{|undefined|\[object/);
  e.user = 'u-b'; assert.equal(e.flow.banner(), '');
});

/* =================== 4. Client de compte : propriétaire et nature des pannes =================== */

async function account(extra = {}) {
  const fake = createFake(), a = Account.create(Object.assign({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now }, extra));
  return { fake, a };
}
const sample = n => ({ id: uuid(n), analyzedAt: new Date(1_800_000_000_000).toISOString(), globalScore: 70, skinType: 'dry', skinAge: 30, metrics: Object.fromEntries(METRICS.map(k => [k, 60])), priorities: [], goals: [], engineVersion: '1.0.0' });
const bodyOf = fake => fake.log.filter(l => l.method === 'POST' && l.path.startsWith('/rest/v1/skin_analyses'));

test('A1 saveAnalysis(rec, ownerId) : sous la session d\'un autre compte (ou sans session), rien n\'est envoyé', async () => {
  const { fake, a } = await account();
  const ua = (await a.signUp('a@exemple.com', 'motdepasse1')).user;
  assert.deepEqual(await a.saveAnalysis(sample(1), 'u-autre'), { ok: false, error: Account.MSG.analysisSaveFailed, foreign: true });
  assert.equal(bodyOf(fake).length, 0);
  assert.equal((await a.saveAnalysis(sample(1), ua.id)).ok, true);
  assert.equal(bodyOf(fake).length, 1);
  await a.signOut();
  assert.deepEqual(await a.saveAnalysis(sample(2), ua.id), { ok: false, error: Account.MSG.sessionExpired, expired: true });
  const b = (await a.signUp('b@exemple.com', 'motdepasse1')).user;
  const posts = bodyOf(fake).length;
  assert.equal((await a.saveAnalysis(sample(2), ua.id)).foreign, true, 'B connecté : l\'analyse de A ne part pas');
  assert.equal(bodyOf(fake).length, posts);
  assert.notEqual(b.id, ua.id);
});

test('A2 nature des pannes : réseau, 5xx, 429 et 408 se réessaient ; refus définitifs (4xx) non', async () => {
  for (const [status, retry] of [[500, true], [502, true], [503, true], [429, true], [408, true], [400, false], [403, false], [409, false], [422, false]]) {
    const { fake, a } = await account();
    const u = (await a.signUp('a@exemple.com', 'motdepasse1')).user;
    const real = fake.fetch;
    const stub = async (url, init) => (/skin_analyses/.test(url) && init.method === 'POST' ? { ok: false, status, text: async () => '{"message":"x"}' } : real(url, init));
    const acc2 = Account.create({ url: 'https://demo.supabase.co', anonKey: 'k', fetch: stub, storage: memoryStorage(), now: fake.state.now });
    await acc2.signIn('a@exemple.com', 'motdepasse1');
    const r = await acc2.saveAnalysis(sample(1), u.id);
    assert.equal(r.ok, false); assert.equal(r.retryable, retry, String(status));
    assert.doesNotMatch(r.error, /\d{3}|PGRST|SQL/);
  }
});

test('A3 bout en bout avec le faux Supabase : réponse perdue puis reprise = une seule ligne ; l\'analyse d\'un compte n\'arrive jamais chez l\'autre', async () => {
  const { fake, a } = await account();
  const ua = (await a.signUp('a@exemple.com', 'motdepasse1')).user;
  const store = new Map();
  let lose = 1;
  const e = env({ store });
  e.user = ua.id;
  const flow = Flow.create({
    storage: () => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }), now: () => T0, userId: () => (a.user && a.user.id),
    save: async (r, owner) => {
      const res = await a.saveAnalysis(r, owner);
      if (lose-- > 0) return { ok: false, retryable: true };                  // la ligne est enregistrée, mais la réponse est perdue
      return res;
    }, confirm: () => true, toast() {}, timer: (fn, ms) => ({ fn, ms }), untimer() {}
  });
  flow.add(rec(1, T0), { recordable: true, signedIn: true });
  await tick(); await tick();
  assert.equal([...fake.analyses.values()].flat().length, 1, 'enregistrée malgré la réponse perdue');
  flow.resume(true); flow.resume(true); await tick(); await tick();
  assert.equal([...fake.analyses.values()].flat().length, 1, 'la reprise ne crée pas de doublon');
  assert.equal(store.has(Flow.PENDING_KEY), false);
  // compte B : rien de A
  await a.signOut(); const ub = (await a.signUp('b@exemple.com', 'motdepasse1')).user;
  assert.equal([...(fake.analyses.get(ub.id) || [])].length, 0);
});

/* =================== 5. Câblage dans js/app.js, index.html et pages =================== */

const app = read('js/app.js');
const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('W1 index.html charge le module avant app.js, après account.js', () => {
  const html = read('index.html'), at = s => html.indexOf(`<script src="${s}"></script>`);
  assert.ok(at('js/analysis-flow.js') > at('js/account.js') && at('js/analysis-flow.js') < at('js/app.js'));
  assert.equal((html.match(/analysis-flow\.js/g) || []).length, 1);
});

test('W2 l\'unique chemin vers une analyse réelle est le clic « analyze » : plus aucun data-go="analyzing", un seul go(`analyzing`)', () => {
  assert.doesNotMatch(app, /data-go="analyzing"/);
  const goCalls = app.match(/go\(`analyzing`[^)]*\)/g) || [];
  assert.deepEqual(goCalls, ['go(`analyzing`)'], 'un seul appel, dans le cas `analyze`');
  assert.match(app, /case `analyze`:if\(DEMO_MODE\|\|F\.arm\(\)\)go\(`analyzing`\);break;/);
  assert.match(app, /c-btn--block" data-act="analyze">\$\{state\.scanError\?/);
});

test('W3 runRealAnalysis : ordre des garde-fous ; le fournisseur n\'est appelé qu\'une fois, après F.begin(), jamais avant', () => {
  const run = between('async function runRealAnalysis', 'function loadPhoto');
  const order = ['F.busy()', 'needsLogin()', 'F.armed()', 'const blob=state.realBlob', 'F.begin()', 'provider.analyzeSkin('].map(k => run.indexOf(k));
  assert.ok(order.every(i => i > 0) && order.every((v, i) => !i || v > order[i - 1]), String(order));
  assert.equal((run.match(/provider\.analyzeSkin\(/g) || []).length, 1);
  assert.match(run, /if\(!F\.armed\(\)\)\{if\(state\.scanStatus!==`success`\)go\(`scan`/);
  assert.match(run, /const run=F\.begin\(\);if\(!run\)return;/);
  assert.match(run, /F\.disarm\(\)/);
  assert.equal((app.match(/F\.begin\(\)/g) || []).length, 1, 'un seul point de démarrage');
  assert.equal((app.match(/=\s*(?:await )?provider\.analyzeSkin\(/g) || []).length, 2, 'démo (runAnalysis) + réel (runRealAnalysis)');
  assert.equal((app.match(/\/api\/skin-analysis/g) || []).length, 1, 'une seule URL, dans postJpeg');
});

test('W4 le résultat reçu est gardé même après un changement d\'écran : aucune garde anTok avant commitRealScan, pas de navigation forcée', () => {
  const run = between('async function runRealAnalysis', 'function loadPhoto');
  const ok = run.slice(run.indexOf('run.end();'), run.indexOf('}catch(err)'));
  assert.doesNotMatch(ok, /tok!==anTok|tok===anTok/);
  assert.ok(ok.indexOf('run.end()') < ok.indexOf('commitRealScan(r,blob)'), 'l\'issue est enregistrée dès que la réponse est là');
  assert.match(ok, /if\(epoch!==authEpoch\)\{toast\(M\.abandonedEpoch\);return\}/);
  assert.match(ok, /if\(state\.route===`analyzing`\)\{setScanStatus\(`success`\);timers\.push\(setTimeout\(\(\)=>go\(`result`/);
  assert.match(ok, /else toast\(M\.ready\)/);
  assert.match(run, /run\.end\(!!\(err&&err\.noVerdict\)\)/);
  assert.match(run, /const msg=err&&err\.noVerdict\?M\.uncertain:/);
  assert.match(run, /if\(state\.route!==`analyzing`\)\{toast\(msg\);return\}/);
});

test('W5 postJpeg : coupure, délai dépassé et réponse sans JSON DERMAI = noVerdict ; 401 et 429 inchangés', () => {
  const post = between('function postJpeg', 'function normalizeSkinResult').slice(0, 2600);
  assert.match(post, /x\.timeout=65000/);
  assert.match(post, /x\.onerror=\(\)=>reject\(Object\.assign\(userError\([^\n]*\{noVerdict:true\}\)\)/);
  assert.match(post, /x\.ontimeout=\(\)=>reject\(Object\.assign\(userError\([^\n]*\{noVerdict:true\}\)\)/);
  assert.match(post, /const nv=!\(j&&typeof j\.ok===`boolean`\)/);
  assert.match(post, /\{noVerdict:nv\}/);
  assert.equal(Flow.BLOCK_MS, 65000, 'la fenêtre de blocage couvre le délai du navigateur (65 s)');
  assert.match(read('vercel.json'), /"maxDuration": 60/);
});

test('W5b écran de la photo : une issue incertaine n\'est jamais titrée « Analyse impossible »', () => {
  assert.match(app, /state\.scanError===DermaiAnalysisFlow\.MSG\.uncertain\?`Réponse non reçue`:`Analyse impossible`/);
});

test('W6 commitRealScan : la photo envoyée est celle gardée ; aperçu recréé si l\'utilisatrice a changé d\'écran', () => {
  const c = between('function commitRealScan', 'const provider=');
  assert.match(c, /function commitRealScan\(r,blob\)/);
  assert.match(c, /const mine=state\.realBlob===blob/);
  assert.match(c, /URL\.createObjectURL\(blob\)/);
  assert.match(c, /r\.blob=blob/);
  assert.match(c, /saveScan\(r\);\s*\/\/ sans attendre/);
});

test('W7 reprise d\'enregistrement : « Réessayer », retour en ligne, onglet revenu au premier plan et navigation passent par F.resume, jamais par une analyse', () => {
  assert.match(app, /case `retry-analysis`:F\.resume\(true\);break;/);
  assert.match(app, /window\.addEventListener\(`online`,\(\)=>F\.resume\(\)\)/);
  assert.match(app, /document\.addEventListener\(`visibilitychange`,\(\)=>\{if\(!document\.hidden\)F\.resume\(\)\}\)/);
  assert.match(app, /render\(\);scrollTo\(0,0\);F\.resume\(\);/);
  const resumeCalls = app.match(/F\.resume\([^)]*\)/g) || [];
  assert.equal(resumeCalls.length, 4, 'retry, online, visibilitychange, go');
  const sens = between('function act(', 'document.addEventListener(`click`');
  const retryCase = sens.slice(sens.indexOf('case `retry-analysis`'), sens.indexOf('\n', sens.indexOf('case `retry-analysis`')));
  assert.doesNotMatch(retryCase, /analyze|runRealAnalysis|provider|go\(|arm\(/);
});

test('W8 connexion : d\'abord les analyses en attente DE CE COMPTE, puis l\'historique, qui ne les écrase pas', () => {
  const enter = between('async function enterSession', '/* ---------- Historique persistant');
  assert.match(enter, /else\{await F\.flush\(user\.id\);if\(epoch!==authEpoch\)return;await loadHistory\(\)\}/);
  const load = between('async function loadHistory', 'async function retryHistory');
  assert.match(load, /F\.list\(\)\.filter\(e=>e\.status!==`skipped`&&!have\.has\(e\.rec\.id\)\)/);
  assert.match(load, /mem\.find\(x=>x\.rec&&x\.rec\.id===a\.id\)/);
  assert.ok(load.indexOf('F.list(') > load.indexOf('const mem=') || load.indexOf('mem=SCANS.slice()') > 0);
});

test('W9 expiration de session : l\'analyse non enregistrée est conservée (pas de F.clear) et le message le dit ; déconnexion / suppressions : effacement', () => {
  const reset = between('function resetPrivateState', 'const softStatus'), expire = between('function expireSession', 'let saving=false');
  assert.doesNotMatch(reset + expire, /F\.clear|F\.leave/);
  assert.match(expire, /DermaiAccount\.MSG\.sessionExpired\+F\.note\(\)/);
  assert.match(between('async function logout', 'const esc='), /if\(!F\.leave\(\)\)return;/);
  assert.match(between('async function deleteHistory', '/* Photos de scan'), /state\.cmpB=1;F\.clear\(\);/);
  assert.match(between('async function deleteMyAccount', 'async function submitAuth'), /F\.clear\(\);CP\.clear\(\);VR\.clear\(\);resetPrivateState\(\)/);
  assert.match(app, /onExpired:\(\)=>expireSession\(\)/);
});

test('W10 le tampon n\'est qu\'en sessionStorage (effacé par le navigateur avec l\'onglet), jamais en localStorage ; clés et durée connues', () => {
  const src = read('js/analysis-flow.js');
  assert.doesNotMatch(src, /localStorage|indexedDB|document\.cookie/);
  assert.match(app, /storage:\(\)=>window\.sessionStorage/);
  assert.equal(Flow.PENDING_KEY, 'dermai.pending'); assert.equal(Flow.RUN_KEY, 'dermai.run');
  assert.equal(Flow.MAX_AGE_MS, 23 * 3600 * 1000);
  const mig = read('supabase/migrations/20261007120000_create_skin_analyses.sql');
  assert.match(mig, /interval '1 day'|1 day/, 'le serveur remplace analyzed_at au-delà d\'un jour : 23 h reste en deçà');
});

test('W11 les bannières d\'analyses non enregistrées sont sur l\'accueil et « Mes analyses » ; la confidentialité décrit le tampon', () => {
  assert.match(between('V.home=', 'V.concern'), /<\/header>\$\{F\.banner\(\)\}/);
  assert.match(between('V.analyses=', '/* Profil */'), /<\/div>\$\{F\.banner\(\)\}/);
  assert.match(read('js/photos-view.js'), /gardés temporairement dans la mémoire de cet onglet, liés à votre compte/);
});

test('W12 taille : app.js reste sous le plafond de 150 000 octets (inchangé)', () => {
  assert.ok(fs.statSync(path.join(__dirname, '..', 'js/app.js')).size < 150000);
});

test('W13 aucun appel réseau pendant ces tests (fetch, XMLHttpRequest, http, https) : donc aucun appel à Perfect Corp', () => {
  assert.deepEqual(trap.calls, []);
});
