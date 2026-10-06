'use strict';
/* Migration `skin_analyses` + RLS + contraintes exécutées sur un vrai PostgreSQL jetable (stubs minimaux de Supabase).
   Ignoré (avec message) si PostgreSQL n'est pas installé. Aucune donnée n'est conservée. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/17/bin', '/usr/local/bin'].find(d => fs.existsSync(path.join(d, 'initdb')));
const MIGRATION = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261007120000_create_skin_analyses.sql'), 'utf8');
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
const M = '{"acne":63,"pores":36,"hydration":52,"pigmentation":22,"redness":null}';
const ins = (cols, vals, who) => psql(`insert into public.skin_analyses (${cols}) values (${vals}) returning id;`, { role: 'authenticated', sub: who });
const base = `global_score, skin_type, skin_age, metrics, priorities, goals_snapshot, engine_version`;
const baseVals = (o = {}) => `${o.g ?? 61}, ${o.t ?? `'Combination'`}, ${o.a ?? 31}, '${o.m ?? M}'::jsonb, '${o.p ?? '[{"id":"pigmentation","label":"Pigmentation","score":22,"band":"low"},{"id":"pores","label":"Pores","score":36,"band":"mid"}]'}'::jsonb, ${o.goals ?? `array['hydration','tone']`}, ${o.v ?? `'1.0.0'`}`;

test('AD0 démarrage d\'un PostgreSQL jetable et application de la migration', live, () => {
  if (asRoot) fs.chmodSync(dir, 0o777);
  let r = sh(path.join(BIN, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust']);
  assert.equal(r.status, 0, r.stderr);
  r = sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses=`, '-l', path.join(dir, 'log'), '-w', 'start']);
  assert.equal(r.status, 0, r.stderr);
  up = true;
  assert.ok(psql(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;`).ok);
  const m = psql(MIGRATION);
  assert.ok(m.ok, m.err);
  assert.ok(psql(`insert into auth.users values ('${A}', 'a@exemple.com'), ('${B}', 'b@exemple.com');`).ok);
});

test('AD1 la table ne contient que des scores : aucune photo, masque, URL, task_id, JSON brut ni rawScore', live, () => {
  if (!up) return;
  const cols = psql(`select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='skin_analyses';`).out;
  assert.equal(cols, 'id,user_id,analyzed_at,global_score,skin_type,skin_age,metrics,priorities,goals_snapshot,engine_version,created_at');
  assert.doesNotMatch(cols, /photo|image|selfie|mask|url|task|raw|token|key|json/);
});

test('AD2 un utilisateur ajoute et relit sa propre analyse ; user_id vient du jeton', live, () => {
  if (!up) return;
  const r = ins(base, baseVals(), A);
  assert.ok(r.ok, r.err);
  const row = psql(`select user_id, global_score, skin_type, skin_age, goals_snapshot, engine_version, metrics ->> 'acne', jsonb_array_length(priorities), analyzed_at <= now() from public.skin_analyses;`, { role: 'authenticated', sub: A }).out;
  assert.equal(row, `${A}|61|Combination|31|{hydration,tone}|1.0.0|63|2|t`);
});

test('AD3 isolation A/B : B ne voit, ne supprime ni ne modifie rien de A', live, () => {
  if (!up) return;
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'authenticated', sub: B }).out, '0');
  assert.equal(psql(`with d as (delete from public.skin_analyses where user_id = '${A}' returning 1) select count(*) from d;`, { role: 'authenticated', sub: B }).out, '0');
  assert.equal(psql(`select count(*) from public.skin_analyses where user_id = '${A}';`, { role: 'authenticated', sub: A }).out, '1');
  const forged = psql(`insert into public.skin_analyses (user_id, ${base}) values ('${A}', ${baseVals()});`, { role: 'authenticated', sub: B });
  assert.equal(forged.ok, false);
  assert.match(forged.err, /row-level security/i);
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'anon' }).ok, false, 'visiteur anonyme : aucun accès');
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'authenticated' }).out, '0', 'sans identité : aucune ligne');
});

test('AD4 une analyse enregistrée est figée : aucune modification possible', live, () => {
  if (!up) return;
  const u = psql(`update public.skin_analyses set global_score = 99;`, { role: 'authenticated', sub: A });
  assert.equal(u.ok, false);
  assert.match(u.err, /permission denied/i);
  assert.equal(psql(`select global_score from public.skin_analyses;`, { role: 'authenticated', sub: A }).out, '61');
});

test('AD5 contraintes : scores hors 0-100, décimaux, clés inconnues (rawScore, photo, URL), objectifs, version', live, () => {
  if (!up) return;
  const bad = o => assert.equal(ins(base, baseVals(o), A).ok, false, JSON.stringify(o));
  bad({ g: 101 }); bad({ g: -1 }); bad({ a: 0 }); bad({ a: 121 });
  bad({ m: '{"acne":101}' }); bad({ m: '{"acne":-3}' }); bad({ m: '{"acne":55.5}' }); bad({ m: '{"acne":"55"}' });
  bad({ m: '{"rawScore":40}' }); bad({ m: '{"acne":{"uiScore":50,"rawScore":40}}' }); bad({ m: '{"photo":"data:image/jpeg;base64,AAAA"}' });
  bad({ m: '{"mask_url":"https://x"}' }); bad({ m: '[1,2]' }); bad({ m: '"texte"' });
  bad({ p: '[{"id":"acne","label":"Acné","score":10,"url":"https://x"}]' }); bad({ p: '[{"id":"acne","label":"Acné","score":10,"reason":"x"}]' });
  bad({ p: '[{"id":"inconnu","label":"X","score":10}]' }); bad({ p: '{"id":"acne"}' }); bad({ p: '[{"id":"acne","score":10}]' });
  bad({ p: '[{"id":"acne","label":"Acné","score":120}]' }); bad({ p: '[{"id":"acne","label":"Acné","score":10,"band":"zzz"}]' });
  bad({ p: `[{"id":"acne","label":"${'x'.repeat(61)}","score":10}]` });
  bad({ p: `[${Array(16).fill('{"id":"acne","label":"Acné","score":10,"band":"good"}').join(',')}]` });
  bad({ goals: `array['hydration','tone','aging','texture']` }); bad({ goals: `array['inconnu']` });
  bad({ v: `''` }); bad({ v: `'${'x'.repeat(41)}'` }); bad({ t: `'${'x'.repeat(41)}'` });
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'authenticated', sub: A }).out, '1', 'rien de refusé n\'a été enregistré');
  const noMetrics = psql(`insert into public.skin_analyses (engine_version) values ('v');`, { role: 'authenticated', sub: A });
  assert.equal(noMetrics.ok, false);
  // valeurs valides limites : analyse partielle (indicateurs absents), score global absent, sans objectif
  assert.ok(ins(base, baseVals({ g: 'null', t: 'null', a: 'null', m: '{"acne":0,"pores":100}', p: '[]', goals: `'{}'::text[]` }), A).ok);
});

test('AD6 la date ne peut pas être antidatée ni placée dans le futur ; une reprise récente garde sa date', live, () => {
  if (!up) return;
  const d = when => psql(`insert into public.skin_analyses (analyzed_at, ${base}) values (${when}, ${baseVals()}) returning abs(extract(epoch from (analyzed_at - (${when})))) < 2, analyzed_at > now() - interval '5 seconds';`, { role: 'authenticated', sub: A });
  const recent = d(`now() - interval '2 hours'`);
  assert.ok(recent.ok, recent.err);
  assert.equal(recent.out.split('\n')[0], 't|f', 'reprise de 2 heures : date conservée');
  const old = psql(`insert into public.skin_analyses (analyzed_at, ${base}) values (now() - interval '2 years', ${baseVals()}) returning analyzed_at > now() - interval '5 seconds';`, { role: 'authenticated', sub: A });
  assert.equal(old.out.split('\n')[0], 't', 'antidatée : remplacée par la date du serveur');
  const future = psql(`insert into public.skin_analyses (analyzed_at, ${base}) values (now() + interval '3 days', ${baseVals()}) returning analyzed_at <= now();`, { role: 'authenticated', sub: A });
  assert.equal(future.out.split('\n')[0], 't');
});

test('AD7 un utilisateur supprime son historique ; celui d\'un autre reste intact ; la suppression du compte l\'efface', live, () => {
  if (!up) return;
  assert.ok(ins(base, baseVals(), B).ok);
  const del = psql(`with d as (delete from public.skin_analyses where id is not null returning 1) select count(*) from d;`, { role: 'authenticated', sub: A });
  assert.ok(del.ok, del.err);
  assert.ok(Number(del.out) >= 1);
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'authenticated', sub: A }).out, '0');
  assert.equal(psql(`select count(*) from public.skin_analyses;`, { role: 'authenticated', sub: B }).out, '1', 'B conserve son historique');
  assert.ok(psql(`delete from auth.users where id = '${B}';`).ok);
  assert.equal(psql(`select count(*) from public.skin_analyses;`).out, '0');
});

test('AD8 plafond de volume par compte', live, () => {
  if (!up) return;
  assert.ok(psql(`insert into auth.users values ('33333333-3333-3333-3333-333333333333', 'c@exemple.com');`).ok);
  const r = psql(`insert into public.skin_analyses (user_id, metrics, engine_version) select '33333333-3333-3333-3333-333333333333', '{}', 'v' from generate_series(1, 1000);`);
  assert.ok(r.ok, r.err);
  const over = psql(`insert into public.skin_analyses (metrics, engine_version) values ('{}', 'v');`, { role: 'authenticated', sub: '33333333-3333-3333-3333-333333333333' });
  assert.equal(over.ok, false);
  assert.match(over.err, /limit reached/);
});

test('AD9 migration : RLS activée, politiques « propre ligne », aucune modification, aucun accès anonyme ni service_role', () => {
  assert.match(MIGRATION, /enable row level security/);
  assert.equal((MIGRATION.match(/create policy/g) || []).length, 3);
  assert.doesNotMatch(MIGRATION, /for update/i);
  assert.doesNotMatch(MIGRATION, /service_role|using \(true\)|with check \(true\)|(^|\s)to\s+(anon|public)\b(?!\.)/im);
  assert.match(MIGRATION, /grant select, insert, delete on public\.skin_analyses to authenticated/);
});

test('AD10 arrêt du PostgreSQL jetable', live, () => {
  if (up) sh(path.join(BIN, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});
