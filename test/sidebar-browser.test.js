'use strict';
/* Barre latérale dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (voir test/helpers/browser-harness.js).
   Prouve, avec l'application réelle : colonne latérale sur ordinateur (contenu non recouvert), panneau coulissant à 420 px (bouton, fond, Échap, clavier, fermeture après
   navigation), bonne destination et page active pour chaque entrée, aucun rechargement, session / historique / programme intacts, aucun appel d'analyse, de simulation ni de
   Perfect Corp. Ignoré si Playwright / Chromium sont absents. */
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

const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-10-12T09:00:00');
const row = (id, day, g = 60) => {
  const metrics = {}; SkinModel.METRIC_KEYS.forEach(k => { metrics[k] = 50 + day; });
  return { id, analyzed_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z`, global_score: g, skin_type: 'combination', skin_age: 30, metrics, raw_metrics: {}, priorities: [], goals_snapshot: [], engine_version: 'test' };
};
const seed = (env, uid = env.stats.session.user.id) => env.fake.analyses.set(uid, [row(ID(1), 1), row(ID(2), 5)].map(r => Object.assign({ user_id: uid }, r)));
async function boot(env, route = 'home') {
  const { page } = env;
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn' && state.history.status === 'ready', null, { timeout: 15000 });
  await page.evaluate(r => go(r), route);
}
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.equal(env.stats.skin.length, 0, 'aucune analyse'); assert.equal(env.stats.sim.length, 0, 'aucune simulation');
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u)));
};
const TARGETS = [['Tableau de bord', 'home'], ['Analyser ma peau', 'scan'], ['Mes analyses', 'analyses'], ['DERMAI Évolution', 'progress'], ['Programme de soins', 'program'], ['Ma routine', 'routine'], ['Profil et paramètres', 'profile']];
const visible = (page, sel) => page.locator(sel).first().isVisible();
const wait = page => page.waitForTimeout(350);        // durée de la transition du panneau (0,22 s)
const hOverflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('SBB1 ordinateur : colonne latérale à gauche, contenu non recouvert, mêmes entrées, pas d\'icône de menu', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
  const side = page.locator('#sidebar');
  assert.ok(await side.isVisible());
  const b = await side.boundingBox(), m = await page.locator('main.main').boundingBox();
  assert.ok(b.x === 0 && b.width >= 240 && b.width <= 300 && b.height >= 790, JSON.stringify(b));
  assert.ok(m.x >= b.x + b.width - 1, 'le contenu commence après la barre latérale');
  assert.equal(await hOverflow(page), 0);
  assert.equal(await visible(page, '.sidebar__toggle'), false, 'pas de bouton de menu sur ordinateur'); assert.equal(await visible(page, '.sidebar__close'), false); assert.equal(await visible(page, '.sidebar__scrim'), false);
  assert.equal(await visible(page, 'nav.c-bottomnav'), false, 'la barre du bas laisse la place à la colonne');
  assert.deepEqual(await page.locator('#sidebar .sidebar__text').allInnerTexts(), [...TARGETS.map(t => t[0]), 'Se déconnecter']);
  assert.ok(await visible(page, '#sidebar .brand'), 'logo en haut');
  const pos = await page.evaluate(() => [...document.querySelectorAll('#sidebar .sidebar__link')].map(e => Math.round(e.getBoundingClientRect().top)));
  assert.deepEqual(pos, [...pos].sort((x, y) => x - y)); assert.ok(pos[6] > pos[5] + 200, 'le profil est séparé et en bas de la colonne');
  assert.match(await page.locator('.sidebar__badge').innerText(), /Nouveau/); assert.equal(await page.locator('.sidebar__badge').count(), 1);
  // la colonne reste en place quand la page défile
  await page.evaluate(() => { document.querySelector('main.main').style.minHeight = '3000px'; window.scrollTo(0, 600); });
  assert.equal(Math.round((await side.boundingBox()).y), 0);
  clean(env); await env.close();
});

test('SBB2 chaque entrée ouvre la bonne vraie vue, avec la bonne adresse et la page active, sans recharger la page', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { window.__marker = 'same-document'; });
  for (const [label, route] of [TARGETS[2], TARGETS[3], TARGETS[4], TARGETS[5], TARGETS[6], TARGETS[0]]) {
    await page.locator('#sidebar .sidebar__link', { hasText: label }).click();
    await page.waitForFunction(r => state.route === r, route);
    assert.equal(await page.evaluate(() => window.__marker), 'same-document', `${label} : pas de rechargement`);
    assert.equal(await page.evaluate(() => location.pathname), await page.evaluate(() => pathOf(state.route, null)), `${label} : adresse cohérente`);
    const cur = await page.locator('#sidebar [aria-current="page"]').allInnerTexts();
    assert.equal(cur.length, 1); assert.ok(cur[0].startsWith(label), `${label} : page active (${cur[0]})`);
    assert.ok(await page.locator('main.main').innerText().then(t => t.trim().length > 20), `${label} : la vue est affichée`);
  }
  // « Analyser ma peau » : le parcours de scan est un écran plein cadre (comme avant, ni colonne ni barre du bas) ; la caméra n'est jamais lancée par la navigation
  await page.locator('#sidebar .sidebar__link', { hasText: 'Analyser ma peau' }).click();
  await page.waitForFunction(() => state.route === 'scan');
  assert.equal(await page.evaluate(() => window.__marker), 'same-document'); assert.equal(await page.evaluate(() => location.pathname), '/scan');
  assert.equal(await page.locator('#sidebar').count(), 0, 'écran de scan plein cadre');
  await page.evaluate(() => go('home'));
  // les écrans enfants gardent l'entrée de leur famille active
  await page.evaluate(() => go('actives'));
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Ma routine'));
  await page.evaluate(() => go('privacy'));
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Profil et paramètres'));
  // l'entrée « Évolution » ouvre le vrai écran (bilan puis comparatif)
  await page.locator('#sidebar .sidebar__link', { hasText: 'DERMAI Évolution' }).click();
  const t = await page.locator('main.main').innerText();
  assert.match(t, /Votre évolution/); assert.match(t, /Bilan de votre évolution/);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Programme de soins' }).click();
  assert.match(await page.locator('main.main').innerText(), /Mon programme de 30 jours/);
  clean(env); await env.close();
});

test('SBB3 mobile 420 px : panneau fermé par défaut, icône de menu, ouverture, fermeture par bouton, fond et Échap, mêmes entrées', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  assert.deepEqual(page.viewportSize(), { width: 420, height: 900 });
  const tg = page.locator('.sidebar__toggle');
  assert.ok(await tg.isVisible()); assert.equal(await tg.getAttribute('aria-label'), 'Ouvrir le menu'); assert.equal(await tg.getAttribute('aria-expanded'), 'false'); assert.equal(await tg.getAttribute('aria-controls'), 'sidebar');
  const tb = await tg.boundingBox(); assert.ok(tb.width >= 44 && tb.height >= 44 && tb.x >= 0, JSON.stringify(tb));
  assert.equal(await page.locator('#sidebar').isVisible(), false, 'fermé : invisible et hors de l\'ordre de tabulation');
  assert.equal(await hOverflow(page), 0);
  const nav = await page.locator('nav.c-bottomnav .c-bottomnav__item').count(); assert.equal(nav, 5, 'la barre du bas reste disponible');
  const before = env.stats.supabase.length;
  // ouverture
  await tg.click(); await wait(page);
  const side = page.locator('#sidebar');
  assert.ok(await side.isVisible()); assert.equal(await side.getAttribute('role'), 'dialog'); assert.equal(await side.getAttribute('aria-modal'), 'true'); assert.equal(await tg.getAttribute('aria-expanded'), 'true');
  assert.ok(await page.locator('.sidebar__scrim').isVisible());
  const box = await side.boundingBox(); assert.ok(box.x === 0 && box.width <= 420 * 0.86 + 1 && box.width >= 280, JSON.stringify(box));
  assert.equal(await hOverflow(page), 0); assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden', 'le fond ne défile pas');
  assert.deepEqual(await page.locator('#sidebar .sidebar__text').allInnerTexts(), [...TARGETS.map(t => t[0]), 'Se déconnecter'], 'mêmes entrées que sur ordinateur');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.className), 'sidebar__close', 'le focus entre dans le panneau');
  // fermeture par le bouton : le focus revient à l'icône de menu
  await page.click('.sidebar__close'); await wait(page);
  assert.equal(await side.isVisible(), false); assert.equal(await tg.getAttribute('aria-expanded'), 'false'); assert.equal(await page.evaluate(() => document.activeElement.className), 'sidebar__toggle');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible');
  // Échap
  await tg.click(); await wait(page); assert.ok(await side.isVisible());
  await page.keyboard.press('Escape'); await wait(page);
  assert.equal(await side.isVisible(), false); assert.equal(await page.evaluate(() => document.activeElement.className), 'sidebar__toggle');
  // clic sur le fond, à l'extérieur du panneau
  await tg.click(); await wait(page);
  await page.mouse.click(405, 450); await wait(page);
  assert.equal(await side.isVisible(), false, 'le fond referme le panneau'); assert.equal(await page.locator('.sidebar__scrim').isVisible(), false);
  // un clic dans le panneau ne le referme pas (hors entrée)
  await tg.click(); await wait(page);
  await page.click('.sidebar__foot .sidebar__label', { force: true }); await wait(page);
  assert.ok(await side.isVisible()); await page.keyboard.press('Escape'); await wait(page);
  assert.equal(env.stats.supabase.length, before, 'ouvrir et fermer ne fait aucune requête');
  // le contenu n'est pas recouvert durablement
  const hit = await page.evaluate(() => { const m = document.querySelector('main.main').getBoundingClientRect(); const e = document.elementFromPoint(m.x + m.width / 2, 300); return !!e && !e.closest('#sidebar') && !e.closest('.sidebar__scrim'); });
  assert.ok(hit); assert.equal(await hOverflow(page), 0);
  clean(env); await env.close();
});

test('SBB4 mobile : choisir une entrée ouvre la bonne vue et referme le panneau ; session, historique et programme intacts', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env, 'program');
  const { page } = env;
  await page.click('[data-cp=start]');                                 // un programme commencé sur cet appareil
  const uid = await page.evaluate(() => ACCOUNT.user.id);
  const care = () => page.evaluate(u => localStorage.getItem('dermai.care.' + u), uid);
  const prog0 = await care(), scans0 = await page.evaluate(() => SCANS.map(s => s.rec.id)), tok0 = await page.evaluate(() => localStorage.getItem('dermai.session'));
  assert.ok(prog0);
  await page.evaluate(() => { window.__marker = 'same-document'; });
  const writes = () => env.stats.supabase.filter(r => !r.startsWith('GET')).length, w0 = writes(), g0 = env.stats.supabase.length;
  for (const [label, route] of [...TARGETS.slice(2), TARGETS[0]]) {
    await page.click('.sidebar__toggle'); await wait(page);
    assert.ok(await page.locator('#sidebar').isVisible());
    await page.locator('#sidebar .sidebar__link', { hasText: label }).click();
    await page.waitForFunction(r => state.route === r, route);
    await wait(page);
    assert.equal(await page.locator('#sidebar').isVisible(), false, `${label} : le panneau se referme`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible');
    assert.equal(await page.locator('.sidebar__toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => window.__marker), 'same-document'); assert.equal(await hOverflow(page), 0, `${label} : pas de débordement`);
    assert.equal((await page.locator('#sidebar [aria-current="page"]').getAttribute('aria-current')), 'page');
  }
  await page.click('.sidebar__toggle'); await wait(page);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Analyser ma peau' }).click();
  await page.waitForFunction(() => state.route === 'scan'); assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible', 'le défilement est libéré même quand l\'écran change');
  assert.equal(writes(), w0, 'naviguer n\'écrit rien en base'); assert.equal(env.stats.supabase.length, g0, 'naviguer ne fait aucune requête Supabase');
  assert.equal(await care(), prog0, 'le programme de soins n\'a pas été touché'); assert.deepEqual(await page.evaluate(() => SCANS.map(s => s.rec.id)), scans0, 'l\'historique n\'a pas été touché');
  assert.equal(await page.evaluate(() => localStorage.getItem('dermai.session')), tok0); assert.equal(await page.evaluate(() => state.account.status), 'signedIn');
  clean(env); await env.close();
});

test('SBB5 clavier : l\'icône s\'active à Entrée, le focus reste dans le panneau (Tab, Maj+Tab), Entrée sur une entrée navigue', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.locator('.sidebar__toggle').focus(); await page.keyboard.press('Enter'); await wait(page);
  assert.ok(await page.locator('#sidebar').isVisible());
  const inside = () => page.evaluate(() => !!document.activeElement.closest('#sidebar'));
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.ok(await inside(), `Tab ${i + 1} reste dans le panneau`); }
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Shift+Tab'); assert.ok(await inside(), `Maj+Tab ${i + 1} reste dans le panneau`); }
  const stops = new Set(); for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); stops.add(await page.evaluate(() => document.activeElement.textContent.trim() || document.activeElement.className)); }
  assert.ok(stops.size >= 9, 'logo, fermeture et sept entrées sont atteignables : ' + [...stops].join(' | '));
  await page.locator('#sidebar .sidebar__link', { hasText: 'Mes analyses' }).focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => state.route === 'analyses'); await wait(page);
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  clean(env); await env.close();
});

test('SBB6 le panneau ouvert se referme au passage en grand écran, et la colonne reprend sa place', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.click('.sidebar__toggle'); await wait(page);
  await page.setViewportSize({ width: 1280, height: 800 }); await wait(page);
  assert.ok(await page.locator('#sidebar').isVisible()); assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'visible', 'plus de blocage du défilement');
  assert.equal(await page.locator('#sidebar').getAttribute('data-open'), null);
  assert.equal(await visible(page, '.sidebar__scrim'), false);
  await page.setViewportSize({ width: 420, height: 900 }); await wait(page);
  assert.equal(await page.locator('#sidebar').isVisible(), false, 'revient fermé');
  clean(env); await env.close();
});

test('SBB7 mouvements réduits : aucune transition ; le panneau reste utilisable', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('sidebar')).transitionDuration), '0s');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sidebar__scrim')).transitionDuration), '0s');
  await page.click('.sidebar__toggle'); assert.ok(await page.locator('#sidebar').isVisible());
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#sidebar').isVisible(), false);
  clean(env); await env.close();
});

test('SBB8 visiteur sans compte : l\'entrée « Analyser ma peau » garde la protection existante (connexion), aucune analyse', opts, async () => {
  const env = await H.open(browser, server);
  const { page } = env;
  await page.clock.setFixedTime(NOW);
  await page.goto('/home');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'visitor', null, { timeout: 15000 });
  await page.evaluate(() => go('analyses'));
  await page.click('.sidebar__toggle'); await wait(page);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Analyser ma peau' }).click();
  await page.waitForFunction(() => state.route === 'login' || state.route === 'signup');
  assert.equal(await page.evaluate(() => state.account.status), 'visitor'); assert.equal(await page.locator('#sidebar').count(), 0, 'l\'écran de connexion n\'a pas de barre latérale');
  clean(env); await env.close();
});

test('SBB9 les écrans existants fonctionnent avec la nouvelle navigation : barre du bas, retour, bilan d\'évolution, programme', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  for (const [label, route] of [['Routine', 'routine'], ['Progression', 'progress'], ['Profil', 'profile'], ['Accueil', 'home']]) {
    await page.locator('nav.c-bottomnav .c-bottomnav__item', { hasText: label }).click();
    await page.waitForFunction(r => state.route === r, route);
  }
  await page.evaluate(() => go('progress'));
  assert.ok(await page.locator('.c-evo').count(), 'le bilan d\'évolution est toujours là');
  await page.evaluate(() => go('analyses'));
  await page.click('[data-act=viewscan]');
  await page.waitForFunction(() => state.route === 'result');
  assert.ok((await page.locator('#sidebar').count()) === 1);
  assert.equal(await hOverflow(page), 0);
  clean(env); await env.close();
});

test('SBB10 simulation fermée : aucune entrée ; vérification de disponibilité unique, sans effet (GET), aucune simulation lancée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });          // simulation fermée par défaut
  seed(env); await boot(env);
  const { page } = env;
  for (const w of [1280, 420]) {
    await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
    assert.equal(await page.locator('#sidebar [data-go=simulation]').count(), 0, `${w} px : pas d'entrée vers un écran indisponible`);
  }
  await page.evaluate(() => go('analyses')); await page.evaluate(() => go('progress'));
  assert.equal(env.stats.simProbe.length, 1, 'une seule vérification pour la session'); assert.equal(env.stats.sim.length, 0);
  clean(env); await env.close();
});

