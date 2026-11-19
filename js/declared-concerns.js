/* DERMAI : « Ce que vous signalez ». Affichage SEUL, aucune décision.
   Problème traité : une personne indique ce qui la préoccupe (par exemple l'acné), l'analyse ne le retient pas, et l'écran lui dit en substance
   « ce n'est pas une priorité ». Elle repart avec l'impression que sa préoccupation n'existe pas.

   Ce module ne change rien au moteur : mêmes priorités, mêmes soins, mêmes scores. Il lit le résultat de Engine.run (objectifs de la synthèse,
   statut de chaque indicateur, mode) et ajoute un encart qui dit, honnêtement :
     1. ce que l'analyse en dit sur cette photo (sans note chiffrée : un « 78 » à côté d'« Acné » se lit comme une bonne note) ;
     2. que cela ne veut pas dire que la préoccupation n'existe pas : une seule photo, repères provisoires, marques ou cicatrices non mesurées ;
     3. ce que DERMAI fait malgré tout dans la routine (soin doux ajouté, ou routine de base seulement) ;
     4. quand parler à un dermatologue ou à un pharmacien (durée, produits sans effet). Aucun diagnostic, aucune interprétation.
   Ce que la personne signale n'est JAMAIS présenté comme une mesure. Une métrique absente reste absente : rien n'est inventé.

   Cas sans objectif : si l'analyse ne retient rien et que la personne n'a rien indiqué, l'encart l'invite à dire ce qu'elle voit.
   Les objectifs « retenus » (priorité) et « au-delà du plafond » sont déjà dits par l'écran : ils n'apparaissent pas ici.

   Module partagé navigateur / Node. Chargé après insight-view.js. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const dep = isNode
    ? { insight: require('./insight-view.js').DermaiInsight, actives: require('./engine/actives.js'), decision: require('./engine/data/decision.js') }
    : { insight: root.DermaiInsight, actives: (root.DermaiEngine || {}).actives, decision: (root.DermaiEngine || {}).decisionData };
  const api = factory(dep);
  if (isNode) module.exports = api; else root.DermaiDeclared = api;
})(typeof self !== 'undefined' ? self : this, function (dep) {
  'use strict';

  /* Statuts d'objectif (synthesis.js) que cet encart traite : l'analyse ne retient pas cet axe comme priorité. */
  const HANDLED = ['accompanied', 'no_signal', 'descriptive', 'unavailable'];
  /* Objectifs pour lesquels un avis professionnel a du sens si cela dure (aucun diagnostic n'est posé ici). */
  const PERSISTENT = ['blemishes', 'tone', 'texture', 'redness_comfort'];

  const TEXT = {
    kicker: 'Ce que vous signalez',
    title: 'Ce que vous voyez compte, même si l\'analyse ne le retient pas',
    intro: 'Vous avez indiqué ce que vous souhaitez travailler. Voici ce que cette analyse en dit, et ce qu\'elle ne peut pas dire.',
    measured: label => 'Sur cette photo, l\'analyse ne retient pas « ' + label.toLowerCase() + ' » comme axe prioritaire.',
    described: label => 'L\'analyse décrit « ' + label.toLowerCase() + ' » sans en tirer de conseil automatique.',
    unavailable: label => 'L\'analyse n\'a renvoyé aucune mesure pour « ' + label.toLowerCase() + ' » sur cette photo. DERMAI n\'en tire aucune conclusion.',
    limits: 'Cela ne veut pas dire que ce que vous voyez sur votre peau n\'existe pas. L\'analyse repose sur une seule photo et peut passer à côté de boutons, de marques qui restent après un bouton, de taches ou de cicatrices.',
    provisional: ' Ses repères sont provisoires : ils n\'ont pas encore été calibrés avec des photos réelles de différents teints.',
    added: label => 'Votre routine garde cet objectif : un soin doux (' + label.toLowerCase() + ') y est ajouté.',
    baseOnly: 'Votre routine de base (nettoyage doux, hydratation, protection solaire) reste en place. Aucun soin ciblé n\'est ajouté pour cet objectif pour l\'instant.',
    persistent: 'Si cela dure depuis plusieurs semaines, ou si plusieurs produits n\'ont rien changé, parlez-en à un dermatologue ou à un pharmacien. DERMAI ne peut ni examiner votre peau ni poser de diagnostic.',
    noGoalTitle: 'Une préoccupation qui n\'apparaît pas ici ?',
    noGoal: 'L\'analyse ne retient aucune priorité sur cette photo. Si vous voyez ou ressentez quelque chose qu\'elle ne montre pas (boutons, taches, peau terne), indiquez-le dans vos objectifs : cela ne change pas la mesure, mais cela change ce que DERMAI vous propose. Et si cela dure ou si rien ne marche, un dermatologue peut examiner votre peau.',
    noGoalButton: 'Choisir mes objectifs'
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
  const isObj = v => v !== null && typeof v === 'object';

  /* Lecture seule du résultat du moteur : une entrée par objectif que l'analyse ne retient pas comme priorité. */
  function view(eng) {
    const out = { concerns: [], invite: false };
    if (!isObj(eng) || !isObj(eng.synthesis) || !isObj(eng.synthesis.goals)) return out;
    const goals = eng.synthesis.goals, inds = eng.synthesis.indicators || {};
    if (goals.mode === 'set' && Array.isArray(goals.items)) {
      for (const g of goals.items) {
        if (!isObj(g) || !HANDLED.includes(g.status) || typeof g.label !== 'string' || !g.label) continue;
        const added = (g.indicators || []).map(i => inds[i.id]).find(s => s && s.accompaniment && s.accompaniment.status === 'added');
        const active = added ? dep.actives.byId(added.accompaniment.activeId) : null;
        out.concerns.push({ id: g.id, label: g.label, status: g.status, added: !!active, activeLabel: active ? active.label : null, persistent: PERSISTENT.includes(g.id) });
      }
    } else if (goals.mode === 'none' && isObj(eng.priorities) && eng.priorities.mode === 'maintenance') {
      out.invite = true;
    }
    return out;
  }

  function concernHtml(c) {
    const lead = c.status === 'unavailable' ? TEXT.unavailable(c.label) : c.status === 'descriptive' ? TEXT.described(c.label) : TEXT.measured(c.label);
    const limits = c.status === 'unavailable' ? '' : TEXT.limits + (dep.decision && dep.decision.PROVISIONAL === true ? TEXT.provisional : '');
    const routine = c.added ? TEXT.added(c.activeLabel) : TEXT.baseOnly;
    return '<div class="c-insight__group"><h3 class="c-insight__label">' + esc(c.label) + '</h3>' +
      '<p class="c-insight__text">' + esc(lead) + (limits ? ' ' + esc(limits) : '') + '</p>' +
      '<p class="c-insight__text">' + esc(routine) + '</p>' +
      (c.persistent ? '<p class="c-insight__text">' + esc(TEXT.persistent) + '</p>' : '') + '</div>';
  }

  /* Encart HTML, ou '' quand il n'y a rien à dire. */
  function html(eng) {
    const v = view(eng);
    if (v.concerns.length) {
      return '<section class="c-insight c-declared" aria-labelledby="decl-title"><p class="kicker">' + TEXT.kicker + '</p><div class="hd"><h2 class="h3" id="decl-title">' + TEXT.title + '</h2></div>' +
        '<p class="muted">' + TEXT.intro + '</p>' + v.concerns.map(concernHtml).join('') + '</section>';
    }
    if (v.invite) {
      return '<section class="c-insight c-declared" aria-labelledby="decl-title"><p class="kicker">' + TEXT.kicker + '</p><div class="hd"><h2 class="h3" id="decl-title">' + TEXT.noGoalTitle + '</h2></div>' +
        '<p class="c-insight__text">' + esc(TEXT.noGoal) + '</p><button class="link" data-go="profile">' + TEXT.noGoalButton + '</button></section>';
    }
    return '';
  }

  /* Point d'entrée de l'écran Résultat : l'encart, puis la synthèse existante, inchangée. */
  const top = eng => html(eng) + dep.insight.found(eng.synthesis);

  return { view, html, top, TEXT, HANDLED, PERSISTENT };
});
