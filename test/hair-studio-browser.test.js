'use strict';
/* Studio Beauté, volet capillaire dans le VRAI index.html / js/app.js, dans Chromium, réseau entièrement simulé (test/helpers/browser-harness.js) :
   /api/hair-vto est intercepté par le navigateur de test et l'hôte d'images du « fournisseur » est factice. Aucune requête ne part vers le serveur ni vers Perfect Corp.
   Ignoré si Playwright / Chromium sont absents. */
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers/browser-harness.js');
const M = require('../server/makeup.js');

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

const IMG = H.MK_IMG + '/out/hair1.png?Signature=abc';
const TPL = { status: 200, body: { ok: true, next: null, templates: [{ id: 'tpl_001', title: 'Tresses longues', category: 'Longues', thumb: H.MK_IMG + '/t/1.png' }, { id: 'tpl_002', title: 'Afro naturel', category: 'Afro', thumb: H.MK_IMG + '/t/2.png' }, { id: 'tpl_003', title: 'Bob', category: 'Courtes', thumb: '' }] } };
const FEATS = [{ id: 'hairstyle', label: 'Coiffures', units: 2, version: '2.1', templates: true }, { id: 'haircolor', label: 'Couleurs', units: 1, version: '1.0', templates: false }, { id: 'extensions', label: 'Extensions', units: 1, version: '1.0', templates: true }, { id: 'bangs', label: 'Franges', units: 1, version: '1.0', templates: true }, { id: 'wavy', label: 'Boucles', units: 1, version: '1.0', templates: true }, { id: 'volume', label: 'Volume', units: 2, version: '1.0', templates: true }];
const goodFor = feature => ({ status: 200, body: { ok: true, hair: { feature, image: IMG } } });
const hairOpts = (o = {}) => ({ user: { email: 'a@exemple.com' }, hair: Object.assign({ available: true, features: FEATS, templates: { hairstyle: TPL, extensions: TPL, bangs: TPL, wavy: TPL, volume: TPL }, behaviors: [goodFor('haircolor')] }, o.hair || {}), makeup: o.makeup });
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
const openStudio = async (env, tab) => {
  const { page } = env;
  await page.setViewportSize({ width: 1280, height: 800 });
  const entry = page.locator('#sidebar .sidebar__link', { hasText: 'Studio Beauté' });
  await entry.waitFor({ state: 'visible', timeout: 10000 });
  await entry.click(); await page.waitForFunction(() => state.route === 'studio');
  await page.waitForSelector('[data-ms=mode]');
  if (tab) { await page.click(`[data-ms=mode][data-v=${tab}]`); await page.waitForSelector('[data-hs=run]'); }
};
const addPhoto = async env => {
  await env.page.setInputFiles('#ms-file', { name: 'moi.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(env.page) });
  await env.page.waitForSelector('.c-ms-preview img');
};
const storageDump = page => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
const cfgOf = q => JSON.parse(decodeURIComponent(q.url.split('cfg=')[1].split('&')[0]));

test('HB1 volet capillaire fermé (défaut) : aucune entrée de menu, une seule vérification (GET), aucun essai, aucune lecture de modèles', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await boot(env); const { page } = env;
  for (const w of [1280, 420]) { await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150); assert.equal(await page.locator('#sidebar [data-go=studio]').count(), 0, `${w} px`); }
  await page.evaluate(() => go('analyses')); await page.evaluate(() => go('progress'));
  assert.equal(env.stats.hrProbe.length, 1); assert.ok(env.stats.hrProbe[0].auth); assert.equal(env.stats.hr.length, 0); assert.equal(env.stats.hrTemplates.length, 0);
  clean(env); await env.close();
});

