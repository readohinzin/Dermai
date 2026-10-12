/* DERMAI : « Recevoir un lien de connexion par e-mail » (lien magique), sans mot de passe à créer. Chargé avant app.js, après js/account.js.
   L'adresse saisie reçoit un e-mail avec un lien ; ouvrir le lien connecte la personne (un compte est créé au premier passage). Même réponse que l'adresse
   existe ou non (aucune énumération). La session revient dans l'adresse du site et est lue par le code existant de retour de lien (js/account.js) : vérifiée
   auprès de Supabase, puis effacée de la barre d'adresse. Ce module ne contacte jamais le réseau lui-même et ne garde aucun jeton, mot de passe ni secret. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiQuickLogin = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  /* deps : account() → DermaiAccount (available, requestMagicLink) · state() → state.account de l'app · render() · email() → adresse saisie dans le formulaire */
  function create(deps) {
    const d = deps || {};
    const acc = () => { try { return d.account ? d.account() : null; } catch (e) { return null; } };
    const emailValue = () => { try { return String(d.email ? d.email() : (root.document.getElementById('f-mail') || {}).value || '').trim(); } catch (e) { return ''; } };
    let sending = false;

    /* Lien magique : sous le formulaire, seulement si les comptes sont disponibles. */
    function magicHtml() {
      const a = acc();
      if (!a || !a.available || !a.requestMagicLink) return '';
      return `<p style="margin:14px 0 0;text-align:center"><button type="button" class="link" data-quick="magic">Recevoir un lien de connexion par e-mail</button></p><p class="muted" style="margin:6px 0 0;text-align:center">Saisissez votre adresse ci-dessus : pas de mot de passe à retenir.</p>`;
    }
    function show(o) {
      const st = d.state ? d.state() : null;
      if (st) { st.info = o.info || ''; st.error = o.error || ''; st.formEmail = o.email; }
      if (d.render) d.render();
    }
    /* Demande d'un lien : une seule à la fois ; l'adresse saisie est conservée ; le résultat s'affiche comme les autres messages du formulaire. */
    async function magic() {
      if (sending) return false;
      const a = acc();
      if (!a || !a.requestMagicLink) return false;
      sending = true;
      const email = emailValue();
      try {
        const r = await a.requestMagicLink(email);
        show(r && r.ok ? { info: r.message, email } : { error: (r && r.error) || '', email });
      } catch (e) { show({ error: 'Une erreur est survenue. Veuillez réessayer.', email }); }
      finally { sending = false; }
      return true;
    }
    function attach(doc) {
      doc.addEventListener('click', ev => {
        const m = ev.target && ev.target.closest ? ev.target.closest('[data-quick]') : null;
        if (m && !m.disabled && m.getAttribute('data-quick') === 'magic') magic();
      });
    }
    return { magicHtml, attach, magic };
  }
  return { create };
});
