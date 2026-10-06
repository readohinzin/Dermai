'use strict';
/* Étape 13 : durcissement avant ouverture publique (journaux, mode réel, séparation démo / réel, suppression). Perfect Corp : toujours simulé. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pc = require('../server/perfectcorp');
const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('H1 un délai dépassé ne journalise pas l\'identifiant de tâche du fournisseur', async () => {
  const res = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  const env = pc.makeEnv({ fetch: async () => res({ data: { task_status: 'running' } }), apiKey: 'TEST_ONLY_KEY_NOT_REAL', sleep: async () => {}, polling: { maxAttempts: 2, intervalMs: 1, totalTimeoutMs: 60000 } });
  await assert.rejects(pc.pollSkinAnalysisTask('TASK_SECRET_9', env), e => e.code === 'TIMEOUT' && !String(e.detail).includes('TASK_SECRET_9') && !JSON.stringify(e).includes('TASK_SECRET_9'));
});

test('H2 les journaux du serveur ne contiennent que des noms de champs, des états et des codes : jamais jeton, clé, photo, URL de masque, identifiant', () => {
  for (const f of ['api/skin-analysis.js', 'server/auth.js', 'server/quota.js', 'server/perfectcorp.js']) {
    const code = stripComments(src(f));
    for (const m of code.matchAll(/console\.(log|warn|error)\(([^;]*)\);/g)) {
      assert.doesNotMatch(m[2], /token|apiKey|Authorization|buffer|body\b|image|mask|taskId|task_id|user\.id|email|process\.env/i, `${f} : ${m[0].slice(0, 100)}`);
    }
  }
});

test('H3 mode réel : aucune analyse fictive n\'existe en mémoire ; la démo reste séparée', () => {
  const app = src('js/app.js');
  assert.match(app, /if\(!DEMO_MODE\)\{SCANS\.length=0;state\.cmpA=0;state\.cmpB=1\}/);
  assert.match(app, /const noReal=\(\)=>!DEMO_MODE&&!SCANS\.some\(s=>s\.real\)/);
  assert.doesNotMatch(app.slice(app.indexOf('async function saveScan'), app.indexOf('async function deleteHistory')), /MockProvider|demoScan/);
});

test('H4 la suppression de compte passe uniquement par la fonction SQL sans paramètre : aucune clé privilégiée dans l\'application', () => {
  const all = ['js/app.js', 'js/account.js', 'api/config-js.js', 'api/skin-analysis.js', 'server/auth.js', 'server/quota.js', 'server/config.js', 'index.html', 'vercel.json'].map(f => stripComments(src(f))).join('\n');
  assert.doesNotMatch(all, /service_role|SERVICE_ROLE|SUPABASE_SERVICE/i);
  const acc = stripComments(src('js/account.js'));
  assert.match(acc, /rpc\/delete_my_account', \{ method: 'POST', body: '\{\}' \}/);
  const sql = stripComments(src('supabase/migrations/20261008121000_delete_my_account.sql'));
  assert.match(sql, /create or replace function public\.delete_my_account\(\) returns void/);
  assert.match(sql, /delete from auth\.users where id = uid/);
});

test('H5 mots de passe : jamais écrits ni conservés ; seuls les appels d\'authentification Supabase les reçoivent', () => {
  const acc = stripComments(src('js/account.js')), app = stripComments(src('js/app.js'));
  assert.doesNotMatch(acc, /setItem\([^)]*password/i);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(password|pw)/i);
  assert.doesNotMatch(app, /console\.(log|warn|error)/);
  const passwordPaths = [...acc.matchAll(/'(\/[^']*)',\s*\{[^}]*body:\s*JSON\.stringify\(\{[^}]*password/g)].map(m => m[1]);
  assert.ok(passwordPaths.every(p => /^\/auth\/v1\/(signup|token\?grant_type=password|user)$/.test(p)), passwordPaths.join());
});

test('H6 limites de la photo documentées par le code : JPEG seulement, 4 Mo, signature vérifiée avant tout envoi', () => {
  const cfg = require('../server/config');
  assert.deepEqual(cfg.IMAGE.allowedMime, ['image/jpeg']); assert.equal(cfg.IMAGE.maxBytes, 4 * 1024 * 1024);
  const h = stripComments(src('api/skin-analysis.js'));
  assert.ok(h.indexOf('validateImage') < h.indexOf('quota.reserve') && h.indexOf('quota.reserve') < h.indexOf('perfectcorp.analyzeSkin'));
});
