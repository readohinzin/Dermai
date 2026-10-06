/* DERMAI : compte utilisateur et profil persistant (Supabase Auth + table `profiles`, par l'API REST publique).
   Aucune dépendance, aucun moteur cosmétique ici : seulement identité, session et lecture/écriture des préférences de personnalisation.
   Sécurité : seule la clé publique (anon) est utilisée. L'identité vient du jeton de session ; `user_id` n'est JAMAIS envoyé par le navigateur
   (la base le déduit de auth.uid() et RLS limite chaque lecture et écriture à la ligne de l'utilisateur connecté).
   Aucun mot de passe n'est conservé. Seule la session d'authentification (jetons) est mémorisée dans le navigateur, pour survivre à un
   rechargement ; le profil, lui, n'est jamais copié dans le stockage local. Aucune photo, aucun masque, aucun task_id n'est concerné. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiAccount = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SESSION_KEY = 'dermai.session';
  const REFRESH_MARGIN_S = 60;

  /* Messages humains : jamais de code HTTP, de texte brut du service, de nom de table ni de SQL. */
  const MSG = {
    unavailable: 'Les comptes ne sont pas disponibles pour le moment.',
    network: 'Connexion impossible. Vérifiez votre réseau et réessayez.',
    invalidCredentials: 'Adresse e-mail ou mot de passe incorrect.',
    emailInvalid: 'Saisissez une adresse e-mail valide.',
    passwordShort: 'Choisissez un mot de passe d\'au moins 8 caractères.',
    exists: 'Un compte existe déjà avec cette adresse. Connectez-vous.',
    notConfirmed: 'Confirmez votre adresse e-mail avant de vous connecter.',
    needsConfirmation: 'Un e-mail de confirmation vous a été envoyé. Confirmez votre adresse, puis connectez-vous.',
    rateLimited: 'Trop de tentatives. Réessayez dans quelques instants.',
    generic: 'Une erreur est survenue. Veuillez réessayer.',
    saveFailed: 'Vos modifications n\'ont pas pu être enregistrées. Réessayez.',
    loadFailed: 'Votre profil n\'a pas pu être chargé. Réessayez.',
    sessionExpired: 'Votre session a expiré. Reconnectez-vous.'
  };
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* Profil de l'application ↔ ligne de la table. Aucun identifiant utilisateur ici. */
  function toRow(p) {
    const q = p || {};
    return {
      goals: Array.isArray(q.goals) ? q.goals.slice(0, 3) : [],
      routine_level: ['none', 'simple', 'full'].includes(q.level) ? q.level : null,
      prefer_gentle: !!(q.comfort && q.comfort.preferGentle),
      exclusions: Array.isArray(q.exclusions) ? q.exclusions.filter(x => typeof x === 'string').slice(0, 20) : []
    };
  }
  function fromRow(r) {
    const row = r && typeof r === 'object' ? r : {};
    return {
      goals: Array.isArray(row.goals) ? row.goals.filter(x => typeof x === 'string') : [],
      level: ['none', 'simple', 'full'].includes(row.routine_level) ? row.routine_level : '',
      comfort: { preferGentle: row.prefer_gentle === true },
      exclusions: Array.isArray(row.exclusions) ? row.exclusions.filter(x => typeof x === 'string') : []
    };
  }

  function create(opts) {
    const o = opts || {};
    const base = typeof o.url === 'string' && /^https:\/\/[^/\s]+$/.test(o.url.replace(/\/+$/, '')) ? o.url.replace(/\/+$/, '') : '';
    const key = typeof o.anonKey === 'string' ? o.anonKey.trim() : '';
    const doFetch = o.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const store = o.storage || null;
    const now = o.now || (() => Math.floor(Date.now() / 1000));
    const available = !!(base && key && doFetch);
    let session = null;

    const saveStored = () => { try { if (store) { if (session) store.setItem(SESSION_KEY, JSON.stringify(session)); else store.removeItem(SESSION_KEY); } } catch (e) { /* stockage indisponible : session limitée à cette page */ } };
    const readStored = () => { try { const v = store && store.getItem(SESSION_KEY); const s = v ? JSON.parse(v) : null; return s && s.access_token && s.refresh_token && s.user && s.user.id ? s : null; } catch (e) { return null; } };
    const setSession = body => {
      if (!body || !body.access_token || !body.refresh_token || !body.user || !body.user.id) return null;
      session = { access_token: body.access_token, refresh_token: body.refresh_token,
        expires_at: body.expires_at || (now() + (Number(body.expires_in) || 3600)), user: { id: String(body.user.id), email: String(body.user.email || '') } };
      saveStored();
      return session;
    };
    const clear = () => { session = null; saveStored(); };

    async function call(path, init, withUser) {
      const headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, (init && init.headers) || {});
      headers.Authorization = 'Bearer ' + (withUser && session ? session.access_token : key);
      let res;
      try { res = await doFetch(base + path, Object.assign({}, init, { headers })); } catch (e) { return { network: true }; }
      let body = null;
      try { const t = await res.text(); body = t ? JSON.parse(t) : null; } catch (e) { body = null; }
      return { status: res.status, ok: res.ok, body };
    }

    function authError(r, mode) {
      if (r.network) return MSG.network;
      const code = r.body && (r.body.error_code || r.body.code || '');
      const text = String((r.body && (r.body.msg || r.body.error_description || r.body.message)) || '').toLowerCase();
      if (r.status === 429 || /rate.?limit/.test(String(code))) return MSG.rateLimited;
      if (/email_not_confirmed|not confirmed/.test(String(code) + text)) return MSG.notConfirmed;
      if (/user_already_exists|already (registered|exists)/.test(String(code) + text)) return MSG.exists;
      if (/weak_password|password/.test(String(code)) && mode === 'signup') return MSG.passwordShort;
      if (/invalid_credentials|invalid login/.test(String(code) + text) || (mode === 'login' && (r.status === 400 || r.status === 401))) return MSG.invalidCredentials;
      return MSG.generic;
    }

    function checkCredentials(email, password) {
      if (!EMAIL_RE.test(String(email || '').trim())) return MSG.emailInvalid;
      if (typeof password !== 'string' || password.length < 8) return MSG.passwordShort;
      return null;
    }

    async function refresh() {
      if (!session) return false;
      const r = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) }, false);
      if (r.network) return false;               // erreur réseau : on garde la session, on réessaiera
      if (r.ok && setSession(r.body)) return true;
      clear();                                    // jeton refusé : session terminée
      return false;
    }

    /* Au démarrage : retrouve la session mémorisée (la rafraîchit si besoin). Ne lève jamais d'erreur. */
    async function restoreSession() {
      if (!available) return null;
      const s = readStored();
      if (!s) return null;
      session = s;
      if (session.expires_at - now() <= REFRESH_MARGIN_S) {
        const ok = await refresh();
        if (!ok && !session) return null;
        if (!ok && session && session.expires_at <= now()) return null;
      }
      return session ? { id: session.user.id, email: session.user.email } : null;
    }

    async function signUp(email, password) {
      if (!available) return { ok: false, error: MSG.unavailable };
      const bad = checkCredentials(email, password);
      if (bad) return { ok: false, error: bad };
      const r = await call('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: String(email).trim(), password }) }, false);
      if (!r.ok) return { ok: false, error: authError(r, 'signup') };
      if (setSession(r.body)) return { ok: true, user: { id: session.user.id, email: session.user.email } };
      return { ok: true, needsConfirmation: true, message: MSG.needsConfirmation };
    }

    async function signIn(email, password) {
      if (!available) return { ok: false, error: MSG.unavailable };
      if (!EMAIL_RE.test(String(email || '').trim()) || !password) return { ok: false, error: MSG.invalidCredentials };
      const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: String(email).trim(), password }) }, false);
      if (!r.ok || !setSession(r.body)) return { ok: false, error: authError(r, 'login') };
      return { ok: true, user: { id: session.user.id, email: session.user.email } };
    }

    async function signOut() {
      const s = session;
      clear();                                    // l'accès est retiré localement d'abord, quoi qu'il arrive côté réseau
      if (available && s) { try { await doFetch(base + '/auth/v1/logout', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' } }); } catch (e) { /* sans importance : la session locale est supprimée */ } }
      return { ok: true };
    }

    /* Requête authentifiée avec un seul rafraîchissement en cas de jeton expiré. */
    async function authed(path, init) {
      if (!available || !session) return { status: 401, ok: false, body: null, noSession: true };
      let r = await call(path, init, true);
      if (r.status === 401 && await refresh()) r = await call(path, init, true);
      return r;
    }

    async function loadProfile() {
      const r = await authed('/rest/v1/profiles?select=goals,routine_level,prefer_gentle,exclusions&limit=1', { method: 'GET' });
      if (r.noSession || r.status === 401) return { ok: false, error: MSG.sessionExpired };
      if (r.network || !r.ok) return { ok: false, error: MSG.loadFailed };
      const row = Array.isArray(r.body) ? r.body[0] : null;
      return { ok: true, profile: row ? fromRow(row) : null };
    }

    /* Mise à jour de la ligne de l'utilisateur (RLS la limite à la sienne) ; création si elle n'existe pas encore. */
    async function saveProfile(profile) {
      const row = toRow(profile);
      let r = await authed('/rest/v1/profiles', { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
      if (r.noSession || r.status === 401) return { ok: false, error: MSG.sessionExpired };
      if (r.network || !r.ok) return { ok: false, error: MSG.saveFailed };
      if (Array.isArray(r.body) && r.body.length === 0) {
        r = await authed('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
        if (r.network || !r.ok) return { ok: false, error: MSG.saveFailed };
      }
      return { ok: true };
    }

    return { available, restoreSession, signUp, signIn, signOut, loadProfile, saveProfile,
      get user() { return session ? { id: session.user.id, email: session.user.email } : null } };
  }

  return { create, toRow, fromRow, MSG, SESSION_KEY, EMAIL_RE };
});
