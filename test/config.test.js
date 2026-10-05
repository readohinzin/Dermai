'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { isDemoMode } = require('../server/config');
const handler = require('../api/config-js.js');

test('DERMAI_DEMO_MODE : démo par défaut (absente, vide, inconnue)', () => {
  for (const v of [undefined, '', '  ', 'true', '1', 'oui', 'nimporte', 'TRUE']) {
    assert.equal(isDemoMode({ DERMAI_DEMO_MODE: v }), true, `valeur « ${v} »`);
  }
  assert.equal(isDemoMode({}), true);
});

test('DERMAI_DEMO_MODE : seules les valeurs explicites false/0/no/off désactivent la démo', () => {
  for (const v of ['false', 'FALSE', ' False ', '0', 'no', 'off']) {
    assert.equal(isDemoMode({ DERMAI_DEMO_MODE: v }), false, `valeur « ${v} »`);
  }
});

function call(method, env) {
  const saved = process.env.DERMAI_DEMO_MODE;
  if (env === undefined) delete process.env.DERMAI_DEMO_MODE; else process.env.DERMAI_DEMO_MODE = env;
  try {
    const h = {}; let body = '';
    const res = { statusCode: 0, setHeader(k, v) { h[k.toLowerCase()] = v; }, end(b) { body = b || ''; } };
    handler({ method }, res);
    return { status: res.statusCode, headers: h, body };
  } finally { if (saved === undefined) delete process.env.DERMAI_DEMO_MODE; else process.env.DERMAI_DEMO_MODE = saved; }
}

test('/api/config-js : démo vrai par défaut, faux seulement si DERMAI_DEMO_MODE=false', () => {
  assert.equal(call('GET', undefined).body.trim(), 'window.DERMAI_CONFIG={"demoMode":true};');
  assert.equal(call('GET', 'false').body.trim(), 'window.DERMAI_CONFIG={"demoMode":false};');
});

test('/api/config-js : JavaScript, jamais mis en cache, rien d\'autre que demoMode', () => {
  const r = call('GET', 'false');
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /javascript/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(!/KEY|SECRET|Bearer/i.test(r.body));
  assert.deepEqual(Object.keys(JSON.parse(r.body.match(/=(.*);/)[1])), ['demoMode']);
});

test('/api/config-js : HEAD sans corps, POST refusé', () => {
  assert.equal(call('HEAD', undefined).body, '');
  assert.equal(call('POST', undefined).status, 405);
});

test('vercel.json : plus de rewrite, la configuration des fonctions est conservée', () => {
  const v = JSON.parse(fs.readFileSync(__dirname + '/../vercel.json', 'utf8'));
  assert.equal(v.rewrites, undefined);
  assert.deepEqual(v.functions, { 'api/skin-analysis.js': { maxDuration: 60 } });
});

test('index.html charge /api/config-js (directement) avant app.js, plus /js/config.js', () => {
  const h = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  assert.ok(h.includes('<script src="/api/config-js"></script>'));
  assert.ok(!h.includes('js/config.js'));
  assert.ok(h.indexOf('/api/config-js') < h.indexOf('js/app.js'));
});

test('la fonction config-js existe dans api/ (route /api/config-js)', () => {
  assert.ok(fs.existsSync(__dirname + '/../api/config-js.js'));
});

/* La ligne réelle de js/app.js, évaluée avec différents window. */
function demoModeFor(win) {
  const line = fs.readFileSync(__dirname + '/../js/app.js', 'utf8').split('\n').find(l => l.startsWith('const DEMO_MODE'));
  assert.ok(line, 'ligne DEMO_MODE introuvable');
  return vm.runInNewContext(line.replace('const DEMO_MODE', 'var DEMO_MODE') + '\nDEMO_MODE', { window: win });
}

test('js/app.js : DEMO_MODE vrai sauf demoMode === false explicite', () => {
  assert.equal(demoModeFor({}), true);                                   // config.js absent ou en échec
  assert.equal(demoModeFor({ DERMAI_CONFIG: {} }), true);
  assert.equal(demoModeFor({ DERMAI_CONFIG: { demoMode: true } }), true);
  assert.equal(demoModeFor({ DERMAI_CONFIG: { demoMode: 'false' } }), true);   // chaîne : pas un faux explicite
  assert.equal(demoModeFor({ DERMAI_CONFIG: { demoMode: 0 } }), true);
  assert.equal(demoModeFor({ DERMAI_CONFIG: null }), true);
  assert.equal(demoModeFor({ DERMAI_CONFIG: { demoMode: false } }), false);
});
