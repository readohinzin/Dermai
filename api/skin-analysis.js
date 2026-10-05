'use strict';
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toUserMessage } = require('../server/errors');
const perfectcorp = require('../server/perfectcorp');
const { isAnalysisEnabled, isDebugRawEnabled } = require('../server/config');
const { describeStructure } = require('../server/structure');

/* Corps brut : le navigateur envoie directement l'image JPEG (pas de multipart). */
const config = { api: { bodyParser: false } };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: toUserMessage('METHOD_NOT_ALLOWED') });
  }
  /* Verrou : désactivé par défaut, aucune photo n'est lue ni envoyée tant qu'il n'est pas activé. */
  if (!isAnalysisEnabled()) {
    console.warn('[DERMAI] Skin analysis refused: DERMAI_ANALYSIS_ENABLED is off');
    return send(res, 503, { ok: false, error: toUserMessage('ANALYSIS_DISABLED') });
  }
  try {
    console.log('[DERMAI] Skin analysis started');
    const body = await readBody(req);
    const image = validateImage(body, req.headers['content-type']);
    const raw = await perfectcorp.analyzeSkin(image);
    /* Log de la structure seulement (noms de champs et types) : jamais de valeurs, d'URL ni de photo. */
    console.log('[DERMAI] Perfect Corp result structure', JSON.stringify(describeStructure(raw)));
    /* Le JSON brut ne part pas au navigateur, sauf diagnostic explicite (DERMAI_DEBUG_RAW). */
    return send(res, 200, isDebugRawEnabled() ? { ok: true, raw } : { ok: true });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Skin analysis failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
