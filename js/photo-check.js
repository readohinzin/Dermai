/* Première vérification d'une photo, SUR L'APPAREIL, avant tout envoi : la photo n'est ni transmise ni conservée par cette vérification (aucun réseau, aucun stockage).
   Elle détecte les cas évidents (trop petite, quasi noire ou blanche, format panoramique) et signale les doutes (petite, sombre, surexposée, floue ; visage absent, multiple
   ou petit lorsque le navigateur sait détecter les visages). C'est une estimation prudente : le service d'analyse reste l'autorité (visage, angle, lumière) et ses refus
   sont déjà traduits en messages clairs. Seuls les cas évidents bloquent ; un doute laisse le choix à l'utilisatrice, car une analyse réelle consomme un crédit.
   Les seuils sont volontairement indulgents pour les peaux foncées : la luminosité se juge sur les hautes lumières (95e centile) et le contraste, pas sur la moyenne.
   LOT 6 (peaux foncées) : « photo à refaire » plutôt qu'un résultat quand la qualité rend l'analyse peu fiable. Bloquent (niveau « block », titre « Photo à refaire », aucun envoi) :
   trop petite, format panoramique, presque noire ou blanche, TROP sombre, TROP surexposée, TROP floue, visage en grande partie dans l'ombre. Avertissent seulement (l'utilisatrice décide) : un peu
   sombre, un peu surexposée, un peu floue, contre-jour probable, lumière inégale, petite taille, visage absent, multiple ou petit. Le visage détecté ne bloque JAMAIS : un détecteur peut se tromper
   plus souvent sur une peau foncée, et un refus à tort bloquerait justement les personnes que DermAI cherche à bien servir. Sur iPhone (Safari), aucun détecteur de visage n'existe : le visage est alors
   confirmé par le service d'analyse, après l'envoi.
   LIMITES : tous les seuils sont PROVISOIRES, réglés sur des échantillons synthétiques, jamais sur de vraies photos (à calibrer avec le jeu de photos consenties, tâche 7). Un filtre « beauté »
   ou un éclairage jaune d'intérieur ne se détectent pas de façon fiable à partir de la seule luminosité : ils sont déconseillés (conseils), pas contrôlés.
   Module partagé navigateur / Node : fonctions pures, testées sans navigateur. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.DermaiPhotoCheck = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = { hardMinSide: 320, softMinSide: 600, hardAspect: 2.5, softAspect: 2, blackP95: 25, whiteP05: 245, darkP95: 70, brightP05: 200, blurVariance: 12, faceMinRatio: 0.15,
    /* lot 6 : seuils « à refaire » (provisoires) */
    veryDarkP95: 45, veryBrightP05: 225, veryBlurVariance: 1,
    /* lumière inégale : écart relatif des deux moitiés du visage ; contre-jour : fond / visage, et peu de relief dans le visage */
    unevenWarn: 0.4, unevenBlock: 0.7, backlightRatio: 2, backlightRange: 0.7 };
  const TEXT = {
    tiny: 'Cette photo est trop petite pour être analysée. Choisissez une photo plus grande.',
    format: 'Le format de cette photo est trop allongé. Choisissez une photo de portrait.',
    black: 'Cette photo est presque noire. Choisissez une photo plus lumineuse.',
    white: 'Cette photo est presque blanche. Choisissez une photo moins surexposée.',
    verydark: 'La photo est beaucoup trop sombre pour analyser la peau. Placez-vous face à une fenêtre, en lumière du jour.',
    verybright: 'La photo est surexposée : la peau n\'a plus de détails. Évitez le soleil direct et le flash.',
    veryblur: 'La photo est trop floue pour voir la peau. Tenez l\'appareil à deux mains sans bouger et nettoyez l\'objectif.',
    unevenHard: 'Un côté du visage est dans l\'ombre : le résultat serait faussé. Placez-vous face à la fenêtre, la lumière doit arriver de face.',
    uneven: 'Un côté du visage est nettement plus éclairé que l\'autre. Placez-vous face à la lumière.',
    backlight: 'Le visage semble à contre-jour : la lumière vient de derrière vous. Tournez-vous face à la fenêtre.',
    small: 'La photo est de petite taille : les détails de la peau peuvent manquer.',
    dark: 'La photo semble sombre : placez-vous face à une lumière douce.',
    bright: 'La photo semble très claire ou surexposée : évitez la lumière directe.',
    blur: 'La photo semble floue : gardez l\'appareil stable ou choisissez une photo plus nette.',
    noface: 'Nous ne voyons pas clairement de visage sur cette photo.',
    multi: 'Plusieurs visages semblent présents : l\'analyse doit porter sur une seule personne.',
    faceSmall: 'Le visage semble petit dans l\'image : rapprochez-vous ou recadrez.'
  };
  /* Conseils de prise de photo, affichés avant et pendant la prise : [icône, titre, texte]. */
  const TIPS = [
    ['sun', 'Lumière du jour, de face', 'Face à une fenêtre, sans contre-jour : la lumière doit arriver sur votre visage.'],
    ['sparkle', 'Aucun filtre, aucun mode beauté', 'Votre peau doit apparaître telle qu\'elle est : un filtre efface justement ce que l\'analyse doit voir.'],
    ['face', 'Visage de face, expression neutre', 'À bout de bras, à hauteur des yeux, sans sourire, cheveux dégagés du front et des joues.'],
    ['glasses', 'Lunettes retirées, peau nue', 'Sans lunettes ni maquillage si possible, pour voir le contour des yeux et la vraie peau.'],
    ['camera', 'Une seule personne, appareil stable', 'Seul(e) dans l\'image, appareil bien tenu, objectif propre.']
  ];
  const SUMMARY = {
    ok: ['Photo utilisable', 'Taille, luminosité et netteté semblent correctes. Le service d\'analyse confirmera la détection du visage.'],
    warn: ['Photo à vérifier', 'Vous pouvez l\'analyser telle quelle, mais le résultat peut être moins fiable.'],
    block: ['Photo à refaire', 'Une analyse sur cette photo ne serait pas fiable. Refaites-la : lumière du jour de face, sans filtre ni contre-jour.']
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
  /* Statistiques d'une zone rectangulaire de l'échantillon (fractions de la largeur / hauteur) : { mean, p05, p95 } ou null. */
  function zone(gray, gw, gh, x0, x1, y0, y1) {
    const vals = [];
    for (let y = Math.floor(gh * y0); y < Math.ceil(gh * y1); y++) for (let x = Math.floor(gw * x0); x < Math.ceil(gw * x1); x++) vals.push(gray[y * gw + x]);
    if (!vals.length) return null;
    const u = Uint8Array.from(vals); let s = 0; for (let i = 0; i < u.length; i++) s += u[i];
    return { mean: s / u.length, p05: percentile(u, 0.05), p95: percentile(u, 0.95) };
  }
  /* Éclairage du visage, par rapport au centre de l'image (un portrait est cadré au centre) : lumière inégale (moitié gauche / moitié droite) et contre-jour
     (fond bien plus clair que le visage, ET peu de relief dans le visage). Le contre-jour n'avertit que : peau foncée sur mur clair = rapport élevé sans contre-jour, donc jamais de blocage. */
  function lighting(gray, gw, gh) {
    const L = zone(gray, gw, gh, 0.28, 0.5, 0.25, 0.7), R = zone(gray, gw, gh, 0.5, 0.72, 0.25, 0.7), C = zone(gray, gw, gh, 0.3, 0.7, 0.25, 0.7);
    const top = zone(gray, gw, gh, 0, 1, 0, 0.12), left = zone(gray, gw, gh, 0, 0.12, 0, 1), right = zone(gray, gw, gh, 0.88, 1, 0, 1);
    if (!L || !R || !C || !top || !left || !right) return null;
    const uneven = Math.abs(L.mean - R.mean) / Math.max(L.mean, R.mean, 1);
    const ring = (top.mean + left.mean + right.mean) / 3;
    const range = (C.p95 - C.p05) / Math.max(C.mean, 1);
    return { uneven, ring: ring / Math.max(C.mean, 1), range };
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
      else if (p95 < T.veryDarkP95) add('verydark', 'block'); else if (p05 > T.veryBrightP05) add('verybright', 'block');
      else if (p95 < T.darkP95) add('dark', 'warn'); else if (p05 > T.brightP05) add('bright', 'warn');
      if (m.gw > 8 && m.gh > 8 && !issues.some(i => i.level === 'block')) {
        const lap = laplacianVariance(m.gray, m.gw, m.gh);
        if (lap < T.veryBlurVariance) add('veryblur', 'block'); else if (lap < T.blurVariance) add('blur', 'warn');
        const lt = lighting(m.gray, m.gw, m.gh);
        if (lt) {
          if (lt.uneven >= T.unevenBlock) add('unevenHard', 'block'); else if (lt.uneven >= T.unevenWarn) add('uneven', 'warn');
          if (lt.ring >= T.backlightRatio && lt.range < T.backlightRange) add('backlight', 'warn');
        }
      }
    }
    if (m.faces && typeof m.faces.count === 'number') {
      if (m.faces.count === 0) add('noface', 'warn'); else if (m.faces.count > 1) add('multi', 'warn');
      else if (m.faces.widthRatio > 0 && m.faces.widthRatio < T.faceMinRatio) add('faceSmall', 'warn');
    }
    const level = issues.some(i => i.level === 'block') ? 'block' : issues.length ? 'warn' : 'ok';
    return { level, issues, title: SUMMARY[level][0], body: SUMMARY[level][1] };
  }
  return { T, TEXT, TIPS, assess, laplacianVariance, percentile, lighting };
});
