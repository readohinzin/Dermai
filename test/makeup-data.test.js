'use strict';
/* Studio Beauté : données de l'interface (js/makeup-data.js). Chaque couleur, texture, intensité et look proposé doit être accepté par la validation du serveur
   (server/makeup.js) : l'interface ne peut pas proposer ce que le serveur refuse. */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/makeup-data.js');
const M = require('../server/makeup.js');

const lum = hex => { const n = parseInt(hex.slice(1), 16), f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };

test('MD1 catégories et palettes : Teint, Lèvres, Blush, Yeux ; couleurs #RRGGBB uniques, noms uniques, toutes acceptées par le serveur', () => {
  assert.deepEqual(D.CATEGORIES.map(c => c[1]), ['Teint', 'Lèvres', 'Blush', 'Yeux']);
  assert.deepEqual(D.CATEGORIES.map(c => c[0]), ['foundation', 'lips', 'blush', 'eyes']);
  for (const [cat] of D.CATEGORIES) {
    const p = D.PALETTES[cat]; assert.ok(p.length >= 10, cat);
    assert.equal(new Set(p.map(x => x.color.toLowerCase())).size, p.length, cat + ' : couleurs uniques'); assert.equal(new Set(p.map(x => x.label)).size, p.length, cat + ' : noms uniques');
    for (const x of p) { assert.match(x.color, /^#[0-9A-Fa-f]{6}$/); assert.ok(x.label && x.id, x.color); }
    const cfg = cat === 'foundation' ? { v: 1, foundation: { color: p[0].color, colorIntensity: 40, glowIntensity: 30, coverageIntensity: 40 } } : { v: 1, [cat]: { color: p[0].color, texture: D.TEXTURES[cat][0][0], colorIntensity: 50 } };
    for (const x of p) { const c = JSON.parse(JSON.stringify(cfg)); (c[cat]).color = x.color; assert.doesNotThrow(() => M.normalizeConfig(c), cat + ' ' + x.color); }
  }
});

test('MD2 carnations foncées : nuances de teint profondes en nombre, lèvres et blush riches, pas seulement des tons clairs ni réservés à la soirée', () => {
  const dark = D.FOUNDATION.filter(f => lum(f.color) < 0.11), light = D.FOUNDATION.filter(f => lum(f.color) > 0.45);
  assert.ok(dark.length >= 6, 'au moins six nuances profondes : ' + dark.length); assert.ok(light.length >= 3);
  assert.ok(D.FOUNDATION.some(f => /Ébène/.test(f.label)) && D.FOUNDATION.some(f => /Cacao/.test(f.label)));
  assert.ok(D.LIPS.filter(l => lum(l.color) < 0.07).length >= 4, 'lèvres profondes (cacao, chocolat, bordeaux, aubergine…)');
  assert.ok(D.BLUSH.some(b => /Terracotta|Brique/.test(b.label)) && D.EYES.some(e => /Cuivre|Bronze|Or/.test(e.label)));
  /* Le look « Naturel » a une version profonde : couleurs plus riches que la version claire, sans passer par « Soirée ». */
  const nat = D.LOOKS.find(l => l.id === 'natural');
  assert.ok(lum(nat.tones.deep.lips.color) < lum(nat.tones.light.lips.color), 'nude cacao pour la carnation foncée'); assert.ok(lum(nat.tones.deep.blush.color) < lum(nat.tones.light.blush.color));
  for (const l of D.LOOKS) for (const t of D.TONES) assert.ok(l.tones[t[0]], `${l.id}/${t[0]}`);
  /* Rien dans les teintes de fond ne s'éclaircit au point d'être le seul choix : les ordres sont du plus clair au plus foncé. */
  for (let i = 1; i < D.FOUNDATION.length; i++) assert.ok(lum(D.FOUNDATION[i].color) <= lum(D.FOUNDATION[i - 1].color) + 1e-9, 'ordre clair → foncé à ' + D.FOUNDATION[i].label);
});

test('MD3 textures : exactement celles du schéma pour chaque catégorie, avec libellé français', () => {
  for (const cat of ['lips', 'blush', 'eyes']) {
    assert.deepEqual(D.TEXTURES[cat].map(t => t[0]).sort(), [...M.TEXTURES[cat]].sort(), cat);
    for (const t of D.TEXTURES[cat]) assert.ok(t[1] && t[1] !== t[0], 'libellé en français : ' + t[0]);
  }
  assert.equal(D.TEXTURES.foundation, undefined, 'le teint n\'a pas de texture');
});

test('MD4 looks Naturel / Élégant / Glamour / Soirée : trois versions chacun, construits avec couleur, texture et intensité seulement, tous acceptés par le serveur, sans fond de teint imposé', () => {
  assert.deepEqual(D.LOOKS.map(l => l.label), ['Naturel', 'Élégant', 'Glamour', 'Soirée']);
  for (const l of D.LOOKS) for (const [tone] of D.TONES) {
    const sel = D.applyLook(D.fresh(), l.id, tone), cfg = D.toConfig(sel);
    assert.equal(sel.foundation.on, false, 'aucun fond de teint imposé'); assert.deepEqual(Object.keys(cfg).sort(), ['blush', 'eyes', 'lips', 'v']);
    assert.doesNotThrow(() => M.normalizeConfig(cfg), `${l.id}/${tone}`);
    const effects = M.buildEffects(cfg); assert.equal(effects.length, 4, 'skin_smooth + lèvres + blush + yeux'); assert.equal(effects[0].category, 'skin_smooth');
  }
  assert.equal(D.applyLook(D.fresh(), 'natural', 'inconnue').lips.color, D.LOOKS[0].tones.medium.lips.color, 'carnation inconnue : médium');
  assert.equal(D.applyLook(D.fresh(), 'inconnu', 'medium').lips.on, false, 'look inconnu : rien ne change');
  const a = D.fresh(), b = D.applyLook(a, 'glamour', 'deep'); assert.equal(a.lips.on, false, 'la sélection d\'origine n\'est pas modifiée'); assert.equal(b.lips.on, true);
  b.lips.color = '#000000'; assert.notEqual(D.LOOKS[2].tones.deep.lips.color, '#000000', 'pas de partage de référence avec les données');
});

test('MD5 conversion : seules les catégories activées sont envoyées, avec uniquement couleur, texture et intensités', () => {
  const sel = D.fresh(); assert.deepEqual(D.toConfig(sel), { v: 1 }); assert.equal(D.hasMakeup(sel), false);
  sel.lips.on = true; sel.foundation.on = true;
  const cfg = D.toConfig(sel); assert.deepEqual(Object.keys(cfg).sort(), ['foundation', 'lips', 'v']); assert.deepEqual(Object.keys(cfg.foundation).sort(), ['color', 'colorIntensity', 'coverageIntensity', 'glowIntensity']); assert.deepEqual(Object.keys(cfg.lips).sort(), ['color', 'colorIntensity', 'texture']);
  assert.equal(D.hasMakeup(sel), true); assert.doesNotThrow(() => M.normalizeConfig(cfg));
  assert.deepEqual(Object.keys(D.DEFAULTS.foundation).sort(), ['color', 'colorIntensity', 'coverageIntensity', 'glowIntensity', 'on']);
});

test('MD6 lecture assainie (favoris) : valeurs invalides → défauts, jamais d\'erreur ni de valeur hors schéma', () => {
  for (const raw of [null, undefined, 'x', 12, [], {}, { lips: 'x' }, { lips: null }, { lips: { on: true, color: 'rouge', texture: 'glitter', colorIntensity: 500 } }]) {
    const s = D.sanitizeSelection(raw); assert.deepEqual(Object.keys(s).sort(), ['blush', 'eyes', 'foundation', 'lips']);
    if (s.lips.on) assert.doesNotThrow(() => M.normalizeConfig(D.toConfig(s)));
    assert.equal(s.lips.color, D.DEFAULTS.lips.color); assert.equal(s.lips.texture, D.DEFAULTS.lips.texture); assert.equal(s.lips.colorIntensity, D.DEFAULTS.lips.colorIntensity);
  }
  const ok = D.sanitizeSelection({ lips: { on: true, color: '#ABCDEF', texture: 'gloss', colorIntensity: 33, extra: 'x', __proto__: { x: 1 } }, foundation: { on: true, color: '#112233', colorIntensity: 10, glowIntensity: 20, coverageIntensity: 30 } });
  assert.deepEqual(ok.lips, { on: true, color: '#abcdef', texture: 'gloss', colorIntensity: 33 }); assert.deepEqual(ok.foundation, { on: true, color: '#112233', colorIntensity: 10, glowIntensity: 20, coverageIntensity: 30 });
  assert.equal(D.colorName('lips', '#8E5440'), 'Nude cacao'); assert.equal(D.colorName('lips', '#123456'), 'Couleur personnalisée'); assert.equal(D.colorName('inconnu', '#123456'), 'Couleur personnalisée');
});
