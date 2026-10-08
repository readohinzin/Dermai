'use strict';
/* Faux service Supabase en mémoire (GoTrue + PostgREST) pour tester le client de compte sans réseau.
   Il reproduit les garanties qui comptent : l'identité vient du jeton, RLS limite chaque requête à la ligne de l'appelant,
   `user_id` fourni par le client pour un autre compte est refusé, contraintes de la table. La vraie RLS est testée sur PostgreSQL
   dans profiles-db.test.js. */
const METRICS = ['acne', 'pores', 'oiliness', 'texture', 'hydration', 'redness', 'pigmentation', 'wrinkles', 'firmness', 'radiance', 'eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
const ANALYSIS_COLS = ['id', 'user_id', 'analyzed_at', 'global_score', 'skin_type', 'skin_age', 'metrics', 'priorities', 'goals_snapshot', 'engine_version'];
const okRaw = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;   // raw_metrics (migration 20261009120000)
const okScore = v => v === null || (Number.isInteger(v) && v >= 0 && v <= 100);
const GOALS = ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance'];

function createFake({ confirmEmails = false, ttl = 3600 } = {}) {
  const users = new Map();            // email -> { id, email, password, confirmed }
  const profiles = new Map();         // user_id -> ligne
  const usage = new Map();            // user_id -> horodatages (secondes) des analyses réservées (quota)
  const analyses = new Map();         // user_id -> lignes de skin_analyses
  const tokens = new Map();           // access_token -> { sub, exp }
  const refresh = new Map();          // refresh_token -> sub
  let n = 0, clock = 1_800_000_000;
  const log = [];
  const state = { now: () => clock, advance: s => { clock += s; }, failNetwork: false, failRest: false, failAuth: false, failAnalyses: false, failAnalysesOnce: 0, failAuthUser: false, failQuota: false, quotaMissing: false, failDelete: false, rateLimit: false, rawColumn: true, photosColumn: true, photoBucket: true, failStorage: false };
  /* Storage (bucket privé scan-photos, migration 20261010120000) : chemin → { size, type }. Comme le vrai service, la suppression du
     compte en base n'efface PAS ces fichiers : c'est au client de les supprimer avant. */
  const objects = new Map();   // rawColumn : false = migration raw_metrics pas encore appliquée
  const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const mkSession = u => {
    const access = 'at-' + (++n) + '.pl-' + n + '.sg-' + n, rt = 'rt-' + (++n);
    tokens.set(access, { sub: u.id, exp: clock + ttl }); refresh.set(rt, u.id);
    return { access_token: access, refresh_token: rt, expires_in: ttl, expires_at: clock + ttl, token_type: 'bearer', user: { id: u.id, email: u.email } };
  };
  const newProfile = id => ({ id: 'p-' + id, user_id: id, goals: [], routine_level: null, prefer_gentle: false, exclusions: [], keep_photos: null, created_at: clock, updated_at: clock });
  const valid = r => (!Array.isArray(r.goals) || (r.goals.length <= 3 && r.goals.every(g => GOALS.includes(g))))
    && (r.routine_level === undefined || r.routine_level === null || ['none', 'simple', 'full'].includes(r.routine_level))
    && (r.keep_photos === undefined || r.keep_photos === null || typeof r.keep_photos === 'boolean');

  async function fetchImpl(url, init = {}) {
    if (state.failNetwork) throw new TypeError('network');
    const u = new URL(url), h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = init.body, isText = typeof raw === 'string';
    const body = raw && isText ? JSON.parse(raw) : null;
    log.push({ method: init.method || 'GET', path: u.pathname + u.search, headers: h, body: isText ? body : raw ? { binary: true, size: raw.size, type: raw.type } : null });
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
    if (u.pathname === '/auth/v1/user') {                                              // vérification d'un jeton (GoTrue : GET /user) et changement de mot de passe (PUT)
      if (state.failAuthUser) return resp(500, { message: 'internal db trace' });
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      const user = [...users.values()].find(x => x.id === t.sub);
      if (!user) return resp(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
      if ((init.method || 'GET') === 'PUT') {
        if (!body || typeof body.password !== 'string' || body.password.length < 6) return resp(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters' });
        if (body.password === user.password) return resp(422, { error_code: 'same_password', msg: 'New password should be different from the old password.' });
        user.password = body.password; log[log.length - 1].body = { password: '<masqué>' }; return resp(200, { id: user.id, email: user.email });
      }
      return resp(200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' });
    }
    if (u.pathname === '/auth/v1/recover') {                                           // toujours 200, que l'adresse existe ou non (comme GoTrue)
      state.recoverRequests = (state.recoverRequests || []).concat(body && body.email);
      if (state.rateLimit) return resp(429, { error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' });
      return resp(200, {});
    }
    if (u.pathname === '/auth/v1/resend') {
      state.resendRequests = (state.resendRequests || []).concat(body && body.email);
      if (state.rateLimit) return resp(429, { error_code: 'over_email_send_rate_limit', msg: 'email rate limit exceeded' });
      return resp(200, {});
    }
    if (u.pathname === '/rest/v1/rpc/delete_my_account') {                              // équivalent de la fonction SQL : l'appelant seulement, en cascade
      if (state.failDelete) return resp(500, { message: 'internal db trace', code: 'XX000' });
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { message: 'JWT expired', code: 'PGRST301' });
      for (const [email, usr] of users) if (usr.id === t.sub) users.delete(email);
      profiles.delete(t.sub); analyses.delete(t.sub); usage.delete(t.sub);
      return resp(204);
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
      const sel = (u.searchParams.get('select') || '').split(',');
      if (!state.photosColumn && (sel.includes('keep_photos') || (body && 'keep_photos' in body)))
        return method === 'GET' ? resp(400, { code: '42703', message: 'column profiles.keep_photos does not exist' }) : resp(400, { code: 'PGRST204', message: "Could not find the 'keep_photos' column of 'profiles' in the schema cache" });
      if (method === 'GET') return resp(200, own ? [Object.assign({ goals: own.goals, routine_level: own.routine_level, prefer_gentle: own.prefer_gentle, exclusions: own.exclusions }, sel.includes('keep_photos') ? { keep_photos: own.keep_photos === undefined ? null : own.keep_photos } : {})] : []);
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
    if (u.pathname === '/rest/v1/rpc/reserve_analysis') {                              // réservation atomique du quota (équivalent de la fonction SQL)
      if (state.quotaMissing) return resp(404, { code: 'PGRST202', message: 'Could not find the function public.reserve_analysis' });
      if (state.failQuota) return resp(500, { message: 'internal db trace', code: 'XX000' });
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { message: 'JWT expired', code: 'PGRST301' });
      if (!body || !Number.isInteger(body.p_limit) || body.p_limit < 0 || body.p_limit > 1000 || !Number.isInteger(body.p_window_seconds) || body.p_window_seconds < 60) return resp(400, { code: '22023', message: 'invalid parameters' });
      const rows = usage.get(t.sub) || [], within = rows.filter(x => x > clock - body.p_window_seconds);
      if (within.length >= body.p_limit) return resp(200, { ok: false, used: within.length, limit: body.p_limit, retry_after: Math.max(1, Math.min(...within) + body.p_window_seconds - clock) });
      usage.set(t.sub, [...rows, clock]); return resp(200, { ok: true, used: within.length + 1, limit: body.p_limit });
    }
    if (u.pathname === '/rest/v1/skin_analyses') {
      if (state.failRest || state.failAnalyses) return resp(500, { message: 'relation "public.skin_analyses" does not exist', code: '42P01' });
      if (state.failAnalysesOnce > 0) { state.failAnalysesOnce--; throw new TypeError('network'); }
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(401, { message: 'JWT expired', code: 'PGRST301' });
      const mine = analyses.get(t.sub) || [], method = init.method || 'GET';
      if (method === 'GET') {
        const cols = (u.searchParams.get('select') || '').split(',');
        if (cols.includes('raw_metrics') && !state.rawColumn) return resp(400, { code: '42703', message: 'column skin_analyses.raw_metrics does not exist' });
        const lim = Number(u.searchParams.get('limit')) || 1000, off = Number(u.searchParams.get('offset')) || 0, desc = /desc/.test(u.searchParams.get('order') || '');
        state.listCalls = (state.listCalls || 0) + 1;
        const sorted = [...mine].sort((a, b) => (Date.parse(a.analyzed_at) - Date.parse(b.analyzed_at)) || (a.id < b.id ? -1 : 1));
        if (desc) sorted.reverse();
        return resp(200, sorted.slice(off, off + lim).map(r => { const o = Object.assign({}, r, { user_id: undefined }); if (!cols.includes('raw_metrics')) delete o.raw_metrics; else if (!o.raw_metrics) o.raw_metrics = {}; return o; }));   // user_id n'est jamais lu (colonnes demandées seulement)
      }
      if (method === 'DELETE') {
        if (!u.search) return resp(400, { code: '21000', message: 'DELETE requires a WHERE clause' });
        analyses.set(t.sub, []); return resp(204);                                  // RLS : seulement les lignes de l'appelant
      }
      if (method === 'POST') {
        if (body.user_id && body.user_id !== t.sub) return resp(403, { code: '42501', message: 'new row violates row-level security policy' });
        const cols = state.rawColumn ? [...ANALYSIS_COLS, 'raw_metrics'] : ANALYSIS_COLS, unknown = Object.keys(body).find(k => !cols.includes(k));
        if (unknown) return resp(400, { code: 'PGRST204', message: `Could not find the '${unknown}' column of 'skin_analyses' in the schema cache` });
        const rm = body.raw_metrics;
        if (rm !== undefined && (!rm || typeof rm !== 'object' || Array.isArray(rm) || Object.entries(rm).some(([k, v]) => !METRICS.includes(k) || !okRaw(v)))) return resp(400, { code: '23514', message: 'violates check constraint' });
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
    if (u.pathname.startsWith('/storage/v1/object')) {
      if (state.failStorage) return resp(500, { statusCode: '500', error: 'internal', message: 'internal storage trace' });
      const t = tokens.get((h.authorization || '').replace('Bearer ', ''));
      if (!t || t.exp <= clock) return resp(400, { statusCode: '403', error: 'Unauthorized', message: 'jwt expired' });
      const BUCKET = 'scan-photos', method = init.method || 'GET', mine = p => p.split('/')[0] === t.sub;   // RLS : dossier = auth.uid()
      const m = u.pathname.match(/^\/storage\/v1\/object\/(?:(list|sign)\/)?([^/]+)(?:\/(.*))?$/);
      if (!m) return resp(404, { message: 'not found' });
      const [, op, bucket, rest] = m;
      if (bucket !== BUCKET || !state.photoBucket) return resp(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (op === 'list' && method === 'POST') {
        const prefix = String(body && body.prefix || '').replace(/\/$/, '');
        if (prefix.includes('/') || !mine(prefix + '/')) return resp(200, []);                                    // RLS : rien d'un autre dossier
        return resp(200, [...objects.keys()].filter(k => k.startsWith(prefix + '/')).map(k => ({ name: k.slice(prefix.length + 1), metadata: { size: objects.get(k).size } })));
      }
      if (op === 'sign' && method === 'POST') {
        return resp(200, (body.paths || []).map(p => (mine(p) && objects.has(p))
          ? { path: p, signedURL: '/object/sign/' + BUCKET + '/' + p + '?token=sig-' + (++n), error: null }
          : { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }));
      }
      if (!op && method === 'POST' && rest) {
        if (!mine(rest)) return resp(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
        if (objects.has(rest)) return resp(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        if (h['content-type'] !== 'image/jpeg' || !raw || typeof raw.size !== 'number') return resp(400, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type not supported' });
        if (raw.size > 4 * 1024 * 1024) return resp(400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
        objects.set(rest, { size: raw.size, type: 'image/jpeg', owner: t.sub, blob: raw }); return resp(200, { Key: BUCKET + '/' + rest });
      }
      if (!op && method === 'DELETE') {
        const gone = (body && body.prefixes || []).filter(p => mine(p) && objects.has(p));
        gone.forEach(p => objects.delete(p)); return resp(200, gone.map(p => ({ name: p })));
      }
      return resp(400, { statusCode: '400', error: 'invalid', message: 'invalid request' });
    }
    return resp(404, { message: 'not found' });
  }
  /* Lien reçu par e-mail : confirme l'adresse (type signup) ou ouvre une session de récupération (type recovery). */
  const link = (email, type) => {
    const u = users.get(email); if (!u) return '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    if (type === 'signup') { u.confirmed = true; profiles.set(u.id, profiles.get(u.id) || newProfile(u.id)); }
    const sess = mkSession(u);
    return `#access_token=${sess.access_token}&expires_in=3600&refresh_token=${sess.refresh_token}&token_type=bearer&type=${type}`;
  };
  return { fetch: fetchImpl, state, objects, confirmLink: e => link(e, 'signup'), recoveryLink: e => link(e, 'recovery'), users, profiles, analyses, usage, tokens, refresh, log, GOALS, METRICS,
    removeProfile: id => profiles.delete(id) };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, dump: () => Object.fromEntries(m) };
}
module.exports = { createFake, memoryStorage, GOALS };
