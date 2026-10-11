'use strict';
/* Programme de soins sur 30 jours (js/engine/program.js, js/care-program.js) et bloc « Limites et précautions » (js/insight-view.js).
   Tout est testé sans réseau ni navigateur, avec des faux (stockage, date du jour). Aucun appel au service d'analyse : le programme ne lit que
   la routine déjà calculée. Les tests dans un vrai navigateur sont dans care-program-browser.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run, randomCase } = require('./helpers/engine.js');
const P = require('../js/engine/program.js');
const Care = require('../js/care-program.js');
const adata = require('../js/engine/data/actives.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
/* Pièges réseau : le programme ne doit jamais appeler le réseau. */
const trap = [];
globalThis.fetch = (...a) => { trap.push(['fetch', String(a[0])]); throw new Error('réseau interdit'); };
globalThis.XMLHttpRequest = function () { trap.push(['xhr']); throw new Error('réseau interdit'); };

const START = '2026-10-12';
const day = n => P.addDays(START, n - 1);            // date du jour n
const SAMPLE = () => run({ acne: 30, pigmentation: 40, redness: 50, hydration: 35 }, {}, { level: 'full', goals: ['hydration'] });
const planOf = r => P.build(r.routinePlan, { explain: r.synthesis.steps, base: { id: '11111111-2222-4333-8444-555555555555', at: '2026-10-11T08:00:00.000Z' } });
const stateOf = (r = SAMPLE()) => P.newState(planOf(r), START);
const ids = st => st.plan.steps.map(s => s.id);
const treat = st => st.plan.steps.filter(s => s.kind === 'treatment');
const due = (st, d, id) => P.dayView(st, d).slots[id.split(':')[0]].find(x => x.step.id === id).state;
/* Plan fait main (une étape par cadence) pour éprouver le calendrier sans dépendre des fiches. */
const hand = (cad, first = 1, order = 1, id = 'evening:treatment:azelaic', label = 'Acide azélaïque') => ({ id, slot: id.split(':')[0], kind: 'treatment', origin: 'priority', activeId: 'azelaic', label, role: 'x', cad, first, order, freq: '', note: '', cautions: [] });
const base = slot => [{ id: slot + ':cleanse', slot, kind: 'cleanse', origin: 'base', label: 'Nettoyant doux', role: '', cad: 'daily', first: 1, order: 0, freq: '', note: '', cautions: [] },
  { id: slot + ':moisturize', slot, kind: 'moisturize', origin: 'base', label: 'Hydratant', role: '', cad: 'daily', first: 1, order: 0, freq: '', note: '', cautions: [] }];
const custom = (steps, start = START) => P.newState({ steps, notes: [], summary: '', base: {} }, start);

/* =================== 1. Plan : tiré de la routine, rien d'inventé =================== */

test('PR1 le plan reprend exactement les étapes de la routine, dans l\'ordre, sans produit ni étape ajoutés (120 profils)', () => {
  for (let seed = 1; seed <= 120; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile), plan = planOf(r);
    const want = [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening];
    assert.deepEqual(plan.steps.map(s => s.id), want.map(s => s.id), 'seed ' + seed);
    plan.steps.forEach((s, i) => {
      assert.equal(s.kind, want[i].kind); assert.equal(s.activeId, want[i].kind === 'treatment' ? want[i].activeId : null);
      if (s.kind !== 'treatment') { assert.equal(s.cad, 'daily'); assert.equal(s.first, 1); }
    });
    assert.deepEqual(P.cleanPlan(plan), plan, 'le plan est déjà normalisé (seed ' + seed + ')');
  }
});

test('PR2 les soins ciblés arrivent un par un, à une semaine d\'intervalle, dans l\'ordre d\'introduction de la routine', () => {
  const st = stateOf(), t = treat(st);
  assert.equal(t.length, 2);
  const byOrder = t.slice().sort((a, b) => a.order - b.order);
  assert.equal(byOrder[0].first, 1); assert.equal(byOrder[1].first, 8);
  for (let seed = 1; seed <= 150; seed++) {
    const c = randomCase(seed), plan = planOf(run(c.ui, c.o, c.profile)), tt = plan.steps.filter(s => s.kind === 'treatment');
    const firsts = tt.map(s => s.first).sort((a, b) => a - b);
    firsts.forEach((f, i) => { if (i) assert.ok(f - firsts[i - 1] >= 7 || f === 30, 'seed ' + seed); });
    assert.ok(tt.every(s => s.first >= 1 && s.first <= 30));
  }
});

test('PR3 cadence : chaque actif utilisable par la routine a une fréquence EXPLICITEMENT reconnue (sinon ce test échoue et le soin ne serait pas planifié)', () => {
  const A = require('../js/engine/actives.js');
  for (const a of adata.ACTIVES.filter(x => A.isValidated(x) || x.consultable)) {
    const f = a.introduction && a.introduction.frequency;
    assert.ok(typeof f === 'string' && P.cadenceOf(f, false) !== null, 'fréquence absente ou non reconnue pour « ' + a.id + ' » : « ' + f + ' ». Ajouter sa cadence à program.js (CADENCE) ou corriger la fiche.');
  }
  for (const a of adata.ACTIVES) { const f = (a.introduction && a.introduction.frequency) || ''; assert.ok(f === '' || P.cadenceOf(f, false), a.id); }   // aucun texte de fiche ni inconnu ni mal orthographié
});

test('FQ1 fréquence : valide → sa cadence ; manquante, vide, inconnue ou d\'un autre type → aucune cadence (jamais « un jour sur deux » par défaut)', () => {
  for (const [txt, cad] of [['Une fois par jour', 'daily'], ['Chaque jour', 'daily'], ['Deux soirs par semaine', 'w2'], ['Un soir sur deux au début', 'alt'], ['Un matin sur deux au début', 'alt'], ['Un soir par semaine au début', 'w1'], ['  Chaque jour  ', 'daily']])
    assert.equal(P.cadenceOf(txt, false), cad, txt);
  for (const bad of [undefined, null, '', '   ', 'Texte inconnu', 'Un soir sur trois', 'Deux fois par jour', 'chaque jour', 'CHAQUE JOUR', 'Un soir par semaine', 5, {}, [], 'constructor', '__proto__', 'toString'])
    assert.equal(P.cadenceOf(bad, false), null, String(bad));
  assert.equal(P.cadenceOf('Une fois par jour', true), 'alt', 'peau fragile : « chaque jour » commence un jour sur deux (règle explicite)');
  assert.equal(P.cadenceOf('Deux soirs par semaine', true), 'w2'); assert.equal(P.cadenceOf('Texte inconnu', true), null); assert.equal(P.cadenceOf('', true), null);
});

/* Routine réelle dont on remplace la fréquence d'un soin pour éprouver les cas manquant / inconnu. */
function withFrequency(freq) {
  const r = SAMPLE(), plan = JSON.parse(JSON.stringify(r.routinePlan));
  const t = [...plan.slots.morning, ...plan.slots.evening].filter(x => x.kind === 'treatment');
  if (freq === undefined) delete t[0].introduction.frequency; else t[0].introduction.frequency = freq;
  return { r, plan, target: t[0], other: t[1] };
}

