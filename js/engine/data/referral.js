/* Orientation vers un professionnel : les situations qu'une application ne peut pas juger. Textes seulement, aucune décision du moteur, AUCUNE interprétation.

   RÈGLES (décidées avec le propriétaire du produit)
   - Pour les cas préoccupants (lésion qui dure, cicatrice en relief qui grossit, grain de beauté qui change), DERMAI renvoie vers un dermatologue et s'arrête là : il ne dit pas ce que c'est,
     ne rassure pas, n'alarme pas, ne donne aucune probabilité. Le moteur ne mesure rien de tout cela : ces situations sont reconnues par la PERSONNE, pas par DERMAI, et jamais déduites d'un score.
   - Une peau foncée n'est pas une raison d'attendre : le rappel vaut pour toutes les peaux, et précise que les grains de beauté et taches brunes se regardent aussi sous les ongles, sur les paumes
     et sur les plantes des pieds.
   - Un dermatologue peut être cher ou loin : on propose aussi un médecin généraliste ou un pharmacien, qui peuvent orienter. Aucun prix, aucun lieu n'est cité.
   - Ton cosmétique et prudent : aucun diagnostic. Le mot « chéloïde » est écrit une seule fois, entre parenthèses, parce que c'est le mot que les personnes connaissent ; DERMAI ne dit pas
     qu'une cicatrice en est une. Relecture par un professionnel de santé requise avant un lancement public.
   Module partagé navigateur / Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const E = (root.DermaiEngine = root.DermaiEngine || {}); E.referralData = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEXT = {
    title: 'Quand en parler à un dermatologue',
    intro: 'Certains signes ne se jugent pas sur une photo de téléphone. Si vous vous reconnaissez dans l\'un d\'eux, demandez l\'avis d\'un dermatologue.',
    summary: 'Voir ces situations',
    signs: [
      'Un bouton, une plaie ou une tache qui dure plus de quelques semaines, ou qui revient toujours au même endroit.',
      'Une cicatrice en relief qui grossit, dépasse la zone de la blessure, démange ou fait mal (par exemple une chéloïde).',
      'Un grain de beauté ou une tache brune ou noire qui change de taille, de forme ou de couleur, qui saigne ou qui démange. Regardez aussi sous les ongles, sur les paumes et sur les plantes des pieds.',
      'Des boutons profonds, douloureux ou très nombreux, ou une acné qui ne bouge pas malgré plusieurs produits.'
    ],
    cannot: 'DERMAI ne peut ni examiner votre peau, ni dire ce que c\'est, ni poser de diagnostic.',
    access: 'Si un dermatologue est difficile à joindre (délai, prix, distance), commencez par un médecin généraliste ou un pharmacien : ils peuvent vous orienter.',
    urgent: 'Gonflement du visage, difficulté à respirer, douleur vive ou vision gênée : consultez en urgence.',
    acne: 'Votre analyse retient l\'acné parmi vos axes de soin. Si les boutons sont nombreux, douloureux ou laissent des marques, un dermatologue peut examiner votre peau : DERMAI ne peut pas le faire.'
  };

  /* Trois phrases d'orientation à ne jamais dissocier de la liste. */
  const CLOSING = [TEXT.cannot, TEXT.access, TEXT.urgent];

  return { TEXT, CLOSING };
});
