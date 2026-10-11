/* DERMAI : écran « Programme de 30 jours » (suivi quotidien, tolérance, bilan hebdomadaire). Chargé avant app.js, après js/engine/program.js.
   Aucune décision cosmétique ici : le plan vient de la routine DÉJÀ calculée (Engine.run → routinePlan, synthesis), les règles de calendrier de
   js/engine/program.js. Ce module ne contacte jamais le réseau et n'appelle jamais le service d'analyse : il ne fait que lire un résultat existant,
   tenir un petit journal local et afficher.

   Données et vie privée : le suivi (cases cochées, tolérance notée par niveau, jamais de texte libre) est gardé dans ce navigateur seulement
   (localStorage, une clé par compte : `dermai.care.<identifiant du compte>`). Il n'est jamais envoyé, ni lu par un autre compte. Il est effacé par
   « Effacer mon suivi » et à la suppression du compte. Sans compte (démonstration) il ne vit qu'en mémoire.
   Si le navigateur refuse d'écrire, l'écran le dit : le suivi reste visible pour cette visite mais ne sera pas conservé. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiCare = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const prog = () => (typeof module === 'object' && module.exports ? require('./engine/program.js') : root.DermaiEngine.program);
  const KEY_PREFIX = 'dermai.care.';
  const NAME_OF_KIND = { cleanse: 'Nettoyage doux', treatment: 'Soin ciblé', moisturize: 'Hydratation', spf: 'Protection solaire' };
  const SLOT = { morning: ['Matin', 'sun'], evening: ['Soir', 'moon'] };
  const pad = n => String(n).padStart(2, '0');

  /* deps : storage() → localStorage ou null · userId() → identifiant du compte ou null · today() → AAAA-MM-JJ local · render() → réaffiche l'écran
     ic(nom) → icône · esc(texte) → texte échappé · fmtDate(iso) → date lisible */
  function create(deps) {
    const d = deps || {};
    const P = prog(), C = P.COPY;
    const esc = d.esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const ic = d.ic || (() => '');
    const today = () => { try { return d.today ? d.today() : P.localDate(); } catch (e) { return P.localDate(); } };
    const uid = () => { try { return (d.userId && d.userId()) || null; } catch (e) { return null; } };
    const store = () => { try { return d.storage ? d.storage() : null; } catch (e) { return null; } };
    const fmtDate = d.fmtDate || (iso => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } });
    const redraw = () => { try { if (d.render) d.render(); } catch (e) { /* sans importance */ } };

    let cache = { who: undefined, st: null }, last = null, lastUid = null;
    const ui = { day: null, pending: null, notice: '', confirm: null, warn: false, who: undefined };
    const who = () => { const u = uid(); if (u) lastUid = u; return u || 'mem'; };

    /* Relit le stockage à chaque affichage et à chaque action : un autre onglet du même compte a pu écrire entre-temps, on ne réécrit jamais un état périmé.
       Copie en mémoire seulement si le navigateur refuse d'écrire (alors elle fait foi pour cette visite) ou sans compte (démonstration). */
    function load() {
      const w = who();
      if (ui.who !== w) { ui.who = w; ui.day = null; ui.pending = null; ui.notice = ''; ui.confirm = null; ui.warn = false; cache = { who: w, st: null }; }
      if (w === 'mem' || (ui.warn && cache.who === w && cache.st)) return cache.st;
      let st = null;
      try { const s = store(), raw = s && s.getItem(KEY_PREFIX + w); st = raw ? P.cleanState(JSON.parse(raw)) : null; } catch (e) { st = null; }
      cache = { who: w, st };
      return st;
    }
    function save(st) {
      const w = who(); cache = { who: w, st };
      if (w === 'mem') return true;
      try {
        const s = store(); if (!s) throw new Error('indisponible');
        if (st) s.setItem(KEY_PREFIX + w, JSON.stringify(st)); else s.removeItem(KEY_PREFIX + w);
        ui.warn = false; return true;
      } catch (e) { ui.warn = true; return false; }
    }
    /* Efface le suivi du compte courant (ou du dernier compte connu : la suppression du compte a déjà fermé la session). */
    function clear() {
      const w = uid() || lastUid || 'mem';
      cache = { who: undefined, st: null };
      Object.assign(ui, { day: null, pending: null, notice: '', confirm: null, warn: false, who: undefined });
      if (w !== 'mem') { try { const s = store(); if (s) s.removeItem(KEY_PREFIX + w); } catch (e) { /* stockage indisponible : rien à effacer */ } }
    }

    /* ---------- Actions ---------- */
    function handle(name, data) {
      const st = load(), t = today(), v = data || {};
      ui.confirm = name === 'restart' || name === 'erase' ? name : null;
      switch (name) {
        case 'start': case 'restart-yes': {
          if (!last || !last.eng || (name === 'start' && st)) break;          // « Commencer » n'écrase jamais un programme déjà commencé (autre onglet)
          const plan = P.build(last.eng.routinePlan, { explain: last.eng.synthesis && last.eng.synthesis.steps, base: { id: last.scan && last.scan.rec ? last.scan.rec.id : null, at: last.scan ? last.scan.analyzedAt || (last.scan.rec && last.scan.rec.analyzedAt) : null } });
          const next = plan && P.newState(plan, t); if (next) { save(next); ui.day = null; ui.pending = null; ui.notice = ''; }
          break;
        }
        case 'erase-yes': save(null); ui.day = null; ui.pending = null; ui.notice = ''; break;
        case 'tick': {
          if (!st) break;
          const day = Number(v.d), on = !((st.checks[day] || []).includes(v.s));
          const next = P.tick(st, day, v.s, on, t); if (next) save(next);
          break;
        }
        case 'day': if (st) { const n = Number(v.d); if (n >= 1 && n <= Math.min(P.dayNumber(st.start, t), P.DAYS)) ui.day = n; ui.pending = null; } break;
        case 'tol': {
          if (!st) break;
          const day = viewDay(st);
          if ((v.l === 'moderate' || v.l === 'strong') && st.plan.steps.some(x => x.kind === 'treatment')) { ui.pending = { l: v.l, d: day }; break; }   // quel soin ? (seulement s'il y en a)
          const next = P.logTolerance(st, day, v.l, null, t); if (next) { save(next); ui.pending = null; ui.notice = C.reaction[v.l] || ''; }
          break;
        }
        case 'tolstep': {
          if (!st || !ui.pending) break;
          const next = P.logTolerance(st, ui.pending.d, ui.pending.l, v.s === 'none' ? null : v.s, t);
          if (next) { save(next); ui.notice = C.reaction[ui.pending.l]; }
          ui.pending = null; break;
        }
        case 'cancel': ui.pending = null; break;
        case 'restart': case 'erase': break;                       // demande de confirmation : l'écran l'affiche, rien n'est encore effacé
        case 'resume': { if (!st) break; const next = P.resume(st, t); if (next) { save(next); ui.notice = ''; } break; }
        default: return;
      }
      redraw();
    }
    function attach(doc) {
      if (!doc || !doc.addEventListener) return;
      doc.addEventListener('click', e => {
        const el = e.target && e.target.closest ? e.target.closest('[data-cp]') : null;
        if (el) handle(el.dataset.cp, el.dataset);
      });
    }

    /* ---------- Affichage ---------- */
    const viewDay = st => { const cur = Math.min(P.dayNumber(st.start, today()), P.DAYS) || 1; return ui.day && ui.day <= cur ? ui.day : cur; };
    const list = items => `<ul class="l-list" style="margin-top:0">${items.map(t => `<li>${ic('check')}<span>${esc(t)}</span></li>`).join('')}</ul>`;
    const safety = () => `<section class="sand" style="margin-top:24px"><h2 class="h3" style="margin-bottom:10px">${esc(C.safetyTitle)}</h2><ul class="l-list" style="margin-top:0">${C.safety.map(t => `<li>${ic('info')}<span>${esc(t)}</span></li>`).join('')}</ul></section>`;
    const budget = () => `<details class="c-why" style="margin-top:18px"><summary>${esc(C.budgetTitle)}</summary>${C.budget.map(t => `<p>${esc(t)}</p>`).join('')}</details>`;
    const notice = (html, cls) => `<div class="c-notice${cls ? ' ' + cls : ''} u-my-5" role="status">${ic('info')}<div>${html}</div></div>`;

    function intro(eng) {
      let preview = '';
      try {
        const plan = P.build(eng.routinePlan, { explain: eng.synthesis && eng.synthesis.steps });
        const treat = plan ? plan.steps.filter(s => s.kind === 'treatment' && s.slot).sort((a, b) => (a.cad ? 0 : 1) - (b.cad ? 0 : 1) || a.first - b.first) : [];
        const seen = new Set(), rows = treat.filter(s => !seen.has(s.id) && seen.add(s.id)).map(s => `<li>${ic('check')}<span>${s.cad ? `Jour ${s.first} : ${esc(s.label)} (${esc(P.CADENCE_LABEL[s.cad].toLowerCase())})` : `${esc(s.label)} : fréquence non reconnue, non planifié automatiquement`}</span></li>`);
        preview = `<section class="sand" style="margin-bottom:24px"><h2 class="h3" style="margin-bottom:10px">Ce que contiendra votre programme</h2><ul class="l-list" style="margin-top:0"><li>${ic('check')}<span>Jour 1 : nettoyage doux, hydratation${plan && plan.steps.some(s => s.kind === 'spf') ? ', protection solaire le matin' : ''}</span></li>${rows.join('')}</ul></section>`;
      } catch (e) { preview = ''; }
      return `<div class="pagehead"><p class="kicker">Programme de soins</p><h1>${esc(C.title)}</h1><p>${esc(C.intro)}</p></div>
      ${preview}<section style="margin-bottom:24px">${list(C.how)}</section>
      ${notice(esc(C.notPromise))}
      <button class="c-btn c-btn--primary c-btn--block" data-cp="start">Commencer aujourd'hui</button>${budget()}${safety()}`;
    }

    function stepRow(it, i, day, cur) {
      const s = it.step, kindName = NAME_OF_KIND[s.kind] || '';
      const budgetTip = C.budgetByKind[s.kind];
      if (it.state !== 'due') {
        const why = it.state === 'later' ? `À partir du jour ${it.from}.` : it.state === 'paused' ? `En pause après une gêne notée. Reprise possible au jour ${it.until}, seulement si la peau est apaisée.` : it.state === 'suspended' ? C.suspended
          : it.state === 'unscheduled' ? `${esc(C.unscheduled)}${s.freq ? ` Consigne de la fiche : ${esc(s.freq)}.` : ''}`
          : `Pas de ce soin aujourd'hui (${esc((P.CADENCE_LABEL[s.cad] || '').toLowerCase())}).`;
        return `<div class="c-routine-step" style="opacity:.7"><span class="c-routine-step__ord">${pad(i + 1)}</span><div class="c-routine-step__body"><div class="c-routine-step__meta">${kindName}</div><div class="c-routine-step__name">${esc(s.label)}</div><p class="c-routine-step__role muted">${why}</p></div></div>`;
      }
      const freq = s.kind === 'treatment' ? `<p class="c-routine-step__role muted">Fréquence du programme : ${esc(P.CADENCE_LABEL[s.cad].toLowerCase())}. ${esc(s.note)}</p>` : '';
      const cautions = s.cautions.length ? `<details class="c-why"><summary>Précautions</summary>${s.cautions.map(c => `<p>${esc(c)}</p>`).join('')}</details>` : '';
      return `<div class="c-routine-step"><span class="c-routine-step__ord">${pad(i + 1)}</span><div class="c-routine-step__body"><div class="c-routine-step__meta">${kindName}</div><div class="c-routine-step__name">${esc(s.label)}</div>
        ${s.role ? `<p class="c-routine-step__role">${esc(s.role)}</p>` : ''}${freq}${cautions}<details class="c-why"><summary>Version économique</summary><p>${esc(budgetTip)}</p></details></div>
        <button class="c-check" data-cp="tick" data-d="${day}" data-s="${esc(s.id)}" aria-pressed="${!!it.checked}" aria-label="Marquer ${esc(s.label)} comme fait">${ic('check')}</button></div>`;
    }

    function toleranceBlock(st, day) {
      const logsToday = st.logs.filter(l => l.d === day && l.l !== 'resume');
      const noted = logsToday.length ? `<p class="muted" style="margin-bottom:10px">Noté ce jour-là : ${logsToday.map(l => esc(C.levelLabel[l.l].toLowerCase())).join(', ')}.</p>` : '';
      if (ui.pending && ui.pending.d === day) {
        const treat = st.plan.steps.filter(s => s.kind === 'treatment');
        return `<section class="c-card" style="margin-top:20px"><h2 class="h3">${esc(C.askStep)}</h2><p class="muted" style="margin-bottom:10px">${esc(C.levelLabel[ui.pending.l])}.</p>
          <div class="stack" style="gap:8px">${treat.map(s => `<button class="c-btn c-btn--secondary c-btn--block" data-cp="tolstep" data-s="${esc(s.id)}">${esc(s.label)}</button>`).join('')}<button class="c-btn c-btn--secondary c-btn--block" data-cp="tolstep" data-s="none">${esc(C.stepUnknown)}</button><button class="link" data-cp="cancel">Annuler</button></div></section>`;
      }
      return `<section class="c-card" style="margin-top:20px"><h2 class="h3">Comment votre peau a-t-elle réagi ?</h2><p class="muted s" style="margin-bottom:10px">${esc(C.tolNote)}</p>${noted}
        <div class="stack" style="gap:8px">${P.LEVELS.map(l => `<button class="c-btn c-btn--secondary c-btn--block" data-cp="tol" data-l="${l}"><b>${esc(C.levelLabel[l])}</b><span class="muted s" style="display:block">${esc(C.levelHint[l])}</span></button>`).join('')}</div></section>`;
    }

    function reviewBlock(st) {
      const weeks = P.review(st, today()).slice().reverse();
      if (!weeks.length) return '';
      return `<section style="margin-top:24px"><div class="hd"><h2 class="h3">Bilans</h2></div>${weeks.map((w, i) => {
        const bar = w.adherence === null ? '' : `<span class="c-bar" role="img" aria-label="${w.done} sur ${w.expected}" style="--value:${Math.round(w.adherence * 100)}"><span class="c-bar__fill"></span></span>`;
        const t = w.tolerance, tol = P.LEVELS.filter(l => t[l]).map(l => `${esc(C.levelLabel[l].toLowerCase())} : ${t[l]}`).join(' · ');
        return `<details class="c-why"${i === 0 ? ' open' : ''}><summary>${esc(w.title)}${w.complete ? '' : ' (en cours)'}</summary>
          ${w.regularity === 'wait' ? '' : `<p>Actions faites : ${w.done} sur ${w.expected} prévues sur les jours terminés.</p>`}${bar}${tol ? `<p>Tolérance notée : ${tol}.</p>` : ''}
          ${w.messages.map(m => `<p>${esc(m)}</p>`).join('')}${w.intro.map(m => `<p>${esc(m)}</p>`).join('')}${w.hints.length ? `<p>${esc(C.progressHint)}</p>${w.hints.map(h => `<p>${esc(h)}</p>`).join('')}` : ''}
          ${w.final && w.complete ? `<p class="muted">${esc(C.final)}</p>` : ''}</details>`;
      }).join('')}</section>`;
    }

    function active(st, eng, scan) {
      const t = today(), raw = P.dayNumber(st.start, t), cur = Math.min(raw, P.DAYS) || 1, day = viewDay(st);
      const view = P.dayView(st, day), over = raw > P.DAYS;
      const slots = ['morning', 'evening'].filter(s => view.slots[s].length).map(s => `<section style="margin-bottom:20px"><div class="hd"><h2 class="h3" style="display:flex;gap:10px;align-items:center">${ic(SLOT[s][1])}${SLOT[s][0]}</h2></div><div class="stack" style="gap:12px">${view.slots[s].map((it, i) => stepRow(it, i, day, cur)).join('')}</div></section>`).join('');
      const nav = `<div class="chips" style="margin:10px 0 16px" role="group" aria-label="Jour affiché">${Array.from({ length: cur }, (_, k) => k + 1).slice(-7).map(n => `<button class="c-chip" data-cp="day" data-d="${n}" aria-pressed="${n === day}">Jour ${n}</button>`).join('')}</div>`;
      const base = st.plan.base.at ? `Programme construit à partir de votre analyse du ${esc(fmtDate(st.plan.base.at))}. ` : '';
      const newer = scan && scan.rec && st.plan.base.id && scan.rec.id !== st.plan.base.id ? notice(`Une analyse plus récente existe. Votre programme reste celui du départ ; vous pouvez le recommencer à partir de la dernière analyse (le suivi actuel sera effacé).`) : '';
      const confirmBox = ui.confirm ? `<div class="c-notice c-notice--error u-my-5" role="alert">${ic('info')}<div>${ui.confirm === 'restart' ? 'Recommencer efface le suivi actuel (cases cochées et tolérance notée).' : 'Effacer supprime de cet appareil tout votre suivi (cases cochées et tolérance notée).'}
        <div class="stack" style="gap:8px;margin-top:10px"><button class="c-btn c-btn--primary c-btn--block" data-cp="${ui.confirm}-yes">Confirmer</button><button class="link" data-cp="cancel">Annuler</button></div></div></div>` : '';
      return `<div class="pagehead"><p class="kicker">Programme de soins</p><h1>${over ? 'Programme terminé' : `Jour ${cur} sur ${P.DAYS}`}</h1><p>${base}${esc(C.notPromise)}</p>
        <span class="c-bar" role="img" aria-label="Jour ${cur} sur ${P.DAYS}" style="--value:${Math.round(100 * cur / P.DAYS)}"><span class="c-bar__fill"></span></span></div>
        ${raw < 1 ? notice('La date de cet appareil est antérieure au départ du programme : le jour 1 est affiché.') : ''}
        ${P.unscheduled(st.plan).length ? notice(esc(C.unscheduledNote([...new Set(P.unscheduled(st.plan).map(x => x.label))].join(', ')))) : ''}
        ${ui.warn ? notice(`Ce navigateur refuse de garder votre suivi : il reste visible pendant cette visite mais ne sera pas conservé.`, 'c-notice--error') : ''}
        ${over ? notice(esc(C.finished)) : ''}${newer}
        ${ui.notice && !(view.suspended && ui.notice === C.reaction.strong) ? notice(esc(ui.notice)) : ''}
        ${view.suspended ? `<div class="c-notice c-notice--error u-my-5" role="alert">${ic('info')}<div>${esc(C.reaction.strong)}<p style="margin-top:8px">${esc(C.resumeNote)}</p><button class="c-btn c-btn--secondary c-btn--block" style="margin-top:10px" data-cp="resume">${esc(C.resumeBtn)}</button></div></div>` : ''}
        ${nav}<p class="muted" style="margin-bottom:12px">${day === cur && !over ? 'Aujourd\'hui' : `Jour ${day}`} : ${view.done} sur ${view.expected} actions prévues faites.</p>
        ${slots}${toleranceBlock(st, day)}${reviewBlock(st)}${budget()}${safety()}
        <div class="stack" style="margin-top:24px;gap:8px"><button class="link" data-cp="restart">Recommencer le programme</button><button class="link" data-cp="erase">Effacer mon suivi</button></div>${confirmBox}
        <p class="c-disclaimer">Conseils cosmétiques d'information, ce n'est pas un diagnostic médical. En cas de doute ou de réaction importante, demandez l'avis d'un professionnel de santé.</p>`;
    }

    /* Page complète (contenu de l'écran). eng : résultat du moteur pour l'analyse la plus récente ; scan : cette analyse. */
    function page(eng, scan) {
      last = { eng, scan };
      const st = load();
      return st ? active(st, eng, scan) : intro(eng);
    }
    /* Ligne d'entrée affichée sur l'écran Routine. */
    function entry() {
      const st = load(), cur = st ? Math.min(P.dayNumber(st.start, today()), P.DAYS) : 0;
      const sub = st ? (P.dayNumber(st.start, today()) > P.DAYS ? 'Programme terminé : consulter le bilan' : `Jour ${cur || 1} sur ${P.DAYS}`) : 'Un suivi jour après jour, sans nouvelle analyse';
      return `<button class="rowlink" data-go="program"><div class="grow"><b>Programme de 30 jours</b><span class="s">${sub}</span></div>${ic('chev')}</button>`;
    }

    return { page, entry, clear, handle, attach, state: () => load() };
  }

  return { create, KEY_PREFIX };
});
