/* Catalogue éditorial des actifs cosmétiques. Aucune logique ici (voir ../actives.js).

   status : « validated » = retenu pour l'usage automatique du moteur ; « à_valider » = présent pour mémoire, JAMAIS sélectionné.
   Le statut « validated » est une décision de projet (règle éditoriale DERMAI). Les preuves réellement consultées sont décrites dans `evidence`
   (voir plus bas) ; quand aucune source n'a été retenue, c'est écrit « SOURCE À AJOUTER » : rien n'est inventé. Relecture par un cosmétologue requise avant un lancement public.

   consultable : actif « à_valider » dont la fiche reste lisible (consultation), sans jamais être proposé automatiquement.

   kind : « treatment » = soin ciblé (étape propre de la routine) ; « support » = ingrédient recherché dans l'hydratant.
   role : rôle fonctionnel. Un seul actif par rôle dans un plan (évite les doublons).
   irritation : low | moderate | high. Sert au mode confort et à l'ordre d'introduction, jamais à un score.
   groups : « evening_strong » = au plus un actif de ce groupe par soir. Réservé aux exfoliants (salicylique, AHA/PHA) et au rétinoïde ;
   l'acide azélaïque n'est ni l'un ni l'autre et n'en fait pas partie. Les anciens champs `conflicts` et `pairsWith` ont été retirés :
   ils n'étaient exécutés nulle part. Les seules contraintes appliquées sont `groups`, `role`, `irritation`, LIMITS et CONFLICT_RULES validées.
   Textes en français, prudents : cosmétique seulement, ni diagnostic ni promesse. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.activesData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- Preuves ----
     Trois niveaux à ne jamais confondre : (A) ce que Perfect Corp mesure, (B) ce que la littérature cosmétique permet de dire d'un actif,
     (C) la règle éditoriale DERMAI qui décide de le proposer. Une relation métrique → actif est TOUJOURS une règle DERMAI (C),
     jamais une recommandation de Perfect Corp. `evidence` décrit (B) :
       refs      : sources réellement consultées (audit 6B-2), avec ce qu'elles soutiennent. Aucune référence n'est inventée.
       direct    : cibles soutenues directement par une source consultée ;
       indirect  : cibles soutenues par une preuve indirecte (autre critère, autre dosage, produit voisin) ;
       editorial : cibles plausibles retenues comme règle DERMAI prudente, sans source directe consultée. Absence de preuve consultée
                   n'est PAS une preuve que la relation est fausse.
     sourceStatus : 'sourced' | 'partial' | 'to_add' (« SOURCE À AJOUTER »). */
  const REF = {
    niacinamide: { label: 'Practical Dermatology : niacinamide, ingrédient cosmeceutique (revue)', url: 'https://practicaldermatology.com/topics/esthetics-cosmeceuticals/niacinamide-a-multi-functional-cosmeceutical-ingredient/23720/', supports: 'sébum, taille des pores (niacinamide topique à 2 %), acné (gel à 4–5 %)', quality: 'revue de dermatologie' },
    salicylicStudy: { label: 'PubMed 1535287 : acide salicylique 0,5 % et 2 % dans l\'acné', url: 'https://pubmed.ncbi.nlm.nih.gov/1535287/', supports: 'acné, irritation locale légère', quality: 'revue d\'études cliniques' },
    salicylicSccs: { label: 'SCCS (avis résumé) : acide salicylique en cosmétique', url: 'https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/1060517/sag-cs-opinion-05-salicylic-acid-in-cosmetics.pdf', supports: 'sécurité : plafond 2 % en produit sans rinçage (hors lotion corps)', quality: 'avis réglementaire' },
    azelaicJdd: { label: 'J Drugs Dermatol : acide azélaïque, mise à jour fondée sur les preuves', url: 'https://jddonline.com/articles/dermatology/S1545961615P0964X', supports: 'acné, rosacée, marques post-inflammatoires', quality: 'revue' },
    azelaicJabfm: { label: 'JABFM : acide azélaïque', url: 'https://www.jabfm.org/content/29/2/254.full.txt', supports: 'usage et sécurité, dont la grossesse', quality: 'revue' },
    vitCJcad: { label: 'JCAD : vitamine C topique, mécanismes et applications', url: 'https://jcadonline.com/topical-vitamin-c-and-the-skin/', supports: 'pigmentation (tyrosinase), photovieillissement, instabilité, irritation', quality: 'revue' },
    vitCPmc: { label: 'PMC5605218 : vitamine C topique en dermatologie', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5605218/', supports: 'pigmentation, photoprotection (en association), limites de formulation', quality: 'revue' },
    ahaFda: { label: 'FDA : alpha-hydroxy acids (cosmétiques)', url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids', supports: 'sécurité : sensibilité au soleil, mention « Sunburn Alert »', quality: 'organisme réglementaire' },
    ahaReview: { label: 'LVHN scholarly works : AHA et photovieillissement', url: 'https://scholarlyworks.lvhn.org/medicine/6079', supports: 'texture, ridules, teint (AHA)', quality: 'publication scientifique (résumé consulté)' },
    phaReview: { label: 'MDPI Cosmetics 10(5):131 : PHA', url: 'https://www.mdpi.com/2079-9284/10/5/131', supports: 'PHA décrits comme mieux tolérés que les AHA', quality: 'publication scientifique (résumé consulté)' },
    retinoidPregnancy: { label: 'Prescrire : pas de rétinoïdes, même topiques, pendant la grossesse', url: 'https://english.prescrire.org/en/81/168/46046/0/PositionDetails.aspx', supports: 'sécurité uniquement (grossesse). Aucune source d\'efficacité cosmétique retenue.', quality: 'revue indépendante' },
    pihReview: { label: 'PubMed 35289059 : hyperpigmentation post-inflammatoire, peaux foncées', url: 'https://pubmed.ncbi.nlm.nih.gov/35289059/', supports: 'prudence face à l\'irritation (précaution « peau qui marque »)', quality: 'revue courte' }
  };
  const ev = (sourceStatus, refs, direct, indirect, editorial, note) => ({ sourceStatus, refs, direct, indirect, editorial, note: note || '' });
  const EV = {
    niacinamide: ev('partial', [REF.niacinamide], ['oiliness', 'pores', 'acne'], [], ['texture', 'redness', 'pigmentation'], 'Texture, rougeurs et taches : propriétés plausibles, règle DERMAI prudente sans source directe retenue.'),
    salicylic: ev('sourced', [REF.salicylicStudy, REF.salicylicSccs], ['acne'], ['pores'], [], 'Pores : effet comédolytique, preuve indirecte. Aucune cible oiliness ni texture.'),
    azelaic: ev('sourced', [REF.azelaicJdd, REF.azelaicJabfm], ['acne'], ['redness', 'pigmentation'], [], 'Preuves surtout aux dosages médicamenteux ; « rougeurs » mesurées par la caméra ne sont pas une rosacée.'),
    vitamin_c: ev('sourced', [REF.vitCJcad, REF.vitCPmc], ['pigmentation'], ['radiance', 'wrinkles'], ['firmness'], 'Éclat et rides : preuve indirecte (teint, photovieillissement). Fermeté : règle DERMAI prudente.'),
    retinoid: ev('to_add', [REF.retinoidPregnancy], [], [], ['wrinkles', 'firmness', 'texture'], 'À valider : aucune source d\'efficacité cosmétique retenue, donc jamais sélectionné automatiquement. La source présente ne couvre que la sécurité (grossesse).'),
    aha_pha: ev('partial', [REF.ahaFda, REF.ahaReview, REF.phaReview], [], ['texture', 'radiance', 'pigmentation'], [], 'Regroupe AHA et PHA : la preuve est plus abondante pour les AHA ; les PHA sont décrits comme mieux tolérés.'),
    hyaluronic: ev('to_add', [], [], [], ['hydration'], 'Humectant de base : règle DERMAI.'),
    glycerin: ev('to_add', [], [], [], ['hydration'], 'Humectant de base : règle DERMAI.'),
    ceramides: ev('to_add', [], [], [], ['hydration', 'redness'], 'Soutien de la barrière : règle DERMAI.'),
    panthenol: ev('to_add', [], [], [], ['hydration', 'redness'], 'Confort de la peau : règle DERMAI.'),
    squalane: ev('to_add', [], [], [], ['hydration'], 'Émollient : règle DERMAI.')
  };
  const NONE = ev('to_add', [], [], [], [], 'À valider avant usage : aucune source retenue.');
  const srcText = e => (e.sourceStatus === 'to_add' ? 'SOURCE À AJOUTER' : (e.sourceStatus === 'partial' ? 'Sources partielles : ' : 'Sources consultées : ') + e.refs.map(r => r.label).join(' ; ')) + (e.note ? ' | ' + e.note : '');

  const MARKS = 'Une peau qui marque facilement peut bénéficier d\'une introduction encore plus progressive.';
  const PREGNANCY = 'En cas de grossesse, demandez conseil à un professionnel de santé avant utilisation.';

  const ACTIVES = [
    {
      id: 'niacinamide', label: 'Niacinamide', kind: 'treatment', role: 'sebum_barrier', irritation: 'low', groups: [],
      targets: ['oiliness', 'pores', 'texture', 'redness', 'acne', 'pigmentation'],
      objectives: ['oil_pores', 'texture', 'redness_comfort', 'blemishes', 'tone'],
      confidence: 'medium', status: 'validated', source: srcText(EV.niacinamide), evidence: EV.niacinamide,
      summary: 'Polyvalent et doux', description: 'Ingrédient polyvalent qui aide à soutenir la barrière cutanée et l\'aspect général de la peau.',
      cautions: ['Un dosage élevé peut gêner certaines peaux sensibles.'],
      when: 'both', defaultSlot: 'morning',
      introduction: { frequency: 'Une fois par jour', note: 'Commencez un jour sur deux si votre peau est sensible.' }
    },
    {
      id: 'salicylic', label: 'Acide salicylique', kind: 'treatment', role: 'exfoliation', irritation: 'moderate', groups: ['evening_strong'],
      targets: ['acne', 'pores'], objectives: ['blemishes', 'oil_pores'],
      confidence: 'medium', status: 'validated', source: srcText(EV.salicylic), evidence: EV.salicylic,
      summary: 'Purifie les pores', description: 'Exfoliant qui aide à désobstruer les pores et à atténuer l\'aspect des imperfections.',
      cautions: ['Peut dessécher : hydratez ensuite.', PREGNANCY, MARKS],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Deux soirs par semaine', note: 'Augmentez progressivement si votre peau le tolère.' }
    },
    {
      id: 'azelaic', label: 'Acide azélaïque', kind: 'treatment', role: 'blemish_tone', irritation: 'moderate', groups: [],
      targets: ['acne', 'pigmentation', 'redness'], objectives: ['blemishes', 'tone', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: srcText(EV.azelaic), evidence: EV.azelaic,
      summary: 'Uniformise le teint', description: 'Aide à atténuer l\'aspect des marques et des imperfections, et à uniformiser le teint.',
      cautions: ['De légers picotements sont possibles au début.', PREGNANCY, MARKS],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir sur deux au début', note: 'Passez à chaque soir si votre peau le tolère.' }
    },
    {
      id: 'vitamin_c', label: 'Vitamine C', kind: 'treatment', role: 'antioxidant_tone', irritation: 'moderate', groups: [],
      targets: ['pigmentation', 'radiance', 'wrinkles', 'firmness'], objectives: ['tone', 'aging'],
      confidence: 'medium', status: 'validated', source: srcText(EV.vitamin_c), evidence: EV.vitamin_c,
      summary: 'Éclat et uniformité', description: 'Aide à rendre le teint plus lumineux et plus uniforme, et accompagne la protection de la peau.',
      cautions: ['Peut piquer sur peau sensible.', 'Conservez le produit à l\'abri de la lumière et de la chaleur.', MARKS],
      when: 'morning', defaultSlot: 'morning',
      introduction: { frequency: 'Un matin sur deux au début', note: 'Appliquez avant la protection solaire.' }
    },
    {
      id: 'retinoid', label: 'Rétinoïde cosmétique', kind: 'treatment', role: 'renewal', irritation: 'high', groups: ['evening_strong'], consultable: true,
      targets: ['wrinkles', 'firmness', 'texture'], objectives: ['aging', 'texture'],
      confidence: 'medium', status: 'à_valider', source: srcText(EV.retinoid), evidence: EV.retinoid,
      summary: 'Renouvelle la texture', description: 'Dérivés cosmétiques de la vitamine A (par exemple le rétinol), jamais un médicament. Aident à lisser le grain de peau et à estomper l\'aspect des signes visibles du vieillissement.',
      cautions: ['Par prudence, les rétinoïdes cosmétiques ne sont pas proposés automatiquement par DERMAI. En cas de grossesse ou de projet de grossesse, demandez conseil à un professionnel de santé avant d\'utiliser ce type d\'actif.', 'Protection solaire indispensable le lendemain.', 'Peuvent irriter : commencez très doucement.', MARKS],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir par semaine au début', note: 'Passez à deux soirs par semaine après quelques semaines si tout va bien.' }
    },
    {
      id: 'aha_pha', label: 'Exfoliants chimiques AHA ou PHA', kind: 'treatment', role: 'exfoliation', irritation: 'moderate', groups: ['evening_strong'],
      targets: ['texture', 'radiance', 'pigmentation'], objectives: ['texture', 'tone'],
      confidence: 'medium', status: 'validated', source: srcText(EV.aha_pha), evidence: EV.aha_pha,
      summary: 'Affine le grain de peau', description: 'Exfoliants qui aident à lisser le grain de peau et à raviver l\'éclat.',
      cautions: ['Protection solaire indispensable.', 'Peuvent irriter : espacez en cas de tiraillement.', PREGNANCY, MARKS],
      when: 'evening', defaultSlot: 'evening',
      introduction: { frequency: 'Un soir par semaine au début', note: 'Augmentez très progressivement.' }
    },
    {
      id: 'hyaluronic', label: 'Acide hyaluronique', kind: 'support', role: 'humectant', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'high', status: 'validated', source: srcText(EV.hyaluronic), evidence: EV.hyaluronic,
      summary: 'Hydrate en surface', description: 'Capte l\'eau à la surface de la peau pour la rendre plus souple et plus confortable.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: 'Chaque jour', note: 'Sur peau légèrement humide.' }
    },
    {
      id: 'glycerin', label: 'Glycérine', kind: 'support', role: 'humectant', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'high', status: 'validated', source: srcText(EV.glycerin), evidence: EV.glycerin,
      summary: 'Hydratation de base', description: 'Ingrédient hydratant courant qui aide la peau à garder son confort.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'ceramides', label: 'Céramides', kind: 'support', role: 'barrier', irritation: 'low', groups: [],
      targets: ['hydration', 'redness'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: srcText(EV.ceramides), evidence: EV.ceramides,
      summary: 'Soutient la barrière cutanée', description: 'Aident à soutenir la barrière de la peau et à limiter la sensation d\'inconfort.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'panthenol', label: 'Panthénol', kind: 'support', role: 'soothing_barrier', irritation: 'low', groups: [],
      targets: ['hydration', 'redness'], objectives: ['hydration', 'redness_comfort'],
      confidence: 'medium', status: 'validated', source: srcText(EV.panthenol), evidence: EV.panthenol,
      summary: 'Confort de la peau', description: 'Ingrédient apaisant qui aide la peau à rester confortable.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },
    {
      id: 'squalane', label: 'Squalane', kind: 'support', role: 'emollient', irritation: 'low', groups: [],
      targets: ['hydration'], objectives: ['hydration'],
      confidence: 'medium', status: 'validated', source: srcText(EV.squalane), evidence: EV.squalane,
      summary: 'Adoucit', description: 'Ingrédient qui adoucit la peau et limite l\'évaporation de l\'eau.',
      cautions: ['Aucune précaution particulière pour la plupart des peaux.'],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: 'Chaque jour', note: '' }
    },

    /* À valider : présents pour mémoire, JAMAIS sélectionnés automatiquement. */
    { id: 'peptides', label: 'Peptides', kind: 'treatment', role: 'peptide', irritation: 'low', groups: [], targets: ['firmness', 'wrinkles'], objectives: ['aging'],
      confidence: 'low', status: 'à_valider', source: srcText(NONE), evidence: NONE, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } },
    { id: 'zinc', label: 'Zinc', kind: 'treatment', role: 'sebum_zinc', irritation: 'low', groups: [], targets: ['oiliness', 'pores'], objectives: ['oil_pores'],
      confidence: 'low', status: 'à_valider', source: srcText(NONE), evidence: NONE, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: '', note: '' } },
    { id: 'centella', label: 'Centella asiatica', kind: 'support', role: 'soothing_plant', irritation: 'low', groups: [], targets: ['redness'], objectives: ['redness_comfort'],
      confidence: 'low', status: 'à_valider', source: srcText(NONE), evidence: NONE, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } },
    { id: 'caffeine', label: 'Caféine', kind: 'treatment', role: 'eye_caffeine', irritation: 'low', groups: [], targets: ['darkCircle', 'eyeBag'], objectives: ['eye_contour'],
      confidence: 'low', status: 'à_valider', source: srcText(NONE), evidence: NONE, summary: 'À valider', description: 'À valider avant implémentation.', cautions: [],
      when: 'both', defaultSlot: 'morning', introduction: { frequency: '', note: '' } },
    { id: 'tranexamic', label: 'Acide tranexamique', kind: 'treatment', role: 'tone_tranexamic', irritation: 'low', groups: [], targets: ['pigmentation'], objectives: ['tone'],
      confidence: 'low', status: 'à_valider', source: srcText(NONE), evidence: NONE, summary: 'À valider', description: 'À valider avant implémentation (statut réglementaire à vérifier).', cautions: [],
      when: 'both', defaultSlot: 'evening', introduction: { frequency: '', note: '' } }
  ];

  /* Préférence éditoriale (ordre) des actifs par indicateur. Pas un coefficient : une liste ordonnée, relue par l'éditorial. */
  const PREFERENCE = {
    acne: ['salicylic', 'azelaic', 'niacinamide'],
    pigmentation: ['vitamin_c', 'niacinamide', 'azelaic', 'aha_pha'],
    pores: ['niacinamide', 'salicylic'],
    /* La direction exacte de oiliness.ui_score n'est pas documentée par Perfect Corp : aucun actif exfoliant ne se déduit de cet indicateur seul. */
    oiliness: ['niacinamide'],
    texture: ['niacinamide', 'aha_pha', 'retinoid'],
    redness: ['niacinamide', 'azelaic', 'ceramides', 'panthenol'],
    radiance: ['vitamin_c', 'aha_pha'],
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

  /* Plafonds de routine par niveau déclaré : choix UX / éditorial DERMAI (garder une routine courte et tolérable), PAS une règle scientifique.
     Même nature : MAX_SUPPORTS (actives.js), « un seul actif par rôle » (anti-doublon, UX) et « un seul exfoliant ou rétinoïde par soir »
     (prudence éditoriale contre l'empilement irritant ; elle n'affirme aucune incompatibilité chimique). */
  const LIMITS = {
    none: { treatments: 1, perSlot: 1 },
    simple: { treatments: 2, perSlot: 1 },
    full: { treatments: 3, perSlot: 2 }
  };
  const DEFAULT_LEVEL = 'simple';

  return { ACTIVES, PREFERENCE, CONFLICT_RULES, EXCLUDED, LIMITS, DEFAULT_LEVEL };
});
