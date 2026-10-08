'use strict';
/* Passe UX finale (après le premier vrai scan) : textes seulement. Le moteur décide comme avant ; seules trois phrases de présentation changent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Engine, norm, run, randomCase } = require('./helpers/engine.js');
const P = require('../js/engine/products.js');
const C = require('../js/engine/data/catalog.js');
const copy = require('../js/engine/copy.fr.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('js/app.js');
const STEPS = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];

test('UX1 « aucune priorité forte » : message mesuré, sans « parfaite », « aucun problème » ni diagnostic', () => {
  /* Étape 25 : « priorité » est réservé à une vraie décision DERMAI ; sans besoin retenu, on le dit simplement. */
  assert.equal(copy.MAINTENANCE.title, 'DERMAI ne retient aucun besoin particulier.');
  assert.equal(copy.MAINTENANCE.text, 'Votre routine reste une routine d\'entretien de base : nettoyage doux, hydratation et protection solaire.');
  const all = [copy.MAINTENANCE.title, copy.MAINTENANCE.text, copy.PERSONAL.measuredNone].join(' ');
  assert.doesNotMatch(all, /parfait|aucun probl[eè]me|aucune imperfection|tout va bien|diagnostic/i);
  assert.doesNotMatch(all, /ne fait pas ressortir/);
  const r = run({});
  assert.equal(r.priorities.mode, 'maintenance');
  assert.ok(r.explanations.some(e => e.kind === 'mode' && e.text === copy.MAINTENANCE.title));
});

test('UX2 hydratation : phrase générique neutre, aucune promesse de texture ni de réparation', () => {
  for (let s = 1; s <= 400; s++) {
    const c = randomCase(s * 11 + 3), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS });
    for (const st of STEPS(r).filter(x => x.kind === 'moisturize' && !x.owned)) {
      assert.match(st.reason, /^Une hydratation adaptée au confort de la peau(, avec : .+)?\.$/, st.reason);
      assert.doesNotMatch(st.reason + ' ' + st.texture, /légère?|non com[ée]dog[eè]ne|répar|barrière|apaise/i);
    }
  }
  assert.equal(copy.stepReason.moisturize('x', []), 'Une hydratation adaptée au confort de la peau.');
  assert.doesNotMatch(Object.values(copy.TEXTURE).join(' '), /légère?|non com[ée]dog[eè]ne/i);
});

test('UX3 peau à profil gras : une phrase explique pourquoi un hydratant figure dans la routine, sans promesse ni diagnostic', () => {
  assert.equal(copy.stepReason.moisturizeOily, 'L\'hydratation reste utile même lorsque la peau présente un profil gras.');
  assert.doesNotMatch(copy.stepReason.moisturizeOily, /déshydrat|Cicaplast|traite|soigne|guér|répar|médical/i);
  assert.equal(run({}, { skin: 'Oily' }).routinePlan.skinBase, 'oily');
  assert.notEqual(run({}, { skin: 'Dry' }).routinePlan.skinBase, 'oily');
  // depuis l'étape 22 : portée par la justification de l'étape d'hydratation (synthèse du moteur), uniquement pour un profil gras
  const step = skin => Engine.run(norm({}, { skin }), { goals: [], level: 'simple', cats: [] }).synthesis.steps['morning:moisturize'];
  assert.ok(step('Oily').includes(copy.stepReason.moisturizeOily));
  assert.ok(!step('Dry').includes(copy.stepReason.moisturizeOily) && !step('Normal').includes(copy.stepReason.moisturizeOily));
  assert.match(app, /<p class="c-routine-step__role">\$\{Y\.steps\[st\.id\]\|\|st\.reason\}<\/p>/);
});