test('HB2 volet capillaire seul ouvert : l\'entrée « Studio Beauté » apparaît (ordinateur et mobile), onglets réels, aucune tâche, une lecture des modèles par fonction affichée', opts, async () => {
  const env = await H.open(browser, server, hairOpts());
  await boot(env); const { page } = env;
  await openStudio(env);
  const t = await text(page);
  for (const l of ['Studio Beauté', 'Coiffures et perruques', 'Couleurs de cheveux', 'Extensions', 'Franges', 'Boucles et volume', 'Votre photo']) assert.match(t, new RegExp(l));
  assert.doesNotMatch(await page.locator('[data-ms=mode]').allInnerTexts().then(a => a.join('|')), /Maquillage/, 'maquillage fermé : pas d\'onglet');
  assert.ok((await page.locator('#sidebar [aria-current="page"]').innerText()).startsWith('Studio Beauté'));
  assert.equal(env.stats.hrTemplates.length, 1, 'modèles de la coiffure lus à l\'affichage'); assert.equal(env.stats.hrTemplates[0].id, 'hairstyle'); assert.ok(env.stats.hrTemplates[0].auth);
  for (const tab of ['haircolor', 'extensions', 'bangs', 'curls', 'hairstyle']) { await page.click(`[data-ms=mode][data-v=${tab}]`); await page.waitForTimeout(80); }
  assert.deepEqual(env.stats.hrTemplates.map(x => x.id).sort(), ['bangs', 'extensions', 'hairstyle', 'wavy'], 'une lecture par fonction affichée, aucune pour la couleur');
  assert.equal(env.stats.hr.length, 0, 'naviguer ne lance aucune tâche'); assert.equal(env.stats.hrProbe.length, 1);
  await page.evaluate(() => go('home')); await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(150);
  await page.click('.sidebar__toggle'); await page.waitForTimeout(350);
  await page.locator('#sidebar .sidebar__link', { hasText: 'Studio Beauté' }).click(); await page.waitForFunction(() => state.route === 'studio'); await page.waitForTimeout(350);
  assert.equal(await page.locator('#sidebar').isVisible(), false); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
  clean(env); await env.close();
});

test('HB3 coiffure : photo (réduite à 1 024 px), modèle choisi, UNE tâche explicite ; vignettes réelles de la liste ; comparaison, téléchargement, recommencer ; rien de stocké', opts, async () => {
  const env = await H.open(browser, server, hairOpts({ hair: { behaviors: [goodFor('hairstyle')] } }));
  await boot(env); const { page } = env;
  await openStudio(env, 'hairstyle'); await addPhoto(env);
  await page.waitForSelector('.c-hs-card[data-id=tpl_001] img');
  assert.equal(await page.locator('.c-hs-card img').count(), 2, 'deux vignettes fournies par la liste, aucune inventée pour le troisième modèle');
  assert.equal(await page.isDisabled('[data-hs=run]'), true, 'aucun modèle choisi : aucun essai possible');
  await page.click('[data-hs=cat][data-v=Afro]'); assert.equal(await page.locator('.c-hs-card[data-id=tpl_001]').count(), 0); await page.click('[data-hs=cat][data-v=""]');
  await page.click('.c-hs-card[data-id=tpl_002]'); assert.equal(await page.getAttribute('.c-hs-card[data-id=tpl_002]', 'aria-pressed'), 'true');
  await page.click('[data-hs=haircolor-src][data-v=src]');
  assert.equal(env.stats.hr.length, 0, 'choisir ne déclenche rien'); assert.match(await text(page), /consomme 2 unités/);
  await page.evaluate(() => { const b = document.querySelector('[data-hs=run]'); b.click(); b.click(); });
  await page.waitForSelector('[data-hs=after]'); assert.equal(env.stats.hr.length, 1, 'une seule demande malgré le double clic');
  const q = env.stats.hr[0]; assert.match(q.url, /\/api\/hair-vto\?feature=hairstyle&cfg=/); assert.equal(q.type, 'image/jpeg'); assert.ok(q.auth);
  assert.deepEqual(cfgOf(q), { v: 1, template: { id: 'tpl_002', hair_color: 'src' } });
  const size = M.jpegSize(q.data); assert.ok(size && Math.max(size.width, size.height) <= 1024, 'photo envoyée : ' + JSON.stringify(size));
  await page.waitForFunction(() => { const i = document.querySelector('[data-hs=after]'); return i && i.complete && i.naturalWidth > 0; });
  const t = await text(page); assert.match(t, /Résultat : Coiffure complète/); assert.match(t, /Avant/); assert.match(t, /Aperçu généré par ordinateur/); assert.match(t, /Changer de modèle ou de couleur/);
  await page.$eval('[data-hs=pos]', el => { el.value = '25'; el.dispatchEvent(new Event('input', { bubbles: true })); }); assert.match(await page.$eval('[data-hs=after]', el => el.style.clipPath), /25%/);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-hs=download]')]); assert.match(dl.suggestedFilename(), /^studio-beaute-hairstyle\.(png|jpg)$/);
  assert.equal(env.stats.hr.length, 1, 'télécharger ne relance rien');
  const dump = await storageDump(page); assert.ok(!/blob:|data:image|vto-images|hair1|Signature/.test(dump), 'ni photo ni résultat en stockage'); assert.ok(!/dermai\.studio\.pending/.test(dump));
  clean(env); await env.close();
});

