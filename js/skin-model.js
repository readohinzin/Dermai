/* DERMAI : modèle de résultat d'analyse de peau (Perfect Corp → DERMAI).
   Fichier partagé : chargé par le navigateur (<script>, expose window.SkinModel) et par Node (require).
   Aucune dépendance, aucune configuration de module. Fonctions pures : pas de DOM, pas de réseau.

   SOURCE PARSÉE : réponse de statut AI Skin Analysis v2.1 demandée avec format = "json".
     Chemin unique : data.results.output, un TABLEAU d'éléments { type, ui_score, raw_score, mask_urls }.
   (Le format ZIP, qui contient skinanalysisResult/score_info.json, n'est pas demandé et n'est pas supporté.)

   TROIS COUCHES, JAMAIS MÉLANGÉES
   1. normalized : donnée Perfect Corp renommée. Aucun calcul DERMAI.
        { <métrique>: { rawScore, uiScore }, globalScore, skinType: { whole, tZone, uZone }, skinAge }
   2. derived    : transformations DERMAI. concernScore = 100 − rawScore (pour toute métrique ayant un rawScore).
   3. display    : adaptation à l'interface actuelle (valeurs à plat). C'est le seul endroit qui suit la convention
                   de l'interface (par exemple l'hydratation lue « plus haut = mieux »).

   RÈGLES
   - rawScore n'est jamais modifié, arrondi ni remplacé. uiScore reste indépendant, jamais utilisé à la place de rawScore.
   - Perfect Corp : score élevé = meilleure condition cutanée : globalScore ne serait jamais inversé.
   - mask_urls est ignoré : aucune URL ne quitte le serveur.
   - globalScore, skinAge et skinType : leur représentation dans data.results.output[] n'est PAS établie par une source
     officielle (ils sont documentés dans score_info.json du format ZIP). Ils restent donc null et ne sont jamais déduits.
   - skin_type en particulier : c'est une dst_action SD officielle (sous-catégories whole, t_zone, u_zone ; valeurs documentées
     Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness). C'est une classification, pas un
     score. Si la réponse contient un élément { type: "skin_type", … }, il est IGNORÉ (son nom apparaît dans ignoredTypes), quelle que
     soit sa forme, et normalized.skinType reste null. Pour l'alimenter il faudra une source officielle décrivant cet élément dans
     output[] ; il faudra alors mettre à jour ce code, la fixture et les tests (S1 à S4 de test/skin-model.test.js).
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

  /* Clés que l'interface actuelle affiche. Les autres restent dans le modèle seulement. */
  const UI_KEYS = ['acne', 'pigmentation', 'pores', 'oiliness', 'hydration', 'redness', 'texture', 'wrinkles'];

  /* Libellés français. Valeur inconnue : aucun libellé (null), jamais inventé. */
  /* Valeurs documentées de skin_type : Normal, Oily, Dry, Combination, Redness, Dry & Redness, Oily & Redness, Combination & Redness.
     Seules les quatre premières ont un libellé ; les autres donnent null (aucune traduction inventée). Inutilisé tant que
     normalized.skinType reste null avec format = "json". */
  const SKIN_TYPE_LABELS = { oily: 'Peau grasse', dry: 'Peau sèche', normal: 'Peau normale', combination: 'Peau mixte' };

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

  function parseSkinResponse(envelope) {
    const output = getPath(envelope, OUTPUT_PATH);
    if (output === undefined || output === null) return FAIL('not_found');
    if (!Array.isArray(output)) return FAIL('invalid');
    const byType = {}, ignored = [];
    for (const item of output) {
      if (!isObj(item) || typeof item.type !== 'string' || !item.type.trim()) return FAIL('invalid');
      if (!PC_KEYS.has(item.type)) { ignored.push(safeName(item.type)); continue; }
      if (has(byType, item.type)) return FAIL('ambiguous', { types: [item.type] });
      byType[item.type] = item;                       // mask_urls et tout autre champ : jamais lus
    }
    if (Object.keys(byType).length === 0) return FAIL('not_found', { ignoredTypes: ignored });
    return { status: 'ok', path: OUTPUT_PATH.join('.'), form: 'array', normalized: buildNormalized(byType), types: Object.keys(byType), ignoredTypes: [...new Set(ignored)] };
  }

  /* ---------- 2. Couche normalized : Perfect Corp renommé, sans aucun calcul ---------- */
  function emptyNormalized() {
    const n = {};
    for (const key of METRIC_KEYS) n[key] = { rawScore: null, uiScore: null };
    n.globalScore = null;                                  // non fourni dans output[] : voir l'en-tête
    n.skinType = { whole: null, tZone: null, uZone: null };  // idem
    n.skinAge = null;                                      // idem
    return n;
  }

  function buildNormalized(byType) {
    const n = emptyNormalized();
    for (const [pc, key] of METRICS) {
      if (!has(byType, pc)) continue;
      n[key].rawScore = num(byType[pc].raw_score);
      n[key].uiScore = num(byType[pc].ui_score);
    }
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

  /* ---------- 3. Couche derived : transformation DERMAI, explicite et séparée ---------- */
  /* concernScore = 100 − rawScore : plus la valeur est haute, plus la préoccupation est importante. */
  const concernScore = rawScore => (num(rawScore) === null ? null : 100 - rawScore);

  function deriveConcern(normalized) {
    const concern = {};
    for (const key of METRIC_KEYS) concern[key] = concernScore(normalized && normalized[key] ? normalized[key].rawScore : null);
    return { concernScore: concern };
  }

  /* ---------- 4. Couche display : adaptation à l'interface actuelle ----------
     `goodWhenHigh` : clés que l'interface lit déjà en « plus haut = mieux » (elle les inverse elle-même, ex. l'hydratation).
     Elles reçoivent le rawScore tel quel ; les autres reçoivent le concernScore. normalized et derived ne sont pas modifiés.
     globalScore n'est jamais inversé ; il n'est arrondi qu'ici, pour l'affichage. */
  function toDisplay(normalized, derived, { goodWhenHigh = [] } = {}) {
    const n = normalized || {}, c = (derived && derived.concernScore) || {};
    const view = {};
    const label = n.skinType && typeof n.skinType.whole === 'string' ? SKIN_TYPE_LABELS[n.skinType.whole.trim().toLowerCase()] : undefined;
    view.skinType = label || null;
    for (const key of UI_KEYS) view[key] = goodWhenHigh.includes(key) ? (n[key] ? n[key].rawScore : null) : (c[key] === undefined ? null : c[key]);
    view.global = num(n.globalScore) === null ? null : Math.round(n.globalScore);
    return view;
  }

  /* Libellés de date de l'historique (« 5 octobre », « 5 OCT »). */
  function scanLabels(date) {
    const d = date instanceof Date ? date : new Date();
    const long = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const mon = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '').toUpperCase();
    return { date: long, short: `${d.getDate()} ${mon}` };
  }

  return {
    SCHEMA_VERSION, METRICS, METRIC_KEYS, UI_KEYS, SKIN_TYPE_LABELS, OUTPUT_PATH,
    parseSkinResponse, sanitizeNormalized,
    concernScore, deriveConcern, toDisplay, scanLabels
  };
});
