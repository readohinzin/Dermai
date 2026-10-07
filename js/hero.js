/* Bannière d'accueil : un carrousel de quatre diapositives (analyse, scores, actifs, progression), inspiré des bannières animées de sites d'analyse de peau.
   Chaque diapositive : fond dégradé pastel, titre et deux boutons à gauche, grand portrait à droite avec des surcouches animées (cadre de détection, scores par zone,
   pastilles d'actifs, suivi du score). Tout est ILLUSTRATIF : personne fictive, valeurs d'exemple, jamais un résultat réel (c'est écrit sous la bannière).

   Accessibilité : région « carrousel », diapositives étiquetées, diapositives masquées (aria-hidden + inert), défilement automatique ARRÊTÉ pour qui demande moins
   d'animations, mis en pause au survol, au focus, hors de l'écran et quand l'onglet est caché, bouton pause et points cliquables (zone de toucher de 44 px),
   flèches du clavier, balayage tactile. Aucun texte ne dépend de l'animation : sans animation, la première diapositive reste complète et lisible.

   Module partagé navigateur / Node : `html()` produit le balisage (testé sans navigateur), `init()` pilote le carrousel (navigateur). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiHero = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DURATION = 7000;                       // durée d'une diapositive (ms)
  /* Six portraits fournis (personnes fictives, fond détouré, 504 x 504). Repères relevés sur chaque photo : yeux gauche et droit, bouche, ovale du visage (cx, cy, rx, ry),
     en pixels de la tuile ; ils servent à caler cadre de scan, bulles et lignes sur LE visage affiché (un visage différent par diapositive). */
  const TILE = 504;
  const PEOPLE = {
    1: { eL: [185, 210], eR: [335, 212], m: [258, 372], f: [260, 250, 155, 205] },
    2: { eL: [243, 205], eR: [374, 228], m: [301, 368], f: [260, 255, 160, 205] },
    3: { eL: [187, 208], eR: [340, 210], m: [262, 368], f: [257, 250, 145, 205] },
    4: { eL: [205, 186], eR: [340, 221], m: [258, 348], f: [252, 240, 150, 195] },
    5: { eL: [186, 208], eR: [331, 221], m: [251, 354], f: [249, 254, 143, 198] },
    6: { eL: [147, 221], eR: [292, 206], m: [237, 366], f: [270, 260, 160, 190] }
  };
  const personSrc = n => 'img/people/woman-' + n + '.webp';
  const k1000 = v => Math.round(v * 1000 / TILE);
  const lm = n => { const p = PEOPLE[n], o = {}; for (const key of ['eL', 'eR', 'm']) o[key] = p[key].map(k1000); o.f = p.f.map(k1000); return o; };
  /* Point du visage défini par rapport aux yeux : (a, b) en unités de la distance entre les pupilles, selon l'axe des yeux (a) puis son perpendiculaire vers le bas (b). La tête peut être penchée. */
  const anchor = (L, from, a, b) => {
    const dx = L.eR[0] - L.eL[0], dy = L.eR[1] - L.eL[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d, o = L[from];
    return [Math.round(o[0] + (a * ux - b * uy) * d), Math.round(o[1] + (a * uy + b * ux) * d)];
  };
  const SR_NOTE = 'Exemple illustratif : personne fictive, scores d\'exemple, aucun résultat réel.';   // lu par les lecteurs d\'écran ; plus affiché à l\'écran

  /* Contenu : une diapositive = un message, dit une fois. Les valeurs de scores sont des EXEMPLES (100 = meilleur résultat, comme dans l'application). */
  const SLIDES = [
    { id: 'scan', theme: 'rose', kicker: 'Analyse cosmétique assistée par IA', title: ['Votre peau.', 'Votre analyse.', 'Votre routine.'],
      text: 'Analysez visuellement votre peau et découvrez une routine personnalisée adaptée à vos besoins.', more: ['how', 'En savoir plus'],
      person: 1, alt: 'Portrait fictif d\'une femme, avec un cadre de détection du visage' },
    { id: 'scores', theme: 'lilac', kicker: 'Votre analyse', title: ['Des scores clairs,', 'zone par zone.'],
      text: 'DERMAI lit quinze indicateurs visibles sur l\'ensemble du visage et vous donne un score de 0 à 100 pour chacun, 100 étant le meilleur résultat.', more: ['observe', 'Ce que DERMAI observe'],
      person: 2, alt: 'Portrait fictif d\'une femme, avec des scores d\'exemple placés autour du visage' },
    { id: 'actives', theme: 'sand', kicker: 'Votre routine', title: ['Des actifs choisis', 'pour vous.'],
      text: 'Des actifs cosmétiques en lien avec vos priorités, introduits un par un, avec leurs précautions.', more: ['routine-sec', 'Voir la routine'],
      person: 6, alt: 'Portrait fictif d\'une femme, avec des exemples d\'actifs cosmétiques' },
    { id: 'progress', theme: 'sky', kicker: 'Votre évolution', title: ['Votre peau évolue.', 'Suivez-la.'],
      text: 'Refaites une analyse quand vous voulez : DERMAI la compare à vos observations précédentes.', more: ['evolve', 'En savoir plus'],
      person: 3, alt: 'Portrait fictif d\'une femme, avec un exemple de suivi du score global' }
  ];

  /* Cadre du portrait : il occupe 80 % de la largeur, en bas ; son décalage horizontal dépend de la diapositive (place pour la carte d'actifs, la carte de suivi).
     Un point du portrait (millièmes de la tuile) devient un point du cadre (millièmes du cadre) par toFrame. */
  const PIC = { s: 0.8, oy: 200, ox: { scan: 100, scores: 100, actives: 20, progress: 200 } };
  const toFrame = (x, y, id) => [Math.round(PIC.ox[id] + x * PIC.s), Math.round(PIC.oy + y * PIC.s)];
  /* Scores d'exemple (diapositive 2) : bulle (x, y en millièmes du CADRE), point d'ancrage sur le visage défini par rapport aux yeux ou à la bouche. */
  const BUBBLES = [
    { k: 'hydration', v: 64, x: 120, y: 270, from: 'eL', a: -0.06, b: 0.135 }, { k: 'pores', v: 58, x: 95, y: 500, from: 'eL', a: -0.15, b: 0.62 }, { k: 'texture', v: 76, x: 150, y: 730, from: 'm', a: -0.25, b: 0.19 },
    { k: 'pigmentation', v: 52, x: 880, y: 270, from: 'eR', a: 0.08, b: 0.1 }, { k: 'redness', v: 81, x: 905, y: 500, from: 'eR', a: 0.19, b: 0.63 }, { k: 'oiliness', v: 69, x: 850, y: 730, from: 'm', a: 0.33, b: 0.19 }
  ];
  const band = v => (v >= 70 ? 'good' : v >= 55 ? 'mid' : 'low');
  const PROGRESS = { from: 58, to: 72, points: [58, 61, 60, 66, 69, 72] };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  /* Surcouche de la diapositive 1 : cadre de détection, anneau de suivi, maillage de points et balayage, dans le repère du portrait (1000 x 1000), calés sur l'ovale du visage. */
  const scanOverlay = n => {
    const L = lm(n), [cx, cy, rx, ry] = L.f, k = rx / 262, fx = Math.round(rx * 1.1), fy = Math.round(ry * 1.1), x0 = cx - fx, x1 = cx + fx, y0 = cy - fy, y1 = cy + fy, c = Math.round(65 * k), r = Math.round(10 * k);
    const brk = `<path pathLength="1" d="M${x0} ${y0 + c + r}V${y0 + r}a${r} ${r} 0 0 1 ${r}-${r}h${c}"/><path pathLength="1" d="M${x1} ${y0 + c + r}V${y0 + r}a${r} ${r} 0 0 0-${r}-${r}h-${c}"/><path pathLength="1" d="M${x0} ${y1 - c - r}v${c}a${r} ${r} 0 0 0 ${r} ${r}h${c}"/><path pathLength="1" d="M${x1} ${y1 - c - r}v${c}a${r} ${r} 0 0 1-${r} ${r}h-${c}"/>`;
    return `<svg class="hc-ov" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">
    <defs><clipPath id="hcFace"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
      <pattern id="hcDots" width="34" height="34" patternUnits="userSpaceOnUse"><circle cx="17" cy="17" r="2.8" fill="#fff"/></pattern>
      <linearGradient id="hcSweep" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g clip-path="url(#hcFace)"><rect class="hc-dots" x="${cx - rx}" y="${cy - ry}" width="${2 * rx}" height="${2 * ry}" fill="url(#hcDots)"/><rect class="hc-sweep" x="${cx - rx}" y="${cy - ry}" width="${2 * rx}" height="16" fill="url(#hcSweep)" style="--sw:${2 * ry - 16}px"/></g>
    <circle class="hc-ring" cx="${cx}" cy="${cy}" r="${Math.round(ry * 1.07)}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="230 110 90 420" style="transform-origin:${cx}px ${cy}px"/>
    <g class="hc-brk" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${brk}</g></svg>`;
  };

  const bubbleHtml = (b, i, labels) => `<div class="hc-b hc-b--${band(b.v)}" style="left:${b.x / 10}%;top:${b.y / 10}%;--v:${b.v};--p:${b.v};--d:${i}" data-v="${b.v}"><span class="n">${b.v}</span><span class="l">${esc(labels[b.k] || b.k)}</span></div>`;
  const scoresOverlay = (labels, n) => { const L = lm(n); return `<svg class="hc-ov" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false">${BUBBLES.map((b, i) => { const [ax, ay] = anchor(L, b.from, b.a, b.b), [fx, fy] = toFrame(ax, ay, 'scores'); return `<line class="hc-ln" style="--d:${i}" x1="${b.x}" y1="${b.y}" x2="${fx}" y2="${fy}" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle class="hc-pt" style="--d:${i}" cx="${fx}" cy="${fy}" r="9" fill="#fff"/>`; }).join('')}</svg>${BUBBLES.map((b, i) => bubbleHtml(b, i, labels)).join('')}`; };

  const activesOverlay = (actives, n) => { const [ax, ay] = anchor(lm(n), 'eR', 0.19, 0.63), [fx, fy] = toFrame(ax, ay, 'actives'); return `<svg class="hc-ov" viewBox="0 0 1000 1000" aria-hidden="true" focusable="false"><line class="hc-ln hc-ln--act" x1="700" y1="300" x2="${fx}" y2="${fy}" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle class="hc-pt hc-pt--act" cx="${fx}" cy="${fy}" r="9" fill="#fff"/></svg>
    <div class="hc-act" aria-hidden="true"><span class="k">Actif</span><b class="nm" data-act-name>${esc(actives[0].label)}</b><span class="sm" data-act-sum>${esc(actives[0].summary)}</span></div>
    <div class="hc-chips" aria-hidden="true">${actives.map((a, i) => `<span class="hc-chip hc-chip--${i % 5}${i === 0 ? ' is-on' : ''}" data-i="${i}" style="--i:${i}"><svg viewBox="0 0 24 24"><path d="M12 3.5c3.2 3.9 5.2 6.7 5.2 9.6a5.2 5.2 0 0 1-10.4 0c0-2.9 2-5.7 5.2-9.6z" fill="currentColor"/></svg></span>`).join('')}</div>
    <p class="u-sr">Exemples d'actifs : ${actives.map(a => esc(a.label)).join(', ')}.</p>`; };

  const progressOverlay = () => {
    const pts = PROGRESS.points, mx = Math.max(...pts), mn = Math.min(...pts), W = 150, H = 44;
    const xy = pts.map((v, i) => [Math.round(i * W / (pts.length - 1)), Math.round(H - (v - mn) / (mx - mn) * (H - 8) - 4)]);
    return `<div class="hc-prog" aria-hidden="true"><div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(84,47,59,.14)" stroke-width="9"/><circle class="arc" cx="50" cy="50" r="42" fill="none" stroke="#542F3B" stroke-width="9" stroke-linecap="round" stroke-dasharray="264" style="--to:${PROGRESS.to}" transform="rotate(-90 50 50)"/></svg><span class="n" data-from="${PROGRESS.from}" data-to="${PROGRESS.to}">${PROGRESS.to}</span></div>
      <div class="tx"><span class="k">Score global</span><span class="dl">+${PROGRESS.to - PROGRESS.from} points</span>
        <svg class="sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline class="ln" points="${xy.map(p => p.join(',')).join(' ')}" fill="none" stroke="#542F3B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg><span class="xp">Exemple</span></div></div>`;
  };

  /* ctx : { cta: { go }, labels: { clé de métrique: libellé }, actives: [{ label, summary }], extraFirst: html }. Aucun état de l'application ici. */
  function html(ctx) {
    const labels = ctx.labels || {}, actives = (ctx.actives && ctx.actives.length ? ctx.actives : [{ label: 'Niacinamide', summary: 'Polyvalent et doux' }]).slice(0, 5);
    const pic = n => ({ scan: scanOverlay(n) }), outer = n => ({ scores: scoresOverlay(labels, n), actives: activesOverlay(actives, n), progress: progressOverlay() });
    const slide = (s, i) => {
      const H = i === 0 ? 'h1' : 'h2';
      return `<article class="hc-slide hc-t-${s.theme}${i === 0 ? ' is-active' : ''}" data-i="${i}" role="group" aria-roledescription="diapositive" aria-label="${i + 1} sur ${SLIDES.length}"${i === 0 ? '' : ' aria-hidden="true" inert'}>
      <div class="hc-bg" aria-hidden="true"><i></i><i></i></div>
      <div class="hc-in">
        <div class="hc-copy">
          <p class="tagline hc-kick">${ctx.sparkle || ''} ${esc(s.kicker)}</p>
          <${H} class="hc-h">${s.title.map((l, n) => `<span class="ln" style="--l:${n}"><span>${esc(l)}</span></span>`).join('')}</${H}>
          <p class="hc-p">${esc(s.text)}</p>
          <div class="cta-row hc-cta"><button class="c-btn c-btn--primary" data-go="${ctx.cta && ctx.cta.go || 'signup'}">Analyser ma peau</button><button class="c-btn c-btn--secondary" data-act="scroll" data-v="${s.more[0]}">${esc(s.more[1])}</button></div>
          ${i === 0 && ctx.extraFirst ? `<div style="margin-top:20px">${ctx.extraFirst}</div>` : ''}
        </div>
        <div class="hc-art"><p class="u-sr">${SR_NOTE}</p><div class="hc-face hc-face--${s.id}"><div class="hc-pic"><img src="${personSrc(s.person)}" width="504" height="504" alt="${esc(s.alt)}" decoding="async"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>${pic(s.person)[s.id] || ''}</div>${outer(s.person)[s.id] || ''}</div></div>
      </div></article>`;
    };
    return `<section class="hc" data-hc aria-roledescription="carrousel" aria-label="Présentation de DERMAI">
      <div class="hc-stage" aria-live="off">${SLIDES.map(slide).join('')}</div>
      <div class="hc-ctl"><div class="hc-dots-row">
        <button type="button" class="hc-pause" data-hc-pause aria-label="Mettre en pause le défilement"><svg class="p1" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><svg class="p2" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg></button>
        ${SLIDES.map((s, i) => `<button type="button" class="hc-dot${i === 0 ? ' is-on' : ''}" data-hc-go="${i}" aria-label="Diapositive ${i + 1} sur ${SLIDES.length}"${i === 0 ? ' aria-current="true"' : ''}><i></i></button>`).join('')}
      </div></div>
    </section>`;
  }

  /* Pilote du carrousel (navigateur). opts : { reduced, schedule(fn, ms) -> id, cancel(id) } ; renvoie { stop() } à appeler avant de remplacer le DOM. */
  function init(rootEl, opts) {
    opts = opts || {};
    const reduced = !!opts.reduced;
    const slides = [...rootEl.querySelectorAll('.hc-slide')], dots = [...rootEl.querySelectorAll('.hc-dot')], stage = rootEl.querySelector('.hc-stage');
    const pauseBtn = rootEl.querySelector('[data-hc-pause]');
    const setT = opts.schedule || ((fn, ms) => setTimeout(fn, ms)), clearT = opts.cancel || clearTimeout;
    let idx = 0, timer = null, playing = !reduced, hover = false, focus = false, hidden = document.hidden, offscreen = false, raf = [], chipTimer = null, stopped = false;

    const play = () => playing && !hover && !focus && !hidden && !offscreen && !reduced && !stopped;
    const cancelRaf = () => { raf.forEach(cancelAnimationFrame); raf = []; };
    const tween = (from, to, ms, fn, delay) => {
      if (reduced) { fn(to); return; }
      const t0 = performance.now() + (delay || 0);
      const step = now => { if (stopped) return; const k = Math.min(1, Math.max(0, (now - t0) / ms)), e = 1 - Math.pow(1 - k, 3); fn(from + (to - from) * e); if (k < 1) raf.push(requestAnimationFrame(step)); };
      fn(from); raf.push(requestAnimationFrame(step));
    };
    function activate(i) {
      const s = slides[i]; cancelRaf(); clearInterval(chipTimer);
      s.querySelectorAll('.hc-b').forEach((b, n) => { const v = +b.dataset.v, num = b.querySelector('.n'); tween(0, v, 900, x => { b.style.setProperty('--p', x.toFixed(1)); num.textContent = Math.round(x); }, 450 + n * 130); });
      const pr = s.querySelector('.hc-prog .n'); if (pr) tween(+pr.dataset.from, +pr.dataset.to, 1400, x => { pr.textContent = Math.round(x); }, 500);
      const names = s.querySelector('[data-act-name]');
      if (names) {
        const chips = [...s.querySelectorAll('.hc-chip')], sum = s.querySelector('[data-act-sum]'), data = (opts.actives || []);
        let c = 0; const apply = () => { chips.forEach((el, n) => el.classList.toggle('is-on', n === c)); if (data[c]) { names.textContent = data[c].label; sum.textContent = data[c].summary; } };
        apply(); if (!reduced) chipTimer = setInterval(() => { c = (c + 1) % chips.length; apply(); }, 1500);
      }
    }
    function show(i, manual) {
      idx = (i + slides.length) % slides.length;
      slides.forEach((s, n) => { const on = n === idx; s.classList.toggle('is-active', on); if (on) { s.removeAttribute('aria-hidden'); s.removeAttribute('inert'); } else { s.setAttribute('aria-hidden', 'true'); s.setAttribute('inert', ''); } });
      dots.forEach((d, n) => { d.classList.toggle('is-on', n === idx); if (n === idx) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      stage.setAttribute('aria-live', manual || !play() ? 'polite' : 'off');
      rootEl.classList.remove('is-restart'); void rootEl.offsetWidth; rootEl.classList.add('is-restart');   // relance la barre de progression du point actif
      activate(idx); schedule();
    }
    function schedule() { clearT(timer); timer = null; rootEl.classList.toggle('is-paused', !play()); if (play()) timer = setT(() => show(idx + 1, false), DURATION); }
    function togglePause() {
      playing = !playing; if (reduced) playing = false; if (playing) focus = false;   // « Reprendre » est une demande explicite de lecture
      pauseBtn.setAttribute('aria-label', playing ? 'Mettre en pause le défilement' : 'Reprendre le défilement'); rootEl.classList.toggle('is-user-paused', !playing);
      stage.setAttribute('aria-live', playing ? 'off' : 'polite'); show(idx, false);
    }
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanups.push(() => t.removeEventListener(ev, fn, o)); };
    const cleanups = [];
    on(rootEl, 'click', e => {
      const g = e.target.closest('[data-hc-go]'); if (g) { show(+g.dataset.hcGo, true); return; }
      if (e.target.closest('[data-hc-pause]')) togglePause();
    });
    on(rootEl, 'pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; schedule(); } });
    on(rootEl, 'pointerleave', e => { if (e.pointerType === 'mouse') { hover = false; schedule(); } });
    on(rootEl, 'focusin', e => { try { focus = e.target.matches(':focus-visible'); } catch (err) { focus = true; } schedule(); });   // pause au focus CLAVIER seulement : un clic de souris ne doit pas figer la bannière
    on(rootEl, 'focusout', e => { if (!rootEl.contains(e.relatedTarget)) { focus = false; schedule(); } });
    on(rootEl, 'keydown', e => { if (e.key === 'ArrowRight') { show(idx + 1, true); e.preventDefault(); } else if (e.key === 'ArrowLeft') { show(idx - 1, true); e.preventDefault(); } });
    let x0 = null;
    on(rootEl, 'pointerdown', e => { if (e.pointerType !== 'mouse') x0 = e.clientX; });
    on(rootEl, 'pointerup', e => { if (x0 === null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1), true); });
    on(document, 'visibilitychange', () => { hidden = document.hidden; schedule(); });
    let io = null;
    if (typeof IntersectionObserver === 'function') { io = new IntersectionObserver(en => { offscreen = !en[0].isIntersecting; schedule(); }, { threshold: 0.15 }); io.observe(rootEl); }
    show(0, false);
    return { stop() { stopped = true; clearT(timer); clearInterval(chipTimer); cancelRaf(); cleanups.forEach(f => f()); if (io) io.disconnect(); }, show, get index() { return idx; } };
  }

  return { SLIDES, BUBBLES, PROGRESS, PIC, PEOPLE, DURATION, SR_NOTE, personSrc, anchor, lm, html, init };
});
