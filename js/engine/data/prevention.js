/* Prévention : produits éclaircissants et produits à composition non vérifiable. Données et textes seulement, aucune décision du moteur.

   RÈGLES (décidées avec le propriétaire du produit)
   - DERMAI ne recommande JAMAIS un produit qui éclaircit ou dépigmente la peau entière. Interdits : hydroquinone, mercure, corticoïdes, arbutine, acide kojique,
     glutathion (liste EXCLUDED du moteur, data/actives.js ; noms INCI exacts, data/inci-aliases.js) et tout produit qui PROMET d'éclaircir la peau (CLAIMS ci-dessous).
   - Sont conservés, avec les mots « atténuer les taches » et « unifier le teint » : azélaïque, niacinamide, vitamine C, mandélique (elles visent des taches, pas la couleur de la peau).
   - Un produit sans liste d'ingrédients lisible est « composition non vérifiable » : jamais recommandé. Dans le catalogue réel, un produit sans liste INCI ne peut pas être
     actif ; les produits de démonstration (demo: true) sont des exemples fictifs, hors de cette règle.
   - Ce fichier est le SEUL endroit du code d'interface où l'on écrit « éclaircir », « éclaircissant » ou « dépigmentant », et seulement pour AVERTIR : chaque message est un avertissement
     (test PV). Tout le reste du code garde l'interdiction de ces mots (engine-copy.test.js).
   - Ton cosmétique et prudent : aucun diagnostic, aucune promesse. Les effets cités sont ceux que décrivent les autorités sanitaires pour ces substances ; les verbes restent au conditionnel
     (« peut »). Relecture par un professionnel de santé requise avant un lancement public.
   Module partagé navigateur / Node. Aucune dépendance de navigateur (pas de lookbehind : anciens iPhone). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode ? { aliases: require('./inci-aliases.js') } : { aliases: (root.DermaiEngine || {}).inciAliases };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.preventionData = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';

  /* Substances de la liste EXCLUDED qui servent à éclaircir ou dépigmenter la peau : elles reçoivent un message de prévention précis. Les autres (peroxyde de benzoyle,
     adapalène, trétinoïne) gardent le message neutre « sans conseil DERMAI ». */
  const LIGHTENING_IDS = ['hydroquinone', 'mercury', 'corticoids', 'arbutin', 'kojic_acid', 'glutathione'];

  const GENERIC = 'DERMAI ne conseille pas les produits qui visent à éclaircir la peau entière : leurs effets à long terme sont mal connus et ils peuvent irriter.';
  const ASK = 'Évitez-les et parlez-en à un dermatologue ou à un pharmacien.';
  const MESSAGES = {
    hydroquinone: 'L\'hydroquinone est une substance utilisée pour dépigmenter la peau. Employée sans suivi, ou longtemps, elle peut irriter la peau et la marquer davantage. DERMAI ne conseille pas les produits qui en contiennent. ' + ASK,
    mercury: 'Le mercure est toxique, notamment pour les reins et le système nerveux. Il est interdit dans les cosmétiques par de nombreux pays, mais on le trouve encore dans certains produits éclaircissants non contrôlés. N\'utilisez pas ce produit et parlez-en vite à un pharmacien ou à un médecin.',
    corticoids: 'Les corticoïdes sont des médicaments, pas des cosmétiques. Sur le visage, sans avis médical, ils peuvent amincir et fragiliser la peau, provoquer des boutons et des vergetures. DERMAI ne conseille pas les produits qui en contiennent. Évitez-les et parlez-en à un médecin ou à un pharmacien.',
    arbutin: 'L\'arbutine est utilisée dans des produits pour éclaircir la peau. ' + GENERIC + ' Pour des taches, parlez-en à un dermatologue ou à un pharmacien.',
    kojic_acid: 'L\'acide kojique est utilisé dans des produits pour éclaircir la peau. ' + GENERIC + ' Pour des taches, parlez-en à un dermatologue ou à un pharmacien.',
    glutathione: 'Le glutathion est utilisé dans des produits pour éclaircir la peau. ' + GENERIC + ' Pour des taches, parlez-en à un dermatologue ou à un pharmacien.'
  };
  const TITLES = { lightening: name => 'Produit éclaircissant : prudence avec « ' + name + ' »', neutral: name => 'Substance sans conseil DERMAI dans « ' + name + ' »' };
  const RULE = 'Liste EXCLUDED du moteur DERMAI : DERMAI ne recommande jamais de produit qui éclaircit ou dépigmente la peau entière.';
  const BADGE = { lightening: 'Substance de produit éclaircissant : prudence', neutral: 'Substance sans conseil DERMAI' };

  /* Produit sans liste d'ingrédients lisible. */
  const UNVERIFIABLE = {
    title: name => 'Composition non vérifiable : « ' + name + ' »',
    badge: 'Composition non vérifiable',
    warn: 'Sans liste d\'ingrédients lisible, personne ne peut savoir ce que contient un produit : DERMAI ne le recommande jamais. Méfiez-vous surtout des produits sans liste d\'ingrédients qui promettent d\'éclaircir la peau : certains contiennent du mercure, de l\'hydroquinone ou des corticoïdes sans l\'indiquer.'
  };
  UNVERIFIABLE.text = 'DERMAI ne peut pas vérifier ce produit. ' + UNVERIFIABLE.warn;

  /* Rappel général, montré à qui veut atténuer des taches ou unifier le teint (les plus exposées aux produits éclaircissants). */
  const GENERAL = {
    title: 'Pour les taches, évitez les produits éclaircissants',
    text: 'Pour atténuer des taches ou unifier le teint, évitez les produits qui promettent d\'éclaircir la peau entière, surtout sans liste d\'ingrédients : certains contiennent du mercure, de l\'hydroquinone ou des corticoïdes sans l\'indiquer, ce qui peut abîmer la peau et la santé. Les soins que DERMAI propose visent les taches, pas la couleur de votre peau.'
  };

  /* Promesses d'éclaircissement de la peau entière (nom, description, libellés d'un produit). « Brightening » seul n'en est pas une (marketing courant de la vitamine C). */
  const CLAIMS = /(?:^|[^\p{L}])(?:[ée]claircissant\w*|[ée]claircir|blanchissant\w*|blanchir|d[ée]pigment\w*|whiten\w*|lighten\w*|bleach\w*|skin[- ]?lightener|fade[- ]cream)(?![\p{L}])/iu;
  const claimIn = txt => { const m = CLAIMS.exec(typeof txt === 'string' ? txt : ''); return m ? m[0].replace(/^[^\p{L}]/u, '').toLowerCase() : null; };

  /* Même normalisation que verif.js (normalizeName), vérifiée par test : minuscules, sans accents, sans pourcentage ni astérisque. */
  const normalize = raw => String(typeof raw === 'string' ? raw : '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ').replace(/[*†‡]+/g, ' ').replace(/\s+/g, ' ').trim();
  const BY_NAME = new Map(dep.aliases.EXCLUDED_NAMES.flatMap(e => e.names.map(n => [n, e.id])));
  /* Substances exclues d'une liste INCI : nom exact seulement (nom complet, puis sans parenthèses). */
  function excludedIn(inci) {
    const out = new Set();
    for (const raw of Array.isArray(inci) ? inci : []) {
      if (typeof raw !== 'string') continue;
      for (const k of [normalize(raw.replace(/[()]/g, ' ')), normalize(raw.replace(/\([^)]*\)/g, ' '))]) { const id = BY_NAME.get(k); if (id) out.add(id); }
    }
    return [...out];
  }
  const hasInci = inci => Array.isArray(inci) && inci.some(x => typeof x === 'string' && x.trim().length > 0);

  /* Contrôle d'un produit de catalogue : substances exclues, promesse d'éclaircissement, composition non vérifiable (produit réel sans INCI). */
  function check(p) {
    const q = p && typeof p === 'object' ? p : {};
    const texts = [q.name, q.description, ...(Array.isArray(q.ingredients) ? q.ingredients.map(i => i && i.label) : [])];
    const claims = [...new Set(texts.map(claimIn).filter(Boolean))];
    return { excluded: excludedIn(q.inci), claims, unverifiable: q.demo !== true && !hasInci(q.inci) };
  }
  /* Vrai si le produit ne doit JAMAIS être sélectionné : substance exclue ou promesse d'éclaircissement. La composition non vérifiable est refusée à la VALIDATION du catalogue
     (products.js, validateProduct : un produit validé exige sa liste INCI ; un produit à vérifier est inactif), pas à la sélection : l'empreinte C0 des décisions utilise un catalogue
     figé de la phase 2, d'avant les listes INCI, qui ne doit pas changer. */
  const blocked = p => { const c = check(p); return c.excluded.length > 0 || c.claims.length > 0; };

  const isLightening = id => LIGHTENING_IDS.includes(id);
  const messageOf = id => (isLightening(id) ? MESSAGES[id] : null);

  return { LIGHTENING_IDS, MESSAGES, TITLES, RULE, BADGE, UNVERIFIABLE, GENERAL, GENERIC, CLAIMS, claimIn, normalize, excludedIn, hasInci, check, blocked, isLightening, messageOf };
});
