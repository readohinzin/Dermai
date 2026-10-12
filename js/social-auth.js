/* DERMAI : bouton « Continuer avec Google ». Chargé avant app.js, après js/account.js.
   Ce module ne contacte jamais le réseau lui-même : un clic envoie le navigateur à l'adresse de connexion de Supabase (DermaiAccount.oauthUrl), qui fait
   le tour chez le fournisseur puis revient sur le site avec la session (traitée par le code existant de retour de lien, js/account.js).
   Fermé par défaut : un bouton n'apparaît que si le fournisseur est listé par le serveur (DERMAI_SOCIAL_PROVIDERS, exposé par /api/config-js) ET que les
   comptes sont disponibles. Aucun mot de passe, aucun jeton, aucune donnée du fournisseur n'est lue ni gardée ici. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiSocial = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  /* Logo officiel de la marque, en SVG intégré (aucun chargement externe). */
  const GOOGLE = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  const PROVIDERS = { google: ['Continuer avec Google', GOOGLE] };

  /* deps : url(fournisseur) → adresse de connexion ou '' · go(adresse) → ouvre l'adresse · providers() → liste du serveur */
  function create(deps) {
    const d = deps || {};
    const listed = () => {
      try {
        const l = d.providers ? d.providers() : (root.DERMAI_CONFIG && root.DERMAI_CONFIG.socialProviders);
        return Array.isArray(l) ? Object.keys(PROVIDERS).filter(p => l.includes(p)) : [];
      } catch (e) { return []; }
    };
    const enabled = () => listed().filter(p => { try { return !!(d.url && d.url(p)); } catch (e) { return false; } });
    let going = false;

    /* Bloc de boutons (chaîne vide si aucun fournisseur n'est ouvert). */
    function html() {
      const on = enabled();
      if (!on.length) return '';
      return `<div class="stack" style="gap:10px;margin-bottom:6px">${on.map(p => `<button type="button" class="c-btn c-btn--secondary c-btn--block" data-social="${p}" style="gap:10px">${PROVIDERS[p][1]}<span>${PROVIDERS[p][0]}</span></button>`).join('')}</div><p class="muted" style="text-align:center;margin:12px 0 16px">ou avec votre adresse e-mail</p>`;
    }
    /* Un seul départ à la fois : un second clic pendant le départ n'est pas pris en compte. */
    function start(provider) {
      if (going || !enabled().includes(provider)) return false;
      const u = d.url(provider);
      if (!u) return false;
      going = true;
      try { (d.go || (a => root.location.assign(a)))(u); } catch (e) { going = false; return false; }
      return true;
    }
    function attach(doc) {
      doc.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest && ev.target.closest('[data-social]');
        if (!el || el.disabled) return;
        if (start(el.getAttribute('data-social'))) { el.disabled = true; }
      });
    }
    return { html, attach, start, enabled };
  }
  return { create, PROVIDERS };
});
