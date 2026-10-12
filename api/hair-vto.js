'use strict';
/* Studio Beauté, volet CAPILLAIRE (coiffure, couleur, extensions, franges, ondulations, volume). Fonction DISTINCTE de /api/skin-analysis, /api/skin-simulation et /api/makeup-vto :
   verrou, liste d'utilisateurs autorisés et quota (en unités) propres. N'appelle jamais les points d'entrée d'analyse, de simulation ni de maquillage de Perfect Corp.
   GET                         : { ok, available, features:[{id,label,units,version}] } pour le compte connecté. Aucun appel au fournisseur, aucun quota.
   GET ?templates=<id>[&next=] : liste des modèles du fournisseur pour une fonction (lecture seule, mise en cache courte). Aucune tâche, aucune unité annoncée.
   POST ?feature=<id>&cfg=<sélection>[&ref_at=<octet>] : photo JPEG brute (puis, pour une coiffure par photo de référence, la photo de référence juste après, à partir de l'octet ref_at).
          Ordre des garde-fous, chacun AVANT le suivant : méthode → session Supabase → verrou → utilisateur autorisé → fonction ouverte → sélection → temps restant → lecture et validation
          des photos (type, octets, dimensions) → clé configurée → quota (unités, réservation atomique, jamais remboursée) → Perfect Corp (UNE tâche) → URL https temporaire de l'image.
   Le navigateur ne fournit jamais d'URL d'image ni de corps pour le fournisseur ; il ne reçoit jamais task_id, enveloppe ni clé. */
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toHairMessage: toUserMessage } = require('../server/errors');
const auth = require('../server/auth');
const quota = require('../server/quota');
const perfectcorp = require('../server/perfectcorp');
const hair = require('../server/hair');
const provider = require('../server/perfectcorp-hair');
const { isHairEnabled, isHairAllowed, TIME_BUDGET } = require('../server/config');
const { createBudget } = require('../server/budget');

const config = { api: { bodyParser: false } };
const TEMPLATE_TTL_MS = 10 * 60 * 1000, TEMPLATE_CACHE_MAX = 60;
const templateCache = new Map();

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
/* Un paramètre de la requête, présent une seule fois (sinon null). */
function paramOf(req, name) {
  let list;
  try { list = new URL(req.url || '', 'http://x').searchParams.getAll(name); } catch (e) { list = []; }
  return list.length === 1 ? list[0] : null;
}
const present = (req, name) => { try { return new URL(req.url || '', 'http://x').searchParams.has(name); } catch (e) { return false; } };
const fail = detail => new AnalysisError('HR_INVALID_REQUEST', { status: 400, detail });
const featureOf = req => {
  const id = paramOf(req, 'feature') || paramOf(req, 'templates');
  const f = typeof id === 'string' && hair.IDS.includes(id) ? hair.findFeature(id) : null;
  if (!f) throw fail('fonction inconnue ou fermée');
  return f;
};