test('HB4 couleur : preset, couleur personnalisée, dégradé ; jamais preset ET palettes ; comparaison', opts, async () => {
  const env = await H.open(browser, server, hairOpts());
  await boot(env); const { page } = env;
  await openStudio(env, 'haircolor'); await addPhoto(env);
  assert.equal(env.stats.hrTemplates.filter(x => x.id === 'haircolor').length, 0, 'la couleur n\'a pas de modèles'); assert.match(await text(page), /Noir naturel/); assert.match(await text(page), /Brun chocolat/);
  await page.click('[data-hs=preset][data-v="Burgundy"]'); await page.click('[data-hs=run]'); await page.waitForSelector('[data-hs=after]');
  assert.deepEqual(cfgOf(env.stats.hr[0]), { v: 1, preset: 'Burgundy' });
  await page.click('[data-hs=mode][data-v=full]'); await page.click('[data-hs=color][data-k=color][data-c="#5a2a1f"]');
  await page.$eval('[data-hs=range][data-k=colorIntensity]', el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(env.stats.hr.length, 1, 'régler ne déclenche rien'); await page.click('[data-hs=run]'); await page.waitForFunction(() => document.querySelectorAll('[data-hs=show]').length === 2);
  assert.deepEqual(cfgOf(env.stats.hr[1]), { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#5a2a1f', color_intensity: 35, shine_intensity: 40 }] });
  await page.click('[data-hs=mode][data-v=ombre]'); await page.click('[data-hs=run]'); await page.waitForFunction(() => document.querySelectorAll('[data-hs=show]').length === 3);
  const c3 = cfgOf(env.stats.hr[2]); assert.equal(c3.pattern.name, 'ombre'); assert.equal(c3.palettes.length, 2); assert.ok(!('preset' in c3));
  assert.equal(env.stats.hr.length, 3, 'trois essais explicites, rien d\'automatique');
  clean(env); await env.close();
});

test('HB5 coiffure par photo de référence : les deux images partent à la suite dans UNE demande, ref_at exact, 1 024 px au plus chacune', opts, async () => {
  const env = await H.open(browser, server, hairOpts({ hair: { behaviors: [goodFor('hairstyle')] } }));
  await boot(env); const { page } = env;
  await openStudio(env, 'hairstyle'); await addPhoto(env);
  await page.click('[data-hs=mode][data-v=reference]'); assert.equal(await page.isDisabled('[data-hs=run]'), true);
  await page.setInputFiles('#hs-ref', { name: 'ref.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) }); await page.waitForSelector('[alt="Photo de la coiffure de référence"]');
  assert.equal(await page.isDisabled('[data-hs=run]'), false); await page.click('[data-hs=run]'); await page.waitForSelector('[data-hs=after]');
  const q = env.stats.hr[0], at = Number((q.url.match(/ref_at=(\d+)/) || [])[1]); assert.ok(at > 1000 && at < q.data.length - 1000, 'ref_at : ' + at);
  assert.deepEqual(cfgOf(q), { v: 1, reference: true });
  const a = q.data.subarray(0, at), b = q.data.subarray(at);
  for (const part of [a, b]) { assert.equal(part[0], 0xff); assert.equal(part[1], 0xd8); const s = M.jpegSize(part); assert.ok(s && Math.max(s.width, s.height) <= 1024); }
  assert.ok(!/src_file|ref_file/.test(q.url));
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(v => String(v).includes('blob:'))), false);
  clean(env); await env.close();
});

test('HB6 erreurs : quota atteint (message du serveur, aucune relance), réponse perdue (confirmation avant relance), image expirée, réponses inutilisables', opts, async () => {
  let env = await H.open(browser, server, hairOpts({ hair: { behaviors: [{ status: 429, body: { ok: false, error: 'Le nombre d\'essais capillaires disponibles est atteint pour le moment. Réessayez plus tard.' } }] } }));
  await boot(env); await openStudio(env, 'haircolor'); await addPhoto(env);
  await env.page.click('[data-hs=preset][data-v="Burgundy"]'); await env.page.click('[data-hs=run]');
  await env.page.waitForFunction(() => /essais capillaires disponibles/.test(document.getElementById('app').innerText));
  assert.equal(await env.page.locator('[data-hs=after]').count(), 0); await env.page.waitForTimeout(500); assert.equal(env.stats.hr.length, 1, 'aucune relance automatique');
  clean(env); await env.close();

  env = await H.open(browser, server, hairOpts({ hair: { behaviors: [{ abort: true }, goodFor('haircolor')] } }));
  await boot(env); await openStudio(env, 'haircolor'); await addPhoto(env);
  await env.page.click('[data-hs=preset][data-v="Burgundy"]'); await env.page.click('[data-hs=run]');
  await env.page.waitForFunction(() => /peut-être été compté/.test(document.getElementById('app').innerText));
  assert.equal(await env.page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.studio\.pending/.test(k)).length), 1);
  assert.equal(await env.page.isDisabled('[data-hs=run]'), true, 'relance bloquée tant que la précédente n\'est pas reconnue');
  await env.page.click('[data-hs=ack]'); assert.equal(await env.page.isDisabled('[data-hs=run]'), false); assert.equal(env.stats.hr.length, 1, 'confirmer ne relance rien');
  await env.page.click('[data-hs=run]'); await env.page.waitForSelector('[data-hs=after]'); assert.equal(env.stats.hr.length, 2);
  assert.equal(await env.page.evaluate(() => Object.keys(sessionStorage).filter(k => /dermai\.studio\.pending/.test(k)).length), 0);
  clean(env); await env.close();

  env = await H.open(browser, server, hairOpts({ hair: { behaviors: [{ status: 200, body: { ok: true, hair: { feature: 'haircolor', image: H.MK_IMG + '/out/expired.png' } } }] } }));
  await boot(env); await openStudio(env, 'haircolor'); await addPhoto(env);
  await env.page.click('[data-hs=preset][data-v="Burgundy"]'); await env.page.click('[data-hs=run]');
  await env.page.waitForFunction(() => /lien est temporaire/.test(document.getElementById('app').innerText), null, { timeout: 15000 });
  assert.equal(await env.page.isDisabled('[data-hs=download]'), true);
  clean(env); await env.close();

  for (const hair of [{ ok: true }, { ok: true, hair: { feature: 'haircolor', image: 'http://evil.example/x.png' } }, { ok: true, hair: { feature: 'haircolor', image: 'https://127.0.0.1/x.png' } }, { ok: true, hair: { feature: 'bangs', image: IMG } }]) {
    env = await H.open(browser, server, hairOpts({ hair: { behaviors: [{ status: 200, body: hair }] } }));
    await boot(env); await openStudio(env, 'haircolor'); await addPhoto(env);
    await env.page.click('[data-hs=preset][data-v="Burgundy"]'); await env.page.click('[data-hs=run]');
    await env.page.waitForFunction(() => /n'est pas utilisable/.test(document.getElementById('app').innerText));
    assert.equal(await env.page.locator('[data-hs=after]').count(), 0); assert.equal(await env.page.locator('img[src^="http://evil"], img[src^="https://127"]').count(), 0);
    clean(env); await env.close();
  }
});

test('HB7 modèles : liste indisponible → message et réessai ; fonction « Boucles et volume » à deux sous-onglets ; extensions annoncées comme telles, jamais comme une perruque', opts, async () => {
  const env = await H.open(browser, server, hairOpts({ hair: { templates: { hairstyle: { status: 502, body: { ok: false, error: 'Les modèles ne sont pas disponibles pour le moment. Réessayez plus tard.' } }, extensions: TPL, wavy: TPL, volume: TPL } } }));
  await boot(env); const { page } = env;
  await openStudio(env, 'hairstyle');
  await page.waitForFunction(() => /modèles ne sont pas disponibles/.test(document.getElementById('app').innerText)); assert.equal(await page.locator('.c-hs-card[data-hs=tpl]').count(), 0); assert.equal(await page.locator('[data-hs=retry-templates]').count(), 1);
  await page.click('[data-ms=mode][data-v=extensions]'); await page.waitForSelector('.c-hs-card[data-id=tpl_001]'); const ex = await text(page);
  assert.match(ex, /Extensions \(longueur ajoutée\)/); assert.match(ex, /ne remplacent pas votre coiffure/); assert.match(ex, /pas l'essai d'une perruque complète/); assert.match(ex, /consomme 1 unité/);
  await page.click('[data-ms=mode][data-v=curls]'); await page.waitForSelector('[data-hs=sub]'); assert.deepEqual(await page.locator('[data-hs=sub]').allInnerTexts(), ['Boucles et ondulations', 'Volume']);
  assert.match(await text(page), /ne couvre pas forcément toutes les textures ni tous les styles afro/);
  await page.click('[data-hs=sub][data-f=volume]'); await page.waitForFunction(() => /consomme 2 unités/.test(document.getElementById('app').innerText)); assert.match(await text(page), /ni un diagnostic de chute de cheveux ni une solution médicale/);
  assert.equal(env.stats.hr.length, 0);
  clean(env); await env.close();
});

test('HB8 maquillage préservé : les deux volets ouverts, onglet Maquillage par défaut et inchangé, photo partagée entre les espaces, un essayage de maquillage reste UNE demande', opts, async () => {
  const mk = { available: true, behaviors: [{ status: 200, body: { ok: true, makeup: { image: IMG } } }] };
  const env = await H.open(browser, server, hairOpts({ makeup: mk }));
  await boot(env); const { page } = env;
  await openStudio(env); await addPhoto(env);
  assert.deepEqual((await page.locator('[data-ms=mode]').allInnerTexts()).slice(0, 2), ['Maquillage', 'Coiffures et perruques']);
  assert.equal(await page.getAttribute('[data-ms=mode][data-v=makeup]', 'aria-pressed'), 'true'); assert.match(await text(page), /Essayer ce maquillage/);
  await page.click('[data-ms=mode][data-v=haircolor]'); await page.waitForSelector('[data-hs=run]'); assert.equal(await page.locator('.c-ms-preview img').count(), 1, 'la photo choisie reste là');
  await page.click('[data-hs=preset][data-v="Burgundy"]'); await page.click('[data-hs=run]'); await page.waitForSelector('[data-hs=after]');
  await page.click('[data-ms=mode][data-v=makeup]'); await page.click('[data-ms=look][data-id=natural]'); await page.click('[data-ms=run]'); await page.waitForSelector('[data-ms=after]');
  assert.equal(env.stats.mk.length, 1); assert.equal(env.stats.hr.length, 1);
  const cfg = JSON.parse(decodeURIComponent(env.stats.mk[0].url.split('cfg=')[1])); assert.deepEqual(Object.keys(cfg).sort(), ['blush', 'eyes', 'lips', 'v']);
  clean(env); await env.close();
});

test('HB9 mobile 420 px et clavier : pas de défilement horizontal dans aucun onglet, cibles de 40 px au moins, modèles et couleurs choisis au clavier', opts, async () => {
  const env = await H.open(browser, server, hairOpts());
  await boot(env); const { page } = env;
  await openStudio(env, 'hairstyle'); await page.setViewportSize({ width: 420, height: 900 }); await page.waitForTimeout(200); await addPhoto(env);
  for (const tab of ['hairstyle', 'haircolor', 'extensions', 'bangs', 'curls']) {
    await page.click(`[data-ms=mode][data-v=${tab}]`); await page.waitForSelector('[data-hs=run]'); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, tab + ' : pas de défilement horizontal');
    const small = await page.evaluate(() => [...document.querySelectorAll('.c-hs-card, .c-ms-swatch, [data-ms=mode], [data-hs=run], [data-hs=sub], [data-hs=mode]')].filter(e => e.offsetParent && Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height) < 40).length);
    assert.equal(small, 0, tab + ' : cibles d\'au moins 40 px');
  }
  await page.click('[data-ms=mode][data-v=hairstyle]'); await page.waitForSelector('.c-hs-card[data-id=tpl_001]');
  await page.focus('.c-hs-card[data-id=tpl_003]'); await page.keyboard.press('Enter'); assert.equal(await page.getAttribute('.c-hs-card[data-id=tpl_003]', 'aria-pressed'), 'true', 'Entrée choisit un modèle');
  await page.focus('.c-hs-card[data-id=tpl_001]'); await page.keyboard.press('Space'); assert.equal(await page.getAttribute('.c-hs-card[data-id=tpl_001]', 'aria-pressed'), 'true', 'Espace choisit un modèle');
  assert.equal(env.stats.hr.length, 0, 'au clavier non plus, rien n\'est lancé sans le bouton');
  await page.click('[data-ms=mode][data-v=haircolor]'); await page.focus('[data-hs=preset][data-v="Jet Black"]'); await page.keyboard.press('Enter'); assert.equal(await page.getAttribute('[data-hs=preset][data-v="Jet Black"]', 'aria-pressed'), 'true');
  clean(env); await env.close();
});

