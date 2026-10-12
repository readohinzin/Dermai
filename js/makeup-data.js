/* Studio Beauté : données de l'interface (palettes, textures, looks) et conversion en sélection pour le serveur. Module partagé navigateur / Node : fonctions pures.
   Rien ici n'appelle le réseau. Les valeurs acceptées (textures, plages 0 à 100, couleurs #RRGGBB) sont celles du schéma officiel AI Makeup Virtual Try-On V1.0 telles que
   reprises dans server/makeup.js (un test vérifie que chaque couleur, texture et look de ce fichier est accepté par le serveur).

   Palettes : pensées pour TOUTES les carnations, avec une attention particulière aux peaux foncées. Les teintes de fond de teint vont de la porcelaine à l'ébène avec plusieurs
   nuances profondes ; les nudes, corails, rouges, prunes et bordeaux sont des couleurs qui existent en vraies gammes ; les nuances les plus riches ne sont PAS réservées aux
   looks de soirée : le look « Naturel » a une version profonde (nude cacao, blush terracotta). Les noms de couleurs sont des repères de lecture, pas des références de produits. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiMakeupData = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const c = (id, label, color) => ({ id, label, color });

  const FOUNDATION = [
    c('porcelain', 'Porcelaine', '#F6DFCF'), c('ivory', 'Ivoire', '#F0CDB3'), c('light-beige', 'Beige clair', '#E7BC9B'), c('sand', 'Sable', '#DDAD86'),
    c('honey', 'Miel', '#CF9A6F'), c('golden', 'Doré', '#C38A5E'), c('caramel', 'Caramel', '#B67A4F'), c('hazelnut', 'Noisette', '#A56B43'),
    c('cinnamon', 'Cannelle', '#94593A'), c('chestnut', 'Châtaigne', '#824C32'), c('mahogany', 'Acajou', '#7A3B2C'), c('cocoa', 'Cacao', '#6F3F2B'),
    c('chocolate', 'Chocolat', '#5E3425'), c('espresso', 'Expresso', '#4A2C26'), c('ebony', 'Ébène', '#3E221A')
  ];
  const LIPS = [
    c('nude-rose', 'Nude rosé', '#C98B85'), c('nude-peach', 'Nude pêche', '#D49A80'), c('nude-caramel', 'Nude caramel', '#B87A5B'), c('nude-mauve', 'Nude mauve', '#A9707A'),
    c('nude-cocoa', 'Nude cacao', '#8E5440'), c('nude-chocolate', 'Nude chocolat', '#6B3A2E'), c('rose-powder', 'Rose poudré', '#D9798F'), c('rose-vivid', 'Rose vif', '#D63A7A'),
    c('coral', 'Corail', '#E8604C'), c('burnt-orange', 'Orange brûlé', '#D2562B'), c('red-classic', 'Rouge classique', '#C21E3A'), c('red-cherry', 'Rouge cerise', '#A8132F'),
    c('red-deep', 'Rouge profond', '#8B1A2B'), c('berry', 'Baie', '#8E2554'), c('plum', 'Prune', '#6E2150'), c('burgundy', 'Bordeaux', '#5E1424'), c('aubergine', 'Aubergine', '#4A1F3D')
  ];
  const BLUSH = [
    c('peach', 'Pêche', '#F2A58E'), c('apricot', 'Abricot', '#E88C6B'), c('rose-soft', 'Rose tendre', '#E58FA0'), c('rose-deep', 'Rose soutenu', '#D4617F'),
    c('coral', 'Corail', '#E66F5C'), c('terracotta', 'Terracotta', '#C0634A'), c('brick', 'Brique', '#A5483A'), c('raspberry', 'Framboise', '#B83A60'),
    c('plum-soft', 'Prune douce', '#8A3A5A'), c('bronze-gold', 'Bronze doré', '#B9743A')
  ];
  const EYES = [
    c('champagne', 'Champagne', '#E4C9A0'), c('gold', 'Or', '#C99A3C'), c('bronze', 'Bronze', '#A06A2E'), c('copper', 'Cuivre', '#B5683A'), c('rose-gold', 'Rose doré', '#D9A08C'),
    c('taupe', 'Taupe', '#8A6E5E'), c('warm-brown', 'Brun chaud', '#6B4A33'), c('chocolate', 'Chocolat', '#4B3025'), c('mauve', 'Mauve', '#8F6A8C'), c('plum', 'Prune', '#6B3A5E'),
    c('burgundy', 'Bordeaux', '#6E2A3A'), c('olive', 'Olive', '#6B6B35'), c('forest', 'Vert forêt', '#2F5A44'), c('midnight', 'Bleu nuit', '#243A6B'), c('petrol', 'Bleu pétrole', '#1F5C70')
  ];

  /* Textures documentées par le schéma officiel, avec leur libellé. */
  const TEXTURES = {
    lips: [['matte', 'Mat'], ['satin', 'Satiné'], ['gloss', 'Brillant'], ['sheer', 'Translucide'], ['shimmer', 'Scintillant'], ['metallic', 'Métallique'], ['holographic', 'Holographique']],
    blush: [['matte', 'Mat'], ['satin', 'Satiné'], ['shimmer', 'Scintillant']],
    eyes: [['matte', 'Mat'], ['shimmer', 'Scintillant'], ['metallic', 'Métallique']]
  };
  const PALETTES = { foundation: FOUNDATION, lips: LIPS, blush: BLUSH, eyes: EYES };
  const CATEGORIES = [['foundation', 'Teint'], ['lips', 'Lèvres'], ['blush', 'Blush'], ['eyes', 'Yeux']];
  const TONES = [['light', 'Claire'], ['medium', 'Médium'], ['deep', 'Foncée']];

  /* Sélection par défaut quand une catégorie est activée pour la première fois. */
  const DEFAULTS = {
    foundation: { on: false, color: '#C38A5E', colorIntensity: 40, glowIntensity: 30, coverageIntensity: 40 },
    lips: { on: false, color: '#B87A5B', texture: 'matte', colorIntensity: 60 },
    blush: { on: false, color: '#E88C6B', texture: 'matte', colorIntensity: 40 },
    eyes: { on: false, color: '#6B4A33', texture: 'matte', colorIntensity: 40 }
  };
  const fresh = () => JSON.parse(JSON.stringify(DEFAULTS));

  /* Looks : construits avec des paramètres réellement pris en charge (couleur, texture, intensité). Chaque look a trois versions selon la carnation choisie ; aucun look
     ne touche au teint (pas de fond de teint imposé : la nuance de peau ne se devine pas). Lèvres, joues, yeux : [couleur, texture, intensité]. */
  const L = (lips, blush, eyes) => ({ lips: { on: true, color: lips[0], texture: lips[1], colorIntensity: lips[2] }, blush: { on: true, color: blush[0], texture: blush[1], colorIntensity: blush[2] }, eyes: { on: true, color: eyes[0], texture: eyes[1], colorIntensity: eyes[2] } });
  const LOOKS = [
    { id: 'natural', label: 'Naturel', about: 'Lèvres nude, joues douces, regard discret.', tones: {
      light: L(['#C98B85', 'satin', 45], ['#F2A58E', 'matte', 35], ['#8A6E5E', 'matte', 35]),
      medium: L(['#B87A5B', 'satin', 55], ['#E88C6B', 'matte', 40], ['#6B4A33', 'matte', 40]),
      deep: L(['#8E5440', 'satin', 65], ['#C0634A', 'matte', 45], ['#4B3025', 'matte', 45]) } },
    { id: 'elegant', label: 'Élégant', about: 'Lèvres affirmées et mates, éclat discret sur les paupières.', tones: {
      light: L(['#A9707A', 'matte', 65], ['#E58FA0', 'satin', 40], ['#8A6E5E', 'shimmer', 40]),
      medium: L(['#C21E3A', 'matte', 70], ['#D4617F', 'satin', 40], ['#8A6E5E', 'shimmer', 40]),
      deep: L(['#8B1A2B', 'matte', 75], ['#B83A60', 'satin', 45], ['#6B4A33', 'shimmer', 45]) } },
    { id: 'glamour', label: 'Glamour', about: 'Lèvres brillantes, joues lumineuses, paupières métalliques.', tones: {
      light: L(['#D63A7A', 'gloss', 70], ['#E58FA0', 'shimmer', 45], ['#C99A3C', 'metallic', 55]),
      medium: L(['#E8604C', 'gloss', 70], ['#E66F5C', 'shimmer', 50], ['#A06A2E', 'metallic', 60]),
      deep: L(['#D2562B', 'gloss', 75], ['#B9743A', 'shimmer', 55], ['#C99A3C', 'metallic', 65]) } },
    { id: 'evening', label: 'Soirée', about: 'Couleurs profondes et regard intense.', tones: {
      light: L(['#6E2150', 'matte', 80], ['#8A3A5A', 'satin', 40], ['#4B3025', 'shimmer', 70]),
      medium: L(['#5E1424', 'satin', 80], ['#A5483A', 'satin', 45], ['#243A6B', 'metallic', 65]),
      deep: L(['#6E2150', 'satin', 85], ['#8A3A5A', 'shimmer', 50], ['#1F5C70', 'metallic', 65]) } }
  ];

  const clone = o => JSON.parse(JSON.stringify(o));
  /* Sélection complète pour un look et une carnation (le teint reste tel quel et éteint par défaut). */
  function applyLook(sel, lookId, tone) {
    const look = LOOKS.find(l => l.id === lookId), t = TONES.some(x => x[0] === tone) ? tone : 'medium';
    if (!look) return sel;
    const next = Object.assign({}, clone(sel), clone(look.tones[t]));
    return next;
  }

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const int100 = v => Number.isInteger(v) && v >= 0 && v <= 100;
  /* Sélection de l'interface → sélection envoyée au serveur : seulement les catégories activées, seulement couleur, texture et intensités. */
  function toConfig(sel) {
    const cfg = { v: 1 };
    if (sel && sel.foundation && sel.foundation.on) { const f = sel.foundation; cfg.foundation = { color: String(f.color).toLowerCase(), colorIntensity: f.colorIntensity, glowIntensity: f.glowIntensity, coverageIntensity: f.coverageIntensity }; }
    for (const k of ['lips', 'blush', 'eyes']) if (sel && sel[k] && sel[k].on) cfg[k] = { color: String(sel[k].color).toLowerCase(), texture: sel[k].texture, colorIntensity: sel[k].colorIntensity };
    return cfg;
  }
  const hasMakeup = sel => ['foundation', 'lips', 'blush', 'eyes'].some(k => sel && sel[k] && sel[k].on);

  /* Sélection relue depuis le stockage (favoris) ou construite à la main : tout ce qui est invalide retombe sur la valeur par défaut, jamais d'erreur. */
  function sanitizeSelection(raw) {
    const out = fresh();
    if (!raw || typeof raw !== 'object') return out;
    for (const k of ['foundation', 'lips', 'blush', 'eyes']) {
      const r = raw[k]; if (!r || typeof r !== 'object') continue;
      const d = out[k];
      d.on = r.on === true;
      if (typeof r.color === 'string' && HEX.test(r.color)) d.color = r.color.toLowerCase();
      if (k !== 'foundation' && TEXTURES[k].some(t => t[0] === r.texture)) d.texture = r.texture;
      for (const f of (k === 'foundation' ? ['colorIntensity', 'glowIntensity', 'coverageIntensity'] : ['colorIntensity'])) if (int100(r[f])) d[f] = r[f];
    }
    return out;
  }

  /* Nom lisible d'une couleur de palette (repère, pas une référence de produit) ; « Couleur personnalisée » sinon. */
  function colorName(cat, color) {
    const hit = (PALETTES[cat] || []).find(p => p.color.toLowerCase() === String(color).toLowerCase());
    return hit ? hit.label : 'Couleur personnalisée';
  }

  return { FOUNDATION, LIPS, BLUSH, EYES, PALETTES, TEXTURES, CATEGORIES, TONES, DEFAULTS, LOOKS, fresh, applyLook, toConfig, hasMakeup, sanitizeSelection, colorName };
});
