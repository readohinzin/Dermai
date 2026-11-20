'use strict';
/* Lot 8 (peaux foncées) : niveau de confiance de chaque mesure, calculé par DermAI (le fournisseur n'en donne pas). Photo un peu mauvaise, teint, mesure sensible : confiance moyenne,
   faible, ou « peu fiable pour cette photo » = mesure MASQUÉE (copie d'affichage, donnée enregistrée intacte). Jamais de « confiance élevée » tant que rien n'est calibré. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/confidence.js');
const T = require('../js/skin-tone.js');
const M = require('../js/skin-model.js');
const D = require('../js/declared-concerns.js');
const Engine = require('../js/engine/index.js');
const H = require('./helpers/browser-harness.js');
const { norm } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const photo = (level, ...codes) => ({ level, issues: codes.map(code => ({ code, level: 'warn' })) });
const mk = (check, ui, o) => { const n = norm(ui || {}, Object.assign({ raw: 70 }, o || {})); C.note(n, check); return n; };

test('CF1 jamais « élevée » : bonne photo = moyenne ; contour des yeux et cernes = faible ; photo non vérifiée = le dit', () => {
  assert.equal(C.HIGH_ENABLED, false);
  const good = mk(photo('ok'));
  for (const id of M.METRIC_KEYS) { const a = C.assessMetric(id, C.infoOf(good), null); assert.ok(a.level <= 2, id); assert.ok(!/élevée/i.test(a.label), a.label); }
  assert.equal(C.assessMetric('acne', C.infoOf(good), null).level, 2); assert.equal(C.assessMetric('acne', C.infoOf(good), null).label, 'Confiance moyenne');
  for (const id of ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid']) assert.equal(C.assessMetric(id, C.infoOf(good), null).level, 1, id);
  const unknown = norm({}, { raw: 70 });            // pas de contrôle enregistré (analyse enregistrée, démonstration)
  const u = C.assessMetric('acne', C.infoOf(unknown), null); assert.equal(u.level, 2); assert.match(u.reasons.join(' '), /qualité de la photo n'a pas pu être vérifiée/);
  C.note(unknown, null); assert.equal(C.infoOf(unknown).known, false, 'photo absente : jamais « vérifiée »');
});

test('CF2 doutes de photo : chaque doute n\'abaisse que les mesures qu\'il concerne ; deux doutes peuvent rendre une mesure peu fiable', () => {
  const dark = mk(photo('warn', 'dark')), blur = mk(photo('warn', 'blur')), both = mk(photo('warn', 'dark', 'blur')), uneven = mk(photo('warn', 'uneven'));
  const lvl = (n, id) => C.assessMetric(id, C.infoOf(n), null).level;
  assert.equal(lvl(dark, 'texture'), 1); assert.equal(lvl(dark, 'hydration'), 2, 'l\'hydratation n\'est pas touchée par une photo sombre');
  assert.equal(lvl(blur, 'texture'), 1); assert.equal(lvl(blur, 'pigmentation'), 2, 'le flou ne touche pas les taches');
  assert.equal(lvl(both, 'texture'), 0); assert.equal(lvl(both, 'pigmentation'), 1);
  assert.equal(lvl(uneven, 'hydration'), 1, 'lumière inégale : toutes les mesures');
  assert.deepEqual(C.hiddenIds(both, null), ['acne', 'pores', 'texture', 'wrinkles', 'firmness', 'darkCircle']);
  assert.deepEqual(C.hiddenIds(mk(photo('ok')), null), [], 'bonne photo : rien de masqué');
  const r = C.assessMetric('texture', C.infoOf(both), null); assert.equal(r.hidden, true); assert.equal(r.label, 'Peu fiable pour cette photo'); assert.match(r.reasons.join(' '), /un peu sombre.*un peu floue/);
});

test('CF3 teint foncé : la rougeur est peu fiable ; les autres mesures ne changent pas', () => {
  const n = mk(photo('ok'));
  assert.equal(C.assessMetric('redness', C.infoOf(n), 8).level, 0); assert.match(C.assessMetric('redness', C.infoOf(n), 8).reasons.join(), /peu fiable sur peau foncée/);
  assert.equal(C.assessMetric('redness', C.infoOf(n), 3).level, 2); assert.equal(C.assessMetric('acne', C.infoOf(n), 8).level, 2);
});

test('CF4 masquage : copie d\'affichage seulement, la donnée enregistrée garde la valeur reçue ; le moteur ne voit pas la mesure masquée', () => {
  const n = mk(photo('warn', 'dark', 'blur'), { texture: 10, acne: 10 }, { rawMap: { texture: 10, acne: 10 }, rawFill: 70 });
  const before = JSON.stringify(n), v = T.view(n, null);
  assert.notEqual(v, n); assert.deepEqual(v.texture, { rawScore: null, uiScore: null }); assert.deepEqual(v.acne, { rawScore: null, uiScore: null });
  assert.equal(v.hydration.uiScore, n.hydration.uiScore, 'les autres mesures sont intactes'); assert.equal(JSON.stringify(n), before, 'donnée enregistrée inchangée');
  const r = Engine.run(v, { goals: ['blemishes'], level: 'simple' });
  assert.ok(!r.priorities.items.some(p => ['acne', 'texture'].includes(p.indicator)), 'une mesure masquée n\'est jamais une priorité');
  assert.equal(r.interpretation.indicators.find(i => i.id === 'acne').available, false);
  assert.equal(T.view(mk(photo('ok')), null) !== undefined, true);
  const clean = mk(photo('ok')); assert.equal(T.view(clean, null), clean, 'sans masque : le même objet');
  for (const bad of [null, undefined, 3, 'x']) assert.doesNotThrow(() => C.note(bad, photo('ok')));
  T.addMasker(() => { throw new Error('défaillant'); }); assert.doesNotThrow(() => T.view(n, null));
});

test('CF5 encart « Fiabilité de cette analyse » : dit que DermAI calcule la confiance, résume, détaille ; bandeau « analyse peu fiable » si au moins 3 mesures principales sont masquées', () => {
  const ok = { normalized: mk(photo('ok')) }, h = C.card(ok, null), t = strip(h);
  assert.ok(h.includes('data-confidence') && h.includes('<details')); assert.match(t, /DermAI calcule lui-même cette confiance : le service d'analyse n'en fournit pas/);
  assert.match(t, /Ce n'est pas une mesure mais un repère de prudence, provisoire/); assert.ok(!h.includes('data-confidence-bad'));
  assert.match(t, /Acné\s+Confiance moyenne/); assert.match(t, /Cernes\s+Confiance faible/);
  const unv = C.card({ normalized: norm({}, { raw: 70 }) }, null); assert.ok(unv.includes('data-confidence-unverified'), 'photo non vérifiée : dit une fois'); assert.equal((strip(unv).match(/n'a pas pu être vérifiée/g) || []).length, 1, 'pas répété sur chaque ligne');
  const bad = { normalized: mk(photo('warn', 'dark', 'blur', 'uneven')) }, tb = strip(C.card(bad, null));
  assert.ok(C.card(bad, null).includes('data-confidence-bad')); assert.match(tb, /Analyse peu fiable pour cette photo/); assert.match(tb, /Refaites la photo en lumière du jour, de face, sans filtre ni contre-jour/);
  assert.match(tb, /Texture\s+Peu fiable pour cette photo/);
  /* mesure absente : pas de ligne, rien d'inventé */
  const none = norm({ texture: null }, { raw: 70 }); C.note(none, photo('ok')); assert.doesNotMatch(strip(C.card({ normalized: none }, null)), /Texture/);
  for (const badArg of [undefined, null, {}, { normalized: null }, { normalized: {} }]) assert.doesNotThrow(() => C.card(badArg, null));
  assert.equal(C.card(null, null), '');
});

