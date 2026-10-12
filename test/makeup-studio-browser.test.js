'use strict';
/* Studio Beauté dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (test/helpers/browser-harness.js) :
   /api/makeup-vto est intercepté par le navigateur de test et l'hôte d'images du « fournisseur » est factice. Aucune requête ne part vers le serveur ni vers Perfect Corp.
   Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');

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

const IMG = H.MK_IMG + '/out/result1.png?Signature=abc';
const GOOD = { status: 200, body: { ok: true, makeup: { image: IMG } } };
const boot = async env => {
  await env.page.goto('/');
  await env.page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
  await env.page.evaluate(() => go('home'));
};
const text = page => page.evaluate(() => document.getElementById('app').innerText);
const clean = env => {
  assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  assert.equal(env.stats.skin.length, 0, 'aucune analyse'); assert.equal(env.stats.sim.length, 0, 'aucune simulation');
  assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []);
  assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u)));
};
const openStudio = async env => {
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 });
  const entry = page.locator('#sidebar .sidebar__link', { hasText: 'Studio Beauté' });
  await entry.waitFor({ state: 'visible', timeout: 10000 });
  await entry.click(); await page.waitForFunction(() => state.route === 'studio');
  await page.waitForSelector('[data-ms=run]');
};
const storageDump = page => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
async function addPhoto(env) {
  await env.page.setInputFiles('#ms-file', { name: 'moi.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(env.page) });
  await env.page.waitForSelector('.c-ms-preview img');
}

test('MB1 Studio fermé (défaut) : aucune entrée de menu, une seule vérification (GET), aucun essayage', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  for (const w of [1280, 420]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150); assert.equal(await page.locator('#sidebar [data-go=studio]').count(), 0, `${w} px`); }
  await page.evaluate(() => go('analyses')); await page.evaluate(() => go('progress'));
  assert.equal(env.stats.mkProbe.length, 1); assert.ok(env.stats.mkProbe[0].auth); assert.equal(env.stats.mk.length, 0);
  assert.doesNotMatch(await text(page), /Studio Beauté/);
  clean(env); await env.close();
});

test('MB2 Studio ouvert pour le compte : l\'entrée apparaît (ordinateur et mobile), ouvre l\'écran, page active ; ouvrir l\'écran ne lance aucun essayage', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [GOOD] } });
  await boot(env); const { page } = env;
  await openStudio(env);
  const t = await text(page);
  for (const l of ['Studio Beauté', 'Votre photo', 'Naturel', 'Élégant', 'Glamour', 'Soirée', 'Teint', 'Lèvres', 'Blush', 'Yeux', 'Essayer ce maquillage']) assert.match(t, new RegExp(l));
  assert.match(t, /Votre peau n'est pas retouchée/); assert.match(t, /Chaque essayage compte dans votre quota/);
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Studio Beauté'));
  assert.equal(await page.isDisabled('[data-ms=run]'), true, 'sans photo : désactivé');
  assert.equal(env.stats.mk.length, 0, 'aucun essayage'); assert.equal(env.stats.mkProbe.length, 1);
  // mobile : même entrée dans le panneau
  await page.evaluate(() => go('home')); await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(150);
  await page.click('.sidebar__toggle'); await page.waitForTimeout(350);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Studio Beauté' }).click(); await page.waitForFunction(() => state.route === 'studio'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'pas de défilement horizontal à 420 px');
  assert.equal(env.stats.mk.length, 0);
  clean(env); await env.close();
});

test('MB3 parcours complet : photo, look, couleur, texture, intensité (rien n\'est envoyé), UNE demande avec tous les effets, comparaison, téléchargement, aucune analyse, rien de stocké', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [GOOD] } });
  await boot(env); const { page } = env;
  await openStudio(env);
  await addPhoto(env);
  assert.match(await text(page), /Photo prête/); assert.equal(env.stats.mk.length, 0, 'choisir une photo n\'envoie rien');
  assert.equal(await page.isDisabled('[data-ms=run]'), true, 'aucun maquillage choisi');
  await page.click('[data-ms=tone][data-t=deep]'); await page.click('[data-ms=look][data-id=natural]');
  assert.equal(await page.getAttribute('[data-ms=look][data-id=natural]', 'aria-pressed'), 'true');
  assert.equal(await page.isDisabled('[data-ms=run]'), false);
  // personnalisation : onglet Lèvres → couleur, texture, intensité
  await page.click('[data-ms=tab][data-cat=lips]'); await page.click('[data-ms=color][data-cat=lips][data-c="#6E2150"]');
  assert.equal(await page.getAttribute('[data-ms=look][data-id=natural]', 'aria-pressed'), 'false', 'une modification manuelle sort du look');
  await page.click('[data-ms=texture][data-cat=lips][data-t=gloss]');
  await page.$eval('[data-ms=range][data-cat=lips][data-f=colorIntensity]', el => { el.value = '72'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.textContent('#ms-lips-colorIntensity-out'), '72');
  await page.click('[data-ms=tab][data-cat=foundation]'); await page.check('[data-ms=toggle][data-cat=foundation]'); await page.click('[data-ms=color][data-cat=foundation][data-c="#5E3425"]');
  assert.equal(env.stats.mk.length, 0, 'aucun choix ne déclenche d\'essayage');
  await page.evaluate(() => { const b = document.querySelector('[data-ms=run]'); b.click(); b.click(); });
  await page.waitForSelector('[data-ms=after]');
  assert.equal(env.stats.mk.length, 1, 'une seule demande malgré le double clic');
  const q = env.stats.mk[0]; assert.match(q.url, /\/api\/makeup-vto\?cfg=/); assert.equal(q.type, 'image/jpeg'); assert.ok(q.auth); assert.ok(q.size > 1000);
  const cfg = JSON.parse(decodeURIComponent(q.url.split('cfg=')[1]));
  assert.deepEqual(Object.keys(cfg).sort(), ['blush', 'eyes', 'foundation', 'lips', 'v'], 'toutes les catégories choisies dans la même demande');
  assert.deepEqual(cfg.lips, { color: '#6e2150', texture: 'gloss', colorIntensity: 72 }); assert.equal(cfg.foundation.color, '#5e3425'); assert.ok(!/src_file|effects|http/.test(q.url.replace(/^.*cfg=/, '')));
  await page.waitForFunction(() => { const i = document.querySelector('[data-ms=after]'); return i && i.complete && i.naturalWidth > 0; });
  const t = await text(page);
  assert.match(t, /Avant/); assert.match(t, /Avec maquillage/); assert.match(t, /Aperçu généré par ordinateur/); assert.match(t, /Recommencer avec d'autres couleurs/); assert.match(t, /Télécharger l'image/);
  await page.$eval('[data-ms=pos]', el => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.match(await page.$eval('[data-ms=after]', el => el.style.clipPath), /20%/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-ms=download]')]);
  assert.match(dl.suggestedFilename(), /^studio-beaute\.(png|jpg)$/);
  assert.equal(env.stats.mk.length, 1, 'télécharger ne relance rien'); assert.equal(env.stats.skin.length, 0);
  const dump = await storageDump(page); assert.ok(!/blob:|data:image|vto-images|result1|Signature/.test(dump), 'ni photo ni résultat en stockage'); assert.ok(!/dermai\.studio\.pending/.test(dump), 'réponse reçue : aucune trace de demande sans réponse');
  clean(env); await env.close();
});

test('MB4 erreurs : quota atteint (message du serveur, aucune relance), réponse perdue (confirmation avant relance), image expirée (message clair)', opts, async () => {
  let env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [{ status: 429, body: { ok: false, error: 'Le nombre d\'essayages disponibles est atteint pour le moment. Réessayez plus tard.' } }] } });
  await boot(env); await openStudio(env); await addPhoto(env);
  await env.page.click('[data-ms=look][data-id=glamour]'); await env.page.click('[data-ms=run]');
  await env.page.waitForFunction(() => /nombre d'essayages disponibles/.test(document.getElementById('app').innerText));
  assert.equal(await env.page.locator('[data-ms=after]').count(), 0); assert.doesNotMatch(await text(env.page), /peut-être été compté|Je comprends/);
  await env.page.waitForTimeout(500); assert.equal(env.stats.mk.length, 1, 'aucune relance automatique');
  clean(env); await env.close();

  env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [{ abort: true }, GOOD] } });
  await boot(env); await openStudio(env); await addPhoto(env);
  await env.page.click('[data-ms=look][data-id=elegant]'); await env.page.click('[data-ms=run]');
  await env.page.waitForFunction(() => /peut-être été compté/.test(document.getElementById('app').innerText));
  assert.equal(await env.page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.studio\.pending/.test(k)).length), 1);
  assert.equal(await env.page.isDisabled('[data-ms=run]'), true, 'relance bloquée tant que la précédente n\'est pas reconnue'); assert.equal(await env.page.locator('[data-ms=ack]').count(), 1);
  await env.page.click('[data-ms=ack]'); assert.equal(await env.page.isDisabled('[data-ms=run]'), false); assert.equal(env.stats.mk.length, 1, 'confirmer ne relance rien');
  await env.page.click('[data-ms=run]'); await env.page.waitForSelector('[data-ms=after]'); assert.equal(env.stats.mk.length, 2);
  assert.equal(await env.page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.studio\.pending/.test(k)).length), 0);
  clean(env); await env.close();

  env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [{ status: 200, body: { ok: true, makeup: { image: H.MK_IMG + '/out/expired.png' } } }] } });
  await boot(env); await openStudio(env); await addPhoto(env);
  await env.page.click('[data-ms=look][data-id=natural]'); await env.page.click('[data-ms=run]');
  await env.page.waitForFunction(() => /lien est temporaire/.test(document.getElementById('app').innerText), null, { timeout: 15000 });
  assert.equal(await env.page.isDisabled('[data-ms=download]'), true);
  clean(env); await env.close();
});

test('MB5 réponses inutilisables : ok sans image, image http, adresse locale, javascript: → erreur claire, aucune image affichée', opts, async () => {
  for (const image of [undefined, 'http://evil.example/x.png', 'https://127.0.0.1/x.png', 'javascript:alert(1)']) {
    const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [{ status: 200, body: { ok: true, makeup: image ? { image } : {} } }] } });
    await boot(env); await openStudio(env); await addPhoto(env);
    await env.page.click('[data-ms=look][data-id=natural]'); await env.page.click('[data-ms=run]');
    await env.page.waitForFunction(() => /n'est pas utilisable/.test(document.getElementById('app').innerText));
    assert.equal(await env.page.locator('[data-ms=after]').count(), 0); assert.equal(await env.page.locator('img[src^="http://evil"], img[src^="https://127"], img[src^="javascript"]').count(), 0);
    clean(env); await env.close();
  }
});

test('MB6 favoris : enregistrés par compte (réglages seulement), restaurés après rechargement, appliqués, supprimés ; jamais d\'image', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [GOOD] } });
  await boot(env); const { page } = env;
  await openStudio(env);
  await page.click('[data-ms=look][data-id=evening]');
  await page.locator('#ms-favs summary').click(); await page.fill('#ms-favname', 'Mon look du soir'); await page.click('[data-ms=fav-save]');
  await page.waitForFunction(() => /Combinaison enregistrée/.test(document.getElementById('app').innerText));
  const uid = await page.evaluate(() => ACCOUNT.user.id), raw = await page.evaluate(k => localStorage.getItem(k), 'dermai.studio.' + uid);
  assert.ok(raw, 'une clé par compte'); assert.equal(JSON.parse(raw).favorites[0].name, 'Mon look du soir'); assert.ok(!/blob:|data:|https?:/.test(raw));
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn');
  await page.evaluate(() => go('home')); await openStudio(env);
  await page.locator('#ms-favs summary').click(); assert.match(await page.locator('#ms-favs').innerText(), /Mon look du soir/);
  await page.click('[data-ms=fav-use]'); assert.equal(await page.getAttribute('[data-ms=look][data-id=evening]', 'aria-pressed'), 'false');
  await page.click('[data-ms=tab][data-cat=lips]'); assert.equal(await page.isChecked('[data-ms=toggle][data-cat=lips]'), true);
  assert.equal(env.stats.mk.length, 0, 'appliquer un favori n\'envoie rien');
  assert.notEqual(await page.locator('#ms-favs').getAttribute('open'), null, 'la liste reste ouverte après une action');
  await page.click('[data-ms=fav-del]'); await page.waitForFunction(() => /Favori supprimé/.test(document.getElementById('app').innerText));
  assert.equal(await page.evaluate(k => localStorage.getItem(k), 'dermai.studio.' + uid), null, 'dernière suppression : clé retirée');
  clean(env); await env.close();
});

test('MB7 déconnexion : l\'entrée disparaît, la photo et les résultats ne sont plus en mémoire pour personne', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [GOOD] } });
  await boot(env); const { page } = env;
  await openStudio(env); await addPhoto(env); await page.click('[data-ms=look][data-id=natural]'); await page.click('[data-ms=run]'); await page.waitForSelector('[data-ms=after]');
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status !== 'signedIn');
  assert.equal(await page.locator('#sidebar [data-go=studio]').count(), 0);
  await page.evaluate(() => go('studio')).catch(() => {});
  assert.equal(await page.locator('[data-ms=after]').count(), 0); assert.equal(await page.locator('.c-ms-preview img').count(), 0);
  assert.ok(!/blob:/.test(await page.content()), 'aucun lien objet résiduel dans la page');
  clean(env); await env.close();
});

test('MB8 mise en page à 420 px : pas de défilement horizontal, cibles tactiles confortables, nuances de teint foncées présentes', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' }, makeup: { available: true, behaviors: [GOOD] } });
  await boot(env); const { page } = env;
  await openStudio(env); await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(200);
  await addPhoto(env); await page.click('[data-ms=look][data-id=natural]');
  for (const cat of ['foundation', 'lips', 'blush', 'eyes']) {
    await page.click(`[data-ms=tab][data-cat=${cat}]`); if (cat === 'foundation') await page.check('[data-ms=toggle][data-cat=foundation]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, cat + ' : pas de défilement horizontal');
    const small = await page.evaluate(() => [...document.querySelectorAll('.c-ms-swatch, [data-ms=tab], [data-ms=look], [data-ms=tone], [data-ms=run]')].filter(e => e.offsetParent && Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height) < 40).length);
    assert.equal(small, 0, cat + ' : cibles d\'au moins 40 px');
  }
  await page.click('[data-ms=tab][data-cat=foundation]');
  const deep = await page.$$eval('[data-ms=color][data-cat=foundation]', els => els.map(e => e.getAttribute('data-c')));
  assert.ok(deep.includes('#3E221A') && deep.includes('#F6DFCF'), 'de la porcelaine à l\'ébène');
  clean(env); await env.close();
});
