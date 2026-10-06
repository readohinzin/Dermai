'use strict';
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toUserMessage } = require('../server/errors');
const perfectcorp = require('../server/perfectcorp');
const { isAnalysisEnabled, isDebugRawEnabled } = require('../server/config');
const { describeStructure } = require('../server/structure');
/* Module partagé avec le navigateur (js/skin-model.js) : localise le résultat et ne garde que les champs autorisés. */
const skinModel = require('../js/skin-model.js');
const { diagnosticLines, repetitionLine } = require('../server/diagnostic');   // DIAGNOSTIC TEMPORAIRE (voir server/diagnostic.js)

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
    const envelope = await perfectcorp.analyzeSkin(image);
    /* Log de la structure seulement (noms de champs et types) : jamais de valeurs, d'URL ni de photo. */
    console.log('[DERMAI] Perfect Corp result structure', JSON.stringify(describeStructure(envelope)));
    for (const line of diagnosticLines(envelope)) console.log(line);   // DIAGNOSTIC TEMPORAIRE : valeurs de skin_type, all, skin_age
    const repetitions = repetitionLine(envelope);                       // DIAGNOSTIC TEMPORAIRE : occurrences par type (noms et nombres)
    if (repetitions) console.log(repetitions);
    /* Le navigateur ne reçoit que le résultat normalisé : ni enveloppe, ni task_id, ni URL, ni champ inconnu. */
    const out = skinModel.parseSkinResponse(envelope);
    if (out.status === 'not_found') {
      throw new AnalysisError('RESULT_NOT_FOUND', { status: 502, detail: `${out.path} absent ou sans métrique connue (types ignorés : ${out.ignoredTypes.join(', ') || 'aucun'})` });
    }
    if (out.status === 'invalid') {
      throw new AnalysisError('RESULT_INVALID', { status: 502, detail: `${out.path} n'est pas un tableau d'éléments { type, … }` });
    }
    if (out.status === 'ambiguous') {
      throw new AnalysisError('RESULT_AMBIGUOUS', { status: 502, detail: `${out.path} : métrique répétée (${out.types.join(', ')})` });
    }
    /* Noms de types seulement (identifiants Perfect Corp), jamais de valeurs. Les types ignorés révéleront la représentation
       éventuelle de skin_type / all dans le tableau, aujourd'hui non établie. */
    console.log('[DERMAI] Perfect Corp result path:', out.path, '| types lus :', out.types.join(','), '| types ignorés :', out.ignoredTypes.join(',') || 'aucun');
    const result = { schemaVersion: skinModel.SCHEMA_VERSION, normalized: out.normalized };
    /* L'enveloppe brute ne part au navigateur que sur diagnostic explicite (DERMAI_DEBUG_RAW). */
    return send(res, 200, isDebugRawEnabled() ? { ok: true, result, raw: envelope } : { ok: true, result });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Skin analysis failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
