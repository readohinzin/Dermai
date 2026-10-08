/* DERMAI : carte du visage. Superpose sur la VRAIE photo analysée les masques RÉELS renvoyés par Perfect Corp (server/masks.js).

   Un seul indicateur à la fois : seuls ses masques réels sont superposés. Aucune étiquette, aucun trait, aucun contour n'est ajouté par
   DERMAI : le seul dessin est le masque du fournisseur (remplissage selon son opacité relative, liseré clair au bord de sa zone à
   mi-hauteur de son propre maximum). Lecture des masques semi-transparents : voir interpretMask.

   Règle absolue : aucune zone n'est jamais inventée. Ce module ne connaît ni les scores, ni les priorités, ni le type de peau, ni le
   pays : il reçoit des images de masque et les dessine telles quelles, ou ne dessine rien.
     - masque absent, illisible, au format non reconnu, ou de proportions différentes de la photo → rien n'est dessiné ;
     - le masque est étiré exactement comme la photo (même boîte, mêmes proportions vérifiées) : aucun décalage possible ;
     - la couleur et l'opacité sont fixes (propriété de l'interface), jamais liées au score.
   Rien n'est stocké : ni photo, ni masque, ni dans le navigateur, ni dans l'historique (cache en mémoire seulement).

   Fichier partagé : fonctions pures testées sous Node (sanitize, interpretMask, paint, ratioMatches) ; mount() n'existe qu'au navigateur. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DermaiFaceMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
  const MAX_PER_KEY = 4, MAX_LEN = 2.2 * 1024 * 1024;
  const COLOR = [224, 112, 143];          // rose-corail DERMAI (remplissage)
  const EDGE_COLOR = [255, 246, 248];     // liseré clair, lisible sur toutes les carnations
  const FILL = 0.42, EDGE = 0.95;         // opacités fixes (jamais liées au score)

  /* Réponse du serveur → { clé: [dataURL…] } pour les seules clés de métrique connues. Tout le reste est écarté. null si vide. */
  function sanitize(loc, keys) {
    if (!loc || typeof loc !== 'object' || Array.isArray(loc)) return null;
    const out = {};
    for (const k of keys) {
      const v = loc[k];
      if (!Array.isArray(v)) continue;
      const list = v.filter(s => typeof s === 'string' && s.length <= MAX_LEN && DATA_URL.test(s)).slice(0, MAX_PER_KEY);
      if (list.length) out[k] = list;
    }
    return Object.keys(out).length ? out : null;
  }

  /* Même proportion (tolérance 1 %) : condition pour superposer sans déformation ni décalage. */
  function ratioMatches(pw, ph, mw, mh, tol = 0.01) {
    if (!(pw > 0 && ph > 0 && mw > 0 && mh > 0)) return false;
    return Math.abs((pw / ph) / (mw / mh) - 1) <= tol;
  }

  /* Lecture d'un masque (pixels RGBA). Deux formes reconnues, sinon « unknown » (rien ne sera dessiné) :
       alpha     : fond transparent, la zone est la partie non transparente ;
       luminance : image opaque en niveaux de gris sur fond sombre, la zone est la partie claire.
     Une image en couleurs opaque (une photo, une superposition déjà colorée…) n'est pas un masque lisible : refusée.

     Vrais masques Perfect Corp (mesurés sur une vraie analyse, étape 26.1) : PNG de la taille de la photo, fond transparent, zones
     colorées SEMI-TRANSPARENTES (14 masques sur 15 sans aucun pixel opaque ; plusieurs sans aucun pixel à la moitié d'opacité).
     L'opacité est donc lue comme une valeur CONTINUE, jamais coupée à 50 % (ancien seuil 128, qui déclarait vides de vraies zones).
     Perfect Corp ne documente pas le sens d'une opacité faible : tout ce qui suit est une lecture technique pour l'AFFICHAGE, jamais une
     gravité ni une décision (le moteur ne lit pas les masques).

     Grandeurs (n = nombre de pixels du masque, a = opacité 0-255 de chaque pixel) :
       floor    : seuil de bruit = la valeur qui définit déjà le FOND dans chaque mode (alpha : a < 16, « transparent » ; luminance :
                  moyenne < 31, « sombre »). Un pixel sous ce seuil est un bord anti-crénelé ou un fond : il reste peint (remplissage
                  proportionnel), mais il ne compte pas comme présence d'une zone.
       present  : nombre de pixels au-dessus du seuil de bruit (zone réellement dessinée par le fournisseur).
       peak     : opacité maximale du masque.
       coverage : couverture pondérée par l'opacité = somme(a) / (255 × n). Continue, elle ne perd aucune zone semi-transparente.
       area     : part des pixels à au moins la moitié du MAXIMUM DU MASQUE (a ≥ peak / 2) : étendue de la zone à mi-hauteur, utilisée
                  pour le contour et pour refuser un masque qui couvre tout le cadre (> 90 %).
     Classement (level) :
       empty    : moins de pixels présents que l'aire d'UN pixel d'écran à la plus grande taille d'affichage de la carte
                  (FRAME_MAX_CSS px de large) : (largeur du masque / FRAME_MAX_CSS)², au moins 1. Rien ne serait visible : masque vide.
       faint    : zone présente, mais aucun pixel n'atteint la moitié de l'opacité maximale possible (peak < 128) : zone faible mais réelle ;
       visible  : zone présente avec au moins un pixel à la moitié de l'opacité ou plus. */
  const FRAME_MAX_CSS = 560;                     // largeur maximale de la carte (css/components/face-map.css, .c-facemap__frame)
  const FLOOR = { alpha: 16, luminance: 31 };    // mêmes valeurs que la détection du fond ci-dessous
  function interpretMask(px, w, h) {
    const n = w * h;
    if (!n || !px || px.length < n * 4) return { mode: 'unknown' };
    let transparent = 0, colored = 0, dark = 0;
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
      if (a < FLOOR.alpha) transparent++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored++;
      if ((r + g + b) / 3 < FLOOR.luminance) dark++;
    }
    const alpha = new Uint8ClampedArray(n);
    let mode;
    if (transparent / n >= 0.2) { mode = 'alpha'; for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3]; }
    else if (colored / n <= 0.03 && dark / n >= 0.5) { mode = 'luminance'; for (let i = 0; i < n; i++) alpha[i] = Math.round((px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3); }
    else return { mode: 'unknown' };
    const floor = FLOOR[mode];
    let sum = 0, present = 0, peak = 0;
    for (let i = 0; i < n; i++) { const a = alpha[i]; sum += a; if (a >= floor) present++; if (a > peak) peak = a; }
    if (mode === 'luminance') for (let i = 0; i < n; i++) if (alpha[i] < floor) alpha[i] = 0;   // fond sombre (bruit de compression) : jamais peint
    const half = Math.max(floor, Math.ceil(peak / 2));
    let wide = 0;for (let i = 0; i < n; i++) if (alpha[i] >= half) wide++;
    const coverage = sum / (255 * n), area = wide / n;
    if (area > 0.9) return { mode: 'unknown' };                       // « tout le cadre » : pas un masque de zone
    const minPresent = Math.max(1, Math.pow(w / FRAME_MAX_CSS, 2));
    const level = present < minPresent ? 'empty' : peak < 128 ? 'faint' : 'visible';
    return { mode, alpha, coverage, area, present, peak, half, level, empty: level === 'empty' };
  }

  /* Zone → pixels RGBA, à la manière d'une cartographie : remplissage rose léger + liseré clair au bord de la zone réelle.
     Couleurs et opacités de base fixes (jamais liées au score).
     Remplissage : proportionnel à l'opacité du masque RAPPORTÉE À SON PROPRE MAXIMUM (a / peak) : la forme et les nuances relatives du
     masque sont conservées, et une zone que le fournisseur a dessinée semi-transparente reste lisible sur la photo (sinon un masque à 30 %
     d'opacité serait rendu à 0,42 × 30 % ≈ 13 %, invisible sur une peau foncée). Un masque déjà opaque est rendu comme avant.
     Contour : au bord de la zone à mi-hauteur de SON maximum (a ≥ half), jamais à un seuil absolu : une zone semi-transparente garde son
     contour. Les pixels de bord anti-crénelé (sous la mi-hauteur) sont remplis, sans contour. */
  function paint(alpha, w, h, peak, half) {
    const out = new Uint8ClampedArray(w * h * 4);
    let pk = peak;if (!(pk > 0)) { pk = 0; for (let i = 0; i < w * h; i++) if (alpha[i] > pk) pk = alpha[i]; }
    if (!pk) return out;
    const hf = half > 0 ? half : Math.max(1, Math.ceil(pk / 2));
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);
    const rad = Math.max(1, Math.round(Math.min(w, h) / 220));   // liseré visible quelle que soit la résolution du masque
    const near = (x, y) => { for (let d = 1; d <= rad; d++) if (at(x - d, y) < hf || at(x + d, y) < hf || at(x, y - d) < hf || at(x, y + d) < hf) return true; return false; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i];
      if (!a) continue;
      const edge = a >= hf && near(x, y), c = edge ? EDGE_COLOR : COLOR;
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2];
      out[i * 4 + 3] = Math.round(255 * (edge ? EDGE : FILL * Math.min(1, a / pk)));
    }
    return out;
  }

  /* ---------- navigateur ---------- */
  const cache = new Map();   // dataURL → résultat déjà interprété (mémoire seulement)
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load')); i.src = src; });

  /* Interprète un masque à la taille de la photo. Résultat : { ok, canvas, mode } ou { ok:false, reason }. */
  async function prepare(src, pw, ph) {
    const key = src + '|' + pw + 'x' + ph;
    if (cache.has(key)) return cache.get(key);
    let r;
    try {
      const im = await loadImg(src);
      const mw = im.naturalWidth, mh = im.naturalHeight;
      if (!ratioMatches(pw, ph, mw, mh)) r = { ok: false, reason: 'ratio' };
      else {
        const c = document.createElement('canvas'); c.width = mw; c.height = mh;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
        const m = interpretMask(g.getImageData(0, 0, mw, mh).data, mw, mh);
        if (m.mode === 'unknown') r = { ok: false, reason: 'format' };
        else if (m.empty) r = { ok: false, reason: 'empty' };
        else {
          const z = document.createElement('canvas'); z.width = mw; z.height = mh;
          z.getContext('2d').putImageData(new ImageData(paint(m.alpha, mw, mh, m.peak, m.half), mw, mh), 0, 0);
          r = { ok: true, canvas: z, mode: m.mode, level: m.level };
        }
      }
    } catch (e) { r = { ok: false, reason: 'load' }; }
    cache.set(key, r);
    return r;
  }

  /* el : conteneur [data-facemap] (photo <img>, <canvas>). items : [{ key, label, masks }] : l'indicateur sélectionné et ses masques réels.
     onStatus(échecs, vides) : libellés dont la localisation n'a pas pu être affichée (masque illisible, proportions…), puis libellés dont
     les masques sont lisibles mais ne contiennent aucune zone. Rien d'autre n'est dessiné. */
  async function mount(el, { items, hidden, onStatus }) {
    const img = el.querySelector('img'), cv = el.querySelector('canvas');
    if (!img || !cv) return;
    if (!img.complete || !img.naturalWidth) await new Promise(r => { img.onload = r; img.onerror = r; });
    const pw = img.naturalWidth, ph = img.naturalHeight;
    if (!pw || !ph) { onStatus && onStatus((items || []).map(i => i.label)); return; }
    cv.width = pw; cv.height = ph;
    const g = cv.getContext('2d'); g.clearRect(0, 0, pw, ph);
    const done = await Promise.all((items || []).map(async it => ({ it, res: await Promise.all((it.masks || []).map(m => prepare(m, pw, ph))) })));
    if (!el.isConnected) return;
    let drawn = 0;const failed = [], empty = [];
    for (const { it, res } of done) {
      const good = res.filter(r => r.ok);
      /* Aucun masque dessinable : « vide » si tous les masques reçus sont lisibles mais sans zone, sinon échec (illisible, proportions…). */
      if (!good.length) { (res.length && res.every(r => r.reason === 'empty') ? empty : failed).push(it.label); continue; }
      if (!hidden) for (const r of good) { g.drawImage(r.canvas, 0, 0, pw, ph); drawn++; }   // même boîte que la photo : alignement exact
    }
    el.dataset.drawn = String(drawn);
    onStatus && onStatus(failed, empty);
  }

  return { sanitize, ratioMatches, interpretMask, paint, mount, COLOR, EDGE_COLOR, FILL, EDGE, FLOOR, FRAME_MAX_CSS };
});
