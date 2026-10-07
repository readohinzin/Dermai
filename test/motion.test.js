'use strict';
/* Motion design (étape 14C) : règles, fonctions pures, garanties de sécurité (rien de caché sans script ni avec « moins d'animations »), branchement.
   Le comportement réel (apparitions, compteurs, courbes, parallaxe, ondulation, mouvement réduit) est éprouvé dans un vrai navigateur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Motion = require('../js/motion.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('M1 règles : chaque page animée a ses règles, chaque effet est connu, les sélecteurs visent des éléments qui existent', () => {
  const app = read('js/app.js') + read('js/hero.js');
  const routes = Object.keys(Motion.RULES);
  for (const r of ['landing', 'result', 'routine', 'products', 'actives', 'progress', 'home']) assert.ok(routes.includes(r), r);
  const classes = new Set();
  for (const [route, rules] of Object.entries(Motion.RULES)) for (const [sel, effect, o] of rules) {
    assert.ok(Motion.ATTR[effect], `${route} : effet inconnu ${effect}`);
    assert.ok(typeof sel === 'string' && sel.length > 2);
    if (o) for (const k of Object.keys(o)) assert.ok(['stagger', 'step', 'max', 'delay', 'f'].includes(k), k);
    for (const m of sel.matchAll(/\.([a-z][\w-]*)/g)) classes.add(m[1]);
  }
  // chaque classe visée existe dans le balisage de l'application (une règle qui ne vise plus rien est une règle morte)
  const css = read('css/components/score.css') + read('css/components/card.css') + read('css/components/result.css') + read('css/legacy.css');
  const dead = [...classes].filter(c => !app.includes(c) && !css.includes('.' + c));
  assert.deepEqual(dead, [], 'classes visées introuvables : ' + dead.join(', '));
});

test('M2 fonctions pures : cascade plafonnée, compteurs numériques seulement', () => {
  assert.equal(Motion.delayOf(0, {}), 0); assert.equal(Motion.delayOf(5, {}), 0, 'sans cascade, pas de retard');
  assert.equal(Motion.delayOf(3, { stagger: 1, step: 100 }), 300);
  assert.equal(Motion.delayOf(50, { stagger: 1, step: 100, max: 5, delay: 40 }), 540, 'la cascade est plafonnée : la dernière carte ne se fait jamais attendre');
  assert.equal(Motion.delayOf(2, { delay: 200 }), 200);
  assert.deepEqual(Motion.countOf('72'), { value: 72, decimals: 0 });
  assert.deepEqual(Motion.countOf(' 8,5 '), { value: 8.5, decimals: 1 });
  assert.equal(Motion.countOf('72/100'), null); assert.equal(Motion.countOf('–'), null); assert.equal(Motion.countOf(''), null);
  assert.equal(Motion.skip({ closest: s => (s === '.hc' ? {} : null), parentElement: null }), true, 'la bannière a ses propres animations');
  assert.equal(Motion.skip({ closest: () => null, parentElement: { classList: { contains: c => c === 'col' } } }), true, 'les enfants de .col sont déjà animés par la feuille historique');
  assert.equal(Motion.skip({ closest: () => null, parentElement: { classList: { contains: () => false } } }), false);
});

test('M3 sécurité : rien n\'est caché sans script ; aucun état de départ hors html.m-on ; mouvement réduit = rien d\'installé', () => {
  const css = read('css/components/motion.css');
  const rules = strip(css).replace(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g, '').split('}').map(r => r.trim()).filter(Boolean);
  for (const r of rules) {
    const [sel, body] = r.split('{'); if (!body) continue;
    if (/\[data-mx?(=|\])/.test(sel) && !/\.is-in/.test(sel)) assert.match(sel, /^\.m-on /, 'état de départ sans html.m-on : ' + sel);
  }
  assert.match(css, /\.m-on \[data-m\]\{opacity:0/);
  const js = strip(read('js/motion.js'));
  assert.match(js, /if \(typeof IntersectionObserver !== 'function'\) return ctl;/, 'navigateur ancien : on n\'installe rien (et la classe m-on n\'est jamais posée)');
  assert.doesNotMatch(js, /reduced|prefers-reduced-motion|matchMedia\('\(prefers/, 'les animations sont toujours actives : aucune sortie « mouvement réduit »');
  assert.ok(js.indexOf("html.classList.add('m-on')") > js.indexOf('return ctl;'), 'm-on n\'est posé qu\'après la sortie anticipée');
  assert.match(js, /fallback = setTimeout/, 'filet de sécurité : rien ne reste caché');
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|eval\(|innerHTML\s*=|document\.write/, 'aucun réseau, aucune injection');
  assert.doesNotMatch(js, /localStorage|sessionStorage/, 'aucun stockage : plus de préférence d\'animations');
  assert.doesNotMatch(css, /width\s*:\s*\d+px\s*;[^}]*transition|transition[^};]*\b(width|height|top|left|margin|padding)\b/, 'jamais de transition sur une propriété qui force la mise en page');
});

test('M4 performance : seuls transform, opacity, translate, stroke-dashoffset sont animés ; will-change réservé aux éléments en attente', () => {
  const css = strip(read('css/components/motion.css'));
  for (const m of css.matchAll(/transition:([^;}]+)/g)) for (const part of m[1].split(/,(?![^()]*\))/)) { const prop = part.trim().split(/\s+/)[0]; assert.ok(['transform', 'opacity', 'translate', 'rotate', 'stroke-dashoffset', 'box-shadow', 'background-color', 'border-color'].includes(prop), 'propriété animée : ' + prop); }
  const wc = [...css.matchAll(/will-change:[^;}]+/g)].map(m => m[0]);
  assert.deepEqual(wc, ['will-change:opacity,transform'], 'will-change : un seul usage, sur [data-m] avant l\'effet');
  assert.match(read('js/motion.js'), /el\.removeAttribute\('data-m'\)/, 'l\'attribut (donc will-change) est retiré après l\'effet');
  assert.match(read('js/motion.js'), /passive: true/);
});

test('M5 effets continus : barre de lecture, en-tête, parallaxe au pointeur seulement sur pointeur fin, bouton magnétique, ondulation', () => {
  const js = read('js/motion.js'), css = read('css/components/motion.css'), hero = read('css/components/hero.css');
  assert.match(js, /matchMedia\('\(hover:hover\) and \(pointer:fine\)'\)/);
  assert.match(js, /if \(e\.pointerType !== 'mouse'\) return;/);
  assert.match(js, /\.l-top/); assert.match(js, /id = 'mprog'/); assert.match(js, /m-ripple/); assert.match(js, /data-mag/);
  assert.match(css, /#mprog\{[^}]*transform:scaleX\(0\)/); assert.match(css, /\.m-ripple\{[^}]*animation:mRipple/);
  assert.match(css, /\.l-top\.is-stuck/);
  for (const v of ['--px', '--py', '--sy']) assert.ok(hero.includes(v) && js.includes(v), v);
  assert.match(hero, /\.hc-pic\{translate:/, 'la parallaxe utilise la propriété translate, indépendante des animations transform');
  assert.match(css, /@media \(hover:hover\)\{[\s\S]*\.pcard:hover/, 'survol réservé aux appareils à pointeur');
});

test('M6 branchement : scripts dans l\'ordre, rendu → scan, re-rendu conservé = seul le bas de page s\'anime, import CSS dans la couche components', () => {
  const idx = read('index.html'), app = read('js/app.js'), styles = read('css/styles.css');
  assert.ok(idx.indexOf('js/motion.js') > idx.indexOf('js/hero.js') && idx.indexOf('js/motion.js') < idx.indexOf('js/app.js'));
  assert.match(styles, /@import url\("components\/motion\.css"\) layer\(components\);/);
  assert.match(app, /after\(!!keep,y\);/); assert.match(app, /function after\(keep,y\)\{/);
  assert.match(app, /motionCtl\.scan\(\$app,\{route:state\.route,key:state\.route\+`:`\+\(state\.param==null\?``:state\.param\),keep:!!keep,y\}\)/);
  assert.match(app, /DermaiMotion\.init\(\)/);
  const js = read('js/motion.js');
  assert.match(js, /const replay = !!\(o\.keep && o\.key === lastKey && played\)/);
});

test('M7 aucun défilement horizontal causé par les éléments en attente d\'apparition', () => {
  const css = read('css/components/motion.css');
  assert.match(css, /\.m-on #app\{overflow-x:clip\}/);
  assert.match(css, /\[data-m=left\]\{transform:translateX\(-64px\)\}/); assert.match(css, /\[data-m=right\]\{transform:translateX\(64px\)\}/);
});

test('M8 plus d\'interrupteur : les animations sont actives pour tout le monde, téléphone et PC', () => {
  for (const f of ['css/legacy.css', 'css/base.css', 'css/components/motion.css', 'css/components/hero.css']) assert.doesNotMatch(read(f), /data-motion|prefers-reduced-motion/, f + ' : aucune règle ne coupe les animations');
  const app = read('js/app.js');
  for (const re of [/motionPrefUI/, /motion-pref/, /Animations<\/h2>/, /DermaiMotion\.(getPref|setPref|reduced|apply|osReduces)/]) assert.doesNotMatch(app, re);
  for (const k of ['getPref', 'setPref', 'osReduces', 'isReduced', 'reduced', 'apply', 'KEY']) assert.equal(Motion[k], undefined, k + ' supprimé');
  assert.doesNotMatch(read('css/components/motion.css'), /\.motion-pref/);
  assert.match(app, /DermaiHero\.init\(el,\{reduced:false,/, 'le carrousel démarre toujours');
});

test('M8b un re-rendu qui conserve l\'état (accueil redessiné après la vérification du compte) anime encore ce qui est sous la ligne de flottaison', () => {
  const js = read('js/motion.js'), app = read('js/app.js');
  assert.match(js, /const replay = !!\(o\.keep && o\.key === lastKey && played\)/);
  assert.match(js, /if \(replay && el\.getBoundingClientRect\(\)\.top \+ window\.scrollY - \(o\.y == null/);
  assert.doesNotMatch(js, /if \(o\.keep && o\.key === lastKey && played\) \{ kick\(\); return; \}/, 'plus de sortie qui laisse le nouveau DOM sans aucun balisage');
  assert.match(app, /after\(!!keep,y\)/); assert.match(app, /keep:!!keep,y\}\)/);
});

test('M9 amplitude : les mouvements sont perceptibles (décalages et durées minimaux) et l\'ambiance est permanente', () => {
  const css = read('css/components/motion.css'), hero = read('css/components/hero.css');
  const px = re => Math.abs(+css.match(re)[1]);
  assert.ok(px(/\[data-m=rise\]\{transform:translateY\((-?\d+)px\)/) >= 56 && px(/\[data-m=left\]\{transform:translateX\((-?\d+)px\)/) >= 56);
  assert.match(css, /@keyframes rise\{from\{opacity:0;transform:translateY\(54px\)/, 'l\'entrée de page historique (14 px) est remplacée');
  assert.match(css, /\.w>span\{display:inline-block\}/); assert.match(css, /@keyframes mqScroll/);
  for (const re of [/hcWipe/, /hcBreathe/, /hcPulse/, /hcChipBounce/, /\.hc::after\{[^}]*radial-gradient/]) assert.match(hero, re);
  assert.match(hero, /hcFloat 9s/);                       // fonds vivants, rapides
  assert.match(css, /\.pgrid,\.hc-art\{perspective:1100px\}/);
  assert.ok(Motion.RULES.landing.some(r => r[1] === 'words') && Motion.RULES.landing.some(r => r[1] === 'par'));
});

test('M10 mouvement continu sous la bannière : chaque section vit sans attendre le défilement', () => {
  const css = read('css/components/motion.css');
  for (const re of [/mDrift/, /mBeat/, /mSweep/, /mBob/, /mScan/, /mTick/, /\.sec::before/, /var\(--sp,0\)/, /\.facebox::after/, /\.c-bar__fill::after/]) assert.match(css, re);
  assert.match(read('js/motion.js'), /setProperty\('--sp'/);
  for (const k of ['mDrift', 'mBeat', 'mSweep', 'mBob', 'mScan', 'mTick']) assert.doesNotMatch(css.match(new RegExp('@keyframes ' + k + '\\{[^@]*?\\}\\s*\\}'))[0], /transform/, k + ' : scale/translate, pas transform (se compose avec les apparitions)');
});
