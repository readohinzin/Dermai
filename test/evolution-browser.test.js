'use strict';
/* DERMAI Évolution dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (voir test/helpers/browser-harness.js).
   Prouve, avec l'application réelle : le bilan s'affiche AVANT les graphiques et tableaux ; classement des variations ; raccourcis (première analyse, début du programme) ;
   analyses non enregistrées exclues ; photos côte à côte (liens temporaires jamais stockés) ; consulter ou comparer n'appelle ni /api/skin-analysis, ni Perfect Corp,
   ni Supabase ; isolation entre comptes ; rendu à 420 px sans débordement. Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const SkinModel = require('../js/skin-model.js');

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

/* Le programme n'accepte que des identifiants de forme UUID pour l'analyse de départ (js/engine/program.js) : les données de test les imitent. */
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-12T09:00:00');
const text = page => page.evaluate(() => document.getElementById('app').innerText);
const html = page => page.evaluate(() => document.getElementById('app').innerHTML);
const uidOf = page => page.evaluate(() => ACCOUNT.user.id);

/* Ligne skin_analyses telle que la base la renvoie : indicateurs à 50 sauf surcharges. */
const row = (id, day, over = {}, global = 60) => {
  const metrics = {};
  SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = k in over ? over[k] : 50; });
  return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: global, skin_type: 'combination', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' };
};
const seed = (env, rows, uid = env.stats.session.user.id) => env.fake.analyses.set(uid, rows.map(r => Object.assign({ user_id: uid }, r)));
const ROWS = () => [
  row(ID(1), 1, { acne: 40, redness: 50, pores: 50, oiliness: 50, eyeBag: 50 }, 58),
  row(ID(2), 5, { acne: 46, redness: 44, pores: 51, oiliness: 70, eyeBag: 55 }, 61),
  row(ID(3), 11, { acne: 55, redness: 44, pores: 52, oiliness: 40, eyeBag: 40 }, 64)
];
async function boot(env, route = 'progress') {
  const { page } = env;
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  if (route) await page.evaluate(r => go(r), route);
}
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u)));
};
const withPhotos = (page, which) => page.evaluate(async w => {
  const mkUrl = color => new Promise(res => { const c = document.createElement('canvas'); c.width = 60; c.height = 80; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 60, 80); c.toBlob(b => res(URL.createObjectURL(b)), 'image/jpeg'); });
  const a = SCANS[state.cmpA], b = SCANS[state.cmpB];
  a.photo = w.a ? await mkUrl('#b07a5a') : ''; b.photo = w.b ? await mkUrl('#a06a4a') : '';
  render(true);
}, which);

test('EB1 le bilan s\'affiche en premier, classe les variations, garde l\'avertissement ; aucun appel d\'analyse ni de simulation', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS()); await boot(env);
  const { page } = env;
  const t = await text(page);
  assert.match(t, /Bilan de votre évolution/);
  const h = await html(page);
  assert.ok(h.indexOf('id="evo-title"') > 0 && h.indexOf('id="evo-title"') < h.indexOf('Avant, maintenant') && h.indexOf('id="evo-title"') < h.indexOf('Comparer deux analyses'), 'bilan avant graphique et tableaux');
  // sélection par défaut : r2 (5 oct.) → r3 (11 oct.)
  const g = await page.evaluate(() => [...document.querySelectorAll('.c-evo__group')].map(x => [x.querySelector('.c-evo__title').childNodes[0].textContent.trim(), x.innerText]));
  const by = Object.fromEntries(g.map(([k, v]) => [k, v]));
  assert.match(by['Score en hausse'], /Acné et imperfections|Acné/); assert.match(by['Score en hausse'], /46 → 55/);
  assert.match(by['Variation faible'], /51 → 52/);
  assert.ok(!by['Score en baisse'], 'redness 44 → 44 : rien en baisse'); assert.ok(by['Variation observée'], 'huile en variation observée'); assert.match(by['Variation observée'], /70 → 40/);
  assert.match(by['Contour des yeux, à titre indicatif'], /55 → 40/);
  assert.ok(!/c-delta--(up|down)/.test(await page.evaluate(() => [...document.querySelectorAll('.c-evo__group')].filter(x => /Variation observée|Contour des yeux/.test(x.innerText)).map(x => x.innerHTML).join(''))), 'rubriques neutres sans jugement');
  assert.ok(t.includes('Ces résultats décrivent les variations de scores de l\'analyse. Ils ne prouvent pas à eux seuls une amélioration clinique ni l\'efficacité d\'un produit. Les conditions de prise de vue et les variations de mesure peuvent influencer les résultats.'));
  assert.match(t, /valeur technique provisoire/);
  assert.match(t, /Votre évolution/); assert.match(t, /Avant, maintenant/); assert.match(t, /Comparer deux analyses/); assert.match(t, /Vos priorités actuelles, depuis l'analyse précédente|Score global/);
  assert.equal(env.stats.skin.length, 0); assert.equal(env.stats.sim.length, 0);
  clean(env); await env.close();
});

