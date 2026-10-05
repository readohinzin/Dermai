'use strict';
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toUserMessage } = require('../server/errors');
const { analyzeSkin } = require('../server/perfectcorp');

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
  try {
    console.log('[DERMAI] Skin analysis started');
    const body = await readBody(req);
    const image = validateImage(body, req.headers['content-type']);
    const raw = await analyzeSkin(image);
    // Étape 3 : la normalisation et le filtrage de la réponse se feront ici.
    return send(res, 200, { ok: true, raw });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Skin analysis failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
