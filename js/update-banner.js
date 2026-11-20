/* DermAI : bannière « Nouvelle version disponible ». Module partagé navigateur / Node (testé avec un faux navigateur).
   Dès qu'une nouvelle version est déployée, la page ouverte l'apprend et propose « Mettre à jour » : jamais de rechargement forcé (une analyse en cours ne doit pas être perdue).
   Comment : la page lit /api/version (api/version.js) à l'ouverture (version de référence), puis toutes les 15 secondes tant qu'elle est visible, à chaque retour au premier plan ou
   retour du réseau, et à chaque toucher dans l'application (donc où que la personne se trouve ; jamais plus d'un contrôle toutes les 5 secondes). Une version différente = bannière. Elle vérifie aussi le service worker (registration.update()) et réagit à son remplacement.
   Aucune donnée de personne : seulement l'identifiant public de version. Une erreur réseau, une réponse invalide ou l'absence de l'API (local) ne montrent rien et ne cassent rien. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DermaiUpdate = api; if (typeof window !== 'undefined' && typeof document !== 'undefined') api.autostart(window, document); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const URL_VERSION = '/api/version';
  const INTERVAL_MS = 15000;
  const MIN_GAP_MS = 5000;           // deux contrôles ne se suivent pas de plus près (retour au premier plan, réseau…)
  const SAFE = /^[A-Za-z0-9_.\-]{1,64}$/;
  const TEXT = {
    title: 'Nouvelle version disponible',
    body: 'DermAI vient d\'être mis à jour. Rechargez pour profiter des dernières améliorations.',
    apply: 'Mettre à jour',
    later: 'Plus tard'
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  const bannerHtml = () => '<div class="update-banner" role="status" aria-live="polite" data-update-banner><div class="update-text"><p class="update-title">' + esc(TEXT.title) + '</p><p class="update-body">' + esc(TEXT.body) +
    '</p></div><div class="update-actions"><button type="button" class="update-apply" data-update-apply>' + esc(TEXT.apply) + '</button><button type="button" class="update-later" data-update-later>' + esc(TEXT.later) + '</button></div></div>';

  /* Surveillance d'une page. opts : { interval, url, now, fetchImpl }. Renvoie { check, stop, state }. */
  function watch(win, doc, opts) {
    const o = opts || {}, url = o.url || URL_VERSION, interval = o.interval || INTERVAL_MS, now = () => (typeof o.now === 'function' ? o.now() : Date.now());
    const doFetch = o.fetchImpl || (typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const state = { baseline: null, announced: null, dismissed: null, el: null, last: 0, checks: 0 };
    const nav = win.navigator || {};
    const hadController = !!(nav.serviceWorker && nav.serviceWorker.controller);
    let timer = null, busy = false;

    function show(version) {
      if (state.el || state.dismissed === version) return;
      state.announced = version;
      const host = doc.createElement('div'); host.innerHTML = bannerHtml();
      const el = host.firstElementChild; doc.body.appendChild(el); state.el = el;
      el.querySelector('[data-update-apply]').addEventListener('click', () => { try { win.location.reload(); } catch (e) { /* rechargement impossible : la bannière reste */ } });
      el.querySelector('[data-update-later]').addEventListener('click', () => { state.dismissed = state.announced; el.remove(); state.el = null; });
    }

    async function check(force) {
      if (!doFetch || busy) return;
      if (nav.onLine === false) return;
      if (!force && now() - state.last < MIN_GAP_MS) return;
      state.last = now(); busy = true;
      try {
        try { const reg = nav.serviceWorker && nav.serviceWorker.getRegistration ? await nav.serviceWorker.getRegistration() : null; if (reg && reg.update) reg.update().catch(() => {}); } catch (e) { /* sans service worker */ }
        const res = await doFetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!res || !res.ok) return;
        const body = await res.json();
        const v = body && typeof body.version === 'string' && SAFE.test(body.version) ? body.version : null;
        if (!v) return;
        state.checks++;
        if (state.baseline === null) { state.baseline = v; return; }
        if (v !== state.baseline) show(v);
      } catch (e) { /* réseau, JSON invalide : rien à montrer */ } finally { busy = false; }
    }

    const visible = () => !doc.visibilityState || doc.visibilityState === 'visible';
    const tick = () => { if (visible()) check(false); };
    timer = win.setInterval ? win.setInterval(tick, interval) : null;
    if (doc.addEventListener) { doc.addEventListener('visibilitychange', tick); doc.addEventListener('click', tick, true); }
    win.addEventListener('focus', tick); win.addEventListener('online', () => check(true));
    /* Le service worker a été remplacé pendant que la page tournait : le code affiché est ancien. */
    if (nav.serviceWorker && nav.serviceWorker.addEventListener) nav.serviceWorker.addEventListener('controllerchange', () => { if (hadController) show(state.announced || 'sw'); });
    check(true);
    return { check, state, stop() { if (timer && win.clearInterval) win.clearInterval(timer); timer = null; } };
  }

  function autostart(win, doc) {
    if (win.__dermaiUpdate) return win.__dermaiUpdate;
    return (win.__dermaiUpdate = watch(win, doc));
  }

  return { URL_VERSION, INTERVAL_MS, MIN_GAP_MS, TEXT, bannerHtml, watch, autostart };
});
