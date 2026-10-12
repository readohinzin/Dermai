'use strict';
/* Studio Beauté, volet CAPILLAIRE : logique PURE, sans réseau. Six fonctions Perfect Corp, chacune avec son contrat, SANS format commun forcé :
     hairstyle   AI Hair Style Virtual Try-On V2.1   modèle (template_id) OU photo de référence ; hair_color seulement avec un modèle        2 unités
     haircolor   AI Hair Color Virtual Try-On V1.0   preset OU (pattern + palettes) ; jamais les deux (le preset l'emporterait)               1 unité
     extensions  AI Hair Extension Virtual Try-On    modèle (template_id)                                                                      1 unité
     bangs       AI Bangs Filter Virtual Try-On      modèle (template_id)                                                                      1 unité
     wavy        AI Wavy Hair Virtual Try-On         modèle (template_id)                                                                      1 unité
     volume      AI Hair Volume Virtual Try-On       modèle (template_id)                                                                      2 unités
   Les unités sont celles ANNONCÉES par la documentation (jamais mesurées sur le compte DERMAI).

   SOURCES. Corps de requête de chaque fonction : outils « AI-… » du dépôt officiel YouCam-API/beauty-skin-care-mcp (lhm.plugin.json) : établis. Chemins REST :
   dépôt officiel YouCam-API/skills (api-fallback.yaml, instantané du 2026-09-01) : CONFIRMÉS pour hair-transfer (V2.1, création + liste des modèles) et hair-color ; le statut est
   « <chemin de création>/<task_id> » (youcam_tasks.py) ; l'image finale est lue dans data.results.url (SKILL.md). NON CONFIRMÉS : les chemins de création des quatre autres fonctions (aucune
   source consultée ne les donne ; docs.perfectcorp.com est refusé par le réseau de l'environnement) : le nom ci-dessous suit le nom de la page de documentation, il est signalé
   pathConfirmed:false, ne s'ouvre que par DERMAI_HAIR_ALLOW_UNCONFIRMED=1 (une erreur 404 du fournisseur ne coûte alors rien) et se corrige par DERMAI_HAIR_PATH_<IDENTIFIANT> sans toucher au code.
   Le chemin de la liste des modèles suit le motif confirmé « /task/template/<fonction> » (look-vto, bg-replace, hair-transfer). La FORME de la liste (data.templates[], id, miniature, titre,
   jeton de page suivante) n'est confirmée par aucune source : la lecture est prudente, tout ce qui n'a pas la forme attendue est ignoré, et si rien n'est reconnu la liste est refusée. */
const { AnalysisError } = require('./errors');
const masks = require('./masks');
const makeup = require('./makeup');

const PATH_RE = /^\/s2s\/v\d\.\d\/task\/[a-z0-9-]{3,40}$/;
const templatesOf = taskPath => taskPath.replace('/task/', '/task/template/');
const F = (o) => Object.assign({ pathConfirmed: true, hasTemplates: true }, o);
const FEATURES = {
  hairstyle: F({ id: 'hairstyle', label: 'Coiffures et perruques', api: 'AI Hair Style Virtual Try-On', version: '2.1', units: 2, taskPath: '/s2s/v2.1/task/hair-transfer', templatesPath: '/s2s/v2.1/task/template/hair-transfer', reference: true }),
  haircolor: F({ id: 'haircolor', label: 'Couleurs de cheveux', api: 'AI Hair Color Virtual Try-On', version: '1.0', units: 1, taskPath: '/s2s/v2.0/task/hair-color', hasTemplates: false }),
  extensions: F({ id: 'extensions', label: 'Extensions', api: 'AI Hair Extension Virtual Try-On', version: '1.0', units: 1, taskPath: '/s2s/v2.0/task/hair-extension', pathConfirmed: false }),
  bangs: F({ id: 'bangs', label: 'Franges', api: 'AI Bangs Filter Virtual Try-On', version: '1.0', units: 1, taskPath: '/s2s/v2.0/task/bangs', pathConfirmed: false }),
  wavy: F({ id: 'wavy', label: 'Boucles et ondulations', api: 'AI Wavy Hair Virtual Try-On', version: '1.0', units: 1, taskPath: '/s2s/v2.0/task/wavy-hair', pathConfirmed: false }),
  volume: F({ id: 'volume', label: 'Volume', api: 'AI Hair Volume Virtual Try-On', version: '1.0', units: 2, taskPath: '/s2s/v2.0/task/hair-volume', pathConfirmed: false })
};
const IDS = Object.keys(FEATURES);

