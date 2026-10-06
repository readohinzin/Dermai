'use strict';
/* Aides communes des tests du moteur : normalized synthétique, uniquement via le contrat de skin-model.js (sanitizeNormalized). */
const M = require('../../js/skin-model.js');
const Engine = require('../../js/engine/index.js');

/* ui : { clé DERMAI: uiScore }. Toute clé non citée vaut `fill` (80 = « Bien »). null/undefined = absent. */
function norm(ui = {}, o = {}) {
  const fill = o.fill === undefined ? 80 : o.fill;
  const n = {};
  for (const k of M.METRIC_KEYS) n[k] = { rawScore: o.raw === undefined ? null : o.raw, uiScore: Object.prototype.hasOwnProperty.call(ui, k) ? ui[k] : fill };
  n.globalScore = o.global === undefined ? 60 : o.global;
  n.skinType = { whole: o.skin === undefined ? 'Normal' : o.skin, tZone: null, uZone: null };
  n.skinAge = o.age === undefined ? 30 : o.age;
  return M.sanitizeNormalized({ schemaVersion: M.SCHEMA_VERSION, normalized: n });
}
const run = (ui, o = {}, profile = {}) => Engine.run(norm(ui, o), { goals: [], level: 'simple', cats: [], ...profile });
const ids = items => items.map(i => i.indicator);

/* Générateur déterministe pour les tests de propriétés. */
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const SKINS = ['Normal', 'Oily', 'Dry', 'Combination', 'Redness', 'Dry & Redness', 'Oily & Redness', 'Combination & Redness', null];
function randomCase(seed) {
  const r = rng(seed), ui = {};
  for (const k of M.METRIC_KEYS) ui[k] = r() < 0.12 ? null : Math.floor(r() * 101);
  return { ui, o: { global: r() < 0.2 ? null : Math.floor(r() * 101), skin: SKINS[Math.floor(r() * SKINS.length)], age: r() < 0.3 ? null : 20 + Math.floor(r() * 50) },
    profile: { goals: ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance'].filter(() => r() < 0.25),
      level: ['none', 'simple', 'full', 'zzz'][Math.floor(r() * 4)], cats: ['cleanser', 'serum', 'moisturizer', 'spf', 'exfoliant', 'mask'].filter(() => r() < 0.2) } };
}
module.exports = { M, Engine, norm, run, ids, randomCase };
