'use strict';
/* Présence « en ligne » : js/presence.js (battements) et js/account.js (touchPresence) contre un faux Supabase, minuteries simulées. Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Presence = require('../js/presence.js');
const Account = require('../js/account.js');
const { createFake, memoryStorage } = require('./helpers/fake-supabase.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* Horloge et minuterie simulées : avancer de N millisecondes déclenche les tick() prévus. */
function rig({ beat = async () => ({ ok: true }), user = { id: 'u1' } } = {}) {
  const r = { t: 0, vis: true, ep: 0, user, calls: [], timers: [], docHandlers: {} };
  r.acct = () => (r.user ? { user: r.user, touchPresence: async () => { r.calls.push({ at: r.t, id: r.user.id }); return beat(r); } } : null);
  r.p = Presence.create({ account: r.acct, epoch: () => r.ep, now: () => r.t, visible: () => r.vis, setInterval: (fn, ms) => { r.timers.push({ fn, ms, next: ms }); return r.timers.length; } });
  r.doc = { addEventListener: (ev, fn) => { r.docHandlers[ev] = fn; } };
  r.advance = async ms => { const end = r.t + ms; while (r.t < end) { r.t = Math.min(end, r.t + Presence.CHECK_MS); for (const tm of r.timers) tm.fn(); for (let i = 0; i < 6; i++) await Promise.resolve(); } };
  return r;
}

test('PR1 hors connexion, en mode démonstration ou sans comptes : aucun appel, jamais', async () => {
  const r = rig({ user: null }); r.p.attach(r.doc); await r.advance(600000); assert.deepEqual(r.calls, []);
  const noFn = Presence.create({ account: () => ({ user: { id: 'u' } }), now: () => 0, setInterval: () => 1 }); noFn.attach({ addEventListener() {} }); await noFn.tick(); assert.equal(noFn.state().beats, 0);
  const none = Presence.create({}); none.attach(null); await none.tick(); assert.equal(none.state().beats, 0, 'aucune dépendance : rien ne part, rien ne casse');
});

test('PR2 connecté : un premier battement tout de suite, puis un toutes les 30 s (jamais plus)  ; 11 battements de 0 à 300 s', async () => {
  const r = rig(); r.p.attach(r.doc); await Promise.resolve();
  assert.equal(r.calls.length, 1, 'premier battement à l\'attache'); assert.equal(r.timers[0].ms, Presence.CHECK_MS); assert.equal(Presence.BEAT_MS, 30000);
  await r.advance(25000); assert.equal(r.calls.length, 1, 'pas de battement avant 30 s');
  await r.advance(5000); assert.equal(r.calls.length, 2);
  await r.advance(270000); assert.equal(r.calls.length, 11, '11 battements de 0 à 300 s inclus : un toutes les 30 s');
  for (let i = 1; i < r.calls.length; i++) assert.ok(r.calls[i].at - r.calls[i - 1].at >= 30000, 'au moins 30 s entre deux battements');
});

test('PR3 page cachée : aucun battement ; elle redevient visible : battement immédiat si le dernier date de 30 s ou plus', async () => {
  const r = rig(); r.p.attach(r.doc); await r.advance(1000); const n = r.calls.length; r.vis = false;
  await r.advance(120000); assert.equal(r.calls.length, n, 'cachée : silence');
  r.vis = true; r.docHandlers.visibilitychange(); await Promise.resolve(); await Promise.resolve(); assert.equal(r.calls.length, n + 1, 'visible de nouveau : battement tout de suite');
  r.docHandlers.visibilitychange(); await Promise.resolve(); assert.equal(r.calls.length, n + 1, 'pas de double battement');
});

test('PR4 déconnexion ou autre compte : plus rien pour l\'ancien, nouveau départ immédiat pour le nouveau', async () => {
  const r = rig(); r.p.attach(r.doc); await r.advance(70000); const before = r.calls.length;
  r.user = null; await r.advance(120000); assert.equal(r.calls.length, before, 'déconnecté : aucun battement'); assert.equal(r.p.state().who, null);
  r.user = { id: 'u2' }; await r.advance(5000); assert.equal(r.calls.at(-1).id, 'u2', 'autre compte : battement dans les 5 s, sans attendre 30 s');
  assert.ok(r.calls.slice(before).every(c => c.id === 'u2'));
});

test('PR5 fonction absente de la base (404) : plus aucun battement pendant la session ; un autre compte repart', async () => {
  const r = rig({ beat: async () => ({ ok: false, stop: true }) }); r.p.attach(r.doc); await r.advance(300000);
  assert.equal(r.calls.length, 1, 'un seul essai'); assert.equal(r.p.state().stopped, true);
  r.user = { id: 'u2' }; await r.advance(5000); assert.equal(r.calls.at(-1).id, 'u2', 'autre compte : nouvel essai');
});

