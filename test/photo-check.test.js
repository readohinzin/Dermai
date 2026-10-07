'use strict';
/* Ajout d'une photo depuis la galerie + vérification locale d'utilisabilité avant tout envoi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PC = require('../js/photo-check.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const fnBody = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); let d = 0, j = src.indexOf('{', i); const s0 = j; for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(s0, j + 1); };

/* échantillons synthétiques en niveaux de gris : « visage » = fond sombre à médian + texture, jamais une vraie photo */
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const make = (w, h, fn) => { const g = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = Math.max(0, Math.min(255, Math.round(fn(x, y)))); return g; };
const textured = (base, amp, seed = 7) => { const r = rng(seed); return (x, y) => base + (r() - 0.5) * amp + 18 * Math.sin(x / 5) + 14 * Math.cos(y / 6); };
const sample = (base, amp, seed) => ({ gw: 192, gh: 256, gray: make(192, 256, textured(base, amp, seed)) });
const check = (o = {}) => PC.assess(Object.assign({ width: 1200, height: 1600 }, sample(120, 60), o));
const codes = r => r.issues.map(i => i.code).sort();

test('PH1 photo correcte : utilisable, aucun doute ; peau foncée bien éclairée : pas de fausse alerte de luminosité', () => {
  const r = check(); assert.equal(r.level, 'ok'); assert.deepEqual(r.issues, []); assert.equal(r.title, 'Photo utilisable');
  assert.match(r.body, /service d'analyse confirmera la détection du visage/, 'la vérification locale ne prétend pas remplacer le service');
  // peau foncée : moyenne basse (≈ 70) mais hautes lumières présentes (visage éclairé de face)
  const dark = check(sample(62, 80, 11)); assert.equal(dark.level, 'ok', 'une photo de peau foncée bien éclairée n\'est pas jugée sombre : ' + codes(dark));
});

test('PH2 cas évidents bloquants : trop petite, format panoramique, presque noire, presque blanche', () => {
  assert.deepEqual(codes(check({ width: 200, height: 260 })), ['tiny']); assert.equal(check({ width: 200, height: 260 }).level, 'block');
  assert.deepEqual(codes(check({ width: 4000, height: 1200 })), ['format']);
  const black = check({ gray: make(192, 256, () => 6) }); assert.equal(black.level, 'block'); assert.ok(codes(black).includes('black'));
  const white = check({ gray: make(192, 256, () => 252) }); assert.equal(white.level, 'block'); assert.ok(codes(white).includes('white'));
  assert.equal(PC.assess({ width: 0, height: 0 }).level, 'block');
  for (const r of [check({ width: 200, height: 260 }), black, white]) { assert.equal(r.title, 'Photo inutilisable'); assert.ok(r.issues.every(i => i.text.length > 20)); }
});

test('PH3 doutes non bloquants : petite, sombre, surexposée, floue ; l\'utilisatrice garde le choix', () => {
  assert.deepEqual(codes(check({ width: 480, height: 640 })), ['small']);
  const dim = check(sample(30, 40, 3)); assert.ok(codes(dim).includes('dark'), codes(dim));
  const bright = check(sample(238, 20, 5)); assert.ok(codes(bright).includes('bright'), codes(bright));
  const blur = check({ gray: make(192, 256, (x, y) => 120 + 40 * Math.sin(x / 40) + 30 * Math.cos(y / 50)) }); assert.ok(codes(blur).includes('blur'), 'lisse = floue : ' + codes(blur));
  for (const r of [check({ width: 480, height: 640 }), dim, bright, blur]) { assert.equal(r.level, 'warn'); assert.equal(r.title, 'Photo à vérifier'); assert.ok(r.issues.every(i => i.level === 'warn')); }
  assert.ok(!codes(check()).includes('blur'), 'une photo texturée n\'est pas floue');
});

test('PH4 détection de visage (si le navigateur la propose) : aucun, plusieurs, trop petit → doutes ; inconnue → aucune conclusion', () => {
  assert.deepEqual(codes(check({ faces: { count: 0, widthRatio: 0 } })), ['noface']);
  assert.deepEqual(codes(check({ faces: { count: 2, widthRatio: 0 } })), ['multi']);
  assert.deepEqual(codes(check({ faces: { count: 1, widthRatio: 0.08 } })), ['faceSmall']);
  assert.equal(check({ faces: { count: 1, widthRatio: 0.5 } }).level, 'ok');
  assert.equal(check({ faces: null }).level, 'ok', 'navigateur sans détecteur : on ne conclut rien');
  assert.equal(check({ faces: { count: 0, widthRatio: 0 } }).level, 'warn', 'un visage non détecté ne bloque jamais (faux négatifs possibles) : l\'utilisatrice décide');
});

test('PH5 le module est pur : aucun réseau, aucun stockage, aucune dépendance ; seuils documentés', () => {
  const src = strip(read('js/photo-check.js'));
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|document\.|window\.|navigator|cookie|FormData|Blob\(|FileReader/);
  assert.match(read('js/photo-check.js'), /seuils sont volontairement indulgents pour les peaux foncées/);
  assert.ok(PC.T.hardMinSide < PC.T.softMinSide && PC.T.blackP95 < PC.T.darkP95 && PC.T.brightP05 < PC.T.whiteP05);
});

test('PH6 câblage : appareil photo ET galerie, vérification avant envoi, aucun envoi ni stockage de la photo par la vérification', () => {
  const app = read('js/app.js');
  const input = fnBody(app, 'function realInput(');   // texte brut : « image/* » ressemble à un début de commentaire pour le nettoyeur
  assert.match(input, /if\(camera\)inp\.setAttribute\(`capture`,`user`\)/, 'capture=user seulement pour l\'appareil photo : la galerie n\'a aucun attribut capture');
  assert.match(input, /`realPhotoInput`:`realGalleryInput`/); assert.match(input, /inp\.accept=`image\/\*`/);
  assert.match(app, /data-act="gallery">Choisir dans ma galerie/); assert.match(app, /Prendre une photo/); assert.match(app, /Ajouter une photo/);
  assert.match(app, /case `gallery`:if\(!DEMO_MODE\)pickRealPhoto\(`file`\)/); assert.match(app, /e\.target\.id===`realPhotoInput`\|\|e\.target\.id===`realGalleryInput`/);
  assert.match(fnBody(app, 'function pickRealPhoto('), /realInput\(kind===`camera`&&touchUi\(\)\)/);
  const hand = fnBody(app, 'async function handleRealPhoto(');
  assert.ok(hand.indexOf('inspectPhoto(blob)') > 0 && hand.indexOf('inspectPhoto(blob)') < hand.indexOf('render()'), 'vérification avant l\'écran d\'aperçu');
  assert.doesNotMatch(hand, /provider|analyzeSkin|fetch\(|ACCOUNT/, 'choisir une photo n\'envoie rien');
  assert.doesNotMatch(fnBody(app, 'async function inspectPhoto('), /fetch\(|XMLHttpRequest|localStorage|sessionStorage|analyzeSkin|provider|postJpeg|ACCOUNT|toDataURL|FileReader/, 'la vérification ne transmet ni ne stocke rien');
  const run = fnBody(app, 'async function runRealAnalysis(');
  assert.ok(run.indexOf('photoCheck.level===`block`') > 0 && run.indexOf('photoCheck.level===`block`') < run.indexOf('provider.analyzeSkin'), 'photo inutilisable : jamais d\'envoi');
  assert.match(app, /state\.photoCheck&&state\.photoCheck\.level===`block`&&!state\.scanError\?``:/, 'photo inutilisable : pas de bouton d\'analyse');
  assert.match(app, /Analyser quand même/); assert.match(app, /data-photo-check="\$\{c\.level\}"/);
  assert.match(read('index.html'), /js\/photo-check\.js[\s\S]*js\/app\.js/, 'chargé avant app.js');
  for (const sig of ['async function handleRealPhoto(', 'function jpegFromFile(', 'async function inspectPhoto(', 'async function runRealAnalysis(', 'function pickRealPhoto(', 'function realInput(']) assert.doesNotMatch(fnBody(app, sig), /localStorage|sessionStorage|indexedDB/, sig + ' : la photo n\'est jamais écrite dans un stockage');
});