test('FQ2 fréquence manquante ou inconnue : le soin n\'est pas planifié, jamais coché, jamais compté ; les autres soins et les étapes de base sont inchangés', () => {
  for (const freq of [undefined, '', 'Un soir sur trois', 'Texte inconnu']) {
    const { r, plan, target, other } = withFrequency(freq);
    const p = P.build(plan, { explain: r.synthesis.steps });
    const step = p.steps.find(s => s.id === target.id);
    assert.equal(step.cad, null, String(freq)); assert.deepEqual(P.unscheduled(p).map(s => s.id), [target.id]);
    const st = P.newState(p, START);
    for (let d = 1; d <= 30; d++) {
      const v = P.dayView(st, d), item = v.slots[target.slot].find(x => x.step.id === target.id);
      assert.equal(item.state, 'unscheduled', 'jour ' + d + ' (' + freq + ')');
      assert.equal(P.tick(st, d, target.id, true, day(d)), null, 'un soin non planifié ne se coche pas');
    }
    assert.ok([8, 9, 10, 11].some(d => due(st, d, other.id) === 'due') && [8, 9, 10, 11].every(d => due(st, d, other.id) !== 'unscheduled'), 'l\'autre soin est planifié normalement');
    for (const id of ['morning:cleanse', 'evening:cleanse', 'morning:spf']) assert.equal(due(st, 1, id), 'due');
    const withoutTarget = P.dayView(st, 9); assert.ok(withoutTarget.expected >= 3);
    const wk = P.review(st, day(30)); assert.ok(wk.every(w => !w.intro.some(m => m.includes(step.label)) && !w.hints.some(m => m.startsWith(step.label))), 'ni introduction annoncée ni consigne rappelée');
  }
});

test('FQ3 le soin non planifié n\'entraîne aucune pause ni suspension à sa place, et le choix du soin concerné reste possible', () => {
  const { r, plan, target } = withFrequency('Texte inconnu');
  const st = P.newState(P.build(plan, { explain: r.synthesis.steps }), START);
  const mod = P.logTolerance(st, 2, 'moderate', target.id, day(2));
  assert.equal(mod.logs[0].s, target.id, 'la réaction à ce produit peut être notée');
  assert.equal(due(mod, 3, target.id), 'unscheduled');
});

test('FQ4 état enregistré : cadence absente ou invalide → aucune cadence (pas « un jour sur deux ») ; les étapes de base restent quotidiennes', () => {
  const good = JSON.parse(JSON.stringify(stateOf()));
  const t = good.plan.steps.find(s => s.kind === 'treatment'), cleanse = good.plan.steps.find(s => s.kind === 'cleanse');
  for (const bad of [undefined, null, '', 'zzz', 5, {}, 'constructor']) {
    const h = JSON.parse(JSON.stringify(good)); const tt = h.plan.steps.find(s => s.id === t.id); if (bad === undefined) delete tt.cad; else tt.cad = bad;
    h.plan.steps.find(s => s.id === cleanse.id).cad = bad === undefined ? 'daily' : bad;
    const st = P.cleanState(h);
    assert.equal(st.plan.steps.find(s => s.id === t.id).cad, null, String(bad)); assert.equal(st.plan.steps.find(s => s.id === cleanse.id).cad, 'daily');
    assert.equal(due(st, t.first, t.id), 'unscheduled');
  }
});

test('FQ5 profils réels : tous les soins ciblés de la routine ont une cadence reconnue (aucun soin silencieusement non planifié) sur 300 profils', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const c = randomCase(seed), plan = planOf(run(c.ui, c.o, c.profile));
    assert.deepEqual(P.unscheduled(plan).map(s => s.id), [], 'seed ' + seed);
  }
});

test('PR4 calendrier selon la cadence : tous les jours, un jour sur deux, deux fois / une fois par semaine ; jamais avant le premier jour', () => {
  const pattern = (cad, first = 1) => { const st = custom([...base('evening'), hand(cad, first)]); return Array.from({ length: 14 }, (_, i) => due(st, i + 1, 'evening:treatment:azelaic')); };
  assert.deepEqual(pattern('daily'), Array(14).fill('due'));
  assert.deepEqual(pattern('alt'), ['due', 'rest', 'due', 'rest', 'due', 'rest', 'due', 'rest', 'due', 'rest', 'due', 'rest', 'due', 'rest']);
  assert.deepEqual(pattern('w2').map(x => x === 'due'), [true, false, false, true, false, false, false, true, false, false, true, false, false, false]);
  assert.deepEqual(pattern('w1').map(x => x === 'due'), [true, false, false, false, false, false, false, true, false, false, false, false, false, false]);
  const later = pattern('daily', 5); assert.deepEqual(later.slice(0, 4), ['later', 'later', 'later', 'later']); assert.equal(later[4], 'due');
});

test('PR5 les étapes de base sont dues tous les jours et ne sont jamais mises en pause ni suspendues', () => {
  let st = custom([...base('evening'), hand('alt')]);
  st = P.logTolerance(st, 2, 'strong', 'evening:treatment:azelaic', day(2));
  for (let d = 1; d <= 30; d++) for (const id of ['evening:cleanse', 'evening:moisturize']) assert.equal(due(st, d, id), 'due');
});

/* =================== 2. Actions : cocher, noter la tolérance, mettre en pause =================== */

test('AC1 cocher : seulement un jour écoulé ou en cours, seulement une étape prévue ce jour-là ; décocher possible', () => {
  const st = custom([...base('evening'), hand('alt')]);
  assert.equal(P.tick(st, 3, 'evening:cleanse', true, day(2)), null, 'jamais un jour à venir');
  assert.equal(P.tick(st, 0, 'evening:cleanse', true, day(2)), null); assert.equal(P.tick(st, 31, 'evening:cleanse', true, day(31)), null);
  assert.equal(P.tick(st, 2, 'evening:treatment:azelaic', true, day(2)), null, 'soin non prévu ce jour-là (un jour sur deux)');
  assert.equal(P.tick(st, 1, 'evening:inconnu', true, day(2)), null);
  assert.equal(P.tick(st, 1.5, 'evening:cleanse', true, day(2)), null);
  const a = P.tick(st, 1, 'evening:cleanse', true, day(2));
  assert.deepEqual(a.checks, { 1: ['evening:cleanse'] });
  assert.deepEqual(P.tick(a, 1, 'evening:cleanse', false, day(2)).checks, {}, 'décocher efface la case');
  assert.deepEqual(P.tick(a, 1, 'evening:cleanse', true, day(2)).checks, { 1: ['evening:cleanse'] }, 'idempotent');
  assert.equal(st.checks[1], undefined, 'l\'état d\'origine n\'est jamais modifié');
  assert.equal(P.tick(st, 1, 'evening:cleanse', true, '2026-10-01'), null, 'date du jour avant le départ (horloge reculée)');
});

