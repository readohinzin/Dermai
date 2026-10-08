'use strict';
/* Étape 26.3 : lecture des masques Perfect Corp SEMI-TRANSPARENTS (js/face-map.js, interpretMask + paint).
   Les masques ci-dessous sont synthétiques, mais construits pour reproduire les caractéristiques MESURÉES sur les 15 vrais masques d'une
   vraie analyse (étape 26.1) : PNG 1200 × 1600 (taille de la photo), fond transparent, zones colorées semi-transparentes, part de pixels
   non transparents et part au-dessus de la mi-opacité. Aucun appel réseau, aucune analyse Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FM = require('../js/face-map.js');
const { Engine, norm } = require('./helpers/engine.js');
const C = require('../js/engine/data/catalog.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const W = 1200, H = 1600, N = W * H;
/* Masque RGBA : alpha(x, y) donne l'opacité ; zone colorée (teinte arbitraire, comme les vrais masques), fond transparent noir. */
function mask(alphaAt, w = W, h = H, rgb = [200, 120, 40]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = alphaAt(x, y), i = (y * w + x) * 4;
    if (a > 0) { px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = a; }
  }
  return px;
}
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
/* Mesures du script de console de l'étape 26.1 (même définition), pour vérifier que chaque masque synthétique ressemble au vrai. */
function stats(px, w = W, h = H) {
  let partial = 0, opaque = 0, ge128 = 0;
  for (let i = 3; i < px.length; i += 4) { const a = px[i]; if (a === 255) opaque++; else if (a > 0) partial++; if (a >= 128) ge128++; }
  const n = w * h;
  return { partial: partial / n, opaque: opaque / n, oldZone: ge128 / n };
}
/* Ancienne règle (avant l'étape 26.3), recopiée pour la comparaison : zone = alpha ≥ 128, vide si aucun pixel. */
const oldEmpty = px => stats(px).oldZone === 0;
const pct = x => +(100 * x).toFixed(1);

/* Profils proches des vrais masques (alpha_partiel / alpha_255 / zone≥128 mesurés). */
const REAL = {
  // Acné : 0,3 % partiels, 0 % opaques, 0,4 % ≥ 128 → petits éléments à cœur assez opaque et bord anti-crénelé
  acne: () => { const ds = Array.from({ length: 44 }, (_, k) => disc(300 + (k % 11) * 60, 500 + Math.floor(k / 11) * 160, 6));
    const rim = Array.from({ length: 44 }, (_, k) => disc(300 + (k % 11) * 60, 500 + Math.floor(k / 11) * 160, 7));
    return mask((x, y) => ds.some(f => f(x, y)) ? 200 : rim.some(f => f(x, y)) ? 60 : 0); },
  // Pores : alpha_partiel affiché 0,0 % (moins de 0,05 %) mais une teinte présente → quelques points minuscules
  pores: () => { const ds = Array.from({ length: 30 }, (_, k) => disc(400 + (k % 10) * 40, 700 + Math.floor(k / 10) * 40, 2)); return mask((x, y) => ds.some(f => f(x, y)) ? 90 : 0); },
  // Niveau d'huile : 2,3 % partiels, aucun pixel ≥ 128
  oiliness: () => mask((x, y) => (x >= 450 && x < 750 && y >= 300 && y < 300 + 147) ? 70 : 0),
  // Rougeurs : 4,3 % partiels, aucun pixel ≥ 128
  redness: () => mask((x, y) => (x >= 300 && x < 900 && y >= 800 && y < 800 + 138) ? 90 : 0),
  // Poches : 2,0 % partiels, aucun pixel ≥ 128
  eyeBag: () => mask((x, y) => ((x >= 330 && x < 530) || (x >= 670 && x < 870)) && y >= 640 && y < 640 + 96 ? 60 : 0),
  // Texture : 1,1 % opaques
  texture: () => mask((x, y) => (x >= 500 && x < 700 && y >= 1000 && y < 1000 + 106) ? 255 : 0),
  // Hydratation : 32,9 % partiels, 19,8 % ≥ 128 → grande zone à cœur dense et large halo
  hydration: () => mask((x, y) => (x >= 200 && x < 1000 && y >= 400 && y < 400 + 475) ? 180 : (x >= 200 && x < 1000 && y >= 875 && y < 875 + 314) ? 80 : 0)
};

