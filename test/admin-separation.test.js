'use strict';
/* Administration et Studio Beauté : DEUX modules indépendants, branchés séparément dans l'application (vues V.studio et V.admin distinctes, créations séparées, dépendances de menu séparées).
   Tests statiques (toujours exécutés) puis tests dans le VRAI index.html / js/app.js, dans Chromium, réseau simulé (ignorés si Playwright / Chromium sont absents). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./helpers/browser-harness.js');
const A = require('../server/admin.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('SEP1 câblage statique : vues V.studio et V.admin DISTINCTES (V.studio inchangé), créations séparées aux dépendances propres, menu à dépendances séparées, aucun paramètre de vue détourné', () => {
  const app = read('js/app.js');
  assert.match(app, /^V\.studio=\(\)=>shell\(ST\.page\(\),\{title:`Studio Beauté`\}\);$/m, 'la vue du Studio est exactement celle d\'avant');
  assert.match(app, /^V\.admin=\(\)=>shell\(AD\.page\(\)\);$/m, 'la vue d\'administration est sa propre fonction de rendu');
  assert.ok(!/V\.studio\s*=\s*V\.admin|V\.admin\s*=\s*V\.studio|ST\.page\([^)]|AD\.page\([^)]|ST\.admin|ST\.ready\([^)]|\bgate\b/.test(app), 'ni affectation multiple, ni paramètre de vue, ni délégation, ni « gate » commune');
  const st = app.match(/^const ST=DermaiStudio\.create\(\{[^\n]*$/m)[0], ad = app.match(/^const AD=DermaiAdmin\.create\(\{[^\n]*$/m)[0];
  assert.ok(!/\bAD\b|Admin/.test(st) && !/\bST\b|Studio|toJpeg|inspect|photo/i.test(ad), 'chaque création ne référence que ses propres dépendances');
  assert.equal(ad, 'const AD=DermaiAdmin.create({account:()=>ACCOUNT,epoch:()=>authEpoch,render:RR});AD.attach(document);', 'administration : compte, époque de session, réaffichage ; rien d\'autre');
  assert.match(app, /studio:\(\)=>ST\.ready\(\),admin:\(\)=>AD\.ready\(\)\}\);SB\.attach/, 'entrées de menu : une dépendance chacune');
  assert.ok(app.indexOf('const ST=') < app.indexOf('const AD=') && app.indexOf('const AD=') < app.indexOf('const SB='), 'créés avant la barre latérale qui les interroge');
  assert.ok(!/RESTORABLE=new Set\(\[[^\]]*`admin`/.test(app), 'adresse non restaurable : aucune page d\'administration rouverte à froid');
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000, 'js/app.js sous 150 000 octets');
});

test('SEP2 extraction ciblée du câblage commun : mêmes expressions qu\'avant, déclarées une fois ; aucun commentaire retiré ; seuls les quatre modules du bloc sont concernés', () => {
  const app = read('js/app.js');
  assert.match(app, /^const UID=\(\)=>ACCOUNT&&ACCOUNT\.user\?ACCOUNT\.user\.id:null,RR=\(\)=>render\(true\);$/m);
  assert.ok(app.indexOf('const UID=') > app.indexOf('const ACCOUNT=') && app.indexOf('const UID=') < app.indexOf('const CP='), 'déclarées après le compte, avant leur premier usage');
  assert.equal((app.match(/ACCOUNT&&ACCOUNT\.user\?ACCOUNT\.user\.id:null/g) || []).length, 2, 'l\'expression ne subsiste qu\'en deux endroits : sa déclaration et l\'enregistrement des analyses (hors du bloc, inchangé)');
  assert.deepEqual((app.match(/userId:UID/g) || []).length, 4); assert.equal((app.match(/render:RR/g) || []).length, 6);
  /* tout commentaire de fin de ligne du bloc de câblage d'origine est conservé */
  for (const c of ['// suivi sur 30 jours (js/care-program.js)', '// js/simulation.js', '// js/evolution.js', '// js/verif-routine.js', '// js/sidebar.js', '// js/quick-login.js']) assert.ok(app.includes(c), c);
});

