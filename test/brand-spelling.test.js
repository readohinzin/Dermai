'use strict';
/* Écriture de la marque : « DermAI » partout dans l'application, sauf le logo (image). Les identifiants, variables d'environnement, clés de stockage, adresses et noms de fichiers ne changent pas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const OLD = new RegExp('DERM' + 'AI(?![A-Za-z0-9_])');          // l'ancienne écriture, seule, sans suite d'identifiant ni de variable d'environnement
const tracked = execSync('git ls-files', { cwd: ROOT }).toString().split('\n').filter(f => /\.(js|html|css|json|md|txt)$/.test(f) && !/^(supabase|img|node_modules)\//.test(f));

test('BR1 plus aucune ancienne écriture de la marque dans l\'application, le serveur, les outils, les tests et la documentation', () => {
  assert.ok(tracked.length > 200);
  for (const f of tracked) assert.doesNotMatch(read(f), OLD, f);
  assert.match(read('index.html'), /<title>DermAI, analyse de peau/); assert.match(read('index.html'), /og:site_name" content="DermAI"/);
  assert.match(read('js/export-pdf.js'), /text\('DermAI', MARGIN/); assert.match(read('js/export-view.js'), /Mon analyse DermAI/);
});

test('BR2 ce qui ne change pas : variables d\'environnement, clés de stockage, identifiants de code, adresses', () => {
  const cfg = read('server/config.js');
  for (const v of ['DERMAI_DEMO_MODE', 'DERMAI_ANALYSIS_ENABLED', 'DERMAI_MAX_ANALYSES_PER_PERIOD']) assert.ok(read('.env.example').includes(v) || cfg.includes(v), v);
  assert.match(read('api/config-js.js'), /window\.DERMAI_CONFIG/);
  for (const [f, key] of [['js/account.js', "'dermai.session'"], ['js/skin-tone.js', "'dermai.skinTone'"], ['js/market.js', "'dermai.market'"], ['js/pwa-install.js', "'dermai.pwa.dismissed'"], ['js/care-program.js', "'dermai.care.'"]]) assert.ok(read(f).includes(key), f + ' ' + key);
  for (const id of ['DermaiEngine', 'DermaiInsight', 'DermaiTone', 'DermaiConfidence', 'DermaiPhotoCheck']) assert.ok(tracked.some(f => read(f).includes(id)), id);
  assert.match(read('index.html'), /dermai-afric\.vercel\.app/);
});

test('BR3 le logo n\'est pas touché : images de marque présentes ; le mot en majuscules des étiquettes garde « DermAI »', () => {
  for (const f of ['img/brand/dermai-logo-360.webp', 'img/brand/dermai-mark-256.webp', 'img/brand/og-square-512.jpg']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  const { DermaiInsight } = require('../js/insight-view.js'); const copy = require('../js/engine/copy.fr.js');
  global.SkinModel = require('../js/skin-model.js'); global.DermaiEngine = Object.assign({}, require('../js/engine/index.js'), { copy, indicatorsData: require('../js/engine/data/indicators.js'), decisionData: require('../js/engine/data/decision.js') });
  const { run } = require('./helpers/engine.js'); const r = run({ hydration: 20 }, { rawMap: { hydration: 20 }, rawFill: 80 }, { goals: [] });
  const html = DermaiInsight.found(r.synthesis);
  assert.match(html, /<h3 class="c-insight__label">Ce que <span class="c-brand">DermAI<\/span> retient<\/h3>/);
  assert.match(read('css/components/result.css'), /\.c-brand\{text-transform:none\}/);
});
