/* DERMAI : carte du visage. Superpose sur la VRAIE photo analysée les masques RÉELS renvoyés par Perfect Corp (server/masks.js).

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
       alpha     : fond transparent, la zone est la partie opaque ;
       luminance : image opaque en niveaux de gris sur fond sombre, la zone est la partie claire.
     Une image en couleurs opaque (une photo, une superposition déjà colorée…) n'est pas un masque lisible : refusée. */
  function interpretMask(px, w, h) {
    const n = w * h;
    if (!n || !px || px.length < n * 4) return { mode: 'unknown' };
    let transparent = 0, colored = 0, dark = 0;
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], a = px[i * 4 + 3];
      if (a < 16) transparent++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) colored++;
      if ((r + g + b) / 3 < 31) dark++;
    }
    const alpha = new Uint8ClampedArray(n);
    let mode;
    if (transparent / n >= 0.2) { mode = 'alpha'; for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3]; }
    else if (colored / n <= 0.03 && dark / n >= 0.5) { mode = 'luminance'; for (let i = 0; i < n; i++) alpha[i] = Math.round((px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3); }
    else return { mode: 'unknown' };
    let on = 0;for (let i = 0; i < n; i++) if (alpha[i] >= 128) on++;
    const coverage = on / n;
    if (coverage > 0.9) return { mode: 'unknown' };                  // « tout le cadre » : pas un masque de zone
    return { mode, alpha, coverage, empty: on === 0 };
  }

  /* Zone → pixels RGBA, à la manière d'une cartographie : remplissage rose léger + liseré clair au bord de la zone réelle.
     Couleurs et opacités fixes (jamais liées au score). */
  function paint(alpha, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);
    const rad = Math.max(1, Math.round(Math.min(w, h) / 220));   // liseré visible quelle que soit la résolution du masque
    const near = (x, y) => { for (let d = 1; d <= rad; d++) if (at(x - d, y) < 128 || at(x + d, y) < 128 || at(x, y - d) < 128 || at(x, y + d) < 128) return true; return false; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, a = alpha[i];
      if (!a) continue;
      const edge = a >= 128 && near(x, y), c = edge ? EDGE_COLOR : COLOR;
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2];
      out[i * 4 + 3] = Math.round(255 * (edge ? EDGE : FILL * a / 255));
    }
    return out;
  }

  /* Point d'accroche d'une étiquette : un VRAI pixel de la zone (jamais un centre géométrique qui pourrait tomber hors de la zone).
     side < 0 : étiquette à gauche → pixel de la zone le plus proche du bord gauche de sa boîte, à mi-hauteur ; side > 0 : à droite.
     Renvoie aussi le centre de masse (sert seulement à choisir le côté). Coordonnées normalisées 0..1. null si zone vide. */
  function zoneGeometry(alpha, w, h) {
    const st = Math.max(1, Math.floor(Math.min(w, h) / 200));
    let x0 = w, x1 = -1, y0 = h, y1 = -1, sx = 0, sy = 0, n = 0;
    for (let y = 0; y < h; y += st) for (let x = 0; x < w; x += st) if (alpha[y * w + x] >= 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; sx += x; sy += y; n++; }
    if (!n) return null;
    const near = tx => { const ty = (y0 + y1) / 2; let best = null, bd = Infinity;
      for (let y = y0; y <= y1; y += st) for (let x = x0; x <= x1; x += st) if (alpha[y * w + x] >= 128) { const d = (x - tx) ** 2 + (y - ty) ** 2; if (d < bd) { bd = d; best = [x, y]; } }
      return { x: (best[0] + .5) / w, y: (best[1] + .5) / h }; };
    return { cx: sx / n / w, cy: sy / n / h, left: near(x0), right: near(x1) };
  }

  /* Disposition des étiquettes d'un côté : chacune au plus près de la hauteur de sa zone, sans se chevaucher, dans le cadre. */
  function layoutTags(ys, H, tagH, gap = 8, pad = 8) {
    const order = ys.map((y, i) => [y, i]).sort((a, b) => a[0] - b[0]);
    const top = new Array(ys.length);let prev = -Infinity;
    for (const [y, i] of order) { let t = Math.max(pad, y - tagH / 2, prev + gap); top[i] = t; prev = t + tagH; }
    let lim = H - pad;                                              // passe inverse : rien ne sort du cadre en bas
    for (let k = order.length - 1; k >= 0; k--) { const i = order[k][1]; top[i] = Math.min(top[i], lim - tagH); lim = top[i] - gap; }
    return top.map(t => Math.max(pad, t));
  }

  /* ---------- navigateur ---------- */
  const cache = new Map();   // dataURL → résultat déjà interprété (mémoire seulement)
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load')); i.src = src; });

  /* Interprète un masque à la taille de la photo. Résultat : { ok, canvas, geo } ou { ok:false, reason }. */
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
          z.getContext('2d').putImageData(new ImageData(paint(m.alpha, mw, mh), mw, mh), 0, 0);
          r = { ok: true, canvas: z, mode: m.mode, geo: zoneGeometry(m.alpha, mw, mh) };
        }
      }
    } catch (e) { r = { ok: false, reason: 'load' }; }
    cache.set(key, r);
    return r;
  }
  const escTxt = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* el : conteneur [data-facemap] (photo <img>, <canvas>, <svg> des traits, <div> des étiquettes).
     items : [{ key, label, score, masks }] : libellé et score fournis par l'écran (texte affiché tel quel), masques réels.
     onStatus(échecs) : liste des libellés dont la localisation n'a pas pu être affichée (vide si tout est dessiné). */
  async function mount(el, { items, hidden, onStatus }) {
    const img = el.querySelector('img'), cv = el.querySelector('canvas'), svg = el.querySelector('svg'), tags = el.querySelector('.c-facemap__tags');
    if (!img || !cv) return;
    if (!img.complete || !img.naturalWidth) await new Promise(r => { img.onload = r; img.onerror = r; });
    const pw = img.naturalWidth, ph = img.naturalHeight;
    if (!pw || !ph) { onStatus && onStatus((items || []).map(i => i.label)); return; }
    cv.width = pw; cv.height = ph;
    const g = cv.getContext('2d'); g.clearRect(0, 0, pw, ph);
    const done = await Promise.all((items || []).map(async it => ({ it, res: await Promise.all((it.masks || []).map(m => prepare(m, pw, ph))) })));
    if (!el.isConnected) return;
    let drawn = 0;const shown = [], failed = [];
    for (const { it, res } of done) {
      const good = res.filter(r => r.ok);
      if (!good.length) { failed.push(it.label); continue; }
      if (!hidden) for (const r of good) { g.drawImage(r.canvas, 0, 0, pw, ph); drawn++; }   // même boîte que la photo : alignement exact
      const geos = good.map(r => r.geo).filter(Boolean);
      const cx = geos.reduce((s, q) => s + q.cx, 0) / geos.length, side = cx < 0.5 ? -1 : 1;
      const anchor = side < 0 ? geos.map(q => q.left).sort((a, b) => a.x - b.x)[0] : geos.map(q => q.right).sort((a, b) => b.x - a.x)[0];
      shown.push({ it, side, anchor });
    }
    el.dataset.drawn = String(drawn);
    // étiquettes autour du visage, reliées par un trait fin à un point réel de leur zone
    const place = () => {
      if (!tags || !svg) return;
      const W = el.clientWidth, H = el.clientHeight;
      tags.innerHTML = hidden ? '' : shown.map(({ it, side }) => `<div class="c-fm-tag c-fm-tag--${side < 0 ? 'l' : 'r'}" data-k="${escTxt(it.key)}">${it.score == null ? '' : `<span class="c-fm-tag__score">${escTxt(it.score)}</span>`}<span class="c-fm-tag__name">${escTxt(it.label)}</span></div>`).join('');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);svg.innerHTML = '';
      if (hidden) return;
      const nodes = [...tags.children];
      for (const sd of [-1, 1]) {
        const idx = shown.map((s, i) => i).filter(i => shown[i].side === sd);if (!idx.length) continue;
        const tagH = Math.max(...idx.map(i => nodes[i].offsetHeight));
        const tops = layoutTags(idx.map(i => shown[i].anchor.y * H), H, tagH);
        idx.forEach((i, k) => {
          const n = nodes[i];n.style.top = tops[k] + 'px';
          const dot = n.querySelector('.c-fm-tag__score') || n;const nr = dot.getBoundingClientRect(), er = el.getBoundingClientRect();
          const x0 = sd < 0 ? nr.right - er.left : nr.left - er.left, y0 = nr.top - er.top + nr.height / 2, x1 = shown[i].anchor.x * W, y1 = shown[i].anchor.y * H;
          svg.insertAdjacentHTML('beforeend', `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/><circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3.5"/>`);
        });
      }
    };
    place();
    if (el._fmObs) el._fmObs.disconnect();
    if (typeof ResizeObserver !== 'undefined') { el._fmObs = new ResizeObserver(() => { if (el.isConnected) place(); else el._fmObs.disconnect(); }); el._fmObs.observe(el); }
    onStatus && onStatus(failed);
  }

  return { sanitize, ratioMatches, interpretMask, paint, zoneGeometry, layoutTags, mount, COLOR, EDGE_COLOR, FILL, EDGE };
});
