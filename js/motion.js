/* Motion design de DERMAI : un petit moteur d'animations déclaratives, sans bibliothèque. Après chaque rendu, `scan()` repère les éléments à animer par SÉLECTEUR
   (table RULES, par page) et les révèle quand ils entrent dans l'écran : apparitions en cascade, compteurs, courbes qui se dessinent, barres qui se remplissent,
   zones du visage qui s'allument. S'y ajoutent des effets continus : barre de progression de lecture, en-tête qui réagit au défilement, parallaxe de la bannière
   (pointeur et défilement), bouton « magnétique », ondulation au clic.

   Principes :
   - Aucun contenu n'est caché sans ce script : l'état initial (`opacity:0`...) n'existe que sous `html.m-on`, posé ici une fois l'observateur disponible.
   - Les animations sont toujours actives, sur téléphone comme sur PC : aucun réglage ne les coupe (décision produit).
   - Les animations n'utilisent que `transform`, `opacity` et `translate` (rien qui force la mise en page) ; `will-change` retiré après l'effet.
   - Un re-rendu qui conserve l'état (`keep`) n'anime pas : cocher une case ne doit pas rejouer toute la page.
   Module partagé navigateur / Node : les règles et les fonctions pures sont testées sans navigateur. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiMotion = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* [sélecteur, effet, options]. Effets d'apparition (data-m) : rise, left, right, scale, pop, fade. Effets propres (data-mx) : count, bar, draw, dot, line, zones.
     options : stagger (cascade entre frères), step (ms entre deux), max (nombre d'éléments à décaler), delay (ms avant le premier). */
  const COMMON = [['.gchart .gl-line', 'draw'], ['.gchart .gl-dot', 'dot', { stagger: 1, step: 140, delay: 700 }], ['.gchart .gv', 'fade', { stagger: 1, step: 140, delay: 800 }]];
  const RULES = {
    landing: [
      ['.sec h2', 'words'], ['.sec .wrap > p, .two > div > p', 'rise', { delay: 250 }], ['.facebox', 'par', { f: 0.22 }], ['.faces', 'par', { f: -0.14 }], ['.two .c-card', 'par', { f: 0.12 }],
      ['.steps3 .s', 'rise', { stagger: 1, step: 140 }], ['.steps3 .num', 'pop', { stagger: 1, step: 140, delay: 200 }],
      ['.plist > div', 'left', { stagger: 1, step: 55, max: 9 }],
      ['.two .c-card', 'scale'], ['.faces .fc', 'pop', { stagger: 1, step: 150 }], ['.two .facebox', 'right'], ['.facebox', 'zones'],
      ['.sec .rowlink', 'left', { stagger: 1, step: 110 }], ['.l-list li', 'rise', { stagger: 1 }],
      ['.flowstrip', 'line'], ['.flowstrip > div', 'pop', { stagger: 1, step: 160, delay: 300 }],
      ['.sec.alt[style*="center"] h2', 'rise'], ['.sec.alt[style*="center"] .c-btn', 'pop', { delay: 250 }]
    ].concat(COMMON),
    result: [['.c-concern-card', 'rise', { stagger: 1, step: 80, max: 6 }], ['.c-indicator', 'rise', { stagger: 1, step: 55, max: 10 }], ['.c-score__value', 'count'], ['.c-bar__fill', 'bar', { stagger: 1, step: 70, max: 10 }]].concat(COMMON),
    concern: [['.c-score__value', 'count'], ['.c-bar__fill', 'bar', { stagger: 1 }], ['.c-routine-step, .rowlink', 'left', { stagger: 1, step: 90 }]].concat(COMMON),
    routine: [['.c-routine-step', 'left', { stagger: 1, step: 100 }], ['.pcard', 'pop', { stagger: 1, step: 80 }], ['.rowlink', 'left', { stagger: 1, step: 80 }]],
    products: [['.pgrid .pcard', 'pop', { stagger: 1, step: 60, max: 9 }]],
    actives: [['.acard', 'rise', { stagger: 1, step: 70, max: 8 }], ['.rowlink', 'left', { stagger: 1, step: 80 }], ['.offer', 'rise', { stagger: 1 }]],
    active: [['.offer', 'rise', { stagger: 1 }], ['.pcard', 'pop', { stagger: 1 }]],
    progress: [['.c-indicator', 'rise', { stagger: 1, step: 55, max: 8 }], ['.rowlink', 'left', { stagger: 1, step: 80 }]].concat(COMMON),
    home: [['.skin-now', 'rise'], ['.c-score__value', 'count']].concat(COMMON),
    analyses: [['.rowlink', 'left', { stagger: 1, step: 80 }]]
  };
  const ATTR = { words: 'mx', par: 'par', rise: 'm', left: 'm', right: 'm', scale: 'm', pop: 'm', fade: 'm', count: 'mx', bar: 'mx', draw: 'mx', dot: 'mx', line: 'mx', zones: 'mx' };

  /* Fonctions pures */
  const delayOf = (i, o) => { o = o || {}; const step = o.step == null ? 90 : o.step, max = o.max == null ? 7 : o.max; return (o.delay || 0) + (o.stagger ? Math.min(i, max) * step : 0); };
  const countOf = txt => { const m = /^\s*(\d{1,4})(?:[.,](\d))?\s*$/.exec(String(txt)); return m ? { value: +(m[1] + (m[2] ? '.' + m[2] : '')), decimals: m[2] ? 1 : 0 } : null; };
  /* Titre découpé en mots (chaque mot dans un masque) : les mots se lèvent l'un après l'autre. Le texte reste un texte normal (espaces conservés, lisible tel quel). */
  const splitWords = el => {
    const words = el.textContent.trim().split(/\s+/); el.textContent = '';
    words.forEach((w, i) => {
      const o = document.createElement('span'), n = document.createElement('span'); o.className = 'w'; n.textContent = w; n.style.setProperty('--i', i); o.appendChild(n);
      el.appendChild(o); if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
    });
  };
  const TILT = '.pcard, .acard, .c-concern-card:not(.c-concern-card--static), .hc-face, [data-tilt]';
  const ease = k => 1 - Math.pow(1 - k, 3);
  /* Éléments à ne pas animer : la bannière (elle a ses propres animations) et les enfants directs de `.col`, déjà animés par la feuille historique. */
  const skip = el => !!(el.closest && el.closest('.hc')) || !!(el.parentElement && el.parentElement.classList && el.parentElement.classList.contains('col'));

  /* Pilote (navigateur) */
  function init(opts) {
    opts = opts || {};
    const doc = document, html = doc.documentElement;
    const ctl = { active: false, scan() {}, stop() {}, reveal() {} };
    if (typeof IntersectionObserver !== 'function') return ctl;
    html.classList.add('m-on'); ctl.active = true;

    let parList = [], io = null, route = '', raf = [], zoneTimers = [], fallback = null, stopped = false, lastKey = null, played = false;
    const fine = typeof matchMedia === 'function' && matchMedia('(hover:hover) and (pointer:fine)').matches;
    const clear = () => { if (io) io.disconnect(); io = null; raf.forEach(cancelAnimationFrame); raf = []; zoneTimers.forEach(clearInterval); zoneTimers = []; clearTimeout(fallback); };

    function tween(from, to, ms, fn, delay) {
      const t0 = performance.now() + (delay || 0);
      const step = now => { if (stopped) return; const k = Math.min(1, Math.max(0, (now - t0) / ms)); fn(from + (to - from) * ease(k)); if (k < 1) raf.push(requestAnimationFrame(step)); };
      raf.push(requestAnimationFrame(step));
    }
    function done(el) {   // l'effet est terminé : l'élément retrouve son style normal (survol, focus...) et son compositing léger
      const finish = () => { el.removeAttribute('data-m'); el.removeAttribute('data-mx'); el.classList.remove('is-in'); el.style.removeProperty('--md'); };
      let ended = false; const once = () => { if (!ended) { ended = true; finish(); } };
      // on attend la FIN de l'effet le plus long (transform, ou tracé pour les courbes) : retirer l'attribut plus tôt couperait la transition net
      el.addEventListener('transitionend', e => { if (e.target === el && (e.propertyName === 'transform' || e.propertyName === 'stroke-dashoffset')) once(); });
      setTimeout(once, 2800);
    }
    const finishNow = el => { el.removeAttribute('data-m'); el.removeAttribute('data-mx'); el.classList.remove('is-in'); el.style.removeProperty('--md'); };
    function reveal(el) {
      const kind = el.getAttribute('data-mx'), md = parseFloat(el.style.getPropertyValue('--md')) || 0;
      if (kind === 'count') {
        const c = countOf(el.dataset.mFinal);
        if (!c) { el.textContent = el.dataset.mFinal; return finishNow(el); }
        tween(0, c.value, 1200, v => { el.textContent = c.decimals ? v.toFixed(1) : String(Math.round(v)); }, md);
        setTimeout(() => { el.textContent = el.dataset.mFinal; finishNow(el); }, 1400 + md);
        return;
      }
      if (kind === 'zones') {   // l'IA « balaye » le visage : deux zones s'allument à tour de rôle
        const zs = [...el.querySelectorAll('.zones .z')];
        if (zs.length) { let n = 0; const tick = () => { zs.forEach((z, i) => z.classList.toggle('on', i === n % zs.length || i === (n + 3) % zs.length)); n++; }; tick(); zoneTimers.push(setInterval(tick, 1300)); }
      }
      el.classList.add('is-in'); done(el);
    }

    function scan(rootEl, o) {
      o = o || {}; clear(); route = o.route || route;
      /* Un re-rendu qui conserve l'état (case cochée, chargement terminé) ne rejoue pas la page : sauf si cette page n'a encore rien joué (premier rendu vide,
         puis contenu chargé), auquel cas c'est la vraie arrivée du contenu. */
      if (!rootEl) return;
      parList = [];   // parallaxe au défilement : toujours reconstruite, même pour un re-rendu qui conserve l'état
      for (const [sel, effect, ro] of RULES[route] || []) if (effect === 'par') { let l; try { l = [...rootEl.querySelectorAll(sel)]; } catch (e) { continue; } for (const el of l) { el.setAttribute('data-par', ro && ro.f ? String(ro.f) : '0.15'); parList.push(el); } }
      /* Re-rendu qui conserve l'état : le DOM est NEUF (innerHTML), donc rien n'y est balisé. Ce qui est déjà passé à l'écran reste immobile ; ce qui est plus bas
         s'anime encore à l'arrivée. (Ex. accueil : le compte se vérifie en réseau, puis la page est redessinée ; sans cela aucun effet ne jouait sur téléphone.) */
      const replay = !!(o.keep && o.key === lastKey && played);
      lastKey = o.key == null ? route : o.key; played = false;
      const foldY = (innerHeight || 800) * 0.92;
      const rules = RULES[route] || [];
      const groups = new Map(); const targets = [];
      for (const [sel, effect, ro] of rules) {
        let list; try { list = [...rootEl.querySelectorAll(sel)]; } catch (e) { continue; }
        for (const el of list) {
          if (skip(el) || el.hasAttribute('data-' + ATTR[effect])) continue;
          if (effect === 'par') continue;
          if (replay && el.getBoundingClientRect().top + window.scrollY - (o.y == null ? window.scrollY : o.y) < foldY) continue;   // o.y : défilement conservé par le re-rendu
          if (effect === 'words') { if (el.children.length || !el.textContent.trim()) continue; splitWords(el); }
          const key = (el.parentElement || rootEl);
          const gk = groups.get(key) || new Map(); groups.set(key, gk);
          const idx = gk.get(sel) || 0; gk.set(sel, idx + 1);
          const attr = ATTR[effect];
          el.setAttribute('data-' + attr, effect);
          el.style.setProperty('--md', delayOf(idx, ro) + 'ms');
          if (effect === 'draw') el.setAttribute('pathLength', '1');
          if (effect === 'count') { const c = countOf(el.textContent); if (!c) { el.removeAttribute('data-mx'); continue; } el.dataset.mFinal = el.textContent.trim(); el.textContent = c.decimals ? '0.0' : '0'; }
          targets.push(el);
        }
      }
      kick();
      if (replay) played = true;
      if (!targets.length) return;
      played = true;
      const vh = innerHeight || 800;
      io = new IntersectionObserver(entries => {
        for (const en of entries) {
          const el = en.target;
          if (en.isIntersecting || en.boundingClientRect.top < 0) { io.unobserve(el); reveal(el); }
        }
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      targets.forEach(el => io.observe(el));
      // filet de sécurité : rien ne doit rester caché si l'observateur tarde (onglet en arrière-plan, rendu très long)
      fallback = setTimeout(() => targets.forEach(el => { if (el.isConnected && (el.hasAttribute('data-m') || el.hasAttribute('data-mx')) && !el.classList.contains('is-in')) { const r = el.getBoundingClientRect(); if (r.top < vh * 1.2) reveal(el); } }), 3500);
    }

    /* Effets continus */
    const prog = doc.createElement('div'); prog.id = 'mprog'; prog.setAttribute('aria-hidden', 'true'); prog.hidden = true; doc.body.appendChild(prog);
    let ticking = false, pendingPointer = null;
    function frame() {
      ticking = false;
      const y = window.scrollY, max = Math.max(1, doc.documentElement.scrollHeight - innerHeight);
      prog.hidden = route !== 'landing'; if (!prog.hidden) prog.style.transform = 'scaleX(' + Math.min(1, y / max).toFixed(4) + ')';
      doc.querySelectorAll('.l-top').forEach(h => h.classList.toggle('is-stuck', y > 8));
      const hc = doc.querySelector('.hc');
      if (hc) hc.style.setProperty('--sy', Math.min(1, Math.max(0, y / Math.max(300, hc.offsetHeight * 0.8))).toFixed(3));
      if (pendingPointer && hc && fine) { const r = hc.getBoundingClientRect(); hc.style.setProperty('--px', (((pendingPointer.x - r.left) / r.width) * 2 - 1).toFixed(3)); hc.style.setProperty('--py', (((pendingPointer.y - r.top) / r.height) * 2 - 1).toFixed(3)); }
      if (pendingPointer && hc && fine) { const r = hc.getBoundingClientRect(); hc.style.setProperty('--mx', ((pendingPointer.x - r.left) / r.width * 100).toFixed(1) + '%'); hc.style.setProperty('--my', ((pendingPointer.y - r.top) / r.height * 100).toFixed(1) + '%'); hc.style.setProperty('--so', '1'); }
      const vh = innerHeight || 800;
      if (route === 'landing') for (const sec of doc.querySelectorAll('.sec')) {   // défilement « lié au doigt » : chaque section reçoit sa position (-1 haut ... +1 bas) pour ses décors
        const r = sec.getBoundingClientRect(); if (r.bottom < -100 || r.top > vh + 100) continue;
        sec.style.setProperty('--sp', Math.max(-1.2, Math.min(1.2, ((r.top + r.height / 2) - vh / 2) / vh)).toFixed(3));
      }
      for (const el of parList) {   // parallaxe au défilement : chaque plan avance à sa vitesse (propriété translate, indépendante des apparitions)
        if (!el.isConnected) continue;
        const r = el.getBoundingClientRect(); if (r.bottom < -200 || r.top > vh + 200) continue;
        const k = parseFloat(el.dataset.par) || 0.15, p = ((r.top + r.height / 2) - vh / 2) / vh;
        el.style.translate = '0 ' + (-p * k * 220).toFixed(1) + 'px';
      }
      pendingPointer = null;
    }
    const kick = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
    const listeners = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); listeners.push(() => t.removeEventListener(ev, fn, o)); };
    on(window, 'scroll', kick, { passive: true }); on(window, 'resize', kick, { passive: true });
    if (fine) {
      on(doc, 'pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const hc = e.target.closest && e.target.closest('.hc');
        if (hc) { pendingPointer = { x: e.clientX, y: e.clientY }; kick(); }
        const t = e.target.closest && e.target.closest(TILT);
        if (t) { const r = t.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5, deg = Math.min(1, Math.hypot(px, py) * 2) * (t.matches('.hc-face') ? 9 : 8); t.style.rotate = (-py).toFixed(3) + ' ' + px.toFixed(3) + ' 0 ' + deg.toFixed(2) + 'deg'; }
        const b = e.target.closest && e.target.closest('[data-mag], .hc-cta .c-btn');
        if (b) { const r = b.getBoundingClientRect(); b.style.translate = (((e.clientX - r.left) / r.width - .5) * 14).toFixed(1) + 'px ' + (((e.clientY - r.top) / r.height - .5) * 8).toFixed(1) + 'px'; }
      }, { passive: true });
      on(doc, 'pointerout', e => {
        const b = e.target.closest && e.target.closest('[data-mag], .hc-cta .c-btn'); if (b && !b.contains(e.relatedTarget)) b.style.translate = '';
        const t = e.target.closest && e.target.closest(TILT); if (t && !t.contains(e.relatedTarget)) t.style.rotate = '';
        const hc = e.target.closest && e.target.closest('.hc'); if (hc && !hc.contains(e.relatedTarget)) { hc.style.setProperty('--px', '0'); hc.style.setProperty('--py', '0'); hc.style.setProperty('--so', '0'); }
      });
    }
    on(doc, 'pointerdown', e => {   // ondulation au clic
      const b = e.target.closest && e.target.closest('.c-btn'); if (!b || b.disabled) return;
      const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, i = doc.createElement('span');
      i.className = 'm-ripple'; i.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
      b.appendChild(i); setTimeout(() => i.remove(), 700);
    }, { passive: true });
    kick();

    ctl.scan = scan; ctl.stop = () => { stopped = true; clear(); listeners.forEach(f => f()); prog.remove(); html.classList.remove('m-on'); ctl.active = false; };
    ctl.reveal = reveal;
    return ctl;
  }

  return { RULES, ATTR, delayOf, countOf, skip, init };
});
