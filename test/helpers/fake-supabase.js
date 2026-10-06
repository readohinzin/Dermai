'use strict';
/* Faux service Supabase en mémoire (GoTrue + PostgREST) pour tester le client de compte sans réseau.
   Il reproduit les garanties qui comptent : l'identité vient du jeton, RLS limite chaque requête à la ligne de l'appelant,
   `user_id` fourni par le client pour un autre compte est refusé, contraintes de la table. La vraie RLS est testée sur PostgreSQL
   dans profiles-db.test.js. */
const METRICS = ['acne', 'pores', 'oiliness', 'texture', 'hydration', 'redness', 'pigmentation', 'wrinkles', 'firmness', 'radiance', 'eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
const ANALYSIS_COLS = ['id', 'user_id', 'analyzed_at', 'global_score', 'skin_type', 'skin_age', 'metrics', 'priorities', 'goals_snapshot', 'engine_version'];
const okScore = v => v === null || (Number.isInteger(v) && v >= 0 && v <= 100);
const GOALS = ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance'];

function createFake({ confirmEmails = false, ttl = 3600 } = {}) {
  const users = new Map();            // email -> { id, email, password, confirmed }
  const profiles = new Map();         // user_id -> ligne
  const analyses = new Map();         // user_id -> lignes de skin_analyses
  const tokens = new Map();           // access_token -> { sub, exp }
  const refresh = new Map();          // refresh_token -> sub
  let n = 0, clock = 1_800_000_000;
  const log = [];
  const state = { now: () => clock, advance: s => { clock += s; }, failNetwork: false, failRest: false, failAuth: false, failAnalyses: false, failAnalysesOnce: 0 };
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
    if (u.pathname === '/rest/v1/skin_analyses') {
      if (state.failRest || state.failAnalyses) return resp(500, { message: 'relation "public.skin_analyses" does not exist', code: '42P01' });
      if (state.failAnalysesOnce > 0) { state.failAnalysesOnce--; throw new TypeError('network'); }
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { message: 'JWT expired', code: 'PGRST301' });
      const mine = analyses.get(t.sub) || [], method = init.method || 'GET';
      if (method === 'GET') {
        const lim = Number(u.searchParams.get('limit')) || 1000, off = Number(u.searchParams.get('offset')) || 0, desc = /desc/.test(u.searchParams.get('order') || '');
        state.listCalls = (state.listCalls || 0) + 1;
        const sorted = [...mine].sort((a, b) => (Date.parse(a.analyzed_at) - Date.parse(b.analyzed_at)) || (a.id < b.id ? -1 : 1));
        if (desc) sorted.reverse();
        return resp(200, sorted.slice(off, off + lim).map(r => Object.assign({}, r, { user_id: undefined })));   // user_id n'est jamais lu (colonnes demandées seulement)
      }
      if (method === 'DELETE') {
        if (!u.search) return resp(400, { code: '21000', message: 'DELETE requires a WHERE clause' });
        analyses.set(t.sub, []); return resp(204);                                  // RLS : seulement les lignes de l'appelant
      }
      if (method === 'POST') {
        if (body.user_id && body.user_id !== t.sub) return resp(403, { code: '42501', message: 'new row violates row-level security policy' });
        if (Object.keys(body).some(k => !ANALYSIS_COLS.includes(k))) return resp(400, { code: 'PGRST204', message: 'unknown column' });
        const m = body.metrics;
        if (!m || typeof m !== 'object' || Array.isArray(m) || Object.entries(m).some(([k, v]) => !METRICS.includes(k) || !okScore(v))) return resp(400, { code: '23514', message: 'violates check constraint' });
        if (!okScore(body.global_score === undefined ? null : body.global_score) || !body.engine_version) return resp(400, { code: '23514', message: 'violates check constraint' });
        if (Array.isArray(body.priorities) && body.priorities.some(p => !METRICS.includes(p.id) || !p.label || Object.keys(p).some(k => !['id', 'label', 'score', 'band'].includes(k)))) return resp(400, { code: '23514', message: 'violates check constraint' });
        if (Array.isArray(body.goals_snapshot) && (body.goals_snapshot.length > 3 || body.goals_snapshot.some(g => !GOALS.includes(g)))) return resp(400, { code: '23514', message: 'violates check constraint' });
        const dup = body.id && Object.values([...analyses.values()].flat()).some(x => x.id === body.id);
        if (dup) return /resolution=ignore-duplicates/.test(h.prefer || '') ? resp(201) : resp(409, { code: '23505', message: 'duplicate key' });
        const row = Object.assign({ id: 'an-' + (++n), analyzed_at: new Date(clock * 1000).toISOString(), priorities: [], goals_snapshot: [] }, body, { user_id: t.sub });
        analyses.set(t.sub, [...mine, row]); return resp(201);
      }
    }
    return resp(404, { message: 'not found' });
  }
  return { fetch: fetchImpl, state, users, profiles, analyses, tokens, refresh, log, GOALS, METRICS,
    removeProfile: id => profiles.delete(id) };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, dump: () => Object.fromEntries(m) };
}
module.exports = { createFake, memoryStorage, GOALS };
