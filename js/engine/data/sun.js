/* Protection solaire : textes, critères de choix et modèle d'un produit solaire. Données et textes seulement, aucune décision du moteur.

   RÈGLES (décidées avec le propriétaire du produit)
   - La protection solaire est nécessaire à TOUTES les peaux, y compris les peaux foncées. Règle à dire clairement : « le soleil fonce les marques » (taches laissées par un bouton,
     cicatrices : les UV les rendent plus foncées et plus longues à partir).
   - Dans les recommandations, on PRIVILÉGIE les protections solaires dont le fabricant dit qu'elles ne laissent pas de trace blanche. C'est un ordre de préférence, jamais un
     score ni une promesse : la mention vient du fabricant (citée, avec sa source), DermAI ne l'a pas mesurée.
   - Aucun produit solaire n'est recommandé tant qu'il est « à vérifier » : lien fabricant, liste d'ingrédients lisible (INCI), mention de trace blanche, disponibilité au Bénin ou en
     Afrique de l'Ouest francophone (sinon, le dire). Un produit sans liste d'ingrédients lisible est « composition non vérifiable » (data/prevention.js).
   - En attendant des produits validés, les CRITÈRES généraux ci-dessous aident à choisir. Ton cosmétique, aucun diagnostic, aucune promesse.
   Module partagé navigateur / Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.sunData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILTER_TYPES = ['chemical', 'mineral', 'hybrid', 'unknown'];
  const MIN_SPF = 30;

  const TEXT = {
    title: 'Protection solaire : pour toutes les peaux',
    rule: 'Même une peau foncée a besoin d\'une protection solaire. Elle prend moins facilement les coups de soleil, mais le soleil fonce les marques : une tache laissée par un bouton ou une cicatrice devient plus foncée et met plus longtemps à partir.',
    criteriaTitle: 'Bien choisir sa protection solaire',
    criteria: [
      'Indice 30 au minimum, de préférence 50, avec une protection contre les UVA et les UVB (large spectre).',
      'Une texture sans trace blanche : fluide, gel-crème ou crème teintée. Les filtres minéraux (oxyde de zinc, dioxyde de titane) laissent souvent un voile blanc sur peau foncée, sauf s\'ils sont teintés. Cherchez la mention « sans trace blanche » et essayez-la sur la mâchoire avant d\'acheter.',
      'Une liste d\'ingrédients lisible sur l\'emballage. Sans liste, la composition n\'est pas vérifiable : DermAI ne la recommande pas.',
      'À appliquer chaque matin, même par temps couvert, et à renouveler toutes les deux heures si vous restez au soleil.',
      'Elle ne remplace pas l\'ombre, le chapeau et les vêtements couvrants.'
    ],
    selection: 'DermAI privilégie les protections solaires dont le fabricant indique qu\'elles ne laissent pas de trace blanche. Cette mention vient du fabricant : DermAI ne l\'a pas mesurée.',
    none: 'Aucune protection solaire du catalogue DermAI n\'est encore vérifiée (lien fabricant, liste d\'ingrédients, disponibilité près de chez vous). Utilisez les critères ci-dessus avec ce qui est vendu près de chez vous.'
  };

  /* Indice affiché (« 50+ » ou « 30 ») : nombre entier ou null. */
  const spfNumber = v => { const m = /^(\d{1,3})\+?$/.exec(String(v == null ? '' : v).trim()); return m ? Number(m[1]) : null; };

  /* Modèle `sun` d'un produit solaire : { spf, filters, noWhiteCast: { claimed, quote, source } }. Renvoie la liste des erreurs. */
  function validate(p) {
    const e = [];
    if (!p || p.category !== 'spf' || p.demo === true) return e;
    const s = p.sun;
    if (!s || typeof s !== 'object') return ['produit solaire : champ « sun » obligatoire (indice, type de filtres, mention de trace blanche)'];
    if (spfNumber(s.spf) === null) e.push('produit solaire : indice invalide (« 50 » ou « 50+ »)');
    if (!FILTER_TYPES.includes(s.filters)) e.push('produit solaire : type de filtres invalide (chemical, mineral, hybrid ou unknown)');
    const w = s.noWhiteCast;
    if (!w || typeof w.claimed !== 'boolean') e.push('produit solaire : noWhiteCast.claimed doit être un booléen');
    else if (w.claimed && !(typeof w.quote === 'string' && w.quote.trim() && typeof w.source === 'string' && w.source.trim())) e.push('produit solaire : une mention « sans trace blanche » exige sa citation et sa source');
    return e;
  }
  const hasInci = p => Array.isArray(p && p.inci) && p.inci.some(x => typeof x === 'string' && x.trim().length > 0);
  /* Produit solaire recommandable : indice 30 ou plus et liste INCI lisible. (Le statut « à vérifier » l'écarte déjà en amont : products.js, usable.) */
  const isSunOk = p => !!(p && p.sun && (spfNumber(p.sun.spf) || 0) >= MIN_SPF && hasInci(p));
  /* Préférence : le fabricant dit « sans trace blanche ». */
  const claimsNoWhiteCast = p => !!(p && p.sun && p.sun.noWhiteCast && p.sun.noWhiteCast.claimed === true);

  return { FILTER_TYPES, MIN_SPF, TEXT, spfNumber, validate, hasInci, isSunOk, claimsNoWhiteCast };
});
