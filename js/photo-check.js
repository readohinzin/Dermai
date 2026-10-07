/* Première vérification d'une photo, SUR L'APPAREIL, avant tout envoi : la photo n'est ni transmise ni conservée par cette vérification (aucun réseau, aucun stockage).
   Elle détecte les cas évidents (trop petite, quasi noire ou blanche, format panoramique) et signale les doutes (petite, sombre, surexposée, floue ; visage absent, multiple
   ou petit lorsque le navigateur sait détecter les visages). C'est une estimation prudente : le service d'analyse reste l'autorité (visage, angle, lumière) et ses refus
   sont déjà traduits en messages clairs. Seuls les cas évidents bloquent ; un doute laisse le choix à l'utilisatrice, car une analyse réelle consomme un crédit.
   Les seuils sont volontairement indulgents pour les peaux foncées : la luminosité se juge sur les hautes lumières (95e centile) et le contraste, pas sur la moyenne.
   Module partagé navigateur / Node : fonctions pures, testées sans navigateur. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DermaiPhotoCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = { hardMinSide: 320, softMinSide: 600, hardAspect: 2.5, softAspect: 2, blackP95: 25, whiteP05: 245, darkP95: 70, brightP05: 200, blurVariance: 12, faceMinRatio: 0.15 };
  const TEXT = {
    tiny: 'Cette photo est trop petite pour être analysée. Choisissez une photo plus grande.',
    format: 'Le format de cette photo est trop allongé. Choisissez une photo de portrait.',
    black: 'Cette photo est presque noire. Choisissez une photo plus lumineuse.',
    white: 'Cette photo est presque blanche. Choisissez une photo moins surexposée.',
    small: 'La photo est de petite taille : les détails de la peau peuvent manquer.',
    dark: 'La photo semble sombre : placez-vous face à une lumière douce.',
    bright: 'La photo semble très claire ou surexposée : évitez la lumière directe.',
    blur: 'La photo semble floue : gardez l\'appareil stable ou choisissez une photo plus nette.',
    noface: 'Nous ne voyons pas clairement de visage sur cette photo.',
    multi: 'Plusieurs visages semblent présents : l\'analyse doit porter sur une seule personne.',
    faceSmall: 'Le visage semble petit dans l\'image : rapprochez-vous ou recadrez.'
  };
  const SUMMARY = {
    ok: ['Photo utilisable', 'Taille, luminosité et netteté semblent correctes. Le service d\'analyse confirmera la détection du visage.'],
    warn: ['Photo à vérifier', 'Vous pouvez l\'analyser telle quelle, mais le résultat peut être moins fiable.'],
    block: ['Photo inutilisable', 'Cette photo ne peut pas être analysée.']
  };
  const percentile = (gray, p) => {
    const h = new Array(256).fill(0); for (let i = 0; i < gray.length; i++) h[gray[i]]++;
    const target = gray.length * p; let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= target) return v; } return 255;
  };
  /* Netteté : variance du laplacien sur la zone centrale (60 %), en niveaux de gris réduits. */
  function laplacianVariance(gray, w, h) {
    const x0 = Math.floor(w * 0.2), x1 = Math.ceil(w * 0.8), y0 = Math.floor(h * 0.2), y1 = Math.ceil(h * 0.8);
    let sum = 0, sum2 = 0, n = 0;
    for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const i = y * w + x, l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += l; sum2 += l * l; n++;
    }
    if (!n) return 0; const mean = sum / n; return sum2 / n - mean * mean;
  }
  /* m : { width, height (photo préparée), gray (Uint8Array), gw, gh (échantillon), faces : null (inconnu) | { count, widthRatio } } → { level, issues: [{ code, level, text }], title, body } */
  function assess(m) {
    const issues = [], add = (code, level) => issues.push({ code, level, text: TEXT[code] });
    const w = +m.width || 0, h = +m.height || 0, side = Math.min(w, h), long = Math.max(w, h);
    if (!w || !h) return { level: 'block', issues: [{ code: 'tiny', level: 'block', text: TEXT.tiny }], title: SUMMARY.block[0], body: SUMMARY.block[1] };
    if (side < T.hardMinSide) add('tiny', 'block'); else if (side < T.softMinSide) add('small', 'warn');
    const aspect = long / side; if (aspect > T.hardAspect) add('format', 'block');
    if (m.gray && m.gray.length) {
      const p05 = percentile(m.gray, 0.05), p95 = percentile(m.gray, 0.95);
      if (p95 < T.blackP95) add('black', 'block'); else if (p05 > T.whiteP05) add('white', 'block');
      else if (p95 < T.darkP95) add('dark', 'warn'); else if (p05 > T.brightP05) add('bright', 'warn');
      if (m.gw > 8 && m.gh > 8 && laplacianVariance(m.gray, m.gw, m.gh) < T.blurVariance && !issues.some(i => i.level === 'block')) add('blur', 'warn');
    }
    if (m.faces && typeof m.faces.count === 'number') {
      if (m.faces.count === 0) add('noface', 'warn'); else if (m.faces.count > 1) add('multi', 'warn');
      else if (m.faces.widthRatio > 0 && m.faces.widthRatio < T.faceMinRatio) add('faceSmall', 'warn');
    }
    const level = issues.some(i => i.level === 'block') ? 'block' : issues.length ? 'warn' : 'ok';
    return { level, issues, title: SUMMARY[level][0], body: SUMMARY[level][1] };
  }
  return { T, TEXT, assess, laplacianVariance, percentile };
});
