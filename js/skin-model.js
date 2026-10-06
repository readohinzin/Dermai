/* DERMAI : modèle de résultat d'analyse de peau (Perfect Corp → DERMAI).
   Fichier partagé : chargé par le navigateur (<script>, expose window.SkinModel) et par Node (require).
   Aucune dépendance, aucune configuration de module. Fonctions pures : pas de DOM, pas de réseau.

   SOURCE PARSÉE : réponse de statut AI Skin Analysis v2.1 demandée avec format = "json".
     Chemin unique : data.results.output, un TABLEAU d'éléments.
   (Le format ZIP, qui contient skinanalysisResult/score_info.json, n'est pas demandé et n'est pas supporté.)

   ÉLÉMENTS LUS (formes confirmées par l'OpenAPI officiel https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.json) :
     - 15 métriques : { type, ui_score, raw_score, mask_urls }                      → normalized.<métrique>.{rawScore, uiScore}
     - skin_type    : { type: "skin_type", region: "whole" | "t_zone" | "u_zone", skin_type: "<valeur>" }
                      un élément par région → normalized.skinType.{whole, tZone, uZone} (champ `skin_type` seul ; aucun score)
     - all          : { type: "all", score }                                         → normalized.globalScore (champ `score` seul)
     - skin_age     : { type: "skin_age", score }                                    → normalized.skinAge     (champ `score` seul)
     L'OpenAPI documente ces formes avec « hd_skin_type » ; la documentation décrit la même structure pour l'action SD `skin_type`.
     Tout autre type (dont resize_image) est ignoré. mask_urls, url et tout champ non listé ne sont jamais lus.

   DEUX COUCHES
   1. normalized : donnée Perfect Corp renommée. Aucun calcul DERMAI.
        { <métrique>: { rawScore, uiScore }, globalScore, skinType: { whole, tZone, uZone }, skinAge }
   2. affichage  : toResultView, compareScans, globalSeries (section « Modèle de score de l'interface »). Une seule échelle,
        0 à 100, 100 = meilleur, lue dans uiScore (métriques) et globalScore (global). rawScore n'est jamais utilisé à l'affichage.

   RÈGLES
   - rawScore n'est jamais modifié, arrondi ni remplacé : donnée technique, ni affichée ni utilisée en repli de uiScore.
   - Perfect Corp : score élevé = meilleure condition cutanée : globalScore ne serait jamais inversé.
   - mask_urls et url sont ignorés : aucune URL ne quitte le serveur.
   - globalScore (all.score), skinAge (skin_age.score) et skinType : alimentés seulement par les formes ci-dessus. Absents ou invalides,
     ils restent null. raw_score et ui_score ne sont jamais utilisés pour all, skin_age ni skin_type.
   - skin_type est une classification (valeurs documentées : Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness,
     Combination & Redness), pas un score.
   - Un même élément all, skin_age, ou skin_type d'une même région répété = résultat ambigu (comme pour les 15 métriques).
   - Validation générique unique : un nombre fini est conservé tel quel ; null, undefined, texte, NaN, Infinity valent null.
     Aucune plage 0-100 n'est imposée (non établie par le contrat Perfect Corp).
   - Une valeur absente vaut null : jamais inventée, jamais copiée d'une autre métrique. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkinModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  /* Correspondance clé Perfect Corp → clé DERMAI. Source de vérité unique. */
  const METRICS = [
    ['acne', 'acne'],
    ['pore', 'pores'],
    ['oiliness', 'oiliness'],
    ['texture', 'texture'],
    ['moisture', 'hydration'],
    ['redness', 'redness'],
    ['age_spot', 'pigmentation'],
    ['wrinkle', 'wrinkles'],
    ['firmness', 'firmness'],
    ['radiance', 'radiance'],
    ['eye_bag', 'eyeBag'],
    ['tear_trough', 'tearTrough'],
    ['dark_circle_v2', 'darkCircle'],
    ['droopy_upper_eyelid', 'droopyUpperEyelid'],
    ['droopy_lower_eyelid', 'droopyLowerEyelid']
  ];
  const METRIC_KEYS = METRICS.map(m => m[1]);
  const PC_KEYS = new Set(METRICS.map(m => m[0]));

  /* Libellés français des 8 valeurs documentées de skin_type (clé = valeur en minuscules, espaces simplifiés).
     Valeur inconnue : aucun libellé (null), jamais inventé. `desc` : description neutre de l'aspect, sans conseil ni diagnostic. */
  const SKIN_TYPE_LABELS = {
    normal: 'Peau normale',
    oily: 'Peau grasse',
    dry: 'Peau sèche',
    combination: 'Peau mixte',
    redness: 'Tendance aux rougeurs',
    'dry & redness': 'Peau sèche avec tendance aux rougeurs',
    'oily & redness': 'Peau grasse avec tendance aux rougeurs',
    'combination & redness': 'Peau mixte avec tendance aux rougeurs'
  };
  const SKIN_TYPE_DESC = {
    normal: 'Aspect plutôt équilibré.',
    oily: 'Aspect plutôt brillant.',
    dry: 'Aspect plutôt sec.',
    combination: 'Certaines zones du visage ont un aspect différent des autres.',
    redness: 'Des rougeurs sont visibles.',
    'dry & redness': 'Aspect plutôt sec, avec des rougeurs visibles.',
    'oily & redness': 'Aspect plutôt brillant, avec des rougeurs visibles.',
    'combination & redness': 'Zones d\'aspect différent, avec des rougeurs visibles.'
  };
  const skinTypeKey = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : '');

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /* Seule règle de validation générique : nombre fini → conservé tel quel, sinon null. */
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  /* Texte court seulement (limite défensive de taille des données renvoyées, pas une règle Perfect Corp). */
  const text = v => (typeof v === 'string' && v.trim() && v.length <= 40 ? v.trim() : null);

  /* ---------- 1. Lecture de la réponse de statut (format = "json") ----------
     Chemin officiel unique : data.results.output. Aucun autre chemin, aucun parcours libre de l'enveloppe, aucun repli.
     Statuts (jamais d'exception, jamais de choix arbitraire) :
       ok         : tableau lu, au moins une métrique connue
       not_found  : data.results.output absent, ou aucune métrique connue dedans
       invalid    : data.results.output n'est pas un tableau, ou un élément n'est pas { type: texte non vide, … }
       ambiguous  : une même métrique connue apparaît plusieurs fois
     Les éléments dont le type n'est pas dans METRICS sont ignorés (leur nom est renvoyé dans ignoredTypes pour les logs :
     c'est ainsi que l'on découvrira la représentation éventuelle de skin_type ou de all dans le tableau). */
  const OUTPUT_PATH = ['data', 'results', 'output'];
  const safeName = t => (/^[A-Za-z0-9_.-]{1,40}$/.test(t) ? t : '<autre>');

  function getPath(envelope, path) {
    let n = envelope;
    for (const k of path) {
      if (!isObj(n) || !has(n, k)) return undefined;
      n = n[k];
    }
    return n;
  }

  const FAIL = (status, extra) => Object.assign({ status, path: OUTPUT_PATH.join('.'), normalized: null, types: [], ignoredTypes: [] }, extra || {});

  /* Région de skin_type (clé Perfect Corp) → clé DERMAI. */
  const SKIN_TYPE_REGIONS = { whole: 'whole', t_zone: 'tZone', u_zone: 'uZone' };

  function parseSkinResponse(envelope) {
    const output = getPath(envelope, OUTPUT_PATH);
    if (output === undefined || output === null) return FAIL('not_found');
    if (!Array.isArray(output)) return FAIL('invalid');
    const byType = {}, ignored = [];
    const extras = { skinType: { whole: null, tZone: null, uZone: null }, globalScore: null, skinAge: null };
    const read = new Set();                                 // types spéciaux lus (skin_type, all, skin_age)
    const seenRegions = new Set();
    for (const item of output) {
      if (!isObj(item) || typeof item.type !== 'string' || !item.type.trim()) return FAIL('invalid');
      const t = item.type;
      if (t === 'skin_type') {
        const region = item.region;
        if (typeof region !== 'string' || !has(SKIN_TYPE_REGIONS, region)) { ignored.push(`skin_type@${safeName(typeof region === 'string' ? region : '?')}`); continue; }
        if (seenRegions.has(region)) return FAIL('ambiguous', { types: ['skin_type'] });
        seenRegions.add(region); read.add('skin_type');
        extras.skinType[SKIN_TYPE_REGIONS[region]] = text(item.skin_type);       // valeur du champ skin_type ; invalide → null
        continue;
      }
      if (t === 'all' || t === 'skin_age') {
        if (read.has(t)) return FAIL('ambiguous', { types: [t] });
        read.add(t);
        if (t === 'all') extras.globalScore = num(item.score); else extras.skinAge = num(item.score);   // champ score seul
        continue;
      }
      if (!PC_KEYS.has(t)) { ignored.push(safeName(t)); continue; }
      if (has(byType, t)) return FAIL('ambiguous', { types: [t] });
      byType[t] = item;                               // mask_urls, url et tout autre champ : jamais lus
    }
    if (Object.keys(byType).length === 0) return FAIL('not_found', { ignoredTypes: [...new Set(ignored)] });   // au moins une des 15 métriques est requise
    return { status: 'ok', path: OUTPUT_PATH.join('.'), form: 'array', normalized: buildNormalized(byType, extras),
      types: [...Object.keys(byType), ...read], ignoredTypes: [...new Set(ignored)] };
  }

  /* ---------- 2. Couche normalized : Perfect Corp renommé, sans aucun calcul ---------- */
  function emptyNormalized() {
    const n = {};
    for (const key of METRIC_KEYS) n[key] = { rawScore: null, uiScore: null };
    n.globalScore = null;                                  // élément { type: "all", score }
    n.skinType = { whole: null, tZone: null, uZone: null };  // éléments { type: "skin_type", region, skin_type }
    n.skinAge = null;                                      // élément { type: "skin_age", score }
    return n;
  }

  function buildNormalized(byType, extras) {
    const n = emptyNormalized();
    for (const [pc, key] of METRICS) {
      if (!has(byType, pc)) continue;
      n[key].rawScore = num(byType[pc].raw_score);
      n[key].uiScore = num(byType[pc].ui_score);
    }
    if (extras) { n.globalScore = extras.globalScore; n.skinType = extras.skinType; n.skinAge = extras.skinAge; }
    return n;
  }

  /* Contrôle d'un résultat reçu du backend (navigateur) : reconstruit la forme attendue, ignore tout champ inconnu.
     Renvoie null si la version du schéma n'est pas celle attendue. */
  function sanitizeNormalized(result) {
    if (!isObj(result) || result.schemaVersion !== SCHEMA_VERSION || !isObj(result.normalized)) return null;
    const src = result.normalized, n = emptyNormalized();
    for (const key of METRIC_KEYS) {
      if (!isObj(src[key])) continue;
      n[key].rawScore = num(src[key].rawScore);
      n[key].uiScore = num(src[key].uiScore);
    }
    n.globalScore = num(src.globalScore);
    if (isObj(src.skinType)) n.skinType = { whole: text(src.skinType.whole), tZone: text(src.skinType.tZone), uZone: text(src.skinType.uZone) };
    n.skinAge = num(src.skinAge);
    return n;
  }

  /* ---------- 3. Modèle de score de l'interface (écran Résultat) ----------
     Entrée : normalized seulement. Aucune connaissance de Perfect Corp au-delà des noms de champs déjà renommés.
     Échelle unique : 0 à 100, 100 = meilleur état.
       - métriques : uiScore, tel que reçu. rawScore n'est jamais lu ici (donnée technique, ni affichée, ni utilisée en repli).
       - global    : globalScore, tel que reçu. Jamais recalculé à partir des métriques, jamais inversé.
     Un score absent, non numérique ou hors de 0 à 100 est « indisponible » (score null) : jamais remplacé, jamais borné.
     Seul l'arrondi à l'entier est appliqué, pour l'affichage. */
  const BANDS = [
    { key: 'good', label: 'Bien', min: 61 },
    { key: 'mid', label: 'À soutenir', min: 31 },
    { key: 'low', label: 'À surveiller', min: 0 }
  ];
  const METRIC_LABELS = {
    acne: 'Acné', pores: 'Pores', oiliness: 'Sébum', texture: 'Texture', hydration: 'Hydratation', redness: 'Rougeurs',
    pigmentation: 'Pigmentation', wrinkles: 'Rides', firmness: 'Fermeté', radiance: 'Radiance', eyeBag: 'Poches',
    tearTrough: 'Vallée des larmes', darkCircle: 'Cernes', droopyUpperEyelid: 'Paupière supérieure', droopyLowerEyelid: 'Paupière inférieure'
  };
  const PRIORITY_COUNT = 3;

  /* Score affichable : entier de 0 à 100, ou null. */
  function displayScore(v) {
    const n = num(v);
    return n === null || n < 0 || n > 100 ? null : Math.round(n);
  }
  /* Bande du score affiché (même entier que celui montré à l'utilisateur) : 61 à 100 Bien, 31 à 60 À soutenir, 0 à 30 À surveiller. */
  function scoreBand(v) {
    const s = displayScore(v);
    if (s === null) return null;
    const b = BANDS.find(x => s >= x.min);
    return { key: b.key, label: b.label };
  }
  const scoreView = v => { const score = displayScore(v), band = scoreBand(v); return { score, band: band ? band.key : null, bandLabel: band ? band.label : null }; };
  /* Âge cutané : nombre fini entre 1 et 120, arrondi. Sinon null (aucune carte). */
  function displayAge(v) {
    const n = num(v);
    return n === null || n < 1 || n > 120 ? null : Math.round(n);
  }

  /* Données de l'écran Résultat. Priorités : les PRIORITY_COUNT scores affichables les plus bas (100 = meilleur), égalités départagées par
     l'ordre fixe de METRICS. C'est un tri des scores tels qu'affichés, sans score de sévérité caché. Les autres métriques suivent dans
     l'ordre fixe de METRICS ; une métrique indisponible n'entre jamais dans les priorités. */
  function toResultView(normalized) {
    const n = isObj(normalized) ? normalized : {};
    const metrics = METRIC_KEYS.map((key, order) => Object.assign({ key, order, label: METRIC_LABELS[key] },
      scoreView(isObj(n[key]) ? n[key].uiScore : null)));
    const ranked = metrics.filter(m => m.score !== null).sort((a, b) => a.score - b.score || a.order - b.order);
    const priorities = ranked.slice(0, PRIORITY_COUNT);
    const chosen = new Set(priorities.map(m => m.key));
    const whole = isObj(n.skinType) ? skinTypeKey(n.skinType.whole) : '';
    return {
      global: scoreView(n.globalScore),
      skinType: SKIN_TYPE_LABELS[whole] ? { label: SKIN_TYPE_LABELS[whole], description: SKIN_TYPE_DESC[whole] } : null,
      skinAge: displayAge(n.skinAge),
      priorities,
      others: metrics.filter(m => !chosen.has(m.key))
    };
  }

  /* ---------- 4. Évolution entre deux analyses (écran Progression) ----------
     Même échelle et même validité que ci-dessus. Évolution = après − avant, sur les entiers affichés (100 = meilleur : + = mieux).
     Plus de TREND_STEP : Amélioration ; entre −TREND_STEP et +TREND_STEP inclus : Stable ; moins de −TREND_STEP : Baisse.
     TREND_STEP = 2 est une convention d'interface DERMAI, pas une règle Perfect Corp.
     Si le score manque dans l'une des deux analyses (absent, invalide ou hors plage) : indisponible, jamais 0 ni autre valeur. */
  const TREND_STEP = 2;
  const TREND_LABELS = { up: 'Amélioration', same: 'Stable', down: 'Baisse' };
  function compareScores(before, after) {
    const b = displayScore(before), a = displayScore(after);
    if (b === null || a === null) return { available: false, before: b, after: a, delta: null, trend: null, trendLabel: null };
    const delta = a - b, trend = delta > TREND_STEP ? 'up' : delta < -TREND_STEP ? 'down' : 'same';
    return { available: true, before: b, after: a, delta, trend, trendLabel: TREND_LABELS[trend] };
  }
  function compareScans(from, to) {
    const A = isObj(from) ? from : {}, B = isObj(to) ? to : {};
    return {
      global: compareScores(A.globalScore, B.globalScore),
      metrics: METRIC_KEYS.map(key => Object.assign({ key, label: METRIC_LABELS[key] },
        compareScores(isObj(A[key]) ? A[key].uiScore : null, isObj(B[key]) ? B[key].uiScore : null)))
    };
  }
  /* Score global de chaque analyse, dans l'ordre reçu : entier 0-100, ou null. Un null reste null (jamais 0, jamais un point inventé). */
  const globalSeries = list => (Array.isArray(list) ? list : []).map(n => displayScore(isObj(n) ? n.globalScore : null));

  /* Libellés de date de l'historique (« 5 octobre », « 5 OCT »). */
  function scanLabels(date) {
    const d = date instanceof Date ? date : new Date();
    const long = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const mon = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '').toUpperCase();
    return { date: long, short: `${d.getDate()} ${mon}` };
  }

  return {
    SCHEMA_VERSION, METRICS, METRIC_KEYS, SKIN_TYPE_LABELS, OUTPUT_PATH, BANDS, METRIC_LABELS,
    parseSkinResponse, sanitizeNormalized,
    scanLabels,
    displayScore, scoreBand, displayAge, toResultView, TREND_STEP, compareScores, compareScans, globalSeries, skinTypeKey
  };
});
