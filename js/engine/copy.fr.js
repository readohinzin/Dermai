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
    title: 'Votre analyse n\'indique pas d\'indicateur à soutenir en priorité.',
    text: 'Une routine d\'entretien simple convient bien : nettoyer doucement, hydrater et protéger du soleil.'
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
  const activeReason = (labels, fallbackSoft) => 'Choisi pour : ' + joinList(labels.map(lower)) + '.' +
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
    slot: 'Mis de côté : le créneau est déjà chargé.'
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

  return {
    DOMAIN_LABELS, GOAL_LABELS, NO_GOAL, GOAL_LIMIT, SLOT_LABELS, STEP_LABELS, joinList, lower,
    priorityReason, MAINTENANCE, eyeInfo, EYE_NOTE, INFO_LABEL, INFO_TEXT, INDICATOR_NOTES, activeReason, supportReason, DEFERRED, TEXTURE, stepReason, NOTES, SLOW, summary, productBecause
  };
});
