'use strict';
/* PROPOSITION « comptes et présence » (supabase/proposals/20261015120000_admin_accounts_presence.sql) exécutée sur un PostgreSQL JETABLE (stubs minimaux de Supabase) :
   rien n'est appliqué à un vrai projet. Ignoré si PostgreSQL est absent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const SQL = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const MIGRATIONS = ['20261006120000_create_profiles.sql', '20261007120000_create_skin_analyses.sql', '20261008120000_analysis_quota.sql', '20261008121000_delete_my_account.sql'].map(f => 'supabase/migrations/' + f);
const OVERVIEW = 'supabase/proposals/20261014120000_admin_overview.sql', PROPOSAL = 'supabase/proposals/20261015120000_admin_accounts_presence.sql', ROLLBACK = 'supabase/proposals/20261015120000_admin_accounts_presence.rollback.sql';
const PORT = 57000 + Math.floor(Math.random() * 900);
const ID = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const F = ID(1), U1 = ID(2), U2 = ID(3), U3 = ID(4), U4 = ID(5);
const asRoot = process.getuid && process.getuid() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-pg-ac-'));
let up = false;
const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };
const wrap = (cmd, args) => asRoot ? ['su', ['postgres', '-c', [cmd, ...args].map(x => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ')]] : [cmd, args];
const sh = (cmd, args, o = {}) => { const [c, a] = wrap(cmd, args); return spawnSync(c, a, Object.assign({ encoding: 'utf8' }, o)); };
const PSQL = ['-h', dir, '-p', String(PORT), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'];
const prelude = ({ role, sub }) => role ? `\\o /dev/null\nset role ${role};\n${sub ? `select set_config('request.jwt.claim.sub', '${sub}', false);\n` : ''}\\o\n` : '';
const clean = out => (out || '').split('\n').filter(l => !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|CREATE [A-Z ]+|GRANT|REVOKE|ALTER [A-Z ]+|COMMENT|DROP [A-Z ]+|DO)$/.test(l.trim())).join('\n').trim();
function psql(sql, o = {}) { const r = sh(path.join(BIN, 'psql'), PSQL, { input: prelude(o) + sql }); return { ok: r.status === 0, out: clean(r.stdout), err: (r.stderr || '').trim() }; }
const accounts = who => psql('select public.admin_accounts();', { role: 'authenticated', sub: who });
const acc = who => { const r = accounts(who); assert.ok(r.ok, r.err); return JSON.parse(r.out.split('\n').pop()); };
const touch = who => psql('select public.touch_presence();', { role: 'authenticated', sub: who });
const ago = s => `now() - interval '${s} seconds'`;

test('AA0 PostgreSQL jetable : le script refuse de s\'appliquer sans admin_users ; puis les propositions dans l\'ordre ; rejouable', live, () => {
  if (asRoot) fs.chmodSync(dir, 0o777);
  let r = sh(path.join(BIN, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust']); assert.equal(r.status, 0, r.stderr);
  r = sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses= -c max_connections=100`, '-l', path.join(dir, 'log'), '-w', 'start']); assert.equal(r.status, 0, r.stderr);
  up = true;
  assert.ok(psql(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`).ok);
  for (const m of MIGRATIONS) { const x = psql(SQL(m)); assert.ok(x.ok, m + ' : ' + x.err); }
  const early = psql(SQL(PROPOSAL)); assert.equal(early.ok, false, 'sans admin_users : refusé'); assert.match(early.err, /Appliquer d'abord .*admin_overview/);
  assert.equal(psql(`select to_regclass('public.user_presence') is null and to_regproc('public.touch_presence') is null;`).out, 't', 'rien n\'a été créé par le refus');
  assert.ok(psql(SQL(OVERVIEW)).ok);
  const p = psql(SQL(PROPOSAL)); assert.ok(p.ok, p.err); assert.ok(psql(SQL(PROPOSAL)).ok, 'rejouable');
  assert.ok(psql(`insert into auth.users (id, email, created_at, last_sign_in_at) values
    ('${F}', 'fondatrice@exemple.com', ${ago(86400 * 100)}, ${ago(60)}), ('${U1}', 'en-ligne@exemple.com', ${ago(86400 * 3)}, ${ago(30)}), ('${U2}', 'quitte@exemple.com', ${ago(86400 * 5)}, ${ago(3600)}),
    ('${U3}', 'jamais@exemple.com', ${ago(86400)}, null), ('${U4}', null, ${ago(7200)}, null);
    insert into public.admin_users (user_id) values ('${F}');`).ok);
});

test('AA1 touch_presence : un compte écrit SA ligne seulement ; anonyme et sans identité refusés ; table fermée ; une écriture au plus toutes les 20 s ; la suppression du compte efface la ligne', live, () => {
  if (!up) return;
  assert.equal(psql('select public.touch_presence();', { role: 'anon' }).ok, false);
  const none = psql('select public.touch_presence();', { role: 'authenticated' }); assert.equal(none.ok, false); assert.match(none.err, /not authenticated/);
  for (const q of ['select * from public.user_presence', `insert into public.user_presence (user_id) values ('${U1}')`, 'update public.user_presence set last_seen = now()', 'delete from public.user_presence']) {
    const r = psql(q + ';', { role: 'authenticated', sub: U1 }); assert.equal(r.ok, false, q); assert.match(r.err, /permission denied/i, q);
  }
  assert.ok(touch(U1).ok); assert.equal(psql(`select count(*) from public.user_presence;`).out, '1'); assert.equal(psql(`select user_id from public.user_presence;`).out, U1);
  assert.ok(touch(U1).ok); assert.equal(psql(`select count(*) from public.user_presence where user_id = '${U1}';`).out, '1', 'une seule ligne par compte');
  assert.ok(psql(`update public.user_presence set last_seen = ${ago(10)} where user_id = '${U1}';`).ok);
  const t10 = psql(`select last_seen from public.user_presence where user_id = '${U1}';`).out;
  assert.ok(touch(U1).ok); assert.equal(psql(`select last_seen from public.user_presence where user_id = '${U1}';`).out, t10, 'appel dans les 20 s : rien n\'est réécrit');
  assert.ok(psql(`update public.user_presence set last_seen = ${ago(30)} where user_id = '${U1}';`).ok);
  assert.ok(touch(U1).ok); assert.equal(psql(`select last_seen > now() - interval '5 seconds' from public.user_presence where user_id = '${U1}';`).out, 't', 'au-delà de 20 s : mise à jour');
  assert.ok(touch(U2).ok); assert.equal(psql(`select count(*) from public.user_presence;`).out, '2');
  assert.ok(psql(`delete from auth.users where id = '${U2}';`).ok); assert.equal(psql(`select count(*) from public.user_presence where user_id = '${U2}';`).out, '0', 'ligne emportée avec le compte');
  assert.ok(psql(`insert into auth.users (id, email, created_at, last_sign_in_at) values ('${U2}', 'quitte@exemple.com', ${ago(86400 * 5)}, ${ago(3600)});`).ok);
});

test('AA2 ACCÈS : admin_accounts est refusée à un compte non listé, sans identité et en anonyme ; autorisée au seul compte de admin_users', live, () => {
  if (!up) return;
  for (const who of [U1, U2, U3]) { const r = accounts(who); assert.equal(r.ok, false, who); assert.match(r.err, /not found/); }
  const none = psql('select public.admin_accounts();', { role: 'authenticated' }); assert.equal(none.ok, false); assert.match(none.err, /not found/);
  const anon = psql('select public.admin_accounts();', { role: 'anon' }); assert.equal(anon.ok, false); assert.match(anon.err, /permission denied/i);
  assert.equal(accounts(F).ok, true);
});

test('AA3 CONTENU : adresses e-mail, en ligne selon la fenêtre de 75 s, jamais vu = hors ligne sans date, ordre (en ligne d\'abord puis activité récente), aucun identifiant interne', live, () => {
  if (!up) return;
  assert.ok(psql(`insert into public.user_presence (user_id, last_seen) values ('${U2}', ${ago(80)}) on conflict (user_id) do update set last_seen = excluded.last_seen;
    update public.user_presence set last_seen = ${ago(10)} where user_id = '${U1}';`).ok);
  const o = acc(F);
  assert.equal(o.v, 1); assert.equal(o.total, 5); assert.equal(o.truncated, false); assert.ok(!Number.isNaN(Date.parse(o.generated_at)));
  assert.deepEqual(o.accounts.map(a => a.email), ['en-ligne@exemple.com', 'fondatrice@exemple.com', 'quitte@exemple.com', null, 'jamais@exemple.com'],
    'ordre : en ligne d\'abord ; puis activité la plus récente (dernière présence, sinon dernière connexion, sinon création) : fondatrice connectée il y a 60 s, quitté il y a 80 s, compte sans e-mail créé il y a 2 h, jamais vu créé il y a 1 jour');
  const by = e => o.accounts.find(a => a.email === e);
  assert.deepEqual([by('en-ligne@exemple.com').online, by('quitte@exemple.com').online, by('fondatrice@exemple.com').online, by('jamais@exemple.com').online], [true, false, false, false]);
  assert.equal(by('jamais@exemple.com').last_seen_at, null, 'jamais vu : pas de date, jamais zéro'); assert.equal(by('jamais@exemple.com').last_sign_in_at, null);
  assert.ok(Date.parse(by('en-ligne@exemple.com').last_seen_at) > Date.now() - 60000);
  for (const a of o.accounts) assert.deepEqual(Object.keys(a).sort(), ['created_at', 'email', 'last_seen_at', 'last_sign_in_at', 'online']);
  const raw = accounts(F).out; for (const id of [F, U1, U2, U3, U4]) assert.ok(!raw.includes(id), 'aucun identifiant interne : ' + id);
  /* limite de 500 comptes les plus récents, indiquée */
  assert.ok(psql(`insert into auth.users (id, email, created_at) select gen_random_uuid(), 'bulk' || g || '@exemple.com', now() - (g || ' minutes')::interval from generate_series(1, 520) g;`).ok);
  const big = acc(F); assert.equal(big.accounts.length, 500); assert.equal(big.total, 525); assert.equal(big.truncated, true);
  assert.ok(psql(`delete from auth.users where email like 'bulk%';`).ok);
});

