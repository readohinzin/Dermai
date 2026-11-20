'use strict';
/* Lot 6 (peaux foncées) : conseils de prise de photo et contrôle de qualité AVANT l'analyse. « Photo à refaire » plutôt qu'un résultat quand la photo est clairement
   mauvaise (trop sombre, surexposée, floue, visage dans l'ombre) ; simple avertissement pour un doute (contre-jour probable, lumière un peu inégale…). Le visage détecté ne
   bloque jamais. Échantillons synthétiques seulement : seuils provisoires, à calibrer avec de vraies photos (tâche 7). Aucun réseau hors du banc d'essai du navigateur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PC = require('../js/photo-check.js');
const H = require('./helpers/browser-harness.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const make = (w, h, fn) => { const g = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.max(0, Math.min(255, Math.round(fn(x, y)))); return g; };
const textured = (base, amp, seed = 7) => { const r = rng(seed); return (x, y) => base + (r() - 0.5) * amp + 18 * Math.sin(x / 5) + 14 * Math.cos(y / 6); };
const W = 192, Hh = 256;
const check = (gray, o = {}) => PC.assess(Object.assign({ width: 1200, height: 1600, gw: W, gh: Hh, gray }, o));
const codes = r => r.issues.map(i => i.code).sort();
/* portrait synthétique : visage au centre (ellipse), fond autour */
const portrait = ({ face, bg, faceAmp = 70, left, right, seed = 3, flat = false }) => {
  const r0 = rng(seed + 9), t = flat ? () => face + (r0() - 0.5) * faceAmp : textured(face, faceAmp, seed), r = rng(seed + 1);
  return make(W, Hh, (x, y) => {
    const inFace = ((x - W / 2) / (W * 0.27)) ** 2 + ((y - Hh * 0.47) / (Hh * 0.30)) ** 2 < 1;
    if (!inFace) return bg + (r() - 0.5) * 14;
    const side = x < W / 2 ? (left === undefined ? 0 : left - face) : (right === undefined ? 0 : right - face);
    return t(x, y) + side;
  });
};

test('PQ1 trop sombre, trop surexposée, trop floue : « Photo à refaire », aucun envoi possible', () => {
  const dark = check(make(W, Hh, textured(14, 30, 5))), bright = check(make(W, Hh, (x, y) => 240 + 8 * Math.sin(x / 7) + 5 * Math.cos(y / 9))), blur = check(make(W, Hh, () => 120));
  for (const [r, code] of [[dark, 'verydark'], [bright, 'verybright'], [blur, 'veryblur']]) {
    assert.equal(r.level, 'block', code); assert.equal(r.title, 'Photo à refaire'); assert.match(r.body, /ne serait pas fiable/); assert.ok(codes(r).includes(code), codes(r).join());
  }
  assert.equal(PC.assess({ width: 200, height: 260 }).title, 'Photo à refaire');
});

test('PQ2 un doute avertit seulement : un peu sombre, un peu surexposée, un peu floue ; l\'utilisatrice décide', () => {
  const dim = check(make(W, Hh, textured(30, 40, 3))), bright = check(make(W, Hh, textured(238, 20, 5)));
  const soft = check(make(W, Hh, (x, y) => 120 + 40 * Math.sin(x / 40) + 30 * Math.cos(y / 50)));
  for (const r of [dim, bright, soft]) { assert.equal(r.level, 'warn'); assert.equal(r.title, 'Photo à vérifier'); assert.ok(r.issues.every(i => i.level === 'warn')); }
  assert.ok(codes(dim).includes('dark') && codes(bright).includes('bright') && codes(soft).includes('blur'));
});

test('PQ3 lumière inégale : un côté dans l\'ombre = à refaire ; un écart moyen = avertissement ; visage bien éclairé = rien', () => {
  const even = check(portrait({ face: 120, bg: 90 }));
  assert.equal(even.level, 'ok', codes(even).join());
  const half = check(portrait({ face: 120, bg: 90, left: 40, right: 180 }));        // un côté dans l'ombre
  assert.equal(half.level, 'block'); assert.ok(codes(half).includes('unevenHard')); assert.equal(half.title, 'Photo à refaire');
  const mild = check(portrait({ face: 120, bg: 90, left: 85, right: 150 }));         // écart moyen
  assert.equal(mild.level, 'warn'); assert.ok(codes(mild).includes('uneven') && !codes(mild).includes('unevenHard'), codes(mild).join());
});

