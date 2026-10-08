/* DERMAI : petites vues de l'écran Résultat et de l'écran Routine (HTML). Aucune décision ici : tout vient du moteur
   (Engine.run → synthesis) ou des masques réels (carte du visage). Chargé avant app.js. */
(function (root) {
  'use strict';
  const G = typeof globalThis !== 'undefined' ? globalThis : root, SM = () => root.SkinModel || G.SkinModel, EN = () => root.DermaiEngine || G.DermaiEngine;
  const chip = (i, cls) => `<span class="c-badge ${cls}">${i.label} · ${i.score}</span>`;

  /* Carte du visage : photo analysée + masques RÉELS de Perfect Corp, UN indicateur à la fois. Aucune zone déduite d'un score, d'une
     priorité ou du type de peau ; aucune étiquette ni trait ajoutés sur la photo. Sous la carte : ce qui a été détecté (masque) et ce que
     DERMAI en décide (score, js/engine/synthesis.js) sont dits séparément : une détection n'est jamais une priorité en soi.
     s : analyse ; withMasks : indicateurs ayant au moins un masque reçu ; y : synthèse du moteur (statut de chaque indicateur). */
  function faceMap(s, withMasks, state, esc, y) {
    const M = SM(), st = (y && y.indicators) || {}, S = EN().copy.SYNTH;
    const main = M.METRIC_KEYS.filter(k => st[k] && (EN().decisionData.isComparable(k) || withMasks.includes(k)));
    const chips = main.length ? main : withMasks;
    const sel = chips.includes(state.faceKey) ? state.faceKey : (withMasks[0] || chips[0]);
    const has = withMasks.includes(sel), info = st[sel];
    return `<section class="c-facemap" aria-labelledby="fm-title"><p class="kicker">Localisation</p><div class="hd"><h2 class="h3" id="fm-title">Zones détectées sur votre photo</h2></div>
   <p class="muted c-facemap__intro">Choisissez un indicateur : seules les zones que l'analyse a renvoyées pour lui s'affichent sur votre photo.</p>
   <div class="chips c-facemap__chips" role="group" aria-label="Indicateur affiché">${chips.map(k => `<button class="c-chip" data-act="facemap" data-v="${k}" aria-pressed="${k === sel}">${M.METRIC_LABELS[k]}</button>`).join('')}</div>
   <figure class="c-facemap__fig"><div class="c-facemap__frame" data-facemap data-key="${has ? sel : ''}"><img src="${esc(s.photo)}" alt="Votre photo analysée"><canvas aria-hidden="true"></canvas></div>
    <figcaption class="c-facemap__status" data-fm-status role="status" aria-live="polite">${has ? '' : S.map.unavailable}</figcaption></figure>
   ${has ? `<button class="link c-facemap__toggle" data-act="facemap-hide" aria-pressed="${!!state.faceHide}">${state.faceHide ? 'Afficher les zones' : 'Voir la photo sans les zones'}</button>` : ''}
   <div class="c-facemap__read">${has ? `<p data-fm-detect>${S.map.detected(sel, M.METRIC_LABELS[sel])}</p>` : ''}${info ? `<p><b>${info.label} · ${info.score}/100 · ${info.level}.</b> ${info.text}</p>` : ''}
   <p class="c-disclaimer">${S.map.note}</p></div></section>`;
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
     ${part('shows')}${part('lowest', chips(T.lowest, 'c-badge--outline'))}${part('retained', chips(T.priority, 'c-badge--mid'))}${part('accompaniment', chips(T.accompaniment, 'c-badge--outline'))}${part('strategy')}
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
