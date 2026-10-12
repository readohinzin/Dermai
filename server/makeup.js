'use strict';
/* Studio Beauté (AI Makeup Virtual Try-On V1.0, Perfect Corp) : logique PURE, sans réseau.
   - parseConfig / normalizeConfig : validation STRICTE de la sélection envoyée par le navigateur. Le navigateur n'envoie jamais un corps Perfect Corp : il envoie
     { v: 1, foundation?, lips?, blush?, eyes? } avec seulement couleur, texture et intensités. Clé inconnue, valeur hors plage, couleur mal formée : refus.
   - buildEffects : construit le tableau `effects` du contrat officiel à partir de cette sélection validée.
   - jpegSize / checkImage : contrôle des octets de la photo (JPEG réel, taille, dimensions).
   - extractResultUrl : lecture STRICTE de l'image résultat, deux formes seulement (voir plus bas).

   SOURCE DU SCHÉMA : outil « AI-Makeup-Virtual-Try-On » du dépôt officiel YouCam-API/beauty-skin-care-MCP (lhm.plugin.json), seule source consultable : la
   documentation en ligne (docs.perfectcorp.com) n'était pas joignable depuis l'environnement de développement. Établi par cette source :
     corps : { src_file_id | src_file_url, version: "1.0", effects: [...] } ; catégories ci-dessous ; champs en camelCase ; entiers de 0 à 100 ; couleurs « #RRGGBB » ;
     textures : lèvres matte|gloss|holographic|metallic|satin|sheer|shimmer ; blush matte|satin|shimmer ; yeux matte|shimmer|metallic ;
     champs obligatoires selon la texture (voir les descriptions officielles reprises dans COMPANIONS) ; skin_smooth : skinSmoothStrength et skinSmoothColorIntensity, entiers de 0 à 100.
   NON établi par cette source (signalé dans le README) : la liste complète des noms de motifs (blush.json, eyeshadow.json, lipshape.json). Seuls les exemples écrits dans le schéma
   sont utilisés : « 1color1 » (blush, ombre à paupières) et « original » (forme des lèvres). Que skinSmoothStrength = 0 supprime TOUT lissage n'est pas confirmé par un essai réel. */
const { AnalysisError } = require('./errors');
const { IMAGE } = require('./config');

const HEX = /^#[0-9a-fA-F]{6}$/;
const TEXTURES = {
  lips: ['matte', 'gloss', 'holographic', 'metallic', 'satin', 'sheer', 'shimmer'],
  blush: ['matte', 'satin', 'shimmer'],
  eyes: ['matte', 'shimmer', 'metallic']
};
const CATEGORIES = ['foundation', 'lips', 'blush', 'eyes'];
const PATTERNS = { lips: 'original', blush: '1color1', eyes: '1color1' };      // exemples écrits dans le schéma officiel, seuls utilisés
const VERSION = '1.0';
const MAX_CONFIG_CHARS = 2000;
/* Retouche cutanée : explicite et NON modifiable par le navigateur. Le fournisseur peut lisser la peau par défaut quand aucun effet skin_smooth n'est fourni ;
   on envoie donc l'effet avec les valeurs minimales documentées (0). */
const SKIN_SMOOTH = { category: 'skin_smooth', skinSmoothStrength: 0, skinSmoothColorIntensity: 0 };

/* Champs propres à une texture, exigés par les descriptions officielles. Les VALEURS sont des choix de conception DERMAI (entiers dans la plage documentée),
   pas des valeurs imposées par le fournisseur ; la couleur des paillettes est une version éclaircie de la couleur choisie. */
const COMPANIONS = {
  lips: {
    matte: [], satin: [],
    gloss: ['gloss', 'transparencyIntensity'], sheer: ['gloss', 'transparencyIntensity'],
    shimmer: ['gloss', 'shimmerColor', 'shimmerIntensity', 'shimmerDensity', 'shimmerSize', 'transparencyIntensity'],
    metallic: ['gloss', 'shimmerColor', 'shimmerIntensity', 'shimmerDensity', 'shimmerSize'],
    holographic: ['gloss', 'shimmerColor', 'shimmerIntensity', 'shimmerDensity', 'shimmerSize']
  },
  blush: { matte: [], satin: ['glowStrength'], shimmer: ['glowStrength', 'shimmerColor', 'shimmerDensity'] },
  eyes: { matte: [], shimmer: ['shimmerColor', 'shimmerIntensity'], metallic: ['shimmerColor', 'shimmerIntensity', 'metallicIntensity'] }
};
const DEFAULTS = {
  lips: { gloss: { gloss: 70, transparencyIntensity: 40 }, sheer: { gloss: 30, transparencyIntensity: 60 },
    shimmer: { gloss: 40, shimmerIntensity: 50, shimmerDensity: 40, shimmerSize: 30, transparencyIntensity: 30 },
    metallic: { gloss: 40, shimmerIntensity: 70, shimmerDensity: 60, shimmerSize: 40 }, holographic: { gloss: 50, shimmerIntensity: 70, shimmerDensity: 60, shimmerSize: 40 } },
  blush: { satin: { glowStrength: 40 }, shimmer: { glowStrength: 40, shimmerDensity: 40 } },
  eyes: { shimmer: { shimmerIntensity: 50 }, metallic: { shimmerIntensity: 60, metallicIntensity: 60 } }
};

