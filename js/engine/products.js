/* Couche PRODUITS : relie un pas de routine à des produits d'un catalogue, par activeId (jamais par texte libre).
   Dernière couche de la chaîne  MESURE → INTERPRÉTATION → PRIORITÉ → ACTIF → ROUTINE → PRODUIT : un produit est une CONSÉQUENCE de la routine.
   Il ne crée aucune priorité, ne change aucun score, ne influence ni le choix de l'actif ni la routine. Aucun score, aucun pourcentage de
   « correspondance ». Ordre déterministe : ingrédients recherchés présents, puis type de peau, puis ordre du catalogue. En mode confort, un produit
   contenant un actif plus exigeant que celui du pas n'est pas proposé.

   DEUX CATALOGUES, JAMAIS MÉLANGÉS : le catalogue de démonstration (data/products.js, produits `demo: true`) et le catalogue réel (data/catalog.js,
   vide tant qu'aucune donnée vérifiée n'existe). L'appelant choisit le catalogue ; sans choix, le moteur utilise la démonstration (tests).

   MODÈLE D'UN PRODUIT (voir validateProduct) :
     éditorial (décidé par DERMAI) : id, name, brand, category, ingredients [{ activeId | null, label }], skinTypes, targets, description, active, demo
     commercial (jamais inventé, nul tant qu'il n'est pas vérifié) : availability, price { amount, currency }, priceSource, priceCheckedAt, vendor, url, image
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
  const CURRENCIES = ['XOF', 'EUR'];                                        // XOF = FCFA (marché cible) ; aucune conversion entre devises

  const byId = (id, catalog) => (catalog || PRODUCTS).find(p => p.id === id) || null;
  const ids = p => p.ingredients.map(i => i.activeId).filter(Boolean);
  const demanding = id => { const a = actives.byId(id); return !!a && a.irritation !== 'low'; };
  const strong = id => { const a = actives.byId(id); return !!a && a.groups.length > 0; };
  const skinOk = (p, base) => !base || p.skinTypes.includes('all') || p.skinTypes.includes(base);
  /* Un produit désactivé (`active: false`) n'est ni recommandé ni listé. */
  const usable = catalog => (catalog || PRODUCTS).filter(p => p && p.active !== false);

  /* ---------- Validation du modèle ---------- */
  const isHttps = u => { try { const x = new URL(u); return x.protocol === 'https:' && u.length <= 500; } catch (e) { return false; } };
  const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && !Number.isNaN(Date.parse(d));
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
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
    // données commerciales : nulles tant qu'elles ne sont pas vérifiées
    if (p.availability != null && !AVAILABILITY.includes(p.availability)) e.push('disponibilité invalide');
    if (p.vendor != null && !text(p.vendor, 80)) e.push('vendeur invalide');
    if (p.url != null && !isHttps(p.url)) e.push('lien d\'achat invalide (https obligatoire)');
    if (p.price != null) {
      if (typeof p.price !== 'object' || !(Number.isFinite(p.price.amount) && p.price.amount > 0) || !CURRENCIES.includes(p.price.currency)) e.push('prix invalide');
      else if (p.demo !== true && !(text(p.priceSource, 120) && isDate(p.priceCheckedAt))) e.push('un prix réel exige sa source et sa date de relevé');
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
  function commerceOf(p) {
    const real = p && p.demo !== true;
    const availability = p && AVAILABILITY.includes(p.availability) ? p.availability : null;
    const price = real && p.price && Number.isFinite(p.price.amount) && p.price.amount > 0 && CURRENCIES.includes(p.price.currency) && p.priceSource && isDate(p.priceCheckedAt)
      ? { amount: p.price.amount, currency: p.price.currency, source: p.priceSource, checkedAt: p.priceCheckedAt } : null;
    const url = real && p.url && isHttps(p.url) ? p.url : null;
    return { availability, availabilityLabel: copy.AVAILABILITY_LABELS[availability || 'unknown'], price, vendor: real && p.vendor ? p.vendor : null, url,
      buyable: !!(url && availability === 'available') };
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

  return { PRODUCTS, CATEGORIES, SKIN_TYPES, AVAILABILITY, CURRENCIES, byId, ids, usable, match, whyOf, catalogView, commerceOf, primaryActive, validateProduct, validateCatalog,
    stepCategory, CATALOG_FIELDS, toCatalogEntry };
});
