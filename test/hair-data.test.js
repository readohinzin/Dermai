'use strict';
/* Studio Beauté, volet capillaire : données de l'interface (js/hair-data.js). Chaque valeur proposée doit être acceptée par la validation du serveur (server/hair.js) :
   l'interface ne peut pas proposer ce que le serveur refuse, ni mélanger un preset et une couleur libre. */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/hair-data.js');
const H = require('../server/hair.js');

test('HD1 onglets : cinq après le maquillage, « Boucles et volume » regroupe deux fonctions ; chaque fonction connue du serveur, unités identiques à celles du serveur', () => {
  assert.deepEqual(D.TABS.map(t => t.label), ['Coiffures et perruques', 'Couleurs de cheveux', 'Extensions', 'Franges', 'Boucles et volume']);
  assert.deepEqual(D.TABS.flatMap(t => t.features).sort(), [...H.IDS].sort(), 'chaque fonction du serveur a son écran, et inversement');
  assert.deepEqual(D.TABS.find(t => t.id === 'curls').features, ['wavy', 'volume']);
  for (const id of D.FEATURE_IDS) { assert.equal(D.FEATURES[id].units, H.FEATURES[id].units, id + ' : unités'); for (const k of ['label', 'kind', 'about', 'limit']) assert.ok(D.FEATURES[id][k] && D.FEATURES[id][k].length > (k === 'about' || k === 'limit' ? 10 : 3), id + ' ' + k); }
});

test('HD2 nature de la transformation : jamais confondue (extension ≠ perruque, volume ≠ diagnostic, perruque ≠ modèle commercial précis, couleur ≠ promesse)', () => {
  assert.match(D.FEATURES.extensions.limit, /ne remplacent pas votre coiffure/); assert.match(D.FEATURES.extensions.limit, /pas l'essai d'une perruque complète/);
  assert.match(D.FEATURES.hairstyle.limit, /STYLE de coiffure/); assert.match(D.FEATURES.hairstyle.limit, /pas l'essai d'un modèle précis de perruque/);
  assert.match(D.FEATURES.volume.limit, /ni un diagnostic de chute de cheveux ni une solution médicale/);
  assert.match(D.FEATURES.wavy.limit, /ne couvre pas forcément toutes les textures ni tous les styles afro/);
  assert.match(D.FEATURES.haircolor.limit, /décoloration/);
  for (const id of D.FEATURE_IDS) assert.ok(!/garanti|100 ?%|identique à la réalité|diagnostic (de|du) cuir/i.test(D.FEATURES[id].about + D.FEATURES[id].limit), id);
});

