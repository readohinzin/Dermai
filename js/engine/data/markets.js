/* PAYS D'AFRIQUE : la source unique (code ISO 3166-1 alpha-2, nom français, nom anglais, devise principale ISO 4217). Utilisée par le sélecteur de pays d'achat,
   la validation des offres (products.js) et l'affichage de la devise locale. Étendre la liste = une ligne ici, rien dans le moteur.
   La devise d'un pays est une INFORMATION D'AFFICHAGE : une offre n'est jamais « disponible » dans un pays parce qu'il partage sa devise avec le pays de l'offre.
   Aucune donnée d'analyse, aucune donnée personnelle. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.marketsData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const COUNTRIES = [
    { code: 'DZ', fr: 'Algérie', en: 'Algeria', det: "l'", currency: 'DZD' },
    { code: 'AO', fr: 'Angola', en: 'Angola', det: "l'", currency: 'AOA' },
    { code: 'BJ', fr: 'Bénin', en: 'Benin', det: 'le', currency: 'XOF' },
    { code: 'BW', fr: 'Botswana', en: 'Botswana', det: 'le', currency: 'BWP' },
    { code: 'BF', fr: 'Burkina Faso', en: 'Burkina Faso', det: 'le', currency: 'XOF' },
    { code: 'BI', fr: 'Burundi', en: 'Burundi', det: 'le', currency: 'BIF' },
    { code: 'CV', fr: 'Cap-Vert', en: 'Cape Verde', det: 'le', currency: 'CVE' },
    { code: 'CM', fr: 'Cameroun', en: 'Cameroon', det: 'le', currency: 'XAF' },
    { code: 'CF', fr: 'Centrafrique', en: 'Central African Republic', det: 'la', currency: 'XAF' },
    { code: 'TD', fr: 'Tchad', en: 'Chad', det: 'le', currency: 'XAF' },
    { code: 'KM', fr: 'Comores', en: 'Comoros', det: 'les', currency: 'KMF' },
    { code: 'CG', fr: 'Congo', en: 'Congo', det: 'le', currency: 'XAF' },
    { code: 'CD', fr: 'RD Congo', en: 'DR Congo', det: 'la', currency: 'CDF' },
    { code: 'CI', fr: 'Côte d\'Ivoire', en: 'Ivory Coast', det: 'la', currency: 'XOF' },
    { code: 'DJ', fr: 'Djibouti', en: 'Djibouti', det: '', currency: 'DJF' },
    { code: 'EG', fr: 'Égypte', en: 'Egypt', det: "l'", currency: 'EGP' },
    { code: 'GQ', fr: 'Guinée équatoriale', en: 'Equatorial Guinea', det: 'la', currency: 'XAF' },
    { code: 'ER', fr: 'Érythrée', en: 'Eritrea', det: "l'", currency: 'ERN' },
    { code: 'SZ', fr: 'Eswatini', en: 'Eswatini', det: "l'", currency: 'SZL' },
    { code: 'ET', fr: 'Éthiopie', en: 'Ethiopia', det: "l'", currency: 'ETB' },
    { code: 'GA', fr: 'Gabon', en: 'Gabon', det: 'le', currency: 'XAF' },
    { code: 'GM', fr: 'Gambie', en: 'Gambia', det: 'la', currency: 'GMD' },
    { code: 'GH', fr: 'Ghana', en: 'Ghana', det: 'le', currency: 'GHS' },
    { code: 'GN', fr: 'Guinée', en: 'Guinea', det: 'la', currency: 'GNF' },
    { code: 'GW', fr: 'Guinée-Bissau', en: 'Guinea-Bissau', det: 'la', currency: 'XOF' },
    { code: 'KE', fr: 'Kenya', en: 'Kenya', det: 'le', currency: 'KES' },
    { code: 'LS', fr: 'Lesotho', en: 'Lesotho', det: 'le', currency: 'LSL' },
    { code: 'LR', fr: 'Liberia', en: 'Liberia', det: 'le', currency: 'LRD' },
    { code: 'LY', fr: 'Libye', en: 'Libya', det: 'la', currency: 'LYD' },
    { code: 'MG', fr: 'Madagascar', en: 'Madagascar', det: '', currency: 'MGA' },
    { code: 'MW', fr: 'Malawi', en: 'Malawi', det: 'le', currency: 'MWK' },
    { code: 'ML', fr: 'Mali', en: 'Mali', det: 'le', currency: 'XOF' },
    { code: 'MR', fr: 'Mauritanie', en: 'Mauritania', det: 'la', currency: 'MRU' },
    { code: 'MU', fr: 'Maurice', en: 'Mauritius', det: '', currency: 'MUR' },
    { code: 'MA', fr: 'Maroc', en: 'Morocco', det: 'le', currency: 'MAD' },
    { code: 'MZ', fr: 'Mozambique', en: 'Mozambique', det: 'le', currency: 'MZN' },
    { code: 'NA', fr: 'Namibie', en: 'Namibia', det: 'la', currency: 'NAD' },
    { code: 'NE', fr: 'Niger', en: 'Niger', det: 'le', currency: 'XOF' },
    { code: 'NG', fr: 'Nigeria', en: 'Nigeria', det: 'le', currency: 'NGN' },
    { code: 'RW', fr: 'Rwanda', en: 'Rwanda', det: 'le', currency: 'RWF' },
    { code: 'ST', fr: 'Sao Tomé-et-Principe', en: 'Sao Tome and Principe', det: '', currency: 'STN' },
    { code: 'SN', fr: 'Sénégal', en: 'Senegal', det: 'le', currency: 'XOF' },
    { code: 'SC', fr: 'Seychelles', en: 'Seychelles', det: 'les', currency: 'SCR' },
    { code: 'SL', fr: 'Sierra Leone', en: 'Sierra Leone', det: 'la', currency: 'SLE' },
    { code: 'SO', fr: 'Somalie', en: 'Somalia', det: 'la', currency: 'SOS' },
    { code: 'ZA', fr: 'Afrique du Sud', en: 'South Africa', det: "l'", currency: 'ZAR' },
    { code: 'SS', fr: 'Soudan du Sud', en: 'South Sudan', det: 'le', currency: 'SSP' },
    { code: 'SD', fr: 'Soudan', en: 'Sudan', det: 'le', currency: 'SDG' },
    { code: 'TZ', fr: 'Tanzanie', en: 'Tanzania', det: 'la', currency: 'TZS' },
    { code: 'TG', fr: 'Togo', en: 'Togo', det: 'le', currency: 'XOF' },
    { code: 'TN', fr: 'Tunisie', en: 'Tunisia', det: 'la', currency: 'TND' },
    { code: 'UG', fr: 'Ouganda', en: 'Uganda', det: "l'", currency: 'UGX' },
    { code: 'ZM', fr: 'Zambie', en: 'Zambia', det: 'la', currency: 'ZMW' },
    { code: 'ZW', fr: 'Zimbabwe', en: 'Zimbabwe', det: 'le', currency: 'ZWG' }
  ];
  /* Pays proposés en premier dans le sélecteur (les autres suivent, par ordre alphabétique). Cet ordre est une commodité d'affichage : il n'exprime aucune priorité commerciale. */
  /* det : article français du pays (« le », « la », « l' », « les », ou rien) pour écrire « pour le Bénin », « pour la Côte d'Ivoire », « pour Djibouti » correctement. */
  const FEATURED = ['BJ', 'BF', 'CM', 'CI', 'GH', 'KE', 'MA', 'NG', 'SN', 'ZA', 'TG'];
  return { COUNTRIES, FEATURED };
});
