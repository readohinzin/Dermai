'use strict';
/* DermAI, outil INTERNE d'évaluation : interface. HORS PRODUCTION. Aucun appel hors de ce serveur local ; le texte venant des données est toujours inséré avec textContent. */
(function () {
  const E = window.DermaiEval, app = document.getElementById('app');
  const MONK = ['#f6ede4', '#f3e7db', '#f7ead0', '#eadaba', '#d7bd96', '#a07e56', '#825c43', '#604134', '#3a312a', '#292420'];
  const METRIC_FR = { acne: 'Acné', pores: 'Pores', oiliness: 'Niveau d\'huile', texture: 'Texture', hydration: 'Hydratation', redness: 'Rougeurs', pigmentation: 'Pigmentation', wrinkles: 'Rides', radiance: 'Radiance', darkCircle: 'Cernes' };
  const state = { data: null, tab: 'rate', rater: localStorage.getItem('dermai.eval.rater') || 'R1', shown: {}, i: 0 };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid == null ? '' : kid)));
    return el;
  }
  const pct = v => (v === null || v === undefined ? 'n/d' : Math.round(v * 100) + ' %');

  async function load() { const r = await fetch('/api/manifest'); state.data = await r.json(); draw(); }
  function mine(it) { return (it.raters && it.raters[state.rater]) || null; }

  function rateView() {
    const d = state.data, ok = d.items.filter(it => E.checkItem(it).ok);
    if (!ok.length) return h('div', { class: 'card' }, 'Aucune photo utilisable. Chaque photo exige un consentement (given, date, scope) et un teint Monk. Voir tools/eval/README.md.');
    state.i = Math.min(state.i, ok.length - 1);
    const it = ok[state.i], rated = !!mine(it), reveal = rated || state.shown[it.id];
    const levels = {}, only = {};
    const form = h('div', { class: 'card' },
      h('div', { class: 'grid' }, E.HUMAN_METRICS.map(m => h('label', {}, METRIC_FR[m] + ' ',
        h('select', { 'data-m': m, disabled: d.readOnly }, [h('option', { value: '' }, 'Non évalué'), ...E.LEVEL_LABELS.map((l, i) => h('option', { value: i, selected: mine(it) && mine(it).levels && mine(it).levels[m] === i }, i + ' ' + l))])))),
      h('p', { class: 'muted' }, 'Ce que vous voyez et que le moteur ne mesure pas :'),
      h('div', { class: 'grid' }, E.HUMAN_ONLY.map(k => h('label', {}, h('input', { type: 'checkbox', 'data-o': k, disabled: d.readOnly, checked: !!(mine(it) && mine(it).only && mine(it).only[k]) }), ' ' + E.HUMAN_ONLY_LABELS[k]))),
      h('p', {}, h('button', { class: 'primary', disabled: d.readOnly, onclick: async () => {
        form.querySelectorAll('select[data-m]').forEach(s => { if (s.value !== '') levels[s.dataset.m] = Number(s.value); });
        form.querySelectorAll('input[data-o]').forEach(c => { only[c.dataset.o] = c.checked; });
        const r = await fetch('/api/ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, rater: state.rater, levels, only }) });
        if (!r.ok) { alert((await r.json()).error); return; }
        state.shown[it.id] = true; await load();
      } }, 'Enregistrer mon évaluation'), d.readOnly ? ' Données fictives : lecture seule.' : ''));
    const engine = reveal ? h('div', { class: 'card' }, h('b', {}, 'Moteur (raw_score)'), h('table', {}, h('tr', {}, E.HUMAN_METRICS.map(m => h('th', {}, METRIC_FR[m]))), h('tr', {}, E.HUMAN_METRICS.map(m => h('td', {}, E.engineValue(it.engine, m) === null ? 'n/d' : String(E.engineValue(it.engine, m))))))) : h('p', { class: 'muted' }, 'Évaluation à l\'aveugle : le résultat du moteur s\'affiche après votre enregistrement.');
    return h('div', {},
      h('p', {}, 'Évaluatrice : ', h('input', { value: state.rater, size: 6, onchange: e => { state.rater = /^[A-Za-z0-9_-]{1,16}$/.test(e.target.value) ? e.target.value : 'R1'; localStorage.setItem('dermai.eval.rater', state.rater); draw(); } }),
        ' Photo ', String(state.i + 1), ' sur ', String(ok.length), ' ', h('button', { onclick: () => { state.i = (state.i + ok.length - 1) % ok.length; draw(); } }, 'Précédente'), ' ', h('button', { onclick: () => { state.i = (state.i + 1) % ok.length; draw(); } }, 'Suivante')),
      h('div', { class: 'card' }, h('span', { class: 'swatch', style: 'background:' + MONK[it.monk - 1] }), ' ' + it.id + ' · teint Monk ' + it.monk + ' · consentement du ' + it.consent.date + ' (' + it.consent.scope + ')', h('br'),
        h('img', { class: 'photo', src: '/photos/' + encodeURIComponent(it.photo), alt: 'Photo ' + it.id, onerror: e => { e.target.alt = 'Photo absente du dossier (données fictives ou fichier manquant)'; e.target.style.minHeight = '60px'; } })),
      form, engine);
  }

  function compareView() {
    const c = E.compare(state.data.items), ir = E.interRater(state.data.items);
    const out = [h('div', { class: 'card' }, h('b', {}, c.included + ' photo(s) comparée(s). '), c.excluded.length ? c.excluded.length + ' exclue(s) : ' + c.excluded.map(x => x.id + ' (' + x.reason + ')').join(' ; ') : 'Aucune exclue.',
      h('p', { class: 'muted' }, 'Repère du moteur comparé : raw_score inférieur à ' + c.engineFlagBelow + ' = « point à soutenir ». En dessous de ' + c.minN + ' photos par groupe, rien ne se conclut.'),
      ir ? h('p', {}, 'Accord exact entre évaluatrices : ' + pct(ir.exact) + ' (' + ir.total + ' mesures).') : '')];
    if (c.alerts.length) out.push(h('div', { class: 'card' }, h('b', { class: 'bad' }, 'Écarts à regarder (fausse rassurance)'), h('ul', {}, c.alerts.map(a => h('li', {}, a.text)))));
    for (const [key, g] of Object.entries(c.groups)) {
      out.push(h('div', { class: 'card' }, h('b', {}, g.label + ' : ' + g.n + ' photo(s)' + (g.reliable ? '' : ' (trop petit pour conclure)')),
        h('table', {}, h('tr', {}, ['Mesure', 'n', 'Signe vu par l\'humain', 'Fausse rassurance', 'Fausse alerte', 'Corrélation de rang', 'Seuil suggéré'].map(t => h('th', {}, t))),
          E.HUMAN_METRICS.map(m => { const s = g.metrics[m]; return h('tr', {}, h('td', {}, METRIC_FR[m]), h('td', {}, String(s.n)), h('td', {}, String(s.humanFlagged)),
            h('td', { class: s.reliable && s.falseReassurance >= E.ALERT_RATE ? 'bad' : '' }, pct(s.falseReassurance)), h('td', {}, pct(s.falseAlarm)), h('td', {}, s.spearman === null ? 'n/d' : String(s.spearman)),
            h('td', {}, s.suggested ? 'raw < ' + s.suggested.cutoff + ' (précision équilibrée ' + s.suggested.balanced + ')' : 'n/d')); })),
        h('p', { class: 'muted' }, 'Vu par les personnes et non mesuré par le moteur : ' + E.HUMAN_ONLY.map(k => E.HUMAN_ONLY_LABELS[k] + ' ' + c.humanOnly[key][k].present + '/' + c.humanOnly[key][k].n).join(', ') + '.')));
    }
    out.push(h('p', {}, h('button', { class: 'primary', onclick: () => { const b = new Blob([JSON.stringify(c, null, 1)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(b), download: 'comparaison.json' }); document.body.append(a); a.click(); a.remove(); } }, 'Télécharger la comparaison (JSON)'), ' Le seuil suggéré n\'est JAMAIS appliqué tout seul : une personne décide avant de modifier decision.js.'));
    return h('div', {}, out);
  }

  function draw() {
    const d = state.data;
    app.replaceChildren(
      d.fictive ? h('div', { class: 'card bad' }, (/^DONNÉES FICTIVES/.test(d.note) ? d.note : 'DONNÉES FICTIVES. ' + d.note)) : '',
      h('nav', {}, h('button', { 'aria-pressed': state.tab === 'rate', onclick: () => { state.tab = 'rate'; draw(); } }, 'Évaluer'), h('button', { 'aria-pressed': state.tab === 'compare', onclick: () => { state.tab = 'compare'; draw(); } }, 'Comparaison')),
      state.tab === 'rate' ? rateView() : compareView());
  }
  load().catch(e => app.replaceChildren(h('p', { class: 'bad' }, 'Impossible de lire les données locales : ' + e.message)));
})();