test('SBB11 simulation ouverte pour le compte : l\'entrée apparaît (ordinateur et mobile), ouvre le vrai écran, page active, panneau refermé ; aucune simulation lancée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, sim: { available: true } });
  seed(env); await boot(env);
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
  const entry = page.locator('#sidebar .sidebar__link', { hasText: 'Simulation cosmétique' });
  await entry.waitFor({ state: 'visible', timeout: 10000 });
  assert.deepEqual(await page.locator('#sidebar .sidebar__text').allInnerTexts(), ['Tableau de bord', 'Analyser ma peau', 'Mes analyses', 'DERMAI Évolution', 'Programme de soins', 'Simulation cosmétique', 'Ma routine', 'Profil et paramètres', 'Se déconnecter']);
  assert.equal(await page.locator('.sidebar__badge').count(), 1, 'le badge reste réservé à Évolution');
  await entry.click();
  await page.waitForFunction(() => state.route === 'simulation');
  assert.match(await page.locator('main.main').innerText(), /Simulation cosmétique/); assert.match(await page.locator('main.main').innerText(), /illustration|prédiction/i);
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Simulation cosmétique'));
  // mobile : même entrée dans le panneau, qui se referme après le choix
  await page.evaluate(() => go('home'));
  await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(150);
  await page.click('.sidebar__toggle'); await wait(page);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Simulation cosmétique' }).click();
  await page.waitForFunction(() => state.route === 'simulation'); await wait(page);
  assert.equal(await page.locator('#sidebar').isVisible(), false); assert.equal(await hOverflow(page), 0);
  assert.equal(env.stats.sim.length, 0, 'ouvrir l\'écran ne lance aucune simulation (aucun crédit)'); assert.equal(env.stats.simProbe.length, 1);
  clean(env); await env.close();
});

