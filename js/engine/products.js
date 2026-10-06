/* Couche PRODUITS : relie un pas de routine à des produits d'un catalogue, par activeId (jamais par texte libre).
   Dernière couche de la chaîne  MESURE → INTERPRÉTATION → PRIORITÉ → ACTIF → ROUTINE → PRODUIT : un produit est une CONSÉQUENCE de la routine.
   Il ne crée aucune priorité, ne change aucun score, ne influence ni le choix de l'actif ni la routine. Aucun score, aucun pourcentage de
   « correspondance ». Ordre déterministe : ingrédients recherchés présents, puis type de peau, puis ordre du catalogue. En mode confort, un produit
   contenant un actif plus exigeant que celui du pas n'est pas proposé.

   DEUX CATALOGUES, JAMAIS MÉLANGÉS : le catalogue de démonstration (data/products.js, produits `demo: true`) et le catalogue réel (data/catalog.js,
   vide tant qu'aucune donnée vérifiée n'existe). L'appelant choisit le catalogue ; sans choix, le moteur utilise la démonstration (tests).

   MODÈLE D'UN PRODUIT (voir validateProduct) :
     éditorial (décidé par DERMAI) : id, name, brand, category, ingredients [{ activeId | null, label }], skinTypes, targets, description, active, demo
     identité vérifiée (produits réels) : status ('validated' | 'to_verify'), format, inci, sources [{ kind, label, url, checkedAt, method }], verification
     commercial, produits RÉELS : `offers` [{ market, retailer, type, currency, price, availability, url, source, checkedAt, shipping }]. UN produit, PLUSIEURS offres,
       chacune propre à UN pays (code ISO), avec SA devise, SON prix, SA disponibilité, SON vendeur, SA source et SA date. Aucun prix ni aucune disponibilité global(e),
       aucune conversion de devise, aucun pays déduit d'un autre. Les champs commerciaux « plats » (price, vendor, url, availability) sont réservés à la démonstration.
     commercial, produits de démonstration : availability, price { amount, currency }, priceSource, priceCheckedAt, vendor, url, image
   Les données commerciales n'entrent JAMAIS dans la sélection : un produit sans prix, sans vendeur ni lien reste recommandable, et un produit sans
   donnée commerciale s'affiche « Données à venir ». */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const E = root.DermaiEngine || {};
  const dep = isNode
    ? { pdata: require('./data/products.js'), actives: require('./actives.js'), copy: require('./copy.fr.js'), indicators: require('./data/indicators.js'), skin: require('../skin-model.js') }
    : { pdata: E.productsData, actives: E.actives, copy: E.copy, indicators: E.indicatorsData, skin: root.SkinModel };
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
  const MARKETS = { DZ: 'Algérie', AO: 'Angola', BJ: 'Bénin', BW: 'Botswana', BF: 'Burkina Faso', BI: 'Burundi', CV: 'Cap-Vert', CM: 'Cameroun', CF: 'Centrafrique', TD: 'Tchad', KM: 'Comores',
    CG: 'Congo', CD: 'RD Congo', CI: 'Côte d\'Ivoire', DJ: 'Djibouti', EG: 'Égypte', GQ: 'Guinée équatoriale', ER: 'Érythrée', SZ: 'Eswatini', ET: 'Éthiopie', GA: 'Gabon', GM: 'Gambie',
    GH: 'Ghana', GN: 'Guinée', GW: 'Guinée-Bissau', KE: 'Kenya', LS: 'Lesotho', LR: 'Liberia', LY: 'Libye', MG: 'Madagascar', MW: 'Malawi', ML: 'Mali', MR: 'Mauritanie', MU: 'Maurice',
    MA: 'Maroc', MZ: 'Mozambique', NA: 'Namibie', NE: 'Niger', NG: 'Nigeria', RW: 'Rwanda', ST: 'Sao Tomé-et-Principe', SN: 'Sénégal', SC: 'Seychelles', SL: 'Sierra Leone', SO: 'Somalie',
    ZA: 'Afrique du Sud', SS: 'Soudan du Sud', SD: 'Soudan', TZ: 'Tanzanie', TG: 'Togo', TN: 'Tunisie', UG: 'Ouganda', ZM: 'Zambie', ZW: 'Zimbabwe' };
  const OFFER_CURRENCIES = ['XOF', 'XAF', 'NGN', 'GHS', 'KES', 'ZAR', 'MAD', 'TND', 'DZD', 'EGP', 'RWF', 'TZS', 'UGX', 'CDF', 'GNF', 'MGA', 'MUR', 'ETB', 'ZMW', 'BWP', 'NAD', 'AOA', 'MZN',
    'GMD', 'SLE', 'LRD', 'MWK', 'SCR', 'DJF', 'KMF', 'CVE', 'STN', 'MRU', 'SDG', 'SSP', 'SOS', 'LYD', 'ERN', 'LSL', 'SZL', 'ZWL', 'BIF', 'EUR', 'USD', 'GBP'];
  /* Une devise propre à une zone n'est acceptée que dans cette zone : un prix en FCFA hors zone FCFA (ou en naira hors Nigeria) est une erreur de saisie ou une conversion. */
  const CURRENCY_HOME = { XOF: ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'], XAF: ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'], NGN: ['NG'], GHS: ['GH'], KES: ['KE'], MAD: ['MA'], ZAR: ['ZA', 'LS', 'NA', 'SZ'],
    TND: ['TN'], DZD: ['DZ'], EGP: ['EG'], RWF: ['RW'], TZS: ['TZ'], UGX: ['UG'] };
  const OFFER_AVAILABILITY = ['in_stock', 'out_of_stock', 'coming_soon', 'unknown'];
  const OFFER_TYPES = ['brand_site', 'retailer', 'pharmacy', 'marketplace', 'importer'];
  const OFFER_SHIPPING = ['local', 'international'];
  const PRODUCT_STATUS = ['validated', 'to_verify'];
  const SOURCE_KINDS = ['manufacturer', 'retailer', 'regulator', 'other'];

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
    if (!text(o.source, 160)) e.push('offre : source manquante');
    if (!isDate(o.checkedAt)) e.push('offre : date de vérification manquante');
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
  function offersOf(p) {
    if (!p || p.demo === true || !Array.isArray(p.offers)) return [];
    return p.offers.filter(o => validateOffer(o, false).length === 0).map(o => {
      const link = o.url && isRealLink(o.url) ? o.url : null;
      return { market: o.market, country: MARKETS[o.market], retailer: o.retailer, type: o.type, typeLabel: copy.OFFER_TYPE_LABELS[o.type],
        marketplace: o.type === 'marketplace', currency: o.price != null ? o.currency : (o.currency || null), price: o.price != null ? o.price : null,
        availability: o.availability, availabilityLabel: copy.OFFER_AVAILABILITY_LABELS[o.availability], shipping: o.shipping || null,
        url: link, buyable: !!(link && o.availability === 'in_stock'), linkOnly: !!(link && o.availability === 'unknown'), source: o.source, checkedAt: o.checkedAt };
    }).sort((a, b) => a.country.localeCompare(b.country, 'fr') || a.retailer.localeCompare(b.retailer, 'fr'));
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
        pool = pool.sort((a, b) => score(b) - score(a) || (skinOk(b.p, routine.skinBase) - skinOk(a.p, routine.skinBase)) || a.order - b.order);
        if (!pool.length) return;
        const p = pool[0].p, because = wanted.filter(id => ids(p).includes(id));
        out.push({ stepId: step.id, kind: step.kind, productId: p.id, activeIds: because,
          because: because.length ? copy.productBecause(because.map(id => actives.byId(id).label)) : null, demo: p.demo === true });
      });
    }
    return out;
  }

  /* « Pourquoi ce produit ? » : le rôle qu'il joue dans l'étape (dérivé de la sélection, jamais d'une donnée commerciale). */
  const whyOf = m => copy.productWhy(m.kind, (m.activeIds || []).map(id => actives.byId(id).label));

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
    const recommended = [...chosen.entries()].map(([productId, ms]) => ({ productId, steps: ms.map(m => ({ stepId: m.stepId, kind: m.kind, activeIds: m.activeIds, why: whyOf(m) })) }));
    const others = list.filter(p => !chosen.has(p.id)).map(p => {
      const relevant = steps.filter(st => fitsStep(p, st));
      let code;
      if (ids(p).some(id => ctx.excluded.has(id))) code = 'excluded';         // exclusion choisie par l'utilisatrice : la raison la plus claire
      else if (!relevant.length) code = p.category === 'serum' ? 'active_not_selected' : steps.some(st => stepCategory(st) === p.category) ? 'no_step' : 'no_step';
      else if (relevant.every(st => st.owned)) code = 'owned';
      else {
        const open = relevant.filter(st => !st.owned);
        const reasons = open.map(st => rejection(p, st, ctx));
        code = reasons.some(r => r === null) ? 'other_product_chosen' : reasons[0];
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

  return { PRODUCTS, CATEGORIES, SKIN_TYPES, AVAILABILITY, CURRENCIES, MARKETS, OFFER_CURRENCIES, OFFER_AVAILABILITY, OFFER_TYPES, PRODUCT_STATUS, byId, ids, usable, match, whyOf, catalogView, commerceOf, offersOf, validateOffer, primaryActive, validateProduct, validateCatalog,
    stepCategory, CATALOG_FIELDS, toCatalogEntry };
});
