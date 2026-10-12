'use strict';
/* Page d'administration : statistiques de comptes et d'utilisation par fonction, LECTURE SEULE. Appelle la fonction SQL admin_overview
   (supabase/proposals/20261014120000_admin_overview.sql) avec le jeton du fondateur : l'identité (auth.uid()) vient du jeton vérifié par Supabase, et la base vérifie
   elle-même que le compte figure dans admin_users. Aucune clé service_role, aucun SQL écrit ici, aucune écriture.
   La réponse est RECONSTRUITE champ par champ (nombres entiers positifs seulement) : rien de la réponse brute n'est relayé, et un champ absent ou invalide reste « null »
   (affiché « Indisponible »), jamais zéro. Fonction absente (404) = proposition non appliquée. Compte absent de admin_users (400 ou 403) = non autorisé côté base. */
const { publicSupabase } = require('./config');
const { AnalysisError } = require('./errors');
const { startDeadline } = require('./budget');

const TIMEOUT_MS = 8000;
/* Remplaçable par les tests (aucun réseau). */
const api = { fetchImpl: (...args) => fetch(...args) };

const count = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const pick = (o, keys) => { const src = o && typeof o === 'object' ? o : {}; const out = {}; for (const k of keys) out[k] = count(src[k]); return out; };
const ACCOUNT_KEYS = ['total', 'new_7d', 'new_30d', 'signed_in_7d', 'signed_in_30d', 'active_7d', 'active_30d', 'returned_7d', 'never_used', 'inactive_30d'];
const FUNCTIONS = [['analysis', 'Analyse de la peau', false], ['simulation', 'Simulation cosmétique', false], ['makeup', 'Studio Beauté : maquillage', false], ['hair', 'Studio Beauté : cheveux', true]];
const SAVED_KEYS = ['total', 'last_30d', 'users'];

/* Forme attendue de la fonction SQL → forme sûre renvoyée au navigateur. Une forme inconnue lève une erreur (« malformed »). */
function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !raw.accounts || typeof raw.accounts !== 'object' || !raw.functions || typeof raw.functions !== 'object') throw new AnalysisError('UNKNOWN', { status: 502, detail: 'admin_overview : forme inconnue' });
  const fns = FUNCTIONS.map(([key, name, units]) => {
    const f = raw.functions[key];
    if (!f || typeof f !== 'object' || f.available !== true) return { key, name, available: false };
    return Object.assign({ key, name, available: true }, pick(f, ['runs_7d', 'runs_30d', 'users_30d'].concat(units ? ['units_7d', 'units_30d'] : [])));
  });
  return { accounts: pick(raw.accounts, ACCOUNT_KEYS), functions: fns, savedAnalyses: pick(raw.saved_analyses, SAVED_KEYS) };
}

/* `budget` (facultatif) : budget global de la requête. Aucune nouvelle tentative (lecture, mais inutile de doubler la charge). */
async function getOverview(token, env = process.env, { budget } = {}) {
  const cfg = publicSupabase(env);
  if (!cfg || typeof token !== 'string' || !token) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_overview : Supabase non configuré ou jeton absent' });
  const dl = startDeadline({ timeoutMs: TIMEOUT_MS, budget, label: 'admin_overview' });
  try {
    let res;
    try {
      res = await api.fetchImpl(cfg.supabaseUrl + '/rest/v1/rpc/admin_overview', { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: dl.signal });
    } catch (e) {
      throw dl.timedOut() ? dl.error('UNKNOWN', 'admin_overview : délai dépassé') : new AnalysisError('UNKNOWN', { status: 503, cause: e, detail: 'admin_overview : réseau' });
    }
    if (res.status === 404) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_overview : fonction absente (not_applied)' });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_overview : refusé par la base (not_authorized)' });
    if (!res.ok) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_overview : HTTP ' + res.status });
    let text;
    try { text = await res.text(); }
    catch (e) { throw dl.timedOut() ? dl.error('UNKNOWN', 'admin_overview : délai dépassé') : new AnalysisError('UNKNOWN', { status: 503, cause: e, detail: 'admin_overview : réseau' }); }
    let body; try { body = JSON.parse(text); } catch (e) { throw new AnalysisError('UNKNOWN', { status: 502, detail: 'admin_overview : forme inconnue' }); }
    return sanitize(body);
  } finally { dl.clear(); }
}

module.exports = { getOverview, sanitize, api, TIMEOUT_MS };
