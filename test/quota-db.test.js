'use strict';
/* Migrations « quota d'analyses » et « suppression de compte » exécutées sur un vrai PostgreSQL jetable (stubs minimaux de Supabase).
   Le point clé : la réservation est atomique, y compris avec des requêtes réellement simultanées (plusieurs connexions). Ignoré si PostgreSQL est absent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const MIG = f => fs.readFileSync(path.join(__dirname, '../supabase/migrations', f), 'utf8');
const MIGRATIONS = ['20261006120000_create_profiles.sql', '20261007120000_create_skin_analyses.sql', '20261008120000_analysis_quota.sql', '20261008121000_delete_my_account.sql'];
const PORT = 54000 + Math.floor(Math.random() * 900);
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
const asRoot = process.getuid && process.getuid() === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dermai-pg-'));
let up = false;
const live = { skip: BIN ? false : 'PostgreSQL non installé : test ignoré' };

const wrap = (cmd, args) => asRoot ? ['su', ['postgres', '-c', [cmd, ...args].map(x => `'${String(x).replace(/'/g, `'\\''`)}'`).join(' ')]] : [cmd, args];
const sh = (cmd, args, o = {}) => { const [c, a] = wrap(cmd, args); return spawnSync(c, a, Object.assign({ encoding: 'utf8' }, o)); };
const PSQL = ['-h', dir, '-p', String(PORT), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'];
const prelude = ({ role, sub }) => role ? `\\o /dev/null\nset role ${role};\n${sub ? `select set_config('request.jwt.claim.sub', '${sub}', false);\n` : ''}\\o\n` : '';
const clean = out => (out || '').split('\n').filter(l => !/^(SET|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|CREATE [A-Z ]+|GRANT|REVOKE|ALTER [A-Z ]+|COMMENT|DROP [A-Z ]+)$/.test(l.trim())).join('\n').trim();
function psql(sql, o = {}) {
  const r = sh(path.join(BIN, 'psql'), PSQL, { input: prelude(o) + sql });
  return { ok: r.status === 0, out: clean(r.stdout), err: (r.stderr || '').trim() };
}
/* Connexion indépendante lancée en parallèle : de vraies sessions concurrentes. */
function psqlAsync(sql, o = {}) {
  return new Promise(resolve => {
    const [c, a] = wrap(path.join(BIN, 'psql'), PSQL);
    const p = spawn(c, a); let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ ok: code === 0, out: clean(out), err: err.trim() }));
    p.stdin.end(prelude(o) + sql);
  });
}
const reserve = (who, limit, win) => psql(`select public.reserve_analysis(${limit}, ${win});`, { role: 'authenticated', sub: who });
const rj = r => { assert.ok(r.ok, r.err); return JSON.parse(r.out.split('\n').pop()); };

test('QD0 démarrage d\'un PostgreSQL jetable et application des migrations', live, () => {
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
  for (const m of MIGRATIONS) { const x = psql(MIG(m)); assert.ok(x.ok, m + ' : ' + x.err); }
  assert.ok(psql(`insert into auth.users values ('${A}', 'a@exemple.com'), ('${B}', 'b@exemple.com');`).ok);
});

test('QD1 réservation sous le quota, puis refus avec délai d\'attente ; le refus ne consomme rien', live, () => {
  if (!up) return;
  const r = [1, 2, 3].map(() => rj(reserve(A, 3, 3600)));
  assert.deepEqual(r.map(x => [x.ok, x.used, x.limit]), [[true, 1, 3], [true, 2, 3], [true, 3, 3]]);
  const over = rj(reserve(A, 3, 3600));
  assert.equal(over.ok, false); assert.equal(over.used, 3); assert.ok(over.retry_after > 3000 && over.retry_after <= 3600, String(over.retry_after));
  assert.equal(psql(`select count(*) from public.analysis_usage where user_id = '${A}';`).out, '3', 'le refus n\'a rien inséré');
});

test('QD2 la période glisse : les anciennes réservations ne comptent plus', live, () => {
  if (!up) return;
  assert.ok(psql(`insert into public.analysis_usage (user_id, used_at) values ('${B}', now() - interval '2 hours'), ('${B}', now() - interval '90 minutes');`).ok);
  assert.equal(rj(reserve(B, 2, 3600)).ok, true, 'hors période : seule la nouvelle compte');
  assert.equal(rj(reserve(B, 2, 3600)).ok, true);
  assert.equal(rj(reserve(B, 2, 3600)).ok, false);
  assert.equal(rj(reserve(B, 4, 86400)).ok, false, 'période plus longue : les deux anciennes comptent aussi (4 sur 4)');
  assert.equal(rj(reserve(B, 5, 86400)).ok, true);
});

