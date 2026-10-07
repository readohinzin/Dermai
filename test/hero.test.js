'use strict';
/* Bannière d'accueil en carrousel (étape 14C) : balisage, accessibilité, contenu honnête, images du projet, branchement dans l'application. Le comportement
   (défilement, pause, clavier, mouvement réduit, responsive) est éprouvé dans un vrai navigateur ; ici, tout ce qui se vérifie sans navigateur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Hero = require('../js/hero.js');
const M = require('../js/skin-model.js');
const actives = require('../js/engine/actives.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const strip = code => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const ACTIVES = ['niacinamide', 'azelaic', 'vitamin_c', 'hyaluronic', 'ceramides'].map(id => actives.byId(id)).map(a => ({ label: a.label, summary: a.summary }));
const ctx = { cta: { go: 'signup' }, labels: M.METRIC_LABELS, actives: ACTIVES, sparkle: '', extraFirst: '' };
const html = Hero.html(ctx);

test('H1 balisage : région carrousel, 4 diapositives étiquetées, un seul h1, seule la première exposée, commandes accessibles', () => {
  assert.equal((html.match(/class="hc-slide /g) || []).length, 4);
  assert.equal((html.match(/<h1 /g) || []).length, 1); assert.equal((html.match(/<h2 /g) || []).length, 3);
  assert.match(html, /<section class="hc" data-hc aria-roledescription="carrousel" aria-label="Présentation de DERMAI">/);
  for (let i = 1; i <= 4; i++) assert.match(html, new RegExp(`role="group" aria-roledescription="diapositive" aria-label="${i} sur 4"`));
  assert.equal((html.match(/aria-hidden="true" inert>/g) || []).length, 3, 'les diapositives masquées sont inertes');
  assert.equal((html.match(/data-hc-go="\d"/g) || []).length, 4);
  for (let i = 1; i <= 4; i++) assert.match(html, new RegExp(`aria-label="Diapositive ${i} sur 4"`));
  assert.match(html, /data-hc-pause aria-label="Mettre en pause le défilement"/);
  assert.match(html, /aria-live="off"/);
  assert.equal((html.match(/type="button"/g) || []).length, 5, 'tous les boutons de commande sont des boutons');
});

test('H2 contenu : titres, boutons et mention d\'illustration ; textes en français, sans tiret cadratin ; scores d\'exemple identifiés', () => {
  assert.match(html, /Votre peau\.<br>Votre analyse\.<br>Votre routine\./);
  assert.match(html, /Des scores clairs,<br>zone par zone\./);
  assert.match(html, /Des actifs choisis<br>pour vous\./);
  assert.match(html, /Votre peau évolue\.<br>Suivez-la\./);
  assert.equal((html.match(/data-go="signup"/g) || []).length, 4, 'le bouton principal de chaque diapositive mène à l\'inscription (visiteur)');
  assert.equal(Hero.html({ ...ctx, cta: { go: 'scan' } }).match(/data-go="scan"/g).length, 4, 'connecté : vers l\'analyse');
  assert.match(html, /Illustration : personne fictive, aucun résultat réel\./);
  assert.doesNotMatch(Hero.html({ ...ctx, note: false }), /hc-cap/, 'pas de mention en démo (étiquette démo à la place)');
  assert.doesNotMatch(html, /[—–]/, 'aucun tiret cadratin');
  assert.match(html, /<span class="xp">Exemple<\/span>/, 'le suivi de score est marqué « Exemple »');
  assert.ok(Hero.BUBBLES.length === 6 && Hero.BUBBLES.every(b => Number.isInteger(b.v) && b.v >= 0 && b.v <= 100 && M.METRIC_KEYS.includes(b.k)), 'scores 0 à 100 sur de vrais indicateurs');
  for (const b of Hero.BUBBLES) assert.ok(html.includes(M.METRIC_LABELS[b.k]), b.k);
});

test('H3 aucune promesse inventée : pas de pourcentage de correspondance, pas de marque ni de photo de produit, actifs réels seulement', () => {
  assert.doesNotMatch(html, /\d\s?%\s?(de )?(correspondance|compatib)/i);
  assert.doesNotMatch(html, /The Ordinary|CeraVe|La Roche|Vichy|img\/products\//i, 'aucune image ni marque commerciale sur la bannière');
  for (const a of ACTIVES) { assert.ok(html.includes(a.label.replace(/'/g, '&#39;')) || html.includes(a.label), a.label); assert.ok(a.summary.length > 3); }
  assert.deepEqual(['niacinamide', 'azelaic', 'vitamin_c', 'hyaluronic', 'ceramides'].filter(id => !actives.isValidated(actives.byId(id))), [], 'seuls des actifs validés sont montrés');
  assert.doesNotMatch(html, /retinoid|rétin/i);
  assert.match(html, /Exemples d'actifs :/, 'équivalent texte des pastilles pour les lecteurs d\'écran');
});

test('H4 portraits : une seule image du projet (personne fictive), aucune image distante, texte alternatif descriptif, WebP transparent léger', () => {
  const imgs = [...html.matchAll(/<img [^>]*>/g)].map(m => m[0]);
  assert.equal(imgs.length, 4);
  for (const i of imgs) { assert.match(i, /src="img\/hero\/portrait-cutout\.webp"/); assert.match(i, /alt="Portrait fictif d'une femme[^"]+"/); assert.match(i, /width="900" height="900"/); }
  assert.match(imgs[0], /fetchpriority="high"/); assert.match(imgs[1], /loading="lazy"/);
  assert.doesNotMatch(html, /src="https?:/);
  const b = fs.readFileSync(path.join(root, Hero.PORTRAIT));
  assert.equal(b.slice(0, 4).toString('latin1'), 'RIFF'); assert.equal(b.slice(8, 12).toString('latin1'), 'WEBP');
  assert.equal(b.slice(12, 16).toString('latin1'), 'VP8X'); assert.ok((b[20] & 0x10) !== 0, 'canal alpha');
  assert.equal(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 900);
  assert.ok(b.length < 120000, 'poids ' + b.length);
  // la seule personne montrée est celle du projet (déjà présentée comme fictive) : aucun autre fichier portrait dans la bannière
  assert.deepEqual(fs.readdirSync(path.join(root, 'img/hero')), ['portrait-cutout.webp']);
});

test('H5 durée, commandes et accessibilité du pilote : pause, hors écran, onglet caché, mouvement réduit, clavier, balayage', () => {
  const js = strip(read('js/hero.js'));
  assert.equal(Hero.DURATION, 7000);
  for (const re of [/visibilitychange/, /IntersectionObserver/, /pointerenter/, /focusin/, /:focus-visible/, /ArrowRight/, /ArrowLeft/, /pointerdown/, /aria-hidden/, /inert/, /const reduced = !!opts\.reduced/, /playing = !reduced/, /stop\(\)/]) assert.match(js, re);
  assert.match(js, /if \(!rootEl\.contains\(e\.relatedTarget\)\)/, 'le focus ne se perd pas entre deux boutons de la bannière');
  assert.doesNotMatch(js, /localStorage|fetch\(|XMLHttpRequest|eval\(|innerHTML\s*=/, 'aucun accès réseau, aucun stockage, aucune injection');
});

test('H6 CSS : thèmes pastel, animations limitées à la diapositive active, commandes de 44 px, mouvement réduit couvert', () => {
  const css = read('css/components/hero.css');
  for (const t of ['rose', 'lilac', 'sand', 'sky']) assert.match(css, new RegExp(`\\.hc-t-${t}\\{`));
  assert.match(css, /\.hc-slide\.is-active \.hc-h\{animation:/);
  assert.doesNotMatch(css.replace(/@keyframes[^{]+\{[\s\S]*?\}\s*\}/g, ''), /\.hc-slide(?!\.is-active)[^{]*\{[^}]*animation:/, 'aucune animation hors diapositive active');
  assert.match(css, /\.hc-pause,\.hc-dot\{width:44px;height:44px/);
  assert.match(css, /\.hc-stage\{display:grid\}/); assert.match(css, /\.hc-slide\{grid-area:1\/1/);
  assert.match(read('css/base.css'), /prefers-reduced-motion:reduce/);
  assert.match(read('css/styles.css'), /@import url\("components\/hero\.css"\) layer\(components\);/);
  assert.doesNotMatch(css, /\.(?:lvl|lb|prio|prio-top|prio-sub|mini|ex|lv-change|dbl)(?![\w-])/, 'aucune classe de l\'ancien système de niveaux');
});

test('H7 branchement : module chargé avant l\'application, démarré à l\'accueil, arrêté à chaque rendu, cibles de défilement présentes', () => {
  const app = read('js/app.js'), idx = read('index.html');
  assert.ok(idx.indexOf('js/hero.js') > 0 && idx.indexOf('js/hero.js') < idx.indexOf('js/app.js'));
  assert.match(app, /DermaiHero\.html\(\{cta:\{go:signedIn\(\)\?`scan`:`signup`\},labels:SkinModel\.METRIC_LABELS,actives:heroActives\(\),note:!DEMO_MODE/);
  assert.match(app, /const HERO_ACTIVES=\[`niacinamide`,`azelaic`,`vitamin_c`,`hyaluronic`,`ceramides`\]/);
  assert.match(app, /function render\(keep\)\{\s*const y=window\.scrollY;\s*stopHero\(\);/);
  assert.match(app, /if\(state\.route===`landing`\)\{const el=document\.querySelector\(`\[data-hc\]`\);if\(el\)heroCtl=DermaiHero\.init\(el,\{reduced:/);
  for (const id of ['how', 'observe', 'routine-sec', 'evolve']) assert.match(app, new RegExp(`id="${id}"`), id);
  for (const s of Hero.SLIDES) assert.ok(app.includes(`id="${s.more[0]}"`), 'cible du bouton secondaire : ' + s.more[0]);
  // l'ancien visage du hero n'est plus utilisé dans la bannière, la section « Ce que DERMAI observe » garde le sien
  assert.equal((app.match(/<div class="facebox">\$\{portrait\(/g) || []).length, 1);
});
