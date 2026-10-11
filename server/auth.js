'use strict';
/* Authentification de l'appelant de /api/skin-analysis : une session Supabase valide, vérifiée CÔTÉ SERVEUR auprès de Supabase.
   Le jeton (Authorization: Bearer <access_token>) est envoyé à GoTrue (GET /auth/v1/user) avec la clé publique « anon » : Supabase vérifie
   la signature, l'expiration et l'existence de l'utilisateur, puis renvoie son identité. Rien n'est décodé ni cru sur parole ici, et aucun
   identifiant fourni par le navigateur (corps, en-tête, paramètre) n'est jamais utilisé : l'identité vient uniquement de cette réponse.
   Ni clé service_role ni secret : seules SUPABASE_URL et SUPABASE_ANON_KEY (publiques) sont lues.
   Échec fermé : jeton absent, mal formé, expiré, falsifié, clé « anon » elle-même → refus (401). Supabase injoignable, en erreur ou non
   configuré → refus (503). Dans tous les cas, avant toute lecture de la photo et tout appel à Perfect Corp. Le jeton n'est jamais journalisé. */
const { publicSupabase } = require('./config');
const { AnalysisError } = require('./errors');
const { startDeadline } = require('./budget');

const TIMEOUT_MS = 5000;
/* Forme d'un JWT : trois segments base64url. Un en-tête absent ou mal formé est refusé sans même interroger Supabase. */
const JWT_RE = /^[A-Za-z0-9_-]{4,3000}\.[A-Za-z0-9_-]{4,3000}\.[A-Za-z0-9_-]{4,3000}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;     // identifiant d'utilisateur renvoyé par Supabase (UUID en pratique)

/* Remplaçable par les tests (aucun réseau). */
const api = { fetchImpl: (...args) => fetch(...args) };

function bearerToken(req) {
  const h = req && req.headers && req.headers.authorization;
  const m = /^Bearer\s+(\S+)$/i.exec(typeof h === 'string' ? h.trim() : '');
  return m && JWT_RE.test(m[1]) ? m[1] : null;
}

/* `budget` (facultatif) : budget global de la requête (server/budget.js). Le délai maximal reste TIMEOUT_MS ; il couvre la requête ET la lecture
   complète de la réponse. Une réponse illisible ou une panne n'est JAMAIS une session invalide : 503 (disponibilité), jamais 401. */
async function verifyUser(req, env = process.env, { budget } = {}) {
  const token = bearerToken(req);
  if (!token) throw new AnalysisError('AUTH_REQUIRED', { status: 401 });
  const cfg = publicSupabase(env);
  if (!cfg) throw new AnalysisError('AUTH_UNAVAILABLE', { status: 503, detail: 'SUPABASE_URL / SUPABASE_ANON_KEY non configurés : analyse refusée' });
  const dl = startDeadline({ timeoutMs: TIMEOUT_MS, budget, label: 'auth' });
  try {
    let res;
    try {
      res = await api.fetchImpl(cfg.supabaseUrl + '/auth/v1/user', { method: 'GET', headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token }, signal: dl.signal });
    } catch (e) {
      throw dl.timedOut() ? dl.error('AUTH_UNAVAILABLE', 'auth : délai dépassé avant la réponse') : new AnalysisError('AUTH_UNAVAILABLE', { status: 503, cause: e });
    }
    if ([400, 401, 403, 422].includes(res.status)) throw new AnalysisError('AUTH_REQUIRED', { status: 401 });
    if (!res.ok) throw new AnalysisError('AUTH_UNAVAILABLE', { status: 503, detail: 'Supabase a répondu ' + res.status });
    let text;
    try { text = await res.text(); }
    catch (e) {
      throw dl.timedOut() ? dl.error('AUTH_UNAVAILABLE', 'auth : délai dépassé pendant la lecture de la réponse') : new AnalysisError('AUTH_UNAVAILABLE', { status: 503, cause: e, detail: 'auth : réponse illisible' });
    }
    let body;
    try { body = JSON.parse(text); } catch (e) { throw new AnalysisError('AUTH_UNAVAILABLE', { status: 503, detail: 'auth : réponse non JSON' }); }
    if (!body || typeof body.id !== 'string' || !ID_RE.test(body.id)) throw new AnalysisError('AUTH_REQUIRED', { status: 401 });   // réponse LISIBLE sans utilisateur valide
    return { id: body.id };
  } finally { dl.clear(); }
}

module.exports = { verifyUser, bearerToken, api, JWT_RE };
