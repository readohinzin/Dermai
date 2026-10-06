'use strict';
/* Comptes : configuration publique, intégration frontend (sans réseau), moteur resté pur, aucune fausse promesse. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { publicSupabase } = require('../server/config.js');
const handler = require('../api/config-js.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const app = read('js/app.js'), code = strip(app);

function config(env) {
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) if (/^(SUPABASE|DERMAI)/.test(k)) delete process.env[k];
  Object.assign(process.env, env);
  let body = '';
  handler({ method: 'GET' }, { setHeader() {}, end(x) { body = x; } });
  process.env = saved;
  return JSON.parse(body.match(/=(.*);/)[1]);
}

test('U1 config publique : seules l\'URL et la clé anon sont exposées ; service_role et autres secrets jamais', () => {
  assert.deepEqual(Object.keys(config({})), ['demoMode']);
  const c = config({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'SECRET', PERFECT_CORP_API_KEY: 'PC', DERMAI_ANALYSIS_ENABLED: '1' });
  assert.deepEqual(Object.keys(c).sort(), ['demoMode', 'supabaseAnonKey', 'supabaseUrl']);
  assert.equal(c.supabaseUrl, 'https://x.supabase.co');
  assert.doesNotMatch(JSON.stringify(c), /SECRET|PC/);
  for (const bad of [{ SUPABASE_URL: 'http://x.supabase.co', SUPABASE_ANON_KEY: 'a' }, { SUPABASE_URL: 'https://x.supabase.co' }, { SUPABASE_ANON_KEY: 'a' }, { SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'a' }])
    assert.equal(publicSupabase(bad), null);
  assert.doesNotMatch(read('api/config-js.js') + read('server/config.js'), /env\.SUPABASE_SERVICE/);
});

test('U2 index.html charge le client de compte avant app.js ; aucune clé ni URL en dur', () => {
  const h = read('index.html');
  assert.ok(h.indexOf('js/account.js') > 0 && h.indexOf('js/account.js') < h.indexOf('js/app.js'));
  for (const f of ['index.html', 'js/app.js', 'js/account.js']) assert.doesNotMatch(read(f), /service_role|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|\.supabase\.co/i, f);
});

test('U3 le moteur reste pur : aucun compte, réseau ni Supabase dans js/engine', () => {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(__dirname, '../js/engine')).filter(x => x.endsWith('.js')))
    assert.doesNotMatch(strip(fs.readFileSync(f, 'utf8')), /supabase|DermaiAccount|\bfetch\(|localStorage|sessionStorage|XMLHttpRequest|session|password/i, f);
});

test('U4 le profil n\'est jamais copié dans le stockage local ; seules la session et la photo de démonstration y vivent', () => {
  const uses = [...code.matchAll(/(?:localStorage|sessionStorage)[^;\n]*/g)].map(m => m[0]);
  for (const u of uses) assert.match(u, /dermai_demo_photo|localStorage\}catch/, u);
  const acc = strip(read('js/account.js'));
  assert.match(acc, /SESSION_KEY = 'dermai\.session'/);
  assert.doesNotMatch(acc, /setItem\([^)]*(goals|profile|level)/i);
});

test('U5 profil : une seule source (state), persistance après chaque modification, aucun refetch à l\'affichage', () => {
  for (const a of ['goal', 'level', 'gentle']) assert.match(app, new RegExp('case `' + a + '`:[^\\n]*persist\\(\\)'), a);
  assert.equal((app.match(/ACCOUNT\.loadProfile\(\)/g) || []).length, 1, 'chargé une seule fois, à la connexion');
  assert.match(app, /bootAccount\(!initialRoute(,authRedirect)?\);\s*$/);
  const views = code.slice(code.indexOf('V.result='), code.indexOf('/* ---------- 5. NAVIGATION'));
  assert.doesNotMatch(views, /loadProfile|saveProfile|ACCOUNT\./);
  assert.match(app, /const profileForSave=/);
  assert.match(app, /Engine\.normalizeProfile\(\{goals:state\.goals/);
});

test('U6 déconnexion et changement de compte : tout l\'état privé est réinitialisé, rien d\'une session à l\'autre', () => {
  const reset = app.slice(app.indexOf('function resetPrivateState'), app.indexOf('const softStatus'));
  for (const k of ['state.goals=[]', 'state.level=``', 'state.gentle=false', 'state.exclusions=[]', 'state.cats=[]', 'SCANS.length=0', 'state.user.email=``']) assert.ok(reset.includes(k), k);
  assert.match(app, /async function logout\(\)\{\s*await ACCOUNT\.signOut\(\);authEpoch\+\+;/);
  assert.match(app, /resetPrivateState\(\);\s*await enterSession/);
});

test('U7 échec de sauvegarde : message humain, jamais « enregistrées » après un échec', () => {
  assert.match(app, /if\(!r\.ok\)\{if\(r\.error===DermaiAccount\.MSG\.sessionExpired\)\{expireSession\(\);break\}state\.save=\{status:`error`,message:r\.error\}/);
  assert.match(app, /Préférences enregistrées\./);
  assert.match(app, /Enregistrement…/);
  assert.match(app, /Chargement de votre profil…/);
  assert.match(app, /Vérification de votre session…/);
});

test('U8 aucune fausse promesse : pas d\'historique, d\'analyse ni de photo « sauvegardés »', () => {
  assert.doesNotMatch(app, /Vos analyses sont sauvegardées|Retrouvez votre historique|Vos photos sont enregistrées|photos sont sauvegardées/i);
  assert.match(app, /Créez votre compte pour retrouver vos préférences sur vos prochains appareils\./);
  assert.match(app, /Connecté en tant que :/);
});

test('U9 pas de fournisseur social ni d\'auth maison en mode réel ; démo inchangée', () => {
  const real = app.slice(app.indexOf('const authForm='), app.indexOf('V.welcome='));
  assert.doesNotMatch(real, /Google|Apple/);
  assert.match(real, /autocomplete="\$\{signup\?`new-password`:`current-password`\}"/);
  assert.match(app, /const demoSignup=/);
  assert.match(app, /state\.account=\{status:ACCOUNT&&ACCOUNT\.available\?`checking`:`off`/);
});

test('U10 la suppression de compte factice n\'est plus proposée lorsque les comptes sont actifs', () => {
  assert.match(app, /\$\{accountOn\(\)\?``:`<button class="rowlink" data-act="confirm" data-v="account">/);
});

test('U11 session expirée : retour visiteur, état privé effacé, invitation à se reconnecter', () => {
  assert.match(app, /function expireSession\(\)\{[\s\S]*resetPrivateState\(\);go\(`login`/);
  assert.match(app, /r\.error===DermaiAccount\.MSG\.sessionExpired\)\{expireSession\(\)/);
  assert.match(app, /else if\(r\.error===DermaiAccount\.MSG\.sessionExpired\)\{expireSession\(\);return\}/);
});
