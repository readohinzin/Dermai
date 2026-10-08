'use strict';
/* Étape 8 : l'interface consomme le moteur (aucune règle métier dans app.js) et reste honnête : pas de donnée fictive en réel,
   pas de faux pourcentage, pas d'identifiant technique, états vides et erreurs lisibles. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Engine, run } = require('./helpers/engine.js');
const copy = require('../js/engine/copy.fr.js');
const indicators = require('../js/engine/data/indicators.js');
const actives = require('../js/engine/actives.js');
const data = require('../js/engine/data/actives.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('js/app.js');
const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const code = stripComments(app);
const tids = r => r.activePlan.treatments.map(t => t.activeId);

test('X1 résultat → routine personnalisée : CTA, synthèse dynamique du moteur, trois niveaux distincts', () => {
  assert.match(app, /Voir ma routine personnalisée/);
  assert.match(app, /data-go="routine">Voir ma routine personnalisée/);
  assert.match(app, /eng\.synthesis\.strategy\.text/);   // étape 22 : la stratégie calculée remplace le résumé générique
  for (const k of ['Ce que DERMAI observe', 'Ce que vous souhaitez travailler', 'Ce que DERMAI recommande']) assert.ok(app.includes(k), k);
  assert.match(app, /Le score global est une information séparée/);
  const r = run({ acne: 30, hydration: 40 }, {}, { goals: ['hydration'] });
  assert.match(r.personalization.headline, /^Votre analyse indique des repères plus faibles sur/);
  assert.match(r.personalization.headline, /Vous avez indiqué comme objectif : hydratation\./);
  assert.match(r.personalization.headline, /Nous avons donc privilégié/);
  assert.doesNotMatch(run({ acne: 30 }).personalization.headline, /objectif/, 'aucun objectif inventé');
});

test('X2 priorités : détail accessible, maintenance sans priorité inventée', () => {
  assert.match(app, /data-go="concern:\$\{m\.indicator\}">Voir le détail/);
  const m = run({});
  assert.deepEqual(m.priorities.items, []);
  assert.equal(copy.MAINTENANCE.title, 'DERMAI ne retient aucun besoin particulier.');
  assert.match(copy.MAINTENANCE.text, /routine d'entretien de base : nettoyage doux, hydratation et protection solaire/);
  assert.ok(run({ acne: 20, pores: 25, hydration: 30, texture: 35, redness: 40 }).priorities.items.length <= 3);
});

test('X3 objectifs : trois au maximum, compteur, message du quatrième, rien de pré-coché en réel, libellés français', () => {
  assert.match(app, /\$\{state\.goals\.length\}\/3 objectifs sélectionnés/);
  assert.equal(copy.GOAL_LIMIT, 'Vous pouvez choisir jusqu\'à 3 objectifs.');
  assert.match(app, /goals:DEMO_MODE\?\[[^\]]*\]:\[\]/, 'aucun objectif pré-coché en mode réel');
  let g = [];
  for (const id of ['hydration', 'tone', 'aging']) g = Engine.toggleGoal(g, id).goals;
  const fourth = Engine.toggleGoal(g, 'texture');
  assert.equal(fourth.limited, true);
  assert.deepEqual(fourth.goals, g, 'aucun objectif existant n\'est retiré silencieusement');
  for (const id of indicators.GOALS.map(x => x.id)) {
    assert.ok(copy.GOAL_LABELS[id] && !/_/.test(copy.GOAL_LABELS[id]) && copy.GOAL_LABELS[id] !== id, id);
  }
});

test('X4 niveau de routine : Minimal / Simple / Complète, mappés sur none / simple / full', () => {
  assert.deepEqual(copy.LEVEL_SHORT, { none: 'Minimal', simple: 'Simple', full: 'Complète' });
  assert.match(app, /Mon niveau de routine/);
  assert.match(app, /Mon approche/);
  assert.match(app, /Ma routine est recalculée automatiquement lorsque je modifie ces préférences/);
  assert.match(app, /ne sont pas enregistrées définitivement/);
});

test('X5 approche douce : la routine le reflète (note du moteur), sans message alarmiste', () => {
  const r = run({ acne: 30 }, {}, { comfort: { preferGentle: true } });
  assert.equal(r.personalization.approachNote, 'DERMAI privilégie ici une routine plus progressive.');
  assert.equal(run({ acne: 30 }).personalization.approachNote, null);
  assert.match(app, /PZ\.approachNote/);
});

test('X6 routine cohérente avec le plan du moteur : uniquement les étapes fournies, chaque actif ouvrable avec ses raisons', () => {
  for (const level of ['none', 'simple', 'full']) {
    const r = run({ acne: 30, wrinkles: 40, hydration: 45 }, {}, { level });
    const planned = tids(r).sort(), placed = r.routinePlan.slots.morning.concat(r.routinePlan.slots.evening).filter(s => s.kind === 'treatment').map(s => s.activeId).sort();
    assert.deepEqual(placed, planned.filter(id => !r.routinePlan.deferred.some(d => d.activeId === id && d.kind === 'slot')));
    for (const s of r.personalization.selectedActives) assert.ok(s.why && s.whyNow && Array.isArray(s.whyNot));
  }
  assert.match(app, /data-go="active:\$\{st\.activeId\}">Découvrir cet actif/);
  assert.match(app, /Suggestion de départ/);
  assert.doesNotMatch(code, /treatments\.push|PREFERENCE|irritation/);
});

test('X7 actifs : « Vos actifs recommandés » et « Autres actifs » ; le rétinoïde est dans la seconde catégorie', () => {
  assert.match(app, /Vos actifs recommandés/);
  assert.match(app, /Autres actifs/);
  const r = run({ wrinkles: 20, firmness: 20 }, {}, { level: 'full' });
  assert.ok(!tids(r).includes('retinoid'));
  const o = r.personalization.otherActives.find(x => x.activeId === 'retinoid');
  assert.ok(o);
  assert.match(o.text, /^Non retenu actuellement : cet actif n'est pas validé pour la recommandation automatique/);
  for (const x of r.personalization.otherActives) assert.match(x.text, /^Non retenu actuellement : /);
  assert.ok(!r.personalization.otherActives.some(x => x.kind === 'slot'), 'pas de raison technique interne');
  assert.ok(!r.personalization.selectedActives.some(x => x.activeId === 'retinoid'));
  for (const s of [...r.activePlan.treatments, ...r.activePlan.supports]) assert.equal(actives.byId(s.activeId).status, 'validated');
});

test('X8 exclusions : architecture prête sans interface ni donnée de santé', () => {
  assert.match(app, /exclusionsSection=\(\)=>``/);
  assert.match(app, /exclusions:state\.exclusions/);
  assert.doesNotMatch(code, /allergi|enceinte|grossesse\s*[:=]/i);
  assert.ok(!run({ acne: 30 }, {}, { exclusions: ['salicylic'] }).activePlan.treatments.some(t => t.activeId === 'salicylic'));
});

test('X9 produits : aucun prix de démonstration présenté comme réel, aucun pourcentage de correspondance', () => {
  assert.match(app, /const priceLine=p=>/);
  assert.doesNotMatch(code, /\$\{fmt\(p\.price\.amount\)\}/, 'le prix n\'est affiché que via priceLine');
  assert.match(app, /Prix à venir/);
  assert.doesNotMatch(app, /\d\s?%\s?(de )?correspondance|correspondance avec votre profil|\$\{p\.match/i);
});

test('X10 pas de reste de démonstration en mode réel : Amina, /10, zones du visage, phrases statiques', () => {
  const lines = code.split('\n');
  lines.forEach((l, i) => { if (/Amina/.test(l)) assert.match(l, /DEMO_MODE/, `ligne ${i + 1} : « Amina » hors mode démo`); });
  assert.doesNotMatch(code, /\/\s?10\b(?!\d)/);
  assert.doesNotMatch(code, /Vos deux priorités|Zones concernées|Touchez une préoccupation|Huit repères/);
  assert.match(app, /state=\{[^}]*user:DEMO_MODE\?\{name:`Amina`/s);
});

test('X11 historique et progression : analyse actuelle identifiable, rien d\'inventé, états vides utiles', () => {
  assert.match(app, /Analyse actuelle/);
  assert.match(app, /Repères à soutenir à cette date/);
  assert.match(app, /Votre première analyse est enregistrée\./);
  assert.match(app, /Faites une nouvelle analyse plus tard pour suivre votre évolution\./);
  assert.match(app, /Faites votre première analyse pour obtenir une routine personnalisée\./);
  assert.match(app, /Vos recommandations apparaîtront après votre analyse\./);
  assert.match(app, /data-go="scan">Analyser ma peau/);
  assert.match(app, /Votre évolution/);
});

test('X12 erreurs : messages humains, jamais de terme technique', () => {
  const msgs = [...app.matchAll(/(?:userError\(|SCAN_ERR_GENERIC = )`([^`$]+)`/g)].map(m => m[1]);
  assert.ok(msgs.length >= 5, String(msgs.length));
  for (const m of msgs) assert.doesNotMatch(m, /API|JSON|HTTP|\b[45]\d\d\b|Perfect|stack|undefined|exception|TypeError|fetch|server/i, m);
  assert.match(app, /Nous n'avons pas pu analyser cette photo\. Veuillez réessayer\./);
});

test('X13 vocabulaire : ni « problème », « défaut », « anomalie », « malade », « traitement », « guérir » dans les textes visibles', () => {
  const texts = [code, stripComments(read('js/engine/copy.fr.js')), stripComments(read('js/engine/personalization.js')), stripComments(read('js/engine/data/actives.js'))].join('\n');
  assert.doesNotMatch(texts, /(?<![\p{L}])(probl[èe]mes?|anomalies?|malades?|gu[ée]rir|gu[ée]rison)(?![\p{L}])/iu);
  assert.doesNotMatch(texts, /(?<![\p{L}])d[ée]fauts?(?![\p{L}])(?<!par d[ée]faut)/iu);
  assert.doesNotMatch(texts.replace(/treatments?/g, ''), /(?<![\p{L}])traitements?(?![\p{L}])/iu);
});

test('X14 disclaimer cosmétique présent sur résultat, routine et actifs', () => {
  assert.match(app, /ce n'est pas un diagnostic médical/);
  assert.ok((app.match(/\$\{disc\(\)\}/g) || []).length >= 4);
});

test('X15 aucun identifiant technique affiché : ni goals, ni niveau, ni actif', () => {
  assert.doesNotMatch(code, />\$\{(?:g\.id|id|state\.level|a\.id|l)\}</);
  for (const id of ['oil_pores', 'blemishes', 'tone', 'aging', 'redness_comfort']) assert.ok(copy.GOAL_LABELS[id] && !copy.GOAL_LABELS[id].includes(id));
  for (const a of data.ACTIVES.filter(x => x.status === 'validated')) assert.ok(!/_/.test(a.label), a.id);
});
