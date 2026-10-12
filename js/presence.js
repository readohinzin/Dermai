/* DERMAI : présence « en ligne ». Tant qu'un compte est connecté ET que la page est visible, un battement part toutes les 30 secondes vers la fonction touch_presence de la base (via js/account.js) :
   elle n'enregistre qu'UNE date par compte (dernière activité). Rien d'autre n'est envoyé ni lu : ni page visitée, ni appareil, ni position. Le fondateur voit « en ligne » pour un compte dont la date a
   moins de 75 secondes (page d'administration).
   Aucun message à l'utilisatrice, jamais d'erreur affichée : un échec est silencieux et n'est pas rejoué en rafale (le prochain battement est dans 30 s). Fonction absente de la base (proposition SQL non
   appliquée) : plus aucun battement pendant la session. Rien n'est écrit dans le navigateur. Hors connexion, mode démonstration ou comptes indisponibles : aucun appel. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiPresence = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const BEAT_MS = 30000, CHECK_MS = 2000;   // contrôle toutes les 2 s (aucun réseau) : un battement part toutes les 30 à 32 s

  function create(deps) {
    const d = deps || {};
    const now = () => (d.now ? d.now() : Date.now());
    const visible = () => { try { return d.visible ? d.visible() : !(root.document && root.document.visibilityState === 'hidden'); } catch (e) { return true; } };
    const epoch = () => { try { return d.epoch ? d.epoch() : 0; } catch (e) { return 0; } };
    const acc = () => { try { return d.account ? d.account() : null; } catch (e) { return null; } };
    let last = -Infinity, busy = false, stopped = false, who = null, beats = 0;

    async function tick() {
      const a = acc(), id = a && a.user && a.user.id ? a.user.id : null;
      if (id !== who) { who = id; last = -Infinity; stopped = false; }   // autre compte ou déconnexion : nouveau départ, rien du compte précédent
      if (!id || stopped || busy || typeof a.touchPresence !== 'function' || !visible() || now() - last < BEAT_MS) return;
      busy = true; last = now();                                         // même en cas d'échec : pas de rafale
      const ep = epoch();
      try {
        const r = await a.touchPresence(); beats++;
        if (ep === epoch() && r && r.stop === true) stopped = true;
      } catch (e) { /* silencieux */ } finally { busy = false; }
    }

    function attach(doc) {
      const set = d.setInterval || (root.setInterval && root.setInterval.bind(root));
      if (set) set(tick, CHECK_MS);
      if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { tick(); });
      tick();
    }
    return { attach, tick, state: () => ({ who, stopped, busy, beats, last }) };
  }
  return { create, BEAT_MS, CHECK_MS };
});
