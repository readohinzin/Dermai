/* DermAI : niveau de CONFIANCE de chaque mesure. Calculé par DermAI, jamais fourni par le service d'analyse (Perfect Corp ne donne aucune confiance par mesure).

   CE QUE C'EST : un repère PROVISOIRE de prudence, pas une mesure. Il combine (1) une base par mesure, (2) la qualité de la photo contrôlée sur l'appareil (js/photo-check.js : photo un peu sombre,
   floue, lumière inégale…), (3) le teint choisi (rougeur peu fiable sur peau foncée). Les règles sont éditoriales et n'ont jamais été calibrées avec de vraies photos (tâche « jeu de test », lot 9) :
   « confiance élevée » n'est donc JAMAIS affichée (HIGH_ENABLED = false) tant que ce n'est pas fait.
   NIVEAUX : 2 moyenne, 1 faible, 0 peu fiable pour cette photo (la mesure est alors MASQUÉE : copie d'affichage, jamais la donnée enregistrée, comme la rougeur sur peau foncée).
   - Photo non vérifiée (analyse enregistrée, vérification impossible) : on le dit, et on ne dépasse pas « moyenne ».
   - Une mesure masquée vaut null (« donnée indisponible ») : rien n'est inventé ni copié d'une autre mesure.
   Le contrôle de la photo n'est gardé qu'en mémoire, par analyse (WeakMap) : jamais écrit, jamais envoyé.
   Module partagé navigateur / Node. Chargé après skin-model.js, photo-check.js, skin-tone.js. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode ? { skin: require('./skin-model.js'), tone: require('./skin-tone.js') } : { skin: root.SkinModel, tone: root.DermaiTone };
  const api = factory(dep);
  if (isNode) module.exports = api; else root.DermaiConfidence = api;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';

  const HIGH_ENABLED = false;
  const LABEL = { 2: 'Confiance moyenne', 1: 'Confiance faible', 0: 'Peu fiable pour cette photo' };
  const BADGE = { 2: 'c-badge--mid', 1: 'c-badge--low', 0: 'c-badge--error' };

  /* Base par mesure (provisoire, éditoriale) : les mesures du contour des yeux et les cernes sont les plus sensibles (ombres, reflets, teint). */
  const LOW_BASE = ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
  const baseOf = id => (LOW_BASE.includes(id) ? 1 : 2);

  /* Effet de chaque doute de photo (codes de photo-check.js) : mesures concernées (« * » = toutes) et phrase affichée. */
  const DETAIL = ['acne', 'pores', 'texture', 'pigmentation', 'redness', 'wrinkles', 'firmness', 'radiance', 'darkCircle'];
  const EFFECT = {
    dark: [DETAIL, 'La photo est un peu sombre.'], bright: [['redness', 'pigmentation', 'radiance', 'darkCircle'], 'La photo est un peu surexposée.'],
    blur: [['acne', 'pores', 'texture', 'wrinkles', 'firmness'], 'La photo est un peu floue.'], uneven: ['*', 'La lumière est inégale sur le visage.'],
    backlight: ['*', 'Le visage semble à contre-jour.'], small: [['pores', 'texture', 'wrinkles'], 'La photo est de petite taille.'],
    noface: ['*', 'Le visage n\'a pas été détecté sur la photo.'], multi: ['*', 'Plusieurs visages semblent présents.'], faceSmall: ['*', 'Le visage est petit dans l\'image.']
  };
  const TEXT = {
    title: 'Fiabilité de cette analyse',
    intro: 'DermAI calcule lui-même cette confiance : le service d\'analyse n\'en fournit pas. Ce n\'est pas une mesure mais un repère de prudence, provisoire : il n\'a pas encore été vérifié avec de vraies photos de différents teints.',
    unverified: 'La qualité de la photo n\'a pas pu être vérifiée pour cette analyse.',
    deepRedness: 'La mesure de rougeur est peu fiable sur peau foncée.',
    lowBase: 'Mesure sensible aux ombres et aux reflets.',
    summary: 'Voir le détail par mesure',
    unreliableBanner: 'Plusieurs mesures sont peu fiables pour cette photo : elles sont masquées. Refaites la photo en lumière du jour, de face, sans filtre ni contre-jour.',
    hiddenNote: 'Analyse peu fiable pour cette photo : mesure masquée.'
  };

  /* Contrôle de photo par analyse (en mémoire seulement). */
  const store = new WeakMap();
  const isObj = v => v !== null && typeof v === 'object';
  function note(normalized, photoCheck) {
    if (!isObj(normalized)) return;
    const issues = isObj(photoCheck) && Array.isArray(photoCheck.issues) ? photoCheck.issues.map(i => i && i.code).filter(c => typeof c === 'string') : [];
    store.set(normalized, isObj(photoCheck) ? { known: true, level: photoCheck.level, codes: [...new Set(issues)] } : { known: false, level: null, codes: [] });
  }
  const infoOf = normalized => (isObj(normalized) && store.get(normalized)) || { known: false, level: null, codes: [] };
  const affects = (code, id) => { const e = EFFECT[code]; return !!e && (e[0] === '*' || e[0].includes(id)); };

  /* Confiance d'UNE mesure. tone : teint choisi (1 à 10) ou null. */
  function assessMetric(id, info, tone) {
    let level = baseOf(id);
    const reasons = [];
    if (level === 1) reasons.push(TEXT.lowBase);
    if (!info.known) reasons.push(TEXT.unverified);
    for (const code of info.codes) if (affects(code, id)) { level -= 1; reasons.push(EFFECT[code][1]); }
    if (id === 'redness' && dep.tone && dep.tone.isDeep(tone)) { level = 0; reasons.push(TEXT.deepRedness); }
    level = Math.max(0, Math.min(HIGH_ENABLED ? 3 : 2, level));
    return { id, level, label: LABEL[level], badge: BADGE[level], reasons, hidden: level === 0 };
  }
  const hasScore = (normalized, id) => isObj(normalized) && isObj(normalized[id]) && dep.skin.displayScore(normalized[id].uiScore) !== null;

  /* Mesures présentes que cette analyse ne doit pas afficher. Branché sur skin-tone.js (view) : toute lecture de la donnée passe par la copie masquée. */
  function hiddenIds(normalized, tone) {
    if (!isObj(normalized)) return [];
    const t = tone === undefined && dep.tone ? dep.tone.get() : tone, info = infoOf(normalized);
    return dep.skin.METRIC_KEYS.filter(id => hasScore(normalized, id) && assessMetric(id, info, t).hidden);
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  /* Encart « Fiabilité de cette analyse » : une ligne par mesure reçue (confiance, ou « peu fiable » si masquée), avec la raison. scan : l'analyse affichée ; '' sans donnée. */
  function card(scan, tone) {
    const n = isObj(scan) ? scan.normalized : null;
    if (!isObj(n)) return '';
    const t = tone === undefined && dep.tone ? dep.tone.get() : tone, info = infoOf(n);
    const rows = dep.skin.METRIC_KEYS.filter(id => hasScore(n, id)).map(id => assessMetric(id, info, t));
    if (!rows.length) return '';
    const count = l => rows.filter(r => r.level === l).length, hidden = count(0);
    const main = rows.filter(r => !LOW_BASE.includes(r.id));
    const bad = main.filter(r => r.hidden).length >= 3;
    const sum = [count(2) ? count(2) + ' en confiance moyenne' : '', count(1) ? count(1) + ' en confiance faible' : '', hidden ? hidden + ' peu fiable' + (hidden > 1 ? 's (masquées)' : ' (masquée)') : ''].filter(Boolean).join(', ');
    /* « photo non vérifiée » se dit une fois, au-dessus : pas répétée sur chaque ligne */
    const li = r => { const why = r.reasons.filter(x => x !== TEXT.unverified); return '<li style="display:block"><span class="c-indicator__name">' + esc(dep.skin.METRIC_LABELS[r.id]) + '</span> <span class="c-badge ' + r.badge + '">' + esc(r.label) + '</span>' +
      (why.length ? '<br><span class="muted">' + esc(why.join(' ')) + '</span>' : '') + '</li>'; };
    return '<section class="c-insight" data-confidence aria-labelledby="conf-title"><p class="kicker">Confiance</p><div class="hd"><h2 class="h3" id="conf-title">' + esc(TEXT.title) + '</h2></div>' +
      (bad ? '<div class="c-notice c-notice--error u-my-5" role="alert" data-confidence-bad><div><span class="c-notice__title">Analyse peu fiable pour cette photo</span>' + esc(TEXT.unreliableBanner) + '</div></div>' : '') +
      '<p class="c-insight__text">' + esc(sum) + '.</p>' + (info.known ? '' : '<p class="muted" data-confidence-unverified>' + esc(TEXT.unverified) + '</p>') + '<p class="c-disclaimer">' + esc(TEXT.intro) + '</p>' +
      '<details class="c-why"><summary>' + esc(TEXT.summary) + '</summary><ul class="l-list" style="margin-top:8px">' + rows.map(li).join('') + '</ul></details></section>';
  }

  if (dep.tone && dep.tone.addMasker) dep.tone.addMasker((normalized, tone) => hiddenIds(normalized, tone));

  return { HIGH_ENABLED, LABEL, TEXT, EFFECT, LOW_BASE, baseOf, note, infoOf, assessMetric, hiddenIds, card };
});
