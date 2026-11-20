/* DermAI : apparence (clair, sombre, automatique). Module partagé navigateur / Node (stockage et document injectés : testé sans navigateur).
   - Automatique (défaut) : suit le réglage du téléphone ou de l'ordinateur (prefers-color-scheme), en direct si la personne change son réglage.
   - Clair / Sombre : choix gardé SUR L'APPAREIL seulement (localStorage, clé dermai.theme), posé sur <html data-theme="…"> ; un petit script dans <head> le pose avant l'affichage (aucun éclair blanc).
   - La couleur de la barre du navigateur (meta theme-color) suit le thème affiché.
   Les couleurs elles-mêmes sont des jetons (css/tokens.css), vérifiés en contraste dans les deux thèmes (test/contrast.test.js). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DermaiTheme = api; if (typeof window !== 'undefined' && typeof document !== 'undefined') api.start(window, document); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'dermai.theme';
  const MODES = ['system', 'light', 'dark'];
  const LABELS = { system: 'Automatique', light: 'Clair', dark: 'Sombre' };
  const BAR = { light: '#FFF9FA', dark: '#171214' };      // couleur de la barre du navigateur : le fond (--bg) de chaque thème
  const TEXT = { title: 'Apparence', hint: 'Clair, sombre, ou comme votre téléphone.', status: m => 'Apparence : ' + LABELS[m] + '.' };

  const isMode = v => MODES.includes(v);
  const read = storage => { try { const v = storage && storage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch (e) { return 'system'; } };
  function write(storage, mode) {
    try { if (!storage) return false; if (mode === 'system') storage.removeItem(KEY); else if (isMode(mode)) storage.setItem(KEY, mode); else return false; return true; } catch (e) { return false; }
  }
  let session = null;                                  // le choix vaut pour la visite si le stockage est refusé
  const browserStore = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
  const get = storage => { const m = read(storage === undefined ? browserStore() : storage); return m !== 'system' ? m : (session || 'system'); };

  /* Thème réellement affiché : « light » ou « dark ». */
  const effective = (mode, systemDark) => (mode === 'light' || mode === 'dark' ? mode : (systemDark ? 'dark' : 'light'));

  function apply(doc, win, mode) {
    const el = doc.documentElement;
    if (mode === 'light' || mode === 'dark') el.setAttribute('data-theme', mode); else el.removeAttribute('data-theme');
    const dark = !!(win && win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches), shown = effective(mode, dark);
    /* une seule balise theme-color pilotée par le thème affiché (les deux balises « media » du <head> ne suivent pas le choix manuel) */
    const metas = doc.querySelectorAll ? [...doc.querySelectorAll('meta[name="theme-color"]')] : [];
    metas.forEach((m, i) => { if (i === 0) { m.setAttribute('content', BAR[shown]); m.removeAttribute('media'); } else m.remove(); });
    return shown;
  }
  function set(mode, doc, win, storage) {
    if (!isMode(mode)) return null;
    session = mode === 'system' ? null : mode;
    write(storage === undefined ? browserStore() : storage, mode);
    return apply(doc, win, get(storage));
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  /* Choix à trois boutons (groupe de boutons radio), géré par start() : aucun état dans l'application. */
  function picker(mode) {
    const m = mode === undefined ? get() : mode;
    return '<section class="c-theme" data-theme-picker aria-labelledby="theme-title"><h2 class="h3" id="theme-title">' + esc(TEXT.title) + '</h2><p class="muted">' + esc(TEXT.hint) + '</p>' +
      '<div class="c-theme__row" role="radiogroup" aria-label="' + esc(TEXT.title) + '">' + MODES.map(x => '<button type="button" class="c-theme__opt" role="radio" aria-checked="' + (m === x) + '" data-theme-set="' + x + '">' + esc(LABELS[x]) + '</button>').join('') + '</div></section>';
  }

  /* Variante compacte (barre latérale) : même groupe de boutons radio, sans titre. */
  function compact(mode) {
    const m = mode === undefined ? get() : mode;
    return '<div class="c-theme c-theme--compact" data-theme-picker><p class="sidebar__label" id="theme-label">' + esc(TEXT.title) + '</p><div class="c-theme__row" role="radiogroup" aria-labelledby="theme-label">' +
      MODES.map(x => '<button type="button" class="c-theme__opt" role="radio" aria-checked="' + (m === x) + '" data-theme-set="' + x + '">' + esc(LABELS[x]) + '</button>').join('') + '</div></div>';
  }

  /* Bouton de l'en-tête (mobile) : bascule entre clair et sombre en un geste. Les deux dessins (lune, soleil) sont dans le bouton ; la feuille de style montre celui du thème affiché (css/components/pwa.css). */
  const TOGGLE = { label: 'Changer le mode d\'affichage (clair ou sombre)' };
  const SVG = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
  const toggle = () => '<button type="button" class="c-themebtn" data-theme-toggle aria-label="' + esc(TOGGLE.label) + '">' +
    '<svg class="c-themebtn__moon" ' + SVG + '><path d="M20 14.5A8 8 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>' +
    '<svg class="c-themebtn__sun" ' + SVG + '><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg></button>';

  function start(win, doc) {
    if (win.__dermaiTheme) return win.__dermaiTheme;
    const state = { bound: true };
    win.__dermaiTheme = state;
    apply(doc, win, get());
    doc.addEventListener('click', ev => {
      const tg = ev.target && ev.target.closest ? ev.target.closest('[data-theme-toggle]') : null;
      if (tg) {
        const dark = !!(win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches), next = effective(get(), dark) === 'dark' ? 'light' : 'dark';
        set(next, doc, win);
        doc.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.getAttribute('data-theme-set') === next)));
        return;
      }
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-theme-set]') : null;
      if (!el) return;
      const mode = el.getAttribute('data-theme-set'); if (!isMode(mode)) return;
      set(mode, doc, win);
      doc.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.getAttribute('data-theme-set') === mode)));
    });
    if (win.matchMedia) { const mq = win.matchMedia('(prefers-color-scheme: dark)'), on = () => { if (get() === 'system') apply(doc, win, 'system'); }; if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on); }
    return state;
  }

  return { KEY, MODES, LABELS, BAR, TEXT, read, write, get, set, apply, effective, picker, compact, toggle, TOGGLE, start };
});
