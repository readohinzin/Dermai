/* Vérif'Routine : analyse PURE d'une routine de produits saisis par l'utilisateur. Aucun réseau, aucun stockage, aucune horloge, aucune IA.
   Entrées : produits { id, name, category, slots, inci[], origin, irritated } (voir cleanProduct) ; données : fiches d'actifs (data/actives.js : actifs, cautions,
   fréquences de départ, CONFLICT_RULES, EXCLUDED) et alias INCI justifiés (data/inci-aliases.js).

   Principes (voir aussi le cahier de réalisation) :
   - Le NOM d'un produit ne dit jamais sa composition. Sans liste INCI, la composition est « inconnue » et rien n'est déduit.
   - Un ingrédient absent des alias reste « non reconnu » : aucune fonction, aucun risque, aucune efficacité ne lui est attribués.
   - Chaque point d'attention vient d'une règle EXPLICITE (R1 à R5, prudence EXCLUDED, information saisie par l'utilisateur) et porte son motif, sa source et son niveau de
     validation. Aucun point n'est une conclusion médicale, aucun n'affirme qu'un produit est sûr ou efficace.
   - Un produit à plusieurs actifs n'a jamais de fréquence globale : la fréquence ne vient que de la fiche d'UN actif ciblé validé, comme repère de départ, jamais comme
     instruction du fabricant. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode ? { data: require('./data/actives.js'), aliases: require('./data/inci-aliases.js') }
    : { data: (root.DermaiEngine || {}).activesData, aliases: (root.DermaiEngine || {}).inciAliases };
  const api = factory(dep);
  if (isNode) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.verif = api; }
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';
  const data = dep.data, AL = dep.aliases;
  const MAX_PRODUCTS = 20, MAX_INCI = 150, MAX_NAME = 80, MAX_TOKEN = 80;
  const SLOTS = ['morning', 'evening'];
  const SLOT_LABEL = { morning: 'le matin', evening: 'le soir' };
  /* Ordre d'affichage : celui de la routine DERMAI (nettoyant, soin ciblé, hydratant, protection solaire) ; « Autre » : ordre selon la notice du produit. */
  const CATEGORIES = [['cleanser', 'Nettoyant'], ['serum', 'Sérum ou soin ciblé'], ['moisturizer', 'Hydratant'], ['spf', 'Protection solaire'], ['other', 'Autre']];
  const CATEGORY_KEYS = CATEGORIES.map(c => c[0]);
  const LEVEL_LABEL = { prudence: 'Prudence', precaution: 'Précaution', to_validate: 'À valider', info: 'Information', missing: 'Information manquante' };
  const LEVEL_RANK = { prudence: 0, precaution: 1, to_validate: 2, info: 3, missing: 4 };
  const DISCLAIMER = 'Repères d\'information cosmétique, fondés uniquement sur les fiches et les règles DERMAI et sur les compositions que vous avez confirmées. Ce n\'est pas un avis médical, et DERMAI ne promet pas qu\'un produit soit sûr ou efficace.';

  const activeById = id => data.ACTIVES.find(a => a.id === id) || null;
  const ruleById = id => data.CONFLICT_RULES.find(r => r.id === id) || null;
  const text = s => (typeof s === 'string' ? s : '');

  /* Nom d'ingrédient comparable : minuscules, sans accents, sans pourcentage ni astérisque, espaces simples. */
  const normalizeName = raw => text(raw).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ').replace(/[*†‡]+/g, ' ').replace(/\s+/g, ' ').trim();

  const BY_KEY = new Map(AL.ALIASES.map(x => [x.key, x]));
  const EXCL_BY_NAME = new Map(AL.EXCLUDED_NAMES.flatMap(e => e.names.map(n => [n, e])));

  /* Découpe d'une liste INCI saisie : séparateurs virgule, point-virgule, retour à la ligne, puce, barre ; préfixe « Ingrédients : » ignoré ; doublons retirés. */
  function parseInci(input) {
    let s = text(input).replace(/^\s*(?:ingr[ée]dients?|inci|composition)\s*:\s*/i, '');
    const parts = s.split(/[,;\n\r•·|]+/).map(x => x.replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim()).filter(Boolean);
    const seen = new Set(), tokens = [];
    let tooLong = false;
    for (const p of parts) {
      const t = p.length > MAX_TOKEN ? (tooLong = true, p.slice(0, MAX_TOKEN)) : p, k = normalizeName(t);
      if (!k || seen.has(k)) continue;
      seen.add(k); tokens.push(t);
    }
    return { tokens: tokens.slice(0, MAX_INCI), truncated: tokens.length > MAX_INCI, tooLong };
  }

  /* Reconnaissance d'UN ingrédient : correspondance exacte (nom complet, puis nom sans parenthèses). Sinon « unknown », sans autre déduction. */
  function recognize(raw) {
    const full = normalizeName(text(raw).replace(/[()]/g, ' ')), base = normalizeName(text(raw).replace(/\([^)]*\)/g, ' '));
    for (const k of [full, base]) {
      const ex = EXCL_BY_NAME.get(k);
      if (ex) return { raw, kind: 'excluded', excludedId: ex.id, validation: ex.validation, source: ex.source };
      const al = BY_KEY.get(k);
      if (al) return { raw, kind: 'active', activeId: al.activeId, validation: al.validation, source: al.source };
    }
    return { raw, kind: 'unknown' };
  }

  /* Produit nettoyé (lecture du stockage, saisie) : null si inutilisable. Rien n'est complété ni déduit. */
  function cleanProduct(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const id = text(p.id), name = text(p.name).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(id) || !name || name.length > MAX_NAME) return null;
    const slots = SLOTS.filter(s => Array.isArray(p.slots) && p.slots.includes(s));
    if (!slots.length) return null;
    const inci = [], seen = new Set();
    for (const t of (Array.isArray(p.inci) ? p.inci : [])) {
      const v = text(t).replace(/\s+/g, ' ').trim().slice(0, MAX_TOKEN), k = normalizeName(v);
      if (!k || seen.has(k) || inci.length >= MAX_INCI) continue;
      seen.add(k); inci.push(v);
    }
    const o = p.origin && typeof p.origin === 'object' ? p.origin : {};
    const origin = o.kind === 'catalog' && inci.length && /^[a-z0-9][a-z0-9_-]{1,60}$/i.test(text(o.productId))
      ? { kind: 'catalog', productId: o.productId, label: text(o.label).slice(0, 120), checkedAt: /^\d{4}-\d{2}-\d{2}$/.test(text(o.checkedAt)) ? o.checkedAt : '' }
      : { kind: 'user' };
    return { id, name, category: CATEGORY_KEYS.includes(p.category) ? p.category : 'other', slots, inci, origin, irritated: p.irritated === true };
  }

  const cautionsOf = a => (a.cautions || []).filter(c => c && !/^Aucune précaution/i.test(c));

  /* Analyse d'un produit : ce que DERMAI reconnaît, ce qu'il ne reconnaît pas, les précautions des fiches, le repère de fréquence (un seul actif ciblé validé). */
  function analyzeProduct(p) {
    const tokens = p.inci.map(recognize);
    const ids = [...new Set(tokens.filter(t => t.kind === 'active').map(t => t.activeId))];
    const actives = ids.map(activeById).filter(Boolean);
    const excluded = [], seenEx = new Set();
    for (const t of tokens) if (t.kind === 'excluded' && !seenEx.has(t.excludedId)) { seenEx.add(t.excludedId); excluded.push({ id: t.excludedId, raw: t.raw }); }
    const treat = actives.filter(a => a.kind === 'treatment');
    let frequency;
    if (!p.inci.length) frequency = { kind: 'unknown' };
    else if (treat.length >= 2) frequency = { kind: 'multiple', labels: treat.map(a => a.label) };
    else if (treat.length === 1 && treat[0].status === 'validated' && treat[0].introduction && treat[0].introduction.frequency) {
      frequency = { kind: 'single', activeId: treat[0].id, label: treat[0].label, text: treat[0].introduction.frequency, note: treat[0].introduction.note || '' };
    } else if (treat.length === 1) frequency = { kind: 'unvalidated', label: treat[0].label };
    else frequency = { kind: 'none' };
    return {
      id: p.id, known: p.inci.length > 0, tokens, actives, excluded,
      unknown: tokens.filter(t => t.kind === 'unknown').map(t => t.raw),
      cautions: actives.map(a => ({ activeId: a.id, label: a.label, texts: cautionsOf(a), status: a.status })).filter(c => c.texts.length),
      frequency
    };
  }

  const evidenceLabel = a => ({ sourced: 'sources consultées', partial: 'sources partielles', to_add: 'source à ajouter, fiche à valider' })[a && a.evidence && a.evidence.sourceStatus] || 'niveau de preuve non précisé';
  const names = list => list.map(p => `« ${p.name} »`).join(', ');
  const point = (id, rule, level, title, body, productIds, why) => ({ id, rule, level, levelLabel: LEVEL_LABEL[level], title, text: body, productIds, why });

  /* Analyse de la routine entière : produits analysés + points d'attention. `products` : produits nettoyés. */
  function analyze(products) {
    const list = (Array.isArray(products) ? products : []).map(cleanProduct).filter(Boolean).slice(0, MAX_PRODUCTS);
    const an = new Map(list.map(p => [p.id, analyzeProduct(p)]));
    const points = [];

    /* Prudence : substances de la liste EXCLUDED (message neutre, aucune recommandation supplémentaire). */
    for (const p of list) for (const ex of an.get(p.id).excluded) {
      points.push(point(`EXCL:${p.id}:${ex.id}`, 'EXCLUDED', 'prudence', `Substance sans conseil DERMAI dans « ${p.name} »`,
        `« ${ex.raw} » fait partie des substances sur lesquelles DERMAI ne donne pas de conseil. Demandez l'avis d'un professionnel (pharmacien, médecin).`, [p.id],
        { rule: 'Liste EXCLUDED du moteur DERMAI : substances pour lesquelles DERMAI ne conseille pas.', source: 'js/engine/data/actives.js (EXCLUDED) ; correspondance par nom INCI exact', validation: 'Liste de prudence DERMAI ; correspondance des noms à relire par un professionnel' }));
    }
    /* Information saisie par l'utilisateur : produit qui l'a déjà irrité. Aucune conclusion sur la cause. */
    for (const p of list.filter(x => x.irritated)) {
      points.push(point(`IRR:${p.id}`, 'USER', 'prudence', `« ${p.name} » vous a déjà irrité(e)`,
        `Vous avez indiqué que ce produit vous a déjà irrité(e). En cas de gêne persistante, arrêtez de l'utiliser et demandez conseil à un professionnel de santé.`, [p.id],
        { rule: 'Information saisie par vous : DERMAI ne cherche pas la cause et ne tire aucune conclusion.', source: 'Votre saisie (stockée dans ce navigateur)', validation: 'Information déclarative, sans validation' }));
    }

    /* R2 : un seul exfoliant ou rétinoïde par soir (règle strong_evening, utilisée seulement si elle est « validated », comme dans le moteur). Compte les PRODUITS du soir. */
    const strong = ruleById('strong_evening');
    if (strong && strong.status === 'validated') {
      const evening = list.filter(p => p.slots.includes('evening') && an.get(p.id).actives.some(a => (a.groups || []).includes(strong.group)));
      if (evening.length > strong.max) {
        const labels = [...new Set(evening.flatMap(p => an.get(p.id).actives.filter(a => (a.groups || []).includes(strong.group)).map(a => a.label)))];
        points.push(point('R2', 'R2', 'precaution', 'Plusieurs exfoliants ou rétinoïdes le même soir',
          `Le soir, ${evening.length} de vos produits contiennent un exfoliant ou un rétinoïde reconnu (${labels.join(', ')}) : ${names(evening)}. Règle DERMAI : « ${strong.text} » Vous pouvez en garder un seul pour le soir ou les utiliser des soirs différents ; suivez aussi la notice de chaque produit.`,
          evening.map(p => p.id),
          { rule: strong.text, source: 'Règle strong_evening du moteur DERMAI (js/engine/data/actives.js)', validation: 'Règle validée (statut « validated »)' }));
      }
    }

    /* R3 : protection solaire. Seulement si la fiche d'un actif reconnu porte elle-même une précaution « protection solaire » ET qu'aucun produit déclaré « Protection solaire » n'est placé le matin. */
    const sunItems = [], sunProducts = new Set();
    for (const p of list) for (const c of an.get(p.id).cautions) {
      const t = c.texts.find(x => /protection solaire/i.test(x));
      if (t) { sunProducts.add(p.id); if (!sunItems.some(i => i.activeId === c.activeId)) sunItems.push({ activeId: c.activeId, label: c.label, text: t }); }
    }
    if (sunItems.length && !list.some(p => p.category === 'spf' && p.slots.includes('morning'))) {
      const ids = list.filter(p => sunProducts.has(p.id)).map(p => p.id);
      const evid = sunItems.map(i => `${i.label} : ${evidenceLabel(activeById(i.activeId))}`).join(' ; ');
      points.push(point('R3', 'R3', 'precaution', 'Protection solaire non indiquée pour le matin',
        `Selon les fiches DERMAI : ${sunItems.map(i => `${i.label} (« ${i.text} »)`).join(' ; ')}. Aucun produit de protection solaire n'est indiqué pour le matin dans votre routine. Si vous en utilisez un, ajoutez-le ici : DERMAI ne peut pas juger une protection qu'il ne connaît pas.`,
        ids, { rule: 'Précaution reprise telle quelle de la fiche de l\'actif ; affichée seulement si aucun produit déclaré « Protection solaire » n\'est placé le matin. DERMAI ne suppose pas qu\'un autre produit protège du soleil.', source: 'Fiches DERMAI des actifs (champ cautions)', validation: `Niveau des fiches : ${evid}` }));
    }

    /* R5 : vitamine C et rétinoïde au même moment. Règle à valider : aucune conclusion. */
    const vcr = ruleById('vitamin_c_retinoid');
    if (vcr) for (const slot of SLOTS) {
      const inSlot = list.filter(p => p.slots.includes(slot)), vc = inSlot.filter(p => an.get(p.id).actives.some(a => a.id === 'vitamin_c')), rt = inSlot.filter(p => an.get(p.id).actives.some(a => a.id === 'retinoid'));
      if (vc.length && rt.length) {
        const involved = [...new Map([...vc, ...rt].map(p => [p.id, p])).values()], validated = vcr.status === 'validated';
        points.push(point(`R5:${slot}`, 'R5', validated ? 'precaution' : 'to_validate', `Vitamine C et rétinoïde ${SLOT_LABEL[slot]}`,
          `${SLOT_LABEL[slot][0].toUpperCase() + SLOT_LABEL[slot].slice(1)}, votre routine réunit de la vitamine C et un rétinoïde (${names(involved)}). ${validated ? vcr.text : 'Cette association est débattue : DERMAI n\'a pas validé de règle à ce sujet et n\'en tire aucune conclusion.'} En cas de doute, suivez la notice des produits ou demandez conseil à un professionnel.`,
          involved.map(p => p.id), { rule: vcr.text, source: 'Règle vitamin_c_retinoid du moteur DERMAI (js/engine/data/actives.js)', validation: validated ? 'Règle validée' : 'À valider : statut « à_valider », non établie' }));
      }
    }

    /* R1 : actif ciblé présent dans plusieurs produits. Information neutre, jamais une incompatibilité. Les ingrédients de soutien (hydratants) ne sont pas signalés. */
    const byActive = new Map();
    for (const p of list) for (const a of an.get(p.id).actives) if (a.kind === 'treatment') byActive.set(a.id, [...(byActive.get(a.id) || []), p]);
    for (const [id, ps] of byActive) if (ps.length >= 2) {
      const a = activeById(id);
      points.push(point(`R1:${id}`, 'R1', 'info', `${a.label} dans ${ps.length} produits`,
        `${a.label} figure dans : ${names(ps)}. Ce n'est pas une incompatibilité : DERMAI signale seulement ce cumul pour que vous vérifiiez qu'il est voulu.`, ps.map(p => p.id),
        { rule: 'Règle d\'information R1 : un actif ciblé présent dans plusieurs produits est signalé, sans jugement ni conclusion.', source: 'Fiches DERMAI des actifs et compositions que vous avez confirmées', validation: 'Information neutre, aucune règle de sécurité' }));
    }

    /* R4 : composition inconnue ou sans aucun ingrédient reconnu : vérification impossible ou limitée. */
    for (const p of list) {
      const x = an.get(p.id);
      if (!x.known) points.push(point(`R4:${p.id}`, 'R4', 'missing', `Composition inconnue : « ${p.name} »`,
        `La composition de « ${p.name} » est inconnue : DERMAI ne peut rien vérifier pour ce produit. Saisissez la liste INCI figurant sur l'emballage pour la vérifier.`, [p.id],
        { rule: 'DERMAI ne déduit jamais la composition d\'un produit à partir de son nom.', source: 'Produit enregistré sans liste INCI', validation: 'Vérification impossible' }));
      else if (!x.tokens.some(t => t.kind !== 'unknown')) points.push(point(`R4:${p.id}`, 'R4', 'missing', `Aucun ingrédient reconnu : « ${p.name} »`,
        `Aucun ingrédient de « ${p.name} » n'est reconnu par DERMAI : la vérification est limitée à ce que DERMAI documente. Les ingrédients non reconnus ne sont ni bons ni mauvais : DERMAI n'a simplement pas de fiche.`, [p.id],
        { rule: 'Un ingrédient absent des alias DERMAI reste « non reconnu » : aucune fonction ni aucun risque ne lui est attribué.', source: 'Alias INCI DERMAI (js/engine/data/inci-aliases.js)', validation: 'Vérification limitée' }));
    }

    points.sort((x, y) => LEVEL_RANK[x.level] - LEVEL_RANK[y.level]);
    return { products: list.map(p => an.get(p.id)), points };
  }

  /* Vue matin / soir : produits d'un créneau dans l'ordre DERMAI des catégories ; « Autre » à la fin (ordre selon la notice). */
  function bySlot(products, slot) {
    const rank = c => CATEGORY_KEYS.indexOf(c);
    return (products || []).filter(p => p.slots.includes(slot)).map((p, i) => ({ p, i })).sort((x, y) => rank(x.p.category) - rank(y.p.category) || x.i - y.i).map(x => x.p);
  }

  return { MAX_PRODUCTS, MAX_INCI, MAX_NAME, MAX_TOKEN, SLOTS, SLOT_LABEL, CATEGORIES, LEVEL_LABEL, DISCLAIMER, normalizeName, parseInci, recognize, cleanProduct, analyzeProduct, analyze, bySlot, activeById };
});
