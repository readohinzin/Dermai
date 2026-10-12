'use strict';
/* PROPOSITION de lecture agrégée de l'administration (supabase/proposals/20261014120000_admin_overview.sql) exécutée sur un PostgreSQL JETABLE (stubs minimaux de Supabase) :
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
const PROPOSAL = 'supabase/proposals/20261014120000_admin_overview.sql', ROLLBACK = 'supabase/proposals/20261014120000_admin_overview.rollback.sql';
const PORT = 56000 + Math.floor(Math.random() * 900);
const ID = n => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;
const F = ID(1), U1 = ID(2), U2 = ID(3), U3 = ID(4), U4 = ID(5), U5 = ID(6), OUT = ID(7);
const asRoot = process.getuid && process.getuid() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-pg-ao-'));
let up = false;
const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };
const wrap = (cmd, args) => asRoot ? ['su', ['postgres', '-c', [cmd, ...args].map(x => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ')]] : [cmd, args];
const sh = (cmd, args, o = {}) => { const [c, a] = wrap(cmd, args); return spawnSync(c, a, Object.assign({ encoding: 'utf8' }, o)); };
const PSQL = ['-h', dir, '-p', String(PORT), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'];
const prelude = ({ role, sub }) => role ? `\\o /dev/null\nset role ${role};\n${sub ? `select set_config('request.jwt.claim.sub', '${sub}', false);\n` : ''}\\o\n` : '';
const clean = out => (out || '').split('\n').filter(l => !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|CREATE [A-Z ]+|GRANT|REVOKE|ALTER [A-Z ]+|COMMENT|DROP [A-Z ]+)$/.test(l.trim())).join('\n').trim();
function psql(sql, o = {}) { const r = sh(path.join(BIN, 'psql'), PSQL, { input: prelude(o) + sql }); return { ok: r.status === 0, out: clean(r.stdout), err: (r.stderr || '').trim() }; }
const overview = who => psql('select public.admin_overview();', { role: 'authenticated', sub: who });
const ov = who => { const r = overview(who); assert.ok(r.ok, r.err); return JSON.parse(r.out.split('\n').pop()); };
const ago = d => `now() - interval '${d} days'`;

test('AO0 PostgreSQL jetable, migrations existantes (analyse seulement), puis la proposition d\'administration', live, () => {
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
  assert.equal(psql(`select to_regproc('public.admin_overview') is null;`).out, 't', 'avant la proposition : la fonction n\'existe pas (le serveur répond « non appliquée »)');
  const p = psql(SQL(PROPOSAL)); assert.ok(p.ok, p.err);
  const again = psql(SQL(PROPOSAL)); assert.ok(again.ok, 'rejouable sans erreur : ' + again.err);
  assert.ok(psql(`insert into auth.users (id, email, created_at, last_sign_in_at) values
    ('${F}', 'f@exemple.com', ${ago(100)}, ${ago(1)}), ('${U1}', 'u1@exemple.com', ${ago(2)}, ${ago(1)}), ('${U2}', 'u2@exemple.com', ${ago(20)}, ${ago(15)}),
    ('${U3}', 'u3@exemple.com', ${ago(40)}, null), ('${U4}', 'u4@exemple.com', ${ago(40)}, ${ago(35)}), ('${U5}', 'u5@exemple.com', ${ago(20)}, ${ago(3)}), ('${OUT}', 'out@exemple.com', ${ago(5)}, ${ago(1)});
    insert into public.analysis_usage (user_id, used_at) values ('${U1}', ${ago(1)}), ('${U2}', ${ago(10)}), ('${U5}', ${ago(2)}), ('${U4}', ${ago(35)});`).ok);
});

test('AO1 ACCÈS : refusé tant que admin_users est vide, pour un compte non listé, sans identité, en anonyme ; la table est fermée ; autorisé seulement pour un compte listé', live, () => {
  if (!up) return;
  for (const who of [F, U1, OUT]) { const r = overview(who); assert.equal(r.ok, false, who); assert.match(r.err, /not found/); }
  const none = psql('select public.admin_overview();', { role: 'authenticated' }); assert.equal(none.ok, false); assert.match(none.err, /not found/);
  const anon = psql('select public.admin_overview();', { role: 'anon' }); assert.equal(anon.ok, false); assert.match(anon.err, /permission denied/i);
  for (const q of ['select * from public.admin_users', `insert into public.admin_users (user_id) values ('${U1}')`, 'delete from public.admin_users', 'update public.admin_users set created_at = now()']) {
    const r = psql(q + ';', { role: 'authenticated', sub: U1 }); assert.equal(r.ok, false, q); assert.match(r.err, /permission denied/i, q);
  }
  assert.ok(psql(`insert into public.admin_users (user_id) values ('${F}');`).ok, 'le fondateur s\'ajoute (rôle propriétaire, comme dans le SQL Editor)');
  assert.equal(overview(U1).ok, false, 'un autre compte reste refusé après l\'ajout du fondateur');
  assert.equal(overview(F).ok, true);
});

test('AO2 CHIFFRES EXACTS avec la seule table d\'analyse : comptes, activité, retour, inactifs ; les tables absentes sont « available: false », jamais zéro', live, () => {
  if (!up) return;
  const o = ov(F);
  assert.equal(o.v, 1); assert.ok(!Number.isNaN(Date.parse(o.generated_at)));
  assert.deepEqual(o.accounts, { total: 7, new_7d: 2, new_30d: 4, signed_in_7d: 4, signed_in_30d: 5, active_7d: 2, active_30d: 3, returned_7d: 1, never_used: 3, inactive_30d: 3 });
  assert.deepEqual(o.functions.analysis, { available: true, runs_7d: 2, runs_30d: 3, users_30d: 3 });
  for (const k of ['simulation', 'makeup', 'hair']) assert.deepEqual(o.functions[k], { available: false }, k + ' : table absente');
  assert.deepEqual(o.saved_analyses, { total: 0, last_30d: 0, users: 0 });
});

test('AO3 avec les propositions simulation, maquillage et cheveux appliquées : les quatre fonctions comptées, l\'activité les réunit, les unités capillaires sont sommées', live, () => {
  if (!up) return;
  for (const f of ['20261011120000_simulation_quota.sql', '20261012120000_makeup_quota.sql', '20261013120000_hair_quota.sql']) { const p = psql(SQL('supabase/proposals/' + f)); assert.ok(p.ok, f + ' : ' + p.err); }
  assert.ok(psql(`insert into public.makeup_usage (user_id, used_at) values ('${U1}', ${ago(1)}); insert into public.simulation_usage (user_id, used_at) values ('${U3}', ${ago(1)}), ('${U3}', ${ago(12)});
    insert into public.hair_usage (user_id, used_at, units) values ('${U2}', ${ago(3)}, 2), ('${U2}', ${ago(40)}, 1);
    insert into public.skin_analyses (user_id, metrics, engine_version) values ('${U1}', '{}', 'v1');`).ok);
  const o = ov(F);
  assert.deepEqual(o.functions.makeup, { available: true, runs_7d: 1, runs_30d: 1, users_30d: 1 });
  assert.deepEqual(o.functions.simulation, { available: true, runs_7d: 1, runs_30d: 2, users_30d: 1 });
  assert.deepEqual(o.functions.hair, { available: true, runs_7d: 1, runs_30d: 1, users_30d: 1, units_7d: 2, units_30d: 2 });
  assert.deepEqual(o.accounts, { total: 7, new_7d: 2, new_30d: 4, signed_in_7d: 4, signed_in_30d: 5, active_7d: 4, active_30d: 4, returned_7d: 3, never_used: 2, inactive_30d: 2 }, 'activité = toutes fonctions réunies');
  assert.deepEqual(o.saved_analyses, { total: 1, last_30d: 1, users: 1 });
});

test('AO4 LECTURE SEULE ET DISCRÉTION : aucune écriture (états identiques avant et après), aucun identifiant ni e-mail dans la réponse, aucune clé service_role', live, () => {
  if (!up) return;
  const state = () => psql(`select (select count(*) from auth.users) || '/' || (select count(*) from public.analysis_usage) || '/' || (select count(*) from public.makeup_usage) || '/' || (select count(*) from public.hair_usage) || '/' || (select count(*) from public.simulation_usage) || '/' || (select count(*) from public.skin_analyses) || '/' || (select count(*) from public.admin_users);`).out;
  const before = state(); const raw = overview(F).out;
  assert.equal(state(), before, 'aucune ligne créée, modifiée ni supprimée');
  for (const secret of [F, U1, U2, U3, U4, U5, OUT, 'exemple.com', '@']) assert.ok(!raw.includes(secret), 'la réponse ne contient pas ' + secret);
  const body = SQL(PROPOSAL).split('create or replace function public.admin_overview')[1].split('revoke all on function')[0].replace(/--.*$/gm, '');
  assert.ok(!/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test(body.replace(/jsonb_build_object|created_at/g, '')), 'le corps de la fonction ne contient aucune instruction d\'écriture ni de définition');
  assert.ok(/security definer set search_path = ''/.test(SQL(PROPOSAL)) && !/service_role/.test(SQL(PROPOSAL).replace(/--.*$/gm, '')), 'search_path vidé, aucune clé service_role');
  assert.ok(/revoke all on function public\.admin_overview\(\) from public, anon/.test(SQL(PROPOSAL)));
  assert.equal(psql(`select has_function_privilege('anon', 'public.admin_overview()', 'execute'), has_function_privilege('authenticated', 'public.admin_overview()', 'execute');`).out, 'f|t');
});

test('AO5 RETOUR ARRIÈRE : supprime la fonction et la table des comptes autorisés sans toucher aux données d\'utilisation', live, () => {
  if (!up) return;
  const n = psql('select count(*) from public.analysis_usage;').out;
  const r = psql(SQL(ROLLBACK)); assert.ok(r.ok, r.err);
  assert.equal(psql(`select to_regproc('public.admin_overview') is null, to_regclass('public.admin_users') is null;`).out, 't|t');
  assert.equal(psql('select count(*) from public.analysis_usage;').out, n);
  assert.ok(psql(SQL(ROLLBACK)).ok, 'rejouable');
});

test.after(() => { if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* sans importance */ } });
