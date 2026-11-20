'use strict';
/* Lot 2 (peaux foncées) : vocabulaire des métriques, badges, note sur les rougeurs, démo cohérente avec sa photo.
   Règle posée par le propriétaire : on ne rebaptise PAS une métrique en quelque chose que le moteur ne mesure pas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../js/skin-model.js');
const copy = require('../js/engine/copy.fr.js');
const ACT = require('../js/engine/data/actives.js');
const PROD = require('../js/engine/data/products.js');
const D = require('../js/declared-concerns.js');
const { DermaiInsight } = require('../js/insight-view.js');
const { run } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const APP = read('js/app.js');

test('DS1 « rougeurs » reste une mesure de rougeur : ni renommée, ni mise en doute en silence', () => {
  assert.equal(M.METRIC_LABELS.redness, 'Rougeurs');
  for (const t of [copy.INDICATOR_NOTES.redness, copy.REDNESS_NOTE.text, copy.REDNESS_NOTE.short, copy.REDNESS_NOTE.title]) assert.doesNotMatch(t, /inflammation|zones plus fonc/i, t);
  assert.match(copy.REDNESS_NOTE.text, /repère la rougeur/);
  assert.match(copy.REDNESS_NOTE.text, /peut être moins fiable sur peau foncée/);
  assert.match(copy.INDICATOR_NOTES.redness, /moins fiable sur peau foncée/);
  /* le moteur ne mesure toujours que « redness » : aucune nouvelle clé, aucun libellé inventé */
  assert.equal(M.METRIC_KEYS.length, 15);
  assert.ok(!Object.keys(M.METRIC_LABELS).some(k => /inflam|pih|scar|cicatri|shav|rasage|ashy|cendr/i.test(k)));
});

test('DS2 la note sur les rougeurs apparaît quand la mesure est présente, jamais quand elle est absente (rien d\'inventé)', () => {
  const withRed = run({ redness: 70 }, { raw: 62 }, { goals: [] });
  assert.match(D.rednessNote(withRed), /À savoir sur la mesure des rougeurs/);
  assert.match(D.rednessNote(withRed), /peut être moins fiable sur peau foncée/);
  assert.equal(D.rednessNote(run({ redness: null }, { raw: 62 }, { goals: [] })), '');
  for (const bad of [undefined, null, {}, { interpretation: null }, { interpretation: { indicators: [null, 3] } }]) assert.equal(D.rednessNote(bad), '');
  assert.ok(D.top(withRed).includes('data-redness-note'));
});

test('DS3 la carte du visage redit la limite quand « Rougeurs » est choisi, et seulement alors', () => {
  global.SkinModel = M; global.DermaiEngine = Object.assign({}, require('../js/engine/index.js'), { copy, indicatorsData: require('../js/engine/data/indicators.js'), decisionData: require('../js/engine/data/decision.js') });
  const r = run({ redness: 70, acne: 70 }, { raw: 62 }, { goals: [] }), esc = s => String(s), s = { photo: 'x.jpg' };
  const html = key => DermaiInsight.faceMap(s, ['redness', 'acne'], { faceKey: key, faceHide: false }, esc, r.synthesis);
  assert.ok(html('redness').includes('data-redness-note'));
  assert.ok(!html('acne').includes('data-redness-note'));
});

test('DS4 badges : le niveau se rattache au SCORE, jamais à la chose mesurée ni au vocabulaire des décisions', () => {
  assert.deepEqual(M.INDICATOR_BAND_LABELS, { good: 'Score élevé', mid: 'Score intermédiaire', low: 'Score plus bas' });
  for (const l of Object.values(M.INDICATOR_BAND_LABELS)) {
    assert.match(l, /^Score /);
    assert.doesNotMatch(l, /favorable|priorit|soutenir|surveiller|bien|niveau/i, 'ni « favorable » (contredit un accompagnement), ni décision, ni « niveau » (se lit comme le niveau d\'acné)');
  }
});