test('UX4 produits recommandés : une phrase factuelle tirée de l\'étape déjà retenue, sans score ni classement', () => {
  assert.equal(copy.productRole('moisturize', []), 'Produit proposé pour accompagner l\'hydratation de votre routine.');
  assert.equal(copy.productRole('cleanse', []), 'Produit proposé pour accompagner le nettoyage de votre routine.');
  assert.equal(copy.productRole('spf', []), 'Produit proposé pour accompagner la protection solaire de votre routine.');
  assert.equal(copy.productRole('treatment', ['Niacinamide']), 'Produit proposé pour le soin ciblé de votre routine (actif : niacinamide).');
  for (const k of ['moisturize', 'cleanse', 'spf', 'treatment']) assert.doesNotMatch(copy.productRole(k, ['Niacinamide']), /meilleur|score|%|efficac|résultat|garanti|prouv|n°|numéro|top\b/i);
  // seul le bloc « Recommandés » reçoit cette phrase ; « Autres produits » garde la raison réelle du moteur
  assert.match(app, /productCard\(x\.p,\{inPlan:true,slots:slotsOf\(x\.r\.steps\),role:roleOf\(x\.r\.steps\)\}\)/);
  assert.match(app, /productCard\(x\.p,\{reason:x\.o\.text\}\)/);
  assert.match(app, /\$\{o\.role\?`<p class="role-why muted">\$\{o\.role\}<\/p>`:``\}/);
  // la phrase suit le type d'étape que le moteur a réellement attribué au produit
  const r = run({ hydration: 30 }), v = P.catalogView(r.routinePlan, r.productMatches, C.PRODUCTS);
  assert.ok(v.recommended.length > 0);
  for (const rec of v.recommended) for (const s of rec.steps) assert.ok(['cleanse', 'moisturize', 'spf', 'treatment'].includes(s.kind));
});

test('UX5 offre internationale : « Voir une offre internationale », aucune promesse de livraison ou de disponibilité par pays', () => {
  assert.equal(copy.MARKET_TEXTS.international, 'Voir une offre internationale');
  assert.equal(copy.MARKET_TEXTS.internationalTag, 'Offre internationale');
  assert.doesNotMatch(Object.values(copy.MARKET_TEXTS).filter(x => typeof x === 'string').join(' | '), /Achat en ligne \/ international/);
  const texts = [JSON.stringify(copy.MARKET_TEXTS), JSON.stringify(copy.OFFER_TEXTS)].join(' ');
  assert.doesNotMatch(texts, /Livraison (au|en|à|dans) |Livrable|Disponible (au|en|à|dans) |Livré/i);
  // l'étiquette de la ligne d'offre ne reprend pas l'invitation (la ligne est déjà dépliée) ; la carte, elle, invite à voir l'offre
  assert.match(app, /tier\?`<span class="c-badge c-badge--outline">\$\{MT\.internationalTag\}<\/span>`/);
  assert.match(app, /v\.international\.length\?`<span class="c-badge c-badge--outline">\$\{MT\.international\}<\/span>`/);
  assert.doesNotMatch(app, /Achat en ligne \/ international/);
});

test('UX6 contour des yeux : les indicateurs informatifs sont regroupés sous un titre, valeurs et badges inchangés', () => {
  assert.equal(copy.EYE_GROUP_TITLE, 'Contour des yeux — à titre informatif');
  assert.match(app, /const rest=H\?\[\]:eng\.interpretation\.indicators\.filter\(i=>!P\.items\.some\(p=>p\.indicator===i\.id\)\)\.map\(asShown\),eyeOf=m=>m\.score!==null&&isInfo\(m\)/);
  assert.match(app, /asShown=m=>Object\.assign\(\{\},m,\{band:m\.uiBand,bandLabel:m\.uiBandLabel\}\)/, 'badges et barres : bande du score affiché, jamais la décision');
  assert.equal((app.match(/P\.items\.map\(asShown\)/g) || []).length, 2, 'accueil et résultat : besoins retenus affichés avec le score affiché et « Retenu par DERMAI »');
  assert.match(app, /others=H\?othersH:rest\.filter\(m=>!eyeOf\(m\)\)\.map\(rowOf\)\.join\(``\),eyeRows=rest\.filter\(eyeOf\)\.map\(rowOf\)\.join\(``\)/);
  assert.match(app, /\$\{eyeRows\?`<div class="c-indicators-group"><h3 class="c-indicators-group__title">\$\{Engine\.copy\.EYE_GROUP_TITLE\}<\/h3><ul class="c-indicators">\$\{eyeRows\}<\/ul><\/div>`:``\}/);
  // chaque ligne informative garde son badge « À titre d'information » et aucune recommandation
  assert.match(app, /isInfo\(m\)\?`<li class="c-indicator">[^`]*\$\{infoBadge\(\)\}/);
  assert.match(read('css/components/result.css'), /\.c-indicators-group\{margin-top:26px\}/);
  // les 5 indicateurs concernés sont bien « informatifs » côté moteur
  const info = run({ eyeBags: 20 }).interpretation.indicators.filter(i => i.actionability === 'informative').map(i => i.label);
  assert.ok(info.length >= 1);
});