test('CF6 écran Résultat : l\'encart passe par top() avant le reste ; vocabulaire cosmétique, aucun tiret cadratin', () => {
  const eng = Engine.run(T.view(norm({}, { raw: 70 }), null), { goals: [], level: 'simple' });
  const scan = { normalized: norm({}, { raw: 70 }) };
  assert.ok(D.top(eng, scan, null).indexOf('data-confidence') >= 0);
  assert.ok(D.top(eng, scan, null).indexOf('data-confidence') < D.top(eng, scan, null).indexOf('data-sun-note'));
  for (const x of [...Object.values(C.TEXT), ...Object.values(C.LABEL)]) { assert.ok(!/[—–]/.test(x), x); assert.doesNotMatch(x, /(?<![\p{L}])(?:diagnostic|malad|traiter|il faut|guérir)(?![\p{L}])/iu, x); }
});

test('CF7 câblage : module chargé après skin-tone, analyse enregistrée avant l\'affichage, app.js inchangé en taille ; rien n\'est écrit ni envoyé', () => {
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('skin-tone.js') < at('confidence.js') && at('confidence.js') < at('declared-concerns.js') && at('photo-check.js') < at('confidence.js'));
  const app = read('js/app.js');
  assert.match(app, /DermaiConfidence\.note\(normalized,state\.photoCheck\)/); assert.match(app, /DermaiDeclared\.top\(eng,s\)/);
  assert.equal(Buffer.byteLength(app), 149502, 'app.js : taille fixée, plafond non relevé');
  assert.doesNotMatch(read('js/confidence.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.|window\./);
});

/* ---- navigateur : une vraie analyse après une photo un peu sombre ---- */
const OK = H.available();
const opts = { skip: OK ? false : 'Playwright / Chromium indisponibles', timeout: 120000 };
let browser, server;
test.before(async () => { if (!OK) return; const stats = { serverApi: [] }; server = await H.startServer(stats); server.stats = stats; browser = await H.loadPlaywright().chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

test('CFB1 photo un peu sombre puis analyse : confiance affichée, cernes masqués à l\'écran mais conservés dans la donnée', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  const { page } = env;
  await page.goto('/scan'); await page.waitForSelector('[data-act=scan-start]', { timeout: 10000 }); await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  const b64 = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 800; const g = c.getContext('2d'); g.fillStyle = 'rgb(42,42,42)'; g.fillRect(0, 0, 640, 800);
    for (let i = 0; i < 4000; i++) { const v = 42 + ((i * 37) % 50) - 25; g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; g.fillRect((i * 97) % 640, (i * 61) % 800, 6, 6); } return c.toDataURL('image/jpeg', 0.92).split(',')[1]; });
  await page.setInputFiles('#realGalleryInput', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await page.waitForSelector('[data-act=analyze]', { timeout: 10000 });
  assert.equal(await page.locator('[data-photo-check]').getAttribute('data-photo-check'), 'warn', 'doute, pas blocage');
  await page.click('[data-act=analyze]');
  await page.waitForSelector('[data-confidence]', { timeout: 20000 });
  const t = await page.locator('[data-confidence]').innerText();
  assert.match(t, /DermAI calcule lui-même cette confiance/); assert.match(t, /1 peu fiable \(masquée\)/);
  await page.locator('[data-confidence] summary').click();
  const d = await page.locator('[data-confidence] details').innerText();
  assert.match(d, /La photo est un peu sombre\./); assert.match(d, /Texture\s+Confiance faible/); assert.match(d, /Cernes\s+Peu fiable pour cette photo/);
  const raw = await page.evaluate(() => SCANS[state.latest].normalized.darkCircle.uiScore), shown = await page.evaluate(() => TN.view(SCANS[state.latest].normalized).darkCircle.uiScore);
  assert.ok(raw !== null && shown === null, 'donnée conservée, affichage masqué');
  assert.deepEqual(env.errors, []); await env.close();
});