test('EB2 raccourci « Depuis ma première analyse », puis choix manuel des deux analyses : aucun appel réseau', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS()); await boot(env);
  const { page } = env, before = env.stats.supabase.length;
  await page.click('[data-evo=first]');
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), [0, 2]);
  let t = await text(page);
  assert.match(t, /Du 1 octobre au 11 octobre/); assert.match(t, /40 → 55/);
  await page.selectOption('#sa', '1'); await page.selectOption('#sb', '2');
  t = await text(page); assert.match(t, /Du 5 octobre au 11 octobre/); assert.match(t, /46 → 55/);
  await page.selectOption('#sa', '2'); await page.selectOption('#sb', '0');   // ordre inversé : lecture chronologique
  t = await text(page); assert.match(t, /Du 1 octobre au 11 octobre/); assert.match(t, /Les analyses sont présentées dans l'ordre des dates/);
  await page.selectOption('#sa', '1'); await page.selectOption('#sb', '1');
  assert.match(await text(page), /Choisissez deux analyses différentes/);
  assert.equal(env.stats.supabase.length, before, 'aucune requête Supabase pour consulter ou comparer');
  assert.equal(env.stats.skin.length, 0); assert.equal(env.stats.sim.length, 0);
  clean(env); await env.close();
});

test('EB3 historique incomplet : pas de faux « première analyse »', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS()); await boot(env);
  await env.page.evaluate(() => { state.history.hasMore = true; render(true); });
  assert.equal(await env.page.locator('[data-evo=first]').count(), 0);
  assert.match(await text(env.page), /Voir plus d'analyses/);
  clean(env); await env.close();
});

test('EB4 sélection par défaut avec une analyse non enregistrée : le bilan porte sur les analyses enregistrées ; le choix manuel d\'une non enregistrée est exclu avec un message', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS().slice(0, 2)); await boot(env, null);
  const { page } = env;
  await page.evaluate(() => { SCANS.push(Object.assign({}, SCANS[SCANS.length - 1], { id: SCANS.length, saved: false, rec: undefined, analyzedAt: '2026-10-12T08:00:00.000Z' })); state.cmpA = 1; state.cmpB = 2; go('progress'); });
  let t = await text(page);
  assert.ok(await page.locator('.c-evo__group').count(), 'bilan produit à partir des analyses enregistrées');
  assert.match(t, /Du 1 octobre au 5 octobre/); assert.match(t, /Une analyse récente n'est pas encore enregistrée dans votre historique/); assert.match(t, /vos deux dernières analyses enregistrées/);
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), [0, 1]);
  assert.deepEqual(await page.evaluate(() => [sa.value, sb.value]), ['0', '1'], 'les listes montrent les analyses réellement comparées');
  // choix manuel de l'analyse non enregistrée : respecté, exclu du bilan, message clair
  await page.selectOption('#sa', '1'); await page.selectOption('#sb', '2');
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), [1, 2], 'le choix manuel n\'est pas écrasé');
  t = await text(page);
  assert.match(t, /n'est pas encore enregistrée dans votre historique : elle n'est pas incluse dans ce bilan/);
  assert.ok(!(await page.locator('.c-evo__group').count()), 'aucun classement avec une analyse non enregistrée');
  assert.match(t, /Comparer deux analyses/, 'le comparatif existant reste disponible');
  await page.selectOption('#sa', '0'); await page.selectOption('#sb', '1');
  assert.ok(await page.locator('.c-evo__group').count());
  // raccourcis : uniquement des analyses enregistrées
  await page.click('[data-evo=first]');
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), [0, 1]);
  clean(env); await env.close();
});

