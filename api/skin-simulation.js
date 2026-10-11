'use strict';
/* Simulation cosmétique avant/après (illustration, pas une prédiction). Fonction DISTINCTE de /api/skin-analysis : verrou, liste d'utilisateurs
   autorisés et quota propres. N'appelle jamais le point d'entrée d'analyse de Perfect Corp.
   GET  : réponse { ok, available } pour le compte connecté. Aucun appel au fournisseur, aucun quota, rien n'est consommé.
   POST : corps = photo JPEG brute ; ?concern=<zone> (une seule, liste blanche). Ordre des garde-fous, chacun AVANT le suivant :
          méthode → session Supabase → verrou → utilisateur autorisé → zone → lecture/validation de la photo → temps restant → clé configurée →
          quota de simulations (réservation atomique, jamais remboursée) → Perfect Corp → image résultat (data URL). */
const { readBody, validateImage } = require('../server/validation');
const { AnalysisError, toSimulationMessage: toUserMessage } = require('../server/errors');
const auth = require('../server/auth');
const quota = require('../server/quota');
const perfectcorp = require('../server/perfectcorp');
const simulation = require('../server/perfectcorp-simulation');
const { isSimulationEnabled, isSimulationAllowed, isDebugRawEnabled, TIME_BUDGET, SIM_INTENSITY } = require('../server/config');
const { createBudget } = require('../server/budget');

const config = { api: { bodyParser: false } };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function concernOf(req) {
  let list;
  try { list = new URL(req.url || '', 'http://x').searchParams.getAll('concern'); } catch (e) { list = []; }
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
    console.warn('[DERMAI] Simulation refused:', e.code);
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
  const available = isSimulationEnabled() && isSimulationAllowed(user.id) && perfectcorp.isConfigured();
  if (req.method === 'GET') return send(res, 200, { ok: true, available });
  /* Verrou et liste d'utilisateurs autorisés : désactivés par défaut, aucune photo n'est lue ni envoyée sinon. */
  if (!isSimulationEnabled()) { console.warn('[DERMAI] Simulation refused: DERMAI_SIMULATION_ENABLED is off'); return send(res, 503, { ok: false, error: toUserMessage('SIM_DISABLED') }); }
  if (!isSimulationAllowed(user.id)) { console.warn('[DERMAI] Simulation refused: user not allowed'); return send(res, 403, { ok: false, error: toUserMessage('SIM_DISABLED') }); }
  try {
    const concern = concernOf(req);
    if (!simulation.concernParam(concern)) throw new AnalysisError('SIM_INVALID_CONCERN', { status: 400, detail: 'zone absente, multiple ou hors liste blanche' });
    console.log('[DERMAI] Simulation started');
    const readWindowMs = budget.remaining() - (TIME_BUDGET.minStartMs + quota.TIMEOUT_MS);
    if (readWindowMs <= 0) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant la lecture de la photo (${budget.elapsed()} ms écoulées)` });
    const body = await readBody(req, undefined, { timeoutMs: readWindowMs });
    const image = validateImage(body, req.headers['content-type']);
    if (!budget.canStart(TIME_BUDGET.minStartMs + quota.TIMEOUT_MS)) throw new AnalysisError('TIME_BUDGET', { status: 504, detail: `budget de temps insuffisant avant le quota (${budget.elapsed()} ms écoulées)` });
    if (!perfectcorp.isConfigured()) throw new AnalysisError('SIM_UNAVAILABLE', { status: 503, detail: 'PERFECT_CORP_API_KEY manquante' });
    await quota.reserveSimulation(auth.bearerToken(req), process.env, { budget });
    console.log('[DERMAI] Simulation quota reserved');
    const out = await simulation.simulate({ buffer: image.buffer, mime: image.mime, concern }, { budget });
    /* Le navigateur ne reçoit que l'image et la zone : ni enveloppe, ni task_id, ni URL du fournisseur. */
    const payload = { ok: true, simulation: { concern, intensity: SIM_INTENSITY, image: out.image } };
    if (isDebugRawEnabled()) payload.raw = out.envelope;
    return send(res, 200, payload);
  } catch (err) {
    const e = err instanceof AnalysisError ? err : new AnalysisError('UNKNOWN', { cause: err });
    console.error('[DERMAI] Simulation failed:', e.code, e.detail || (e.cause && e.cause.message) || '');
    if (e.status === 429 && e.retryAfter) res.setHeader('Retry-After', String(e.retryAfter));
    if (e.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    return send(res, e.status, { ok: false, error: toUserMessage(e.code) });
  }
}

module.exports = handler;
module.exports.config = config;