async function listTemplates(req, res, feature, budget) {
  const next = paramOf(req, 'next');
  if (present(req, 'next') && !(next && /^[A-Za-z0-9_.:+=/-]{1,300}$/.test(next))) throw fail('page suivante invalide');
  if (!feature.templatesPath) throw fail('cette fonction n\'a pas de modèles');
  const key = feature.id + '|' + (next || '');
  const hit = templateCache.get(key);
  if (hit && Date.now() - hit.at < TEMPLATE_TTL_MS) return send(res, 200, { ok: true, templates: hit.value.templates, next: hit.value.next });
  if (!perfectcorp.isConfigured()) throw new AnalysisError('HR_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });
  const value = await provider.listTemplates(feature, { next }, { budget });
  if (templateCache.size >= TEMPLATE_CACHE_MAX) templateCache.delete(templateCache.keys().next().value);
  templateCache.set(key, { at: Date.now(), value });
  return send(res, 200, { ok: true, templates: value.templates, next: value.next });
}

/* Photo(s) : une seule, ou deux (photo + référence) découpées à ref_at. Chaque partie est validée comme JPEG réel et dimensionnée. */
function readImages(body, req, cfg, feature) {
  const refAtText = paramOf(req, 'ref_at'), wantsRef = feature.id === 'hairstyle' && cfg.reference === true;
  if (present(req, 'ref_at') !== wantsRef) throw fail('ref_at ne correspond pas à la sélection');
  const mime = req.headers['content-type'];
  if (!wantsRef) { const img = validateImage(body, mime); hair.checkImage(img.buffer); return { buffer: img.buffer, mime: img.mime, refBuffer: null }; }
  const at = /^\d{1,8}$/.test(refAtText || '') ? Number(refAtText) : NaN;
  if (!Number.isInteger(at) || at < 4 || at > body.length - 4) throw fail('ref_at hors des octets reçus');
  const a = validateImage(body.subarray(0, at), mime), b = validateImage(body.subarray(at), mime);
  hair.checkImage(a.buffer); hair.checkImage(b.buffer);
  return { buffer: a.buffer, mime: a.mime, refBuffer: b.buffer };
}

async function handler(req, res) {
  const budget = createBudget();
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: toUserMessage('METHOD_NOT_ALLOWED') });
  }
  let user;
  try {
    user = await auth.verifyUser(req, process.env, { budget });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('AUTH_UNAVAILABLE', { status: 503, cause: err });
    console.warn('[DERMAI] Hair refused:', e.code);
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
  const features = hair.activeFeatures();
  const available = isHairEnabled() && isHairAllowed(user.id) && perfectcorp.isConfigured() && features.length > 0;
  const isList = req.method === 'GET' && present(req, 'templates');
  if (req.method === 'GET' && !isList) {
    return send(res, 200, { ok: true, available, features: available ? features.map(f => ({ id: f.id, label: f.label, units: f.units, version: f.version, templates: !!f.templatesPath })) : [] });
  }
  /* Verrou et liste d'utilisateurs autorisés : désactivés par défaut, aucune photo n'est lue ni envoyée sinon. */
  if (!isHairEnabled()) { console.warn('[DERMAI] Hair refused: DERMAI_HAIR_ENABLED is off'); return send(res, 503, { ok: false, error: toUserMessage('HR_DISABLED') }); }
  if (!isHairAllowed(user.id)) { console.warn('[DERMAI] Hair refused: user not allowed'); return send(res, 403, { ok: false, error: toUserMessage('HR_DISABLED') }); }
  try {
    const feature = featureOf(req);
    if (isList) return await listTemplates(req, res, feature, budget);
    const cfg = hair.parseConfig(feature.id, paramOf(req, 'cfg'));
    console.log('[DERMAI] Hair started');
    const readWindowMs = budget.remaining() - (TIME_BUDGET.minStartMs + quota.TIMEOUT_MS);
    if (readWindowMs <= 0) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant la lecture de la photo (${budget.elapsed()} ms écoulées)` });
    const body = await readBody(req, undefined, { timeoutMs: readWindowMs });
    const images = readImages(body, req, cfg, feature);
    if (!budget.canStart(TIME_BUDGET.minStartMs + quota.TIMEOUT_MS)) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant le quota (${budget.elapsed()} ms écoulées)` });
    if (!perfectcorp.isConfigured()) throw new AnalysisError('HR_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });
    await quota.reserveHair(auth.bearerToken(req), feature.units, process.env, { budget });
    console.log('[DERMAI] Hair quota reserved');
    const out = await provider.tryOn({ feature, buffer: images.buffer, refBuffer: images.refBuffer, mime: images.mime, config: cfg }, { budget });
    /* Le navigateur ne reçoit que l'image : ni enveloppe, ni task_id, ni clé. */
    return send(res, 200, { ok: true, hair: { feature: feature.id, image: out.image } });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Hair failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    if (e.status === 429 && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
module.exports._templateCache = templateCache;
