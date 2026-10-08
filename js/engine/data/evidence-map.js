/* CARTE DES PREUVES : référentiel DOCUMENTAIRE « indicateur → actif → niveau de preuve → source ».
   Ce fichier n'a AUCUN effet sur le moteur : aucune couche (décision, priorités, accompagnement, routine, produits) ne le lit, et aucun score, seuil, priorité ou règle d'actif
   n'en dépend. Il sert à dire d'où vient chaque lien, honnêtement, et à ne jamais présenter une règle DERMAI comme une recommandation de Perfect Corp.

   NIVEAUX DE PREUVE (evidenceLevel) :
     explicit_perfectcorp  réservé aux passages où Perfect Corp attribue lui-même la suggestion à son analyse ou à sa logique d'appariement (« notre analyse recommande… », « suggère… » pour une peau ou une préoccupation).
                           Un conseil éditorial d'article n'est jamais explicit. Jamais déduit d'une connaissance cosmétique générale.
     perfectcorp_example   l'actif apparaît chez Perfect Corp comme EXEMPLE ou conseil éditorial (article éducatif, conseil grand public), sans que ce soit présenté comme le résultat de l'outil d'analyse.
     dermAI_inference      règle éditoriale DERMAI (data/actives.js, PREFERENCE) ; Perfect Corp n'a pas été trouvé associant cet actif à cet indicateur.
     market_only           seulement un positionnement commercial de produit ; aucune source Perfect Corp, aucune règle DERMAI.
     not_documented        aucune source Perfect Corp publique suffisamment solide n'a été trouvée.

   TYPE DE SOURCE (sourceKind) : official_blog | official_product_page | official_api | official_documentation | patent | market_source | internal_rule.
   CONSULTATION (consulted) : search_excerpt = extrait renvoyé par un moteur de recherche, page NON ouverte (perfectcorp.com est inaccessible depuis l'environnement de développement) ;
     page_read = page ouverte et lue ; none = pas de page (règle interne, ou aucune source). Un extrait de recherche reste à relire sur la page avant tout affichage public.

   CONTRÔLE DU 2026-10-08 (aucune page Perfect Corp n'a pu être ouverte : accès bloqué ; seuls des extraits de recherche ont été relus) : les lignes explicit_perfectcorp reposent toutes sur la page « vérificateur d'ingrédients »,
   seule où la suggestion est attribuée à l'analyse (acné/huile, peau sèche, anti-âge), et ont été retrouvées dans deux extraits indépendants. Rétrogradées : texture/rétinoïde (explicit → example : conseil d'article sur les comédons fermés),
   fermeté/rétinoïde (example → dermAI_inference) et fermeté/peptides et niacinamide (example → not_documented) : la citation de l'audit initial n'a pas été retrouvée. « consulted: search_excerpt » est conservé partout : un extrait n'est pas une page lue.

   LIMITES : toutes les sources Perfect Corp trouvées sont des articles de blog ou du contenu marketing. Aucune documentation d'API ni aucune sortie de l'outil d'analyse n'associe un indicateur à
   un ingrédient. L'outil de recommandation de produits de Perfect Corp apparie les résultats au catalogue configuré par la marque ou le revendeur : Perfect Corp n'a pas de catalogue universel.
   « retinoid » regroupe le rétinol et les rétinoïdes : il reste « à valider » dans DERMAI et n'est jamais recommandé automatiquement, quelle que soit la ligne ci-dessous.

   ACTIFS CANDIDATS (status: 'candidate_not_enabled') : benzoyl_peroxide, tea_tree, alpha_arbutin ont été trouvés pendant la recherche mais ne sont PAS des actifs DERMAI. Leur ajout au référentiel
   d'actifs aura des conséquences sur les mappings, les recommandations, la sécurité, les produits, les tests et les routines : il fera l'objet d'une décision séparée. Ils sont documentés ici
   pour conserver la recherche ; validateMap refuse qu'une ligne « candidate_not_enabled » porte un actif déjà actif, et qu'une ligne normale porte un actif inconnu. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode ? { actives: require('./actives.js'), skin: require('../../skin-model.js') } : { actives: E.activesData, skin: root.SkinModel };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.evidenceMap = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';

  const EVIDENCE_LEVELS = ['explicit_perfectcorp', 'perfectcorp_example', 'dermAI_inference', 'market_only', 'not_documented'];
  const SOURCE_KINDS = ['official_blog', 'official_product_page', 'official_api', 'official_documentation', 'patent', 'market_source', 'internal_rule'];
  const CONSULTED = ['search_excerpt', 'page_read', 'none'];
  const STATUSES = ['candidate_not_enabled'];                                   // absent = lien documenté sur un actif DERMAI existant
  const CANDIDATE_ACTIVES = ['benzoyl_peroxide', 'tea_tree', 'alpha_arbutin'];  // jamais utilisables par le moteur tant qu'une décision séparée ne les ajoute pas à data/actives.js

  const D = '2026-10-08';
  const PC = 'https://www.perfectcorp.com/';
  const CHECKER = PC + 'business/blog/ai-skincare/skincare-ingredient-checker-with-ai-skin-analysis';
  const DRYDEHY = PC + 'business/blog/ai-skincare/dry-vs-dehydrated-skin';
  const TEXTURE = PC + 'business/blog/ai-skincare/skin-texture';
  const GLASS = PC + 'business/blog/ai-skincare/what-is-glass-skin';
  const EYEBAGS = PC + 'consumer/blog/selfie-editing/how-to-remove-under-eye-bags-with-3-simple-tips';

  const explicit = (indicator, activeId, source, sourceUrl, notes, extra) => Object.assign({ indicator, activeId, evidenceLevel: 'explicit_perfectcorp', sourceKind: 'official_blog', source, sourceUrl, checkedAt: D, consulted: 'search_excerpt', notes }, extra || {});
  const example = (indicator, activeId, source, sourceUrl, notes) => ({ indicator, activeId, evidenceLevel: 'perfectcorp_example', sourceKind: 'official_blog', source, sourceUrl, checkedAt: D, consulted: 'search_excerpt', notes });
  const inferred = (indicator, activeId, notes) => ({ indicator, activeId, evidenceLevel: 'dermAI_inference', sourceKind: 'internal_rule', source: 'Règle éditoriale DERMAI (PREFERENCE, js/engine/data/actives.js)', sourceUrl: null, checkedAt: D, consulted: 'none', notes });
  const absent = (indicator, notes) => ({ indicator, activeId: null, evidenceLevel: 'not_documented', sourceKind: 'internal_rule', source: 'Aucune source Perfect Corp publique suffisamment solide trouvée', sourceUrl: null, checkedAt: D, consulted: 'none', notes });
  const SRCQ = q => 'Extrait de recherche, formulation relevée (' + q + '). Page non ouverte : à confirmer sur la page.';
  const notDocumented = (indicator, activeId, notes) => ({ indicator, activeId, evidenceLevel: 'not_documented', sourceKind: 'internal_rule', source: 'Aucune source Perfect Corp établie pour ce lien', sourceUrl: null, checkedAt: D, consulted: 'none', notes });
  const BLOG = 'Perfect Corp, blog : vérificateur d\'ingrédients (analyse de peau)';

  const ENTRIES = [
    // ACNÉ : un même passage associe « peau grasse ou à tendance acnéique » à ces trois actifs
    explicit('acne', 'salicylic', BLOG, CHECKER, SRCQ('peau grasse ou acnéique : It suggests ingredients like salicylic acid, benzoyl peroxide, or niacinamide to control excess oil and reduce breakouts') + ' La source ne sépare pas « grasse » et « acnéique » et parle d\'une logique d\'appariement : ne pas y lire un protocole.'),
    explicit('acne', 'niacinamide', BLOG, CHECKER, SRCQ('peau grasse ou acnéique : It suggests ingredients like salicylic acid, benzoyl peroxide, or niacinamide to control excess oil and reduce breakouts') + ' Même passage que l\'acide salicylique.'),
    explicit('acne', 'benzoyl_peroxide', BLOG, CHECKER, SRCQ('peau grasse ou acnéique : It suggests ingredients like salicylic acid, benzoyl peroxide, or niacinamide to control excess oil and reduce breakouts') + ' Actif non DERMAI : noté ici seulement, inutilisable par le moteur (décision séparée).', { status: 'candidate_not_enabled' }),
    { indicator: 'acne', activeId: 'tea_tree', evidenceLevel: 'not_documented', sourceKind: 'internal_rule', source: 'Aucune source Perfect Corp publique trouvée pour cet actif', sourceUrl: null, checkedAt: D, consulted: 'none',
      notes: 'Figurait dans la liste de départ du brief ; aucune source Perfect Corp trouvée. Actif non DERMAI : noté ici seulement.', status: 'candidate_not_enabled' },

    // HUILE : même passage que l'acné
    explicit('oiliness', 'niacinamide', BLOG, CHECKER, SRCQ('peau grasse ou acnéique : It suggests ingredients like salicylic acid, benzoyl peroxide, or niacinamide to control excess oil and reduce breakouts') + ' La partie « excess oil » est celle de cet indicateur.'),

    // HYDRATATION
    explicit('hydration', 'hyaluronic', BLOG, CHECKER, SRCQ('peau sèche : Our skin analysis recommends ingredients like hyaluronic acid, ceramides, or glycerin for hydration and moisture retention') + ' Passage écrit pour la peau sèche : le lien avec l\'indicateur hydratation est le plus proche, pas littéral. Corroboré par l\'article sunscreen-for-retinol-users-2026 (scores d\'hydratation faibles : écrans solaires aux céramides et à l\'acide hyaluronique).'),
    explicit('hydration', 'ceramides', BLOG, CHECKER, SRCQ('peau sèche : Our skin analysis recommends ingredients like hyaluronic acid, ceramides, or glycerin for hydration and moisture retention') + ' Même réserve (peau sèche). Corroboré par l\'article sunscreen-for-retinol-users-2026.'),
    explicit('hydration', 'glycerin', BLOG, CHECKER, SRCQ('peau sèche : Our skin analysis recommends ingredients like hyaluronic acid, ceramides, or glycerin for hydration and moisture retention') + ' Même réserve (peau sèche).'),
    example('hydration', 'squalane', 'Perfect Corp, blog : peau sèche et peau déshydratée', DRYDEHY, 'Le squalane est cité comme exemple d\'occlusif léger (avec le diméthicone) dans un tableau d\'ingrédients pour peau déshydratée : article éducatif, pas une recommandation de l\'analyse (abaissé de explicit à perfectcorp_example dès l\'audit). Extrait de recherche.'),

    // RIDES : le terme de la source est « rétinol », rangé sous l'actif DERMAI « retinoid »
    explicit('wrinkles', 'retinoid', BLOG, CHECKER, SRCQ('anti-âge / ridules : retinol, vitamin C, and peptides are recommended') + ' Terme de la source : rétinol, rangé sous « retinoid », qui reste à valider dans DERMAI : ce lien ne rend aucun rétinoïde recommandable.'),
    explicit('wrinkles', 'vitamin_c', BLOG, CHECKER, SRCQ('anti-âge / ridules : retinol, vitamin C, and peptides are recommended') + ' La source la lie à l\'anti-âge, pas aux taches.'),
    explicit('wrinkles', 'peptides', BLOG, CHECKER, SRCQ('anti-âge / ridules : retinol, vitamin C, and peptides are recommended') + ' « peptides » est à valider dans DERMAI.'),

    // TEXTURE : conseil éditorial d'un article, sans formulation « notre analyse recommande » : exemple, pas recommandation de l'outil
    example('texture', 'retinoid', 'Perfect Corp, blog : texture de la peau', TEXTURE, 'L\'article associe les comédons fermés (une cause de texture irrégulière) aux rétinoïdes et aux BHA. Conseil éditorial sur une cause précise, pas une recommandation de l\'outil pour l\'indicateur texture (rétrogradé d\'explicit_perfectcorp). Reste à valider dans DERMAI. Extrait de recherche.'),

    // FERMETÉ : la citation de l'audit initial (peptides, rétinol, niacinamide dans l'article sur les appareils) n'a PAS été retrouvée au contrôle du 2026-10-08 : l'extrait ne cite aucun de ces ingrédients
    inferred('firmness', 'retinoid', 'Règle DERMAI. Au contrôle du 2026-10-08, l\'article Perfect Corp sur les appareils de soin ne cite pas le rétinol dans l\'extrait retrouvé : la citation de l\'audit initial n\'est pas confirmée (rétrogradé de perfectcorp_example).'),
    notDocumented('firmness', 'peptides', 'Citation de l\'audit initial (article sur les appareils de soin) non retrouvée au contrôle du 2026-10-08 : l\'extrait ne cite pas les peptides. Aucune source Perfect Corp établie (rétrogradé de perfectcorp_example).'),
    notDocumented('firmness', 'niacinamide', 'Citation de l\'audit initial (article sur les appareils de soin) non retrouvée au contrôle du 2026-10-08 : l\'extrait ne cite pas la niacinamide. Aucune source Perfect Corp établie (rétrogradé de perfectcorp_example).'),

    // POCHES : conseil grand public
    example('eyeBag', 'caffeine', 'Perfect Corp, blog grand public : poches sous les yeux', EYEBAGS, 'Conseil général d\'un article grand public : les crèmes contour des yeux à la caféine atténuent l\'aspect gonflé, effet temporaire ; l\'article précise qu\'une crème ne supprime pas les poches. Pas le résultat de l\'outil. « caffeine » est à valider dans DERMAI. Extrait de recherche.'),

    // PORES : aucun passage Perfect Corp ne relie ces actifs aux pores
    inferred('pores', 'niacinamide', 'Un article Perfect Corp évoque des sérums à l\'acide salicylique pour la peau grasse (« glass skin »), sans parler des pores : pas de lien Perfect Corp pour cet indicateur.'),
    inferred('pores', 'salicylic', 'Même remarque : le blog « glass skin » ne relie pas l\'acide salicylique aux pores. Règle DERMAI.'),

    // ROUGEURS
    inferred('redness', 'niacinamide', 'Aucun passage Perfect Corp trouvé reliant un actif aux rougeurs.'),
    inferred('redness', 'azelaic', 'Aucun passage Perfect Corp trouvé reliant un actif aux rougeurs.'),
    inferred('redness', 'ceramides', 'Aucun passage Perfect Corp trouvé reliant un actif aux rougeurs. (Le blog « glass skin » cite la centella en exemple pour peau sensible : autre notion.)'),
    inferred('redness', 'panthenol', 'Aucun passage Perfect Corp trouvé reliant un actif aux rougeurs.'),

    // PIGMENTATION : chez Perfect Corp, la vitamine C est liée à l'anti-âge, pas aux taches
    inferred('pigmentation', 'vitamin_c', 'La source trouvée relie la vitamine C à l\'anti-âge, pas aux taches : le lien avec la pigmentation est une règle DERMAI.'),
    inferred('pigmentation', 'niacinamide', 'Aucun passage Perfect Corp trouvé pour les taches.'),
    inferred('pigmentation', 'azelaic', 'Aucun passage Perfect Corp trouvé pour les taches.'),
    inferred('pigmentation', 'aha_pha', 'Aucun passage Perfect Corp trouvé pour les taches.'),
    { indicator: 'pigmentation', activeId: 'alpha_arbutin', evidenceLevel: 'market_only', sourceKind: 'market_source', source: 'Fiche revendeur (Dr. Nutrition, Nigeria) : positionnement du produit The Ordinary Alpha Arbutin 2% + HA',
      sourceUrl: 'https://drnutrition.com/en-ng/the-ordinary-alpha-arbutin-2-ha-serum-30-ml', checkedAt: D, consulted: 'search_excerpt',
      notes: 'Positionnement commercial seulement (teint inégal, taches). Aucune source Perfect Corp. Actif non DERMAI : noté ici seulement, inutilisable par le moteur (décision séparée).', status: 'candidate_not_enabled' },

    // ÉCLAT
    inferred('radiance', 'vitamin_c', 'Aucun passage Perfect Corp trouvé pour l\'éclat.'),
    inferred('radiance', 'aha_pha', 'Aucun passage Perfect Corp trouvé pour l\'éclat.'),

    // INDICATEURS SANS SOURCE PERFECT CORP SOLIDE
    absent('darkCircle', 'Aucune source Perfect Corp publique suffisamment solide trouvée.'),
    absent('tearTrough', 'Aucune source Perfect Corp publique trouvée.'),
    absent('droopyUpperEyelid', 'Aucune source Perfect Corp publique trouvée.'),
    absent('droopyLowerEyelid', 'Aucune source Perfect Corp publique trouvée.')
  ];

  /* ---------- Validation ---------- */
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const hostOf = u => { try { const x = new URL(u); return x.protocol === 'https:' && u.length <= 500 ? x.hostname.toLowerCase() : null; } catch (e) { return null; } };
  const isPerfectCorp = u => { const h = hostOf(u); return !!h && (h === 'perfectcorp.com' || h.endsWith('.perfectcorp.com')); };
  const KNOWN = () => new Set(dep.actives.ACTIVES.map(a => a.id));

  /* Renvoie la liste des erreurs d'une ligne (vide = valide). */
  function validateEntry(x) {
    const e = [];
    if (!x || typeof x !== 'object') return ['ligne absente'];
    const known = KNOWN();
    if (!dep.skin.METRIC_KEYS.includes(x.indicator)) e.push('indicateur inconnu');
    if (!EVIDENCE_LEVELS.includes(x.evidenceLevel)) e.push('evidenceLevel invalide');
    if (!SOURCE_KINDS.includes(x.sourceKind)) e.push('sourceKind invalide');
    if (!CONSULTED.includes(x.consulted)) e.push('consulted invalide');
    if (x.status != null && !STATUSES.includes(x.status)) e.push('status invalide');
    if (!text(x.source, 200)) e.push('source manquante');
    if (!text(x.notes, 500)) e.push('notes manquantes');
    if (!isDate(x.checkedAt)) e.push('date de consultation invalide (AAAA-MM-JJ)');
    if (x.sourceUrl != null && !hostOf(x.sourceUrl)) e.push('sourceUrl : lien https attendu');
    if (x.activeId != null && !text(x.activeId, 40)) e.push('activeId invalide');
    // l'actif : un actif DERMAI existant, ou (ligne candidate) un actif candidat qui n'est PAS un actif DERMAI
    if (x.status === 'candidate_not_enabled') {
      if (!CANDIDATE_ACTIVES.includes(x.activeId)) e.push('candidate_not_enabled : actif candidat connu attendu');
      if (known.has(x.activeId)) e.push('candidate_not_enabled : cet actif est déjà un actif DERMAI');
    } else if (x.activeId == null) {
      if (x.evidenceLevel !== 'not_documented') e.push('activeId absent : seul not_documented est permis');
    } else if (!known.has(x.activeId)) e.push('actif inconnu de DERMAI : ' + x.activeId + ' (un actif non DERMAI doit être candidate_not_enabled)');
    // cohérence niveau ↔ type de source ↔ lien
    const lvl = x.evidenceLevel;
    if (lvl === 'explicit_perfectcorp' || lvl === 'perfectcorp_example') {
      if (!['official_blog', 'official_product_page', 'official_api', 'official_documentation', 'patent'].includes(x.sourceKind)) e.push(lvl + ' exige une source Perfect Corp officielle');
      if (!isPerfectCorp(x.sourceUrl) && !(x.sourceKind === 'patent' && hostOf(x.sourceUrl))) e.push(lvl + ' exige un lien perfectcorp.com');
      if (x.consulted === 'none') e.push(lvl + ' exige une consultation réelle de la source');
    }
    if (lvl === 'dermAI_inference' && (x.sourceKind !== 'internal_rule' || x.sourceUrl != null)) e.push('dermAI_inference : règle interne, sans lien externe');
    if (lvl === 'market_only' && (x.sourceKind !== 'market_source' || !hostOf(x.sourceUrl))) e.push('market_only : source marché avec lien https');
    if (lvl === 'not_documented' && (x.sourceKind !== 'internal_rule' || x.sourceUrl != null)) e.push('not_documented : aucune source, aucun lien');
    // une ligne ne porte ni score, ni poids, ni rang : elle n'entre dans aucune décision
    for (const k of Object.keys(x)) if (/^(score|weight|priority|rank|percent|pourcent|match|compat)/i.test(k)) e.push('champ interdit : ' + k);
    return e;
  }
  function validateMap(list) {
    const errors = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach((x, i) => {
      const label = x && x.indicator ? x.indicator + '/' + (x.activeId || '-') : '#' + i;
      for (const m of validateEntry(x)) errors.push(label + ' : ' + m);
      if (x) { const k = x.indicator + '|' + x.activeId; if (seen.has(k)) errors.push(label + ' : ligne en double'); seen.add(k); }
    });
    return errors;
  }

  const forIndicator = (indicator, list) => (list || ENTRIES).filter(x => x.indicator === indicator);
  const forActive = (activeId, list) => (list || ENTRIES).filter(x => x.activeId === activeId);

  return { EVIDENCE_LEVELS, SOURCE_KINDS, CONSULTED, STATUSES, CANDIDATE_ACTIVES, ENTRIES, validateEntry, validateMap, forIndicator, forActive };
});