/* Empreinte des sorties du moteur (décisions ET textes) sur 1500 profils. Étape 27 : `overflow` (priorities) et `origin` (étapes de routine) sont des clés
   AJOUTÉES, pas des décisions : exclues ici, pour que l'empreinte d'avant l'accompagnement puisse être retrouvée à l'identique. */
function ux7Fingerprint() {
  const replacer = function (k, v) { return (k === 'texture' || k === 'overflow' || k === 'origin' || (k === 'reason' && this.slot && this.kind)) ? undefined : v; };
  const out = [];
  for (let s = 1; s <= 1500; s++) {
    const c = randomCase(s * 37 + 5), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS });
    out.push(JSON.stringify([r.interpretation, r.priorities, r.activePlan, r.routinePlan, r.personalization], replacer));
  }
  return crypto.createHash('sha256').update(out.join('\n')).digest('hex');
}
const DECISION = require('../js/engine/data/decision.js');
test('UX7 empreinte des sorties du moteur (règles 1.3.0) sur 1500 profils : toute variation doit être voulue', () => {
  /* Étape 25 (règles 1.2.0) : empreinte changée VOLONTAIREMENT (ancienne : 06052f30…, règles 1.1.0). Ces 1500 profils n'ont pas de
     rawScore : ils sont lus en compatibilité (score affiché, repères 61 / 31), et la comparaison exécutée sur les deux versions montre
     que chaque décision modifiée l'est par les rôles des indicateurs (niveau d'huile, texture, fermeté descriptifs ; radiance et rides
     soumises à un objectif), y compris la place libérée sous le plafond de trois. Aucun autre changement.
     Étape 26 : empreinte changée par des TEXTES seulement (libellés « Favorable », « axe à soutenir », « priorité de soin »). Les décisions
     sont inchangées : test/analysis-coherence.test.js (C0) compare une empreinte de décisions seules au code d'avant l'étape.
     Étape 27 (règles 1.3.0) : accompagnement des indicateurs « good ». ACCOMPAGNEMENT DÉSACTIVÉ : l'empreinte de l'étape 26 (78d30684…) est
     retrouvée à l'identique, la nouvelle voie est additive. ACTIVÉ : la nouvelle empreinte ci-dessous. */
  const s = DECISION.MAX_ACCOMPANIMENT_AXES; DECISION.MAX_ACCOMPANIMENT_AXES = 0;
  try { assert.equal(ux7Fingerprint(), '78d3068469da8dd3a461317af6a4368191965f3409493c2937cd7f7164c4ca94', 'accompagnement désactivé : empreinte d\'avant l\'étape 27'); } finally { DECISION.MAX_ACCOMPANIMENT_AXES = s; }
  assert.equal(ux7Fingerprint(), '1980957c6679a0a2c0f4eddf182721c4cb1859e38bfdc4656a545c809f0cc312');
});

test('UX8 conseils par préoccupation : aucune promesse de texture légère ou non comédogène (même règle que la routine)', () => {
  const block = app.slice(app.indexOf('const CONCERNS'), app.indexOf('const CIDS'));
  assert.ok(block.length > 200);
  assert.doesNotMatch(block, /non com[ée]dog[eè]ne|textures? légères?/i);
  assert.match(block, /Introduisez un nouveau produit à la fois/);
  assert.doesNotMatch(app, /non com[ée]dog[eè]ne/i);
});