test('QD3 ATOMICITÉ : 12 requêtes réellement simultanées pour le même compte, quota de 3 → exactement 3 acceptées', live, async () => {
  if (!up) return;
  const C = '33333333-3333-3333-3333-333333333333';
  assert.ok(psql(`insert into auth.users values ('${C}', 'c@exemple.com');`).ok);
  const runs = await Promise.all(Array.from({ length: 12 }, () => psqlAsync(`select public.reserve_analysis(3, 3600);`, { role: 'authenticated', sub: C })));
  assert.ok(runs.every(r => r.ok), runs.map(r => r.err).join('|'));
  const res = runs.map(r => JSON.parse(r.out.split('\n').pop()));
  assert.equal(res.filter(x => x.ok).length, 3, 'exactement 3 acceptées : ' + JSON.stringify(res.map(x => x.ok)));
  assert.equal(psql(`select count(*) from public.analysis_usage where user_id = '${C}';`).out, '3');
  // la dernière place, disputée par deux requêtes
  const D = '44444444-4444-4444-4444-444444444444';
  assert.ok(psql(`insert into auth.users values ('${D}', 'd@exemple.com'); insert into public.analysis_usage (user_id) values ('${D}'), ('${D}');`).ok);
  const two = await Promise.all([1, 2].map(() => psqlAsync(`select public.reserve_analysis(3, 3600);`, { role: 'authenticated', sub: D })));
  assert.equal(two.map(r => JSON.parse(r.out.split('\n').pop())).filter(x => x.ok).length, 1, 'une seule des deux obtient la dernière analyse');
});

test('QD4 isolation : chaque compte a son compteur ; aucun accès direct à la table ; anonyme et sans identité refusés', live, () => {
  if (!up) return;
  const E = '55555555-5555-5555-5555-555555555555';
  assert.ok(psql(`insert into auth.users values ('${E}', 'e@exemple.com');`).ok);
  assert.equal(rj(reserve(E, 1, 3600)).ok, true, 'le quota épuisé par A ne touche pas E');
  for (const sql of ['select * from public.analysis_usage', `insert into public.analysis_usage (user_id) values ('${E}')`, 'update public.analysis_usage set used_at = now()', 'delete from public.analysis_usage']) {
    const r = psql(sql + ';', { role: 'authenticated', sub: E });
    assert.equal(r.ok, false, sql); assert.match(r.err, /permission denied/i, sql);
  }
  assert.equal(psql('select public.reserve_analysis(3, 3600);', { role: 'anon' }).ok, false, 'anonyme refusé');
  const noId = psql('select public.reserve_analysis(3, 3600);', { role: 'authenticated' });
  assert.equal(noId.ok, false); assert.match(noId.err, /not authenticated/);
});

test('QD5 paramètres bornés ; plafond de stockage par compte ; quota nul = tout refusé', live, () => {
  if (!up) return;
  const F = '66666666-6666-6666-6666-666666666666';
  assert.ok(psql(`insert into auth.users values ('${F}', 'f@exemple.com');`).ok);
  for (const [l, w] of [[-1, 3600], [1001, 3600], [3, 59], [3, 31536001]]) assert.equal(reserve(F, l, w).ok, false, `${l}/${w}`);
  assert.equal(rj(reserve(F, 0, 3600)).ok, false, 'quota 0 : tout est refusé');
  assert.ok(psql(`insert into public.analysis_usage (user_id, used_at) select '${F}', now() - interval '2 days' from generate_series(1, 2000);`).ok);
  const capped = rj(reserve(F, 1000, 3600));
  assert.equal(capped.ok, false, 'plafond de 2000 lignes par compte : la table ne peut pas être remplie');
});

test('QD6 supprimer son historique ne rend aucune analyse (le quota est indépendant de skin_analyses)', live, () => {
  if (!up) return;
  assert.ok(psql(`insert into public.skin_analyses (metrics, engine_version) values ('{"acne":50}', '1.0.0');`, { role: 'authenticated', sub: A }).ok);
  const before = psql(`select count(*) from public.analysis_usage where user_id = '${A}';`).out;
  assert.ok(psql(`delete from public.skin_analyses where id is not null;`, { role: 'authenticated', sub: A }).ok);
  assert.equal(psql(`select count(*) from public.analysis_usage where user_id = '${A}';`).out, before);
  assert.equal(rj(reserve(A, 3, 3600)).ok, false, 'toujours refusé : 3 sur 3');
});

