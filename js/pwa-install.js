/* DermAI : installation sur l'écran d'accueil (PWA) et enregistrement du service worker. Module partagé navigateur / Node (testé avec un faux navigateur).
   - Android, Chrome, Edge : le navigateur propose l'installation (événement beforeinstallprompt) : un bandeau « Installer DermAI » ouvre la vraie fenêtre d'installation.
   - iPhone et iPad (Safari, Chrome, Firefox) : aucun bouton d'installation n'existe, seul le menu Partager permet « Sur l'écran d'accueil » : un bandeau l'explique, avec l'icône.
   - Déjà installée (mode application) : rien n'est affiché. Un bandeau fermé ne revient pas avant 30 jours (préférence gardée sur l'appareil seulement).
   - Aucun réseau, aucune donnée de personne : seulement l'état « fermé le… » dans localStorage (clé dermai.pwa.dismissed). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DermaiPwa = api; if (typeof window !== 'undefined' && typeof document !== 'undefined') api.start(window, document); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'dermai.pwa.dismissed';
  const QUIET_DAYS = 30;
  const DELAY_MS = 8000;
  const TEXT = {
    androidTitle: 'Installer DermAI',
    androidBody: 'Ajoutez DermAI à votre écran d\'accueil pour l\'ouvrir comme une application.',
    androidButton: 'Installer',
    iosTitle: 'Installer DermAI sur votre iPhone',
    iosStep1: 'Touchez le bouton Partager',
    iosStep2: 'puis « Sur l\'écran d\'accueil ».',
    iosBody: 'Dans Safari, touchez le bouton Partager, puis « Sur l\'écran d\'accueil ».',
    close: 'Plus tard'
  };

  function isIos(nav) {
    const ua = String((nav && nav.userAgent) || '');
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && Number(nav && nav.maxTouchPoints) > 1);   // iPadOS se présente comme un Mac
  }
  function isStandalone(win) {
    try { if (win.navigator && win.navigator.standalone === true) return true; return !!(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches); } catch (e) { return false; }
  }
  function dismissedRecently(storage, now) {
    try { const t = Number(storage && storage.getItem(KEY)); return Number.isFinite(t) && t > 0 && now - t < QUIET_DAYS * 86400000; } catch (e) { return false; }
  }
  function dismiss(storage, now) { try { if (storage) storage.setItem(KEY, String(now)); } catch (e) { /* stockage refusé : le bandeau reviendra, sans conséquence */ } }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  /* Icône « Partager » d'iOS : un carré ouvert avec une flèche vers le haut. */
  const SHARE_ICON = '<svg class="pwa-share" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M12 15V4M8 8l4-4 4 4M6 11H5a1 1 0 00-1 1v7a1 1 0 001 1h14a1 1 0 001-1v-7a1 1 0 00-1-1h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function bannerHtml(kind) {
    const body = kind === 'ios'
      ? '<p class="pwa-title">' + esc(TEXT.iosTitle) + '</p><p class="pwa-body">' + esc(TEXT.iosStep1) + ' ' + SHARE_ICON + ' ' + esc(TEXT.iosStep2) + '</p>'
      : '<p class="pwa-title">' + esc(TEXT.androidTitle) + '</p><p class="pwa-body">' + esc(TEXT.androidBody) + '</p>';
    return '<div class="pwa-banner" role="region" aria-label="' + esc(kind === 'ios' ? TEXT.iosTitle : TEXT.androidTitle) + '" data-pwa-banner="' + kind + '"><div class="pwa-text">' + body + '</div><div class="pwa-actions">' +
      (kind === 'android' ? '<button type="button" class="pwa-install" data-pwa-install>' + esc(TEXT.androidButton) + '</button>' : '') +
      '<button type="button" class="pwa-later" data-pwa-later>' + esc(TEXT.close) + '</button></div></div>';
  }

  function registerWorker(win) {
    const nav = win.navigator;
    if (!nav || !('serviceWorker' in nav)) return Promise.resolve(null);
    return new Promise(resolve => {
      const go = () => nav.serviceWorker.register('/sw.js').then(resolve, () => resolve(null));
      if (win.document && win.document.readyState === 'complete') go(); else win.addEventListener('load', go);
    });
  }

  /* win, doc : fenêtre et document (réels ou simulés). Renvoie des repères pour les tests. */
  function start(win, doc, opts) {
    const o = opts || {}, now = () => (typeof o.now === 'function' ? o.now() : Date.now()), delay = o.delay === undefined ? DELAY_MS : o.delay;
    const state = { deferred: null, shown: null, registered: registerWorker(win) };
    let storage = null; try { storage = win.localStorage; } catch (e) { storage = null; }
    if (isStandalone(win)) return Object.assign(state, { skipped: 'standalone' });

    const show = kind => {
      if (state.shown || dismissedRecently(storage, now()) || isStandalone(win)) return;
      const host = doc.createElement('div'); host.innerHTML = bannerHtml(kind);
      const el = host.firstElementChild; doc.body.appendChild(el); state.shown = kind;
      const close = () => { dismiss(storage, now()); el.remove(); state.shown = null; };
      el.querySelector('[data-pwa-later]').addEventListener('click', close);
      const btn = el.querySelector('[data-pwa-install]');
      if (btn) btn.addEventListener('click', async () => {
        const ev = state.deferred; if (!ev) return;
        el.remove(); state.shown = null;
        try { ev.prompt(); const choice = await ev.userChoice; if (!choice || choice.outcome !== 'accepted') dismiss(storage, now()); } catch (e) { /* la fenêtre d'installation n'a pas pu s'ouvrir */ }
        state.deferred = null;
      });
    };

    win.addEventListener('beforeinstallprompt', e => { e.preventDefault(); state.deferred = e; setTimeout(() => show('android'), delay); });
    win.addEventListener('appinstalled', () => { state.deferred = null; const el = doc.querySelector('[data-pwa-banner]'); if (el) el.remove(); state.shown = null; dismiss(storage, now()); });
    if (isIos(win.navigator)) setTimeout(() => show('ios'), delay);
    return state;
  }

  return { KEY, QUIET_DAYS, DELAY_MS, TEXT, isIos, isStandalone, dismissedRecently, dismiss, bannerHtml, registerWorker, start };
});