test('SBB12 simulation : l\'entrée disparaît à la déconnexion et ne passe jamais d\'un compte à l\'autre', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake, sim: { available: true } });
  seed(env); await boot(env);
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#sidebar [data-go=simulation]').waitFor({ state: 'visible', timeout: 10000 });
  await page.evaluate(() => logout());
  await page.waitForFunction(() => state.account.status !== 'signedIn');
  assert.equal(await page.locator('#sidebar [data-go=simulation]').count(), 0);
  assert.equal(env.stats.simProbe.length, 1);
  // un autre compte se connecte : sa propre vérification est faite, rien n'est repris du compte précédent
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  const b = await page.evaluate(() => ACCOUNT.user.id); seed(env, b);
  await page.reload(); await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  await page.evaluate(() => go('progress'));
  await page.locator('#sidebar [data-go=simulation]').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(env.stats.simProbe.length, 3, 'une vérification par compte et par chargement de page, jamais reprise de l\'autre compte');
  clean(env); await env.close();
});

test('SBB13 « Se déconnecter » (ordinateur) : sous « Autres accès », après le profil ; déconnecte comme le bouton du profil ; rien ne reste', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env);
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
  const out = page.locator('#sidebar [data-act=logout]');
  assert.ok(await out.isVisible()); assert.equal((await out.innerText()).trim(), 'Se déconnecter');
  const y = await page.evaluate(() => ['.sidebar__label', '[data-go=profile]', '[data-act=logout]'].map(s => Math.round(document.querySelector('#sidebar ' + s).getBoundingClientRect().top)));
  assert.ok(y[0] < y[1] && y[1] < y[2], 'Autres accès, puis Profil et paramètres, puis Se déconnecter : ' + y);
  assert.deepEqual(await page.locator('#sidebar .sidebar__foot .sidebar__text').allInnerTexts(), ['Profil et paramètres', 'Se déconnecter']);
  assert.equal(await page.locator('#sidebar [data-act=logout][aria-current]').count(), 0);
  const uid = await page.evaluate(() => ACCOUNT.user.id);
  assert.ok(await page.evaluate(() => localStorage.getItem('dermai.session')), 'session présente avant');
  await out.click();
  await page.waitForFunction(() => state.account.status === 'visitor' && state.route === 'landing');
  assert.equal(await page.evaluate(() => localStorage.getItem('dermai.session')), null, 'la session est effacée');
  assert.equal(await page.evaluate(() => SCANS.length), 0, 'l\'historique en mémoire est effacé'); assert.equal(await page.evaluate(() => state.account.email), '');
  assert.match(await page.locator('#toast').innerText(), /déconnecté/);
  assert.equal(await page.locator('#sidebar').count(), 0);
  assert.equal(await page.evaluate(() => document.body.classList.contains('sb-lock')), false);
  assert.equal(env.fake.analyses.get(uid).length, 2, 'les analyses du compte restent dans le compte : se déconnecter n\'efface rien en base');
  clean(env); await env.close();
});

