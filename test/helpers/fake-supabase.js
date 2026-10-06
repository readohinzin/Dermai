'use strict';
/* Faux service Supabase en mémoire (GoTrue + PostgREST) pour tester le client de compte sans réseau.
   Il reproduit les garanties qui comptent : l'identité vient du jeton, RLS limite chaque requête à la ligne de l'appelant,
   `user_id` fourni par le client pour un autre compte est refusé, contraintes de la table. La vraie RLS est testée sur PostgreSQL
   dans profiles-db.test.js. */
const GOALS = ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance'];

function createFake({ confirmEmails = false, ttl = 3600 } = {}) {
  const users = new Map();            // email -> { id, email, password, confirmed }
  const profiles = new Map();         // user_id -> ligne
  const tokens = new Map();           // access_token -> { sub, exp }
  const refresh = new Map();          // refresh_token -> sub
  let n = 0, clock = 1_800_000_000;
  const log = [];
  const state = { now: () => clock, advance: s => { clock += s; }, failNetwork: false, failRest: false, failAuth: false };
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const mkSession = u => {
    const access = 'at-' + (++n), rt = 'rt-' + (++n);
    tokens.set(access, { sub: u.id, exp: clock + ttl }); refresh.set(rt, u.id);
    return { access_token: access, refresh_token: rt, expires_in: ttl, expires_at: clock + ttl, token_type: 'bearer', user: { id: u.id, email: u.email } };
  };
  const newProfile = id => ({ id: 'p-' + id, user_id: id, goals: [], routine_level: null, prefer_gentle: false, exclusions: [], created_at: clock, updated_at: clock });
  const valid = r => (!Array.isArray(r.goals) || (r.goals.length <= 3 && r.goals.every(g => GOALS.includes(g))))
    && (r.routine_level === undefined || r.routine_level === null || ['none', 'simple', 'full'].includes(r.routine_level));

  async function fetchImpl(url, init = {}) {
    if (state.failNetwork) throw new TypeError('network');
    const u = new URL(url), h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method: init.method || 'GET', path: u.pathname + u.search, headers: h, body });
    if (!h.apikey) return resp(401, { message: 'No API key' });
    if (state.failAuth && u.pathname.startsWith('/auth')) return resp(500, { message: 'internal db trace' });
    if (u.pathname === '/auth/v1/signup') {
      if (users.has(body.email)) return resp(422, { error_code: 'user_already_exists', msg: 'User already registered' });
      if (!body.password || body.password.length < 6) return resp(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters' });
      const user = { id: 'u-' + (++n), email: body.email, password: body.password, confirmed: !confirmEmails };
      users.set(body.email, user); profiles.set(user.id, newProfile(user.id));     // déclencheur de création du profil
      return resp(200, confirmEmails ? { id: user.id, email: user.email } : mkSession(user));
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      const user = users.get(body.email);
      if (!user || user.password !== body.password) return resp(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      if (!user.confirmed) return resp(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
      return resp(200, mkSession(user));
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      const sub = refresh.get(body.refresh_token);
      if (!sub) return resp(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(body.refresh_token);
      return resp(200, mkSession([...users.values()].find(x => x.id === sub)));
    }
    if (u.pathname === '/auth/v1/logout') {
      const t = (h.authorization || '').replace('Bearer ', ''); tokens.delete(t); return resp(204);
    }
    if (u.pathname === '/rest/v1/profiles') {
      if (state.failRest) return resp(500, { message: 'relation "public.profiles" does not exist', code: '42P01' });
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { message: 'JWT expired', code: 'PGRST301' });
      const own = profiles.get(t.sub);                                              // RLS : jamais d'autre ligne que celle de l'appelant
      const method = init.method || 'GET';
      if (method === 'GET') return resp(200, own ? [{ goals: own.goals, routine_level: own.routine_level, prefer_gentle: own.prefer_gentle, exclusions: own.exclusions }] : []);
      if (body && body.user_id && body.user_id !== t.sub) return resp(403, { code: '42501', message: 'new row violates row-level security policy for table "profiles"' });
      if (!valid(body)) return resp(400, { code: '23514', message: 'violates check constraint' });
      if (method === 'PATCH') {
        if (!u.search) return resp(400, { code: '21000', message: 'UPDATE requires a WHERE clause' });   // comme le vrai service (extension safeupdate)
        if (!own) return resp(200, []);
        Object.assign(own, body, { updated_at: clock }); return resp(200, [own]);
      }
      if (method === 'POST') {
        if (own) return resp(409, { code: '23505', message: 'duplicate key' });
        profiles.set(t.sub, Object.assign(newProfile(t.sub), body)); return resp(201);
      }
    }
    return resp(404, { message: 'not found' });
  }
  return { fetch: fetchImpl, state, users, profiles, tokens, log, GOALS,
    removeProfile: id => profiles.delete(id) };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, dump: () => Object.fromEntries(m) };
}
module.exports = { createFake, memoryStorage, GOALS };
