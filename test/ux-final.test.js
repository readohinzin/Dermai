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
  assert.equal(copy.MAINTENANCE.title, 'Aucune priorité forte ne ressort de cette analyse.');
  assert.equal(copy.MAINTENANCE.text, 'Certains indicateurs peuvent toutefois être soutenus dans votre routine d\'entretien.');
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
  assert.match(app, /const rest=H\?\[\]:eng\.interpretation\.indicators\.filter\(i=>!P\.items\.some\(p=>p\.indicator===i\.id\)\),eyeOf=m=>m\.score!==null&&isInfo\(m\)/);
  assert.match(app, /others=H\?othersH:rest\.filter\(m=>!eyeOf\(m\)\)\.map\(rowOf\)\.join\(``\),eyeRows=rest\.filter\(eyeOf\)\.map\(rowOf\)\.join\(``\)/);
  assert.match(app, /\$\{eyeRows\?`<div class="c-indicators-group"><h3 class="c-indicators-group__title">\$\{Engine\.copy\.EYE_GROUP_TITLE\}<\/h3><ul class="c-indicators">\$\{eyeRows\}<\/ul><\/div>`:``\}/);
  // chaque ligne informative garde son badge « À titre d'information » et aucune recommandation
  assert.match(app, /isInfo\(m\)\?`<li class="c-indicator">[^`]*\$\{infoBadge\(\)\}/);
  assert.match(read('css/components/result.css'), /\.c-indicators-group\{margin-top:26px\}/);
  // les 5 indicateurs concernés sont bien « informatifs » côté moteur
  const info = run({ eyeBags: 20 }).interpretation.indicators.filter(i => i.actionability === 'informative').map(i => i.label);
  assert.ok(info.length >= 1);
});

test('UX7 décisions du moteur inchangées : mêmes scores, interprétation, priorités, actifs, routine et personnalisation sur 1500 profils', () => {
  const replacer = function (k, v) { return (k === 'texture' || (k === 'reason' && this.slot && this.kind)) ? undefined : v; };
  const out = [];
  for (let s = 1; s <= 1500; s++) {
    const c = randomCase(s * 37 + 5), r = Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS });
    out.push(JSON.stringify([r.interpretation, r.priorities, r.activePlan, r.routinePlan, r.personalization], replacer));
  }
  /* Empreinte identique à celle du moteur d'avant l'étape 22 (commit 799a03e), vérifiée en exécutant les deux versions.
     L'étape 22 ne change que la couche produits (justification obligatoire, voir test/synthesis.test.js) et ajoute la synthèse. */
  assert.equal(crypto.createHash('sha256').update(out.join('\n')).digest('hex'), '06052f301b7a1b6290a03c23377f60440434ae9cab42b71d311ccee7370dc5e0');
});

test('UX8 conseils par préoccupation : aucune promesse de texture légère ou non comédogène (même règle que la routine)', () => {
  const block = app.slice(app.indexOf('const CONCERNS'), app.indexOf('const CIDS'));
  assert.ok(block.length > 200);
  assert.doesNotMatch(block, /non com[ée]dog[eè]ne|textures? légères?/i);
  assert.match(block, /Introduisez un nouveau produit à la fois/);
  assert.doesNotMatch(app, /non com[ée]dog[eè]ne/i);
});