test('PR6 échecs silencieux : une exception ou un refus ne remonte jamais, aucune rafale, jamais deux appels en même temps', async () => {
  const r = rig({ beat: async () => { throw new Error('réseau'); } }); r.p.attach(r.doc); await r.advance(120000);
  assert.ok(r.calls.length >= 3 && r.calls.length <= 5, 'un essai toutes les 30 s malgré les échecs : ' + r.calls.length); assert.equal(r.p.state().busy, false);
  let release, inflight = 0, max = 0;
  const slow = rig({ beat: () => new Promise(res => { inflight++; max = Math.max(max, inflight); release = () => { inflight--; res({ ok: true }); }; }) });
  slow.p.attach(slow.doc); await slow.advance(100000); assert.equal(max, 1, 'pas de chevauchement'); assert.equal(slow.calls.length, 1, 'tant que le premier n\'est pas fini, aucun autre'); release(); await Promise.resolve(); await slow.advance(30000); assert.equal(slow.calls.length, 2);
});

test('PR7 compte : touchPresence envoie « {} » à la seule fonction touch_presence avec le jeton du compte ; 404 → stop ; réseau coupé, session absente ou refus → ok:false sans exception', async () => {
  const fake = createFake(), acc = Account.create({ url: 'https://demo.supabase.co', anonKey: 'public-anon-key', fetch: fake.fetch, storage: memoryStorage(), now: fake.state.now });
  assert.deepEqual(await acc.touchPresence(), { ok: false, stop: false }, 'pas de session : aucune requête'); assert.equal(fake.log.length, 0);
  await acc.signUp('a@exemple.com', 'motdepasse1'); const n0 = fake.log.length;
  assert.deepEqual(await acc.touchPresence(), { ok: true, stop: false });
  const l = fake.log.slice(n0); assert.equal(l.length, 1); assert.deepEqual([l[0].method, l[0].path], ['POST', '/rest/v1/rpc/touch_presence']); assert.equal(fake.state.presenceCalls.at(-1).body, '{}');
  assert.equal(fake.presence.size, 1); assert.ok(!/user_id|email|a@exemple/.test(JSON.stringify(fake.state.presenceCalls)), 'aucun identifiant ni adresse dans la requête');
  fake.state.presenceMode = 'missing'; assert.deepEqual(await acc.touchPresence(), { ok: false, stop: true });
  fake.state.presenceMode = 'fail'; assert.deepEqual(await acc.touchPresence(), { ok: false, stop: false });
  fake.state.presenceMode = undefined; fake.state.failNetwork = true; assert.deepEqual(await acc.touchPresence(), { ok: false, stop: false }); fake.state.failNetwork = false;
  fake.state.advance(30); fake.state.presenceMode = undefined; assert.equal((await acc.touchPresence()).ok, true);
});

test('PR8 sobriété et câblage : rien d\'autre que touchPresence, aucun stockage navigateur, aucune écriture HTML ; chargé avant app.js, créé avec le compte et l\'époque de session seulement ; app.js sous le plafond', () => {
  const code = read('js/presence.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/localStorage|sessionStorage|indexedDB|innerHTML|fetch\(|XMLHttpRequest|sendBeacon|console\.|navigator\.|geolocation|location\./.test(code));
  assert.deepEqual([...new Set(code.match(/\ba\.\w+\(/g))], ['a.touchPresence('], 'seul appel sur le compte');
  const html = read('index.html'), app = read('js/app.js');
  assert.ok(html.indexOf('<script src="js/presence.js"></script>') > html.indexOf('<script src="js/account.js"></script>') && html.indexOf('<script src="js/presence.js"></script>') < html.indexOf('<script src="js/app.js"></script>'));
  assert.equal((app.match(/DermaiPresence\.create\(/g) || []).length, 1); assert.match(app, /^const PR=DermaiPresence\.create\(\{account:\(\)=>ACCOUNT,epoch:\(\)=>authEpoch\}\);PR\.attach\(document\);$/m);
  assert.ok(Buffer.byteLength(app) < 150000);
});

test('PR9 transparence : l\'écran « Confidentialité » (mode réel) dit qu\'une date de dernière activité est enregistrée, sans page ni appareil, et effacée avec le compte ; pas de mention en mode démonstration', () => {
  const { DermaiPhotos: Photos } = require('../js/photos-view.js'), ic = n => `<i>${n}</i>`, sw = () => '';
  const real = Photos.privacy({ demo: false, signedIn: true, photos: null, busy: false, ic, sw }), demo = Photos.privacy({ demo: true, signedIn: false, photos: undefined, busy: false, ic, sw });
  assert.match(real, /date de votre dernière activité sur le site \(une seule date, sans page visitée ni appareil\)/); assert.match(real, /Elle est effacée avec votre compte/);
  assert.ok(!/dernière activité/.test(demo), 'aucune mention en démonstration : rien n\'est envoyé');
});