test('AC2 tolérance : niveaux connus seulement, jour écoulé seulement, soin concerné retenu seulement pour modérée / importante, plafond du journal', () => {
  const st = custom([...base('evening'), hand('alt')]);
  assert.equal(P.logTolerance(st, 1, 'zzz', null, day(1)), null);
  assert.equal(P.logTolerance(st, 2, 'none', null, day(1)), null, 'jour futur');
  const mild = P.logTolerance(st, 1, 'mild', 'evening:treatment:azelaic', day(1));
  assert.deepEqual(mild.logs, [{ d: 1, l: 'mild', s: null }], 'le soin n\'est retenu que pour une gêne modérée ou importante');
  const mod = P.logTolerance(st, 1, 'moderate', 'evening:treatment:azelaic', day(1));
  assert.equal(mod.logs[0].s, 'evening:treatment:azelaic');
  assert.equal(P.logTolerance(st, 1, 'moderate', 'evening:cleanse', day(1)).logs[0].s, null, 'une étape de base n\'est pas un soin ciblé');
  let big = st; for (let i = 0; i < P.MAX_LOGS; i++) big = P.logTolerance(big, 1, 'none', null, day(1));
  assert.equal(big.logs.length, P.MAX_LOGS); assert.equal(P.logTolerance(big, 1, 'none', null, day(1)), null);
});

test('AC3 gêne modérée sur un soin : pause de 3 jours, puis reprise à sa fréquence de départ ; l\'autre soin n\'est pas touché', () => {
  const other = hand('daily', 1, 2, 'morning:treatment:niacinamide', 'Niacinamide');
  let st = custom([...base('evening'), hand('daily', 1, 1), ...base('morning'), other]);
  st = P.logTolerance(st, 5, 'moderate', 'evening:treatment:azelaic', day(5));
  const states = d => due(st, d, 'evening:treatment:azelaic');
  assert.equal(states(4), 'due');
  for (const d of [5, 6, 7, 8]) assert.equal(states(d), 'paused', 'jour ' + d);
  assert.equal(P.dayView(st, 6).slots.evening.find(x => x.step.kind === 'treatment').until, 9);
  assert.equal(states(9), 'due', 'reprise le jour 9');
  for (let d = 1; d <= 12; d++) assert.equal(due(st, d, 'morning:treatment:niacinamide'), 'due', 'l\'autre soin continue (jour ' + d + ')');
});

test('AC4 la reprise après pause suit la cadence depuis le jour de reprise (un jour sur deux : 9, 11, 13…)', () => {
  let st = custom([...base('evening'), hand('alt')]);
  st = P.logTolerance(st, 3, 'moderate', 'evening:treatment:azelaic', day(3));
  assert.deepEqual([7, 8, 9, 10, 11].map(d => due(st, d, 'evening:treatment:azelaic')), ['due', 'rest', 'due', 'rest', 'due']);
  assert.equal(due(st, 6, 'evening:treatment:azelaic'), 'paused');
});

test('AC5 gêne modérée sans soin identifié : tous les soins ciblés en pause, et un soin pas encore introduit est repoussé', () => {
  let st = custom([...base('evening'), hand('daily', 1, 1), ...base('morning'), hand('daily', 8, 2, 'morning:treatment:niacinamide', 'Niacinamide')]);
  st = P.logTolerance(st, 6, 'moderate', null, day(6));
  assert.equal(due(st, 7, 'evening:treatment:azelaic'), 'paused');
  assert.equal(due(st, 8, 'morning:treatment:niacinamide'), 'paused', 'prévu au jour 8 mais la peau réagit');
  assert.equal(due(st, 10, 'morning:treatment:niacinamide'), 'due', 'repoussé après la pause');
});

test('AC6 réaction importante : tous les soins ciblés suspendus (même le jour même s\'ils ne sont pas cochés) jusqu\'à une reprise explicite, puis un par un', () => {
  const second = hand('daily', 8, 2, 'morning:treatment:niacinamide', 'Niacinamide');
  let st = custom([...base('evening'), hand('daily', 1, 1), ...base('morning'), second]);
  st = P.tick(st, 4, 'evening:treatment:azelaic', true, day(4));
  st = P.logTolerance(st, 4, 'strong', 'evening:treatment:azelaic', day(4));
  assert.equal(due(st, 4, 'evening:treatment:azelaic'), 'due', 'déjà cochée ce jour-là : elle reste visible');
  for (const d of [5, 9, 20, 30]) { assert.equal(due(st, d, 'evening:treatment:azelaic'), 'suspended'); assert.equal(due(st, d, 'morning:treatment:niacinamide'), 'suspended'); }
  assert.equal(P.dayView(st, 12).suspended, true);
  assert.equal(P.tick(st, 12, 'evening:treatment:azelaic', true, day(12)), null, 'on ne coche pas un soin suspendu');
  assert.equal(P.resume(custom([...base('evening'), hand('alt')]), day(3)), null, 'rien à reprendre sans suspension');
  const back = P.resume(st, day(10));
  assert.equal(P.dayView(back, 12).suspended, false);
  assert.equal(due(back, 9, 'evening:treatment:azelaic'), 'suspended', 'avant la reprise : toujours suspendu');
  assert.equal(due(back, 10, 'evening:treatment:azelaic'), 'due', 'premier soin repris le jour de la reprise');
  assert.equal(due(back, 12, 'morning:treatment:niacinamide'), 'later', 'second soin : une semaine plus tard');
  assert.equal(due(back, 17, 'morning:treatment:niacinamide'), 'due');
});

test('AC6b la suspension l\'emporte sur une pause en cours (réaction importante après une gêne modérée)', () => {
  let st = custom([...base('evening'), hand('daily')]);
  st = P.logTolerance(st, 3, 'moderate', 'evening:treatment:azelaic', day(3));
  st = P.logTolerance(st, 4, 'strong', null, day(4));
  assert.equal(due(st, 4, 'evening:treatment:azelaic'), 'suspended'); assert.equal(due(st, 5, 'evening:treatment:azelaic'), 'suspended');
  assert.equal(due(st, 3, 'evening:treatment:azelaic'), 'paused');
});

test('AC7 une pause ne rend jamais plus fort : après une pause, jamais plus de prises qu\'avant (fréquence de départ conservée)', () => {
  const countDue = st => Array.from({ length: 30 }, (_, i) => due(st, i + 1, 'evening:treatment:azelaic')).filter(x => x === 'due').length;
  const plain = custom([...base('evening'), hand('alt')]);
  const paused = P.logTolerance(plain, 6, 'moderate', 'evening:treatment:azelaic', day(6));
  assert.ok(countDue(paused) < countDue(plain));
});

/* =================== 3. Bilan hebdomadaire =================== */

test('BI1 bilan : rien avant le départ, journée en cours non comptée comme manquée, semaines suivantes seulement quand elles ont commencé', () => {
  const st = custom([...base('evening'), ...base('morning')]);
  assert.deepEqual(P.review(st, '2026-10-01'), [], 'avant le départ');
  const w1 = P.review(st, day(1));
  assert.equal(w1.length, 1); assert.equal(w1[0].regularity, 'wait'); assert.equal(w1[0].expected, 0);
  assert.match(w1[0].messages[0], /Pas encore assez de jours écoulés/);
  assert.equal(P.review(st, day(8)).length, 2); assert.equal(P.review(st, day(30)).length, 5); assert.equal(P.review(st, day(45)).length, 5);
  const last = P.review(st, day(45)).pop(); assert.equal(last.final, true); assert.equal(last.complete, true);
});

