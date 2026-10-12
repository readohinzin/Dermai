/* DERMAI : barre latérale de navigation. Un seul élément <aside> : colonne fixe à gauche sur ordinateur (dès 920 px), panneau coulissant sur mobile ouvert par une icône de menu.
   Chargé avant app.js. Le module ne connaît ni le réseau, ni le stockage, ni les analyses : il écrit du HTML (liste d'entrées vers les écrans EXISTANTS, via le mécanisme
   de navigation déjà en place : attributs data-go, traités par app.js) et gère l'ouverture du panneau mobile (bouton, fond, Échap, clavier). Aucune entrée ne contourne
   l'authentification : un clic appelle go(), comme la barre du bas, et chaque écran applique ses propres protections.
   Entrées : uniquement des écrans qui existent. La simulation cosmétique n'est ouverte que pour certains comptes (décision du serveur) : son entrée n'apparaît que lorsque
   l'application confirme qu'elle est disponible pour le compte connecté et qu'une analyse existe (deps.simulation), jamais pour un écran qui répondrait « indisponible ». Même principe pour « Studio Beauté » (deps.studio : ouvert pour ce compte par le serveur). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiSidebar = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Écrans (routes de app.js) regroupés par entrée : la page active est celle dont la route figure dans `routes`. */
  const ITEMS = [
    { id: 'home', label: 'Tableau de bord', icon: 'home', go: 'home', routes: ['home', 'result', 'concern'] },
    { id: 'scan', label: 'Analyser ma peau', icon: 'scan', go: 'scan', routes: ['scan', 'analyzing'] },
    { id: 'analyses', label: 'Mes analyses', icon: 'layers', go: 'analyses', routes: ['analyses'] },
    { id: 'progress', label: 'DERMAI Évolution', icon: 'chart', go: 'progress', routes: ['progress'], fresh: true },
    { id: 'program', label: 'Programme de soins', icon: 'calendar', go: 'program', routes: ['program'] },
    { id: 'verif', label: 'Vérif\'Routine', icon: 'shield', go: 'verif', routes: ['verif'] },
    { id: 'simulation', label: 'Simulation cosmétique', icon: 'sparkle', go: 'simulation', routes: ['simulation'], when: 'simulation' },
    { id: 'studio', label: 'Studio Beauté', icon: 'sparkle', go: 'studio', routes: ['studio'], when: 'studio' },
    { id: 'routine', label: 'Ma routine', icon: 'routine', go: 'routine', routes: ['routine', 'actives', 'active', 'products'] },
    { id: 'admin', label: 'Administration', icon: 'dashboard', go: 'admin', routes: ['admin'], when: 'admin' }
  ];
  const OTHERS = [
    { id: 'profile', label: 'Profil et paramètres', icon: 'user', go: 'profile', routes: ['profile', 'privacy'], avatar: true }
  ];
  /* Indicateur « Nouveau » sur DERMAI Évolution : limité dans le temps (aucun stockage), puis il disparaît tout seul. */
  const NEW_UNTIL = Date.parse('2026-12-15T00:00:00Z');
  const WIDE = '(min-width:920px)';

  /* Icônes absentes du jeu de l'application (menu, fermer, calendrier) : même gabarit (24 px, trait 1,7). Les autres viennent de ic() de l'application. */
  const OWN = {
    /* Icône « panneau latéral » : cadre arrondi dont la partie gauche est pleine (la colonne). */
    panel: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M3 8.5A3.5 3.5 0 0 1 6.5 5H11v14H6.5A3.5 3.5 0 0 1 3 15.5z" fill="currentColor" stroke="none"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/>',
    dashboard: '<rect x="3" y="3" width="8" height="10" rx="2"/><rect x="14" y="3" width="7" height="6" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="8" height="5" rx="2"/>'
  };
  const svg = p => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

  function create(deps) {
    const d = deps || {};
    const doc = () => (typeof document !== 'undefined' ? document : null);
    const ic = n => (OWN[n] ? svg(OWN[n]) : d.ic ? d.ic(n) : '');
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
    const route = () => { try { return d.route ? d.route() : ''; } catch (e) { return ''; } };
    const now = () => { try { return d.now ? d.now() : Date.now(); } catch (e) { return Date.now(); } };
    let open = false, openRoute = null, opener = null;
    /* Entrées conditionnelles : `when` nomme la condition, évaluée par l'application (jamais déduite ici), chacune par SA dépendance : simulation, studio, admin.
       « admin » n'apparaît que si le serveur a répondu « fondateur » : l'absence d'entrée n'est pas un contrôle d'accès (l'API refuse à elle seule). */
    const allowed = i => { if (!i.when) return true; try { return !!(d[i.when] && ['simulation', 'studio', 'admin'].includes(i.when) && d[i.when]()); } catch (e) { return false; } };

    const currentId = r => { const all = ITEMS.concat(OTHERS), hit = all.find(i => i.routes.includes(r)); return hit ? hit.id : null; };
    const wide = () => { try { return typeof matchMedia === 'function' && matchMedia(WIDE).matches; } catch (e) { return false; } };

    const signedIn = () => { try { return !!(d.signedIn && d.signedIn()); } catch (e) { return false; } };
    /* « Se déconnecter » : même action que dans le profil (data-act="logout", traitée par l'application). Visible seulement pour un compte connecté. */
    const logoutItem = () => `<li><button type="button" class="sidebar__link" data-act="logout">${ic('out')}<span class="sidebar__text">Se déconnecter</span></button></li>`;
    function link(i, cur) {
      const badge = i.fresh && now() < NEW_UNTIL ? '<span class="sidebar__badge">Nouveau</span>' : '';
      const lead = i.avatar && d.initial ? `<span class="sidebar__avatar" aria-hidden="true">${d.initial()}</span>` : ic(i.icon);
      return `<li><button type="button" class="sidebar__link" data-go="${i.go}" data-reset="1" ${cur === i.id ? 'aria-current="page"' : ''}>${lead}<span class="sidebar__text">${esc(i.label)}</span>${badge}</button></li>`;
    }

    /* Colonne latérale (ordinateur) et panneau coulissant (mobile) : un seul élément, avec le fond cliquable qui le suit. */
    function html() {
      const r = route(), cur = currentId(r);
      if (open && r !== openRoute) open = false;                       // l'écran a changé (retour du navigateur, lien) : le panneau se referme
      lock();
      return `<aside class="rail sidebar" id="sidebar" aria-label="Barre latérale"${open ? ' role="dialog" aria-modal="true"' : ''}${open ? ' data-open="1"' : ''}>
      <div class="sidebar__head">${d.brand ? d.brand(52) : ''}<button type="button" class="sidebar__close" data-sb="close" aria-label="Fermer le menu">${ic('close')}</button></div>
      <nav aria-label="Menu principal"><ul class="sidebar__list">${ITEMS.filter(allowed).map(i => link(i, cur)).join('')}</ul></nav>
      <div class="sidebar__foot"><p class="sidebar__label">Autres accès</p><nav aria-label="Compte"><ul class="sidebar__list">${OTHERS.map(i => link(i, cur)).join('')}${signedIn() ? logoutItem() : ''}</ul></nav>
      <small>Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.</small></div></aside>
      <div class="sidebar__scrim" data-sb="close"${open ? ' data-open="1"' : ''} aria-hidden="true"></div>`;
    }
    /* Icône de menu (mobile), placée dans l'en-tête de page. */
    function toggle() {
      return `<button type="button" class="sidebar__toggle" data-sb="open" aria-label="Ouvrir le menu" aria-controls="sidebar" aria-expanded="${open ? 'true' : 'false'}">${ic('panel')}</button>`;
    }

    const lock = () => { const b = doc() && doc().body; if (b) b.classList.toggle('sb-lock', open); };
    /* Met le DOM courant en accord avec `open` (sans réafficher l'application). */
    function apply() {
      const x = doc(); if (!x) return;
      const side = x.getElementById('sidebar'), scrim = x.querySelector('.sidebar__scrim'), tg = x.querySelector('[data-sb=open]');
      if (side) {
        if (open) { side.setAttribute('data-open', '1'); side.setAttribute('role', 'dialog'); side.setAttribute('aria-modal', 'true'); }
        else { side.removeAttribute('data-open'); side.removeAttribute('role'); side.removeAttribute('aria-modal'); }
      }
      if (scrim) { if (open) scrim.setAttribute('data-open', '1'); else scrim.removeAttribute('data-open'); }
      if (tg) tg.setAttribute('aria-expanded', open ? 'true' : 'false');
      lock();
    }
    function show() {
      if (open || wide()) return;
      const x = doc(); opener = x ? x.activeElement : null;
      open = true; openRoute = route(); apply();
      const first = x && x.querySelector('.sidebar__close'); if (first) first.focus();
    }
    function hide(back) {
      if (!open) return;
      open = false; apply();
      const x = doc();
      if (back) { const t = x && x.querySelector('[data-sb=open]'); const el = t && t.offsetParent !== null ? t : opener; if (el && el.focus) el.focus(); }
      opener = null;
    }

    function attach(x) {
      if (!x || !x.addEventListener) return;
      /* Capture : le panneau se ferme AVANT que l'application ne traite le même clic (navigation), sans jamais l'empêcher. */
      x.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-sb],#sidebar [data-go],#sidebar [data-act]') : null;
        if (!el) return;
        const a = el.getAttribute('data-sb');
        if (a === 'open') show(); else if (a === 'close') hide(true); else hide(false);
      }, true);
      x.addEventListener('keydown', ev => {
        if (!open) return;
        if (ev.key === 'Escape') { hide(true); return; }
        if (ev.key !== 'Tab') return;
        const side = x.getElementById('sidebar'); if (!side) return;
        const f = [...side.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')].filter(e => !e.disabled && e.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1], at = x.activeElement;
        if (!side.contains(at)) { ev.preventDefault(); first.focus(); }
        else if (ev.shiftKey && at === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && at === last) { ev.preventDefault(); first.focus(); }
      });
      try { if (typeof matchMedia === 'function') matchMedia(WIDE).addEventListener('change', e => { if (e.matches) hide(false); }); } catch (e) { /* navigateur ancien : le panneau reste fermable à la main */ }
    }
    return { html, toggle, attach, isOpen: () => open, close: () => hide(false) };
  }

  return { create, ITEMS, OTHERS, NEW_UNTIL };
});
