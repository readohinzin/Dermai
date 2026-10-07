'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Engine, randomCase, run } = require('./helpers/engine.js');
const copy = require('../js/engine/copy.fr.js');
const adata = require('../js/engine/data/actives.js');
const pdata = require('../js/engine/data/products.js');
const idata = require('../js/engine/data/indicators.js');

/* Garde-fou de formulation : aucun diagnostic, maladie, pathologie, prescription, promesse médicale ou « éclaircissement » dans les textes
   destinés à l'utilisateur. Les négations légitimes (« ce n'est pas un diagnostic ») sont autorisées : le mot « diagnostic » n'est donc pas interdit. */
/* \b de JavaScript ne reconnaît pas les lettres accentuées : on utilise des bornes Unicode. */
const word = src => new RegExp('(?<![\\p{L}])(?:' + src + ')(?![\\p{L}])', 'iu');
const stem = src => new RegExp('(?<![\\p{L}])(?:' + src + ')', 'iu');
const FORBIDDEN = [
  [new RegExp('(?<![\\p{L}])vous avez (?!indiqu[ée]|choisi)', 'iu'), 'Vous avez (hors « indiqué » / « choisi »)'], [word('vous souffrez'), 'Vous souffrez'], [word('traiter'), 'traiter'], [word('il faut'), 'Il faut'],
  [stem('malad'), 'maladie'], [stem('patholog'), 'pathologie'], [stem('pr[ée]scri'), 'prescription'], [stem('gu[ée]ri'), 'guérir'], [word('soigner'), 'soigner'],
  [word('[ée]claircir'), 'éclaircir'], [stem('[ée]claircissant'), 'éclaircissant'], [word('blanchir'), 'blanchir'], [stem('blanchissant'), 'blanchissant'],
  [stem('d[ée]pigment'), 'dépigmentant'], [stem('acn[ée]\\s+(?:sévère|kystique)'), 'acné sévère']
];
function collect(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => collect(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collect(x, out));
  return out;
}
const check = (texts, where) => { for (const t of texts) for (const [re, name] of FORBIDDEN) assert.doesNotMatch(t, re, `${where} : « ${name} » dans « ${t} »`); };

test('CP1 le test de garde détecte réellement les formulations interdites (il n\'est pas vide)', () => {
  for (const bad of ['Vous avez de l\'acné', 'Vous souffrez de rougeurs', 'Il faut traiter la peau', 'Cette maladie', 'Une pathologie', 'Pour éclaircir la peau', 'Peau blanchie : blanchir', 'Une prescription'])
    assert.ok(FORBIDDEN.some(([re]) => re.test(bad)), bad);
  for (const ok of ['Votre analyse indique…', 'Ce n\'est pas un diagnostic médical', 'Cet indicateur est actuellement plus faible', 'uniformité du teint', 'Un traitement cosmétique'])
    assert.ok(!FORBIDDEN.some(([re]) => re.test(ok)), ok);
});

test('CP2 textes statiques du moteur (copy.fr.js, catalogue d\'actifs, produits, objectifs) : aucune formulation interdite', () => {
  check(collect(copy), 'copy.fr.js');
  check(collect(adata.ACTIVES.map(a => [a.label, a.summary, a.description, a.cautions, a.introduction])), 'actifs');
  check(collect(pdata.PRODUCTS.map(p => [p.name, p.brand, p.ingredients.map(i => i.label)])), 'produits');
  check(collect(adata.CONFLICT_RULES.map(r => r.text)), 'règles');
  check(collect(idata.GOALS.map(g => copy.GOAL_LABELS[g.id])), 'objectifs');
});

test('CP3 textes dynamiques : chaque phrase produite par le moteur (400 jeux) est prudente et cosmétique', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const c = randomCase(seed), r = run(c.ui, c.o, c.profile);
    check(collect([r.priorities.items.map(i => i.reason), r.priorities.eyeInfo, r.explanations.map(e => e.text), r.routinePlan.summary, r.routinePlan.notes,
      Object.values(r.routinePlan.slots).flat().map(s => [s.label, s.reason, s.introduction]), r.productMatches.map(m => m.because)]), 'seed ' + seed);
  }
});

test('CP4 formulations attendues : « Votre analyse… », « Cet indicateur est actuellement plus faible », « Une routine orientée vers »', () => {
  assert.match(copy.priorityReason({ band: 'mid', objectiveMatch: false }), /^Cet indicateur est actuellement plus faible/);
  assert.match(copy.priorityReason({ band: 'low', objectiveMatch: false }), /actuellement nettement plus faible/);
  assert.match(copy.priorityReason({ band: 'mid', objectiveMatch: true }), /Il correspond à votre objectif\.$/);
  assert.match(copy.eyeInfo(['Cernes']), /^Votre analyse montre/);
  assert.match(copy.summary(['Pores', 'Hydratation'], 'action'), /^Une routine orientée vers : pores et hydratation\.$/);
  assert.match(copy.MAINTENANCE.title, /^Aucune priorité forte ne ressort de cette analyse\./);
  assert.match(copy.MAINTENANCE.text, /routine d'entretien/);
});

test('CP5 le vocabulaire reste « taches / uniformité du teint / éclat » : le catalogue ne promet ni éclaircissement ni guérison', () => {
  const all = collect([copy, adata.ACTIVES, pdata.PRODUCTS.map(p => p.name)]).join(' ').toLowerCase();
  for (const bad of ['éclaircir', 'éclaircissant', 'blanchir', 'blanchissant', 'dépigmentant', 'guérir']) assert.ok(!all.includes(bad), bad);
  assert.ok(all.includes('uniformi'));
});
