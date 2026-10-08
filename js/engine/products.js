/* Couche PRODUITS : relie un pas de routine à des produits d'un catalogue, par activeId (jamais par texte libre).
   Dernière couche de la chaîne  MESURE → INTERPRÉTATION → PRIORITÉ → ACTIF → ROUTINE → PRODUIT : un produit est une CONSÉQUENCE de la routine.
   Il ne crée aucune priorité, ne change aucun score, ne influence ni le choix de l'actif ni la routine. Aucun score, aucun pourcentage de
   « correspondance ». Ordre déterministe : ingrédients recherchés présents, puis type de peau, puis ordre du catalogue. En mode confort, un produit
   contenant un actif plus exigeant que celui du pas n'est pas proposé.

   DEUX CATALOGUES, JAMAIS MÉLANGÉS : le catalogue de démonstration (data/products.js, produits `demo: true`) et le catalogue réel (data/catalog.js,
   vide tant qu'aucune donnée vérifiée n'existe). L'appelant choisit le catalogue ; sans choix, le moteur utilise la démonstration (tests).

   MODÈLE D'UN PRODUIT (voir validateProduct) :
     éditorial (décidé par DERMAI) : id, name, brand, category, ingredients [{ activeId | null, label }], skinTypes, targets, description, active, demo, editorialPriority (facultatif)
     Départage entre produits compatibles avec le même actif : actifs recherchés présents, type de peau, `editorialPriority[actif]` explicite (1 = d'abord), puis ordre du catalogue en repli. Indépendant du marché.
     identité vérifiée (produits réels) : status ('validated' | 'to_verify'), format, inci, sources [{ kind, label, url, checkedAt, method }], verification
     commercial, produits RÉELS : `offers` [{ market, retailer, type, currency, price, availability, url, source, checkedAt, shipping }]. UN produit, PLUSIEURS offres,
       chacune propre à UN pays (code ISO), avec SA devise, SON prix, SA disponibilité, SON vendeur, SA source et SA date. Aucun prix ni aucune disponibilité global(e),
       aucune conversion de devise, aucun pays déduit d'un autre. Les champs commerciaux « plats » (price, vendor, url, availability) sont réservés à la démonstration.
       Affichage selon le pays d'achat choisi par l'utilisatrice : marketView() (offres du pays, régionales déclarées par le vendeur, d'autres pays) ; sans effet sur la sélection des produits.
     commercial, produits de démonstration : availability, price { amount, currency }, priceSource, priceCheckedAt, vendor, url, image
   Les données commerciales n'entrent JAMAIS dans la sélection : un produit sans prix, sans vendeur ni lien reste recommandable, et un produit sans
   donnée commerciale s'affiche « Données à venir ». */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { pdata: require('./data/products.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'), indicators: require('./data/indicators.js'), skin: require('../skin-model.js'), markets: require('./data/markets.js') }
    : { pdata: E.productsData, actives: E.actives, copy: E.copy, indicators: E.indicatorsData, skin: root.SkinModel, markets: E.marketsData };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.products = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const PRODUCTS = dep.pdata.PRODUCTS, actives = dep.actives, copy = dep.copy;

  const CATEGORIES = ['cleanser', 'serum', 'moisturizer', 'spf'];           // alignées sur les étapes de la routine (cleanse, treatment, moisturize, spf)
  const SKIN_TYPES = ['all', 'normal', 'oily', 'dry', 'combination'];
  const AVAILABILITY = ['available', 'unavailable', 'coming_soon'];         // absent ou autre = « Données à venir »
  const CURRENCIES = ['XOF', 'EUR'];                                        // démonstration (champs plats) ; aucune conversion entre devises

  /* ---- Offres commerciales par pays (produits réels) : l'Afrique entière, aucun pays par défaut ---- */
  /* Pays d'Afrique : la liste vient de data/markets.js (source unique, avec devise et nom anglais) ; ici seulement code → nom français. */
  const MARKETS = Object.fromEntries(dep.markets.COUNTRIES.map(c => [c.code, c.fr]));
  const OFFER_CURRENCIES = ['XOF', 'XAF', 'NGN', 'GHS', 'KES', 'ZAR', 'MAD', 'TND', 'DZD', 'EGP', 'RWF', 'TZS', 'UGX', 'CDF', 'GNF', 'MGA', 'MUR', 'ETB', 'ZMW', 'BWP', 'NAD', 'AOA', 'MZN',
    'GMD', 'SLE', 'LRD', 'MWK', 'SCR', 'DJF', 'KMF', 'CVE', 'STN', 'MRU', 'SDG', 'SSP', 'SOS', 'LYD', 'ERN', 'LSL', 'SZL', 'ZWL', 'ZWG', 'BIF', 'EUR', 'USD', 'GBP'];
  /* Une devise propre à une zone n'est acceptée que dans cette zone : un prix en FCFA hors zone FCFA (ou en naira hors Nigeria) est une erreur de saisie ou une conversion. */
  const CURRENCY_HOME = { XOF: ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'], XAF: ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'], NGN: ['NG'], GHS: ['GH'], KES: ['KE'], MAD: ['MA'], ZAR: ['ZA', 'LS', 'NA', 'SZ'],
    TND: ['TN'], DZD: ['DZ'], EGP: ['EG'], RWF: ['RW'], TZS: ['TZ'], UGX: ['UG'] };
  const OFFER_AVAILABILITY = ['in_stock', 'out_of_stock', 'coming_soon', 'unknown'];
  const OFFER_TYPES = ['brand_site', 'retailer', 'pharmacy', 'marketplace', 'importer'];
  const OFFER_SHIPPING = ['local', 'international'];
  const PRODUCT_STATUS = ['validated', 'to_verify'];
  const SOURCE_KINDS = ['manufacturer', 'retailer', 'regulator', 'other'];
  /* Recherches de disponibilité (marketChecks) : searched_found = une recherche a trouvé au moins une offre dans ce pays ; searched_none = une recherche explicite n'a trouvé AUCUNE offre fiable dans ce pays.
     Statut d'un produit pour un pays (availabilityStatus) : LOCAL, REGIONAL, IMPORT, UNAVAILABLE (recherche explicite sans offre fiable) ou UNKNOWN (aucune recherche fiable : le défaut). */
  const MARKET_CHECK_STATUS = ['searched_found', 'searched_none'];
  const AVAILABILITY_STATUS = ['LOCAL', 'REGIONAL', 'IMPORT', 'UNAVAILABLE', 'UNKNOWN'];

  const byId = (id, catalog) => (catalog || PRODUCTS).find(p => p.id === id) || null;
  const ids = p => p.ingredients.map(i => i.activeId).filter(Boolean);
  const demanding = id => { const a = actives.byId(id); return !!a && a.irritation !== 'low'; };
  const strong = id => { const a = actives.byId(id); return !!a && a.groups.length > 0; };
  const skinOk = (p, base) => !base || p.skinTypes.includes('all') || p.skinTypes.includes(base);
  /* Un produit désactivé (`active: false`) n'est ni recommandé ni listé. */
  const usable = catalog => (catalog || PRODUCTS).filter(p => p && p.active !== false && p.status !== 'to_verify');

  /* ---------- Validation du modèle ---------- */
  const isHttps = u => { try { const x = new URL(u); return x.protocol === 'https:' && u.length <= 500; } catch (e) { return false; } };
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d));
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const FAKE_HOST = /(^|\.)example\.(com|org|net)$|\.(example|test|invalid|localhost|local)$|^localhost$|^(\d{1,3}\.){3}\d{1,3}$/i;
  const isRealLink = u => { if (!isHttps(u)) return false; try { return !FAKE_HOST.test(new URL(u).hostname); } catch (e) { return false; } };
  function validateOffer(o, demo) {
    const e = [];
    if (!o || typeof o !== 'object') return ['offre invalide'];
    if (!Object.prototype.hasOwnProperty.call(MARKETS, o.market)) e.push('offre : pays inconnu (code ISO attendu)');
    if (!text(o.retailer, 80)) e.push('offre : vendeur manquant');
    if (!OFFER_TYPES.includes(o.type)) e.push('offre : type de vendeur invalide');
    if (!OFFER_AVAILABILITY.includes(o.availability)) e.push('offre : disponibilité invalide');
    if (o.shipping != null && !OFFER_SHIPPING.includes(o.shipping)) e.push('offre : livraison invalide');
    /* servesMarkets : pays que le VENDEUR indique lui-même desservir (offre « régionale »). Jamais déduit d'une devise ou d'une zone ; absent = inconnu. */
    if (o.servesMarkets != null && !(Array.isArray(o.servesMarkets) && o.servesMarkets.length > 0 && o.servesMarkets.length <= 60 && new Set(o.servesMarkets).size === o.servesMarkets.length
      && o.servesMarkets.every(c => Object.prototype.hasOwnProperty.call(MARKETS, c)))) e.push('offre : pays desservis invalides (codes ISO connus, sans doublon)');
    /* seller : vendeur exact d'une place de marché (le retailer reste « Jumia », « Konga »...) ; city : ville du point de vente ; stockNote : mention de stock lue sur la page (« Peu d'unités restantes »),
       sans changer le statut de disponibilité. Facultatifs, jamais inventés. */
    for (const [k, max] of [['seller', 80], ['city', 60], ['stockNote', 100]]) if (o[k] != null && !text(o[k], max)) e.push('offre : ' + k + ' invalide');
    if (!text(o.source, 160)) e.push('offre : source manquante');
    if (!isDate(o.checkedAt)) e.push('offre : date de vérification manquante');
    /* checkedAt = date du RELEVÉ (source, recherche). verifiedAt = date d'une vérification indépendante par DERMAI, absente tant qu'aucune n'a eu lieu : un relevé n'est pas une vérification. */
    if (o.verifiedAt != null && !isDate(o.verifiedAt)) e.push('offre : date de vérification indépendante invalide');
    if (o.url != null && !isRealLink(o.url)) e.push('offre : lien d\'achat invalide (https réel obligatoire)');
    if (o.price != null) {
      if (!(typeof o.price === 'number' && Number.isFinite(o.price) && o.price > 0)) e.push('offre : prix invalide');
      if (!OFFER_CURRENCIES.includes(o.currency)) e.push('offre : un prix exige sa devise');
    }
    if (o.currency != null) {
      if (!OFFER_CURRENCIES.includes(o.currency)) e.push('offre : devise inconnue');
      else if (CURRENCY_HOME[o.currency] && Object.prototype.hasOwnProperty.call(MARKETS, o.market) && !CURRENCY_HOME[o.currency].includes(o.market)) e.push('offre : devise ' + o.currency + ' impossible dans ce pays (aucune conversion)');
    }
    for (const k of Object.keys(o)) if (/^(match|score|compat|percent|pourcent|converted|conversion)/i.test(k)) e.push('offre : champ interdit : ' + k);
    return e;
  }
  /* Une recherche de disponibilité : pays (code ISO), statut, date, méthode (comment la recherche a été faite) et note facultative. Jamais déduite d'une absence d'offre dans le catalogue. */
  function validateMarketCheck(c) {
    const e = [];
    if (!c || typeof c !== 'object') return ['recherche de marché invalide'];
    if (!Object.prototype.hasOwnProperty.call(MARKETS, c.market)) e.push('recherche de marché : pays inconnu (code ISO attendu)');
    if (!MARKET_CHECK_STATUS.includes(c.status)) e.push('recherche de marché : statut inconnu (searched_found ou searched_none)');
    if (!isDate(c.checkedAt)) e.push('recherche de marché : date manquante');
    if (!text(c.method, 200)) e.push('recherche de marché : méthode manquante');
    if (c.note != null && !text(c.note, 300)) e.push('recherche de marché : note invalide');
    for (const k of Object.keys(c)) if (!['market', 'status', 'checkedAt', 'method', 'note'].includes(k)) e.push('recherche de marché : champ inattendu : ' + k);
    return e;
  }
  function validateProduct(p) {
    const e = [];
    if (!p || typeof p !== 'object') return ['produit absent'];
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(String(p.id))) e.push('id invalide');
    if (!text(p.name, 80)) e.push('nom manquant');
    if (!text(p.brand, 40)) e.push('marque manquante');
    if (!CATEGORIES.includes(p.category)) e.push('catégorie inconnue');
    if (!Array.isArray(p.ingredients) || !p.ingredients.length) e.push('ingrédients manquants');
    else for (const i of p.ingredients) {
      if (!i || !text(i.label, 80)) e.push('libellé d\'ingrédient manquant');
      else if (i.activeId != null && !actives.byId(i.activeId)) e.push('actif inconnu : ' + i.activeId);
    }
    if (!Array.isArray(p.skinTypes) || !p.skinTypes.length || p.skinTypes.some(t => !SKIN_TYPES.includes(t))) e.push('types de peau invalides');
    if (!Array.isArray(p.targets) || p.targets.some(t => !dep.skin.METRIC_KEYS.includes(t))) e.push('indicateurs ciblés invalides');
    if (p.category === 'serum' && Array.isArray(p.ingredients) && !p.ingredients.some(i => i && i.activeId)) e.push('un soin ciblé doit être relié à un actif');
    if (p.primaryActiveId != null && !(Array.isArray(p.ingredients) && p.ingredients.some(i => i && i.activeId === p.primaryActiveId))) e.push('actif principal absent des ingrédients');
    /* editorialPriority : { activeId: entier ≥ 1 } — ordre éditorial voulu par DERMAI entre produits compatibles avec le MÊME actif (1 = d'abord). Valeur relative, sans calcul, jamais affichée. */
    if (p.editorialPriority != null) {
      const ep = p.editorialPriority;
      if (typeof ep !== 'object' || Array.isArray(ep)) e.push('editorialPriority doit être un objet { actif: rang }');
      else for (const [k, v] of Object.entries(ep)) { if (!Array.isArray(p.ingredients) || !ids(p).includes(k)) e.push('editorialPriority : actif non relié au produit : ' + k); if (!(Number.isInteger(v) && v >= 1 && v <= 99)) e.push('editorialPriority : rang entier de 1 à 99 attendu (' + k + ')'); }
    }
    if (p.description != null && !text(p.description, 300)) e.push('description invalide');
    if (p.active != null && typeof p.active !== 'boolean') e.push('active doit être un booléen');
    if (typeof p.demo !== 'boolean') e.push('demo doit être vrai ou faux');
    for (const k of Object.keys(p)) if (/^(match|score|compat|percent|pourcent)/i.test(k)) e.push('champ interdit : ' + k);   // aucun score de correspondance
    for (const v of [p.name, p.description, ...(Array.isArray(p.ingredients) ? p.ingredients.map(i => i && i.label) : [])]) if (typeof v === 'string' && /\d\s?%\s?(de )?(correspondance|compatib)/i.test(v)) e.push('pourcentage de correspondance interdit');
    // offres par pays (produits réels) : chacune porte son pays, sa devise, son prix, sa disponibilité, sa source et sa date
    if (p.offers != null) {
      if (!Array.isArray(p.offers)) e.push('offres invalides');
      else {
        if (p.demo === true && p.offers.length) e.push('un produit de démonstration n\'a pas d\'offre réelle');
        const seenOffers = new Set();
        for (const o of p.offers) {
          for (const m of validateOffer(o, p.demo === true)) e.push(m);
          if (o && typeof o === 'object') { const k = [o.market, o.retailer, o.url || ''].join('|'); if (seenOffers.has(k)) e.push('offre en double'); seenOffers.add(k); }
        }
      }
    }
    // recherches de disponibilité par pays : cohérentes avec les offres, jamais sur un produit de démonstration
    if (p.marketChecks != null) {
      if (!Array.isArray(p.marketChecks)) e.push('marketChecks doit être une liste');
      else if (p.demo === true) { if (p.marketChecks.length) e.push('un produit de démonstration n\'a pas de recherche de marché'); }
      else {
        const seenChecks = new Set(), offerMarkets = new Set((Array.isArray(p.offers) ? p.offers : []).filter(o => validateOffer(o, false).length === 0).map(o => o.market));
        for (const c of p.marketChecks) {
          for (const m of validateMarketCheck(c)) e.push(m);
          if (!c || typeof c !== 'object') continue;
          if (seenChecks.has(c.market)) e.push('recherche de marché en double : ' + c.market); seenChecks.add(c.market);
          if (c.status === 'searched_none' && offerMarkets.has(c.market)) e.push('recherche de marché : searched_none contredit une offre du même pays (' + c.market + ')');
          if (c.status === 'searched_found' && !offerMarkets.has(c.market)) e.push('recherche de marché : searched_found exige une offre valide dans ce pays (' + c.market + ')');
        }
      }
    }
    if (p.demo !== true) {
      // produit réel : aucun champ commercial global, identité vérifiée obligatoire
      for (const k of ['availability', 'price', 'priceSource', 'priceCheckedAt', 'vendor', 'url']) if (p[k] != null) e.push('champ commercial global interdit pour un produit réel : ' + k + ' (utiliser offers)');
      if (!PRODUCT_STATUS.includes(p.status)) e.push('statut invalide (validated ou to_verify)');
      if (p.format != null && !text(p.format, 30)) e.push('format invalide');
      if (p.inci != null && !(Array.isArray(p.inci) && p.inci.length && p.inci.every(x => text(x, 80)))) e.push('INCI invalide');
      if (p.inciNote != null && !text(p.inciNote, 400)) e.push('note INCI invalide');
      if (!Array.isArray(p.sources)) e.push('sources manquantes');
      else for (const s of p.sources) {
        if (!s || !SOURCE_KINDS.includes(s.kind) || !text(s.label, 120) || !isRealLink(s.url) || !isDate(s.checkedAt) || !text(s.method, 200)) e.push('source invalide (type, libellé, lien https, date et méthode obligatoires)');
      }
      if (p.status === 'validated') {
        if (!text(p.format, 30)) e.push('un produit validé exige son format');
        if (!Array.isArray(p.inci) || !p.inci.length) e.push('un produit validé exige sa liste d\'ingrédients (INCI)');
        if (!Array.isArray(p.sources) || !p.sources.some(s => s && s.kind === 'manufacturer')) e.push('un produit validé exige une source fabricant');
      }
      if (p.status === 'to_verify') {
        if (p.active !== false) e.push('un produit à vérifier ne doit pas être actif');
        if (!(p.verification && Array.isArray(p.verification.missing) && p.verification.missing.length && p.verification.missing.every(x => text(x, 200)))) e.push('un produit à vérifier liste ce qui manque (verification.missing)');
        if (Array.isArray(p.offers) && p.offers.length) e.push('un produit à vérifier n\'a aucune offre');
      }
      if (p.skinTypesDocumented != null && typeof p.skinTypesDocumented !== 'boolean') e.push('skinTypesDocumented doit être un booléen');
    } else {
      // démonstration : champs commerciaux plats (anciens), nuls tant qu'ils ne sont pas renseignés
      if (p.availability != null && !AVAILABILITY.includes(p.availability)) e.push('disponibilité invalide');
      if (p.vendor != null && !text(p.vendor, 80)) e.push('vendeur invalide');
      if (p.url != null && !isHttps(p.url)) e.push('lien d\'achat invalide (https obligatoire)');
      if (p.price != null && (typeof p.price !== 'object' || !(Number.isFinite(p.price.amount) && p.price.amount > 0) || !CURRENCIES.includes(p.price.currency))) e.push('prix invalide');
    }
    if (p.image != null) {
      const okSrc = p.image && typeof p.image.src === 'string' && (/^img\/products\/[\w.-]+\.(jpe?g|png|webp)$/i.test(p.image.src) || isHttps(p.image.src));
      if (!okSrc || !text(p.image.alt, 120)) e.push('image invalide (fichier img/products/ ou https, texte alternatif obligatoire)');
      // produit réel : une image n'est acceptée que si sa provenance est connue (page d'origine, date, crédit) et qu'elle est un fichier du projet
      if (p.demo !== true && p.image && okSrc) {
        if (!/^img\/products\/[\w.-]+\.(jpe?g|png|webp)$/i.test(p.image.src)) e.push('image réelle : fichier du projet obligatoire (img/products/)');
        if (!isRealLink(p.image.sourceUrl) || !isDate(p.image.checkedAt) || !text(p.image.credit, 80)) e.push('image réelle : page d\'origine (https), date et crédit obligatoires');
      }
    }
    return e;
  }
  function validateCatalog(list) {
    const errors = []; const seen = new Set();
    (Array.isArray(list) ? list : []).forEach((p, i) => {
      for (const m of validateProduct(p)) errors.push((p && p.id ? p.id : '#' + i) + ' : ' + m);
      if (p && seen.has(p.id)) errors.push(p.id + ' : id en double');
      if (p) seen.add(p.id);
    });
    return errors;
  }

  /* ---------- Données commerciales, sous une forme sûre à afficher ---------- */
  /* Offres d'un produit réel, sous une forme sûre à afficher. Chaque offre reste liée à SON pays, SA devise, SON prix et SA date : aucune conversion,
     aucune moyenne, aucune offre « globale ». Trié par pays (ordre alphabétique français) puis vendeur : l'ordre n'exprime aucune préférence. */
  /* Bouton d'achat = offre « ready » (stock indiqué + prix + lien https) ; « Voir l'offre » = offre « partial » qui a un lien (stock inconnu ou prix absent) ; rupture ou bientôt disponible : aucun bouton. */
  function offersOf(p) {
    if (!p || p.demo === true || !Array.isArray(p.offers)) return [];
    return p.offers.filter(o => validateOffer(o, false).length === 0).map(o => {
      const link = o.url && isRealLink(o.url) ? o.url : null;
      return { market: o.market, country: MARKETS[o.market], retailer: o.retailer, type: o.type, typeLabel: copy.OFFER_TYPE_LABELS[o.type],
        marketplace: o.type === 'marketplace', currency: o.price != null ? o.currency : (o.currency || null), price: o.price != null ? o.price : null,
        availability: o.availability, availabilityLabel: copy.OFFER_AVAILABILITY_LABELS[o.availability], shipping: o.shipping || null, seller: o.seller || null, verifiedAt: o.verifiedAt || null, city: o.city || null, stockNote: o.stockNote || null, serves: Array.isArray(o.servesMarkets) ? o.servesMarkets.slice() : null,
        quality: null, url: link, buyable: false, linkOnly: false, source: o.source, checkedAt: o.checkedAt };
    })
      .map(o => { const quality = qualityOf(o); return Object.assign(o, { quality, buyable: quality === 'ready', linkOnly: quality === 'partial' && !!o.url }); }).sort((a, b) => a.country.localeCompare(b.country, 'fr') || a.retailer.localeCompare(b.retailer, 'fr'));
  }
  /* Qualité d'une offre : un classement GROSSIER pour l'AFFICHAGE, jamais un score ni un pourcentage. ready = stock indiqué, prix présent et lien https ; partial = au moins une information
     manque ou n'est pas confirmée (stock inconnu, prix ou lien absent) ; unavailable = rupture ou bientôt disponible. Les offres d'un même niveau (pays / régional / autres pays) sont
     présentées dans cet ordre ; l'ordre ne dit rien d'autre et ne touche jamais le choix du produit. */
  const QUALITY = ['ready', 'partial', 'unavailable'];
  const qualityOf = o => (o.availability === 'out_of_stock' || o.availability === 'coming_soon') ? 'unavailable' : (o.availability === 'in_stock' && o.price != null && o.url) ? 'ready' : 'partial';
  const byQuality = list => list.map((o, i) => ({ o, i })).sort((a, b) => QUALITY.indexOf(a.o.quality) - QUALITY.indexOf(b.o.quality) || a.i - b.i).map(x => x.o);
  /* Offres d'un produit POUR UN PAYS D'ACHAT (choisi par l'utilisatrice). Hiérarchie simple, sans score : 1. offres du pays ; 2. offres régionales, seulement si le vendeur
     déclare desservir ce pays (servesMarkets) ; 3. offres d'autres pays (achat en ligne, livraison à vérifier) ; 4. aucune. Une offre dont le vendeur indique une livraison
     « locale » (shipping: 'local') n'est jamais proposée hors de son pays. Le pays ne retire ni n'ajoute aucun produit et ne change aucune recommandation : il ne sert qu'à
     classer et présenter les offres d'un produit DÉJÀ choisi par le moteur. */
  function marketView(p, country) {
    const all = offersOf(p), code = typeof country === 'string' && Object.prototype.hasOwnProperty.call(MARKETS, country) ? country : null;
    const base = { country: code, countryName: code ? MARKETS[code] : null, all, hasOffers: all.length > 0 };
    if (!code) return Object.assign(base, { local: [], regional: [], international: [], tier: 'no-country', summary: null });
    const local = byQuality(all.filter(o => o.market === code));
    const rest = all.filter(o => o.market !== code);
    const regional = byQuality(rest.filter(o => o.serves && o.serves.includes(code)));
    const international = byQuality(rest.filter(o => !(o.serves && o.serves.includes(code)) && o.shipping !== 'local'));
    const tier = local.length ? 'local' : regional.length ? 'regional' : international.length ? 'international' : 'none';
    /* Résumé pour le pays : la meilleure qualité parmi les offres du pays (locales ou régionales), sinon « autres pays seulement », sinon « aucune ». */
    const mine = local.concat(regional), summary = mine.length ? byQuality(mine)[0].quality : international.length ? 'elsewhere' : 'none';
    return Object.assign(base, { local, regional, international, tier, summary });
  }
  /* Statut de disponibilité d'un produit POUR UN PAYS, pour l'AFFICHAGE seulement : il ne retire ni n'ajoute aucun produit et ne change aucune recommandation. Une offre en rupture ou « bientôt »
     ne compte pas comme disponibilité fiable.
       LOCAL        offre fiable dans ce pays ;      REGIONAL  offre fiable d'un autre pays dont le vendeur déclare desservir ce pays (servesMarkets) ;
       IMPORT       offre fiable d'un autre pays dont la livraison INTERNATIONALE est explicitement indiquée (livraison inconnue = pas d'IMPORT) ;
       UNAVAILABLE  recherche explicite (marketChecks, searched_none) sans offre fiable ; JAMAIS déduit de l'absence d'offre dans le catalogue ;
       UNKNOWN      sinon (aucune recherche fiable) : le défaut, y compris sans pays choisi ou avec des offres en rupture seulement. */
  function availabilityStatus(p, country) {
    const v = marketView(p, country), code = v.country;
    if (!code) return { country: null, status: 'UNKNOWN', reason: 'no-country' };
    const ok = list => list.filter(o => o.quality !== 'unavailable');
    if (ok(v.local).length) return { country: code, status: 'LOCAL', reason: 'local_offer' };
    if (ok(v.regional).length) return { country: code, status: 'REGIONAL', reason: 'regional_offer' };
    if (ok(v.international).filter(o => o.shipping === 'international').length) return { country: code, status: 'IMPORT', reason: 'import_offer' };
    const check = Array.isArray(p && p.marketChecks) && p.demo !== true ? p.marketChecks.find(c => c && c.market === code && validateMarketCheck(c).length === 0) : null;
    if (check && check.status === 'searched_none') return { country: code, status: 'UNAVAILABLE', reason: 'searched_none', checkedAt: check.checkedAt };
    return { country: code, status: 'UNKNOWN', reason: v.hasOffers ? 'no_reliable_offer' : 'no_search' };
  }
  /* Données commerciales d'un produit. Réel : uniquement `offers` (les champs plats sont nuls). Démonstration : anciens champs plats, jamais de prix réel. */
  function commerceOf(p) {
    const real = p && p.demo !== true;
    const offers = offersOf(p);
    const availability = !real && p && AVAILABILITY.includes(p.availability) ? p.availability : null;
    const price = null;                                                     // aucun prix « global » : les prix vivent dans les offres, par pays
    const url = !real && p && p.url && isHttps(p.url) ? p.url : null;
    return { availability, availabilityLabel: copy.AVAILABILITY_LABELS[availability || 'unknown'], price, vendor: !real && p && p.vendor ? p.vendor : null, url,
      buyable: !!(url && availability === 'available'), offers, markets: [...new Set(offers.map(o => o.market))], hasOffers: offers.length > 0,
      anyBuyable: offers.some(o => o.buyable) };
  }
  /* Actif principal : celui du soin ciblé (explicite, sinon le premier actif de traitement), sinon le premier actif relié ; null si aucun. */
  function primaryActive(p) {
    if (p.primaryActiveId) return p.primaryActiveId;
    const linked = ids(p);
    return linked.find(id => { const a = actives.byId(id); return a && a.kind === 'treatment'; }) || linked[0] || null;
  }

  /* ---------- Règles de compatibilité, partagées par la sélection et par l'explication ---------- */
  const stepCategory = step => ({ cleanse: 'cleanser', spf: 'spf', moisturize: 'moisturizer', treatment: 'serum' })[step.kind];
  function context(routine) {
    return { comfort: routine.comfortMode, excluded: new Set(routine.exclusions || []),
      planned: new Set([...routine.slots.morning, ...routine.slots.evening].filter(st => st.kind === 'treatment').map(st => st.activeId)) };
  }
  /* Renvoie null si le produit peut remplir ce pas, sinon le code de la règle qui l'écarte (ordre : exclusion, confort, composition). */
  function rejection(p, step, ctx) {
    if (ids(p).some(id => ctx.excluded.has(id))) return 'excluded';
    if (ctx.comfort && ids(p).some(id => demanding(id) && id !== step.activeId)) return 'comfort';
    /* Composition vérifiée : un produit ne doit jamais introduire un actif que le plan n'a pas prévu. Un nettoyant, un hydratant
       ou une protection solaire ne contient aucun actif de traitement ; un sérum ne contient que son actif et des actifs de soutien
       ou des soins prévus et non forts. Jamais d'exfoliant ou de rétinoïde caché. */
    const ok = ids(p).every(id => {
      if (id === step.activeId) return true;
      const a = actives.byId(id);
      if (!a) return true;
      if (strong(id)) return false;
      if (a.kind === 'support') return true;
      return step.kind === 'treatment' && ctx.planned.has(id);
    });
    return ok ? null : 'composition';
  }
  const fitsStep = (p, step) => p.category === stepCategory(step) && (step.kind !== 'treatment' || ids(p).includes(step.activeId));

  function match(routine, catalog) {
    const out = [];
    const ctx = context(routine), list = usable(catalog);
    for (const slot of ['morning', 'evening']) {
      routine.slots[slot].forEach(step => {
        if (step.owned) return;
        const candidates = list.map((p, order) => ({ p, order })).filter(({ p }) => fitsStep(p, step)).filter(({ p }) => rejection(p, step, ctx) === null);
        let wanted = [];
        if (step.kind === 'treatment') wanted = [step.activeId];
        if (step.kind === 'moisturize') wanted = step.supportIds;
        const score = ({ p }) => wanted.filter(id => ids(p).includes(id)).length;
        let pool = candidates;
        if (step.kind === 'moisturize' && wanted.length) pool = candidates.filter(c => score(c) > 0);
        /* Départage, dans l'ordre : 1. actifs recherchés présents ; 2. compatibilité avec le type de peau ; 3. PRIORITÉ ÉDITORIALE explicite (p.editorialPriority[actif du pas], 1 = d'abord) ;
           4. ordre du catalogue. Les produits sans priorité explicite pour cet actif passent après ceux qui en ont une, puis suivent l'ordre du catalogue (aucune valeur inventée). Les filtres
           (exclusions, approche douce, composition) ont déjà écarté les produits incompatibles : la priorité ne les contourne jamais. Aucune donnée commerciale n'intervient. */
        const prio = p => (step.kind === 'treatment' && p.editorialPriority && Number.isInteger(p.editorialPriority[step.activeId])) ? p.editorialPriority[step.activeId] : null;
        const byPrio = (a, b) => { const x = prio(a.p), y = prio(b.p); return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y; };
        /* Justification obligatoire (produits réels) : un produit n'est proposé que si sa fiche contient ce que l'étape recherche
           (l'actif du soin ciblé, ou un ingrédient de soutien retenu pour l'hydratant). Une étape qui ne recherche rien (hydratant
           d'entretien, nettoyant, protection solaire) ne reçoit aucun produit réel « par défaut ». Les produits de démonstration restent des exemples. */
        if (!wanted.length) pool = pool.filter(c => c.p.demo === true);
        pool = pool.sort((a, b) => score(b) - score(a) || (skinOk(b.p, routine.skinBase) - skinOk(a.p, routine.skinBase)) || byPrio(a, b) || a.order - b.order);
        if (!pool.length) return;
        const p = pool[0].p, because = wanted.filter(id => ids(p).includes(id));
        /* Règle de départage réellement appliquée (pour expliquer « pourquoi celui-ci plutôt qu'un autre ») */
        const sec = pool[1];
        const rule = !sec ? 'only' : score(pool[0]) !== score(sec) ? 'more_actives' : skinOk(p, routine.skinBase) !== skinOk(sec.p, routine.skinBase) ? 'skin' : byPrio(pool[0], sec) !== 0 ? 'editorial' : 'order';
        out.push(Object.assign({ stepId: step.id, kind: step.kind, productId: p.id, activeIds: because,
          because: because.length ? copy.productBecause(because.map(id => actives.byId(id).label)) : null, demo: p.demo === true,
          selection: { rule, candidates: pool.length } }, step.origin === 'accompaniment' ? { origin: 'accompaniment' } : {}));   // l'origine n'est notée que pour un soin d'accompagnement
      });
    }
    return out;
  }

  /* État du produit d'une RECOMMANDATION d'accompagnement (étape 27). Ne choisit rien : lit la routine et les produits déjà retenus par match().
       matched            : l'étape qui porte l'actif a reçu un produit du catalogue (productId) ;
       no_catalog_product : l'actif est recommandé et une étape existe, mais aucun produit du catalogue ne lui correspond ;
       not_applicable     : aucune étape n'existe pour cet actif (axe identifié sans soin ajouté) : aucun produit n'est demandé.
     Jamais de produit, de composition, de prix ni de disponibilité inventés : les offres par pays restent affichées par marketView(). */
  function productStatusOf(routine, matches, activeId) {
    const stepIds = [...routine.slots.morning, ...routine.slots.evening].filter(s => s.kind === 'treatment' && s.activeId === activeId).map(s => s.id);
    if (!stepIds.length) return { status: 'not_applicable', productId: null };
    const m = (matches || []).find(x => stepIds.includes(x.stepId));
    return m ? { status: 'matched', productId: m.productId } : { status: 'no_catalog_product', productId: null };
  }

  /* « Pourquoi ce produit ? » : le rôle qu'il joue dans l'étape (dérivé de la sélection, jamais d'une donnée commerciale). */
  const kindOf = m => (m.origin === 'accompaniment' ? 'accompaniment' : m.kind);   // un produit d'accompagnement est présenté comme tel
  const whyOf = m => [copy.productWhy(kindOf(m), (m.activeIds || []).map(id => actives.byId(id).label)), m.demo ? '' : copy.selectionText(m.selection)].filter(Boolean).join(' ');

  /* Vue du catalogue pour une routine : « Recommandés pour votre routine » et « Autres produits » (avec la raison RÉELLE du moteur).
     Aucune donnée commerciale n'intervient dans ce classement. */
  function catalogView(routine, matches, catalog) {
    const list = usable(catalog), ctx = context(routine);
    const steps = [...routine.slots.morning, ...routine.slots.evening];
    const chosen = new Map();
    for (const m of matches) {
      if (!chosen.has(m.productId)) chosen.set(m.productId, []);
      chosen.get(m.productId).push(m);
    }
    const recommended = [...chosen.entries()].map(([productId, ms]) => ({ productId, steps: ms.map(m => ({ stepId: m.stepId, kind: kindOf(m), activeIds: m.activeIds, why: whyOf(m) })) }));
    const others = list.filter(p => !chosen.has(p.id)).map(p => {
      const relevant = steps.filter(st => fitsStep(p, st));
      let code;
      if (ids(p).some(id => ctx.excluded.has(id))) code = 'excluded';         // exclusion choisie par l'utilisatrice : la raison la plus claire
      else if (!relevant.length) code = p.category === 'serum' ? 'active_not_selected' : steps.some(st => stepCategory(st) === p.category) ? 'no_step' : 'no_step';
      else if (relevant.every(st => st.owned)) code = 'owned';
      else {
        const open = relevant.filter(st => !st.owned);
        const reasons = open.map(st => rejection(p, st, ctx));
        const fits = open.filter((st, k) => reasons[k] === null);
        /* Compatible, mais l'étape n'a reçu aucun produit faute de justification : on le dit, sans prétendre qu'un autre a été préféré. */
        code = fits.length ? (fits.some(st => matches.some(m => m.stepId === st.id)) || p.demo ? 'other_product_chosen' : 'not_justified') : reasons[0];
      }
      return { productId: p.id, reason: code, text: copy.PRODUCT_REASONS[code] };
    });
    return { recommended, others };
  }

  /* Forme cible d'une entrée de catalogue (liste d'entrées compatibles avec une base de données future). Les champs commerciaux restent NULS tant
     qu'aucune donnée vérifiée n'existe : jamais de prix, de vendeur, de disponibilité ni de lien inventés. Les prix du catalogue de démonstration
     ne sont pas repris ici. `goals` est dérivé des indicateurs ciblés et des domaines d'objectifs existants : aucune relation nouvelle. */
  const CATALOG_FIELDS = ['productId', 'activeIds', 'categories', 'skinTypes', 'goals', 'price', 'currency', 'vendor', 'availability', 'url'];
  function toCatalogEntry(p) {
    const indicatorIds = (p.targets || []);
    const goals = dep.indicators.GOALS.filter(g => g.domain && indicatorIds.some(i => (dep.indicators.INDICATORS[i] || {}).domain === g.domain)).map(g => g.id);
    return { productId: p.id, activeIds: ids(p), categories: [p.category], skinTypes: p.skinTypes.slice(), goals,
      price: null, currency: null, vendor: p.vendor || null, availability: p.availability || null, url: p.url || null };
  }

  return { PRODUCTS, CATEGORIES, SKIN_TYPES, AVAILABILITY, CURRENCIES, MARKETS, OFFER_CURRENCIES, OFFER_AVAILABILITY, OFFER_TYPES, PRODUCT_STATUS, byId, ids, usable, match, whyOf, productStatusOf, catalogView, commerceOf, offersOf, marketView, availabilityStatus, MARKET_CHECK_STATUS, AVAILABILITY_STATUS, validateMarketCheck, QUALITY, validateOffer, primaryActive, validateProduct, validateCatalog,
    stepCategory, CATALOG_FIELDS, toCatalogEntry };
});