test('M1 (9, 10 à 13) les masques synthétiques reproduisent les mesures réelles, et l\'ancienne règle les jugeait vides à tort', () => {
  const s = Object.fromEntries(Object.entries(REAL).map(([k, f]) => [k, f()]));
  const st = k => stats(s[k]);
  assert.deepEqual([pct(st('oiliness').partial), pct(st('oiliness').oldZone), pct(st('oiliness').opaque)], [2.3, 0, 0]);
  assert.deepEqual([pct(st('redness').partial), pct(st('redness').oldZone)], [4.3, 0]);
  assert.deepEqual([pct(st('eyeBag').partial), pct(st('eyeBag').oldZone)], [2.0, 0]);
  assert.deepEqual([pct(st('hydration').partial), pct(st('hydration').oldZone), pct(st('hydration').opaque)], [32.9, 19.8, 0]);
  assert.deepEqual([pct(st('texture').opaque), pct(st('texture').partial)], [1.1, 0]);
  assert.ok(st('acne').partial > 0.002 && st('acne').partial < 0.005 && st('acne').opaque === 0, 'acné : 0,3 à 0,4 %, aucun pixel opaque');
  assert.ok(st('pores').partial > 0 && st('pores').partial < 0.0005, 'pores : affiché 0,0 % mais pas vide');
  // ancienne règle : ces vraies zones étaient déclarées vides (« Localisation visuelle indisponible »)
  for (const k of ['oiliness', 'redness', 'eyeBag', 'pores']) assert.equal(oldEmpty(s[k]), true, k);
});

test('M2 (10 à 13, 17) nouvelle lecture : aucune vraie zone n\'est déclarée vide ; zones faibles et visibles distinguées', () => {
  const expect = { acne: 'visible', pores: 'faint', oiliness: 'faint', redness: 'faint', eyeBag: 'faint', texture: 'visible', hydration: 'visible' };
  for (const [k, f] of Object.entries(REAL)) {
    const m = FM.interpretMask(f(), W, H);
    assert.equal(m.mode, 'alpha', k);
    assert.equal(m.empty, false, k + ' : jamais déclaré vide');
    assert.equal(m.level, expect[k], k);
  }
});

test('M3 (C) couverture pondérée par l\'opacité : continue, ne perd aucune zone semi-transparente (comparée à l\'ancienne)', () => {
  for (const k of ['oiliness', 'redness', 'eyeBag']) {
    const px = REAL[k](), m = FM.interpretMask(px, W, H);
    let sum = 0;for (let i = 3; i < px.length; i += 4) sum += px[i];
    assert.equal(m.coverage, sum / (255 * N), k + ' : somme(alpha) / (255 × n)');
    assert.ok(m.coverage > 0 && stats(px).oldZone === 0, k + ' : nouvelle couverture > 0, ancienne = 0');
  }
  const hy = FM.interpretMask(REAL.hydration(), W, H);
  assert.ok(Math.abs(hy.coverage - (0.198 * 180 + 0.131 * 80) / 255) < 0.003, 'hydratation : cœur et halo pondérés');
  assert.ok(Math.abs(hy.area - 0.198) < 0.002, 'étendue à mi-hauteur : le cœur seulement');
});

test('M4 (1 à 9) série d\'opacités : vide réel, bruit sous le seuil de fond, zone faible, zone visible', () => {
  const sq = a => mask((x, y) => (x >= 80 && x < 120 && y >= 80 && y < 120) ? a : 0, 200, 200);
  const lv = a => FM.interpretMask(sq(a), 200, 200).level;
  assert.equal(FM.interpretMask(new Uint8ClampedArray(200 * 200 * 4), 200, 200).level, 'empty', '1. totalement transparent');
  assert.equal(lv(10), 'empty', '2. alpha 10 : sous le seuil qui définit déjà le fond transparent (16) : bord ou bruit, pas une zone');
  assert.deepEqual([lv(40), lv(80), lv(127)], ['faint', 'faint', 'faint'], '3 à 5. zones faibles mais réelles');
  assert.deepEqual([lv(128), lv(200)], ['visible', 'visible'], '6 et 7');
  const mix = FM.interpretMask(mask((x, y) => x < 100 ? (y < 100 ? 30 : 90) : (y < 100 ? 150 : 0), 200, 200), 200, 200);
  assert.deepEqual([mix.level, mix.peak, mix.half], ['visible', 150, 75], '8. mélange : contour à mi-hauteur du maximum du masque');
  const semi = FM.interpretMask(mask((x, y) => (x < 50 ? 254 : x < 100 ? 120 : 0), 200, 200), 200, 200);
  assert.equal(semi.level, 'visible', '9. entièrement semi-transparent (aucun 255), lisible');
  assert.equal(FM.FLOOR.alpha, 16); assert.match(read('js/face-map.js'), /if \(a < FLOOR\.alpha\) transparent\+\+;/, 'même seuil que la détection du fond');
});

test('M5 (D) masque vide : seuil relatif à la taille du masque (un pixel d\'écran à la plus grande taille d\'affichage), jamais un nombre magique', () => {
  const dots = (k, a = 200) => mask((x, y) => (y === 800 && x >= 600 && x < 600 + k) ? a : 0);
  const min = (W / FM.FRAME_MAX_CSS) ** 2;                         // ≈ 4,6 pixels de masque = 1 pixel d'écran à 560 px de large
  assert.ok(min > 4 && min < 5);
  assert.equal(FM.interpretMask(dots(4), W, H).level, 'empty', '4 pixels sur 1,92 million : invisibles à l\'écran');
  assert.equal(FM.interpretMask(dots(5), W, H).level, 'visible');
  const small = mask((x, y) => (x === 10 && y === 10 ? 200 : 0), 300, 400);
  assert.equal(FM.interpretMask(small, 300, 400).level, 'visible', 'masque plus petit que la carte : un pixel suffit');
  assert.match(read('css/components/face-map.css'), new RegExp(`\\.c-facemap__frame\\{[^}]*max-width:${FM.FRAME_MAX_CSS}px`), 'même largeur maximale que la carte');
  // pores entièrement transparent (si un vrai masque l'est) : vide, sans zone inventée
  assert.equal(FM.interpretMask(mask(() => 0), W, H).empty, true);
});