test('EB10 cause réelle : une analyse dont l\'enregistrement échoue ne bloque plus le bilan des analyses enregistrées', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  seed(env, ROWS().slice(0, 2)); await boot(env, null);
  const { page } = env;
  await page.goto('/scan');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  fake.state.failAnalyses = true;                                   // la sauvegarde de la nouvelle analyse échoue : elle reste en mémoire, saved:false
  await page.waitForSelector('[data-act=scan-start]'); await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  await page.setInputFiles('#realGalleryInput', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) });
  await page.waitForSelector('[data-act=analyze]'); await page.click('[data-act=analyze]');
  await page.waitForFunction(() => state.route === 'result', null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => SCANS[SCANS.length - 1].saved), false, 'la dernière analyse n\'est pas enregistrée');
  assert.equal(await page.evaluate(() => SCANS.filter(s => s.saved).length), 2);
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB, SCANS.length]), [1, 2, 3], 'sélection par défaut posée par l\'application : l\'avant-dernière et la dernière (non enregistrée)');
  const calls = env.stats.skin.length;
  await page.evaluate(() => go('progress'));
  const t = await text(page);
  assert.ok(await page.locator('.c-evo__group').count(), 'bilan produit');
  assert.match(t, /Du 1 octobre au 5 octobre/); assert.match(t, /vos deux dernières analyses enregistrées/);
  assert.ok(!/Choisissez deux analyses/.test(t));
  assert.equal(env.stats.skin.length, calls, 'consulter ne relance aucune analyse'); assert.equal(env.stats.sim.length, 0);
  await env.close();
});

test('EB11 une seule analyse enregistrée et une non enregistrée plus récente : état explicite', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS().slice(0, 1)); await boot(env, null);
  const { page } = env;
  await page.evaluate(() => { SCANS.push(Object.assign({}, SCANS[0], { id: 1, saved: false, rec: undefined, analyzedAt: '2026-10-12T08:00:00.000Z' })); state.cmpA = 0; state.cmpB = 1; go('progress'); });
  const t = await text(page);
  assert.match(t, /Une seule analyse est enregistrée dans votre historique : une comparaison nécessite une seconde analyse enregistrée/);
  assert.equal(await page.locator('.c-evo__group').count(), 0); assert.equal(await page.locator('[data-evo]').count(), 0);
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), [0, 1]);
  assert.match(t, /Comparer deux analyses/, 'le comparatif existant reste disponible');
  clean(env); await env.close();
});

test('EB12 aucune analyse enregistrée : état vide explicite', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env, null);
  const { page } = env;
  await page.evaluate(() => {
    state.history.status = 'ready';
    const n = (g) => { const o = { globalScore: g }; SkinModel.METRIC_KEYS.forEach(k => { o[k] = { uiScore: 50, rawScore: 50 }; }); return o; };
    SCANS.length = 0;
    [['2026-10-03T08:00:00.000Z', 50], ['2026-10-09T08:00:00.000Z', 55]].forEach(([at, g], i) => SCANS.push({ id: i, real: true, saved: false, analyzedAt: at, normalized: n(g), photo: '', date: 'x', short: 'x' }));
    state.cmpA = 0; state.cmpB = 1; go('progress');
  });
  const t = await text(page);
  assert.match(t, /Aucune analyse n'est enregistrée dans votre historique : le bilan nécessite au moins deux analyses enregistrées/);
  assert.equal(await page.locator('.c-evo__group').count(), 0); assert.equal(await page.locator('[data-evo]').count(), 0);
  assert.deepEqual(env.errors, []);
  await env.close();
});

