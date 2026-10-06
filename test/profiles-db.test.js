'use strict';
/* Migration `profiles` + RLS exécutées sur un vrai PostgreSQL jetable (stubs minimaux de Supabase : rôles anon/authenticated, auth.users, auth.uid()).
   Ignoré (avec message) si PostgreSQL n'est pas installé sur la machine. Aucune donnée n'est conservée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const MIGRATION = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261006120000_create_profiles.sql'), 'utf8');
const PORT = 54000 + Math.floor(Math.random() * 900);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const asRoot = process.getuid && process.getuid() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-pg-'));
let up = false;

const sh = (cmd, args, o = {}) => { const full = asRoot ? ['su', ['postgres', '-c', [cmd, ...args].map(x => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ')]] : [cmd, args]; return spawnSync(full[0], full[1], Object.assign({ encoding: 'utf8' }, o)); };
function psql(sql, { role, sub } = {}) {
  const pre = role ? `\\o /dev/null\nset role ${role};\n${sub ? `select set_config('request.jwt.claim.sub', '${sub}', false);\n` : ''}\\o\n` : '';
  const r = sh(path.join(BIN, 'psql'), ['-h', dir, '-p', String(PORT), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'], { input: pre + sql });
  const out = (r.stdout || '').split('\n').filter(l => !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|CREATE [A-Z ]+|GRANT|REVOKE|ALTER [A-Z ]+|COMMENT|DROP [A-Z ]+)$/.test(l.trim())).join('\n').trim();
  return { ok: r.status === 0, out, err: (r.stderr || '').trim() };
}

test('DB0 démarrage d\'un PostgreSQL jetable et application de la migration', { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' }, () => {
  if (asRoot) fs.chmodSync(dir, 0o777);
  let r = sh(path.join(BIN, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust']);
  assert.equal(r.status, 0, r.stderr);
  r = sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses=`, '-l', path.join(dir, 'log'), '-w', 'start']);
  assert.equal(r.status, 0, r.stderr);
  up = true;
  const stub = `
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`;
  assert.ok(psql(stub).ok);
  const m = psql(MIGRATION);
  assert.ok(m.ok, m.err);
  assert.ok(psql(`insert into auth.users values ('${A}', 'a@exemple.com'), ('${B}', 'b@exemple.com');`).ok);
});

const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };

test('DB1 création du profil à l\'inscription : valeurs neutres, aucun objectif, aucune photo', live, () => {
  if (!up) return;
  const r = psql(`select goals, routine_level is null, prefer_gentle, exclusions from public.profiles where user_id = '${A}';`);
  assert.equal(r.out, '{}|t|f|{}');
  const cols = psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='profiles';`).out;
  assert.equal(cols, 'id,user_id,goals,routine_level,prefer_gentle,exclusions,created_at,updated_at');
  assert.doesNotMatch(cols, /photo|mask|task|image|url|raw/);
});

test('DB2 un utilisateur lit et modifie son propre profil', live, () => {
  if (!up) return;
  const own = psql(`select count(*) from public.profiles;`, { role: 'authenticated', sub: A });
  assert.equal(own.out, '1');
  const upd = psql(`update public.profiles set goals = array['hydration','tone'], routine_level = 'simple', prefer_gentle = true returning goals;`, { role: 'authenticated', sub: A });
  assert.ok(upd.ok, upd.err);
  assert.match(upd.out, /hydration,tone/);
  assert.equal(psql(`select prefer_gentle from public.profiles;`, { role: 'authenticated', sub: A }).out, 't');
  assert.ok(psql(`select updated_at > created_at from public.profiles;`, { role: 'authenticated', sub: A }).out === 't');
});

test('DB3 un utilisateur ne lit ni ne modifie le profil d\'un autre (RLS)', live, () => {
  if (!up) return;
  assert.equal(psql(`select count(*) from public.profiles where user_id = '${A}';`, { role: 'authenticated', sub: B }).out, '0');
  assert.equal(psql(`select goals from public.profiles;`, { role: 'authenticated', sub: B }).out, '{}', 'B ne voit que sa ligne, vide');
  const upd = psql(`with u as (update public.profiles set goals = array['texture'] where user_id = '${A}' returning 1) select count(*) from u;`, { role: 'authenticated', sub: B });
  assert.equal(upd.out, '0');
  assert.equal(psql(`select goals from public.profiles where user_id = '${A}';`, { role: 'authenticated', sub: A }).out, '{hydration,tone}');
});

test('DB4 écrire pour le compte d\'un autre est refusé ; user_id ne peut pas être détourné', live, () => {
  if (!up) return;
  const ins = psql(`insert into public.profiles (user_id) values ('${A}');`, { role: 'authenticated', sub: B });
  assert.equal(ins.ok, false);
  assert.match(ins.err, /row-level security|duplicate key|violates/i);
  const steal = psql(`update public.profiles set user_id = '${A}';`, { role: 'authenticated', sub: B });
  assert.equal(steal.ok, false);
  const C = '33333333-3333-3333-3333-333333333333';
  assert.ok(psql(`insert into auth.users values ('${C}', 'c@exemple.com');`).ok);
  psql(`delete from public.profiles where user_id = '${C}';`);
  const forged = psql(`insert into public.profiles (user_id) values ('${A}');`, { role: 'authenticated', sub: C });
  assert.equal(forged.ok, false);
  const own = psql(`insert into public.profiles (goals) values ('{}') returning user_id;`, { role: 'authenticated', sub: C });
  assert.ok(own.ok, own.err);
  assert.equal(own.out.split('\n')[0], C, 'user_id vient de auth.uid(), pas du client');
});

test('DB5 visiteur anonyme ou sans jeton : aucun accès ; suppression directe interdite', live, () => {
  if (!up) return;
  assert.equal(psql(`select * from public.profiles;`, { role: 'anon' }).ok, false);
  assert.equal(psql(`select count(*) from public.profiles;`, { role: 'authenticated' }).out, '0', 'authentifié sans identité : aucune ligne');
  assert.equal(psql(`delete from public.profiles;`, { role: 'authenticated', sub: A }).ok, false);
});

test('DB6 contraintes : 3 objectifs au maximum, objectifs et niveaux connus', live, () => {
  if (!up) return;
  const set = v => psql(`update public.profiles set ${v};`, { role: 'authenticated', sub: A });
  assert.equal(set(`goals = array['hydration','tone','aging','texture']`).ok, false);
  assert.equal(set(`goals = array['inconnu']`).ok, false);
  assert.equal(set(`routine_level = 'zzz'`).ok, false);
  assert.ok(set(`goals = array['hydration','tone','aging'], routine_level = 'full'`).ok);
  assert.ok(set(`routine_level = null`).ok);
});

test('DB7 changement de compte : B ne retrouve rien de A ; suppression du compte supprime le profil', live, () => {
  if (!up) return;
  const rows = psql(`select goals, routine_level, prefer_gentle from public.profiles;`, { role: 'authenticated', sub: B }).out;
  assert.equal(rows, '{}||f');
  assert.ok(psql(`delete from auth.users where id = '${A}';`).ok);
  assert.equal(psql(`select count(*) from public.profiles where user_id = '${A}';`).out, '0');
});

test('DB8 migration : RLS activée, politiques « propre ligne », aucune clé service_role', () => {
  assert.match(MIGRATION, /enable row level security/);
  assert.equal((MIGRATION.match(/create policy/g) || []).length, 3);
  assert.equal((MIGRATION.match(/user_id = auth\.uid\(\)/g) || []).length >= 4, true);
  assert.doesNotMatch(MIGRATION, /service_role|using \(true\)|with check \(true\)|(^|\s)to\s+(anon|public)\b(?!\.)/im);
});

test('DB9 arrêt du PostgreSQL jetable', live, () => {
  if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});
