/* DERMAI : écran Confidentialité et question « garder mes photos ? » (HTML seulement). Aucune décision ici, aucun stockage : l'état vient
   d'app.js (choix du profil `keep_photos`), les envois et suppressions passent par js/account.js (Storage privé scan-photos).
   Choix de conservation des photos :
     - undefined : fonction indisponible (migration non appliquée, mode démo ou visiteur) : rien n'est proposé ;
     - null      : pas encore demandé : la question est posée sur le résultat de l'analyse (jamais de case pré-cochée) ;
     - true      : les photos des prochaines analyses sont gardées dans le compte ;
     - false     : plus de nouvelle photo gardée ; les photos déjà gardées restent jusqu'à « Supprimer mes photos ». */
(function (root) {
  'use strict';
  const TEXT = {
    askTitle: 'Garder vos photos d\'analyse dans votre compte ?',
    askBody: 'Vous pourrez revoir la photo de chaque analyse et comparer votre peau dans le temps. Elles restent privées : personne d\'autre que vous n\'y a accès. Vous pouvez changer d\'avis à tout moment dans Confidentialité.',
    askYes: 'Oui, garder mes photos',
    askNo: 'Non merci',
    switchLabel: 'Conserver mes photos d\'analyse',
    switchOn: 'Les photos de vos prochaines analyses sont gardées dans votre compte.',
    switchOff: 'Les photos de vos prochaines analyses ne sont pas gardées.',
    switchNull: 'Vous n\'avez pas encore choisi : la question vous sera posée à votre prochaine analyse.',
    offKeeps: 'Désactiver n\'efface pas les photos déjà gardées : utilisez « Supprimer mes photos ».'
  };

  /* Carte affichée sur le résultat de l'analyse tant que le choix n'est pas fait. */
  function ask(ic, busy) {
    const dis = busy ? ' disabled' : '';
    return `<div class="c-notice c-photo-ask" role="group" aria-labelledby="pa-title">${ic('camera')}<div><span class="c-notice__title" id="pa-title">${TEXT.askTitle}</span>${TEXT.askBody}
      <div class="c-photo-ask__actions"><button class="c-btn c-btn--primary c-btn--sm" data-act="photo-choice" data-v="yes"${dis}>${TEXT.askYes}</button><button class="c-btn c-btn--secondary c-btn--sm" data-act="photo-choice" data-v="no"${dis}>${TEXT.askNo}</button></div></div></div>`;
  }

  /* Écran Confidentialité. o : { demo, signedIn, photos, busy, ic, sw }. */
  function privacy(o) {
    const ic = o.ic, real = !o.demo, can = real && o.signedIn && o.photos !== undefined;
    const intro = o.demo ? 'Vos photos sont utilisées pour analyser votre peau.'
      : 'Votre photo sert à analyser votre peau. DERMAI ne la garde dans votre compte que si vous l\'avez choisi.';
    const items = o.demo
      ? [['lock', 'Vous pourrez gérer vos photos et vos données depuis cet écran.'], ['eye', 'Les conditions précises seront détaillées ici avant le lancement.']]
      : [['lock', 'Si vous créez un compte, vos préférences (objectifs, niveau de routine, approche douce) sont associées à ce compte.'],
        ['eye', 'Ces préférences servent uniquement à personnaliser votre expérience. Elles ne contiennent aucune information médicale.'],
        ['layers', 'Si vous êtes connecté, vos analyses peuvent être enregistrées dans votre compte pour afficher votre historique et votre progression. Seuls vos scores, vos priorités du moment et vos objectifs de ce jour sont conservés avec l\'analyse.'],
        ['lock', 'Si vous choisissez un pays pour vos achats, ce choix reste dans ce navigateur : il n\'est pas envoyé à DERMAI, et DERMAI n\'utilise ni votre position ni votre adresse IP.'],
        ['camera', 'Pour obtenir l\'analyse, votre photo est transmise à notre service d\'analyse.'],
        ['image', 'Vos photos d\'analyse ne sont gardées dans votre compte que si vous l\'avez choisi. Elles sont privées : personne d\'autre que vous n\'y a accès, et vous pouvez les supprimer à tout moment. Les zones détectées sur la photo ne sont jamais conservées.'],
        ['shield', 'Ces données sont associées à votre compte : vous seul pouvez accéder à vos analyses.'],
        ['lock', 'Votre adresse e-mail et votre mot de passe sont gérés par notre service d\'authentification. DERMAI ne voit ni ne conserve votre mot de passe.'],
        ['trash', 'Vous pouvez supprimer vos photos, votre historique d\'analyses (photos comprises), ou votre compte entier (profil, analyses et photos compris), depuis « Gérer mes données ».'],
        ['eye', 'Une analyse nécessite un compte. Sans compte, rien n\'est conservé d\'une session à l\'autre.']];
    const keep = o.photos === true;
    const sub = o.photos === null ? TEXT.switchNull : keep ? TEXT.switchOn + ' ' + TEXT.offKeeps : TEXT.switchOff;
    const realSwitch = `<section><div class="rowlink"><div class="grow"><b>${TEXT.switchLabel}</b><span class="s">${sub}</span></div><button class="c-switch" role="switch" aria-checked="${keep}" data-act="photo-keep" aria-label="${TEXT.switchLabel}"${o.busy ? ' disabled' : ''}></button></div></section>`;
    const row = (act, v, icon, title, s, top) => `<button class="rowlink" data-act="${act}" data-v="${v}"${top ? ' style="border-top:1px solid var(--line)"' : ''}>${ic(icon)}<div class="grow"><b>${title}</b><span class="s">${s}</span></div>${ic('chev')}</button>`;
    const photosRow = o.demo || can;
    return `<div class="pagehead"><h1>Confidentialité</h1><p style="color:var(--ink);font-size:18px">${intro}</p></div>
  <div class="grid2"><div class="col">
   <section><ul class="l-list" style="margin-top:0">${items.map(([i, t]) => `<li>${ic(i)}<span>${t}</span></li>`).join('')}</ul></section>
   ${o.demo ? `<section>${o.sw('keep', 'Conserver mes photos', 'Pour comparer avant et maintenant')}</section>` : can ? realSwitch : ''}
  </div><div class="col"><section><div class="hd"><h2 class="h3">Gérer mes données</h2></div>
   ${photosRow ? row('confirm', 'photos', 'camera', 'Supprimer mes photos', 'Les analyses restent disponibles', true) : ''}
   ${row('confirm', 'history', 'layers', 'Supprimer mon historique', real ? 'Analyses, photos et progression' : 'Analyses et progression', !photosRow)}
   ${row('toast', 'L\'export de vos données n\'est pas encore disponible.', 'download', 'Exporter mes données', o.demo ? 'Un fichier avec toutes vos informations' : 'Pas encore disponible', false)}
   ${o.demo ? row('confirm', 'account', 'trash', 'Supprimer mon compte', 'Action définitive', false) : o.signedIn ? row('confirm', 'delete-account', 'trash', 'Supprimer mon compte', 'Profil, analyses et photos compris, action définitive', false) : ''}</section></div></div>`;
  }

  root.DermaiPhotos = { ask, privacy, TEXT };
})(typeof self !== 'undefined' ? self : this);
