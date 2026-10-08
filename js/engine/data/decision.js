/* Configuration de DÉCISION du moteur DERMAI : sur quelle donnée DERMAI décide, avec quels repères, et quel rôle a chaque indicateur.
   Aucune logique ici. Tout ce qui suit est un choix DERMAI, PROVISOIRE : rien de cela n'est fourni ni validé par Perfect Corp.

   Ce que dit Perfect Corp (documentation Skin Analysis) :
     - raw_score : nombre de 1 à 100, plus haut = meilleur état cutané : c'est la mesure de l'analyse ;
     - ui_score  : entier de 1 à 100, ajusté pour être plus encourageant à l'écran (« psychological motivator ») ; la correspondance
                   raw → ui n'est pas documentée et n'est pas la même d'un indicateur à l'autre ;
     - aucune bande, aucun seuil, aucun « problème » n'est défini par le fournisseur.
   Donc : le score AFFICHÉ reste le ui_score ; les DÉCISIONS (comparer, classer, retenir un besoin) lisent le raw_score.

   Repères de décision sur raw_score (« repères DERMAI provisoires ») :
     - good : 50 et plus  → moitié haute de l'échelle documentée (1 à 100) : jamais un besoin ;
     - mid  : 25 à 49,99  → moitié basse : un besoin peut être retenu, seulement pour un indicateur actionnable avec une règle DERMAI ;
     - low  : moins de 25 → quart le plus bas : même règle, avec plus de prudence (mode confort pour les rougeurs).
   Ce ne sont PAS les seuils d'affichage 61 / 31 transposés : ceux-là portaient sur le ui_score et ne sont plus utilisés pour décider,
   sauf en compatibilité, pour une analyse ancienne qui n'a pas de raw_score (rien n'est alors inventé ni reconstruit).
   À revoir dès que DERMAI dispose de données de calibration réelles. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.decisionData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROVISIONAL = true;

  /* Base de décision préférée. « ui » n'est utilisé qu'en compatibilité, quand l'analyse n'a pas de raw_score exploitable. */
  const PREFERRED_BASIS = 'raw';

  /* Repères DERMAI provisoires sur raw_score (voir l'en-tête). Ordre décroissant de `min`. */
  const RAW_BANDS = [
    { key: 'good', label: 'Repère favorable', min: 50 },
    { key: 'mid', label: 'Repère moins élevé', min: 25 },
    { key: 'low', label: 'Repère nettement moins élevé', min: 0 }
  ];
  /* Compatibilité seulement (analyse sans raw_score) : les anciens repères d'affichage 61 / 31 sur le score affiché. */
  const LEGACY_UI_BANDS = [
    { key: 'good', label: 'Repère favorable', min: 61 },
    { key: 'mid', label: 'Repère moins élevé', min: 31 },
    { key: 'low', label: 'Repère nettement moins élevé', min: 0 }
  ];

  /* Écart en dessous duquel deux résultats sont considérés comme équivalents pour le classement (départage par l'ordre fixe). */
  const TIE_TOLERANCE = 2;

  /* Rôle de chaque indicateur dans la décision.
     actionable  : un besoin peut être retenu (repère mid ou low) quand une règle DERMAI et un actif validé existent ;
     goal_gated  : information seulement, SAUF si l'utilisateur a choisi l'objectif indiqué (`goal`) ET que le repère est mid ou low ;
     descriptive : décrit seulement, jamais d'actif automatique (direction ou levier cosmétique non établis) ;
     informative : contour des yeux, information seulement.
     Un repère « good » n'est jamais un besoin, quel que soit le rôle ou l'objectif. */
  const ROLES = {
    acne: { role: 'actionable' },
    pores: { role: 'actionable' },
    oiliness: { role: 'descriptive' },
    texture: { role: 'descriptive' },
    hydration: { role: 'actionable' },
    redness: { role: 'actionable' },
    pigmentation: { role: 'actionable' },
    wrinkles: { role: 'goal_gated', goal: 'aging' },
    firmness: { role: 'descriptive' },
    radiance: { role: 'goal_gated', goal: 'tone' },
    eyeBag: { role: 'informative' },
    tearTrough: { role: 'informative' },
    darkCircle: { role: 'informative' },
    droopyUpperEyelid: { role: 'informative' },
    droopyLowerEyelid: { role: 'informative' }
  };

  /* SOURCE UNIQUE du rôle décisionnel : ROLES ci-dessus. Les trois questions ci-dessous en dérivent, aucune autre table ne les redéfinit
     (indicators.js ne porte plus que le domaine et la confiance éditoriale).
     isInformative : contour des yeux, information seulement ;
     isComparable  : les indicateurs que la synthèse compare entre eux (tout sauf l'informatif) ;
     allowsAccompaniment : un accompagnement automatique est possible (rôle actionnable, ou conditionné par un objectif quand il est choisi). */
  const roleOf = id => (ROLES[id] || { role: 'descriptive' }).role;
  const isInformative = id => roleOf(id) === 'informative';
  const isComparable = id => !isInformative(id);
  const allowsAccompaniment = (id, goals) => {
    const r = ROLES[id] || {};
    return r.role === 'actionable' || (r.role === 'goal_gated' && Array.isArray(goals) && goals.includes(r.goal));
  };

  return { PROVISIONAL, PREFERRED_BASIS, RAW_BANDS, LEGACY_UI_BANDS, TIE_TOLERANCE, ROLES, roleOf, isInformative, isComparable, allowsAccompaniment };
});
