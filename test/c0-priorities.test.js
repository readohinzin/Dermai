'use strict';
/* C0-PRIORITIES (étape 27, moteur d'accompagnement) : empreinte des SEULES décisions de priorités, sur les mêmes 2000 profils que C0.
   Valeur calculée AVANT toute modification du moteur (commit 6d106a8). Elle doit rester identique après l'ajout de l'accompagnement :
   l'accompagnement est une deuxième passe, il ne change ni les repères, ni l'ordre, ni le plafond des priorités LOW/MID.
   Aucun appel réseau, aucune analyse Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { M, Engine, norm, randomCase } = require('./helpers/engine.js');
const C = require('../js/engine/data/catalog.js');

/* Sortie de décision des priorités : interprétation (valeurs de décision), mode, priorités retenues, information du contour des yeux. */
const prioDecision = r => JSON.stringify([r.interpretation.basis, r.interpretation.indicators.map(i => [i.id, i.score, i.value, i.band, i.role]), r.interpretation.context,
  r.priorities.mode, r.priorities.items.map(i => [i.indicator, i.band, i.rank, i.objectiveMatch]), r.priorities.informational.map(i => i.indicator)]);

function profiles() {
  const out = [];
  for (let s = 1; s <= 1500; s++) { const c = randomCase(s * 37 + 5); out.push([norm(c.ui, c.o), c.profile]); }
  const rng = seed => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  for (let s = 1; s <= 500; s++) {
    const r = rng(9000 + s), ui = {}, raw = {};
    for (const k of M.METRIC_KEYS) { raw[k] = 5 + r() * 95; ui[k] = Math.min(99, Math.round(raw[k] + 10)); }
    out.push([norm(ui, { rawMap: raw, skin: ['Normal', 'Oily', 'Dry', 'Combination', 'Oily & Redness'][s % 5] }),
      { goals: [[], ['tone'], ['aging'], ['hydration', 'texture']][s % 4], level: ['none', 'simple', 'full'][s % 3] }]);
  }
  return out;
}

test('C0-PRIORITIES empreinte des priorités LOW/MID (2000 profils, dont 500 avec raw) : identique au moteur d\'avant l\'accompagnement', () => {
  const out = profiles().map(([n, p]) => prioDecision(Engine.run(n, p, { catalog: C.PRODUCTS })));
  assert.equal(crypto.createHash('sha256').update(out.join('\n')).digest('hex'), 'ecc20521967a83e665530f6ef7a007ae5f09f2cf13dcde172b349bdac688beb8');
});
