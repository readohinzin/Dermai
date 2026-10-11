'use strict';
/* js/simulation.js en Node, avec de FAUX réseau et stockage : une seule demande à la fois, session changée, photo conservée, libellés.
   Aucun réseau réel : toute requête passe par fetchImpl, qui est un enregistreur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sim = require('../js/simulation.js');
const errors = require('../server/errors');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const jpeg = () => new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], { type: 'image/jpeg' });
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), size: () => m.size }; };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) });

function make({ responses = [], uid = 'u1' } = {}) {
  const log = { fetch: [], renders: 0, went: [] }, st = { uid, epoch: 1, scan: { real: true, rec: { id: 's1' }, blob: jpeg() } };
  const queue = [...responses], gates = [];
  const sess = mem();
  const api = Sim.create({
    token: async () => 'tok.tok.tok', userId: () => st.uid, epoch: () => st.epoch, render: () => { log.renders++; }, go: r => log.went.push(r), back: () => log.went.push('back'),
    session: () => sess, scan: () => st.scan, toJpeg: async () => jpeg(),
    fetchImpl: async (url, init) => {
      log.fetch.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next && next.gate) { await new Promise(r => gates.push(r)); }
      if (next && next.throw) throw new Error('réseau');
      return next.res;
    }
  });
  const doc = { handlers: {}, addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); } };
  api.attach(doc);
  const click = (act, extra = {}) => { const el = { disabled: false, getAttribute: k => (k === 'data-sim' ? act : extra.c), closest() { return this; } }; doc.handlers.click.forEach(f => f({ target: el })); };
  return { api, log, st, sess, click, release: () => gates.splice(0).forEach(r => r()), doc };
}
const avail = (v = true) => ({ res: resp(200, { ok: true, available: v }) });

test('SU1 jamais de réseau à la création ni à l\'affichage d\'une page fermée', () => {
  const { api, log } = make({ responses: [avail(false)] });
  api.page({ real: true });
  assert.equal(log.fetch.length, 0);
});

test('SU2 disponibilité : un seul GET par compte, bouton seulement si « available », jamais pour un visiteur ou une démonstration', async () => {
  const t = make({ responses: [avail(true)] });
  assert.equal(t.api.entry(t.st.scan), ''); assert.equal(t.api.entry(t.st.scan), '', 'pas de seconde requête pendant la première');
  await t.api.probe(); await new Promise(r => setImmediate(r));
  assert.equal(t.log.fetch.length, 1); assert.equal(t.log.fetch[0].method, 'GET'); assert.match(t.log.fetch[0].url, /^\/api\/skin-simulation$/);
  assert.match(t.api.entry(t.st.scan), /data-sim="open"[^>]*>Simuler une amélioration/);
  assert.equal(t.api.entry({ real: false }), '', 'démonstration : rien'); assert.equal(t.api.entry(null), '');
  const v = make({ responses: [avail(true)], uid: null }); assert.equal(v.api.entry(v.st.scan), ''); assert.equal(v.log.fetch.length, 0, 'visiteur : rien');
  const c = make({ responses: [avail(false)] }); c.api.entry(c.st.scan); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(c.api.entry(c.st.scan), ''); assert.equal(c.log.fetch.length, 1);
  const bad = make({ responses: [{ throw: true }] }); bad.api.entry(bad.st.scan); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(bad.api.entry(bad.st.scan), '', 'doute = fermé');
});

async function ready(t) { await t.api.probe(); t.api.page(t.st.scan); }

test('SU3 une seule demande à la fois : clics répétés avant et pendant l\'attente = UNE requête', async () => {
  const t = make({ responses: [avail(true), { gate: true, res: resp(200, { ok: true, simulation: { concern: 'acne', image: PNG } }) }] });
  await ready(t);
  t.click('pick', { c: 'acne' });
  t.click('run'); t.click('run'); t.click('run');
  await new Promise(r => setImmediate(r)); t.click('run');
  const posts = () => t.log.fetch.filter(f => f.method === 'POST');
  await new Promise(r => setTimeout(r, 20));
  assert.equal(posts().length, 1); assert.match(posts()[0].url, /concern=acne$/); assert.ok(posts()[0].body instanceof Blob);
  assert.equal(t.api.state().status, 'running'); t.click('run'); t.click('pick', { c: 'pores' });
  assert.equal(t.api.state().concern, 'acne', 'la zone ne change pas pendant la demande'); assert.equal(posts().length, 1);
  t.release(); await new Promise(r => setTimeout(r, 20));
  assert.equal(t.api.state().status, 'done'); assert.equal(posts().length, 1); assert.equal(t.sess.size(), 0, 'réponse reçue : aucune trace');
});

test('SU4 rien sans zone valide ; une zone hors liste n\'est jamais envoyée', async () => {
  const t = make({ responses: [avail(true), { res: resp(200, { ok: true }) }] });
  await ready(t); t.click('run'); await new Promise(r => setTimeout(r, 10));
  assert.equal(t.log.fetch.filter(f => f.method === 'POST').length, 0);
  t.click('pick', { c: 'oiliness' }); t.click('run'); await new Promise(r => setTimeout(r, 10));
  assert.equal(t.log.fetch.filter(f => f.method === 'POST').length, 0, '« oiliness » n\'est pas proposée');
  assert.ok(!Sim.CONCERNS.some(c => c[0] === 'oiliness'));
});

test('SU5 session changée pendant la demande : le résultat est jeté, jamais affiché à un autre compte', async () => {
  const t = make({ responses: [avail(true), { gate: true, res: resp(200, { ok: true, simulation: { concern: 'acne', image: PNG } }) }] });
  await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 10));
  t.st.epoch = 2; t.st.uid = 'u2'; const drawn = t.log.renders; t.release(); await new Promise(r => setTimeout(r, 20));
  assert.equal(t.log.renders, drawn, 'la réponse tardive ne redessine rien et n\'est pas traitée');
  const p = t.api.page(t.st.scan); assert.doesNotMatch(p, /data-sim="after"/); assert.equal(t.api.state().image, '');
  assert.equal(t.api.state().status, 'idle', 'état d\'un autre compte : remis à zéro');
});

test('SU6 photo conservée dans le compte : récupérée (JPEG seulement) ; autre chose ou échec = on redemande une photo, rien n\'est envoyé', async () => {
  const keptOk = { res: Object.assign(resp(200, null), { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]).buffer }) };
  const sim = { res: resp(200, { ok: true, simulation: { concern: 'acne', image: PNG } }) };
  let t = make({ responses: [avail(true), keptOk, sim] }); t.st.scan = { real: true, rec: { id: 's1' }, photo: 'https://demo.supabase.co/storage/v1/object/sign/x?token=1' };
  await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(t.log.fetch.map(f => f.method + ' ' + f.url.split('?')[0]), ['GET /api/skin-simulation', 'GET https://demo.supabase.co/storage/v1/object/sign/x', 'POST /api/skin-simulation']);
  assert.equal(t.api.state().status, 'done');
  for (const bad of [{ res: resp(404, null) }, { throw: true }, { res: Object.assign(resp(200, null), { arrayBuffer: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer }) }]) {
    t = make({ responses: [avail(true), bad] }); t.st.scan = { real: true, rec: { id: 's1' }, photo: 'https://demo.supabase.co/storage/v1/object/sign/x?token=1' };
    await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 20));
    assert.equal(t.log.fetch.filter(f => f.method === 'POST').length, 0); assert.equal(t.api.state().needPhoto, true);
    assert.match(t.api.page(t.st.scan), /La photo de cette analyse n'est plus disponible dans DERMAI/);
  }
  t = make({ responses: [avail(true)] }); t.st.scan = { real: true, rec: { id: 's1' }, photo: 'http://insecure/x' };
  await ready(t); assert.match(t.api.page(t.st.scan), /Une photo est nécessaire/); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 10));
  assert.equal(t.log.fetch.length, 1, 'un lien non https n\'est jamais suivi');
});

test('SU7 réponse perdue : trace de session, confirmation avant relance ; réponse du serveur (même refus) : trace effacée', async () => {
  const t = make({ responses: [avail(true), { throw: true }, { res: resp(429, { ok: false, error: 'Quota atteint <b>x</b>' }) }] });
  await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 20));
  assert.equal(t.api.state().unsure, true); assert.equal(t.sess.size(), 1);
  let p = t.api.page(t.st.scan); assert.match(p, /Réponse non reçue/); assert.match(p, /data-sim="ack"/); assert.match(p, /data-sim="run" disabled/);
  t.click('run'); await new Promise(r => setTimeout(r, 10)); assert.equal(t.log.fetch.filter(f => f.method === 'POST').length, 1, 'sans confirmation : aucune relance');
  t.click('ack'); t.click('run'); await new Promise(r => setTimeout(r, 20));
  assert.equal(t.log.fetch.filter(f => f.method === 'POST').length, 2); assert.equal(t.sess.size(), 0, 'le serveur a répondu : plus de doute');
  p = t.api.page(t.st.scan); assert.match(p, /Quota atteint &lt;b&gt;x&lt;\/b&gt;/, 'le message du serveur est échappé'); assert.doesNotMatch(p, /<b>x<\/b>/);
});

test('SU8 réponses non conformes : jamais d\'image ; seules les images data: JPEG/PNG/WebP de la bonne zone sont acceptées', async () => {
  for (const sim of [{ concern: 'acne', image: 'https://evil/x.png' }, { concern: 'acne', image: 'javascript:alert(1)' }, { concern: 'acne', image: 'data:text/html;base64,AAAA' }, { concern: 'acne', image: 'data:image/svg+xml;base64,AAAA' }, { concern: 'pores', image: PNG }, { concern: 'acne', image: PNG + '"onerror="x' }, null]) {
    const t = make({ responses: [avail(true), { res: resp(200, { ok: true, simulation: sim }) }] });
    await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 20));
    assert.equal(t.api.state().status, 'error', JSON.stringify(sim)); assert.equal(t.api.state().image, '');
    assert.doesNotMatch(t.api.page(t.st.scan), /data-sim="after"/);
  }
});

test('SU9 l\'image simulée et les avertissements : « illustration, pas une prédiction », jamais un résultat médical ou garanti', async () => {
  const t = make({ responses: [avail(true), { res: resp(200, { ok: true, simulation: { concern: 'acne', image: PNG } }) }] });
  globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:x');
  await ready(t); t.click('pick', { c: 'acne' }); t.click('run'); await new Promise(r => setTimeout(r, 20));
  const p = t.api.page(t.st.scan);
  assert.match(p, /Une illustration, pas une prédiction/); assert.match(p, /ne prédit pas l'effet de vos soins, ne promet aucun résultat et n'a aucune valeur médicale/);
  assert.match(p, /alt="Image simulée, illustrative"/); assert.match(p, /Avant \/ après simulation : Acné/);
  assert.match(p, /compte dans votre quota de simulations, même si elle échoue/);
});

test('SU10 libellés : aucune formulation médicale ou absolue (mêmes garde-fous que le reste de l\'interface)', () => {
  const FORBIDDEN = [/vous avez (?!indiqu[ée]|choisi)/iu, /vous souffrez/iu, /(?<![\p{L}])traiter(?![\p{L}])/iu, /(?<![\p{L}])il faut(?![\p{L}])/iu, /malad/iu, /patholog/iu, /pr[ée]scri/iu, /gu[ée]ri/iu, /(?<![\p{L}])soigner/iu,
    /[ée]claircir/iu, /blanchi/iu, /d[ée]pigment/iu, /\b(élimine|guérit|garanti|miracle|disparaît définitivement)\b/iu, /Votre diagnostic|nous diagnostiquons|traitement médical/iu];
  const src = fs.readFileSync(path.join(__dirname, '../js/simulation.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const re of FORBIDDEN) assert.doesNotMatch(src, re, String(re));
  for (const [k, v] of Object.entries(errors.MESSAGES)) if (/^SIM_/.test(k)) for (const re of FORBIDDEN) assert.doesNotMatch(v, re, k + ' ' + re);
  for (const [, label] of Sim.CONCERNS) for (const re of FORBIDDEN) assert.doesNotMatch(label, re, label);
});

test('SU11 vie privée : ni localStorage, ni envoi hors /api/skin-simulation, ni cookies dans le module', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/simulation.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /localStorage|document\.cookie|indexedDB|XMLHttpRequest|sendBeacon/);
  const urls = [...src.matchAll(/doFetch\(([^,)]+)/g)].map(m => m[1]);
  assert.ok(urls.every(u => /'\/api\/skin-simulation|url/.test(u)), urls.join(' | '));
});
