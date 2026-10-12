'use strict';
/* Studio Beauté (essayage virtuel de maquillage). Fonction DISTINCTE de /api/skin-analysis et /api/skin-simulation : verrou, liste d'utilisateurs autorisés et quota propres.
   N'appelle jamais les points d'entrée d'analyse ni de simulation de Perfect Corp.
   GET  : réponse { ok, available } pour le compte connecté. Aucun appel au fournisseur, aucun quota, rien n'est consommé.
   POST : corps = photo JPEG brute ; ?cfg=<sélection JSON> (couleurs, textures et intensités seulement). Ordre des garde-fous, chacun AVANT le suivant :
          méthode → session Supabase → verrou → utilisateur autorisé → sélection de maquillage → temps restant → lecture et validation de la photo (type, octets,
          taille, dimensions) → clé configurée → quota d'essayages (réservation atomique, jamais remboursée) → Perfect Corp (UNE tâche) → URL https temporaire de l'image.
   Le navigateur ne fournit jamais d'URL d'image ni de corps pour le fournisseur ; il ne reçoit jamais task_id, enveloppe ni clé. */
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toMakeupMessage: toUserMessage } = require('../server/errors');
const auth = require('../server/auth');
const quota = require('../server/quota');
const perfectcorp = require('../server/perfectcorp');
const makeup = require('../server/makeup');
const studio = require('../server/perfectcorp-makeup');
const { isMakeupEnabled, isMakeupAllowed, TIME_BUDGET } = require('../server/config');
const { createBudget } = require('../server/budget');

const config = { api: { bodyParser: false } };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/* Le paramètre cfg, présent une seule fois. */
function cfgOf(req) {
  let list;
  try { list = new URL(req.url || '', 'http://x').searchParams.getAll('cfg'); } catch (e) { list = []; }
  return list.length === 1 ? list[0] : null;
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
    console.warn('[DERMAI] Makeup refused:', e.code);
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
  const available = isMakeupEnabled() && isMakeupAllowed(user.id) && perfectcorp.isConfigured();
  if (req.method === 'GET') return send(res, 200, { ok: true, available });
  /* Verrou et liste d'utilisateurs autorisés : désactivés par défaut, aucune photo n'est lue ni envoyée sinon. */
  if (!isMakeupEnabled()) { console.warn('[DERMAI] Makeup refused: DERMAI_MAKEUP_ENABLED is off'); return send(res, 503, { ok: false, error: toUserMessage('MK_DISABLED') }); }
  if (!isMakeupAllowed(user.id)) { console.warn('[DERMAI] Makeup refused: user not allowed'); return send(res, 403, { ok: false, error: toUserMessage('MK_DISABLED') }); }
  try {
    const selection = makeup.parseConfig(cfgOf(req));
    console.log('[DERMAI] Makeup started');
    const readWindowMs = budget.remaining() - (TIME_BUDGET.minStartMs + quota.TIMEOUT_MS);
    if (readWindowMs <= 0) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant la lecture de la photo (${budget.elapsed()} ms écoulées)` });
    const body = await readBody(req, undefined, { timeoutMs: readWindowMs });
    const image = validateImage(body, req.headers['content-type']);
    makeup.checkImage(image.buffer);
    if (!budget.canStart(TIME_BUDGET.minStartMs + quota.TIMEOUT_MS)) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant le quota (${budget.elapsed()} ms écoulées)` });
    if (!perfectcorp.isConfigured()) throw new AnalysisError('MK_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });
    await quota.reserveMakeup(auth.bearerToken(req), process.env, { budget });
    console.log('[DERMAI] Makeup quota reserved');
    const out = await studio.tryOn({ buffer: image.buffer, mime: image.mime, config: selection }, { budget });
    /* Le navigateur ne reçoit que l'image : ni enveloppe, ni task_id, ni clé. */
    return send(res, 200, { ok: true, makeup: { image: out.image } });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Makeup failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    if (e.status === 429 && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
