'use strict';
/* Quota d'analyses : réservation atomique côté base (fonction reserve_analysis, voir la migration 20261008120000).
   Appelée avec le jeton de l'utilisateur : l'identité (auth.uid()) vient du jeton vérifié par Supabase, jamais d'une valeur du client, et la base
   sérialise les requêtes simultanées d'un même compte. Rien n'est gardé en mémoire de la fonction serverless (qui peut être dupliquée ou recyclée).
   Appelée APRÈS la validation de la photo et AVANT Perfect Corp : un refus (quota atteint, base injoignable, fonction absente) arrête tout.
   Une réservation n'est jamais remboursée : tout ce qui atteint l'étape fournisseur compte, quel que soit son résultat (la facturation exacte
   du fournisseur n'est pas vérifiée ; c'est l'hypothèse la plus sûre pour le coût). Ni la photo ni aucun résultat ne sont envoyés ici. */
const { publicSupabase, analysisQuota, simulationQuota } = require('./config');
const { AnalysisError } = require('./errors');
const { startDeadline } = require('./budget');

const TIMEOUT_MS = 5000;
/* Remplaçable par les tests (aucun réseau). */
const api = { fetchImpl: (...args) => fetch(...args) };

/* `budget` (facultatif) : budget global de la requête. TIMEOUT_MS reste le délai maximal et couvre la requête ET la lecture complète de la réponse.
   Aucune nouvelle tentative : si la réponse n'arrive pas, la réservation a pu être exécutée en base (état inconnu), l'appelant s'arrête. */
async function reserve(token, env = process.env, { budget } = {}) {
  return reserveVia({ path: '/rest/v1/rpc/reserve_analysis', limits: analysisQuota, exceeded: 'QUOTA_EXCEEDED', unavailable: 'QUOTA_UNAVAILABLE' }, token, env, { budget });
}
/* Quota des simulations : fonction et compteur DISTINCTS (reserve_simulation, voir supabase/proposals/). Mêmes règles : échec fermé, aucune nouvelle tentative,
   jamais remboursé. Tant que la migration n'est pas appliquée, la fonction est absente (404) → SIM_QUOTA_UNAVAILABLE : aucune simulation possible. */
async function reserveSimulation(token, env = process.env, { budget } = {}) {
  return reserveVia({ path: '/rest/v1/rpc/reserve_simulation', limits: simulationQuota, exceeded: 'SIM_QUOTA_EXCEEDED', unavailable: 'SIM_QUOTA_UNAVAILABLE' }, token, env, { budget });
}
async function reserveVia(kind, token, env, { budget } = {}) {
  const cfg = publicSupabase(env);
  const UNAVAILABLE = kind.unavailable;
  if (!cfg || typeof token !== 'string' || !token) throw new AnalysisError(UNAVAILABLE, { status: 503, detail: 'quota : Supabase non configuré ou jeton absent' });
  const { limit, windowSeconds } = kind.limits(env);
  const dl = startDeadline({ timeoutMs: TIMEOUT_MS, budget, label: 'quota' });
  try {
    let res;
    try {
      res = await api.fetchImpl(cfg.supabaseUrl + kind.path, {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_limit: limit, p_window_seconds: windowSeconds }),
        signal: dl.signal
      });
    } catch (e) {
      throw dl.timedOut() ? dl.error(UNAVAILABLE, 'quota : délai dépassé avant la réponse (réservation possiblement exécutée)') : new AnalysisError(UNAVAILABLE, { status: 503, cause: e });
    }
    if (res.status === 401) throw new AnalysisError('AUTH_REQUIRED', { status: 401 });
    if (!res.ok) throw new AnalysisError(UNAVAILABLE, { status: 503, detail: 'quota : Supabase a répondu ' + res.status });   // fonction absente (migration non appliquée) comprise
    let text;
    try { text = await res.text(); }
    catch (e) {
      throw dl.timedOut() ? dl.error(UNAVAILABLE, 'quota : délai dépassé pendant la lecture de la réponse (réservation possiblement exécutée)') : new AnalysisError(UNAVAILABLE, { status: 503, cause: e, detail: 'quota : réponse illisible' });
    }
    let body = null;
    try { body = JSON.parse(text); } catch (e) { body = null; }
    if (!body || typeof body !== 'object') throw new AnalysisError(UNAVAILABLE, { status: 503, detail: 'quota : réponse illisible' });
    if (body.ok === true) return { used: Number(body.used) || 0, limit };
    if (body.ok === false) {
      const err = new AnalysisError(kind.exceeded, { status: 429 });
      err.retryAfter = Number.isFinite(Number(body.retry_after)) ? Math.max(1, Math.min(Math.round(Number(body.retry_after)), 31536000)) : null;
      throw err;
    }
    throw new AnalysisError(UNAVAILABLE, { status: 503, detail: 'quota : réponse inattendue' });
  } finally { dl.clear(); }
}

module.exports = { reserve, api, TIMEOUT_MS };   // TIMEOUT_MS : délai maximal de la requête de réservation, lu par le handler pour son budget de temps
module.exports.reserveSimulation = reserveSimulation;