test('HD3 presets : exactement les 20 du fournisseur (noms exacts), libellés français, couleurs d\'affichage ; tous acceptés par le serveur', () => {
  assert.deepEqual(D.PRESETS_FULL.map(p => p[0]), H.PRESETS_FULL); assert.deepEqual(D.PRESETS_OMBRE.map(p => p[0]), H.PRESETS_OMBRE);
  for (const p of [...D.PRESETS_FULL, ...D.PRESETS_OMBRE]) {
    assert.ok(p[1] && p[1] !== p[0], 'libellé français : ' + p[0]);
    const cfg = D.toConfig('haircolor', Object.assign(D.fresh('haircolor'), { mode: 'preset', preset: p[0] }));
    assert.deepEqual(cfg, { v: 1, preset: p[0] }); assert.doesNotThrow(() => H.normalizeConfig('haircolor', cfg));
  }
  for (const p of D.PRESETS_FULL) assert.match(p[2], /^#[0-9a-f]{6}$/);
  for (const p of D.PRESETS_OMBRE) assert.equal(p[2].length, 2);
  assert.ok(D.PRESETS_FULL.some(p => /Noir naturel/.test(p[1])) && D.PRESETS_FULL.some(p => /Brun chocolat/.test(p[1])) && D.PRESETS_FULL.some(p => /Bordeaux/.test(p[1])) && D.PRESETS_FULL.some(p => /cuivré/.test(p[1])) && D.PRESETS_FULL.some(p => /Blond miel/.test(p[1])) && D.PRESETS_FULL.some(p => /Gris/.test(p[1])), 'palette demandée : naturels, bordeaux, cuivre, miel, gris et blond');
  assert.equal(D.presetLabel('Jet Black'), 'Noir naturel'); assert.equal(D.presetLabel('x'), '');
});

test('HD4 teintes personnalisées : couleurs #RRGGBB uniques, noms uniques, brun acajou et couleurs fantaisie présents, tous acceptés par le serveur', () => {
  assert.equal(new Set(D.CUSTOM.map(c => c[1])).size, D.CUSTOM.length); assert.equal(new Set(D.CUSTOM.map(c => c[0])).size, D.CUSTOM.length);
  for (const [n, c] of D.CUSTOM) { assert.match(c, /^#[0-9a-f]{6}$/, n); assert.doesNotThrow(() => H.normalizeConfig('haircolor', D.toConfig('haircolor', Object.assign(D.fresh('haircolor'), { mode: 'full', color: c }))), n); }
  for (const l of ['Noir naturel', 'Brun chocolat', 'Brun acajou', 'Bordeaux', 'Cuivre', 'Caramel', 'Miel', 'Gris argenté', 'Violet', 'Bleu', 'Rose']) assert.ok(D.CUSTOM.some(c => c[0] === l), l);
});

test('HD5 conversion couleur : preset OU couleur libre, jamais les deux ; ombré complet ; sélection incomplète ou hors plage → null (aucun envoi)', () => {
  const base = D.fresh('haircolor');
  const full = D.toConfig('haircolor', Object.assign({}, base, { mode: 'full', color: '#3B2417', colorIntensity: 60, shineIntensity: 20 }));
  assert.deepEqual(full, { v: 1, pattern: { name: 'full' }, palettes: [{ color: '#3b2417', color_intensity: 60, shine_intensity: 20 }] }); assert.ok(!('preset' in full), 'pas de preset avec une couleur libre');
  const preset = D.toConfig('haircolor', Object.assign({}, base, { mode: 'preset', preset: 'Burgundy', color: '#ffffff' })); assert.deepEqual(preset, { v: 1, preset: 'Burgundy' }); assert.ok(!('pattern' in preset) && !('palettes' in preset), 'pas de couleur libre avec un preset');
  const ombre = D.toConfig('haircolor', Object.assign({}, base, { mode: 'ombre', color: '#2b1b12', color2: '#C99A3C', blend: 40, offset: -0.3 }));
  assert.deepEqual(ombre, { v: 1, pattern: { name: 'ombre', blend_strength: 40, line_offset: -0.3, coloring_section: 'top' }, palettes: [{ color: '#2b1b12' }, { color: '#c99a3c' }] });
  for (const c of [full, preset, ombre]) assert.doesNotThrow(() => H.normalizeConfig('haircolor', c));
  for (const bad of [{ mode: 'preset', preset: 'Neon' }, { mode: 'full', color: 'red' }, { mode: 'ombre', color2: 'x' }, { mode: 'inconnu' }, {}]) assert.equal(D.toConfig('haircolor', Object.assign({}, base, bad, bad.mode === undefined ? { mode: undefined } : {})), null, JSON.stringify(bad));
  assert.equal(D.toConfig('haircolor', null), null);
});

test('HD6 conversion des fonctions à modèles : seulement un identifiant venant de la liste ; coiffure par modèle (+ couleur des cheveux choisie) ou par référence ; incomplet → null', () => {
  assert.equal(D.toConfig('hairstyle', D.fresh('hairstyle')), null, 'aucun modèle choisi : aucun envoi');
  assert.deepEqual(D.toConfig('hairstyle', { mode: 'template', templateId: 'tpl_1', hairColor: 'src' }), { v: 1, template: { id: 'tpl_1', hair_color: 'src' } });
  assert.deepEqual(D.toConfig('hairstyle', { mode: 'template', templateId: 'tpl_1', hairColor: 'ref' }), { v: 1, template: { id: 'tpl_1', hair_color: 'ref' } });
  assert.deepEqual(D.toConfig('hairstyle', { mode: 'reference' }), { v: 1, reference: true });
  for (const id of ['extensions', 'bangs', 'wavy', 'volume']) { assert.equal(D.toConfig(id, D.fresh(id)), null); const c = D.toConfig(id, { templateId: 'tpl_9' }); assert.deepEqual(c, { v: 1, template: { id: 'tpl_9' } }); assert.doesNotThrow(() => H.normalizeConfig(id, c)); }
  for (const c of [D.toConfig('hairstyle', { mode: 'template', templateId: 'tpl_1', hairColor: 'src' }), { v: 1, reference: true }]) assert.doesNotThrow(() => H.normalizeConfig('hairstyle', c));
  assert.equal(D.toConfig('inconnue', { templateId: 'a' }), null);
});

test('HD7 lecture assainie (favoris) : valeurs invalides → défauts, jamais d\'erreur ni de valeur hors schéma', () => {
  for (const raw of [null, undefined, 'x', 12, [], {}]) for (const id of D.FEATURE_IDS) { const s = D.sanitizeSelection(id, raw); assert.deepEqual(s, D.fresh(id), id); }
  assert.deepEqual(D.sanitizeSelection('inconnue', { templateId: 'a' }), {});
  const c = D.sanitizeSelection('haircolor', { mode: 'ombre', preset: 'Neon', color: '#ABCDEF', color2: 'zzz', colorIntensity: 500, shineIntensity: 12, blend: 33, offset: 5, extra: 'x' });
  assert.deepEqual(c, Object.assign(D.fresh('haircolor'), { mode: 'ombre', color: '#abcdef', shineIntensity: 12, blend: 33 }));
  assert.equal(D.sanitizeSelection('hairstyle', { templateId: '<script>' }).templateId, ''); assert.equal(D.sanitizeSelection('hairstyle', { templateId: 'tpl_1', hairColor: 'bleu' }).hairColor, 'ref');
  assert.equal(D.sanitizeSelection('wavy', { templateId: 'tpl-1.a:b' }).templateId, 'tpl-1.a:b');
  assert.equal(D.unitsText(1), '1 unité'); assert.equal(D.unitsText(2), '2 unités');
});

test('HD8 aucun identifiant de modèle ni vignette inventés dans le code du navigateur : les modèles viennent de la liste du fournisseur', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = ['js/hair-data.js', 'js/hair-studio.js'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  assert.ok(!/template_id|good_template|tpl_\d|\.jpg['"`]|\.png['"`]|data:image/.test(src), 'aucun identifiant ni image écrits en dur');
});