const isInt100 = v => Number.isInteger(v) && v >= 0 && v <= 100;
const fail = detail => new AnalysisError('MK_INVALID_REQUEST', { status: 400, detail });
const lower = c => c.toLowerCase();
/* Mélange avec du blanc (ratio 0 à 1) : couleur des paillettes. */
function lighten(hex, ratio = 0.5) {
  const n = parseInt(hex.slice(1), 16), mix = c => Math.max(0, Math.min(255, Math.round(c + (255 - c) * ratio)));
  const h = v => v.toString(16).padStart(2, '0');
  return '#' + h(mix((n >> 16) & 255)) + h(mix((n >> 8) & 255)) + h(mix(n & 255));
}

function onlyKeys(obj, allowed, where) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw fail(`${where} : clé inconnue « ${String(k).slice(0, 30)} »`);
}
function plain(v, where) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(`${where} : objet attendu`);
  return v;
}
function colorOf(v, where) {
  if (typeof v !== 'string' || !HEX.test(v)) throw fail(`${where} : couleur #RRGGBB attendue`);
  return lower(v);
}
function intOf(v, where) {
  if (!isInt100(v)) throw fail(`${where} : entier de 0 à 100 attendu`);
  return v;
}

/* Sélection validée et normalisée (couleurs en minuscules). Lève MK_INVALID_REQUEST. Au moins une catégorie de maquillage est exigée. */
function normalizeConfig(raw) {
  const c = plain(raw, 'sélection');
  onlyKeys(c, ['v', ...CATEGORIES], 'sélection');
  if (c.v !== 1) throw fail('sélection : version 1 attendue');
  const out = { v: 1 };
  if (c.foundation !== undefined) {
    const f = plain(c.foundation, 'teint'); onlyKeys(f, ['color', 'colorIntensity', 'glowIntensity', 'coverageIntensity'], 'teint');
    out.foundation = { color: colorOf(f.color, 'teint.color'), colorIntensity: intOf(f.colorIntensity, 'teint.colorIntensity'), glowIntensity: intOf(f.glowIntensity, 'teint.glowIntensity'), coverageIntensity: intOf(f.coverageIntensity, 'teint.coverageIntensity') };
  }
  for (const cat of ['lips', 'blush', 'eyes']) {
    if (c[cat] === undefined) continue;
    const e = plain(c[cat], cat); onlyKeys(e, ['color', 'texture', 'colorIntensity'], cat);
    if (!TEXTURES[cat].includes(e.texture)) throw fail(`${cat}.texture : texture non prise en charge`);
    out[cat] = { color: colorOf(e.color, `${cat}.color`), texture: e.texture, colorIntensity: intOf(e.colorIntensity, `${cat}.colorIntensity`) };
  }
  if (!CATEGORIES.some(k => out[k])) throw fail('sélection : aucun maquillage choisi');
  return out;
}

/* Texte JSON du paramètre `cfg` de la requête → sélection validée. */
function parseConfig(text) {
  if (typeof text !== 'string' || !text || text.length > MAX_CONFIG_CHARS) throw fail('sélection absente ou trop longue');
  let json;
  try { json = JSON.parse(text); } catch (e) { throw fail('sélection : JSON illisible'); }
  return normalizeConfig(json);
}

/* Palette d'un effet à texture : couleur, texture, intensité + champs propres à la texture (valeurs DERMAI, paillettes = couleur éclaircie). */
function palette(cat, e) {
  const p = { color: e.color, texture: e.texture, colorIntensity: e.colorIntensity };
  const defaults = (DEFAULTS[cat] || {})[e.texture] || {};
  for (const key of COMPANIONS[cat][e.texture]) p[key] = key === 'shimmerColor' ? lighten(e.color) : defaults[key];
  return p;
}

