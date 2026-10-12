'use strict';
/* Comptes de l'administration et présence « en ligne », dans le VRAI index.html / js/app.js, dans Chromium, réseau simulé (test/helpers/browser-harness.js) : /api/admin-stats est intercepté, la fonction SQL
   touch_presence est celle du faux Supabase. Horloge du navigateur pilotée (page.clock) : aucune attente réelle. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const A = require('../server/admin.js');

const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 };
let browser, server;
test.before(async () => {
  if (!OK) return;
  const stats = { serverApi: [] };
  server = await H.startServer(stats); server.stats = stats;
  browser = await H.loadPlaywright().chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

const NOW = new Date().toISOString();
const iso = off => new Date(Date.now() + off).toISOString();
const LONG = 'prenom.nom.tres.long.avec.beaucoup.de.points.et.de.tirets-pour-tester-le-retour-a-la-ligne@un-domaine-vraiment-tres-long-exemple.com';
const accountsOf = list => ({ ok: true, accounts: { status: 'ok', fetchedAt: NOW, cached: false, total: list.length, truncated: false, accounts: list } });
const LIST = () => [
  { email: 'en-ligne@exemple.com', createdAt: iso(-3 * 864e5), lastSignInAt: iso(-30e3), lastSeenAt: iso(-10e3), online: true },
  { email: LONG, createdAt: iso(-864e5), lastSignInAt: iso(-3600e3), lastSeenAt: iso(-2 * 3600e3), online: false },
  { email: 'jamais@exemple.com', createdAt: iso(-5 * 864e5), lastSignInAt: null, lastSeenAt: null, online: false }];
const sectionsOf = list => ({
  features: { ok: true, generatedAt: NOW, features: A.featureRows({ PERFECT_CORP_API_KEY: 'k', SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'a' }) }, quotas: { ok: true, generatedAt: NOW, quotas: A.quotaRows({}) },
  credit: { ok: true, credit: { status: 'ok', fetchedAt: NOW, cached: false, spendable: 150, categories: [{ type: 'Api Purchased', amount: 150, spendable: true }] } },
  usage: { ok: true, usage: { status: 'ok', fetchedAt: NOW, cached: false, accounts: { total: 3, new_7d: 1, new_30d: 2, signed_in_7d: 2, signed_in_30d: 2, active_7d: 1, active_30d: 2, returned_7d: 0, never_used: 1, inactive_30d: 0 }, functions: [{ key: 'analysis', name: 'Analyse de la peau', available: true, runs_7d: 1, runs_30d: 2, users_30d: 2 }], savedAnalyses: { total: 2, last_30d: 2, users: 2 } } },
  costs: { ok: true, costs: { status: 'unavailable', reason: 'key_missing', fetchedAt: NOW } },
  accounts: accountsOf(list) });
const founder = list => { const sections = sectionsOf(list); return { env: { user: { email: 'f@exemple.com' }, admin: { access: 'yes', sections } }, sections }; };
const boot = async (env, visitor) => {
  await env.page.clock.install({ time: Date.now() });
  await env.page.goto('/');
  await env.page.waitForFunction(v => typeof state !== 'undefined' && (v ? state.account.status !== 'loading' : state.account.status === 'signedIn'), !!visitor, { timeout: 15000 });
};
/* Le temps du navigateur est virtuel : on l'avance par pas de 5 s en laissant le réseau simulé répondre entre deux pas, comme dans la vraie vie. */
const advance = async (page, ms) => { for (let t = 0; t < ms; t += 5000) { await page.clock.runFor(Math.min(5000, ms - t)); await page.waitForTimeout(100); } };
const toAdmin = async env => {
  const { page } = env;
  await page.evaluate(() => go('admin')); await page.waitForFunction(() => state.route === 'admin');
  await page.waitForFunction(() => /Solde Perfect Corp/.test(document.getElementById('app').innerText) && !/Chargement…/.test(document.getElementById('app').innerText), null, { timeout: 15000 });
};
const accReq = env => env.stats.adm.filter(x => x.section === 'accounts');
const hOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const settle = page => page.waitForTimeout(120);
const clean = env => { assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []); assert.ok(env.stats.adm.every(x => x.method === 'GET')); };