/* Fonctions réellement ouvertes : confirmées (ou toutes avec le drapeau), filtrées par DERMAI_HAIR_FEATURES, avec les chemins corrigés par DERMAI_HAIR_PATH_<ID> s'ils sont valides. */
function activeFeatures(env = process.env) {
  const config = require('./config');
  const filter = config.hairFeatureFilter(env), unconfirmed = config.isHairUnconfirmedAllowed(env), out = [];
  for (const id of IDS) {
    const f = FEATURES[id];
    if (filter && !filter.has(id)) continue;
    const override = env['DERMAI_HAIR_PATH_' + id.toUpperCase()];
    const overridden = typeof override === 'string' && PATH_RE.test(override.trim());
    if (!f.pathConfirmed && !unconfirmed && !overridden) continue;
    const taskPath = overridden ? override.trim() : f.taskPath;
    out.push(Object.assign({}, f, { taskPath, templatesPath: f.hasTemplates ? (overridden || !f.templatesPath ? templatesOf(taskPath) : f.templatesPath) : null, pathConfirmed: f.pathConfirmed || overridden }));
  }
  return out;
}
const findFeature = (id, env) => activeFeatures(env).find(f => f.id === id) || null;

const fail = detail => new AnalysisError('HR_INVALID_REQUEST', { status: 400, detail });
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEMPLATE_ID = /^[A-Za-z0-9_.:+=-]{1,120}$/;
const PRESETS_FULL = ['Jet Black', 'Chocolate Brown', 'Honey Blonde', 'Platinum Blonde', 'Ash Gray', 'Rose Gold', 'Burgundy', 'Copper Red', 'Lavender', 'Teal Blue'];
const PRESETS_OMBRE = ['Dark Brown/Caramel Blonde', 'Jet Black/Silver Gray', 'Ash Brown/Lavender', 'Rose Gold/Peach Blonde', 'Burgundy/Magenta Pink', 'Deep Blue/Teal Green', 'Plum Purple/Pastel Lilac', 'Copper Red/Golden Blonde', 'Dark Gray/Ice Blonde', 'Midnight Blue/Denim Blue'];
const MAX_CONFIG_CHARS = 1500;
const LIMITS = { maxLongSide: 1024, minShortSide: 256 };   // exigences documentées pour les extensions (≤ 1 024 px), appliquées par prudence à toutes les fonctions capillaires

const onlyKeys = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) throw fail(`${where} : clé inconnue « ${String(k).slice(0, 30)} »`); };
const plain = (v, where) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw fail(`${where} : objet attendu`); return v; };
const int100 = (v, where) => { if (!Number.isInteger(v) || v < 0 || v > 100) throw fail(`${where} : entier de 0 à 100 attendu`); return v; };
const hex = (v, where) => { if (typeof v !== 'string' || !HEX.test(v)) throw fail(`${where} : couleur #RRGGBB attendue`); return v.toLowerCase(); };
const tplId = (v, where) => { if (typeof v !== 'string' || !TEMPLATE_ID.test(v)) throw fail(`${where} : identifiant de modèle invalide`); return v; };

/* Sélection validée. cfg : { v:1, ... } selon la fonction. Lève HR_INVALID_REQUEST. */
function normalizeConfig(featureId, raw) {
  const f = FEATURES[featureId]; if (!f) throw fail('fonction inconnue');
  const c = plain(raw, 'sélection');
  if (c.v !== 1) throw fail('sélection : version 1 attendue');
  if (featureId === 'haircolor') {
    onlyKeys(c, ['v', 'preset', 'pattern', 'palettes'], 'couleur');
    const hasPreset = c.preset !== undefined, hasCustom = c.pattern !== undefined || c.palettes !== undefined;
    if (hasPreset && hasCustom) throw fail('couleur : un preset OU une couleur personnalisée, jamais les deux');
    if (hasPreset) {
      if (![...PRESETS_FULL, ...PRESETS_OMBRE].includes(c.preset)) throw fail('couleur : preset inconnu');
      return { v: 1, preset: c.preset };
    }
    const pat = plain(c.pattern, 'couleur.pattern');
    if (!Array.isArray(c.palettes)) throw fail('couleur.palettes : liste attendue');
    const pal = (p, i) => {
      const o = plain(p, `couleur.palettes[${i}]`); onlyKeys(o, ['color', 'color_intensity', 'shine_intensity'], `couleur.palettes[${i}]`);
      const r = { color: hex(o.color, `couleur.palettes[${i}].color`) };
      if (o.color_intensity !== undefined) r.color_intensity = int100(o.color_intensity, 'color_intensity');
      if (o.shine_intensity !== undefined) r.shine_intensity = int100(o.shine_intensity, 'shine_intensity');
      return r;
    };
    if (pat.name === 'full') {
      onlyKeys(pat, ['name'], 'couleur.pattern');
      if (c.palettes.length !== 1) throw fail('couleur : une palette exactement pour « full »');
      return { v: 1, pattern: { name: 'full' }, palettes: [pal(c.palettes[0], 0)] };
    }
    if (pat.name === 'ombre') {
      onlyKeys(pat, ['name', 'blend_strength', 'line_offset', 'coloring_section'], 'couleur.pattern');
      if (c.palettes.length !== 2) throw fail('couleur : deux palettes exactement pour « ombre »');
      if (typeof pat.line_offset !== 'number' || !Number.isFinite(pat.line_offset) || pat.line_offset < -0.99 || pat.line_offset > 0.99) throw fail('couleur.line_offset : nombre de -0,99 à 0,99');
      if (pat.coloring_section !== 'top') throw fail('couleur.coloring_section : « top » attendu');
      return { v: 1, pattern: { name: 'ombre', blend_strength: int100(pat.blend_strength, 'blend_strength'), line_offset: pat.line_offset, coloring_section: 'top' }, palettes: [pal(c.palettes[0], 0), pal(c.palettes[1], 1)] };
    }
    throw fail('couleur.pattern.name : « full » ou « ombre »');
  }
  if (featureId === 'hairstyle') {
    onlyKeys(c, ['v', 'template', 'reference'], 'coiffure');
    if ((c.template === undefined) === (c.reference === undefined)) throw fail('coiffure : un modèle OU une photo de référence, jamais les deux ni aucun');
    if (c.reference !== undefined) { if (c.reference !== true) throw fail('coiffure.reference : true attendu'); return { v: 1, reference: true }; }
    const t = plain(c.template, 'coiffure.template'); onlyKeys(t, ['id', 'hair_color'], 'coiffure.template');
    const out = { id: tplId(t.id, 'coiffure.template.id') };
    if (t.hair_color !== undefined) { if (t.hair_color !== 'ref' && t.hair_color !== 'src') throw fail('coiffure.template.hair_color : « ref » ou « src »'); out.hair_color = t.hair_color; }
    return { v: 1, template: out };
  }
  onlyKeys(c, ['v', 'template'], f.label);
  const t = plain(c.template, `${f.id}.template`); onlyKeys(t, ['id'], `${f.id}.template`);
  return { v: 1, template: { id: tplId(t.id, `${f.id}.template.id`) } };
}
function parseConfig(featureId, text) {
  if (typeof text !== 'string' || !text || text.length > MAX_CONFIG_CHARS) throw fail('sélection absente ou trop longue');
  let json; try { json = JSON.parse(text); } catch (e) { throw fail('sélection : JSON illisible'); }
  return normalizeConfig(featureId, json);
}