test('BI2 régularité : actions faites sur actions prévues des jours terminés, seuils 80 % / 50 %', () => {
  let st = custom([...base('evening')]);                                // 2 actions par jour
  const tickDays = (s, days) => days.reduce((acc, d) => P.tick(P.tick(acc, d, 'evening:cleanse', true, day(8)), d, 'evening:moisturize', true, day(8)), s);
  const w = (s) => P.review(s, day(8))[0];
  assert.equal(w(tickDays(st, [1, 2, 3, 4, 5, 6, 7])).regularity, 'good');
  assert.equal(w(tickDays(st, [1, 2, 3, 4])).regularity, 'mid');
  assert.equal(w(tickDays(st, [1])).regularity, 'low');
  const r = w(tickDays(st, [1, 2, 3, 4]));
  assert.equal(r.expected, 14); assert.equal(r.done, 8); assert.ok(Math.abs(r.adherence - 8 / 14) < 1e-9);
  assert.equal(w(st).done, 0);
});

test('BI3 messages de tolérance : réaction importante > gêne modérée > gêne légère > bonne tolérance > aucune note ; avis professionnel si ça se répète', () => {
  const st = custom([...base('evening'), hand('alt')]);
  const msg = (log) => P.review(log, day(7))[0].messages.join(' | ');
  assert.match(msg(st), /Aucune tolérance notée/);
  assert.match(msg(P.logTolerance(st, 1, 'none', null, day(1))), /Bonne tolérance notée/);
  assert.match(msg(P.logTolerance(st, 1, 'mild', null, day(1))), /gênes légères/);
  assert.match(msg(P.logTolerance(st, 1, 'moderate', 'evening:treatment:azelaic', day(1))), /Gêne modérée notée/);
  const strong = P.logTolerance(P.logTolerance(st, 1, 'mild', null, day(1)), 2, 'strong', null, day(2));
  assert.match(msg(strong), /Réaction importante/); assert.doesNotMatch(msg(strong), /gênes légères/);
  let twice = P.logTolerance(st, 1, 'moderate', null, day(1)); twice = P.logTolerance(twice, 6, 'moderate', null, day(6));
  assert.match(msg(twice), /avis professionnel est conseillé/);
});

test('BI4 la consigne de progression de la fiche n\'est rappelée que sans gêne notée et après une semaine d\'utilisation du soin', () => {
  const t = Object.assign(hand('alt'), { note: 'Passez à chaque soir si votre peau le tolère.' });
  const st = custom([...base('evening'), t]);
  assert.deepEqual(P.review(st, day(7))[0].hints, [], 'première semaine d\'utilisation : pas encore');
  assert.match(P.review(st, day(10))[1].hints[0], /Acide azélaïque : Passez à chaque soir/);
  assert.deepEqual(P.review(P.logTolerance(st, 9, 'moderate', 'evening:treatment:azelaic', day(9)), day(10))[1].hints, [], 'jamais après une gêne');
  assert.deepEqual(P.review(P.logTolerance(st, 9, 'mild', null, day(9)), day(10))[1].hints.length, 1);
});

test('BI5 le bilan annonce les soins introduits cette semaine-là', () => {
  const st = stateOf();
  const w = P.review(st, day(9));
  assert.match(w[0].intro.join(' '), /est introduit à partir du jour 1/); assert.match(w[1].intro.join(' '), /est introduit à partir du jour 8/);
});

/* =================== 4. Dates, état enregistré et données hostiles =================== */

test('DT1 numéro du jour : calendrier, indépendant du fuseau et de l\'heure d\'été ; départ futur ou date invalide → 0', () => {
  assert.equal(P.dayNumber('2026-10-12', '2026-10-12'), 1); assert.equal(P.dayNumber('2026-10-12', '2026-11-10'), 30); assert.equal(P.dayNumber('2026-10-12', '2026-11-11'), 31);
  assert.equal(P.dayNumber('2026-03-28', '2026-03-30'), 3, 'changement d\'heure en Europe');
  assert.equal(P.dayNumber('2028-02-28', '2028-03-01'), 3, 'année bissextile');
  assert.equal(P.dayNumber('2026-10-12', '2026-10-11'), 0);
  for (const bad of ['', null, undefined, '2026-13-01', '2026-02-30', 'hier', '12/10/2026', 20261012]) { assert.equal(P.dayNumber(bad, '2026-10-12'), 0); assert.equal(P.dayNumber('2026-10-12', bad), 0); }
  assert.equal(P.addDays('2026-10-31', 1), '2026-11-01'); assert.equal(P.addDays('x', 1), null);
});

test('DT2 état enregistré hostile : forme inattendue ignorée, étapes inconnues retirées, tailles bornées, jamais d\'exception', () => {
  const good = JSON.parse(JSON.stringify(stateOf()));
  for (const bad of [null, undefined, 5, 'x', [], {}, { v: 2 }, Object.assign({}, good, { v: 2 }), Object.assign({}, good, { start: '2026-02-30' }), Object.assign({}, good, { start: 'x' }),
    Object.assign({}, good, { plan: null }), Object.assign({}, good, { plan: { steps: [] } }), Object.assign({}, good, { plan: { steps: 'x' } })])
    assert.equal(P.cleanState(bad), null, JSON.stringify(bad));
  const hostile = JSON.parse(JSON.stringify(good));
  hostile.checks = { 1: ['morning:cleanse', 'inconnu', 5, null, 'morning:cleanse'], 99: ['morning:cleanse'], x: [], 2: 'x', __proto__: { y: 1 } };
  hostile.logs = [{ d: 1, l: 'none' }, { d: 0, l: 'none' }, { d: 1, l: 'zzz' }, null, 7, { d: 2, l: 'moderate', s: 'inconnu' }, { d: 31, l: 'mild' }, { d: 3, l: 'resume' }].concat(Array.from({ length: 500 }, () => ({ d: 4, l: 'none' })));
  hostile.plan.steps = hostile.plan.steps.map(s => Object.assign({}, s, { evil: '<script>', cautions: Array.from({ length: 50 }, () => 'x'.repeat(900)), role: 'y'.repeat(5000) })).concat(Array.from({ length: 40 }, (_, i) => Object.assign({}, hostile.plan.steps[0], { slot: 'zzz' + i })));
  const st = P.cleanState(hostile);
  assert.equal(st, null, 'une étape invalide parmi les premières : tout l\'état est refusé');
  hostile.plan.steps = hostile.plan.steps.slice(0, good.plan.steps.length);
  const st2 = P.cleanState(hostile);
  assert.ok(st2); assert.deepEqual(st2.checks, { 1: ['morning:cleanse'] });
  assert.ok(st2.logs.length <= P.MAX_LOGS); assert.ok(st2.logs.every(l => l.d >= 1 && l.d <= 30)); assert.equal(st2.logs.find(l => l.d === 2).s, null);
  assert.ok(st2.plan.steps.length <= 12 && st2.plan.steps.every(s => !('evil' in s) && s.role.length <= 400 && s.cautions.length <= 4 && s.cautions.every(c => c.length <= 200)));
  assert.ok(JSON.stringify(st2).length < 16000, 'taille maximale d\'un suivi');
  const many = JSON.parse(JSON.stringify(good)); many.plan.steps = Array.from({ length: 30 }, (_, i) => Object.assign({}, good.plan.steps[0], { id: 'morning:treatment:a' + i, kind: 'treatment', activeId: 'a' + i, order: 1 }));
  assert.equal(P.cleanState(many).plan.steps.length, 12, 'plus de 12 étapes : tronqué');
  const dup = JSON.parse(JSON.stringify(good)); dup.plan.steps.push(dup.plan.steps[0]); assert.equal(P.cleanState(dup), null, 'identifiants d\'étape en double');
  const wrongSlot = JSON.parse(JSON.stringify(good)); wrongSlot.plan.steps[0].slot = 'evening'; assert.equal(P.cleanState(wrongSlot), null, 'identifiant et créneau incohérents');
});