test('DA1 suppression de compte : elle vise uniquement l\'appelant ; profil, analyses et quota partent avec lui ; les autres comptes sont intacts', live, () => {
  if (!up) return;
  assert.equal(psql(`select pg_get_function_arguments('public.delete_my_account'::regproc);`).out, '', 'aucun paramètre : impossible de viser un autre compte');
  assert.ok(psql(`insert into public.skin_analyses (metrics, engine_version) values ('{"acne":50}', '1.0.0');`, { role: 'authenticated', sub: E5() }).ok);
  function E5() { return '55555555-5555-5555-5555-555555555555'; }
  const E = E5();
  assert.equal(psql(`select count(*) from public.profiles where user_id = '${E}';`).out, '1');
  const n = q => psql(q).out;
  const otherBefore = [n(`select count(*) from auth.users where id <> '${E}';`), n(`select count(*) from public.profiles where user_id <> '${E}';`), n(`select count(*) from public.analysis_usage where user_id <> '${E}';`)];
  const r = psql('select public.delete_my_account();', { role: 'authenticated', sub: E });
  assert.ok(r.ok, r.err);
  assert.deepEqual([n(`select count(*) from auth.users where id = '${E}';`), n(`select count(*) from public.profiles where user_id = '${E}';`), n(`select count(*) from public.skin_analyses where user_id = '${E}';`), n(`select count(*) from public.analysis_usage where user_id = '${E}';`)], ['0', '0', '0', '0']);
  assert.deepEqual([n(`select count(*) from auth.users where id <> '${E}';`), n(`select count(*) from public.profiles where user_id <> '${E}';`), n(`select count(*) from public.analysis_usage where user_id <> '${E}';`)], otherBefore, 'les autres comptes ne sont pas touchés');
});

test('DA2 suppression de compte : anonyme et sans identité refusés ; un utilisateur ne supprime pas un autre compte même en forçant son identifiant', live, () => {
  if (!up) return;
  assert.equal(psql('select public.delete_my_account();', { role: 'anon' }).ok, false);
  const noId = psql('select public.delete_my_account();', { role: 'authenticated' });
  assert.equal(noId.ok, false); assert.match(noId.err, /not authenticated/);
  const before = psql(`select count(*) from auth.users;`).out;
  const direct = psql(`delete from auth.users where id = '${A}';`, { role: 'authenticated', sub: B });
  assert.equal(direct.ok, false, 'pas d\'accès direct à auth.users'); assert.match(direct.err, /permission denied/i);
  assert.equal(psql(`select count(*) from auth.users;`).out, before);
  const as = psql(`select public.delete_my_account();`, { role: 'authenticated', sub: B });
  assert.ok(as.ok, as.err);
  assert.equal(psql(`select count(*) from auth.users where id = '${A}';`).out, '1', 'le compte A existe toujours : B n\'a supprimé que B');
  assert.equal(psql(`select count(*) from auth.users where id = '${B}';`).out, '0');
});

test('QM migrations : fonctions SECURITY DEFINER à chemin de recherche vide, droits limités aux utilisateurs connectés, aucune clé service_role', () => {
  for (const m of ['20261008120000_analysis_quota.sql', '20261008121000_delete_my_account.sql']) {
    const sql = MIG(m).replace(/--.*$/gm, '');          // commentaires exclus (ils expliquent justement pourquoi service_role n'est pas utilisé)
    assert.match(sql, /security definer set search_path = ''/);
    assert.match(sql, /revoke all on function [^;]* from public, anon;/);
    assert.match(sql, /grant execute on function [^;]* to authenticated;/);
    assert.doesNotMatch(sql, /service_role|\bto (anon|public)\b(?!\.)/i);
  }
  assert.match(MIG('20261008120000_analysis_quota.sql'), /pg_advisory_xact_lock/);
  assert.match(MIG('20261008120000_analysis_quota.sql'), /revoke all on public\.analysis_usage from anon, authenticated/);
});

test('QD9 arrêt du PostgreSQL jetable', live, () => {
  if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});