/* Corps de création du fournisseur : photos par file_id (jamais d'URL fournie par le navigateur). `ids` : { src, ref? }. */
function buildTaskBody(featureId, cfg, ids) {
  const c = normalizeConfig(featureId, cfg), body = { src_file_id: ids.src };
  if (featureId === 'haircolor') { if (c.preset) body.preset = c.preset; else { body.pattern = c.pattern; body.palettes = c.palettes; } return body; }
  if (featureId === 'hairstyle' && c.reference) { if (!ids.ref) throw fail('coiffure : photo de référence absente'); body.ref_file_id = ids.ref; return body; }
  body.template_id = c.template.id;
  if (c.template.hair_color) body.hair_color = c.template.hair_color;
  return body;
}

/* Photo (octets JPEG déjà reconnus par validateImage) : dimensions exigées pour les fonctions capillaires. */
function checkImage(buffer) {
  const size = makeup.jpegSize(buffer);
  if (!size) throw new AnalysisError('HR_INVALID_IMAGE', { status: 400, detail: 'dimensions JPEG illisibles' });
  const long = Math.max(size.width, size.height), short = Math.min(size.width, size.height);
  if (long > LIMITS.maxLongSide) throw new AnalysisError('HR_INVALID_IMAGE', { status: 400, detail: `grand côté ${long} px (limite : ${LIMITS.maxLongSide})` });
  if (short < LIMITS.minShortSide) throw new AnalysisError('HR_INVALID_IMAGE', { status: 400, detail: `petit côté ${short} px (minimum DERMAI : ${LIMITS.minShortSide})` });
  return size;
}

/* Liste des modèles : lecture PRUDENTE (forme non confirmée). Seules les entrées avec un identifiant sûr sont gardées ; miniature seulement si https public. */
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n) : '');
function parseTemplates(envelope) {
  const list = envelope && envelope.data && envelope.data.templates;
  if (!Array.isArray(list)) return null;
  const templates = [];
  for (const t of list.slice(0, 200)) {
    if (!t || typeof t !== 'object' || Array.isArray(t) || typeof t.id !== 'string' || !TEMPLATE_ID.test(t.id)) continue;
    const thumb = masks.safeUrl(t.thumb) || masks.safeUrl(t.thumbnail) || masks.safeUrl(t.thumb_url) || null;
    const category = clip(t.category_name, 40) || clip(t.category, 40) || '';
    templates.push({ id: t.id, title: clip(t.title, 60) || clip(t.name, 60) || '', category, thumb });
  }
  const next = envelope.data.next_token;
  return { templates, next: typeof next === 'string' && /^[A-Za-z0-9_.:+=/-]{1,300}$/.test(next) ? next : null };
}

/* Image finale : data.results.url (forme confirmée par le dépôt officiel de skills) ; la forme « liste d'objets download_url » est aussi lue (même lecteur que le maquillage). */
const extractResultUrl = makeup.extractResultUrl;

module.exports = { FEATURES, IDS, LIMITS, PRESETS_FULL, PRESETS_OMBRE, PATH_RE, TEMPLATE_ID, MAX_CONFIG_CHARS, activeFeatures, findFeature, normalizeConfig, parseConfig, buildTaskBody, checkImage, parseTemplates, extractResultUrl, templatesOf };
