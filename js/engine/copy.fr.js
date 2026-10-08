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
  const STEP_LABELS = { cleanse: 'Nettoyage doux', treatment: 'Soin ciblé', accompaniment: 'Soin d\'accompagnement', moisturize: 'Hydratation', spf: 'Protection solaire' };

  const joinList = list => (list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1]);
  const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

  /* ---- priorités ---- */
  function priorityReason({ band, objectiveMatch }) {
    const base = band === 'low'
      ? 'D\'après les données de l\'analyse, ce résultat est nettement sous les repères DERMAI : DERMAI le retient comme priorité de soin.'
      : 'D\'après les données de l\'analyse, ce résultat est sous les repères DERMAI : DERMAI le retient comme axe à soutenir.';
    return objectiveMatch ? base + ' Il correspond à votre objectif.' : base;
  }
  const MAINTENANCE = {
    title: 'DERMAI ne retient aucun besoin particulier.',
    text: 'Votre routine reste une routine d\'entretien de base : nettoyage doux, hydratation et protection solaire.'
  };
  const eyeInfo = labels => 'Votre analyse montre un indicateur plus faible au niveau du contour des yeux (' + joinList(labels.map(lower)) +
    '). C\'est une information : aucun actif n\'est proposé automatiquement pour cet indicateur.';

  const INFO_LABEL = 'À titre d\'information';
  const EYE_GROUP_TITLE = 'Contour des yeux — à titre informatif';
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
    oily: 'texture adaptée à votre peau', dry: 'texture plus riche', combination: 'texture adaptée à votre peau',
    normal: 'texture standard', unknown: 'texture adaptée à votre peau'
  };
  const stepReason = {
    cleanse: 'Un nettoyage doux prépare la peau sans l\'agresser.',
    spf: 'La protection solaire accompagne tous les soins du plan.',
    moisturize: (texture, labels) => 'Une hydratation adaptée au confort de la peau' + (labels.length ? ', avec : ' + joinList(labels.map(lower)) : '') + '.',
    /* Peau à profil gras : pourquoi un hydratant figure quand même dans la routine. Information générale, aucune promesse. */
    moisturizeOily: 'L\'hydratation reste utile même lorsque la peau présente un profil gras.',
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
  /* Pourquoi un indicateur est accompagné sans être une priorité (accompaniment.js). Cosmétique, sans gravité ni promesse. */
  const accompanimentReason = origin => ({
    distinct: 'Cet indicateur n\'est pas une priorité dans cette analyse. Il ressort néanmoins suffisamment par rapport aux autres résultats pour justifier un accompagnement cosmétique léger.',
    objective: 'Cet axe correspond à votre objectif et peut être accompagné par un soin doux.',
    overflow: 'Cet indicateur est sous les repères DERMAI, mais la routine se limite à trois axes prioritaires : un soin doux peut l\'accompagner.'
  })[origin] || '';
  const accompanimentSummary = labels => 'Un soin doux d\'accompagnement s\'y ajoute pour : ' + joinList(labels.map(lower)) + '.';
  const accompanimentStep = (active, labels) => 'Soin d\'accompagnement léger : ' + lower(active) + ' peut accompagner ' + joinList(labels.map(lower)) + ', sans que ce soit une priorité de cette analyse.';
  const productBecause = labels => 'Contient : ' + joinList(labels.map(lower)) + '.';
  /* Pourquoi CE produit : le rôle qu'il joue dans une étape déjà définie par la routine, jamais une promesse ni un langage médical. */
  const PRODUCT_CATEGORY_LABELS = { cleanser: 'Nettoyant', serum: 'Soin ciblé', moisturizer: 'Hydratant', spf: 'Protection solaire' };
  const productWhy = (kind, labels) => 'Proposé par DERMAI. ' + productWhyBody(kind, labels);
  const productWhyBody = (kind, labels) => {
    const l = joinList((labels || []).map(lower));
    if (kind === 'treatment') return 'Choisi parce qu\'il contient l\'actif recherché pour cet axe : ' + l + '.';
    if (kind === 'accompaniment') return 'Choisi parce qu\'il contient l\'actif doux recherché pour l\'accompagnement : ' + l + '.';
    if (kind === 'moisturize') return l ? 'Choisi parce qu\'il contient les ingrédients recherchés pour l\'hydratation : ' + l + '.' : 'Hydratant pour l\'étape d\'hydratation de votre routine.';
    if (kind === 'cleanse') return 'Nettoyant doux pour l\'étape de nettoyage de votre routine.';
    return 'Protection solaire pour l\'étape du matin de votre routine.';
  };
  /* Rôle d'un produit recommandé : une phrase factuelle tirée de l'étape que le moteur lui a déjà attribuée (jamais une promesse, un score ou un classement). */
  const productRole = (kind, labels) => {
    const l = joinList((labels || []).map(lower));
    if (kind === 'treatment') return 'Produit proposé pour le soin ciblé de votre routine' + (l ? ' (actif : ' + l + ')' : '') + '.';
    if (kind === 'accompaniment') return 'Produit proposé pour le soin d\'accompagnement de votre routine' + (l ? ' (actif : ' + l + ')' : '') + '.';
    if (kind === 'moisturize') return 'Produit proposé pour accompagner l\'hydratation de votre routine.';
    if (kind === 'cleanse') return 'Produit proposé pour accompagner le nettoyage de votre routine.';
    return 'Produit proposé pour accompagner la protection solaire de votre routine.';
  };
  /* Raisons réelles d'un produit non retenu (chacune correspond à une règle du moteur, jamais inventée). */
  const PRODUCT_REASONS = {
    excluded: 'Écarté : il contient un actif que vous avez choisi d\'exclure.',
    comfort: 'Écarté : votre approche douce privilégie des formules plus simples.',
    composition: 'Écarté : sa composition contient un actif que votre routine ne prévoit pas.',
    active_not_selected: 'Son actif n\'est pas retenu dans votre routine actuelle.',
    other_product_chosen: 'Un autre produit répond déjà à cette étape de votre routine.',
    owned: 'Vous avez indiqué utiliser déjà un produit pour cette étape.',
    no_step: 'Cette étape n\'existe pas dans votre routine actuelle.',
    not_justified: 'Rien dans sa fiche ne le relie aux besoins de votre routine actuelle : il n\'est donc pas proposé.'
  };
  /* Offres par pays : libellés neutres, jamais un pays par défaut. */
  const OFFER_AVAILABILITY_LABELS = { in_stock: 'En stock', out_of_stock: 'Rupture de stock', coming_soon: 'Bientôt disponible', unknown: 'Disponibilité à vérifier' };
  const OFFER_TYPE_LABELS = { brand_site: 'Site de la marque', retailer: 'Revendeur en ligne', pharmacy: 'Pharmacie en ligne', marketplace: 'Place de marché', importer: 'Importateur ou distributeur' };
  const OFFER_TEXTS = {
    neutral: 'Options d\'achat en ligne. La disponibilité et la livraison dépendent de votre pays.',
    international: 'Livraison internationale annoncée par le vendeur : livraison selon votre pays, à vérifier lors de la commande (frais et douane possibles).',
    marketplace: 'Annonce d\'une place de marché : le vendeur est un tiers, DERMAI ne garantit pas l\'authenticité du produit.',
    none: 'Aucune offre vérifiée pour le moment.',
    priceToCheck: 'Prix à vérifier'
  };
  /* Pays d'achat et options d'achat selon le pays. Le pays ne sert qu'à présenter les offres : jamais à choisir un produit ou à changer une recommandation. */
  const MARKET_TEXTS = {
    label: 'Pays pour mes achats',
    question: 'Où souhaitez-vous acheter vos produits ?',
    prompt: 'Sélectionnez votre pays pour voir les options disponibles.',
    placeholder: 'Choisir un pays',
    help: 'Ce choix sert uniquement à afficher les offres d\'achat. Il ne change ni votre analyse, ni vos priorités, ni votre routine. Il reste sur cet appareil : DERMAI n\'utilise ni votre position ni votre adresse IP.',
    saved: 'Pays enregistré sur cet appareil.',
    noLocal: 'Aucune offre vérifiée pour ce pays pour le moment.',
    noLocalCard: 'Aucune offre vérifiée pour votre pays pour le moment.',
    elsewhereTitle: 'Voir les options d\'achat en ligne disponibles dans d\'autres pays',
    elsewhereHelp: 'Achat en ligne depuis un autre pays. La livraison n\'est pas vérifiée pour votre pays : vérifiez-la lors de la commande (frais et douane possibles).',
    local: 'Vendeur local',
    regional: 'Le vendeur indique desservir votre pays.',
    international: 'Voir une offre internationale',
    internationalTag: 'Offre internationale',
    shipCheck: 'Vérifier la livraison lors de la commande.',
    shipDeclared: 'Livraison internationale annoncée par le vendeur : livraison selon le pays sélectionné, à vérifier lors de la commande.',
    allKnown: 'Voir toutes les offres connues, par pays',
    priceLabel: 'Prix relevé',
    recommended: 'Proposé par DERMAI',
    summary: {
      ready: 'Offre locale : stock et prix indiqués au relevé',
      partial: 'Offre locale à vérifier : stock, prix ou lien non confirmé',
      unavailable: 'Offre locale : rupture ou bientôt disponible',
      elsewhere: 'Offres dans d\'autres pays seulement',
      none: 'Aucune offre vérifiée pour ce pays pour le moment.'
    },
    currencyNote: 'Devise du pays :',
    otherCurrency: 'Chaque prix est affiché dans la devise de son offre, sans conversion.'
  };
  const AVAILABILITY_LABELS = { available: 'Disponible', unavailable: 'Indisponible', coming_soon: 'Bientôt disponible', unknown: 'Données à venir' };

  /* ---- personnalisation : explications structurées (pourquoi, pourquoi maintenant, pourquoi pas autre chose) ---- */
  const LEVEL_LABELS = { none: 'Aucune routine', simple: 'Routine simple', full: 'Routine complète' };
  /* Libellés courts pour le profil (« Mon niveau de routine »). */
  const LEVEL_SHORT = { none: 'Minimal', simple: 'Simple', full: 'Complète' };
  const PERSONAL = {
    measured: labels => 'Votre analyse indique des repères plus faibles sur : ' + joinList(labels.map(lower)) + '.',
    measuredNone: 'Aucune priorité forte ne ressort de cette analyse. Nous privilégions une routine d\'entretien.',
    goals: labels => 'Vous avez indiqué comme objectif : ' + joinList(labels.map(lower)) + '. Un objectif sert à départager des options ; il ne transforme jamais un résultat favorable en besoin.',
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
      descriptive: 'Les indicateurs de cet objectif sont décrits sans règle d\'action automatique : aucun actif n\'est ajouté à ce titre.',
      unavailable: 'Les données de votre analyse ne permettent pas de rattacher cet objectif à un repère.',
      accompanied: 'Un indicateur lié à cet objectif peut être accompagné par un soin doux, sans être une priorité de cette analyse.',
      maintenance: 'Une routine d\'entretien est privilégiée : aucun actif n\'est ajouté pour cet objectif.'
    },
    accompanimentWhy: labels => 'Il accompagne ' + joinList(labels.map(lower)) + ' : ' + plural(labels.length, 'cet indicateur n\'est pas une priorité', 'ces indicateurs ne sont pas des priorités') + ' de cette analyse, c\'est un soin doux d\'accompagnement.',
    accompaniment: labels => 'Accompagnement léger : ' + joinList(labels.map(lower)) + '.',
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

  /* ---- synthèse personnalisée (js/engine/synthesis.js) ----
     Phrases assemblées à partir des données réelles de l'analyse : jamais de valeur écrite en dur, jamais de vocabulaire médical. */
  const li = (inds) => joinList(inds.map(i => lower(i.label) + ' (' + i.score + ')'));
  const plural = (n, one, many) => (n > 1 ? many : one);
  const your = inds => (inds.length > 1 ? 'Vos résultats ' : 'Votre ') + li(inds);
  const NUM = { 2: 'deux', 3: 'trois' };
  const cap = inds => { const t = li(inds); return t.charAt(0).toUpperCase() + t.slice(1); };
  const BASE_STEP = 'Cette étape fait partie de l\'entretien de base.';
  const SYNTH = {
    li,
    TITLES: { shows: 'Ce que l\'analyse montre', lowest: 'Vos résultats les moins élevés', retained: 'Ce que DERMAI retient', accompaniment: 'Accompagnement léger', strategy: 'Votre stratégie' },
    /* Explication globale, discrète : score affiché ≠ donnée de décision. Aucun score brut n'est jamais affiché. */
    scoreNote: 'Le score affiché est le repère utilisateur fourni par l\'analyse. Les décisions de personnalisation de DERMAI utilisent séparément les données brutes de l\'analyse.',
    productsNone: 'Aucun produit du catalogue DERMAI n\'est relié à vos besoins actuels. Votre routine repose sur des produits de base de votre choix : un nettoyant doux, un hydratant que votre peau apprécie et une protection solaire.',
    TIER_LABELS: { priority: 'Besoin retenu', lowest: 'Résultat moins élevé', strength: 'Résultat plus élevé', other: 'Autre résultat' },
    /* 1. Ce que l'analyse montre (scores affichés) */
    range: (n, min, max) => 'Votre analyse donne ' + n + ' indicateur' + plural(n, '', 's') + ' principa' + plural(n, 'l', 'ux') + (n > 1 ? ', de ' + min + ' à ' + max + ' sur 100.' : ' : ' + min + ' sur 100.'),
    strengths: inds => 'Vos résultats les plus élevés : ' + li(inds) + '.',
    skinType: label => 'Profil de peau indiqué par l\'analyse : ' + lower(label) + '.',
    /* 2. Vos résultats les moins élevés (comparaison relative, jamais un problème) */
    lowest: inds => cap(inds) + '.',
    lowestNote: 'Vos résultats les moins élevés correspondent à une comparaison entre les indicateurs analysés. Un résultat plus bas ne constitue pas automatiquement une priorité de soin.',
    homogeneous: 'Vos indicateurs principaux sont très proches les uns des autres : aucun ne se détache.',
    /* 3. Ce que DERMAI retient (seulement une règle DERMAI justifiée) */
    /* Trois niveaux, jamais confondus : priorité de soin (repère nettement moins élevé), axe à soutenir (repère moins élevé), favorable.
       Les deux premiers ne concernent que des indicateurs sur lesquels DERMAI a une règle d'action (rôle) et un actif validé. */
    retained: (strong, support) => {
      const n = (k, one, many) => (k === 1 ? one : (NUM[k] || k) + ' ' + many);
      const ps = strong.length ? n(strong.length, 'une priorité de soin', 'priorités de soin') + ' : ' + li(strong) : '';
      const as = support.length ? n(support.length, 'un axe à soutenir', 'axes à soutenir') + ' : ' + li(support) : '';
      if (ps && as) return 'DERMAI retient ' + ps + ', et ' + as + '.';
      if (ps) return 'DERMAI retient ' + ps + '.';
      return 'Aucun indicateur ne ressort comme priorité forte. En revanche, DERMAI retient ' + as + '.';
    },
    retainedWhy: n => 'D\'après les données de l\'analyse, ' + plural(n, 'ce résultat est', 'ces résultats sont') + ' sous les repères DERMAI, et un soin cosmétique validé existe pour ' + plural(n, 'lui.', 'eux.'),
    /* Accompagnement léger : des indicateurs qui ne sont PAS des priorités mais que DERMAI peut accompagner par un soin doux. Trois états : axe identifié,
       recommandation (l'actif doux), soin ajouté à la routine ou non. Jamais « favorable, donc aucun soin », jamais de promesse. */
    accompaniment: {
      distinct: inds => cap(inds) + ' : ' + plural(inds.length, 'n\'est pas une priorité dans cette analyse, mais ressort', 'ne sont pas des priorités dans cette analyse, mais ressortent') + ' suffisamment par rapport à vos autres résultats pour justifier un accompagnement cosmétique léger.',
      objective: inds => cap(inds) + ' : ' + plural(inds.length, 'correspond à votre objectif et peut être accompagné', 'correspondent à votre objectif et peuvent être accompagnés') + ' par un soin doux.',
      overflow: inds => cap(inds) + ' : ' + plural(inds.length, 'est sous les repères DERMAI, mais la routine se limite', 'sont sous les repères DERMAI, mais la routine se limite') + ' à trois axes prioritaires ; un soin doux peut l\'accompagner.',
      added: (active, inds) => 'Un soin doux d\'accompagnement est ajouté à votre routine : ' + lower(active) + ' pour ' + li(inds) + '.',
      covered: (active, inds) => cap(inds) + ' : déjà accompagné par ' + lower(active) + ', présent dans votre routine. Aucune étape n\'est ajoutée.',
      identified: (active, inds) => 'Un accompagnement cosmétique léger peut être proposé pour ' + li(inds) + ' (' + lower(active) + '), mais DERMAI ne l\'ajoute pas à votre routine pour l\'instant.'
    },
    noNeed: 'DERMAI ne retient ni priorité de soin ni axe à soutenir : aucun indicateur sur lequel DERMAI peut agir n\'est sous ses repères. Votre routine reste une routine d\'entretien.',
    beyondCap: inds => cap(inds) + ' : aussi sous les repères DERMAI, mais la routine se limite à trois axes, introduits un à un.',
    noLever: inds => cap(inds) + ' : sous les repères DERMAI, mais DERMAI n\'a pas encore de soin ciblé validé pour ' + plural(inds.length, 'cet indicateur.', 'ces indicateurs.'),
    descriptive: inds => cap(inds) + ' : ' + plural(inds.length, 'résultat décrit', 'résultats décrits') + ' sans soin ciblé automatique, car DERMAI n\'a pas de règle d\'action fiable pour ' + plural(inds.length, 'cet indicateur.', 'ces indicateurs.'),
    gated: (inds, goals) => cap(inds) + ' : information seulement. DERMAI n\'y associe un soin que si vous choisissez l\'objectif ' + joinList(goals.map(g => '« ' + lower(g) + ' »')) + '.',
    compat: 'Analyse historique : données brutes non disponibles. DERMAI applique ses repères au score affiché, sans rien reconstruire.',
    /* Carte du visage : détection (masque) ≠ décision (score). Le masque ne sert qu'à localiser ; il ne crée, ne modifie ni ne classe rien. */
    map: {
      note: 'Une zone peut être détectée sur votre photo sans devenir une priorité de soin. La carte montre où l\'analyse a repéré des éléments ; les axes retenus par DERMAI dépendent du score de l\'indicateur, jamais du nombre ou de la taille des zones.',
      detected: (id, label) => id === 'acne' ? 'Des éléments associés aux imperfections ont été détectés sur votre photo.' : 'Des zones associées à l\'indicateur « ' + lower(label) + ' » ont été détectées sur votre photo.',
      unavailable: 'Localisation visuelle indisponible pour cet indicateur.',
      empty: 'Aucune zone localisée pour cet indicateur sur cette photo.'
    },
    /* Statut DERMAI de chaque indicateur (lu par la carte du visage et la page d'un indicateur). */
    LEVELS: { priority: 'Priorité de soin', support: 'Axe à soutenir', accompaniment: 'Accompagnement léger', maintain: 'À entretenir', beyond: 'Axe en attente', descriptive: 'Indicateur observé', informative: 'Information', noLever: 'Sans soin validé' },
    status: {
      priority: 'DERMAI retient cet indicateur comme priorité de soin dans cette analyse.',
      support: 'DERMAI retient cet indicateur comme axe à soutenir dans cette analyse.',
      beyond: 'Cet indicateur est sous les repères DERMAI, mais la routine se limite à trois axes : il reste pour une prochaine étape.',
      maintain: 'Cet indicateur n\'est pas une priorité dans cette analyse. Votre routine de base suffit à l\'entretenir.',
      accompaniment: (origin, st, active) => accompanimentReason(origin) + (({
        added: ' Un soin doux (' + lower(active) + ') est ajouté à votre routine.',
        covered: ' Le soin déjà présent dans votre routine (' + lower(active) + ') l\'accompagne : aucune étape n\'est ajoutée.',
        identified: ' Un accompagnement cosmétique léger peut être proposé (' + lower(active) + '), sans être ajouté à votre routine pour l\'instant.'
      })[st] || ''),
      descriptive: 'Cet indicateur est décrit sans soin ciblé automatique : DERMAI n\'a pas de règle d\'action fiable pour lui.',
      informative: goal => 'Cet indicateur est donné à titre d\'information : il n\'appelle pas de soin automatique' + (goal ? ', sauf si vous choisissez l\'objectif « ' + lower(goal) + ' »' : '') + '.',
      noLever: 'Cet indicateur est sous les repères DERMAI, mais DERMAI n\'a pas encore de soin ciblé validé pour lui.'
    },
    /* Objectifs */
    noGoal: 'Vous n\'avez pas indiqué d\'objectif : DERMAI s\'appuie sur votre analyse seule.',
    goal: {
      accompanied: (g, inds) => g + ' : ' + li(inds) + ' ' + plural(inds.length, 'n\'est pas une priorité, mais peut', 'ne sont pas des priorités, mais peuvent') + ' être ' + plural(inds.length, 'accompagné', 'accompagnés') + ' par un soin doux.',
      priority: (g, inds) => g + ' : rejoint un besoin retenu par DERMAI (' + li(inds) + '). Il passe en tête de votre routine.',
      beyond_cap: (g, inds) => g + ' : ' + li(inds) + plural(inds.length, ' est', ' sont') + ' sous les repères DERMAI, mais la routine se limite à trois besoins : ' + plural(inds.length, 'il reste', 'ils restent') + ' pour une prochaine étape.',
      no_signal: (g, inds) => g + ' : ' + li(inds) + ' ne ' + plural(inds.length, 'fait', 'font') + ' pas ressortir de besoin selon les repères DERMAI : aucun soin ciblé n\'est ajouté à ce titre.',
      descriptive: (g, inds) => g + ' : ' + li(inds) + ', ' + plural(inds.length, 'résultat décrit', 'résultats décrits') + ' sans règle d\'action automatique : aucun soin ciblé n\'est ajouté à ce titre.',
      unavailable: g => g + ' : aucun indicateur correspondant n\'est disponible dans cette analyse.',
      maintenance: (g, action) => g + (action ? ' : votre routine garde une base d\'entretien, en plus des besoins retenus.' : ' : c\'est précisément ce que propose votre routine.')
    },
    /* 4. Votre stratégie */
    strategy: {
      action: (inds, n, level) => 'Stratégie : soutenir ' + li(inds) + ' avec ' + n + ' soin' + (n > 1 ? 's' : '') + ' ciblé' + (n > 1 ? 's' : '') + ', sur une base d\'entretien (nettoyage doux, hydratation, protection solaire), en routine ' + level + '.',
      actionNoTreatment: inds => 'Stratégie : soutenir ' + li(inds) + ' avec la routine de base (nettoyage doux, hydratation, protection solaire), sans soin ciblé pour l\'instant.',
      actionNoTreatmentHere: inds => 'Stratégie : soutenir ' + li(inds) + ' avec la routine de base (nettoyage doux, hydratation, protection solaire), sans soin ciblé pour cet axe.',
      maintenance: skin => 'Stratégie : entretien de base (nettoyage doux, hydratation, protection solaire)' + (skin ? ', adapté à votre profil (' + lower(skin) + ')' : '') + '. Aucun soin ciblé n\'est ajouté.',
      maintenanceBase: skin => 'Stratégie : entretien de base (nettoyage doux, hydratation, protection solaire)' + (skin ? ', adapté à votre profil (' + lower(skin) + ')' : '') + '.',
      accompanied: (active, inds) => ' Un soin doux d\'accompagnement s\'y ajoute : ' + lower(active) + ' pour ' + li(inds) + '.',
      possible: inds => ' Un accompagnement cosmétique léger est possible pour ' + li(inds) + ', sans soin ajouté pour l\'instant.'
    },
    skinContext: label => 'Votre type de peau (' + lower(label) + ') sert de contexte : il oriente la texture de l\'hydratant et la prudence, jamais à lui seul le choix d\'un soin.',
    step: {
      base: BASE_STEP,
      cleanse: { oily: ' Avec un profil gras, un nettoyage doux matin et soir, sans frotter, suffit.', dry: ' Avec un profil sec, un nettoyant doux évite de tirailler la peau.',
        combination: ' Avec un profil mixte, un même nettoyant doux convient à l\'ensemble du visage.', normal: '', unknown: '' },
      moistKept: ' DERMAI retient l\'hydratation comme axe de soin dans cette analyse. L\'objectif est de soutenir le confort et l\'hydratation de la peau.',
      moistSupports: (labels, inds) => ' Ingrédients recherchés dans l\'hydratant : ' + joinList(labels.map(lower)) + (inds.length ? ', retenu' + plural(labels.length, '', 's') + ' aussi pour ' + li(inds) : '') + '.',
      moistDry: ' Avec un profil sec, une texture plus riche est souvent plus confortable.',
      spfExfoliant: ' Elle compte d\'autant plus avec un exfoliant dans la routine.',
      accompaniment: (active, inds, goal) => cap(inds) + ' : accompagnement léger, ' + plural(inds.length, 'pas une priorité', 'pas des priorités') + ' de cette analyse. Actif doux recherché : ' + lower(active) + '.' + (goal ? ' ' + plural(inds.length, 'Il rejoint', 'Ils rejoignent') + ' votre objectif « ' + lower(goal) + ' ».' : ''),
      treatment: (active, inds, goal) => cap(inds) + ' : ' + plural(inds.length, 'axe retenu', 'axes retenus') + ' selon les règles DERMAI. Actif recherché pour ' + plural(inds.length, 'cet axe', 'ces axes') + ' : ' + lower(active) + '.' + (goal ? ' ' + plural(inds.length, 'Il rejoint', 'Ils rejoignent') + ' votre objectif « ' + lower(goal) + ' ».' : ''),
      owned: 'Vous utilisez déjà un produit pour cette étape : gardez-le s\'il vous convient.'
    },
    product: {
      none: { moisturize: 'Aucun hydratant du catalogue DERMAI n\'est relié à vos besoins actuels : un hydratant que votre peau apprécie convient.',
        cleanse: 'Le catalogue DERMAI ne propose pas encore de nettoyant.', spf: 'Le catalogue DERMAI ne propose pas encore de protection solaire.',
        treatment: 'Aucun produit du catalogue DERMAI ne contient cet actif pour le moment.' },
      targets: labels => ' La marque le présente pour : ' + joinList(labels.map(lower)) + '.'
    }
  };
  /* Pourquoi CE produit plutôt qu'un autre (règle de départage réellement appliquée par products.match). */
  const SELECTION = {
    only: 'C\'est le seul produit du catalogue DERMAI qui remplit ces critères.',
    more_actives: n => 'Parmi ' + n + ' produits possibles, c\'est celui qui contient le plus d\'ingrédients recherchés.',
    skin: n => 'Parmi ' + n + ' produits possibles, c\'est celui dont la fiche correspond à votre type de peau.',
    editorial: n => 'Parmi ' + n + ' produits possibles, il passe en premier selon le classement éditorial DERMAI pour cet actif.',
    order: n => 'Parmi ' + n + ' produits équivalents, il est retenu selon l\'ordre du catalogue.'
  };
  const selectionText = sel => (!sel ? '' : sel.rule === 'only' ? SELECTION.only : SELECTION[sel.rule] ? SELECTION[sel.rule](sel.candidates) : '');
  return {
    LEVEL_LABELS, LEVEL_SHORT, PERSONAL,
    DOMAIN_LABELS, GOAL_LABELS, NO_GOAL, GOAL_LIMIT, SLOT_LABELS, STEP_LABELS, joinList, lower,
    priorityReason, MAINTENANCE, eyeInfo, EYE_NOTE, EYE_GROUP_TITLE, INFO_LABEL, INFO_TEXT, INDICATOR_NOTES, activeReason, supportReason, DEFERRED, TEXTURE, stepReason, NOTES, SLOW, summary, productBecause, accompanimentReason, accompanimentStep, accompanimentSummary, productWhy, productRole, SYNTH, SELECTION, selectionText, PRODUCT_REASONS, PRODUCT_CATEGORY_LABELS, MARKET_TEXTS, AVAILABILITY_LABELS, OFFER_AVAILABILITY_LABELS, OFFER_TYPE_LABELS, OFFER_TEXTS
  };
});