/* Tableau `effects` du contrat : toujours skin_smooth (valeurs minimales) en premier, puis les catégories choisies. Un seul tableau, une seule tâche. */
function buildEffects(cfg) {
  const c = normalizeConfig(cfg), effects = [Object.assign({}, SKIN_SMOOTH)];
  if (c.foundation) effects.push({ category: 'foundation', palettes: [{ color: c.foundation.color, colorIntensity: c.foundation.colorIntensity, glowIntensity: c.foundation.glowIntensity, coverageIntensity: c.foundation.coverageIntensity }] });
  if (c.eyes) effects.push({ category: 'eye_shadow', pattern: { name: PATTERNS.eyes }, palettes: [palette('eyes', c.eyes)] });
  if (c.blush) effects.push({ category: 'blush', pattern: { name: PATTERNS.blush }, palettes: [palette('blush', c.blush)] });
  if (c.lips) effects.push({ category: 'lip_color', shape: { name: PATTERNS.lips }, palettes: [palette('lips', c.lips)], style: { type: 'full' } });
  return effects;
}

/* Corps de création : image par file_id (jamais d'URL fournie par le navigateur), version et effets. */
const buildTaskBody = (fileId, effects) => ({ src_file_id: fileId, version: VERSION, effects });

/* ───── Photo ───── */
/* Dimensions d'un JPEG (marqueurs SOF) ; null si les octets ne permettent pas de les lire. */
function jpegSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xff) { i++; continue; }                                        // octets de remplissage
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xd9 || m === 0xda) return null;                                // fin de fichier ou début des données : aucun cadre trouvé
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > buf.length) return null;
      const height = buf.readUInt16BE(i + 5), width = buf.readUInt16BE(i + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}
/* Exigences annoncées pour V1.0 : JPG/JPEG/PNG, moins de 10 Mo, grand côté inférieur à 1 920 px, visage assez grand. Ici : JPEG réel (le navigateur convertit tout en JPEG), taille
   serveur ≤ IMAGE.maxBytes (4 Mo, limite d'une fonction Vercel), grand côté < 1 920 px (strict : valeur prudente), petit côté ≥ 256 px (choix DERMAI, pas une règle du fournisseur).
   La taille du visage est jugée dans le navigateur (js/photo-check.js) puis par le fournisseur. */
const LIMITS = { maxLongSide: 1920, minShortSide: 256 };
function checkImage(buffer) {
  const size = jpegSize(buffer);
  if (!size) throw new AnalysisError('MK_INVALID_IMAGE', { status: 400, detail: 'dimensions JPEG illisibles' });
  const long = Math.max(size.width, size.height), short = Math.min(size.width, size.height);
  if (long >= LIMITS.maxLongSide) throw new AnalysisError('MK_INVALID_IMAGE', { status: 400, detail: `grand côté ${long} px (limite : moins de ${LIMITS.maxLongSide})` });
  if (short < LIMITS.minShortSide) throw new AnalysisError('MK_INVALID_IMAGE', { status: 400, detail: `petit côté ${short} px (minimum DERMAI : ${LIMITS.minShortSide})` });
  if (buffer.length >= IMAGE.maxBytes + 1) throw new AnalysisError('TOO_LARGE', { status: 413 });
  return size;
}

/* ───── Résultat ───── */
const masks = require('./masks');
/* Deux formes seulement, les deux décrites par la documentation d'après son schéma et son exemple de réussite :
     A) data.results = { url: "https://…" }                                  (exemple de réponse de succès)
     B) data.results = [ { download_url: "https://…" }, … ]                  (schéma de réponse)
   Aucun parcours récursif, aucun autre nom de champ : sinon null (l'appelant refuse et journalise la STRUCTURE seulement). L'URL doit être https publique. */
function extractResultUrl(envelope) {
  const r = envelope && envelope.data && envelope.data.results;
  if (Array.isArray(r)) {
    for (const el of r) { const u = el && typeof el === 'object' && !Array.isArray(el) && masks.safeUrl(el.download_url); if (u) return u; }
    return null;
  }
  if (r && typeof r === 'object') return masks.safeUrl(r.url);
  return null;
}

module.exports = { TEXTURES, CATEGORIES, PATTERNS, VERSION, SKIN_SMOOTH, COMPANIONS, DEFAULTS, LIMITS, MAX_CONFIG_CHARS, lighten, normalizeConfig, parseConfig, buildEffects, buildTaskBody, jpegSize, checkImage, extractResultUrl };