test('SEP3 ressources séparées : chargement, feuilles de style et fichiers propres ; le Studio et l\'administration ne se connaissent pas (ni code, ni style)', () => {
  const html = read('index.html'), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.equal((html.match(/js\/admin-dashboard\.js/g) || []).length, 1); assert.ok(at('js/admin-dashboard.js') > 0 && at('js/admin-dashboard.js') < at('js/app.js'), 'chargé avant l\'application, comme les autres modules');
  assert.equal((read('css/styles.css').match(/components\/admin\.css/g) || []).length, 1);
  for (const f of ['js/makeup-studio.js', 'js/makeup-data.js', 'js/hair-studio.js', 'js/hair-data.js', 'css/components/makeup.css']) assert.ok(!/admin|c-ad-/i.test(read(f)), f + ' ne contient rien d\'administratif');
  for (const f of ['js/admin-dashboard.js', 'css/components/admin.css']) assert.ok(!/studio|makeup|hair|c-ms-|c-hs-/i.test(strip(read(f))), f + ' ne mentionne ni le Studio ni le style du Studio');
  for (const f of ['api/admin-stats.js', 'server/admin.js', 'server/admin-usage.js', 'server/perfectcorp-billing.js']) assert.ok(!/makeup-vto|hair-vto|perfectcorp-makeup|perfectcorp-hair|api\/makeup|api\/hair/.test(strip(read(f)).replace(/MAKEUP_PATHS|makeupAllowList|isMakeupEnabled|makeupQuota|MAKEUP_QUOTA_DEFAULTS|hair\.(IDS|FEATURES|activeFeatures)|require\('\.\/hair'\)|hairQuota|hairAllowList|isHairEnabled|isHair\w+|HAIR_QUOTA_DEFAULTS/g, '')), f + ' : seulement la lecture de la configuration, jamais les endpoints du Studio');
  for (const f of ['api/makeup-vto.js', 'api/hair-vto.js']) assert.ok(!/admin/i.test(read(f)), f + ' : aucune administration');
});

/* ───────── Dans Chromium ───────── */
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

const NOW = '2026-10-14T09:30:00.000Z';
const ENV = { PERFECT_CORP_API_KEY: 'k', SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'a', DERMAI_ANALYSIS_ENABLED: '1' };
const SECTIONS = { features: { ok: true, generatedAt: NOW, features: A.featureRows(ENV) }, quotas: { ok: true, generatedAt: NOW, quotas: A.quotaRows({}) },
  credit: { ok: true, credit: { status: 'ok', fetchedAt: NOW, cached: false, spendable: 150, categories: [{ type: 'Api Purchased', amount: 150, spendable: true }] } },
  usage: { ok: true, usage: { status: 'ok', fetchedAt: NOW, cached: false, accounts: { total: 42, new_7d: 5, new_30d: 17, signed_in_7d: 20, signed_in_30d: 31, active_7d: 12, active_30d: 25, returned_7d: 7, never_used: 9, inactive_30d: 11 }, functions: [{ key: 'analysis', name: 'Analyse de la peau', available: true, runs_7d: 30, runs_30d: 90, users_30d: 25 }, { key: 'simulation', name: 'Simulation cosmétique', available: true, runs_7d: 4, runs_30d: 10, users_30d: 6 }, { key: 'makeup', name: 'Studio Beauté : maquillage', available: false }, { key: 'hair', name: 'Studio Beauté : cheveux', available: true, runs_7d: 3, runs_30d: 8, users_30d: 4, units_7d: 5, units_30d: 14 }], savedAnalyses: { total: 120, last_30d: 40, users: 30 } } },
  costs: { ok: true, costs: Object.assign({ status: 'ok', fetchedAt: NOW, cached: false, total: 1, pages: 1, truncated: false }, A.matchCosts([{ description: 'Skin analysis', amount: 4, unit: 'unit', procUnit: 'task', slug: 'skin-analysis' }])) } };
