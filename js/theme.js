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

  function start(win, doc) {
    if (win.__dermaiTheme) return win.__dermaiTheme;
    const state = { bound: true };
    win.__dermaiTheme = state;
    apply(doc, win, get());
    doc.addEventListener('click', ev => {
      const el = ev.target && ev.target.closest ? ev.target.closest('[data-theme-set]') : null;
      if (!el) return;
      const mode = el.getAttribute('data-theme-set'); if (!isMode(mode)) return;
      set(mode, doc, win);
      doc.querySelectorAll('[data-theme-set]').forEach(b => b.setAttribute('aria-checked', String(b.getAttribute('data-theme-set') === mode)));
    });
    if (win.matchMedia) { const mq = win.matchMedia('(prefers-color-scheme: dark)'), on = () => { if (get() === 'system') apply(doc, win, 'system'); }; if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on); }
    return state;
  }

  return { KEY, MODES, LABELS, BAR, TEXT, read, write, get, set, apply, effective, picker, compact, start };
});