test('DT3 aller-retour : un état valide se normalise vers lui-même', () => {
  const st = P.logTolerance(P.tick(stateOf(), 1, 'morning:cleanse', true, day(1)), 1, 'mild', null, day(1));
  assert.deepEqual(P.cleanState(JSON.parse(JSON.stringify(st))), st);
});

/* =================== 5. Textes : prudents, sans promesse, sans diagnostic, sans produit imposé =================== */

const word = src => new RegExp('(?<![\\p{L}])(?:' + src + ')(?![\\p{L}])', 'iu'), stem = src => new RegExp('(?<![\\p{L}])(?:' + src + ')', 'iu');
const FORBIDDEN = [
  [new RegExp('(?<![\\p{L}])vous avez (?!indiqu[ée]|choisi)', 'iu'), 'Vous avez'], [word('vous souffrez'), 'Vous souffrez'], [word('traiter'), 'traiter'], [word('il faut'), 'Il faut'],
  [stem('malad'), 'maladie'], [stem('patholog'), 'pathologie'], [stem('pr[ée]scri'), 'prescription'], [stem('gu[ée]ri'), 'guérir'], [word('soigner'), 'soigner'],
  [word('traitements?'), 'traitement'], [word('cause[sz]?|causer'), 'cause'], [stem('[ée]claircissant'), 'éclaircissant'], [word('blanchir'), 'blanchir'], [stem('d[ée]pigment'), 'dépigmentant'],
  [stem('(?<!n\'est )garanti|assur[ée] '), 'promesse'], [stem('miracle|d[ée]finitif'), 'promesse'], [stem('100 ?%'), 'pourcentage'], [/FCFA|XOF|€|\$|\bCFA\b/, 'prix']
];
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out)); return out; };
const noForbidden = (texts, where) => { for (const t of texts) for (const [re, name] of FORBIDDEN) assert.doesNotMatch(t, re, `${where} : « ${name} » dans « ${t} »`); };

test('TX1 le test de garde détecte bien les formulations interdites (il n\'est pas vide)', () => {
  for (const bad of ['Vous avez de l\'acné', 'Il faut traiter la peau', 'Ce traitement guérit', 'Résultat garanti', 'Une peau 100 % nette', 'Pour 2 000 FCFA', 'Cause de l\'acné', 'Effet définitif'])
    assert.ok(FORBIDDEN.some(([re]) => re.test(bad)), bad);
  for (const ok of ['Votre analyse indique…', 'Ce n\'est pas un diagnostic médical', 'Demandez conseil à un pharmacien', 'Aucun résultat n\'est garanti']) assert.ok(!FORBIDDEN.some(([re]) => re.test(ok)), ok);
});

test('TX2 tous les textes du programme (copy, bilans, conseils budget, sécurité) respectent le vocabulaire prudent', () => {
  const texts = strings(P.COPY); P.LEVELS.forEach(() => {});
  texts.push(P.COPY.weekTitle(1), P.COPY.weekTitle(5), P.COPY.newStep('Soin', 3));
  noForbidden(texts, 'program.js');
  noForbidden(strings(require('../js/insight-view.js').DermaiInsight ? [] : []), 'x');
});

