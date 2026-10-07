/* Pays d'achat de l'utilisatrice : où elle souhaite acheter ses produits. C'est une PRÉFÉRENCE D'AFFICHAGE, pas une donnée d'analyse.
   - Choisi volontairement dans une liste : jamais de géolocalisation, jamais d'adresse IP, jamais de position précise.
   - Conservé UNIQUEMENT dans ce navigateur (localStorage, clé `dermai.market`), jamais envoyé : ni à Supabase, ni à Perfect Corp, ni dans une analyse (`goals_snapshot`...).
     Raison : le profil Supabase ne contient que des préférences de personnalisation de la routine ; le pays d'achat ne personnalise rien, il sert seulement à classer les
     offres. Aucune table, aucune colonne, aucune migration.
   - Il n'est lu que par l'affichage des offres (page Produits, fiche produit) : le moteur cosmétique (priorités, actifs, routine, choix des produits) ne le reçoit jamais.
   Module partagé navigateur / Node (stockage injecté : testable sans navigateur). */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const data = isNode ? require('./engine/data/markets.js') : (root.DermaiEngine || {}).marketsData;
  const api = factory(data);
  if (isNode) module.exports = api; else root.DermaiMarket = api;
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';
  const KEY = 'dermai.market';
  const COUNTRIES = data.COUNTRIES;
  const byCode = code => COUNTRIES.find(c => c.code === code) || null;
  const isCountry = code => typeof code === 'string' && !!byCode(code);
  const byFr = (a, b) => a.fr.localeCompare(b.fr, 'fr');
  /* Liste pour le sélecteur : pays courants (ordre fixe), puis tous les autres pays d'Afrique par ordre alphabétique. */
  function choices() {
    const featured = data.FEATURED.map(byCode).filter(Boolean);
    const others = COUNTRIES.filter(c => !data.FEATURED.includes(c.code)).sort(byFr);
    return { featured, others };
  }
  /* « FCFA (XOF) » pour les francs CFA, sinon le code ISO : la devise est celle du pays, jamais convertie. */
  const currencyLabel = cur => (cur === 'XOF' || cur === 'XAF') ? 'FCFA (' + cur + ')' : String(cur || '');
  /* « pour le Bénin », « pour la Côte d'Ivoire », « pour l'Algérie », « pour Djibouti » */
  const pour = code => { const c = byCode(code); return c ? 'pour ' + (c.det ? (c.det === "l'" ? c.det : c.det + ' ') : '') + c.fr : ''; };
  function read(storage) {
    try { const v = storage && storage.getItem(KEY); return isCountry(v) ? v : null; } catch (e) { return null; }
  }
  /* Enregistre (code valide) ou efface (null). Renvoie vrai si le navigateur a accepté. */
  function write(storage, code) {
    try {
      if (!storage) return false;
      if (code == null) { storage.removeItem(KEY); return true; }
      if (!isCountry(code)) return false;
      storage.setItem(KEY, code); return true;
    } catch (e) { return false; }
  }
  return { KEY, COUNTRIES, FEATURED: data.FEATURED, byCode, isCountry, choices, currencyLabel, pour, read, write };
});