test('EB5 photos : côte à côte avec deux photos, état explicite avec une seule ou aucune ; le curseur avant/après reste ; aucun lien conservé', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS()); await boot(env);
  const { page } = env;
  await withPhotos(page, { a: true, b: true });
  assert.equal(await page.locator('.c-evo__fig img').count(), 2);
  assert.ok(await page.locator('#cmp').count(), 'curseur avant/après conservé');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.c-evo__fig img')].map(i => i.complete && i.naturalWidth > 0)), [true, true]);
  const cap = await page.evaluate(() => [...document.querySelectorAll('.c-evo__fig figcaption')].map(x => x.innerText));
  assert.match(cap[0], /^Avant · 5 octobre/); assert.match(cap[1], /^Maintenant · 11 octobre/);
  const box = await page.evaluate(() => [...document.querySelectorAll('.c-evo__fig')].map(f => { const r = f.getBoundingClientRect(); return [r.left, r.right, r.top]; }));
  assert.ok(box[0][1] <= box[1][0] + 1 && Math.abs(box[0][2] - box[1][2]) < 2, 'côte à côte, sur la même ligne');
  const store = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage].map(s => Object.fromEntries(Object.entries(s)))));
  assert.ok(!/blob:|token=|\/object\/sign/.test(store), 'aucun lien de photo n\'est conservé dans le navigateur');
  await withPhotos(page, { a: true, b: false });
  assert.equal(await page.locator('.c-evo__fig img').count(), 1); assert.match(await text(page), /Une seule photo est disponible/); assert.equal(await page.locator('#cmp').count(), 0, 'pas de faux avant/après');
  assert.match(await text(page), /Bilan de votre évolution/);
  await withPhotos(page, { a: false, b: false });
  assert.equal(await page.locator('.c-evo__fig img').count(), 0); assert.match(await text(page), /Aucune photo n'est affichée/);
  assert.ok(await page.locator('.c-evo__group').count(), 'le bilan des scores reste disponible sans photo');
  assert.equal(env.stats.skin.length, 0); clean(env); await env.close();
});

test('EB6 programme : bouton « Voir mon évolution depuis le début du programme » → analyse de départ + dernière analyse enregistrée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS().slice(0, 2)); await boot(env, 'program');
  const { page } = env;
  await page.click('[data-cp=start]');                     // base du programme = la plus récente analyse (r2)
  assert.match(await text(page), /Voir mon évolution depuis le début du programme/);
  const st = await page.evaluate(u => JSON.parse(localStorage.getItem('dermai.care.' + u)), await uidOf(page));
  assert.equal(st.plan.base.id, ID(2));
  assert.match(await text(page), /ne disent pas que le programme a causé les variations/);
  // aucune analyse plus récente : message adapté, sélection non remplacée en silence
  await page.click('[data-cp=evolution]');
  await page.waitForFunction(() => state.route === 'progress');
  assert.match(await text(page), /Aucune analyse n'est plus récente que celle du début de votre programme/);
  assert.equal(await page.locator('[data-evo=program]').count(), 0);
  // une analyse plus récente arrive (autre appareil) : le raccourci la retient
  seed(env, ROWS());
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready');
  await page.evaluate(() => go('program'));
  assert.equal(await page.evaluate(u => JSON.parse(localStorage.getItem('dermai.care.' + u)).plan.base.id, await uidOf(page)), ID(2));
  await page.click('[data-cp=evolution]');
  await page.waitForFunction(() => state.route === 'progress');
  assert.deepEqual(await page.evaluate(() => [SCANS[state.cmpA].rec.id, SCANS[state.cmpB].rec.id]), [ID(2), ID(3)]);
  const t = await text(page);
  assert.match(t, /Du 5 octobre au 11 octobre/); assert.match(t, /Programme commencé le/); assert.match(t, /ne disent pas que le programme a causé les variations/);
  assert.match(t, /Depuis le début du programme/);
  await page.selectOption('#sa', '0');                     // l'utilisatrice peut toujours changer
  assert.match(await text(page), /Du 1 octobre au 11 octobre/);
  assert.equal(env.stats.skin.length, 0); clean(env); await env.close();
});