const TPL = { status: 200, body: { ok: true, next: null, templates: [{ id: 'tpl_001', title: 'Tresses', category: 'Femme', thumb: '' }] } };
const both = () => ({ user: { email: 'f@exemple.com' }, admin: { access: 'yes', sections: SECTIONS }, makeup: { available: true, behaviors: [{ status: 200, body: { ok: true, makeup: { image: H.MK_IMG + '/o.png' } } }] },
  hair: { available: true, features: [{ id: 'hairstyle', units: 2, templates: true }, { id: 'haircolor', units: 1, templates: false }], templates: { hairstyle: TPL }, behaviors: [{ status: 200, body: { ok: true, hair: { feature: 'haircolor', image: H.MK_IMG + '/o.png' } } }] } });
const boot = async env => {
  await env.page.goto('/');
  await env.page.waitForFunction(() => typeof state !== 'undefined' && state.account.status === 'signedIn', null, { timeout: 15000 });
  await env.page.evaluate(() => go('home')); await env.page.setViewportSize({ width: 1280, height: 900 });
};
const side = (page, label) => page.locator('#sidebar .sidebar__link', { hasText: label });
const toAdmin = async env => { await side(env.page, 'Administration').click(); await env.page.waitForFunction(() => state.route === 'admin'); await env.page.waitForFunction(() => /Solde Perfect Corp/.test(document.getElementById('app').innerText) && !/Chargement…/.test(document.getElementById('app').innerText), null, { timeout: 15000 }); };
const toStudio = async env => { await side(env.page, 'Studio Beauté').click(); await env.page.waitForFunction(() => state.route === 'studio'); await env.page.waitForSelector('[data-ms=run]'); };
const sectionsAsked = env => env.stats.adm.filter(x => x.section !== 'access').length;
const noPaid = env => { assert.equal(env.stats.mk.length, 0, 'aucun essayage de maquillage'); assert.equal(env.stats.hr.length, 0, 'aucun essai capillaire'); assert.equal(env.stats.skin.length, 0); assert.equal(env.stats.sim.length, 0); };
const clean = env => { assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []); assert.deepEqual(env.stats.escaped.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)), []); assert.ok(!env.stats.escaped.some(u => /perfectcorp|youcam|yce|makeupar/i.test(u))); };

test('SEP4 l\'administration s\'ouvre SANS initialiser le Studio : sa page n\'est jamais appelée, aucune requête du Studio autre que la vérification de menu, aucun appel fournisseur ; et inversement', opts, async () => {
  const env = await H.open(browser, server, both());
  await boot(env); const { page } = env;
  await page.evaluate(() => { window.__c = { st: 0, ad: 0 }; const sp = ST.page, ap = AD.page; ST.page = (...a) => { __c.st++; return sp.apply(ST, a); }; AD.page = (...a) => { __c.ad++; return ap.apply(AD, a); }; });
  const probes = () => [env.stats.mkProbe.length, env.stats.hrProbe.length];
  await page.evaluate(() => go('analyses')); await page.evaluate(() => go('progress'));
  assert.deepEqual(await page.evaluate(() => __c), { st: 0, ad: 0 }, 'aucune des deux pages n\'est exécutée tant que sa vue n\'est pas active');
  const before = probes(); await toAdmin(env);
  assert.equal(await page.evaluate(() => __c.st), 0, 'la page du Studio n\'est pas appelée'); assert.ok(await page.evaluate(() => __c.ad) > 0); assert.deepEqual(probes(), before, 'ouvrir l\'administration ne relance aucune vérification du Studio');
  assert.equal(env.stats.hrTemplates.length, 0, 'aucune lecture de modèles capillaires'); noPaid(env);
  await page.evaluate(() => { __c.ad = 0; }); await toStudio(env);
  assert.equal(await page.evaluate(() => __c.ad), 0, 'la page d\'administration n\'est pas appelée depuis le Studio'); assert.ok(await page.evaluate(() => __c.st) > 0);
  assert.equal(sectionsAsked(env), 5, 'ouvrir le Studio ne demande aucune section d\'administration (les 5 viennent de la visite de l\'administration)'); noPaid(env);
  clean(env); await env.close();
});

