/* Alias INCI : correspondances EXPLICITES entre le nom d'un ingrédient, tel qu'il s'écrit sur une étiquette, et un actif des fiches DERMAI (actives.js).
   Aucune logique ici (voir ../verif.js). Règle de conception : une correspondance n'existe que si elle est justifiée et sa provenance est écrite. Jamais de ressemblance
   de nom : « Ethylhexylglycerin » n'est pas de la glycérine, « Sodium Hyaluronate Crosspolymer » n'est reconnu que parce que le catalogue le relie à l'acide hyaluronique.
   Les clés sont déjà normalisées (minuscules, sans accents, sans pourcentage) : voir normalizeName dans verif.js, vérifié par test.

   validation (niveau de justification, jamais une preuve d'efficacité) :
     catalogue : l'ingrédient figure dans la liste INCI d'un produit de catalogue.js dont la fiche le relie à cet actif (lien déjà validé par DERMAI) ;
     lexique   : correspondance déjà portée par le lexique FR/EN du projet (outillage de rapprochement de produits, hors navigateur) ;
     a_relire  : nom INCI exact d'une substance sans ambiguïté, mais SANS attestation dans les données du projet : relecture par un cosmétologue requise avant lancement public.
   Un ingrédient absent de cette table reste « non reconnu » : aucune fonction, aucun risque, aucune efficacité ne lui est attribuée. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.inciAliases = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CAT = 'catalogue.js (INCI du produit, relié à cet actif)', LEX = 'lexique FR/EN du projet (outillage de rapprochement de produits, hors navigateur)', INCI = 'nom INCI exact, sans attestation dans les données du projet';
  const a = (key, activeId, validation, source) => ({ key, activeId, validation, source });

  const ALIASES = [
    a('niacinamide', 'niacinamide', 'catalogue', CAT),
    a('vitamine b3', 'niacinamide', 'lexique', LEX),
    a('salicylic acid', 'salicylic', 'catalogue', CAT),
    a('acide salicylique', 'salicylic', 'lexique', LEX),
    a('azelaic acid', 'azelaic', 'catalogue', CAT),
    a('acide azelaique', 'azelaic', 'lexique', LEX),
    a('ascorbic acid', 'vitamin_c', 'catalogue', CAT),
    a('ascorbyl glucoside', 'vitamin_c', 'catalogue', CAT + ' (dérivé de vitamine C)'),
    a('acide ascorbique', 'vitamin_c', 'lexique', LEX),
    a('vitamin c', 'vitamin_c', 'lexique', LEX),
    a('vitamine c', 'vitamin_c', 'lexique', LEX),
    a('retinyl palmitate', 'retinoid', 'lexique', LEX),
    a('palmitate de retinyle', 'retinoid', 'lexique', LEX),
    a('retinol', 'retinoid', 'a_relire', INCI),
    a('retinal', 'retinoid', 'a_relire', INCI),
    a('retinyl acetate', 'retinoid', 'a_relire', INCI),
    a('glycolic acid', 'aha_pha', 'catalogue', CAT),
    a('lactic acid', 'aha_pha', 'catalogue', CAT),
    a('mandelic acid', 'aha_pha', 'catalogue', CAT),
    a('acide glycolique', 'aha_pha', 'lexique', LEX),
    a('acide lactique', 'aha_pha', 'lexique', LEX),
    a('acide mandelique', 'aha_pha', 'lexique', LEX),
    a('gluconolactone', 'aha_pha', 'a_relire', INCI + ' (PHA)'),
    a('sodium hyaluronate', 'hyaluronic', 'catalogue', CAT),
    a('sodium hyaluronate crosspolymer', 'hyaluronic', 'catalogue', CAT),
    a('hydrolyzed hyaluronic acid', 'hyaluronic', 'catalogue', CAT),
    a('hyaluronic acid', 'hyaluronic', 'lexique', LEX),
    a('acide hyaluronique', 'hyaluronic', 'lexique', LEX),
    a('hyaluronate de sodium', 'hyaluronic', 'lexique', LEX),
    a('glycerin', 'glycerin', 'catalogue', CAT),
    a('glycerine', 'glycerin', 'lexique', LEX),
    a('panthenol', 'panthenol', 'catalogue', CAT),
    a('vitamine b5', 'panthenol', 'lexique', LEX),
    a('ceramide np', 'ceramides', 'catalogue', CAT),
    a('ceramide ap', 'ceramides', 'catalogue', CAT),
    a('ceramide eop', 'ceramides', 'catalogue', CAT),
    a('ceramide ng', 'ceramides', 'a_relire', INCI),
    a('ceramide ns', 'ceramides', 'a_relire', INCI),
    a('squalane', 'squalane', 'a_relire', INCI),
    a('zinc pca', 'zinc', 'lexique', LEX),
    a('caffeine', 'caffeine', 'a_relire', INCI),
    a('tranexamic acid', 'tranexamic', 'a_relire', INCI)
  ];

  /* Substances de la liste EXCLUDED du moteur (actives.js) : reconnues par NOM INCI EXACT seulement, pour afficher le message de prudence. */
  const EXCLUDED_NAMES = [
    { id: 'hydroquinone', names: ['hydroquinone'] },
    { id: 'tretinoin', names: ['tretinoin'] },
    { id: 'adapalene', names: ['adapalene'] },
    { id: 'benzoyl_peroxide', names: ['benzoyl peroxide'] },
    { id: 'mercury', names: ['mercury', 'mercuric chloride', 'mercurous chloride', 'ammoniated mercury'] },
    { id: 'corticoids', names: ['hydrocortisone', 'hydrocortisone acetate', 'clobetasol propionate', 'betamethasone', 'betamethasone valerate', 'betamethasone dipropionate', 'dexamethasone', 'triamcinolone acetonide', 'fluocinonide'] }
  ].map(e => Object.assign(e, { validation: 'a_relire', source: INCI + ' ; liste EXCLUDED du moteur DERMAI' }));

  return { ALIASES, EXCLUDED_NAMES };
});
