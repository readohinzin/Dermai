'use strict';
/* Page d'administration : liste des comptes (adresses e-mail) et présence « en ligne », LECTURE SEULE. Appelle la fonction SQL admin_accounts
   (supabase/proposals/20261015120000_admin_accounts_presence.sql) avec le jeton du fondateur : l'identité (auth.uid()) vient du jeton vérifié par Supabase, et la base vérifie elle-même que le compte
   figure dans admin_users. Aucune clé service_role, aucun SQL écrit ici, aucune écriture.
   Les adresses e-mail sont des DONNÉES PERSONNELLES : elles ne sont renvoyées qu'après le contrôle d'accès du fondateur, jamais journalisées, jamais mises en cache par un intermédiaire (no-store).
   La réponse est RECONSTRUITE champ par champ : une adresse doit être une chaîne courte, une date une date valide, « online » exactement true ; tout le reste devient null (affiché « inconnu »), jamais
   une valeur inventée. Aucun identifiant interne n'est relayé. */
const { publicSupabase } = require('./config');
const { AnalysisError } = require('./errors');
const { startDeadline } = require('./budget');

const TIMEOUT_MS = 8000;
const MAX_ACCOUNTS = 500;
/* Remplaçable par les tests (aucun réseau). */
const api = { fetchImpl: (...args) => fetch(...args) };

const count = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const isoOrNull = v => { if (typeof v !== 'string' || v.length > 40) return null; const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
const emailOrNull = v => (typeof v === 'string' && v.length >= 3 && v.length <= 254 && !/[\s<>"'\u0000-\u001f]/.test(v) ? v : null);

function sanitize(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.accounts)) throw new AnalysisError('UNKNOWN', { status: 502, detail: 'admin_accounts : forme inconnue' });
  const accounts = raw.accounts.slice(0, MAX_ACCOUNTS).filter(a => a && typeof a === 'object').map(a => ({
    email: emailOrNull(a.email), createdAt: isoOrNull(a.created_at), lastSignInAt: isoOrNull(a.last_sign_in_at), lastSeenAt: isoOrNull(a.last_seen_at), online: a.online === true
  }));
  return { total: count(raw.total), truncated: raw.truncated === true, accounts, generatedAt: isoOrNull(raw.generated_at) };
}

/* `budget` (facultatif) : budget global de la requête. Aucune nouvelle tentative. */
async function getAccounts(token, env = process.env, { budget } = {}) {
  const cfg = publicSupabase(env);
  if (!cfg || typeof token !== 'string' || !token) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_accounts : Supabase non configuré ou jeton absent' });
  const dl = startDeadline({ timeoutMs: TIMEOUT_MS, budget, label: 'admin_accounts' });
  try {
    let res;
    try {
      res = await api.fetchImpl(cfg.supabaseUrl + '/rest/v1/rpc/admin_accounts', { method: 'POST', headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}', signal: dl.signal });
    } catch (e) {
      throw dl.timedOut() ? dl.error('UNKNOWN', 'admin_accounts : délai dépassé') : new AnalysisError('UNKNOWN', { status: 503, cause: e, detail: 'admin_accounts : réseau' });
    }
    if (res.status === 404) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_accounts : fonction absente (not_applied)' });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_accounts : refusé par la base (not_authorized)' });
    if (!res.ok) throw new AnalysisError('UNKNOWN', { status: 503, detail: 'admin_accounts : HTTP ' + res.status });
    let text;
    try { text = await res.text(); }
    catch (e) { throw dl.timedOut() ? dl.error('UNKNOWN', 'admin_accounts : délai dépassé') : new AnalysisError('UNKNOWN', { status: 503, cause: e, detail: 'admin_accounts : réseau' }); }
    let body; try { body = JSON.parse(text); } catch (e) { throw new AnalysisError('UNKNOWN', { status: 502, detail: 'admin_accounts : forme inconnue' }); }
    return sanitize(body);
  } finally { dl.clear(); }
}

module.exports = { getAccounts, sanitize, api, TIMEOUT_MS, MAX_ACCOUNTS };