test('M6 (E, 16, 17, 19) rendu : zone faible lisible, contour à mi-hauteur, rien hors du masque, mêmes dimensions que le masque', () => {
  const w = 200, h = 200, a = new Uint8ClampedArray(w * h);
  for (let y = 60; y < 140; y++) for (let x = 60; x < 140; x++) a[y * w + x] = 70;                 // zone faible (comme les rougeurs)
  for (let y = 58; y < 142; y++) for (let x = 58; x < 142; x++) if (!a[y * w + x]) a[y * w + x] = 8;   // bord anti-crénelé
  const m = FM.interpretMask(mask((x, y) => a[y * w + x], w, h), w, h);
  const out = FM.paint(m.alpha, w, h, m.peak, m.half);
  assert.equal(out.length, w * h * 4, 'mêmes dimensions que le masque');
  const A = (x, y) => out[(y * w + x) * 4 + 3];
  assert.equal(A(100, 100), Math.round(255 * FM.FILL), 'cœur : remplissage de base (opacité rapportée au maximum du masque)');
  assert.equal(A(60, 100), Math.round(255 * FM.EDGE), 'contour au bord de la zone à mi-hauteur, même sans aucun pixel ≥ 128');
  assert.ok(A(58, 100) > 0 && A(58, 100) < A(100, 100), 'bord anti-crénelé : rempli, plus léger, sans contour');
  for (let i = 0; i < w * h; i++) if (!a[i]) assert.equal(out[i * 4 + 3], 0, 'hors du masque : rien');
  // un masque déjà opaque est rendu comme avant (rapport au maximum = 1)
  const b = new Uint8ClampedArray(w * h);for (let y = 50; y < 90; y++) for (let x = 50; x < 90; x++) b[y * w + x] = 255;
  assert.equal(FM.paint(b, w, h)[(70 * w + 70) * 4 + 3], Math.round(255 * FM.FILL));
  // vide : rien à peindre
  assert.equal(FM.paint(new Uint8ClampedArray(w * h), w, h).some(v => v), false);
});

test('M7 (16, UX) masque vide ≠ panne : « Aucune zone localisée… » ; illisible : « indisponible »', () => {
  const src = read('js/face-map.js'), app = read('js/app.js'), copy = require('../js/engine/copy.fr.js');
  assert.equal(copy.SYNTH.map.empty, 'Aucune zone localisée pour cet indicateur sur cette photo.');
  assert.equal(copy.SYNTH.map.unavailable, 'Localisation visuelle indisponible pour cet indicateur.');
  assert.match(src, /\(res\.length && res\.every\(r => r\.reason === 'empty'\) \? empty : failed\)\.push\(it\.label\)/);
  assert.match(src, /onStatus && onStatus\(failed, empty\);/);
  assert.match(app, /el\.textContent=failed\.length\?M\.unavailable:M\.empty/);
});

test('M8 (14, 15) le masque ne décide rien ; le score, lui, décide selon le moteur', () => {
  const n = s => norm({}, { fill: 70, rawMap: { acne: s }, rawFill: 80 });
  const loc = { acne: ['data:image/png;base64,AAAA'] }, loc2 = { acne: ['data:image/png;base64,' + 'B'.repeat(400)], redness: ['data:image/png;base64,CCCC'] };
  const run = (x, l) => Engine.run(Object.assign({}, x, l ? { localization: l } : {}), {}, { catalog: C.PRODUCTS });
  // même score, masques différents → décision identique
  assert.deepEqual(run(n(80), loc), run(n(80), loc2)); assert.deepEqual(run(n(80), loc), run(n(80)));
  // même masque, score différent → la décision suit le moteur (raw 80 : favorable ; raw 30 : axe retenu)
  const fav = run(n(80), loc), low = run(n(30), loc);
  assert.deepEqual(fav.priorities.items.map(i => i.indicator), []);
  assert.deepEqual(low.priorities.items.map(i => i.indicator), ['acne']);
  // le module de carte ne reçoit et ne lit aucun score
  assert.doesNotMatch(read('js/face-map.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1'), /\b(score|raw\w*|ui_?score|priorit\w*|band)\b/i);
});

test('M9 (18) aucune primitive de dessin inventée : seuls le masque et sa couleur', () => {
  const code = read('js/face-map.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /\b(arc|ellipse|lineTo|moveTo|fillRect|strokeRect|bezierCurveTo|quadraticCurveTo)\(|<(svg|path|polygon|line|circle)|globalCompositeOperation|globalAlpha/);
  assert.deepEqual([...new Set(code.match(/\b(drawImage|putImageData)\b/g))].sort(), ['drawImage', 'putImageData']);
});
