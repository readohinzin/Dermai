/* Catalogue éditorial des actifs cosmétiques. Aucune logique ici (voir ../actives.js).

   status : « validated » = retenu pour l'usage automatique du moteur ; « à_valider » = présent pour mémoire, JAMAIS sélectionné.
   Le statut « validated » est une décision de projet (étape 5B) fondée sur la connaissance cosmétique générale. Aucune référence
   externe n'est citée : `source` le dit explicitement. Une relecture par un cosmétologue est requise avant un lancement public.

   kind : « treatment » = soin ciblé (étape propre de la routine) ; « support » = ingrédient recherché dans l'hydratant.
   role : rôle fonctionnel. Un seul actif par rôle dans un plan (évite les doublons).
   irritation : low | moderate | high. Sert au mode confort et à l'ordre d'introduction, jamais à un score.
   groups : « evening_strong » = au plus un actif de ce groupe par soir (exfoliants et rétinoïdes).
   Textes en français, prudents : cosmétique seulement, ni diagnostic ni promesse. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.activesData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SRC = 'Connaissance cosmétique générale. Aucune référence externe citée : relecture éditoriale requise avant lancement public.';
  const MARKS = 'Si votre peau garde facilement des marques après une irritation, introduisez-le encore plus doucement.';
  const PREGNANCY = 'En cas de grossesse, demandez conseil à un professionnel de santé avant utilisation.';

  const ACTIVES = [
    {
      id: 'niacinamide', label: 'Niacinamide', kind: 'treatment', role: 'sebum_barrier', irritation: 'low', groups: [],
      targets: ['oiliness', 'pores', 'texture', 'redness', 'acne', 'pigmentation', 'radiance'],
      objectives: ['oil_pores', 'texture', 'redness_comfort', 'blemishes', 'tone'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Équilibre et affine', description: 'Aide à équilibrer l\'aspect du sébum, à affiner le grain de peau et à soutenir la barrière cutanée.',
      cautions: ['Un dosage élevé peut gêner certaines peaux sensibles.'], conflicts: [], pairsWith: ['hyaluronic', 'azelaic'],
      when: 'both', defaultSlot: 'morning',
      introduction: { frequency: 'Une fois par jour', note: 'Commencez un jour sur deux si votre peau est sensible.' }
    },
    {
      id: 'salicylic', label: 'Acide salicylique', kind: 'treatment', role: 'exfoliation', irritation: 'moderate', groups: ['evening_strong'],
      targets: ['acne', 'pores', 'oiliness', 'texture'], objectives: ['blemishes', 'oil_pores', 'texture'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Purifie les pores', description: 'Exfoliant qui aide à désobstruer les pores et à limiter l\'aspect brillant.',
      cautions: ['Peut dessécher : hydratez ensuite.', PREGNANCY, MARKS], conflicts: ['retinoid', 'aha_pha', 'azelaic'], pairsWith: ['niacinamide', 'hyaluronic'],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Deux soirs par semaine', note: 'Augmentez progressivement si votre peau le tolère.' }
    },
    {
      id: 'azelaic', label: 'Acide azélaïque', kind: 'treatment', role: 'blemish_tone', irritation: 'moderate', groups: ['evening_strong'],
      targets: ['acne', 'pigmentation', 'redness'], objectives: ['blemishes', 'tone', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Uniformise le teint', description: 'Aide à atténuer l\'aspect des marques et des imperfections, et à uniformiser le teint.',
      cautions: ['De légers picotements sont possibles au début.', PREGNANCY, MARKS], conflicts: ['salicylic', 'aha_pha', 'retinoid'], pairsWith: ['niacinamide', 'hyaluronic'],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir sur deux au début', note: 'Passez à chaque soir si votre peau le tolère.' }
    },
    {
      id: 'vitamin_c', label: 'Vitamine C', kind: 'treatment', role: 'antioxidant_tone', irritation: 'moderate', groups: [],
      targets: ['pigmentation', 'radiance', 'wrinkles', 'firmness'], objectives: ['tone', 'aging'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Éclat et uniformité', description: 'Aide à rendre le teint plus lumineux et plus uniforme, et accompagne la protection de la peau.',
      cautions: ['Peut piquer sur peau sensible.', 'Conservez le produit à l\'abri de la lumière et de la chaleur.', MARKS], conflicts: [], pairsWith: ['niacinamide', 'hyaluronic'],
      when: 'morning', defaultSlot: 'morning',
      introduction: { frequency: 'Un matin sur deux au début', note: 'Appliquez avant la protection solaire.' }
    },
    {
      id: 'retinoid', label: 'Rétinoïdes cosmétiques', kind: 'treatment', role: 'renewal', irritation: 'high', groups: ['evening_strong'],
      targets: ['wrinkles', 'firmness', 'texture', 'pores', 'pigmentation'], objectives: ['aging', 'texture', 'oil_pores', 'tone'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Renouvelle la texture', description: 'Aident à lisser le grain de peau et à estomper l\'aspect des signes visibles du vieillissement.',
      cautions: ['Protection solaire indispensable le lendemain.', PREGNANCY, 'Peuvent irriter : commencez très doucement.', MARKS], conflicts: ['salicylic', 'aha_pha', 'azelaic'], pairsWith: ['hyaluronic', 'niacinamide'],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir par semaine au début', note: 'Passez à deux soirs par semaine après quelques semaines si tout va bien.' }
    },
    {
      id: 'aha_pha', label: 'Exfoliants doux AHA ou PHA', kind: 'treatment', role: 'exfoliation', irritation: 'moderate', groups: ['evening_strong'],
      targets: ['texture', 'radiance', 'pigmentation'], objectives: ['texture', 'tone'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Affine le grain de peau', description: 'Exfoliants qui aident à lisser le grain de peau et à raviver l\'éclat.',
      cautions: ['Protection solaire indispensable.', 'Peuvent irriter : espacez en cas de tiraillement.', PREGNANCY, MARKS], conflicts: ['retinoid', 'salicylic', 'azelaic'], pairsWith: ['hyaluronic'],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir par semaine au début', note: 'Augmentez très progressivement.' }
    },
    {
      id: 'hyaluronic', label: 'Acide hyaluronique', kind: 'support', role: 'humectant', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'high', status: 'validated', source: SRC,
      summary: 'Hydrate en surface', description: 'Capte l\'eau à la surface de la peau pour la rendre plus souple et plus confortable.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: 'Chaque jour', note: 'Sur peau légèrement humide.' }
    },
    {
      id: 'glycerin', label: 'Glycérine', kind: 'support', role: 'humectant', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'high', status: 'validated', source: SRC,
      summary: 'Hydratation de base', description: 'Ingrédient hydratant courant qui aide la peau à garder son confort.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'ceramides', label: 'Céramides', kind: 'support', role: 'barrier', irritation: 'low', groups: [],
      targets: ['hydration', 'redness'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Soutient la barrière cutanée', description: 'Aident à soutenir la barrière de la peau et à limiter la sensation d\'inconfort.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'panthenol', label: 'Panthénol', kind: 'support', role: 'soothing_barrier', irritation: 'low', groups: [],
      targets: ['hydration', 'redness'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Confort de la peau', description: 'Ingrédient apaisant qui aide la peau à rester confortable.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'squalane', label: 'Squalane', kind: 'support', role: 'emollient', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration'],
      confidence: 'medium', status: 'validated', source: SRC,
      summary: 'Adoucit', description: 'Ingrédient qui adoucit la peau et limite l\'évaporation de l\'eau.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },

    /* À valider : présents pour mémoire, JAMAIS sélectionnés automatiquement. */
    { id: 'peptides', label: 'Peptides', kind: 'treatment', role: 'peptide', irritation: 'low', groups: [], targets: ['firmness', 'wrinkles'], objectives: ['aging'],
      confidence: 'low', status: 'à_valider', source: SRC, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } },
    { id: 'zinc', label: 'Zinc', kind: 'treatment', role: 'sebum_zinc', irritation: 'low', groups: [], targets: ['oiliness', 'pores'], objectives: ['oil_pores'],
      confidence: 'low', status: 'à_valider', source: SRC, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: '', note: '' } },
    { id: 'centella', label: 'Centella asiatica', kind: 'support', role: 'soothing_plant', irritation: 'low', groups: [], targets: ['redness'], objectives: ['redness_comfort'],
      confidence: 'low', status: 'à_valider', source: SRC, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } },
    { id: 'caffeine', label: 'Caféine', kind: 'treatment', role: 'eye_caffeine', irritation: 'low', groups: [], targets: ['darkCircle', 'eyeBag'], objectives: ['eye_contour'],
      confidence: 'low', status: 'à_valider', source: SRC, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: '', note: '' } },
    { id: 'tranexamic', label: 'Acide tranexamique', kind: 'treatment', role: 'tone_tranexamic', irritation: 'low', groups: [], targets: ['pigmentation'], objectives: ['tone'],
      confidence: 'low', status: 'à_valider', source: SRC, summary: 'À valider', description: 'À valider avant implémentation (statut réglementaire à vérifier).', cautions: [], conflicts: [], pairsWith: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } }
  ];

  /* Préférence éditoriale (ordre) des actifs par indicateur. Pas un coefficient : une liste ordonnée, relue par l'éditorial. */
  const PREFERENCE = {
    acne: ['salicylic', 'azelaic', 'niacinamide'],
    pigmentation: ['vitamin_c', 'niacinamide', 'azelaic', 'aha_pha', 'retinoid'],
    pores: ['niacinamide', 'salicylic', 'retinoid'],
    oiliness: ['niacinamide', 'salicylic'],
    texture: ['niacinamide', 'aha_pha', 'retinoid', 'salicylic'],
    redness: ['niacinamide', 'azelaic', 'ceramides', 'panthenol'],
    radiance: ['vitamin_c', 'aha_pha', 'niacinamide'],
    hydration: ['hyaluronic', 'glycerin', 'ceramides', 'panthenol', 'squalane'],
    wrinkles: ['retinoid', 'vitamin_c'],
    firmness: ['retinoid', 'vitamin_c']
  };

  /* Règles de conflit. Seules les règles « validated » sont appliquées par le moteur. */
  const CONFLICT_RULES = [
    { id: 'strong_evening', status: 'validated', group: 'evening_strong', max: 1, text: 'Un seul exfoliant ou rétinoïde par soir.' },
    { id: 'owned_exfoliant', status: 'validated', text: 'Pas d\'exfoliant ou de rétinoïde ajouté si l\'utilisateur en utilise déjà un.' },
    { id: 'vitamin_c_retinoid', status: 'à_valider', pair: ['vitamin_c', 'retinoid'], text: 'Vitamine C et rétinoïde au même moment (association débattue).' }
  ];

  /* Exclus du périmètre cosmétique : jamais recommandés, jamais présents dans le catalogue de produits. */
  const EXCLUDED = ['hydroquinone', 'corticoids', 'mercury', 'benzoyl_peroxide', 'adapalene', 'tretinoin'];

  /* Plafonds de routine par niveau déclaré. Paramètres de conception PROVISOIRES (à_valider), pas des données cosmétiques. */
  const LIMITS = {
    none: { treatments: 1, perSlot: 1 },
    simple: { treatments: 2, perSlot: 1 },
    full: { treatments: 3, perSlot: 2 }
  };
  const DEFAULT_LEVEL = 'simple';

  return { ACTIVES, PREFERENCE, CONFLICT_RULES, EXCLUDED, LIMITS, DEFAULT_LEVEL };
});