test('AA4 LECTURE SEULE ET SOBRIÉTÉ : admin_accounts n\'écrit rien (états identiques), est déclarée stable, sans service_role ; la présence ne garde qu\'une date', live, () => {
  if (!up) return;
  const state = () => psql(`select (select count(*) from auth.users) || '/' || (select count(*) from public.user_presence) || '/' || (select count(*) from public.admin_users) || '/' || (select coalesce(sum(extract(epoch from last_seen))::text, '') from public.user_presence);`).out;
  const before = state(); accounts(F); accounts(F); assert.equal(state(), before, 'aucune ligne créée, modifiée ni supprimée');
  const sql = SQL(PROPOSAL), code = sql.replace(/--.*$/gm, '');
  assert.match(code, /create or replace function public\.admin_accounts\(\) returns jsonb\s+language plpgsql stable security definer set search_path = ''/);
  assert.ok(!/service_role/.test(code));
  const body = code.split('create or replace function public.admin_accounts')[1].split('revoke all on function')[0];
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/i.test(body), 'le corps de admin_accounts ne contient aucune écriture');
  assert.deepEqual(psql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'user_presence' order by ordinal_position;`).out.split('\n'), ['user_id', 'last_seen'], 'la présence ne garde qu\'une date par compte : ni page, ni appareil, ni IP');
  assert.equal(psql(`select has_function_privilege('anon', 'public.admin_accounts()', 'execute') || ',' || has_function_privilege('anon', 'public.touch_presence()', 'execute') || ',' || has_function_privilege('authenticated', 'public.touch_presence()', 'execute');`).out, 'false,false,true');
});

test('AA5 RETOUR ARRIÈRE : retire les deux fonctions et la table de présence ; admin_users et admin_overview restent', live, () => {
  if (!up) return;
  const r = psql(SQL(ROLLBACK)); assert.ok(r.ok, r.err);
  assert.equal(psql(`select to_regproc('public.admin_accounts') is null, to_regproc('public.touch_presence') is null, to_regclass('public.user_presence') is null;`).out, 't|t|t');
  assert.equal(psql(`select to_regproc('public.admin_overview') is not null, to_regclass('public.admin_users') is not null;`).out, 't|t');
  assert.ok(psql(SQL(ROLLBACK)).ok, 'rejouable');
});

test.after(() => { if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* sans importance */ } });
