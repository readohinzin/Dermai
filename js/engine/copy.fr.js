/* Tous les textes français générés par le moteur. Ton cosmétique et prudent : « Votre analyse indique… », « Cet indicateur est
   actuellement plus faible… », « Une routine orientée vers… ». Jamais de diagnostic, de maladie, de prescription ni de promesse.
   Un test de garde (engine-copy.test.js) interdit les formulations médicales ou trompeuses dans ce fichier et dans le catalogue. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.copy = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOMAIN_LABELS = {
    hydration: 'Hydratation', oil_pores: 'Niveau d\'huile et pores', blemishes: 'Imperfections', tone: 'Teint et taches',
    redness_comfort: 'Rougeurs et confort', texture: 'Texture', aging: 'Rides et fermeté', eye_contour: 'Contour des yeux'
  };
  const GOAL_LABELS = Object.assign({}, DOMAIN_LABELS, { maintenance: 'Entretien global' });
  const NO_GOAL = 'Aucun objectif particulier';
  const GOAL_LIMIT = 'Vous pouvez choisir jusqu\'à 3 objectifs.';
  const SLOT_LABELS = { morning: 'Matin', evening: 'Soir' };
  const STEP_LABELS = { cleanse: 'Nettoyage doux', treatment: 'Soin ciblé', moisturize: 'Hydratation', spf: 'Protection solaire' };

  const joinList = list => (list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1]);
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

  /* ---- priorités ---- */
  function priorityReason({ band, objectiveMatch }) {
    const base = band === 'low'
      ? 'Cet indicateur est actuellement nettement plus faible : il peut être soutenu en priorité.'
      : 'Cet indicateur est actuellement plus faible : il mérite davantage d\'attention.';
    return objectiveMatch ? base + ' Il correspond à votre objectif.' : base;
  }
  const MAINTENANCE = {
    title: 'Votre analyse ne fait pas ressortir de priorité forte.',
    text: 'Nous privilégions une routine d\'entretien : nettoyer doucement, hydrater et protéger du soleil.'
  };
  const eyeInfo = labels => 'Votre analyse montre un indicateur plus faible au niveau du contour des yeux (' + joinList(labels.map(lower)) +
    '). C\'est une information : aucun actif n\'est proposé automatiquement pour cet indicateur.';

  const INFO_LABEL = 'À titre d\'information';
  const INFO_TEXT = 'Cet indicateur est donné à titre d\'information. Il n\'appelle pas de recommandation automatique.';
  const INDICATOR_NOTES = {
    acne: 'Imperfections visibles', pigmentation: 'Taches et uniformité du teint', pores: 'Visibilité des pores', oiliness: 'Niveau d\'huile de la peau',
    hydration: 'Hydratation apparente', redness: 'Rougeurs visibles', texture: 'Texture globale', wrinkles: 'Rides et ridules', firmness: 'Fermeté apparente',
    radiance: 'Éclat visible', eyeBag: 'Poches sous les yeux', tearTrough: 'Creux sous les yeux', darkCircle: 'Cernes',
    droopyUpperEyelid: 'Paupière supérieure', droopyLowerEyelid: 'Paupière inférieure'
  };
  const EYE_NOTE = 'Cet indicateur est donné à titre d\'information : aucun actif n\'est proposé automatiquement.';

  /* ---- actifs ---- */
  /* `editorial` : libellés d'indicateurs pour lesquels le choix de l'actif est une règle DERMAI prudente, sans source directe retenue.
     Ils sont signalés comme « option courante » : jamais présentés comme une relation établie, ni attribués au fournisseur d'analyse. */
  const activeReason = (labels, fallbackSoft, editorial) => 'Choisi pour : ' +
    joinList(labels.map(l => lower(l) + ((editorial || []).includes(l) ? ' (option cosmétique courante)' : ''))) + '.' +
    (fallbackSoft ? ' Introduisez-le très doucement : votre analyse suggère de privilégier le confort.' : '');
  const supportReason = labels => labels.length
    ? 'Ingrédient recherché dans votre hydratant, pour : ' + joinList(labels.map(lower)) + '.'
    : 'Ingrédient recherché dans votre hydratant, pour le confort de la peau.';
  const DEFERRED = {
    conflict: 'Mis de côté : un seul exfoliant ou rétinoïde par soir.',
    duplicate: 'Mis de côté : un actif au rôle équivalent est déjà dans votre plan.',
    comfort: 'Mis de côté pour l\'instant : votre analyse suggère de privilégier le confort avant les actifs plus exigeants.',
    gentle: 'Mis de côté pour l\'instant : la routine privilégie une approche plus douce.',
    minimal: 'Mis de côté pour l\'instant : cette routine reste volontairement minimale.',
    cap: 'Mis de côté : votre plan reste volontairement court.',
    owned: 'Mis de côté : vous utilisez déjà un exfoliant.',
    slot: 'Mis de côté : le créneau est déjà chargé.',
    excluded: 'Mis de côté : vous avez choisi de ne pas utiliser cet actif.',
    covered: 'Mis de côté : un autre actif retenu couvre déjà ce repère.',
    gentler: 'Mis de côté : une option plus douce est retenue pour votre profil.'
  };

  /* ---- routine ---- */
  const TEXTURE = {
    oily: 'texture légère, non comédogène', dry: 'texture plus riche', combination: 'texture légère à moyenne',
    normal: 'texture standard', unknown: 'texture adaptée à votre peau'
  };
  const stepReason = {
    cleanse: 'Un nettoyage doux prépare la peau sans l\'agresser.',
    spf: 'La protection solaire accompagne tous les soins du plan.',
    moisturize: (texture, labels) => 'Hydratation en ' + texture + (labels.length ? ', avec : ' + joinList(labels.map(lower)) : '') + '.',
    owned: 'Vous utilisez déjà cette catégorie : gardez-la si elle vous convient.'
  };
  const NOTES = {
    oneAtATime: 'Introduisez un nouvel actif à la fois, à quelques jours d\'intervalle.',
    oneStrong: 'Un seul exfoliant ou rétinoïde par soir.',
    comfort: 'Votre analyse suggère de privilégier le confort : actifs doux d\'abord, hydratation et protection solaire.',
    dry: 'Votre type de peau suggère d\'espacer davantage les actifs plus exigeants.',
    marks: 'Une peau qui marque facilement peut bénéficier d\'une introduction progressive des actifs plus demandants.',
    demoProducts: 'Les produits cités sont des exemples de démonstration.',
    level: { none: 'Routine volontairement minimale pour démarrer.', simple: 'Routine courte.', full: 'Routine plus structurée.' }
  };
  const SLOW = 'Allez plus lentement que d\'habitude.';
  const summary = (labels, mode) => mode === 'maintenance'
    ? 'Votre routine est une routine d\'entretien.'
    : 'Une routine orientée vers : ' + joinList(labels.map(lower)) + '.';
  const productBecause = labels => 'Contient : ' + joinList(labels.map(lower)) + '.';
  /* Pourquoi CE produit : le rôle qu'il joue dans une étape déjà définie par la routine, jamais une promesse ni un langage médical. */
  const PRODUCT_CATEGORY_LABELS = { cleanser: 'Nettoyant', serum: 'Soin ciblé', moisturizer: 'Hydratant', spf: 'Protection solaire' };
  const productWhy = (kind, labels) => {
    const l = joinList((labels || []).map(lower));
    if (kind === 'treatment') return 'Actif retenu dans votre routine pour cette étape : ' + l + '. Ce soin le contient.';
    if (kind === 'moisturize') return 'Hydratant pour l\'étape d\'hydratation de votre routine.' + (l ? ' Il contient des actifs de soutien retenus : ' + l + '.' : '');
    if (kind === 'cleanse') return 'Nettoyant doux pour l\'étape de nettoyage de votre routine.';
    return 'Protection solaire pour l\'étape du matin de votre routine.';
  };
  /* Raisons réelles d'un produit non retenu (chacune correspond à une règle du moteur, jamais inventée). */
  const PRODUCT_REASONS = {
    excluded: 'Écarté : il contient un actif que vous avez choisi d\'exclure.',
    comfort: 'Écarté : votre approche douce privilégie des formules plus simples.',
    composition: 'Écarté : sa composition contient un actif que votre routine ne prévoit pas.',
    active_not_selected: 'Son actif n\'est pas retenu dans votre routine actuelle.',
    other_product_chosen: 'Un autre produit répond déjà à cette étape de votre routine.',
    owned: 'Vous avez indiqué utiliser déjà un produit pour cette étape.',
    no_step: 'Cette étape n\'existe pas dans votre routine actuelle.'
  };
  /* Offres par pays : libellés neutres, jamais un pays par défaut. */
  const OFFER_AVAILABILITY_LABELS = { in_stock: 'En stock', out_of_stock: 'Rupture de stock', coming_soon: 'Bientôt disponible', unknown: 'Disponibilité à vérifier' };
  const OFFER_TYPE_LABELS = { brand_site: 'Site de la marque', retailer: 'Revendeur en ligne', pharmacy: 'Pharmacie en ligne', marketplace: 'Place de marché', importer: 'Importateur ou distributeur' };
  const OFFER_TEXTS = {
    neutral: 'Options d\'achat en ligne. La disponibilité et la livraison dépendent de votre pays.',
    international: 'Disponible en ligne : livraison selon votre pays (frais et douane possibles).',
    marketplace: 'Annonce d\'une place de marché : le vendeur est un tiers, DERMAI ne garantit pas l\'authenticité du produit.',
    none: 'Aucune offre vérifiée pour le moment.',
    priceToCheck: 'Prix à vérifier'
  };
  const AVAILABILITY_LABELS = { available: 'Disponible', unavailable: 'Indisponible', coming_soon: 'Bientôt disponible', unknown: 'Données à venir' };

  /* ---- personnalisation : explications structurées (pourquoi, pourquoi maintenant, pourquoi pas autre chose) ---- */
  const LEVEL_LABELS = { none: 'Aucune routine', simple: 'Routine simple', full: 'Routine complète' };
  /* Libellés courts pour le profil (« Mon niveau de routine »). */
  const LEVEL_SHORT = { none: 'Minimal', simple: 'Simple', full: 'Complète' };
  const PERSONAL = {
    measured: labels => 'Votre analyse indique des repères plus faibles sur : ' + joinList(labels.map(lower)) + '.',
    measuredNone: 'Votre analyse ne fait pas ressortir de priorité forte. Nous privilégions une routine d\'entretien.',
    goals: labels => 'Vous avez indiqué comme objectif : ' + joinList(labels.map(lower)) + '. Un objectif sert à départager des options, il ne crée pas de priorité.',
    skin: label => 'Votre analyse indique le profil : ' + label + '. Il sert de contexte (texture de l\'hydratant, prudence), pas de constat médical.',
    comfortAnalysis: 'Votre analyse suggère de privilégier le confort : actifs doux, hydratation, barrière et protection solaire d\'abord.',
    comfortUser: 'Vous avez choisi une approche douce : actifs doux, hydratation, barrière et protection solaire d\'abord.',
    level: {
      none: 'Votre routine est encore minimale : nous gardons au plus un soin ciblé très doux.',
      simple: 'Votre routine est structurée mais courte : deux soins ciblés au plus, introduits un par un.',
      full: 'Votre routine est déjà structurée : trois soins ciblés au plus, sans multiplier les actifs.'
    },
    whyNow: {
      none: 'Votre routine est encore minimale : nous privilégions une introduction simple.',
      simple: 'Votre routine est courte : un nouvel actif à la fois, à quelques jours d\'intervalle.',
      full: 'Votre routine est déjà structurée : le plan reste limité, un nouvel actif à la fois.'
    },
    whyNowComfort: 'Le confort passe d\'abord : introduction progressive.',
    whyNowDry: 'Votre profil suggère d\'espacer davantage les actifs plus exigeants.',
    choice: {
      coverage: 'Il couvre plusieurs de vos repères à la fois : nous évitons de multiplier les actifs.',
      gentle_skin: 'À repères équivalents, nous avons retenu l\'option la plus douce pour votre profil.'
    },
    whyNot: {
      conflict: 'un seul exfoliant ou rétinoïde est prévu par soir',
      duplicate: 'un actif au rôle équivalent est déjà dans le plan',
      comfort: 'le confort passe d\'abord',
      gentle: 'la routine privilégie une approche plus douce',
      minimal: 'la routine reste minimale',
      cap: 'le plan reste volontairement court',
      owned: 'vous utilisez déjà un exfoliant',
      slot: 'le créneau est déjà chargé',
      excluded: 'vous avez choisi de ne pas l\'utiliser',
      covered: 'un autre actif retenu couvre déjà ce besoin, sans multiplier les actifs',
      gentler: 'une option plus douce est retenue pour votre profil'
    },
    goalStatus: {
      priority: 'Un repère lié à cet objectif est plus faible : il est pris en compte dans vos priorités.',
      beyond_cap: 'Un repère lié à cet objectif est plus faible, mais vos priorités sont limitées à trois : il reste pour une prochaine étape.',
      no_signal: 'Votre analyse ne fait pas ressortir de repère plus faible pour cet objectif : aucun actif n\'est ajouté à ce titre.',
      unavailable: 'Les données de votre analyse ne permettent pas de rattacher cet objectif à un repère.',
      maintenance: 'Une routine d\'entretien est privilégiée : aucun actif n\'est ajouté pour cet objectif.'
    },
    trend: { up: 'Amélioration', stable: 'Stable', down: 'Baisse' },
    approachNote: 'DERMAI privilégie ici une routine plus progressive.',
    notRetained: reason => 'Non retenu actuellement : ' + reason + '.',
    notValidated: 'Non retenu actuellement : cet actif n\'est pas validé pour la recommandation automatique de DERMAI.',
    result: labels => 'Nous avons donc privilégié : ' + joinList(labels.map(lower)) + '.',
    resultNone: 'Nous avons donc gardé une routine simple : nettoyage, hydratation et protection solaire.',
    evolution: {
      stable: 'Votre routine reste cohérente avec votre précédente analyse : aucun changement inutile.',
      changed: 'Votre routine évolue par rapport à la précédente analyse, d\'après vos résultats actuels.'
    }
  };

  return {
    LEVEL_LABELS, LEVEL_SHORT, PERSONAL,
    DOMAIN_LABELS, GOAL_LABELS, NO_GOAL, GOAL_LIMIT, SLOT_LABELS, STEP_LABELS, joinList, lower,
    priorityReason, MAINTENANCE, eyeInfo, EYE_NOTE, INFO_LABEL, INFO_TEXT, INDICATOR_NOTES, activeReason, supportReason, DEFERRED, TEXTURE, stepReason, NOTES, SLOW, summary, productBecause, productWhy, PRODUCT_REASONS, PRODUCT_CATEGORY_LABELS, AVAILABILITY_LABELS, OFFER_AVAILABILITY_LABELS, OFFER_TYPE_LABELS, OFFER_TEXTS
  };
});
