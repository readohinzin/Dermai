'use strict';
/* PROPOSITION de migration du quota d\'essayages de maquillage (supabase/proposals/20261012120000_makeup_quota.sql) exécutée sur un PostgreSQL JETABLE
   (stubs minimaux de Supabase) : rien n'est appliqué à un vrai projet. Ignoré si PostgreSQL est absent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const SQL = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MIGRATIONS = ['20261006120000_create_profiles.sql', '20261007120000_create_skin_analyses.sql', '20261008120000_analysis_quota.sql', '20261008121000_delete_my_account.sql'].map(f => 'supabase/migrations/' + f);
const PORT = 55000 + Math.floor(Math.random() * 900);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const asRoot = process.getuid && process.getuid() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-pg-mk-'));
let up = false;
const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };
const wrap = (cmd, args) => asRoot ? ['su', ['postgres', '-c', [cmd, ...args].map(x => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ')]] : [cmd, args];
const sh = (cmd, args, o = {}) => { const [c, a] = wrap(cmd, args); return spawnSync(c, a, Object.assign({ encoding: 'utf8' }, o)); };
const PSQL = ['-h', dir, '-p', String(PORT), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'];
const prelude = ({ role, sub }) => role ? `\\o /dev/null\nset role ${role};\n${sub ? `select set_config('request.jwt.claim.sub', '${sub}', false);\n` : ''}\\o\n` : '';
const clean = out => (out || '').split('\n').filter(l => !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|CREATE [A-Z ]+|GRANT|REVOKE|ALTER [A-Z ]+|COMMENT|DROP [A-Z ]+)$/.test(l.trim())).join('\n').trim();
function psql(sql, o = {}) { const r = sh(path.join(BIN, 'psql'), PSQL, { input: prelude(o) + sql }); return { ok: r.status === 0, out: clean(r.stdout), err: (r.stderr || '').trim() }; }
function psqlAsync(sql, o = {}) {
  return new Promise(resolve => {
    const [c, a] = wrap(path.join(BIN, 'psql'), PSQL);
    const p = spawn(c, a); let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ ok: code === 0, out: clean(out), err: err.trim() }));
    p.stdin.end(prelude(o) + sql);
  });
}
const sim = (who, limit, win) => psql(`select public.reserve_makeup(${limit}, ${win});`, { role: 'authenticated', sub: who });
const ana = (who, limit, win) => psql(`select public.reserve_analysis(${limit}, ${win});`, { role: 'authenticated', sub: who });
const rj = r => { assert.ok(r.ok, r.err); return JSON.parse(r.out.split('\n').pop()); };

test('MQ0 PostgreSQL jetable, migrations existantes, puis la PROPOSITION', live, () => {
  if (asRoot) fs.chmodSync(dir, 0o777);
  let r = sh(path.join(BIN, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust']); assert.equal(r.status, 0, r.stderr);
  r = sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses= -c max_connections=100`, '-l', path.join(dir, 'log'), '-w', 'start']); assert.equal(r.status, 0, r.stderr);
  up = true;
  assert.ok(psql(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`).ok);
  for (const m of MIGRATIONS) { const x = psql(SQL(m)); assert.ok(x.ok, m + ' : ' + x.err); }
  assert.equal(psql(`select to_regproc('public.reserve_makeup') is null;`).out, 't', 'avant la proposition : la fonction n\'existe pas (échec fermé côté serveur)');
  const p = psql(SQL('supabase/proposals/20261012120000_makeup_quota.sql')); assert.ok(p.ok, p.err);
  assert.ok(psql(`insert into auth.users values ('${A}', 'a@exemple.com'), ('${B}', 'b@exemple.com');`).ok);
});

test('MQ1 réservation puis refus avec délai ; le refus n\'insère rien ; le compteur est DISTINCT de celui des analyses', live, () => {
  if (!up) return;
  assert.deepEqual([1, 2].map(() => rj(sim(A, 2, 3600)).ok), [true, true]);
  const over = rj(sim(A, 2, 3600)); assert.equal(over.ok, false); assert.ok(over.retry_after > 3000 && over.retry_after <= 3600);
  assert.equal(psql(`select count(*) from public.makeup_usage where user_id = '${A}';`).out, '2');
  assert.equal(psql(`select count(*) from public.analysis_usage where user_id = '${A}';`).out, '0', 'aucune analyse consommée');
  assert.equal(rj(ana(A, 3, 3600)).ok, true, 'les essayages ne consomment pas les analyses');
  assert.equal(psql(`select count(*) from public.makeup_usage where user_id = '${A}';`).out, '2', 'et les analyses ne comptent pas comme essayages');
});

test('MQ2 ATOMICITÉ : 10 requêtes réellement simultanées, quota de 2 → exactement 2 acceptées', live, async () => {
  if (!up) return;
  const C = '33333333-3333-3333-3333-333333333333';
  assert.ok(psql(`insert into auth.users values ('${C}', 'c@exemple.com');`).ok);
  const runs = await Promise.all(Array.from({ length: 10 }, () => psqlAsync(`select public.reserve_makeup(2, 3600);`, { role: 'authenticated', sub: C })));
  assert.ok(runs.every(r => r.ok), runs.map(r => r.err).join('|'));
  assert.equal(runs.map(r => JSON.parse(r.out.split('\n').pop())).filter(x => x.ok).length, 2);
  assert.equal(psql(`select count(*) from public.makeup_usage where user_id = '${C}';`).out, '2');
});

test('MQ3 isolation et droits : pas d\'accès direct à la table, anonyme et sans identité refusés, un compte n\'entame pas le quota d\'un autre', live, () => {
  if (!up) return;
  assert.equal(rj(sim(B, 1, 3600)).ok, true, 'le quota épuisé par A ne touche pas B');
  for (const q of ['select * from public.makeup_usage', `insert into public.makeup_usage (user_id) values ('${B}')`, 'update public.makeup_usage set used_at = now()', 'delete from public.makeup_usage']) {
    const r = psql(q + ';', { role: 'authenticated', sub: B }); assert.equal(r.ok, false, q); assert.match(r.err, /permission denied/i, q);
  }
  assert.equal(psql('select public.reserve_makeup(1, 3600);', { role: 'anon' }).ok, false);
  const noId = psql('select public.reserve_makeup(1, 3600);', { role: 'authenticated' }); assert.equal(noId.ok, false); assert.match(noId.err, /not authenticated/);
});

test('MQ4 paramètres bornés ; quota nul = tout refusé ; plafond de stockage ; la période glisse', live, () => {
  if (!up) return;
  const F = '66666666-6666-6666-6666-666666666666';
  assert.ok(psql(`insert into auth.users values ('${F}', 'f@exemple.com');`).ok);
  for (const [l, w] of [[-1, 3600], [101, 3600], [1, 59], [1, 31536001]]) assert.equal(sim(F, l, w).ok, false, `${l}/${w}`);
  assert.equal(rj(sim(F, 0, 3600)).ok, false);
  assert.ok(psql(`insert into public.makeup_usage (user_id, used_at) values ('${F}', now() - interval '2 hours');`).ok);
  assert.equal(rj(sim(F, 1, 3600)).ok, true, 'hors période : seule la nouvelle compte');
  assert.equal(rj(sim(F, 1, 3600)).ok, false);
  assert.ok(psql(`insert into public.makeup_usage (user_id, used_at) select '${F}', now() - interval '2 days' from generate_series(1, 2000);`).ok);
  assert.equal(rj(sim(F, 100, 3600)).ok, false, 'plafond de 2000 lignes par compte');
});

test('MQ5 la suppression du compte emporte les lignes d\'essayage', live, () => {
  if (!up) return;
  const G = '77777777-7777-7777-7777-777777777777';
  assert.ok(psql(`insert into auth.users values ('${G}', 'g@exemple.com');`).ok);
  assert.equal(rj(sim(G, 1, 3600)).ok, true);
  assert.ok(psql('select public.delete_my_account();', { role: 'authenticated', sub: G }).ok);
  assert.equal(psql(`select count(*) from public.makeup_usage where user_id = '${G}';`).out, '0');
});

test('MQ7 additive, réversible, rejouable : seuls 4 objets nouveaux ; essai à blanc dans une transaction ; annulation propre ; le quota d\'analyses est intact', live, () => {
  if (!up) return;
  const snap = () => psql(`select string_agg(x, ',' order by x) from (
    select 'r:' || relname as x from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'public'
    union all select 'f:' || proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'public'
    union all select 'p:' || polname from pg_policy) t;`).out.split(',');
  const PROP = SQL('supabase/proposals/20261012120000_makeup_quota.sql'), ROLL = SQL('supabase/proposals/20261012120000_makeup_quota.rollback.sql');
  const applied = snap();
  const aBefore = psql('select count(*) from public.analysis_usage;').out;
  assert.ok(psql(ROLL).ok);
  const base = snap();
  assert.deepEqual(applied.filter(x => !base.includes(x)), ['f:reserve_makeup', 'r:makeup_usage', 'r:makeup_usage_pkey', 'r:makeup_usage_user_used_idx'], 'la proposition ne crée que ces objets');
  assert.deepEqual(base.filter(x => !applied.includes(x)), [], 'et ne retire ni ne remplace rien d\'existant');
  assert.equal(psql('select count(*) from public.analysis_usage;').out, aBefore, 'analysis_usage intacte après annulation');
  assert.equal(rj(ana(A, 1000, 3600)).ok, true, 'reserve_analysis fonctionne toujours');
  assert.equal(sim(A, 1, 3600).ok, false, 'sans la fonction : refus (le serveur répond « indisponible »)');
  // essai à blanc : tout dans une transaction annulée, rien ne reste
  const dry = psql(`begin;\n${PROP}\nselect set_config('request.jwt.claim.sub', '${A}', true);\nselect public.reserve_makeup(1, 60) is not null;\nrollback;`);
  assert.ok(dry.ok, dry.err);
  assert.deepEqual(snap(), base, 'l\'essai à blanc ne laisse aucune trace');
  // application réelle, deux fois (rejouable), puis le test continue sur l'état appliqué
  assert.ok(psql(PROP).ok); assert.ok(psql(PROP).ok, 'rejouable sans erreur');
  assert.deepEqual(snap(), applied);
});

test('MQ6 la proposition n\'est PAS dans supabase/migrations/ (aucune application automatique)', () => {
  assert.ok(!fs.readdirSync(path.join(__dirname, '..', 'supabase/migrations')).some(f => /simul/i.test(f)));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase/proposals/20261012120000_makeup_quota.sql')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'supabase/proposals/20261012120000_makeup_quota.rollback.sql')));
});

test.after(() => { if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* sans importance */ } });