test('HB10 favoris et déconnexion : favori de réglages enregistré, restauré après rechargement, jamais d\'image ; déconnexion → entrée disparue, plus rien en mémoire', opts, async () => {
  const env = await H.open(browser, server, hairOpts());
  await boot(env); const { page } = env;
  await openStudio(env, 'haircolor'); await page.click('[data-hs=mode][data-v=full]'); await page.click('[data-hs=color][data-k=color][data-c="#5a2a1f"]');
  await page.locator('#hs-favs summary').click(); await page.fill('#hs-favname', 'Mon acajou'); await page.click('[data-hs=fav-save]');
  await page.waitForFunction(() => /Réglage enregistré/.test(document.getElementById('app').innerText));
  const uid = await page.evaluate(() => ACCOUNT.user.id), raw = await page.evaluate(k => localStorage.getItem(k), 'dermai.studio.hair.' + uid);
  assert.equal(JSON.parse(raw).favorites[0].name, 'Mon acajou'); assert.ok(!/blob:|data:|https?:/.test(raw));
  await page.reload(); await page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn');
  await page.evaluate(() => go('home')); await openStudio(env, 'haircolor'); await page.locator('#hs-favs summary').click(); assert.match(await page.locator('#hs-favs').innerText(), /Mon acajou/);
  await addPhoto(env); await page.click('[data-hs=fav-use]'); await page.click('[data-hs=run]'); await page.waitForSelector('[data-hs=after]');
  assert.deepEqual(cfgOf(env.stats.hr[0]).palettes[0].color, '#5a2a1f');
  await page.evaluate(() => logout()); await page.waitForFunction(() => state.account.status !== 'signedIn');
  assert.equal(await page.locator('#sidebar [data-go=studio]').count(), 0);
  await page.evaluate(() => go('studio')).catch(() => {}); assert.equal(await page.locator('[data-hs=after]').count(), 0); assert.ok(!/blob:/.test(await page.content()));
  clean(env); await env.close();
});
