/* DERMAI : œil « afficher / masquer le mot de passe » dans chaque champ de mot de passe. Chargé avant app.js.
   Aucun changement du code de l'application : ce module repère les champs de mot de passe à chaque réaffichage de l'écran et leur ajoute un bouton.
   Le mot de passe reste MASQUÉ par défaut (chaque réaffichage recrée un champ masqué). Il est remasqué dès que la page passe en arrière-plan ou est quittée.
   Aucune valeur n'est lue, copiée, gardée ni envoyée ici : le module ne change que le type du champ (password / text). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiPasswordToggle = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0112 5c6.5 0 10 7 10 7a17.6 17.6 0 01-3.2 4.2M6.6 6.6A17.7 17.7 0 002 12s3.5 7 10 7a9.7 9.7 0 004.4-1.1M9.9 9.9a3 3 0 004.2 4.2"/></svg>';
  const LABEL = { show: 'Afficher le mot de passe', hide: 'Masquer le mot de passe' };

  function paint(input, btn) {
    const shown = input.type === 'text';
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
    btn.setAttribute('aria-label', shown ? LABEL.hide : LABEL.show);
    btn.setAttribute('title', shown ? LABEL.hide : LABEL.show);
    btn.innerHTML = shown ? EYE_OFF : EYE;
  }

  /* Ajoute l'œil aux champs de mot de passe de `scope` qui n'en ont pas encore. Renvoie le nombre de champs traités. */
  function enhance(scope) {
    const doc = (scope && scope.ownerDocument) || root.document;
    if (!scope || !scope.querySelectorAll || !doc) return 0;
    let n = 0;
    scope.querySelectorAll('input[type="password"]:not([data-pw-eye])').forEach(input => {
      if (!input.parentNode) return;
      input.setAttribute('data-pw-eye', '1');
      const wrap = doc.createElement('span');
      wrap.className = 'c-pw';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = doc.createElement('button');
      btn.type = 'button';                        // jamais un bouton d'envoi du formulaire
      btn.className = 'c-pw__eye';
      btn.setAttribute('data-pw-toggle', '1');
      btn.addEventListener('mousedown', ev => ev.preventDefault());   // le champ garde le focus (le clavier du téléphone reste ouvert)
      btn.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; paint(input, btn); });
      paint(input, btn);
      wrap.appendChild(btn);
      n++;
    });
    return n;
  }

  /* Remasque tous les champs révélés (page en arrière-plan, page quittée). */
  function hideAll(scope) {
    const s = scope || (root.document && root.document.body);
    if (!s || !s.querySelectorAll) return 0;
    let n = 0;
    s.querySelectorAll('input[data-pw-eye]').forEach(input => {
      if (input.type !== 'password') { input.type = 'password'; n++; const b = input.parentNode && input.parentNode.querySelector('[data-pw-toggle]'); if (b) paint(input, b); }
    });
    return n;
  }

  function start() {
    const doc = root.document;
    if (!doc || !doc.body) return null;
    enhance(doc.body);
    let obs = null;
    if (typeof root.MutationObserver === 'function') {
      obs = new root.MutationObserver(() => enhance(doc.body));
      obs.observe(doc.body, { childList: true, subtree: true });
    }
    doc.addEventListener('visibilitychange', () => { if (doc.hidden) hideAll(doc.body); });
    root.addEventListener('pagehide', () => hideAll(doc.body));
    return obs;
  }

  if (typeof document !== 'undefined' && root === (typeof window !== 'undefined' ? window : null)) start();
  return { enhance, hideAll, start, LABEL };
});