test('ABA1 comptes à 420 px : titre qui se déploie (clavier compris), adresses lisibles sans débordement, point vert qui pulse pour « en ligne », point rouge fixe pour « hors ligne », texte qui double la couleur', opts, async () => {
  const f = founder(LIST()); const env = await H.open(browser, server, f.env); await boot(env); const { page } = env;
  await page.setViewportSize({ width: 420, height: 900 }); await toAdmin(env);
  const head = page.locator('[data-ad=accounts]');
  assert.equal(await head.getAttribute('aria-expanded'), 'false'); assert.equal(accReq(env).length, 0, 'fermé : aucune adresse demandée');
  assert.ok(!/@/.test(await page.evaluate(() => document.querySelector('#ad-accounts').innerText)), 'fermé : aucune adresse affichée'); assert.match(await page.evaluate(() => document.querySelector('#ad-accounts').innerText), /Comptes\s*3/);
  const hb = await head.boundingBox(); assert.ok(hb.height >= 44, 'cible tactile : ' + JSON.stringify(hb));
  await head.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('.c-ad-accs');
  assert.equal(await head.getAttribute('aria-expanded'), 'true'); assert.equal(accReq(env).length, 1); assert.ok(accReq(env)[0].auth);
  const rows = await page.$$eval('.c-ad-acc', els => els.map(e => ({ dot: e.querySelector('.c-ad-dot').className, mail: e.querySelector('.c-ad-mail').textContent, state: e.querySelector('small').textContent })));
  assert.deepEqual(rows.map(r => [r.dot.includes('--on') ? 'on' : 'off', r.mail, r.state.replace(/\s+/g, ' ').trim()]), [['on', 'en-ligne@exemple.com', 'En ligne'], ['off', LONG, 'Hors ligne · vu il y a 2 h'], ['off', 'jamais@exemple.com', 'Hors ligne · jamais vu']]);
  const css = await page.evaluate(() => { const g = n => { const e = document.querySelector('.c-ad-dot--' + n + ':not(.c-ad-disclosure__n *)'); const c = getComputedStyle(e), b = e.getBoundingClientRect(); return { anim: c.animationName, bg: c.backgroundColor, w: b.width, h: b.height, r: c.borderRadius, left: b.x, textX: e.parentElement.querySelector('.c-ad-mail').getBoundingClientRect().x }; }; return { on: g('on'), off: g('off') }; });
  assert.equal(css.on.anim, 'adPulse', 'vert : animation de pulsation'); assert.equal(css.off.anim, 'none', 'rouge : fixe'); assert.notEqual(css.on.bg, css.off.bg);
  /* color-mix peut renvoyer color(srgb 0.8 0.2 0.2) */ const rgb = c => (/^color\(srgb/.test(c) ? c.match(/[\d.]+/g).slice(0, 3).map(x => Math.round(Number(x) * 255)) : c.match(/\d+/g).slice(0, 3).map(Number)); const [r1, g1, b1] = rgb(css.on.bg), [r2, g2, b2] = rgb(css.off.bg);
  assert.ok(g1 > r1 && g1 > b1 - 40, 'vert : ' + css.on.bg); assert.ok(r2 > g2 && r2 > b2, 'rouge : ' + css.off.bg);
  assert.ok(css.on.w === 10 && css.on.h === 10 && css.on.r.includes('50%'), 'rond de 10 px'); assert.ok(css.on.left < css.on.textX, 'le point est À GAUCHE de l\'adresse');
  assert.equal(await hOverflow(page), 0, 'une adresse très longue passe à la ligne sans élargir la page');
  const wide = await page.evaluate(() => [...document.querySelectorAll('.c-ad-acc, .c-ad-mail, .c-ad-card')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length); assert.equal(wide, 0);
  assert.match(await page.evaluate(() => document.querySelector('[data-ad=accounts]').innerText), /3 · 1 en ligne|3\s*·\s*1 en ligne/);
  await page.keyboard.press('Space'); await page.waitForFunction(() => !document.querySelector('.c-ad-accs')); assert.equal(await page.locator('[data-ad=accounts]').getAttribute('aria-expanded'), 'false');
  assert.ok(!/@/.test(await page.evaluate(() => document.getElementById('app').innerText)), 'refermé : plus aucune adresse dans la page');
  clean(env); await env.close();
});

test('ABA2 TEMPS RÉEL : la liste est relue toutes les 10 s sans recharger ; un compte qui part passe au rouge, un nouveau arrive ; le focus du clavier reste ; page cachée ou refermée : aucune lecture', opts, async () => {
  const f = founder(LIST()); const env = await H.open(browser, server, f.env); await boot(env); const { page } = env;
  await page.setViewportSize({ width: 420, height: 900 }); await toAdmin(env);
  await page.locator('[data-ad=accounts]').focus(); await page.keyboard.press('Enter'); await page.waitForSelector('.c-ad-accs'); const n0 = accReq(env).length;
  await advance(page, 9000); await settle(page); assert.equal(accReq(env).length, n0, 'pas avant 10 s');
  await advance(page, 1500); await settle(page); assert.equal(accReq(env).length, n0 + 1, 'une lecture à 10 s');
  const next = LIST(); next[0].online = false; next[0].lastSeenAt = iso(-100e3); next.push({ email: 'nouveau@exemple.com', createdAt: iso(-1e3), lastSignInAt: iso(-1e3), lastSeenAt: iso(-1e3), online: true });
  f.sections.accounts = accountsOf(next);
  await advance(page, 10000); await page.waitForFunction(() => /nouveau@exemple\.com/.test(document.getElementById('app').innerText), null, { timeout: 10000 });
  const rows = await page.$$eval('.c-ad-acc', els => els.map(e => [e.querySelector('.c-ad-dot').className.includes('--on') ? 'on' : 'off', e.querySelector('.c-ad-mail').textContent]));
  assert.deepEqual(rows.find(r => r[1] === 'en-ligne@exemple.com'), ['off', 'en-ligne@exemple.com'], 'le compte parti est passé au rouge sans rechargement'); assert.deepEqual(rows.find(r => r[1] === 'nouveau@exemple.com'), ['on', 'nouveau@exemple.com']);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-ad')), 'accounts', 'le focus du clavier est resté sur le titre malgré le réaffichage');
  /* page cachée : aucune lecture */
  const n1 = accReq(env).length; await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await advance(page, 35000); await settle(page); assert.equal(accReq(env).length, n1, 'page cachée : silence'); await page.evaluate(() => { delete document.hidden; });
  await advance(page, 10500); await settle(page); assert.equal(accReq(env).length, n1 + 1, 'visible de nouveau : la lecture reprend');
  /* page quittée : arrêt ; refermée : arrêt */
  const n2 = accReq(env).length; await page.evaluate(() => go('home')); await advance(page, 35000); await settle(page); assert.equal(accReq(env).length, n2, 'autre page : aucune lecture');
  await toAdmin(env); await page.waitForSelector('.c-ad-accs'); const n3 = accReq(env).length;
  await page.click('[data-ad=accounts]'); await page.waitForFunction(() => !document.querySelector('.c-ad-accs')); await advance(page, 35000); await settle(page); assert.equal(accReq(env).length, n3, 'refermée : aucune lecture');
  clean(env); await env.close();
});

test('ABA3 mouvement réduit : le point vert ne pulse plus mais reste vert, et le texte « En ligne » est toujours là ; mode sombre : les deux points restent distincts', opts, async () => {
  const f = founder(LIST()); const env = await H.open(browser, server, f.env); await boot(env); const { page } = env;
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize({ width: 420, height: 900 }); await toAdmin(env);
  await page.click('[data-ad=accounts]'); await page.waitForSelector('.c-ad-accs');
  const reduced = await page.evaluate(() => { const e = document.querySelector('.c-ad-acc .c-ad-dot--on'); return { anim: getComputedStyle(e).animationName, bg: getComputedStyle(e).backgroundColor, txt: e.parentElement.innerText }; });
  assert.equal(reduced.anim, 'none'); assert.match(reduced.bg, /rgb/); assert.match(reduced.txt, /En ligne/);
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' }); await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await settle(page);
  const dark = await page.evaluate(() => { const on = getComputedStyle(document.querySelector('.c-ad-acc .c-ad-dot--on')).backgroundColor, off = getComputedStyle(document.querySelector('.c-ad-acc .c-ad-dot--off')).backgroundColor; return { on, off }; });
  assert.notEqual(dark.on, dark.off, 'sombre : vert et rouge restent distincts'); clean(env); await env.close();
});

test('ABA4 les chiffres d\'activité restent disponibles dans « Statistiques d\'activité » ; rien d\'autre que des lectures ; aucune section de comptes demandée à l\'ouverture de la page', opts, async () => {
  const f = founder(LIST()); const env = await H.open(browser, server, f.env); await boot(env); const { page } = env; await toAdmin(env);
  assert.deepEqual(env.stats.adm.map(x => x.section).sort(), ['access', 'costs', 'credit', 'features', 'quotas', 'usage'], 'ni liste ni adresses chargées à l\'ouverture');
  await page.click('[data-ad=accounts]'); await page.waitForSelector('.c-ad-accs'); assert.equal(await page.locator('#ad-stats-panel').count(), 0);
  await page.click('[data-ad=stats]'); await page.waitForSelector('#ad-stats-panel');
  const t = await page.evaluate(() => document.querySelector('#ad-stats-panel').innerText); assert.match(t, /Nouveaux comptes/); assert.match(t, /Actifs \(au moins une demande\)/); assert.match(t, /nombres seulement/);
  assert.equal(await page.locator('[data-ad=stats]').getAttribute('aria-expanded'), 'true'); await page.click('[data-ad=stats]'); await page.waitForFunction(() => !document.querySelector('#ad-stats-panel'));
  clean(env); await env.close();
});

test('ABA5 compte non fondateur : jamais d\'adresse ; section « accounts » jamais demandée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } }); await boot(env); const { page } = env;
  await page.evaluate(() => go('admin')); await page.waitForFunction(() => state.route === 'admin');
  assert.match(await page.evaluate(() => document.getElementById('app').innerText), /Page introuvable/); assert.equal(accReq(env).length, 0); assert.equal(await page.locator('[data-ad]').count(), 0);
  clean(env); await env.close();
});

/* ───────── Présence ───────── */
test('PRB1 présence : un compte connecté envoie un battement dans les 5 s puis un toutes les 30 à 32 s (jamais plus) ; page cachée : rien ; visible de nouveau : reprise immédiate ; plus rien après la déconnexion', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } }); await boot(env); const { page, fake } = env;
  const beats = () => (fake.state.presenceCalls || []).length;
  await page.evaluate(() => { const o = ACCOUNT.touchPresence; window.__beats = []; ACCOUNT.touchPresence = function () { window.__beats.push(Date.now()); return o.apply(this, arguments); }; });
  await advance(page, 5500); await settle(page); assert.equal(beats(), 1, 'premier battement dans les 5 s'); assert.ok(fake.presence.size === 1, 'une date par compte');
  await advance(page, 25000); await settle(page); assert.equal(beats(), 1, 'pas de battement avant 30 s');
  await advance(page, 200000); await settle(page);
  const times = await page.evaluate(() => window.__beats); assert.ok(times.length >= 7 && times.length <= 8, 'environ un par 30 s sur 230 s : ' + times.length);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 30000 && times[i] - times[i - 1] <= 32500, 'écart entre deux battements (temps du navigateur) : ' + (times[i] - times[i - 1]));
  const sent = fake.state.presenceCalls; assert.ok(sent.every(c => c.method === 'POST' && c.body === '{}' && /^Bearer /.test(c.auth)), 'corps vide, jeton du compte'); assert.equal(sent.length, times.length);
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); }); const n = beats();
  await advance(page, 120000); await settle(page); assert.equal(beats(), n, 'page cachée : aucun battement');
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }); await settle(page); assert.equal(beats(), n + 1, 'visible de nouveau : battement tout de suite');
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status === 'visitor'); const m = beats();
  await advance(page, 120000); await settle(page); assert.equal(beats(), m, 'déconnecté : plus rien');
  clean(env); await env.close();
});

test('PRB2 visiteur sans compte : aucun battement ; fonction absente de la base : un seul essai puis silence, sans message ni erreur', opts, async () => {
  const v = await H.open(browser, server, {}); await boot(v, true); await advance(v.page, 120000); await settle(v.page);
  assert.equal((v.fake.state.presenceCalls || []).length, 0, 'visiteur : aucun appel'); clean(v); await v.close();
  const fake = H.createFake(); fake.state.presenceMode = 'missing';
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake }); await boot(env); const { page } = env;
  await advance(page, 200000); await settle(page);
  assert.equal(fake.state.presenceCalls.length, 1, 'un seul essai, puis plus rien pendant la session'); assert.equal(await page.locator('#toast.show').count(), 0, 'aucun message');
  clean(env); await env.close();
});