test('SEP5 états indépendants : actualiser l\'administration ne touche pas le Studio (photo, look), utiliser le Studio ne vide pas l\'administration ; aucun appel supplémentaire', opts, async () => {
  const env = await H.open(browser, server, both());
  await boot(env); const { page } = env;
  await toStudio(env); await page.setInputFiles('#ms-file', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) }); await page.waitForSelector('.c-ms-preview img'); await page.click('[data-ms=look][data-id=natural]');
  const studioView = () => page.evaluate(() => ({ photo: !!ST.state().photo, url: ST.state().photoUrl, look: ST.state().look, lips: ST.state().sel.lips.on }));
  const snap = await studioView(); assert.ok(snap.photo && snap.look === 'natural' && snap.lips);
  await toAdmin(env); const asked = sectionsAsked(env);
  await page.click('[data-ad=refresh]'); await page.waitForFunction(() => !document.querySelector('[data-ad=refresh]').disabled, null, { timeout: 10000 });
  assert.equal(sectionsAsked(env), asked + 5, 'actualiser relit les cinq sources, rien d\'autre'); assert.deepEqual(await studioView(), snap, 'le Studio est intact après l\'actualisation de l\'administration');
  await toStudio(env); assert.equal(await page.locator('.c-ms-preview img').count(), 1, 'la photo est toujours là'); assert.equal(await page.getAttribute('[data-ms=look][data-id=natural]', 'aria-pressed'), 'true');
  const adminBefore = await page.evaluate(() => ({ access: AD.state().access, loaded: AD.state().loaded, keys: Object.keys(AD.state().sec) }));
  await page.click('[data-ms=tab][data-cat=blush]'); await page.click('[data-ms=mode][data-v=haircolor]'); await page.click('[data-ms=mode][data-v=makeup]');
  const asked2 = sectionsAsked(env); await toAdmin(env); assert.equal(sectionsAsked(env), asked2, 'revenir à l\'administration ne relit rien : ses données n\'ont pas été vidées par le Studio');
  assert.deepEqual(await page.evaluate(() => ({ access: AD.state().access, loaded: AD.state().loaded, keys: Object.keys(AD.state().sec) })), adminBefore);
  assert.equal(env.stats.mk.length + env.stats.hr.length, 0, 'ni essayage ni essai capillaire'); noPaid(env);
  clean(env); await env.close();
});

test('SEP6 pannes isolées : un Studio en erreur ne bloque pas l\'administration ; une administration en erreur ne bloque pas le Studio', opts, async () => {
  const env = await H.open(browser, server, both());
  await boot(env); const { page } = env;
  await page.evaluate(() => { ST.ready = () => { throw new Error('panne simulée du Studio'); }; ST.page = () => { throw new Error('panne simulée du Studio'); }; });
  await page.evaluate(() => go('analyses')); await page.waitForTimeout(150);
  assert.equal(await side(page, 'Studio Beauté').count(), 0, 'menu du Studio masqué par sa propre panne (try/catch du menu)'); assert.equal(await side(page, 'Administration').count(), 1, 'l\'entrée d\'administration reste');
  await toAdmin(env); const t = await page.evaluate(() => document.getElementById('app').innerText); assert.match(t, /Solde Perfect Corp/); assert.match(t, /150/);
  await env.close();
  const env2 = await H.open(browser, server, both());
  await boot(env2); const p2 = env2.page;
  await p2.evaluate(() => { AD.ready = () => { throw new Error('panne simulée de l\'administration'); }; AD.page = () => { throw new Error('panne simulée de l\'administration'); }; });
  await p2.evaluate(() => go('analyses')); await p2.waitForTimeout(150);
  assert.equal(await side(p2, 'Administration').count(), 0, 'menu d\'administration masqué par sa propre panne'); assert.equal(await side(p2, 'Studio Beauté').count(), 1);
  await toStudio(env2); assert.match(await p2.evaluate(() => document.getElementById('app').innerText), /Essayer ce maquillage/); noPaid(env2); assert.deepEqual(env2.errors, []);
  await env2.close();
});

