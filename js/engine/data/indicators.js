/* Données éditoriales : les 15 indicateurs (clés de skin-model.js), leurs domaines, et les objectifs proposés à l'utilisateur.
   Aucune logique ici. Les domaines ne servent qu'à regrouper et expliquer : ils n'ont pas de score propre.
   Le RÔLE décisionnel (actionnable, descriptif, conditionné par un objectif, informatif) n'est PAS défini ici : il l'est une seule fois, dans
   data/decision.js (ROLES), pour qu'aucun second fichier ne puisse le contredire.
   confidence : confiance éditoriale dans le levier cosmétique de l'indicateur (high, medium, low). Jugement éditorial, pas une mesure. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.indicatorsData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOMAINS = ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'eye_contour'];

  /* Les indicateurs du contour des yeux sont informatifs seulement : aucun actif automatique, aucune priorité d'action.
     La direction exacte de oiliness, texture et radiance n'est pas documentée par Perfect Corp : ne pas en déduire d'affirmation
     (huile en excès, rugosité, teint terne…) ni d'actif exfoliant à partir d'un de ces indicateurs seul. */
  /* Ordre = ordre fixe de départage (identique à METRICS de skin-model.js). */
  const INDICATORS = {
    acne:              { domain: 'blemishes',       confidence: 'medium' },
    pores:             { domain: 'oil_pores',       confidence: 'medium' },
    oiliness:          { domain: 'oil_pores',       confidence: 'medium' },
    texture:           { domain: 'texture',         confidence: 'medium' },
    hydration:         { domain: 'hydration',       confidence: 'high' },
    redness:           { domain: 'redness_comfort', confidence: 'medium' },
    pigmentation:      { domain: 'tone',            confidence: 'medium' },
    wrinkles:          { domain: 'aging',           confidence: 'medium' },
    firmness:          { domain: 'aging',           confidence: 'medium' },
    radiance:          { domain: 'tone',            confidence: 'medium' },
    eyeBag:            { domain: 'eye_contour',     confidence: 'low' },
    tearTrough:        { domain: 'eye_contour',     confidence: 'low' },
    darkCircle:        { domain: 'eye_contour',     confidence: 'low' },
    droopyUpperEyelid: { domain: 'eye_contour',     confidence: 'low' },
    droopyLowerEyelid: { domain: 'eye_contour',     confidence: 'low' }
  };

  /* Objectifs proposés (facultatifs). `domain` : domaine favorisé dans sa propre bande ; null = aucun domaine (entretien global). */
  const GOALS = [
    { id: 'hydration', domain: 'hydration' },
    { id: 'oil_pores', domain: 'oil_pores' },
    { id: 'blemishes', domain: 'blemishes' },
    { id: 'tone', domain: 'tone' },
    { id: 'redness_comfort', domain: 'redness_comfort' },
    { id: 'texture', domain: 'texture' },
    { id: 'aging', domain: 'aging' },
    { id: 'maintenance', domain: null }
  ];
  const MAX_GOALS = 3;

  return { DOMAINS, INDICATORS, GOALS, MAX_GOALS };
});