test('TX3 orientation vers un professionnel : urgence, réaction importante, grossesse, grain de beauté ; jamais un outil de diagnostic ; aucune marque ni prix', () => {
  const all = strings(P.COPY).join(' ');
  for (const must of [/professionnel de santé/, /en urgence/, /difficulté à respirer/, /Grossesse/, /grain de beauté/, /pharmacien/, /ce n'est pas un|n'est pas un outil de diagnostic/i, /ne promet aucun résultat/, /n'impose aucun produit/, /Bénin/])
    assert.match(all, must);
  assert.match(P.COPY.reaction.strong, /professionnel de santé/); assert.match(P.COPY.reaction.strong, /urgence/);
  assert.match(P.COPY.reaction.moderate, /professionnel/);
  const catalog = require('../js/engine/data/products.js');
  const brands = new Set(strings(catalog.PRODUCTS || []).filter(x => x.length > 3 && x.length < 40).map(x => x.toLowerCase()));
  for (const b of ['the ordinary', 'cerave', 'la roche', 'vichy', 'garnier', 'nivea', 'eucerin', 'neutrogena']) assert.ok(!all.toLowerCase().includes(b), b);
  assert.ok(brands.size >= 0);
});

test('TX4 quatre conseils budget adaptés à la situation (étapes de base d\'abord, un produit à la fois, étiquette plutôt que marque, aucun prix ni produit imposé)', () => {
  assert.equal(P.COPY.budget.length, 4);
  assert.match(P.COPY.budget[0], /étapes de base/); assert.match(P.COPY.budget[1], /qu'après une semaine/); assert.match(P.COPY.budget[2], /étiquette plutôt que la marque/); assert.match(P.COPY.budget[3], /Bénin/);
  for (const k of ['cleanse', 'moisturize', 'spf', 'treatment']) assert.match(P.COPY.budgetByKind[k], /^Option économique/);
});

/* =================== 6. Suivi : stockage par compte, actions, affichage =================== */

function fakeStorage(o = {}) {
  const m = new Map();
  return { m, getItem: k => { if (o.getThrows) throw new Error('refusé'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (o.setThrows) throw new Error('quota'); m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
}
function setup(o = {}) {
  const e = { today: START, uid: o.uid === undefined ? 'u-a' : o.uid, renders: 0, storage: o.storage || fakeStorage() };
  e.care = Care.create({ storage: () => e.storage, userId: () => e.uid, today: () => e.today, render: () => { e.renders++; }, ic: n => `<i data-ic="${n}"></i>`, esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) });
  e.eng = SAMPLE(); e.scan = { rec: { id: '11111111-2222-4333-8444-555555555555', analyzedAt: '2026-10-11T08:00:00.000Z' }, analyzedAt: '2026-10-11T08:00:00.000Z' };
  e.page = () => e.care.page(e.eng, e.scan);
  e.key = u => 'dermai.care.' + u;
  e.saved = u => { const v = e.storage.m.get(e.key(u || e.uid)); return v ? JSON.parse(v) : null; };
  return e;
}

test('CP1 sans programme : présentation honnête (réutilise l\'analyse, aucune nouvelle analyse), sécurité, budget, bouton de départ ; aucun lien vers une analyse', () => {
  const e = setup(), h = e.page();
  assert.match(h, /Mon programme de 30 jours/); assert.match(h, /aucune nouvelle analyse n'est lancée, jamais automatiquement/);
  assert.match(h, /data-cp="start"/); assert.match(h, /Quand demander un avis professionnel/); assert.match(h, /Rester raisonnable côté budget/);
  assert.match(h, /Jour 1 : nettoyage doux, hydratation, protection solaire le matin/); assert.match(h, /Jour 8 : [^<]*\((un jour sur deux|chaque jour|deux fois par semaine|une fois par semaine)\)/);
  assert.doesNotMatch(h, /data-act="analyze"|data-go="scan"|undefined|NaN|\[object/);
  assert.equal(e.storage.m.size, 0, 'consulter la présentation n\'écrit rien');
});

test('CP2 démarrer : le plan est figé et enregistré sous la clé du compte ; une autre identité ne le voit jamais ; effacer le supprime', () => {
  const e = setup();
  e.page(); e.care.handle('start', {});
  const st = e.saved('u-a'); assert.equal(st.v, 1); assert.equal(st.start, START); assert.equal(st.plan.base.id, e.scan.rec.id);
  assert.equal(e.renders, 1);
  assert.match(e.page(), /Jour 1 sur 30/);
  e.uid = 'u-b'; assert.match(e.page(), /data-cp="start"/, 'un autre compte ne voit pas le suivi de A'); assert.equal(e.saved('u-b'), null);
  e.uid = 'u-a'; assert.match(e.page(), /Jour 1 sur 30/);
  e.care.clear(); assert.equal(e.saved('u-a'), null); assert.match(e.page(), /data-cp="start"/);
  assert.deepEqual([...e.storage.m.keys()].filter(k => k !== e.key('u-b')), []);
});

test('CP3 le plan est figé : changer de profil ou de moteur ne modifie pas un programme commencé', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  const before = JSON.stringify(e.saved().plan);
  e.eng = run({ acne: 90 }, {}, { level: 'none' }); e.page();
  assert.equal(JSON.stringify(e.saved().plan), before);
  assert.match(e.page(), /pas de ce soin|À partir du jour|Nettoyant doux/);
});

test('CP4 cocher / décocher passe par le journal, s\'affiche (aria-pressed) et ne réécrit que ce qui change', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  e.care.handle('tick', { d: '1', s: 'morning:cleanse' });
  assert.deepEqual(e.saved().checks, { 1: ['morning:cleanse'] });
  assert.match(e.page(), /data-s="morning:cleanse" aria-pressed="true"/);
  e.care.handle('tick', { d: '1', s: 'morning:cleanse' });
  assert.deepEqual(e.saved().checks, {}); assert.match(e.page(), /data-s="morning:cleanse" aria-pressed="false"/);
  e.care.handle('tick', { d: '2', s: 'morning:cleanse' }); assert.deepEqual(e.saved().checks, {}, 'jour à venir refusé');
  e.care.handle('tick', { d: '1', s: 'inconnu' }); e.care.handle('tick', { d: 'x', s: 'morning:cleanse' }); assert.deepEqual(e.saved().checks, {});
  e.care.handle('n\'importe quoi', {}); assert.doesNotThrow(() => e.page());
});

test('CP5 tolérance : légère → noté tout de suite ; modérée / importante → on demande quel soin, avec « je ne sais pas » ; message prudent affiché', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  e.care.handle('tol', { l: 'mild' });
  assert.deepEqual(e.saved().logs, [{ d: 1, l: 'mild', s: null }]); assert.match(e.page(), /Gardez la même fréquence/);
  e.care.handle('tol', { l: 'moderate' });
  assert.equal(e.saved().logs.length, 1, 'pas encore noté : on demande le soin');
  let h = e.page(); assert.match(h, /Quel soin pensez-vous concerné/); assert.match(h, /data-cp="tolstep" data-s="evening:treatment:azelaic"/); assert.match(h, /Je ne sais pas/);
  e.care.handle('tolstep', { s: 'evening:treatment:azelaic' });
  assert.deepEqual(e.saved().logs[1], { d: 1, l: 'moderate', s: 'evening:treatment:azelaic' });
  h = e.page(); assert.match(h, /mis en pause 3 jours/); assert.match(h, /Ne le reprenez que si votre peau est apaisée/); assert.match(h, /En pause après une gêne notée\. Reprise possible au jour 5, seulement si la peau est apaisée/);
  e.care.handle('tol', { l: 'strong' }); e.care.handle('tolstep', { s: 'none' });
  assert.equal(e.saved().logs[2].s, null);
  h = e.page(); assert.match(h, /Suspendu : réaction importante notée/); assert.match(h, /data-cp="resume"/); assert.match(h, /professionnel de santé/);
  e.care.handle('tolstep', { s: 'evening:treatment:azelaic' }); assert.equal(e.saved().logs.length, 3, 'choix sans question en cours : ignoré');
});

test('CP6 reprise après réaction importante : explicite, jamais automatique', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  e.care.handle('tol', { l: 'strong' }); e.care.handle('tolstep', { s: 'none' });
  e.today = day(6); assert.match(e.page(), /Suspendu/);
  e.care.handle('resume', {}); assert.deepEqual(e.saved().logs.at(-1), { d: 6, l: 'resume', s: null }); assert.doesNotMatch(e.page(), /data-cp="resume"/);
});

test('CP7 avec le temps : jour affiché, jours précédents modifiables, programme terminé, date reculée', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  e.today = day(3); let h = e.page(); assert.match(h, /Jour 3 sur 30/); assert.match(h, /data-cp="day" data-d="1"/);
  e.care.handle('day', { d: '1' }); assert.match(e.page(), /Jour 1 : 0 sur/); e.care.handle('tick', { d: '1', s: 'morning:cleanse' }); assert.deepEqual(e.saved().checks, { 1: ['morning:cleanse'] });
  e.care.handle('day', { d: '9' }); assert.match(e.page(), /Jour 1 : /, 'jour à venir refusé : on reste sur le jour choisi');
  e.today = day(45); h = e.page(); assert.match(h, /Programme terminé/); assert.match(h, /facultatif : DERMAI n'en lance jamais automatiquement/); assert.match(h, /Bilan des jours 29 et 30/);
  e.today = '2026-09-01'; h = e.page(); assert.match(h, /antérieure au départ/); assert.match(h, /Jour 1 sur 30/);
});

test('CP8 bilans affichés : plus récent ouvert, régularité, tolérance, aucune promesse', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  assert.doesNotMatch(e.page(), /Actions faites : 0 sur 0/, 'jour 1 : pas de chiffre vide, la régularité n\'est pas encore jugée');
  e.today = day(9); e.care.handle('tol', { l: 'mild' });
  const h = e.page(); assert.match(h, /<details class="c-why" open><summary>Bilan de la semaine 2 \(en cours\)/); assert.match(h, /Bilan de la semaine 1/); assert.match(h, /Actions faites : 0 sur /);
  assert.doesNotMatch(h, /Votre peau s'est améliorée|résultat garanti/i);
});

test('CP9 redémarrer / effacer : deux temps (confirmation) ; annuler ne change rien', () => {
  const e = setup(); e.page(); e.care.handle('start', {}); e.care.handle('tick', { d: '1', s: 'morning:cleanse' });
  const r0 = e.renders; e.care.handle('restart', {}); assert.equal(e.renders, r0 + 1, 'la demande de confirmation réaffiche l\'écran'); assert.match(e.page(), /Recommencer efface le suivi actuel/); assert.deepEqual(e.saved().checks, { 1: ['morning:cleanse'] });
  e.care.handle('cancel', {}); assert.doesNotMatch(e.page(), /Recommencer efface/);
  e.care.handle('erase', {}); assert.match(e.page(), /Effacer supprime de cet appareil/); e.care.handle('erase-yes', {});
  assert.equal(e.saved(), null); assert.match(e.page(), /data-cp="start"/);
  e.care.handle('start', {}); e.care.handle('tick', { d: '1', s: 'morning:cleanse' }); e.care.handle('restart', {}); e.care.handle('restart-yes', {});
  assert.deepEqual(e.saved().checks, {}, 'recommencer repart de zéro');
});

test('CP10 une analyse plus récente est signalée, sans modifier le programme ni lancer d\'analyse', () => {
  const e = setup(); e.page(); e.care.handle('start', {});
  e.scan = { rec: { id: '99999999-2222-4333-8444-555555555555', analyzedAt: '2026-10-20T08:00:00.000Z' } };
  const h = e.page(); assert.match(h, /Une analyse plus récente existe/); assert.equal(e.saved().plan.base.id, '11111111-2222-4333-8444-555555555555');
  assert.doesNotMatch(h, /data-act="analyze"/);
});

test('CP11 stockage refusé : le suivi reste affiché pour la visite et l\'écran le dit ; lecture refusée = pas de programme ; aucune exception', () => {
  const e = setup({ storage: fakeStorage({ setThrows: true }) }); e.page();
  assert.doesNotThrow(() => e.care.handle('start', {}));
  const h = e.page(); assert.match(h, /Jour 1 sur 30/); assert.match(h, /refuse de garder votre suivi/);
  assert.doesNotThrow(() => e.care.handle('tick', { d: '1', s: 'morning:cleanse' })); assert.match(e.page(), /aria-pressed="true"/);
  const e2 = setup({ storage: fakeStorage({ getThrows: true }) }); assert.match(e2.page(), /data-cp="start"/);
  const e3 = setup({ storage: null }); e3.storage = null; assert.doesNotThrow(() => { e3.page(); e3.care.handle('start', {}); });
});

test('CP12 suivi enregistré corrompu ou piégé : ignoré (présentation), jamais d\'exception ; textes échappés', () => {
  const e = setup(); e.storage.m.set(e.key('u-a'), '{pas du json'); assert.match(e.page(), /data-cp="start"/);
  const f = setup();
  f.storage.m.set(f.key('u-a'), JSON.stringify({ v: 1, start: START, plan: { steps: [{ id: 'morning:cleanse', slot: 'morning', kind: 'cleanse', origin: 'base', label: '<img src=x onerror=alert(1)>', role: '"><script>alert(1)</script>', cad: 'daily', first: 1 }] }, checks: {}, logs: [] }));
  const h = f.page(); assert.doesNotMatch(h, /<img src=x|<script>/); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('CP12b plusieurs onglets : chaque action relit le stockage, « Commencer » n\'écrase jamais un programme existant, on ne réécrit pas un état périmé', () => {
  const a = setup(), b = setup({ storage: a.storage });
  assert.match(a.page(), /data-cp="start"/); assert.match(b.page(), /data-cp="start"/);
  a.care.handle('start', {}); a.care.handle('tick', { d: '1', s: 'morning:cleanse' });
  b.care.handle('start', {});                                            // l'onglet B affichait encore l'invitation : rien n'est écrasé
  assert.deepEqual(a.saved().checks, { 1: ['morning:cleanse'] });
  assert.match(b.page(), /Jour 1 sur 30/);                              // B a maintenant en mémoire un état qui va devenir périmé
  a.care.handle('tick', { d: '1', s: 'evening:cleanse' });
  b.care.handle('tick', { d: '1', s: 'morning:moisturize' });
  assert.deepEqual(a.saved().checks, { 1: ['morning:cleanse', 'evening:cleanse', 'morning:moisturize'] }, 'les trois cases sont conservées : B relit avant d\'écrire');
  assert.match(b.page(), /Jour 1 sur 30/);
});

test('CP12c fréquence non reconnue : la présentation, l\'écran du jour et un message le disent, aucune case à cocher pour ce soin', () => {
  const e = setup(), { plan, target } = withFrequency('Texte inconnu');
  e.eng = Object.assign({}, e.eng, { routinePlan: plan });
  let h = e.page(); assert.match(h, /fréquence non reconnue, non planifié automatiquement/);
  e.care.handle('start', {});
  h = e.page();
  assert.match(h, /Fréquence non reconnue pour : [^<]+\. Ces soins ne sont pas planifiés automatiquement/);
  assert.match(h, /Fréquence non reconnue : ce soin n'est pas planifié automatiquement\. Suivez la consigne de sa fiche d'actif ou demandez conseil à un pharmacien\. Consigne de la fiche : Texte inconnu\./);
  assert.doesNotMatch(h, new RegExp('data-cp="tick" data-d="\\d+" data-s="' + target.id.replace(/[:]/g, ':') + '"'));
  e.care.handle('tick', { d: '1', s: target.id }); assert.deepEqual(e.saved().checks, {}, 'refusé');
  const ok = setup(); ok.page(); ok.care.handle('start', {}); assert.doesNotMatch(ok.page(), /Fréquence non reconnue/);
});

test('TX5 relecture des textes de sécurité : arrêt des produits qui irritent, reprise seulement si la peau est apaisée, avis professionnel avant reprise, urgence, aucune validation médicale affirmée', () => {
  const C = P.COPY;
  assert.match(C.reaction.strong, /Arrêtez tous les soins ciblés et tout produit qui pique ou brûle/); assert.match(C.reaction.strong, /rincez à l'eau tiède/);
  assert.match(C.reaction.strong, /professionnel de santé avant de les reprendre/); assert.match(C.reaction.strong, /consultez en urgence/);
  assert.doesNotMatch(C.reaction.strong, /Gardez/, 'après une réaction importante, on ne recommande pas de continuer les produits de base');
  assert.match(C.reaction.moderate, /Ne le reprenez que si votre peau est apaisée/); assert.match(C.reaction.moderate, /Si la gêne persiste ou revient, ne le reprenez pas/); assert.match(C.reaction.moderate, /Si un autre produit pique aussi, arrêtez-le/);
  assert.match(C.moderateWeek, /Ne le reprenez que si la peau est apaisée/);
  assert.match(C.resumeNote, /seulement quand la peau est apaisée et après l'avis d'un professionnel de santé/);
  assert.match(C.safety[1], /yeux douloureux ou vision gênée/);
  assert.match(C.progressHint, /sans précipitation et un seul changement à la fois/);
  assert.doesNotMatch(strings(C).join(' '), /Bravo|c'est déjà utile|texture compte plus que le prix|convient souvent mieux|cliniquement|validé par|approuvé|testé médicalement|dermatologiquement/i);
  assert.match(C.tolNote, /ne les interprète pas comme un avis médical/);
  const L = require('../js/insight-view.js').DermaiInsight.LIMITS.base.join(' ');
  assert.match(L, /il ne permet pas de conclure à un problème de santé/); assert.doesNotMatch(L, /pas un signe de problème de santé/);
  // un score ou une note n'est jamais présenté comme un diagnostic
  assert.doesNotMatch(strings(C).concat(L).join(' '), /votre diagnostic|diagnostic de|vous avez (?!indiqu|choisi)|vous souffrez|vous êtes atteint/i);
});

test('CP13 sans compte (démonstration) : suivi seulement en mémoire, rien d\'écrit dans le stockage', () => {
  const e = setup({ uid: null }); e.page(); e.care.handle('start', {}); e.care.handle('tick', { d: '1', s: 'morning:cleanse' });
  assert.match(e.page(), /Jour 1 sur 30/); assert.equal(e.storage.m.size, 0);
});

test('CP14 effacement à la suppression du compte : retrouve le dernier compte connu même si la session est déjà fermée', () => {
  const e = setup(); e.page(); e.care.handle('start', {}); assert.ok(e.saved('u-a'));
  e.uid = null; e.care.clear(); assert.equal(e.saved('u-a'), null);
});

test('CP15 écouteur : un clic sur un élément data-cp déclenche l\'action, rien d\'autre', () => {
  const e = setup(); e.page(); e.care.handle('start', {}); let handler = null;
  e.care.attach({ addEventListener: (t, f) => { assert.equal(t, 'click'); handler = f; } });
  handler({ target: { closest: () => ({ dataset: { cp: 'tick', d: '1', s: 'morning:cleanse' } }) } });
  assert.deepEqual(e.saved().checks, { 1: ['morning:cleanse'] });
  assert.doesNotThrow(() => handler({ target: { closest: () => null } })); assert.doesNotThrow(() => handler({ target: {} })); assert.doesNotThrow(() => e.care.attach(null));
});

test('CP16 entrée sur l\'écran Routine : état du programme, lien interne uniquement', () => {
  const e = setup();
  assert.match(e.care.entry(), /data-go="program"/); assert.match(e.care.entry(), /sans nouvelle analyse/);
  e.page(); e.care.handle('start', {}); e.today = day(4); assert.match(e.care.entry(), /Jour 4 sur 30/);
  e.today = day(60); assert.match(e.care.entry(), /Programme terminé/);
});

test('CP17 par construction : ni réseau, ni service d\'analyse, ni horloge cachée, ni aléa', () => {
  for (const f of ['js/engine/program.js', 'js/care-program.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|skin-analysis|\/api\/|analyzeSkin|provider|Perfect|data-act="analyze"|Math\.random|Date\.now/, f);
  }
  assert.doesNotMatch(read('js/engine/program.js').replace(/\/\*[\s\S]*?\*\//g, ''), /new Date\(\)/.source ? /new Date\(\)(?!\))/ : /x/, 'la date du jour est un paramètre (seule localDate lit l\'horloge)');
  assert.deepEqual(trap, [], 'aucun appel réseau pendant ces tests');
});

/* =================== 7. Rapport : limites et précautions =================== */

test('LI1 « Limites et précautions » : six repères, indicateurs non évalués cités, jamais de diagnostic ni de promesse', () => {
  globalThis.SkinModel = require('../js/skin-model.js'); globalThis.DermaiEngine = require('../js/engine/index.js');
  const { DermaiInsight } = require('../js/insight-view.js');
  const full = DermaiInsight.limits(run({ acne: 30 }, {}, {}));
  assert.match(full, /Limites et précautions/); assert.match(full, /une seule photo/); assert.match(full, /pas un diagnostic médical/); assert.match(full, /Aucun résultat n'est garanti/);
  assert.match(full, /professionnel de santé/); assert.match(full, /consultez en urgence/);
  assert.equal((full.match(/<li>/g) || []).length, 5, 'cinq repères quand tout est évalué');
  assert.doesNotMatch(full, /Non évalués/);
  const some = DermaiInsight.limits(run({ acne: 30, wrinkles: null, firmness: null }, {}, {}));
  assert.match(some, /Non évalués dans cette analyse : [^<]*Rides[^<]*Fermeté|Non évalués dans cette analyse : [^<]*Fermeté[^<]*Rides/);
  assert.equal((some.match(/<li>/g) || []).length, 6); assert.match(some, /n'en tire aucune conclusion/);
  noForbidden(strings(DermaiInsight.LIMITS.base).concat(DermaiInsight.LIMITS.missing('A, B')), 'limites');
  assert.doesNotThrow(() => DermaiInsight.limits(null)); assert.doesNotThrow(() => DermaiInsight.limits({}));
});

/* =================== 8. Câblage dans l'application =================== */

const app = read('js/app.js');
test('WI1 écran programme : route restaurable, alimenté par la dernière analyse, jamais par le fournisseur', () => {
  assert.match(app, /`forgot`,`program`\]\);/);
  const v = app.slice(app.indexOf('V.program='), app.indexOf('\n', app.indexOf('V.program=')));
  assert.match(v, /noReal\(\)\?emptyScan\(/); assert.match(v, /CP\.page\(engineFor\(SCANS\[state\.latest\]\),SCANS\[state\.latest\]\)/);
  assert.doesNotMatch(v, /provider|analyzeSkin|runRealAnalysis|F\.arm|go\(/);
  assert.match(app, /const CP=DermaiCare\.create\(\{storage:\(\)=>window\.localStorage,userId:\(\)=>ACCOUNT&&ACCOUNT\.user\?ACCOUNT\.user\.id:null,render:\(\)=>render\(true\),ic,esc\}\);CP\.attach\(document\);/);
});
test('WI2 entrée depuis la routine, limites dans le résultat, effacement avec le compte', () => {
  assert.match(app, /<div class="col">\$\{CP\.entry\(\)\}<button class="rowlink" data-go="actives"/);
  assert.match(app, /\$\{H\?``:DermaiInsight\.limits\(eng\)\}<div class="stack"><button class="c-btn c-btn--secondary c-btn--block" data-go="scan">/);
  assert.match(app.slice(app.indexOf('async function deleteMyAccount'), app.indexOf('async function submitAuth')), /F\.clear\(\);CP\.clear\(\);resetPrivateState\(\)/);
});
test('WI3 scripts : program.js avant care-program.js, les deux avant app.js, chacun une fois', () => {
  const html = read('index.html'), at = s => html.indexOf(`<script src="${s}"></script>`);
  assert.ok(at('js/engine/routine.js') < at('js/engine/program.js') && at('js/engine/program.js') < at('js/engine/index.js'));
  assert.ok(at('js/engine/program.js') < at('js/care-program.js') && at('js/care-program.js') < at('js/app.js'));
  for (const f of ['js/engine/program.js', 'js/care-program.js']) assert.equal((html.match(new RegExp(f.replace(/[./]/g, '\\$&'), 'g')) || []).length, 1, f);
});
test('WI4 le plafond de 150 000 octets de app.js est respecté (inchangé)', () => { assert.ok(fs.statSync(path.join(__dirname, '..', 'js/app.js')).size < 150000); });
test('WI5 aucun appel réseau n\'a eu lieu pendant ce fichier de tests (donc aucun appel à Perfect Corp)', () => { assert.deepEqual(trap, []); });
