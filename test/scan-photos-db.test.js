'use strict';
/* Migration « photos de scan » (profiles.keep_photos + bucket privé scan-photos + règles d'accès) sur un vrai PostgreSQL jetable.
   Stubs minimaux de Supabase : rôles, auth.users, auth.uid(), et un schéma storage réduit (buckets, objects avec RLS, foldername).
   Ignoré (avec message) si PostgreSQL n'est pas installé. Aucune donnée n'est conservée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const PROFILES = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261006120000_create_profiles.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261010120000_scan_photos.sql'), 'utf8');
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

const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };
const put = (name, who, bucket = 'scan-photos') => psql(`insert into storage.objects (bucket_id, name) values ('${bucket}', '${name}');`, { role: 'authenticated', sub: who });
const count = (who, role = 'authenticated') => psql(`select count(*) from storage.objects;`, { role, sub: who }).out;

test('SP0 démarrage, stubs Supabase (dont storage), profils puis migration photos (rejouable)', live, () => {
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
    grant usage on schema public to anon, authenticated;
    create schema storage; grant usage on schema storage to anon, authenticated;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid default auth.uid());
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    grant execute on function storage.foldername(text) to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated; grant select on storage.buckets to anon, authenticated;
    insert into storage.buckets (id, name, public) values ('autre', 'autre', true);`;
  const s = psql(stub); assert.ok(s.ok, s.err);
  assert.ok(psql(PROFILES).ok);
  assert.ok(psql(`insert into auth.users values ('${A}', 'a@exemple.com'), ('${B}', 'b@exemple.com');`).ok);
  const m = psql(MIGRATION); assert.ok(m.ok, m.err);
  assert.ok(psql(MIGRATION).ok, 'migration rejouable');
});

test('SP1 keep_photos : null par défaut (pas encore demandé), modifiable seulement par la propriétaire', live, () => {
  if (!up) return;
  assert.equal(psql(`select count(*) from public.profiles where keep_photos is null;`).out, '2');
  assert.ok(psql(`update public.profiles set keep_photos = true where id is not null;`, { role: 'authenticated', sub: A }).ok);
  assert.equal(psql(`select user_id || ':' || coalesce(keep_photos::text, 'null') from public.profiles order by user_id;`).out, `${A}:true\n${B}:null`);
  assert.equal(psql(`select keep_photos from public.profiles;`, { role: 'authenticated', sub: B }).out, '', 'B ne voit que sa ligne (null)');
});

test('SP2 bucket privé, JPEG seulement, 4 Mo au plus', live, () => {
  if (!up) return;
  assert.equal(psql(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'scan-photos';`).out, 'f|4194304|{image/jpeg}');
});

test('SP3 dossier personnel : A ajoute dans son dossier, jamais dans celui de B ni à la racine ni dans un autre bucket', live, () => {
  if (!up) return;
  assert.ok(put(`${A}/00000000-0000-4000-8000-000000000001.jpg`, A).ok);
  assert.ok(put(`${B}/00000000-0000-4000-8000-000000000002.jpg`, B).ok);
  for (const name of [`${B}/x.jpg`, `x.jpg`, `${A}`, `autre/${A}/x.jpg`]) assert.equal(put(name, A).ok, false, name);
  assert.equal(put(`${A}/y.jpg`, A, 'autre').ok, false, 'aucune règle ne couvre un autre bucket');
  assert.equal(psql(`insert into storage.objects (bucket_id, name) values ('scan-photos', '${A}/z.jpg');`, { role: 'anon' }).ok, false, 'anonyme : refusé');
});

test('SP4 lecture et suppression : chacune les siennes seulement ; aucune modification ; anonyme : rien', live, () => {
  if (!up) return;
  assert.equal(count(A), '1'); assert.equal(count(B), '1'); assert.equal(count(null, 'anon'), '0');
  assert.equal(psql(`with d as (delete from storage.objects where name like '${A}/%' returning 1) select count(*) from d;`, { role: 'authenticated', sub: B }).out, '0');
  assert.equal(psql(`with u as (update storage.objects set name = '${A}/w.jpg' returning 1) select count(*) from u;`, { role: 'authenticated', sub: A }).out, '0', 'aucune règle de modification');
  assert.equal(psql(`with d as (delete from storage.objects returning 1) select count(*) from d;`, { role: 'authenticated', sub: A }).out, '1');
  assert.equal(count(A), '0'); assert.equal(count(B), '1', 'les photos de B sont intactes');
});

test('SP5 migration : rien de public, ni anon ni service_role, aucun masque', () => {
  const code = MIGRATION.replace(/^--.*$/gm, '').replace(/^comment on.*$/gm, '');
  assert.doesNotMatch(code, /service_role|to anon|to public|using \(true\)|with check \(true\)|for update|for all|mask/i);
  assert.match(code, /values \('scan-photos', 'scan-photos', false, 4194304, array\['image\/jpeg'\]\)/);
  assert.equal((code.match(/create policy/g) || []).length, 3);
  for (const p of code.match(/create policy[\s\S]*?;/g)) assert.match(p, /bucket_id = 'scan-photos' and \(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
});

test('SP9 arrêt du PostgreSQL jetable', live, () => {
  if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});
