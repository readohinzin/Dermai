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

  /* « Limites et précautions » de l'analyse : ce qu'elle ne peut pas dire, quand demander un avis professionnel. Seule donnée lue : les indicateurs
     que l'analyse n'a pas renvoyés (rien n'est inféré à leur place). */
  const LIMITS = {
    title: 'À savoir sur cette analyse',
    base: [
      'Cette analyse repose sur une seule photo : la lumière, l\'angle, le maquillage et la qualité de l\'image peuvent modifier les résultats.',
      'Elle décrit l\'état apparent de la peau, à titre cosmétique. Un score plus bas est un repère de soin cosmétique : il ne permet pas de conclure à un problème de santé, et ce n\'est pas un diagnostic médical.',
      'Les axes sont classés d\'après les données de cette analyse et vos objectifs. Ils peuvent changer à la prochaine analyse.',
      'Aucun résultat n\'est garanti : l\'évolution de la peau dépend de la régularité, de la tolérance et de nombreux autres facteurs.',
      'Boutons douloureux ou qui s\'étendent, plaie qui ne cicatrise pas, grain de beauté qui change d\'aspect, gonflement ou réaction après un produit : demandez l\'avis d\'un professionnel de santé. En cas de gonflement du visage ou de difficulté à respirer, consultez en urgence.'
    ],
    missing: list => 'Non évalués dans cette analyse : ' + list + '. DERMAI n\'en tire aucune conclusion.'
  };
  function limits(eng) {
    const M = SM(), ind = (eng && eng.interpretation && eng.interpretation.indicators) || [];
    const missing = ind.filter(i => !i.available).map(i => M.METRIC_LABELS[i.id] || i.label).filter(Boolean);
    const items = LIMITS.base.slice(); if (missing.length) items.splice(2, 0, LIMITS.missing(missing.join(', ')));
    return `<section class="c-insight" aria-labelledby="lim-title"><p class="kicker">Limites et précautions</p><div class="hd"><h2 class="h3" id="lim-title">${LIMITS.title}</h2></div>
     <ul class="l-list" style="margin-top:0">${items.map(t => `<li><span>${t}</span></li>`).join('')}</ul></section>`;
  }

  root.DermaiInsight = { faceMap, found, why, limits, LIMITS };
})(typeof self !== 'undefined' ? self : this);
