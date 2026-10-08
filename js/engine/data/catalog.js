/* CATALOGUE RÉEL de produits DERMAI (Afrique entière). Mode réel : seuls les produits listés ICI peuvent apparaître. Aucun produit de démonstration
   (data/products.js) n'est jamais montré en mode réel.

   PRINCIPE : UN produit → PLUSIEURS offres → plusieurs pays → prix locaux (devise du pays, jamais convertie) → disponibilité locale. Aucun prix ni aucune
   disponibilité global(e) ; rien n'est déduit d'un pays à l'autre ; aucun pays par défaut. Une offre sans source, sans date ou sans devise (si prix) est refusée.

   Ajouter un produit = une entrée ci-dessous, avec uniquement des informations vérifiées (un test valide chaque entrée : validateProduct) :
     { id, name, brand, format: '30 ml' | null, category: 'cleanser' | 'serum' | 'moisturizer' | 'spf',
       ingredients: [{ activeId: 'niacinamide' | … | null, label }],     // activeId = actif DERMAI EXISTANT uniquement ; null pour tout autre ingrédient (jamais de nouvel actif)
       primaryActiveId, skinTypes: ['all'], skinTypesDocumented: true | false,   // « all » = aucune restriction de classement ; n'est AFFICHÉ que si documenté
       targets, description, active, demo: false,
       status: 'validated' | 'to_verify',   // validated exige : format, INCI complet, source fabricant, actif relié. to_verify : active:false + verification.missing
       inci: [ … ] | null, inciNote, sources: [{ kind: 'manufacturer'|'retailer'|…, label, url, checkedAt, method }], verification: { missing: [ … ] },
       offers: [ { market: 'NG', retailer: '…', type: 'brand_site'|'retailer'|'pharmacy'|'marketplace'|'importer', currency: 'NGN', price: 12500 | null,
                   availability: 'in_stock'|'out_of_stock'|'coming_soon'|'unknown', url: 'https://…' | null, shipping: 'local'|'international'|null,
                   servesMarkets: ['BJ', …] | absent,   // pays que le VENDEUR déclare desservir (offre « régionale » pour ces pays) ; jamais déduit d'une devise ; absent = inconnu
                   source: '…', checkedAt: 'AAAA-MM-JJ' } ],
       image: { src: 'img/products/….jpg', alt: '…' } | null }
   marketChecks (facultatif) : [ { market: 'BJ', status: 'searched_found' | 'searched_none', checkedAt: 'AAAA-MM-JJ', method: '…', note: '…' } ] — trace d'une recherche de disponibilité EXPLICITE dans un pays.
   searched_none = une recherche a été faite et n'a trouvé aucune offre fiable (le statut UNAVAILABLE ne s'obtient que comme cela, jamais par simple absence d'offre ici) ; searched_found exige une offre
   valide du même pays. Sans recherche : statut UNKNOWN. Aucune recherche n'est enregistrée à ce jour : les pistes web (Côte d'Ivoire, Nigeria, Ghana...) ne sont pas des vérifications. Aucun effet sur le choix des produits.
   Une annonce de place de marché est une offre de type « marketplace » : ce n'est pas une preuve d'authenticité ni de distribution officielle.
   editorialPriority (facultatif) : { activeId: rang } — décision éditoriale DERMAI entre produits compatibles avec le MÊME actif (1 = d'abord). Renseigné seulement là où plusieurs produits concourent
   réellement pour un même pas de routine : vitamin_c (Ascorbyl Glucoside 1, CeraVe Skin Renewing 2) et salicylic (Salicylic Acid 2 % 1, La Roche-Posay Pure Vitamin C10 2). C'est l'ordre éditorial
   ACTUEL, pas un jugement de valeur : il ne dit rien de l'efficacité, du prix ni de la marque. Sans priorité explicite, les produits suivent l'ordre du catalogue, après ceux qui en ont une.
   Aucun champ de score ou de « correspondance ». Les champs commerciaux plats (price, vendor, url, availability) sont interdits ici : tout passe par `offers`.
   Le rétinoïde reste « à valider » : un produit qui en contient n'est jamais recommandé automatiquement.

   IMAGES : seul un visuel dont la provenance est connue est ajouté (fichier du projet dans img/products/, page d'origine, date, crédit à la marque), tiré de la page
   fabricant du produit ; sinon `image: null` et l'interface affiche « Image à venir ». Visuels recadrés en carré (fond transparent) et convertis en WebP.

   OFFRES (2026-10-07, étape 16) : prix, vendeur, disponibilité et lien viennent de relevés faits sur les pages marchandes (Jumia, Konga, Swanky Beauty Supply, Care to Beauty) et fournis à
   DERMAI ; `checkedAt` est la date d'intégration. Ces pages n'ont PAS pu être rouvertes depuis l'environnement d'intégration (réseau bloqué) : chaque offre reste un instantané commercial
   (prix et stock changent), à revérifier avant tout lancement public. Aucun prix n'est converti ; le prix barré d'une annonce n'est jamais le prix actuel. Un statut « in_stock » n'est posé
   que si la page affiche un stock ; sinon « unknown ». « Few units left » s'écrit en note de stock (stockNote), sans nouveau statut.
   ÉTAT (2026-10-06) : les pages fabricant de The Ordinary (6 produits), CeraVe Afrique (Blemish Control Gel) et La Roche-Posay Afrique (Cicaplast, Pure
   Vitamin C10) ont été ouvertes et lues directement ; les autres produits reposent encore sur des recherches web ciblées (méthode indiquée dans chaque source).
   Revendeurs : la page Dermastore (Afrique du Sud) a été ouverte et lue (prix, stock, format). Le lien BuyBetter (Nigeria) cité par la page CeraVe Afrique renvoie une
   erreur 404 et le produit est absent de sa page marque : aucune offre n'est donc enregistrée pour le Nigeria. Les produits « to_verify » sont conservés pour mémoire (jamais affichés) avec ce qui manque. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.catalogData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const D = '2026-10-06';
  const D2 = '2026-10-07';   // date d'intégration des offres ci-dessous (étape 16)
  const M = 'Recherche web ciblée sur le domaine du fabricant (résumé de la fiche ; page non ouverte directement, accès réseau bloqué)';
  const MD = 'Page fabricant ouverte directement (téléchargement HTTP) et lue le jour du relevé';
  const src = (label, url, kind) => ({ kind: kind || 'manufacturer', label, url, checkedAt: D, method: M });
  const direct = (label, url) => ({ kind: 'manufacturer', label, url, checkedAt: D, method: MD });
  const MF = 'Fiche fabricant relevée par l\'équipe DERMAI et fournie au projet ; page non rouverte depuis l\'environnement d\'intégration (réseau bloqué)';
  const fournie = (label, url) => ({ kind: 'manufacturer', label, url, checkedAt: D2, method: MF });
  const TO = 'The Ordinary';

  const PRODUCTS = [
    { id: 'to-salicylic-2-solution', name: 'Salicylic Acid 2% Solution', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'salicylic', label: 'Acide salicylique 2 %' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'salicylic', editorialPriority: { salicylic: 1 },
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['acne'],
      description: 'Solution aqueuse à 2 % d\'acide salicylique, présentée par la marque pour les peaux sujettes aux imperfections. Formule en solution aqueuse : à ne pas confondre avec la version anhydre.',
      active: true, demo: false, status: 'validated',
      inci: ['Salicylic Acid 2%', 'Water', 'Chlorphenesin', 'Citric Acid', 'Glycerin', 'Isoceteth-20', 'Pentylene Glycol', 'Phenoxyethanol', 'Saccharide Isomerate', 'Sodium Citrate', 'Sodium Hydroxide', 'Xanthan Gum'],
      inciNote: 'La fiche fabricant liste l\'actif (acide salicylique 2 %) puis les ingrédients inactifs, dans cet ordre.',
      sources: [direct('The Ordinary : Salicylic Acid 2% Solution (30 ml)', 'https://theordinary.com/en-us/salicylic-acid-2-solution-acne-control-100098.html')],
      offers: [
        { market: 'NG', retailer: 'Konga', seller: 'SebuFTech Ventures', type: 'marketplace', currency: 'NGN', price: 9500, availability: 'unknown', stockNote: 'Achat proposé sur la fiche, sous réserve de disponibilité locale', url: 'https://www.konga.com/product/the-ordinary-salicylic-acid-2-solution-30ml-4559112', shipping: null, source: 'Konga : fiche produit', checkedAt: D2 }
      ], image: { src: 'img/products/to-salicylic-2-solution.webp', alt: 'Flacon The Ordinary Salicylic Acid 2% Solution', sourceUrl: 'https://theordinary.com/en-us/salicylic-acid-2-solution-acne-control-100098.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'to-niacinamide-10-zinc-1', name: 'Niacinamide 10% + Zinc 1%', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide 10 %' }, { activeId: null, label: 'Zinc PCA 1 %' }], primaryActiveId: 'niacinamide',
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['oiliness', 'pores'],
      description: 'Sérum aqueux à 10 % de niacinamide et 1 % de zinc, présenté par la marque pour l\'excès de sébum et l\'aspect des pores.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua (Water)', 'Niacinamide', 'Pentylene Glycol', 'Zinc PCA', 'Dimethyl Isosorbide', 'Tamarindus Indica Seed Gum', 'Xanthan Gum', 'Isoceteth-20', 'Ethoxydiglycol', 'Phenoxyethanol', 'Chlorphenesin'],
      inciNote: 'La fiche fabricant inclut Dimethyl Isosorbide (une liste tierce plus ancienne ne l\'incluait pas : la fiche officielle fait foi). La marque précise que la liste peut varier selon la date et la région d\'achat : vérifiez l\'emballage.',
      sources: [direct('The Ordinary : Niacinamide 10% + Zinc 1% (Oil Control Serum)', 'https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html')],
      offers: [
        { market: 'GH', retailer: 'Jumia Ghana', type: 'marketplace', currency: 'GHS', price: 200, availability: 'in_stock', stockNote: 'Peu d\'unités restantes', url: 'https://www.jumia.com.gh/the-ordinary-niacinamide-10-zinc-1-30ml-300877098.html', shipping: null, source: 'Jumia Ghana : fiche produit', checkedAt: D2 },
        { market: 'NG', retailer: 'Konga', seller: 'SebuFTech Ventures', type: 'marketplace', currency: 'NGN', price: 9990, availability: 'unknown', stockNote: 'Achat proposé sur la fiche, sous réserve de disponibilité locale', url: 'https://www.konga.com/product/the-ordinary-niacinamide-10-zinc-1-30ml-4559110', shipping: null, source: 'Konga : fiche produit', checkedAt: D2 }
      ], image: { src: 'img/products/to-niacinamide-10-zinc-1.webp', alt: 'Flacon The Ordinary Niacinamide 10% + Zinc 1%', sourceUrl: 'https://theordinary.com/en-us/niacinamide-10-zinc-1-serum-100436.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'to-azelaic-acid-10', name: 'Azelaic Acid Suspension 10%', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'azelaic', label: 'Acide azélaïque 10 %' }], primaryActiveId: 'azelaic',
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['acne', 'pigmentation'],
      description: 'Suspension de texture crème à 10 % d\'acide azélaïque, présentée par la marque pour le teint, la texture et l\'aspect des imperfections. Protection solaire conseillée le jour.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua (Water)', 'Isodecyl Neopentanoate', 'Dimethicone', 'Azelaic Acid', 'Dimethicone/Bis-Isobutyl PPG-20 Crosspolymer', 'Dimethyl Isosorbide', 'Hydroxyethyl Acrylate/Sodium Acryloyldimethyl Taurate Copolymer', 'Polysilicone-11', 'Isohexadecane', 'Tocopherol', 'Trisodium Ethylenediamine Disuccinate', 'Isoceteth-20', 'Polysorbate 60', 'Triethanolamine', 'Ethoxydiglycol', 'Phenoxyethanol', 'Chlorphenesin'],
      sources: [direct('The Ordinary : Azelaic Acid Suspension 10% (30 ml)', 'https://theordinary.com/en-us/azelaic-acid-suspension-10-exfoliator-100407.html')],
      offers: [
        { market: 'NG', retailer: 'Konga', seller: 'Posh Gallery', type: 'marketplace', currency: 'NGN', price: 22000, availability: 'unknown', stockNote: 'Achat proposé sur la fiche, sous réserve de disponibilité locale', url: 'https://www.konga.com/product/the-ordinary-azelaic-acid-suspension-10-6852441', shipping: null, source: 'Konga : fiche produit', checkedAt: D2 }
      ], image: { src: 'img/products/to-azelaic-acid-10.webp', alt: 'Tube The Ordinary Azelaic Acid Suspension 10%', sourceUrl: 'https://theordinary.com/en-us/azelaic-acid-suspension-10-exfoliator-100407.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'to-ascorbyl-glucoside-12', name: 'Ascorbyl Glucoside Solution 12%', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'vitamin_c', label: 'Ascorbyl glucoside 12 % (dérivé de vitamine C)' }], primaryActiveId: 'vitamin_c', editorialPriority: { vitamin_c: 1 },
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['pigmentation', 'radiance'],
      description: 'Solution aqueuse à 12 % d\'ascorbyl glucoside, un dérivé hydrosoluble de la vitamine C qui s\'y convertit sur la peau selon la marque. Protection solaire conseillée le jour.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua (Water)', 'Ascorbyl Glucoside', 'Propanediol', 'Aminomethyl Propanol', 'Triethanolamine', 'Isoceteth-20', 'Xanthan Gum', 'Dimethyl Isosorbide', 'Ethoxydiglycol', 'Trisodium Ethylenediamine Disuccinate', '1,2-Hexanediol', 'Caprylyl Glycol'],
      inciNote: 'Dérivé de vitamine C (pas de l\'acide ascorbique pur) : rattaché à l\'actif DERMAI « Vitamine C » sans prétendre à la même puissance.',
      sources: [direct('The Ordinary : Ascorbyl Glucoside Solution 12% (30 ml)', 'https://theordinary.com/en-us/ascorbyl-glucoside-solution-12-vitamin-c-100405.html')],
      offers: [
        { market: 'NG', retailer: 'Konga', seller: 'smile time', type: 'marketplace', currency: 'NGN', price: 10000, availability: 'unknown', stockNote: 'Achat proposé sur la fiche, sous réserve de disponibilité locale', url: 'https://www.konga.com/product/the-ordinary-ascorbyl-glucoside-solution-12-30ml-6447242', shipping: null, source: 'Konga : fiche produit', checkedAt: D2 },
        { market: 'KE', retailer: 'Jumia Kenya', type: 'marketplace', currency: 'KES', price: 1699, availability: 'in_stock', stockNote: '5 unités restantes', url: 'https://www.jumia.co.ke/ascorbyl-glucoside-solution-12-vitamin-c-serum-water-based-antioxidant-face-serum-for-uneven-skin-tone-dullness-skin-smoothness-vegan-30ml-the-ordinary-mpg10747273.html', shipping: null, source: 'Jumia Kenya : fiche produit', checkedAt: D2 }
      ], image: { src: 'img/products/to-ascorbyl-glucoside-12.webp', alt: 'Flacon The Ordinary Ascorbyl Glucoside Solution 12%', sourceUrl: 'https://theordinary.com/en-us/ascorbyl-glucoside-solution-12-vitamin-c-100405.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'to-mandelic-acid-10-ha', name: 'Mandelic Acid 10% + HA', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'aha_pha', label: 'Acide mandélique 10 % (AHA)' }, { activeId: 'hyaluronic', label: 'Hyaluronate de sodium (crosspolymère)' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'aha_pha',
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['texture', 'radiance', 'pigmentation'],
      description: 'Sérum aqueux à 10 % d\'acide mandélique (AHA), présenté par la marque pour la texture et l\'uniformité du teint. Exfoliant : à éviter sur peau sensible, qui pèle ou abîmée, selon la marque.',
      active: true, demo: false, status: 'validated',
      inci: ['Propanediol', 'Aqua (Water)', 'Mandelic Acid', 'Glycerin', 'Dimethyl Isosorbide', 'Sodium Hyaluronate Crosspolymer', 'Tasmannia Lanceolata Fruit/Leaf Extract', 'Pentylene Glycol', 'Polysorbate 20', 'Sodium Hydroxide', 'Ethylhexylglycerin', '1,2-Hexanediol', 'Caprylyl Glycol'],
      inciNote: 'Rattaché à l\'actif DERMAI existant « Exfoliants chimiques AHA ou PHA » : aucun actif « mandélique » n\'est créé.',
      sources: [direct('The Ordinary : Mandelic Acid 10% + HA (30 ml)', 'https://theordinary.com/en-us/mandelic-acid-10-ha-exfoliator-100429.html')],
      offers: [
        { market: 'GH', retailer: 'Swanky Beauty Supply', city: 'Accra', type: 'retailer', currency: 'GHS', price: 220, availability: 'unknown', stockNote: 'Retrait en boutique proposé ; stock non affiché', url: 'https://www.swankybeautygh.com/products/the-ordinary-mandelic-acid-10-ha', shipping: null, source: 'Swanky Beauty Supply Ghana : fiche produit', checkedAt: D2 },
        { market: 'KE', retailer: 'Jumia Kenya', type: 'marketplace', currency: 'KES', price: 3800, availability: 'in_stock', stockNote: 'Peu d\'unités restantes', url: 'https://www.jumia.co.ke/the-ordinary-mandelic-acid-10-ha-328723982.html', shipping: null, source: 'Jumia Kenya : fiche produit', checkedAt: D2 }
      ], image: { src: 'img/products/to-mandelic-acid-10-ha.webp', alt: 'Flacon The Ordinary Mandelic Acid 10% + HA', sourceUrl: 'https://theordinary.com/en-us/mandelic-acid-10-ha-exfoliator-100429.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'to-hyaluronic-b5-ceramides', name: 'Hyaluronic Acid 2% + B5 (with Ceramides)', brand: TO, format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'hyaluronic', label: 'Acide hyaluronique (5 formes)' }, { activeId: 'panthenol', label: 'Pro-vitamine B5 (panthénol)' }, { activeId: 'ceramides', label: 'Céramides (selon la marque ; phospholipides et sphingolipides dans l\'INCI)' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'hyaluronic',
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['hydration'],
      description: 'Sérum d\'hydratation à l\'acide hyaluronique (5 formes), à la pro-vitamine B5 et aux céramides : formule actuelle de la marque, distincte de l\'ancienne formule « Original Formulation ».',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua (Water)', 'Sodium Hyaluronate', 'Propanediol', 'Pentylene Glycol', 'Hydrolyzed Hyaluronic Acid', 'Sodium Hyaluronate Crosspolymer', 'Phospholipids', 'Sphingolipids', 'Panthenol', 'Ahnfeltiopsis Concinna Extract', 'Glycerin', 'Polysorbate 20', 'Citric Acid', 'Sodium Citrate', 'p-Anisic Acid', 'Tocopherol', 'Trisodium Ethylenediamine Disuccinate', 'Caprylyl Glycol', 'Ethoxydiglycol', 'Ethylhexylglycerin', 'Hexylene Glycol', 'Phenoxyethanol', 'Chlorphenesin'],
      inciNote: 'Formule actuelle « with Ceramides » uniquement : l\'ancienne formule « Original Formulation » est un autre produit et n\'est pas mélangée ici. L\'INCI ne nomme pas de « ceramide » : la marque présente les phospholipides et sphingolipides comme ses céramides.',
      sources: [direct('The Ordinary : Hyaluronic Acid 2% + B5 (with Ceramides), 30 ml et 60 ml', 'https://theordinary.com/en-us/hyaluronic-acid-2-b5-serum-with-ceramides-100637.html')],
      offers: [], image: { src: 'img/products/to-hyaluronic-b5-ceramides.webp', alt: 'Flacon The Ordinary Hyaluronic Acid 2% + B5 (with Ceramides)', sourceUrl: 'https://theordinary.com/en-us/hyaluronic-acid-2-b5-serum-with-ceramides-100637.html', checkedAt: D, credit: 'Visuel : The Ordinary' } },

    { id: 'cerave-hydrating-ha-serum', name: 'Hydrating Hyaluronic Acid Serum', brand: 'CeraVe', format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'hyaluronic', label: 'Hyaluronate de sodium' }, { activeId: 'panthenol', label: 'Panthénol' }, { activeId: 'ceramides', label: 'Céramides NP, AP, EOP' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'hyaluronic',
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['hydration'],
      description: 'Sérum hydratant à l\'acide hyaluronique, au panthénol et à trois céramides, présenté par la marque pour l\'hydratation et le soutien de la barrière cutanée.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua / Water', 'Glycerin', 'Cetearyl Ethylhexanoate', 'Dimethicone', 'Ammonium Polyacryloyldimethyl Taurate', 'Sodium Hyaluronate', 'Panthenol', 'Ceramide NP', 'Ceramide AP', 'Ceramide EOP', 'Carbomer', 'Cetearyl Alcohol', 'Behentrimonium Methosulfate', 'Sodium Hydroxide', 'Sodium Lauroyl Lactylate', 'Cholesterol', 'Phenoxyethanol', 'Disodium EDTA', 'Isopropyl Myristate', 'Caprylyl Glycol', 'Citric Acid', 'Xanthan Gum', 'Phytosphingosine', 'Ethylhexylglycerin'],
      inciNote: 'Liste relevée pour la version des sites cerave.com et cerave.co.uk ; la formule vendue dans un pays donné peut différer.',
      sources: [src('CeraVe : Hydrating Hyaluronic Acid Serum', 'https://www.cerave.com/skincare/facial-serums/hydrating-hyaluronic-acid-serum'), src('CeraVe UK : Hydrating Hyaluronic Acid Face Serum', 'https://www.cerave.co.uk/skincare/moisturisers/hydrating-hyaluronic-acid-serum')],
      offers: [
        { market: 'NG', retailer: 'Jumia Nigeria', seller: 'Annette Trudan', type: 'marketplace', currency: 'NGN', price: 4150, availability: 'in_stock', url: 'https://www.jumia.com.ng/cerave-hydrating-hyaluronic-acid-serum-30ml-420211821.html', shipping: null, source: 'Jumia Nigeria : fiche produit', checkedAt: D2 }
      ], image: null },

    { id: 'cerave-blemish-control-gel', name: 'Blemish Control Gel', brand: 'CeraVe', format: '40 ml', category: 'serum',
      ingredients: [{ activeId: 'salicylic', label: 'Acide salicylique 2 %' }, { activeId: 'aha_pha', label: 'Acides glycolique et lactique (AHA)' }, { activeId: 'niacinamide', label: 'Niacinamide' }, { activeId: 'ceramides', label: 'Céramides NP, AP, EOP' }, { activeId: 'hyaluronic', label: 'Hyaluronate de sodium' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'salicylic',
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['acne', 'pores'],
      description: 'Gel ciblé pour les peaux sujettes aux imperfections : acide salicylique 2 %, acides glycolique et lactique, niacinamide et céramides. Contient plusieurs exfoliants.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua / Water', 'Glycerin', 'Sodium Hydroxide', 'Glycolic Acid', 'Lactic Acid', 'Salicylic Acid', 'Niacinamide', 'Ceramide NP', 'Ceramide AP', 'Ceramide EOP', 'Carbomer', 'Cetearyl Alcohol', 'Behentrimonium Methosulfate', 'Triethyl Citrate', 'Sodium Hyaluronate', 'Sodium Lauroyl Lactylate', 'Cholesterol', 'Chlorphenesin', 'Disodium EDTA', 'Hydroxypropyl Guar', 'Caprylyl Glycol', 'Xanthan Gum', 'Phytosphingosine', 'Benzoic Acid'],
      inciNote: 'Liste lue sur la page CeraVe Afrique (« Targeted Facial Blemish-Control Gel », format 40 ml). La version américaine « Acne Control Gel » est un autre produit.',
      sources: [direct('CeraVe Afrique : Targeted Facial Blemish-Control Gel (40 ml)', 'https://africa.cerave.com/en/our-products/moisturizers/blemish-control-gel')],
      offers: [{ market: 'ZA', retailer: 'Dermastore', type: 'retailer', currency: 'ZAR', price: 300, availability: 'in_stock', url: 'https://dermastore.co.za/cerave-blemish-control-gel/', shipping: null,
                 source: 'Page produit Dermastore ouverte directement : prix (300 ZAR), stock et format 40 ml lus sur la page ; lien cité par la page CeraVe Afrique', checkedAt: D, verifiedAt: D },
        { market: 'NG', retailer: 'Jumia Nigeria', type: 'marketplace', currency: 'NGN', price: 2999, availability: 'in_stock', url: 'https://www.jumia.com.ng/cerave-blemish-control-gel-with-ahabha-40ml-420162558.html', shipping: null, source: 'Jumia Nigeria : fiche produit', checkedAt: D2 }],
      image: { src: 'img/products/cerave-blemish-control-gel.webp', alt: 'Tube CeraVe Blemish Control Gel', sourceUrl: 'https://africa.cerave.com/en/our-products/moisturizers/blemish-control-gel', checkedAt: D, credit: 'Visuel : CeraVe' } },

    { id: 'cerave-skin-renewing-vitamin-c-serum', name: 'Skin Renewing Vitamin C Serum', brand: 'CeraVe', format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'vitamin_c', label: 'Vitamine C pure (acide ascorbique, 10 % selon la marque)' }, { activeId: null, label: 'Trois céramides (NP, AP, EOP)' }, { activeId: null, label: 'Acide hyaluronique (hyaluronate de sodium)' }, { activeId: null, label: 'Panthénol (vitamine B5)' }], primaryActiveId: 'vitamin_c', editorialPriority: { vitamin_c: 2 },
      skinTypes: ['all'], skinTypesDocumented: true, targets: ['pigmentation', 'radiance', 'wrinkles'],
      description: 'Sérum à la vitamine C pure (acide ascorbique, 10 % selon la marque), avec trois céramides, de l\'acide hyaluronique et du panthénol. Présenté par la marque pour l\'éclat et l\'apparence du teint ; le matin, visage et cou, hors contour des yeux.',
      active: true, demo: false, status: 'validated',
      inci: ['Water', 'Ascorbic Acid', 'Glycerin', 'Dimethicone', 'Cetearyl Ethylhexanoate', 'Alcohol Denat.', 'Sodium Hydroxide', 'Ammonium Polyacryloyldimethyl Taurate', 'Panthenol', 'Ceramide NP', 'Ceramide AP', 'Ceramide EOP', 'Carbomer', 'Cetearyl Alcohol', 'Behentrimonium Methosulfate', 'Sodium Hyaluronate', 'Sodium Lauroyl Lactylate', 'Cholesterol', 'Phenoxyethanol', 'Tocopheryl Acetate', 'Disodium EDTA', 'Isopropyl Myristate', 'Caprylyl Glycol', 'Xanthan Gum', 'Phytosphingosine', 'Ethylhexylglycerin'],
      inciNote: 'Liste publiée par CeraVe au moment du relevé : la marque la met à jour régulièrement et recommande de vérifier l\'emballage. Les céramides, l\'acide hyaluronique, le panthénol et l\'alcool dénaturé figurent dans la formule mais ne créent aucun actif DERMAI : seul l\'actif « Vitamine C » est retenu.',
      sources: [fournie('CeraVe : Skin Renewing Vitamin C Serum (30 ml)', 'https://www.cerave.com/skincare/facial-serums/skin-renewing-vitamin-c-serum')],
      /* Offres : `checkedAt` est la date du RELEVÉ (recherche), pas une vérification indépendante par DERMAI (`verifiedAt`, absent ici). À revérifier avant tout lancement public.
         Non intégrées : Dis-Chem (Afrique du Sud, 530 ZAR repérés) faute de lien vendeur direct ; Jumia Nigeria « Generic » (7 999 NGN), qui n'est pas une offre CeraVe officielle. */
      offers: [
        { market: 'ZA', retailer: 'Clicks', type: 'retailer', currency: 'ZAR', price: 550, availability: 'in_stock', url: 'https://www.clicks.co.za/cerave_skin-renew-vitamin-c-serum-30ml/p/405225', shipping: null, source: 'Clicks South Africa : fiche produit', checkedAt: D2 },
        { market: 'KE', retailer: 'Cosmetics Kenya', type: 'retailer', currency: 'KES', price: 4995, availability: 'unknown', url: 'https://cosmetics.ke/skincare/vitamin-c-serums/cerave-vitamin-c-serum/', shipping: null, source: 'Cosmetics Kenya : fiche produit', checkedAt: D2 },
        { market: 'NG', retailer: 'Konga', type: 'marketplace', currency: 'NGN', price: 25481, availability: 'unknown', stockNote: 'Achat proposé sur la fiche, sous réserve de disponibilité locale', url: 'https://www.konga.com/product/cerave-skin-renewing-vitamin-c-serum-6770300', shipping: null, source: 'Konga : fiche produit', checkedAt: D2 }
      ],
      image: null },

    { id: 'lrp-effaclar-duo-m', name: 'Effaclar Duo+M', brand: 'La Roche-Posay', format: '40 ml', category: 'serum',
      ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide' }, { activeId: 'salicylic', label: 'Acide salicylique 0,5 % (fiche US) et dérivé LHA : à confirmer selon le pays' }, { activeId: null, label: 'Zinc PCA' }], primaryActiveId: 'niacinamide',
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['acne', 'oiliness'],
      description: 'Soin anti-imperfections au niacinamide, au zinc PCA et à un exfoliant de la famille salicylique (LHA). Composition à confirmer selon le pays.',
      active: false, demo: false, status: 'to_verify', inci: null,
      sources: [src('La Roche-Posay France : Effaclar Duo+M', 'https://www.laroche-posay.fr/gammes/visage/effaclar/effaclar-duo-m-soin-triple-correction-anti-imperfections/LRP_174.html'), src('La Roche-Posay US : Effaclar Duo+M Multi-Target Acne Treatment', 'https://www.laroche-posay.us/our-products/face/acne-products/effaclar-multi-target-acne-treatment-with-salicylic-acid-3337875926065.html')],
      verification: { missing: ['Formule divergente selon le pays : la fiche US annonce 0,5 % d\'acide salicylique, la liste INCI relevée mentionne l\'acide capryloyl salicylique (LHA) sans acide salicylique', 'Liste INCI de la version vendue en Afrique non vérifiée', 'Le mapping avec « Acide salicylique » dépend de cette vérification'] },
      offers: [], image: null },

    { id: 'lrp-cicaplast-baume-b5-plus', name: 'Cicaplast Baume B5+', brand: 'La Roche-Posay', format: '40 ml', category: 'moisturizer',
      ingredients: [{ activeId: 'panthenol', label: 'Panthénol (vitamine B5)' }, { activeId: 'glycerin', label: 'Glycérine' }, { activeId: null, label: 'Madécassoside' }, { activeId: null, label: 'Zinc, manganèse et cuivre (gluconates)' }],
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['redness'],
      description: 'Baume réparateur et apaisant au panthénol (vitamine B5), au madécassoside, au zinc, au manganèse et au cuivre, présenté par la marque pour les peaux irritées ; visage, lèvres et corps.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua', 'Hydrogenated Polyisobutene', 'Dimethicone', 'Glycerin', 'Butyrospermum Parkii Butter / Shea Butter', 'Panthenol', 'Propanediol', 'Butylene Glycol', 'Aluminum Starch Octenylsuccinate', 'Cetyl PEG/PPG-10/1 Dimethicone', 'Trihydroxystearin', 'Zinc Gluconate', 'Madecassoside', 'Tribioma', 'Manganese Gluconate', 'Silica', 'Aluminum Hydroxide', 'Magnesium Sulfate', 'Disodium EDTA', 'Copper Gluconate', 'Capryloyl Glycine', 'Citric Acid', 'Acetylated Glycol Stearate', 'Polyglyceryl-4 Isostearate', 'Tocopherol', 'Pentaerythrityl Tetra-Di-T-Butyl Hydroxyhydrocinnamate', 'CI 77891 / Titanium Dioxide'],
      inciNote: 'Liste lue sur la page La Roche-Posay Afrique (elle diffère de celle du site britannique : pas d\'extrait de Centella, du cuivre en plus). Formule « Baume B5+ » ; l\'ancien « Baume B5 » et la version avec indice solaire sont d\'autres produits.',
      sources: [direct('La Roche-Posay Afrique : Cicaplast Baume B5 Plus (formats 15, 40 et 100 ml)', 'https://africa.laroche-posay.com/en-za/cicaplast/cicaplast-baume-b5-plus')],
      offers: [
        { market: 'NG', retailer: 'Care to Beauty Nigeria', type: 'retailer', currency: 'NGN', price: 27103.4, availability: 'in_stock', stockNote: 'Prêt à expédier', url: 'https://www.caretobeauty.com/ng/la-roche-posay-cicaplast-baume-b5-ultra-repairing-soothing-balm-40ml', shipping: null, source: 'Care to Beauty Nigeria : fiche produit (transporteurs Nigeria indiqués ; livraison hors Nigeria non établie)', checkedAt: D2 }
      ], image: { src: 'img/products/lrp-cicaplast-baume-b5-plus.webp', alt: 'Tube La Roche-Posay Cicaplast Baume B5+', sourceUrl: 'https://africa.laroche-posay.com/en-za/cicaplast/cicaplast-baume-b5-plus', checkedAt: D, credit: 'Visuel : La Roche-Posay' } },

    { id: 'lrp-pure-vitamin-c10-serum', name: 'Pure Vitamin C10 Serum', brand: 'La Roche-Posay', format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'vitamin_c', label: 'Vitamine C pure (acide ascorbique)' }, { activeId: 'salicylic', label: 'Acide salicylique' }, { activeId: 'hyaluronic', label: 'Hyaluronate de sodium et acide hyaluronique hydrolysé' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'vitamin_c', editorialPriority: { salicylic: 2 },
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['radiance', 'wrinkles'],
      description: 'Sérum anti-rides et antioxydant à la vitamine C pure, avec de l\'acide salicylique et de l\'acide hyaluronique, présenté par la marque pour les peaux sensibles. Contient un exfoliant en plus de la vitamine C.',
      active: true, demo: false, status: 'validated',
      inci: ['Aqua / Water', 'Ascorbic Acid', 'Cyclohexasiloxane', 'Glycerin', 'Alcohol Denat.', 'Potassium Hydroxide', 'Polymethylsilsesquioxane', 'Polysilicone-11', 'Dimethicone', 'Propylene Glycol', 'Pentaerythrityl Tetraethylhexanoate', 'C13-14 Isoparaffin', 'PEG-20 Methyl Glucose Sesquistearate', 'Sodium Hyaluronate', 'Adenosine', 'Poloxamer 338', 'Ammonium Polyacryloyldimethyl Taurate', 'Disodium EDTA', 'Hydrolyzed Hyaluronic Acid', 'Caprylyl Glycol', 'Laureth-7', 'Acetyl Dipeptide-1 Cetyl Ester', 'Xanthan Gum', 'Toluene Sulfonic Acid', 'Polyacrylamide', 'Tocopherol', 'Salicylic Acid', 'Parfum / Fragrance'],
      inciNote: 'Liste lue sur la page La Roche-Posay Afrique (« Pure Vitamin C10 Serum », 30 ml) ; elle diffère de celle du site britannique. L\'acide salicylique est listé en fin de liste. Les espaces parasites du texte de la page ont été corrigés.',
      sources: [direct('La Roche-Posay Afrique : Pure Vitamin C10 Serum (30 ml)', 'https://africa.laroche-posay.com/en-za/vitamin-c/pure-vitamin-c10-serum')],
      offers: [], image: { src: 'img/products/lrp-pure-vitamin-c10-serum.webp', alt: 'Flacon La Roche-Posay Pure Vitamin C10 Serum', sourceUrl: 'https://africa.laroche-posay.com/en-za/vitamin-c/pure-vitamin-c10-serum', checkedAt: D, credit: 'Visuel : La Roche-Posay' } },

    { id: 'lrp-mela-b3-serum', name: 'Mela B3 Serum', brand: 'La Roche-Posay', format: '30 ml', category: 'serum',
      ingredients: [{ activeId: 'niacinamide', label: 'Niacinamide 10 %' }, { activeId: null, label: 'Melasyl (2-mercaptonicotinoyl glycine)' }, { activeId: 'retinoid', label: 'Palmitate de rétinyle (ester de vitamine A)' }], primaryActiveId: 'niacinamide',
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['pigmentation'],
      description: 'Sérum anti-taches à la niacinamide et au Melasyl. Contient aussi un dérivé de vitamine A.',
      active: false, demo: false, status: 'to_verify', inci: null,
      sources: [src('La Roche-Posay US : Mela B3 Dark Spot Serum', 'https://www.laroche-posay.us/our-products/face/face-serum/mela-b3-dark-spot-serum-with-melasyl-niacinamide-melab3serum.html'), src('La Roche-Posay UK : Mela B3 Intense Anti-Dark Spot Serum', 'https://www.laroche-posay.co.uk/en_GB/mela-b3-intense-anti-dark-spot-serum/LRP_181.html')],
      verification: { missing: ['La liste INCI relevée contient du palmitate de rétinyle (dérivé de vitamine A) : incompatible avec la règle de cette sélection (aucun produit contenant un rétinoïde)', 'Formule de la version vendue en Afrique non vérifiée'] },
      offers: [], image: null },

    { id: 'vichy-liftactiv-vitamin-c-serum', name: 'Liftactiv Supreme Vitamin C Serum', brand: 'Vichy', format: null, category: 'serum',
      ingredients: [{ activeId: 'vitamin_c', label: 'Vitamine C pure (15 % selon la fiche consultée)' }, { activeId: 'hyaluronic', label: 'Acide hyaluronique hydrolysé' }, { activeId: 'glycerin', label: 'Glycérine' }], primaryActiveId: 'vitamin_c',
      skinTypes: ['all'], skinTypesDocumented: false, targets: ['radiance', 'wrinkles'],
      description: 'Sérum antioxydant à la vitamine C pure de la gamme Liftactiv. Nom exact et format à confirmer.',
      active: false, demo: false, status: 'to_verify', inci: null,
      sources: [src('Vichy France : Liftactiv Sérum Vitamine C (20 ml)', 'https://www.vichy.fr/tous-les-produits/soins-de-la-peau/serums-pour-le-visage/signes-de-lage/liftactiv-vitaminc-serum-20ml'), src('Vichy UK : Liftactiv Vitamin C Serum', 'https://www.vichy.co.uk/all-products/skincare/face-serums/ageing-signs/liftactiv-vitamin-c-serum')],
      verification: { missing: ['Nom exact non confirmé : « Liftactiv Vitamin C Serum » (20 ml) et « Liftactiv Supreme Vitamin C Brightening Skin Corrector » sont deux références distinctes chez Vichy', 'Format, dosage et liste INCI de la référence retenue à confirmer sur la fiche fabricant'] },
      offers: [], image: null }
  ];
  return { PRODUCTS };
});
