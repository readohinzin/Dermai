'use strict';
/* « Ce que vous signalez » (js/declared-concerns.js) : une préoccupation déclarée que l'analyse ne retient pas n'est plus balayée d'un
   « ce n'est pas une priorité ». Affichage seul : le moteur n'est pas modifié. Aucun appel réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run, norm } = require('./helpers/engine.js');
const { DermaiInsight } = require('../js/insight-view.js');
const D = require('../js/declared-concerns.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* Base « raw » : acné bien au-dessus du repère de décision (50), c'est le cas décrit par la plainte. */
const GOOD = { acne: 78, pores: 75, oiliness: 70, texture: 72, hydration: 74, redness: 80, pigmentation: 72, wrinkles: 82, firmness: 78, radiance: 74 };
const goodRun = (profile, ui = GOOD, o = { raw: 62 }) => Engine().run(norm(ui, o), { goals: [], level: 'simple', cats: [], ...profile });
const Engine = () => require('../js/engine/index.js');

test('DC1 acné déclarée, mesure favorable : un encart honnête, pas un « ce n\'est pas une priorité »', () => {
  const eng = goodRun({ goals: ['blemishes'] });
  assert.equal(eng.priorities.mode, 'maintenance', 'point de départ : le moteur ne retient rien');
  const t = strip(D.html(eng));
  assert.match(t, /Ce que vous signalez/);
  assert.match(t, /Acné et imperfections/);
  assert.match(t, /ne retient pas « acné et imperfections » comme axe prioritaire/);
  assert.match(t, /ne veut pas dire que ce que vous voyez sur votre peau n'existe pas/);
  assert.match(t, /une seule photo/);
  assert.match(t, /marques qui restent après un bouton/);
  assert.match(t, /dermatologue ou à un pharmacien/);
  assert.match(t, /ne peut ni examiner votre peau ni poser de diagnostic/);
  assert.doesNotMatch(t, /n'est pas une préoccupation|mesure est favorable|aucun problème/i);
});

test('DC2 aucune note chiffrée dans l\'encart (un « 78 » à côté d\'« Acné » se lit comme une bonne note)', () => {
  const t = strip(D.html(goodRun({ goals: ['blemishes', 'tone'] })));
  assert.doesNotMatch(t, /\d{2}\s*\/\s*100|\b[5-9]\d\b(?!\s*(jours|%))/);
});

test('DC3 soin doux ajouté ou routine de base seule : dit exactement ce que le moteur a fait', () => {
  const eng = goodRun({ goals: ['blemishes'] });
  const acc = eng.synthesis.indicators.acne.accompaniment;
  const t = strip(D.html(eng));
  if (acc && acc.status === 'added') assert.match(t, /un soin doux \(\w[\w ]*\) y est ajouté/);
  else assert.match(t, /Aucun soin ciblé n'est ajouté/);
  /* cas inverse, sans actif doux disponible : l'objectif « hydratation » n'ajoute pas de soin ciblé ici */
  const base = D.view(goodRun({ goals: ['hydration'] }));
  for (const c of base.concerns) assert.equal(c.added, c.activeLabel !== null);
});

test('DC4 objectif retenu en priorité : aucun encart pour lui (l\'écran le dit déjà)', () => {
  const eng = goodRun({ goals: ['blemishes'] }, { ...GOOD, acne: 20 }, { raw: 62, rawMap: { acne: 20 }, rawFill: 62 });
  assert.ok(eng.priorities.items.some(p => p.indicator === 'acne'), 'acné retenue par le moteur');
  assert.equal(D.view(eng).concerns.length, 0);
  assert.equal(D.html(eng), '');
});

test('DC5 indicateur non renvoyé : « aucune mesure », rien n\'est inventé, pas de score', () => {
  const eng = goodRun({ goals: ['blemishes'] }, { ...GOOD, acne: null });
  const t = strip(D.html(eng));
  assert.match(t, /n'a renvoyé aucune mesure pour « acné et imperfections »/);
  assert.match(t, /n'en tire aucune conclusion/);
  assert.doesNotMatch(t, /ne retient pas/);
});

test('DC6 sans objectif et rien de retenu : invitation à dire ce qu\'on voit ; avec une priorité : rien', () => {
  const none = goodRun({ goals: [] });
  const h = D.html(none);
  assert.match(strip(h), /Une préoccupation qui n'apparaît pas ici/);
  assert.match(h, /data-go="profile"/);
  const withPriority = goodRun({ goals: [] }, { ...GOOD, hydration: 20 }, { raw: 62, rawMap: { hydration: 20 }, rawFill: 62 });
  assert.equal(withPriority.priorities.mode, 'action');
  assert.equal(D.html(withPriority), '');
});

test('DC7 objectif « entretien global » seul : aucun encart (rien de précis n\'est signalé)', () => {
  assert.equal(D.html(goodRun({ goals: ['maintenance'] })), '');
});

test('DC8 affichage seul : le moteur n\'est ni modifié ni relu différemment (mêmes priorités, routine, synthèse)', () => {
  const eng = goodRun({ goals: ['blemishes', 'tone'] });
  const before = JSON.stringify(eng);
  D.html(eng); D.top(eng); D.view(eng);
  assert.equal(JSON.stringify(eng), before, 'aucune mutation');
  /* même entrée, même sortie : le module n'ajoute aucun état */
  assert.equal(D.html(eng), D.html(JSON.parse(before)));
});

test('DC9 top() = encart puis la synthèse existante, inchangée', () => {
  const eng = goodRun({ goals: ['blemishes'] });
  assert.equal(D.top(eng), D.html(eng) + D.rednessNote(eng) + DermaiInsight.found(eng.synthesis));
  const calm = goodRun({ goals: ['maintenance'] });
  assert.equal(D.top(calm), D.rednessNote(calm) + DermaiInsight.found(calm.synthesis));
});

test('DC10 entrées hostiles : jamais d\'exception', () => {
  for (const bad of [undefined, null, 0, 'x', [], {}, { synthesis: null }, { synthesis: { goals: null } }, { synthesis: { goals: { mode: 'set', items: [null, 3, { status: 'accompanied' }] } } }])
    assert.doesNotThrow(() => D.html(bad));
});

test('DC11 vocabulaire : ton cosmétique, aucun diagnostic, aucun mot d\'éclaircissement, pas de tiret cadratin', () => {
  const forbidden = [/(?<![\p{L}])vous avez (?!indiqu[ée]|choisi)/iu, /vous souffrez/i, /(?<![\p{L}])traiter/i, /(?<![\p{L}])il faut/i, /malad/i, /patholog/i, /pr[ée]scri/i, /gu[ée]ri/i,
    /(?<![\p{L}])soigner/i, /[ée]claircir/i, /[ée]claircissant/i, /blanchi/i, /d[ée]pigment/i];
  const texts = Object.values(D.TEXT).map(x => (typeof x === 'function' ? x('Acné et imperfections') : x));
  for (const t of texts) {
    for (const re of forbidden) assert.doesNotMatch(t, re, t);
    assert.ok(!t.includes('—') && !t.includes('–'), t);
  }
});

test('DC12 câblage : script chargé après insight-view.js et avant app.js ; app.js n\'a pas grossi (plafond inchangé)', () => {
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('insight-view.js') > 0 && at('declared-concerns.js') > at('insight-view.js') && at('app.js') > at('declared-concerns.js'));
  const app = read('js/app.js');
  assert.ok(app.includes('DermaiDeclared.top(eng)') && !app.includes('DermaiInsight.found(eng.synthesis)'));
  assert.ok(Buffer.byteLength(app) <= 149737, 'app.js ne doit pas grossir : le nouveau code vit dans un module');
  assert.doesNotMatch(read('js/declared-concerns.js'), /fetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});