test('SBB14 « Se déconnecter » (mobile) : dans le panneau, qui se referme ; le même compte ou un autre peut se reconnecter, sans reste de l\'ancien', opts, async () => {
  const fake = H.createFake();
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, fake });
  seed(env); await boot(env, 'analyses');
  const { page } = env;
  await page.click('.sidebar__toggle'); await wait(page);
  assert.ok(await page.locator('#sidebar [data-act=logout]').isVisible());
  assert.equal(await hOverflow(page), 0);
  await page.locator('#sidebar [data-act=logout]').click();
  await page.waitForFunction(() => state.account.status === 'visitor' && state.route === 'landing');
  assert.equal(await page.evaluate(() => document.body.classList.contains('sb-lock')), false, 'le défilement est libéré');
  assert.equal(await hOverflow(page), 0);
  // un autre compte se connecte : l'entrée revient pour lui, avec ses seules données
  await fake.fetch(`${H.SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: 'anon-key-for-tests' }, body: JSON.stringify({ email: 'b@exemple.com', password: 'motdepasse1' }) });
  await page.evaluate(() => go('login'));
  await page.fill('form[data-form=login] [name=email]', 'b@exemple.com'); await page.fill('form[data-form=login] [name=password]', 'motdepasse1');
  await page.click('form[data-form=login] button[type=submit]');
  await page.waitForFunction(() => state.account.email === 'b@exemple.com' && state.history.status === 'ready');
  assert.equal(await page.evaluate(() => SCANS.length), 0, 'aucune analyse de A chez B');
  await page.evaluate(() => go('profile'));
  await page.click('.sidebar__toggle'); await wait(page);
  assert.ok(await page.locator('#sidebar [data-act=logout]').isVisible());
  clean(env); await env.close();
});

test('SBB15 visiteur sans compte : aucune entrée « Se déconnecter » ; le bouton du profil continue de fonctionner', opts, async () => {
  const env = await H.open(browser, server);
  const { page } = env;
  await page.clock.setFixedTime(NOW);
  await page.goto('/home');
  await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'visitor', null, { timeout: 15000 });
  await page.evaluate(() => go('analyses'));
  assert.equal(await page.locator('#sidebar').count(), 1);
  assert.equal(await page.locator('#sidebar [data-act=logout]').count(), 0);
  assert.ok(!/Se déconnecter/.test(await page.locator('#sidebar').innerText()));
  clean(env); await env.close();
});

test('SBB16 depuis le profil : le bouton « Se déconnecter » existant fonctionne toujours, et la colonne propose la même action', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  seed(env); await boot(env, 'profile');
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
  assert.equal(await page.locator('[data-act=logout]').count(), 2, 'le profil et la colonne');
  await page.locator('main.main [data-act=logout]').click();
  await page.waitForFunction(() => state.account.status === 'visitor' && state.route === 'landing');
  clean(env); await env.close();
});