test('PQ4 contre-jour probable : avertissement seulement, jamais de blocage ; peau foncée bien éclairée devant un mur clair : aucune fausse alerte', () => {
  const back = check(portrait({ face: 44, faceAmp: 8, bg: 215, flat: true }));                    // fond très clair, visage sombre et plat
  assert.ok(codes(back).includes('backlight'), codes(back).join()); assert.equal(back.level, 'warn', 'jamais bloquant');
  assert.ok(back.issues.every(i => i.level === 'warn'));
  /* peau foncée, éclairée de face, mur clair : rapport fond/visage élevé MAIS beaucoup de relief dans le visage */
  const darkSkinWall = check(portrait({ face: 70, faceAmp: 90, bg: 200, seed: 11 }));
  assert.ok(!codes(darkSkinWall).includes('backlight'), 'fausse alerte de contre-jour : ' + codes(darkSkinWall).join());
  assert.notEqual(darkSkinWall.level, 'block', codes(darkSkinWall).join());
  /* lighting() : valeurs mesurées */
  const lt = PC.lighting(make(W, Hh, () => 100), W, Hh); assert.ok(lt.uneven < 0.01 && Math.abs(lt.ring - 1) < 0.01);
});

test('PQ5 le visage détecté ne bloque jamais (un refus à tort bloquerait les personnes visées) ; sans détecteur : aucune conclusion', () => {
  const good = make(W, Hh, textured(120, 60));
  for (const faces of [{ count: 0, widthRatio: 0 }, { count: 2, widthRatio: 0 }, { count: 1, widthRatio: 0.05 }]) { const r = check(good, { faces }); assert.equal(r.level, 'warn'); assert.ok(r.issues.every(i => i.level === 'warn')); }
  assert.equal(check(good, { faces: null }).level, 'ok');
  const src = read('js/photo-check.js');
  assert.match(src, /Le visage détecté ne bloque JAMAIS/); assert.match(src, /Sur iPhone \(Safari\), aucun détecteur de visage n'existe/); assert.match(src, /PROVISOIRES/);
});

test('PQ6 conseils de prise de photo : lumière du jour de face, sans filtre, sans contre-jour, visage neutre, sans maquillage ; icônes existantes', () => {
  assert.equal(PC.TIPS.length, 5);
  const txt = PC.TIPS.map(t => t.join(' ')).join(' | ');
  assert.match(txt, /Lumière du jour, de face/); assert.match(txt, /sans contre-jour/); assert.match(txt, /Aucun filtre, aucun mode beauté/); assert.match(txt, /expression neutre/);
  assert.match(txt, /maquillage/); assert.match(txt, /Une seule personne/); assert.ok(!/[—–]/.test(txt));
  const app = read('js/app.js'), icons = app.slice(app.indexOf('const ICONS={'), app.indexOf('const ic=n=>'));
  for (const [icon, title, text] of PC.TIPS) { assert.match(icons, new RegExp('\\b' + icon + ':`'), 'icône ' + icon); assert.ok(title.length > 5 && text.length > 20); }
  assert.match(app, /const TIPS=DermaiPhotoCheck\.TIPS;/); assert.match(app, /const tipsHtml=\(\)=>TIPS\.map\(/);
});

test('PQ7 chaque message dit quoi faire ; ton cosmétique ; aucun tiret cadratin ; app.js inchangé en taille', () => {
  const fix = /(Placez-vous|Évitez|Tenez|Choisissez|rapprochez|Tournez-vous|gardez|évitez|Refaites|refaites)/i;
  for (const code of ['verydark', 'verybright', 'veryblur', 'unevenHard', 'uneven', 'backlight', 'dark', 'bright', 'blur']) { assert.match(PC.TEXT[code], fix, code); assert.ok(!/[—–]/.test(PC.TEXT[code]), code); }
  for (const t of Object.values(PC.TEXT)) assert.doesNotMatch(t, /(?<![\p{L}])(?:diagnostic|malad|patholog|traiter|il faut)(?![\p{L}])/iu, t);
  assert.equal(Buffer.byteLength(read('js/app.js')), 149502, 'app.js : taille fixée, plafond non relevé');
  assert.doesNotMatch(read('js/photo-check.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.|window\.|navigator/);
});

/* ---- navigateur : la vraie application, une photo clairement mauvaise n'est jamais envoyée ---- */
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

async function jpeg(page, paint) {
  const b64 = await page.evaluate(src => { const c = document.createElement('canvas'); c.width = 640; c.height = 800; const g = c.getContext('2d'); new Function('g', src)(g); return c.toDataURL('image/jpeg', 0.92).split(',')[1]; }, paint);
  return Buffer.from(b64, 'base64');
}
async function choose(env, paint) {
  const { page } = env;
  await page.goto('/scan');
  await page.waitForSelector('[data-act=scan-start]', { timeout: 10000 });
  await page.click('[data-act=scan-start]');
  await page.evaluate(() => act('gallery'));
  await page.setInputFiles('#realGalleryInput', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: await jpeg(page, paint) });
  await page.waitForSelector('[data-photo-check], [data-act=analyze]', { timeout: 10000 });
}
const NOISE = (base, amp) => `g.fillStyle='rgb(${base},${base},${base})';g.fillRect(0,0,640,800);for(let i=0;i<4000;i++){const v=Math.round(${base}+((i*37)%${amp})-${amp}/2);g.fillStyle='rgb('+v+','+v+','+v+')';g.fillRect((i*97)%640,(i*61)%800,6,6)}`;

test('PQB1 photo beaucoup trop sombre : « Photo à refaire », pas de bouton d\'analyse, aucune requête d\'analyse', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await choose(env, NOISE(24, 10));
  assert.equal(await env.page.locator('[data-photo-check="block"]').count(), 1);
  const t = await env.page.locator('[data-photo-check]').innerText();
  assert.match(t, /Photo à refaire/); assert.match(t, /beaucoup trop sombre/); assert.match(t, /face à une fenêtre/);
  assert.equal(await env.page.locator('[data-act=analyze]').count(), 0, 'aucun bouton « Analyser »');
  assert.ok(await env.page.locator('[data-act=retake]').count() >= 1, 'on propose de refaire la photo');
  assert.equal(env.stats.skin.length, 0, 'aucune analyse envoyée'); assert.deepEqual(env.stats.serverApi, []); assert.deepEqual(env.errors, []);
  await env.close();
});

test('PQB2 visage dans l\'ombre d\'un côté : à refaire ; photo un peu sombre : doute, « Analyser quand même » reste possible', opts, async () => {
  const env = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await choose(env, `g.fillStyle='rgb(150,150,150)';g.fillRect(0,0,640,800);for(let i=0;i<4000;i++){const v=150+((i*37)%40)-20;g.fillStyle='rgb('+v+','+v+','+v+')';g.fillRect((i*97)%640,(i*61)%800,6,6)}g.fillStyle='rgb(30,30,30)';g.fillRect(180,160,140,420);g.fillStyle='rgb(175,175,175)';g.fillRect(320,160,140,420);`);
  const t = await env.page.locator('[data-photo-check]').innerText();
  assert.equal(await env.page.locator('[data-photo-check]').getAttribute('data-photo-check'), 'block', t);
  assert.match(t, /Photo à refaire/); assert.match(t, /dans l'ombre/); assert.equal(await env.page.locator('[data-act=analyze]').count(), 0);
  await env.close();
  const env2 = await H.open(browser, server, { user: { email: 'a@exemple.com' } });
  await choose(env2, NOISE(52, 90));
  const lvl = await env2.page.locator('[data-photo-check]').getAttribute('data-photo-check');
  assert.ok(['warn', 'ok'].includes(lvl), 'une photo un peu sombre ne bloque pas : ' + lvl);
  assert.ok(await env2.page.locator('[data-act=analyze]').count() === 1, 'l\'utilisatrice peut encore analyser');
  assert.equal(env2.stats.skin.length, 0); assert.deepEqual(env2.errors, []);
  await env2.close();
});
