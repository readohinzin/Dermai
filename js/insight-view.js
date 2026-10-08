/* DERMAI : petites vues de l'écran Résultat et de l'écran Routine (HTML). Aucune décision ici : tout vient du moteur
   (Engine.run → synthesis) ou des masques réels (carte du visage). Chargé avant app.js. */
(function (root) {
  'use strict';
  const SM = () => root.SkinModel, EN = () => root.DermaiEngine;
  const chip = (i, cls) => `<span class="c-badge ${cls}">${i.label} · ${i.score}</span>`;

  /* Carte du visage : photo analysée + masques RÉELS de Perfect Corp. Aucune zone déduite d'un score, d'une priorité ou du type de peau. */
  function faceMap(s,keys,state,esc){
    const sel=keys.includes(state.faceKey)?state.faceKey:`all`,lab=k=>SM().METRIC_LABELS[k];
    return `<section class="c-facemap" aria-labelledby="fm-title"><p class="kicker">Localisation</p><div class="hd"><h2 class="h3" id="fm-title">Zones détectées sur votre photo</h2></div>
   <p class="muted c-facemap__intro">Chaque zone entourée provient directement du service d'analyse, avec le score de l'indicateur.</p>
   <div class="chips c-facemap__chips">${[`all`,...keys].map(k=>`<button class="c-chip" data-act="facemap" data-v="${k}" aria-pressed="${k===sel}">${k===`all`?`Toutes les zones`:lab(k)}</button>`).join(``)}</div>
   <figure class="c-facemap__fig"><div class="c-facemap__frame" data-facemap data-key="${sel}"><img src="${esc(s.photo)}" alt="Votre photo analysée"><canvas aria-hidden="true"></canvas><svg class="c-facemap__lines" aria-hidden="true"></svg><div class="c-facemap__tags"></div></div>
    <figcaption class="c-facemap__status" data-fm-status role="status" aria-live="polite"></figcaption></figure>
   <button class="link c-facemap__toggle" data-act="facemap-hide" aria-pressed="${!!state.faceHide}">${state.faceHide?`Afficher les zones`:`Voir la photo sans les zones`}</button></section>`;
  }

  /* Synthèse en quatre parties distinctes (js/engine/synthesis.js) : ce que l'analyse montre, vos résultats les moins élevés (comparaison
     relative, jamais un problème), ce que DERMAI retient (seulement une règle DERMAI), votre stratégie. Seuls les scores affichés
     apparaissent ; la note finale explique que les décisions utilisent séparément les données brutes. */
  function found(y) {
    if (!y || !y.sections) return '';
    const T = y.tiers, X = y.sections, L = y.titles;
    const chips = (list, cls) => list.length ? `<div class="chips">${list.map(i => chip(i, cls)).join('')}</div>` : '';
    const part = (k, extra) => X[k] ? `<div class="c-insight__group"><h3 class="c-insight__label">${L[k]}</h3><p class="c-insight__text">${X[k]}</p>${extra || ''}</div>` : '';
    return `<section class="c-insight" aria-labelledby="ins-title"><p class="kicker">Synthèse</p><div class="hd"><h2 class="h3" id="ins-title">Ce que votre analyse a trouvé</h2></div>
     ${part('shows')}${part('lowest', chips(T.lowest, 'c-badge--outline'))}${part('retained', chips(T.priority, 'c-badge--mid'))}${part('strategy')}
     <p class="c-disclaimer c-insight__note">${y.scoreNote}</p></section>`;
  }

  /* « Pourquoi cette routine ? » : stratégie, objectifs, niveau, contexte de peau. */
  function why(eng) {
    const y = eng.synthesis, pz = eng.personalization;
    const r = code => ((pz.rationale || []).find(x => x.code === code) || {}).text;
    return [y.strategy.text, ...(y.goals.mode === 'none' ? [y.goals.text] : y.goals.items.map(g => g.text)), r('level'), r('comfort'), y.strategy.skinContext].filter(Boolean);
  }

  root.DermaiInsight = { faceMap, found, why };
})(typeof self !== 'undefined' ? self : this);