test('DS5 vocabulaire : on unifie le teint et on atténue les taches, on ne promet pas un teint « plus lumineux »', () => {
  const vitC = ACT.ACTIVES.find(a => a.id === 'vitamin_c'), aha = ACT.ACTIVES.find(a => a.id === 'aha_pha');
  for (const a of [vitC, aha]) assert.doesNotMatch(a.summary + ' ' + a.description, /lumineu|raviver|[ée]clat|illumin|brillan|clair(?!e)/i, a.id);
  assert.match(vitC.description, /unifier le teint/);
  assert.match(vitC.description, /atténuer l'aspect des taches/);
  assert.match(aha.description, /unifier l'aspect du teint/);
  for (const p of PROD.PRODUCTS) assert.doesNotMatch(p.name, /[ée]clat|lumineu|clair|white|bright/i, p.name);
  /* même garde sur tous les textes des actifs */
  for (const a of ACT.ACTIVES.filter(x => x.status === 'validated')) assert.doesNotMatch([a.summary, a.description, ...a.cautions].join(' '), /lumineu|raviver|[ée]claircir|blanchi|d[ée]pigment/i, a.id);
});

test('DS6 démo : les scores correspondent à la photo (boutons visibles, marques, texture irrégulière), l\'objectif acné est déclaré', () => {
  const scans = [...APP.matchAll(/demoScan\((\d),`[^`]+`,`[^`]+`,\d+,\d+,\{([^}]+)\}\)/g)].map(m => Object.fromEntries(m[2].split(',').map(kv => kv.split(':')).map(([k, v]) => [k, +v])));
  assert.equal(scans.length, 3);
  for (const s of scans) {
    assert.ok(s.acne <= 60, 'acné visible sur la photo : jamais dans la zone haute (' + s.acne + ')');
    assert.ok(s.texture <= 60, 'texture irrégulière visible : jamais dans la zone haute (' + s.texture + ')');
    assert.ok(s.pigmentation <= 60, 'marques visibles');
  }
  assert.ok(scans[0].acne < scans[2].acne && scans[0].pigmentation < scans[2].pigmentation, 'la démo garde sa progression');
  assert.match(APP, /goals:DEMO_MODE\?\[`tone`,`blemishes`,`hydration`\]/);
});

test('DS7 démo : l\'acné est retenue par le moteur sur la dernière analyse fictive (plus de « pas une préoccupation »)', () => {
  const last = [...APP.matchAll(/demoScan\(2,`[^`]+`,`[^`]+`,\d+,\d+,\{([^}]+)\}\)/g)][0][1];
  const ui = Object.fromEntries(last.split(',').map(kv => kv.split(':')).map(([k, v]) => [k, +v]));
  const r = run(ui, {}, { goals: ['tone', 'blemishes', 'hydration'] });
  assert.ok(r.priorities.items.some(p => p.indicator === 'acne'), 'acné retenue');
  assert.ok(r.priorities.items.some(p => p.indicator === 'pigmentation'), 'taches retenues');
});

test('DS8 hero : plus de bulle « Rougeurs » sur les portraits de peaux foncées', () => {
  const Hero = require('../js/hero.js').DermaiHero || require('../js/hero.js');
  const b = (Hero.BUBBLES || []);
  assert.ok(b.length === 6 && b.every(x => x.k !== 'redness'));
});

test('DS9 app.js n\'a pas grossi (plafond inchangé) et aucun tiret cadratin dans les nouveaux textes', () => {
  assert.ok(Buffer.byteLength(APP) <= 149737);
  for (const t of [copy.REDNESS_NOTE.short, copy.REDNESS_NOTE.title, copy.REDNESS_NOTE.text, copy.INDICATOR_NOTES.redness, ...Object.values(M.INDICATOR_BAND_LABELS)]) assert.ok(!/[—–]/.test(t), t);
});
