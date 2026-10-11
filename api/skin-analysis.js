'use strict';
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toUserMessage } = require('../server/errors');
const perfectcorp = require('../server/perfectcorp');
const auth = require('../server/auth');
const quota = require('../server/quota');
const { isAnalysisEnabled, isDebugRawEnabled, TIME_BUDGET } = require('../server/config');
const { createBudget } = require('../server/budget');
const { describeStructure } = require('../server/structure');
const masks = require('../server/masks');   // localisation réelle : masques Perfect Corp, téléchargés ici, renvoyés en data URL
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
  /* Budget de temps global, démarré avant toute opération réseau liée à l'analyse (session, photo, quota, fournisseur, masques). */
  const budget = createBudget();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: toUserMessage('METHOD_NOT_ALLOWED') });
  }
  /* Authentification d'abord : seule une session Supabase valide (vérifiée auprès de Supabase) peut déclencher une analyse. Refus AVANT toute lecture
     du corps, toute validation de photo et tout appel à Perfect Corp, y compris verrou ouvert. L'état du verrou n'est donc jamais révélé à un anonyme. */
  try {
    await auth.verifyUser(req, process.env, { budget });
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('AUTH_UNAVAILABLE', { status: 503, cause: err });
    console.warn('[DERMAI] Skin analysis refused:', e.code);
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
  /* Verrou : désactivé par défaut, aucune photo n'est lue ni envoyée tant qu'il n'est pas activé. */
  if (!isAnalysisEnabled()) {
    console.warn('[DERMAI] Skin analysis refused: DERMAI_ANALYSIS_ENABLED is off');
    return send(res, 503, { ok: false, error: toUserMessage('ANALYSIS_DISABLED') });
  }
  try {
    console.log('[DERMAI] Skin analysis started');
    /* Lecture de la photo bornée : au plus le temps qui sépare l'instant présent du seuil exigé avant la réservation du crédit (au-delà, le contrôle
       ci-dessous refuserait de toute façon). Aucun temps disponible : refus sans lire la photo. Aucun crédit n'est réservé avant la fin de la lecture. */
    const readWindowMs = budget.remaining() - (TIME_BUDGET.minStartMs + quota.TIMEOUT_MS);
    if (readWindowMs <= 0) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant la lecture de la photo (${budget.elapsed()} ms écoulées)` });
    const body = await readBody(req, undefined, { timeoutMs: readWindowMs });
    const image = validateImage(body, req.headers['content-type']);
    /* Pas assez de temps pour mener une analyse : refus AVANT la réservation du crédit et avant tout appel au fournisseur. La réservation peut
       elle-même durer jusqu'à quota.TIMEOUT_MS : le seuil la compte, pour qu'il reste minStartMs une fois le crédit réservé (sans garantie de
       réussite). */
    if (!budget.canStart(TIME_BUDGET.minStartMs + quota.TIMEOUT_MS)) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant le quota (${budget.elapsed()} ms écoulées)` });
    /* Quota : réservation atomique côté base, avec l'identité du jeton. Dernier contrôle avant Perfect Corp : refus (quota atteint, base ou
       fonction indisponible) = aucun appel au fournisseur. Les photos invalides ci-dessus ne consomment rien. */
    if (!perfectcorp.isConfigured()) throw new AnalysisError('SERVICE_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });   // rien n'est réservé si le service ne peut pas répondre
    await quota.reserve(auth.bearerToken(req), process.env, { budget });
    console.log('[DERMAI] Analysis quota reserved');
    const envelope = await perfectcorp.analyzeSkin(image, { budget });
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
    /* Localisation : uniquement les masques réellement renvoyés par Perfect Corp. Facultative : un échec ne bloque jamais l'analyse.
       Les URL d'origine ne quittent pas le serveur ; rien n'est stocké. Clé absente quand aucun masque n'est exploitable. */
    let localization = {};
    try {
      const m = await masks.collect(envelope, { budget });
      localization = m.localization;
      if (m.stats.skipped) console.log('[DERMAI] Localization skipped: time budget');
      else console.log('[DERMAI] Localization: metrics', m.stats.metrics, '| listed', m.stats.listed, '| kept', m.stats.kept);
    } catch (e) { console.warn('[DERMAI] Localization unavailable'); }
    const payload = { ok: true, result };
    if (Object.keys(localization).length) payload.localization = localization;
    /* L'enveloppe brute ne part au navigateur que sur diagnostic explicite (DERMAI_DEBUG_RAW). */
    if (isDebugRawEnabled()) payload.raw = envelope;
    return send(res, 200, payload);
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Skin analysis failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (e.status === 429 && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
