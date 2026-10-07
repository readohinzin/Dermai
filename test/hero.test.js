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
  // chaque ligne du titre est un masque qui se lève (<span class="ln"><span>ligne</span></span>) : le texte reste complet et lisible sans animation
  const lines = h => [...h.matchAll(/<span class="ln" style="--l:\d"><span>([^<]+)<\/span><\/span>/g)].map(m => m[1]);
  assert.deepEqual(lines(html).slice(0, 3), ['Votre peau.', 'Votre analyse.', 'Votre routine.']);
  assert.deepEqual(lines(html).slice(3), ['Des scores clairs,', 'zone par zone.', 'Des actifs choisis', 'pour vous.', 'Votre peau évolue.', 'Suivez-la.']);
  assert.equal((html.match(/data-go="signup"/g) || []).length, 4, 'le bouton principal de chaque diapositive mène à l\'inscription (visiteur)');
  assert.equal(Hero.html({ ...ctx, cta: { go: 'scan' } }).match(/data-go="scan"/g).length, 4, 'connecté : vers l\'analyse');
  // mention visible retirée à la demande de l'équipe : l'équivalent texte reste lu par les lecteurs d'écran, la section « Ce que DERMAI observe » garde la sienne
  assert.doesNotMatch(html, /hc-cap|Illustration : personne fictive/);
  assert.equal((html.match(/<p class="u-sr">Exemple illustratif : personne fictive, scores d'exemple, aucun résultat réel\.<\/p>/g) || []).length, 4);
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

test('H4 portraits : six personnes fictives fournies (fond détouré), un visage différent par diapositive, repères propres à chaque visage, aucune image distante', () => {
  const imgs = [...html.matchAll(/<img [^>]*>/g)].map(m => m[0]);
  assert.equal(imgs.length, 4);
  assert.deepEqual(imgs.map(i => i.match(/src="img\/people\/(woman-\d)\.webp"/)[1]), ['woman-1', 'woman-2', 'woman-6', 'woman-3'], 'un visage différent à chaque diapositive');
  for (const i of imgs) { assert.match(i, /alt="Portrait fictif d'une femme[^"]+"/); assert.match(i, /width="504" height="504"/); }
  assert.match(imgs[0], /fetchpriority="high"/); assert.match(imgs[1], /loading="lazy"/);
  assert.doesNotMatch(html, /src="https?:/);
  const files = fs.readdirSync(path.join(root, 'img/people')).sort();
  assert.deepEqual(files, [1, 2, 3, 4, 5, 6].map(n => `woman-${n}.webp`), 'six portraits, aucun fichier en trop');
  for (const f of files) {
    const b = fs.readFileSync(path.join(root, 'img/people', f));
    assert.equal(b.slice(0, 4).toString('latin1'), 'RIFF', f); assert.equal(b.slice(8, 12).toString('latin1'), 'WEBP', f);
    assert.equal(b.slice(12, 16).toString('latin1'), 'VP8X', f); assert.ok((b[20] & 0x10) !== 0, f + ' : canal alpha (fond détouré)');
    assert.equal(1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 504, f); assert.equal(1 + (b[27] | (b[28] << 8) | (b[29] << 16)), 504, f);
    assert.ok(b.length < 40000, f + ' : poids ' + b.length);
  }
  assert.equal(fs.existsSync(path.join(root, 'img/hero')), false, 'l\'ancien portrait de la bannière est retiré');
  // repères : chaque visage a ses yeux, sa bouche, son ovale, tous dans la tuile et dans un ordre cohérent
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const p = Hero.PEOPLE[n]; assert.ok(p, 'repères du visage ' + n);
    for (const pt of [p.eL, p.eR, p.m]) assert.ok(pt.every(v => v > 0 && v < 504));
    assert.ok(p.eR[0] > p.eL[0] + 80 && p.m[1] > Math.max(p.eL[1], p.eR[1]) + 90, 'bouche sous les yeux, yeux écartés');
    assert.ok(p.f[2] > 100 && p.f[3] > 150 && p.f[0] - p.f[2] > 0 && p.f[0] + p.f[2] < 504);
  }
  // le cadre de scan suit l'ovale du visage de la diapositive 1 (visage 1), pas un ovale figé
  const L1 = Hero.lm(1); assert.match(html, new RegExp(`<ellipse cx="${L1.f[0]}" cy="${L1.f[1]}" rx="${L1.f[2]}" ry="${L1.f[3]}"/>`));
  // les ancrages tombent sur le visage, y compris tête penchée (visage 2)
  const A = Hero.anchor(Hero.lm(2), 'eR', 0.19, 0.63); assert.ok(A[0] > 600 && A[0] < 900 && A[1] > 500 && A[1] < 800, JSON.stringify(A));
  assert.ok(!/NaN|undefined/.test(html));
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
  assert.match(css, /\.hc-slide\.is-active \.hc-h \.ln>span\{animation:hcMask/);
  assert.doesNotMatch(css, /\.hc-h \.ln>span\{[^}]*transform:/, 'le texte du titre n\'est jamais décalé hors animation');
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
  assert.match(app, /DermaiHero\.html\(\{cta:\{go:signedIn\(\)\?`scan`:`signup`\},labels:SkinModel\.METRIC_LABELS,actives:heroActives\(\),sparkle:/);
  assert.match(app, /const HERO_ACTIVES=\[`niacinamide`,`azelaic`,`vitamin_c`,`hyaluronic`,`ceramides`\]/);
  assert.match(app, /function render\(keep\)\{\s*const y=window\.scrollY;\s*stopHero\(\);/);
  assert.match(app, /if\(state\.route===`landing`\)\{const el=document\.querySelector\(`\[data-hc\]`\);if\(el\)heroCtl=DermaiHero\.init\(el,\{reduced:/);
  for (const id of ['how', 'observe', 'routine-sec', 'evolve']) assert.match(app, new RegExp(`id="${id}"`), id);
  for (const s of Hero.SLIDES) assert.ok(app.includes(`id="${s.more[0]}"`), 'cible du bouton secondaire : ' + s.more[0]);
  // l'ancien visage du hero n'est plus utilisé dans la bannière, la section « Ce que DERMAI observe » garde le sien ; le trio de visages est décoratif et décrit une fois
  assert.equal((app.match(/<div class="facebox">\$\{portrait\(/g) || []).length, 1);
  assert.match(app, /\$\{faces\(\[4,5,1\]\)\}/); assert.match(app, /role="img" aria-label="Trois portraits fictifs de femmes/); assert.match(app, /<span class="fc fc--\$\{i\+1\}" aria-hidden="true"><img src="\$\{DermaiHero\.personSrc\(n\)\}" width="504" height="504" alt=""/);
});