test('EB7 programme dont l\'analyse de départ est introuvable : explication, aucune autre analyse choisie', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS().slice(0, 2)); await boot(env, 'program');
  const { page } = env;
  await page.click('[data-cp=start]');
  seed(env, [row(ID(9), 3), row(ID(10), 9)]);   // l'analyse de départ n'existe plus
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready');
  await page.evaluate(() => go('program'));
  const sel = await page.evaluate(() => [state.cmpA, state.cmpB]);
  await page.click('[data-cp=evolution]');
  await page.waitForFunction(() => state.route === 'progress');
  assert.match(await text(page), /analyse de départ de votre programme est introuvable/);
  assert.deepEqual(await page.evaluate(() => [state.cmpA, state.cmpB]), sel, 'sélection inchangée');
  assert.equal(await page.locator('[data-evo=program]').count(), 0);
  clean(env); await env.close();
});

test('EB8 isolation : le bilan et le raccourci du programme d\'un compte n\'apparaissent jamais chez un autre', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  const { page } = env;
  seed(env, ROWS().slice(0, 2)); await boot(env, 'program');
  const a = await uidOf(page);
  await page.click('[data-cp=start]');
  fake.analyses.set(a, ROWS().map(r => Object.assign(r, { user_id: a })));
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready');
  await page.evaluate(() => go('progress'));
  assert.equal(await page.locator('[data-evo=program]').count(), 1);
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => logout());
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const b = await uidOf(page); assert.notEqual(a, b);
  fake.analyses.set(b, [row(ID(21), 2, { acne: 10 }), row(ID(22), 8, { acne: 90 })].map(r => Object.assign(r, { user_id: b })));
  await page.reload(); await page.waitForFunction(() => state.history.status === 'ready');
  await page.evaluate(() => go('progress'));
  const t = await text(page);
  assert.match(t, /10 → 90/); assert.ok(!/46 → 55|40 → 55/.test(t), 'aucune valeur de A chez B');
  assert.equal(await page.locator('[data-evo=program]').count(), 0, 'B n\'a pas de programme : aucun raccourci');
  assert.deepEqual(await page.evaluate(() => SCANS.map(s => s.rec.id)), [ID(21), ID(22)]);
  await page.evaluate(() => logout());
  assert.ok(!/10 → 90/.test(await text(page)), 'rien ne reste affiché après la déconnexion');
  clean(env); await env.close();
});

test('EB9 mobile 420 px : aucun débordement horizontal, commandes d\'au moins 44 px, textes lisibles', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env, ROWS()); await boot(env);
  const { page } = env;
  await page.click('[data-evo=first]');
  await withPhotos(page, { a: true, b: true });
  const m = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('.c-evo, .c-evo *, #sa, #sb, #cmpbox')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); }).map(e => e.tagName + '.' + e.className);
    const h = sel => [...document.querySelectorAll(sel)].map(e => Math.round(e.getBoundingClientRect().height));
    return { W, sw: document.documentElement.scrollWidth, out, btn: h('[data-evo]'), sel: h('#sa, #sb'), fig: h('.c-evo__fig img') };
  });
  assert.equal(m.W, 420); assert.ok(m.sw <= 420, 'scrollWidth ' + m.sw); assert.deepEqual(m.out, []);
  assert.ok(m.btn.length >= 1 && m.btn.every(x => x >= 44), 'boutons ' + m.btn);
  assert.ok(m.sel.length === 2 && m.sel.every(x => x >= 40), 'sélecteurs ' + m.sel);
  assert.ok(m.fig.length === 2 && m.fig.every(x => x > 60), 'photos ' + m.fig);
  const fs = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.c-evo p, .c-evo li, .c-evo h3')].map(e => parseFloat(getComputedStyle(e).fontSize))));
  assert.ok(fs >= 13, 'taille de texte minimale ' + fs);
  clean(env); await env.close();
});