test('SEP7 navigation et retour : le retour depuis l\'administration revient à la vue précédente réelle, jamais au Studio par erreur ; le Studio garde son identifiant de vue et son retour', opts, async () => {
  const env = await H.open(browser, server, both());
  await boot(env); const { page } = env;
  await page.evaluate(() => go('analyses')); await toAdmin(env);
  assert.equal(await page.evaluate(() => state.route), 'admin'); assert.ok(!(await page.evaluate(() => state.stack.some(s => s.route === 'studio'))), 'le Studio n\'est pas dans la pile : jamais visité');
  await page.evaluate(() => back()); await page.waitForFunction(() => state.route !== 'admin'); assert.equal(await page.evaluate(() => state.route), 'home', 'retour : la vue d\'avant (la navigation du menu réinitialise la pile)');
  assert.notEqual(await page.evaluate(() => state.route), 'studio');
  await toStudio(env); assert.equal(await page.evaluate(() => state.route), 'studio', 'le Studio garde son identifiant de vue'); assert.equal(await page.evaluate(() => typeof V.studio + typeof V.admin + (V.studio === V.admin)), 'functionfunctionfalse', 'deux fonctions de rendu distinctes');
  await page.evaluate(() => go('admin')); await page.waitForFunction(() => state.route === 'admin'); await page.evaluate(() => back()); await page.waitForFunction(() => state.route === 'studio'); assert.equal(await page.evaluate(() => state.route), 'studio', 'venu du Studio : retour au Studio (vue précédente réelle)');
  await page.evaluate(() => back()); await page.waitForFunction(() => state.route !== 'studio'); assert.equal(await page.evaluate(() => state.route), 'home');
  await page.evaluate(() => go('admin')); await page.waitForFunction(() => state.route === 'admin'); assert.match(await page.evaluate(() => document.getElementById('app').innerText), /Administration/); assert.equal(await page.evaluate(() => document.querySelectorAll('.main [data-ms], .main [class*="c-ms-"], .main [class*="c-hs-"]').length), 0, 'la page d\'administration ne contient aucun élément du Studio (le libellé « Maquillage (Studio Beauté) » est une ligne d\'état de fonctionnalité, pas le Studio)');
  noPaid(env); clean(env); await env.close();
});

test('SEP8 le Studio garde son comportement : maquillage (une demande, toutes les catégories), coiffure et couleur (leurs onglets et leur essai), sans aucun appel d\'administration autre que la vérification de menu', opts, async () => {
  const env = await H.open(browser, server, both());
  await boot(env); const { page } = env;
  await toStudio(env); await page.setInputFiles('#ms-file', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: await H.makeJpeg(page) }); await page.waitForSelector('.c-ms-preview img');
  assert.deepEqual((await page.locator('[data-ms=mode]').allInnerTexts()).slice(0, 3), ['Maquillage', 'Coiffures et perruques', 'Couleurs de cheveux']);
  await page.click('[data-ms=look][data-id=elegant]'); await page.click('[data-ms=run]'); await page.waitForSelector('[data-ms=after]'); assert.equal(env.stats.mk.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(decodeURIComponent(env.stats.mk[0].url.split('cfg=')[1]))).sort(), ['blush', 'eyes', 'lips', 'v']);
  await page.click('[data-ms=mode][data-v=haircolor]'); await page.click('[data-hs=preset][data-v="Burgundy"]'); await page.click('[data-hs=run]'); await page.waitForSelector('[data-hs=after]'); assert.equal(env.stats.hr.length, 1);
  await page.click('[data-ms=mode][data-v=hairstyle]'); await page.waitForSelector('.c-hs-card'); assert.equal(env.stats.hrTemplates.length, 1);
  assert.deepEqual(env.stats.adm.map(x => x.section), ['access'], 'seule la vérification d\'accès du menu : aucune section d\'administration');
  clean(env); await env.close();
});
