/* Couche PROGRAMME DE 30 JOURS : transforme la routine DÉJÀ calculée (routine.js) en un calendrier d'actions quotidiennes, suit ce que l'utilisatrice
   coche et la tolérance qu'elle note, et en tire un bilan hebdomadaire. Fonctions pures : aucun réseau, aucun stockage, aucune horloge (la date
   du jour est toujours passée en paramètre), aucun appel au fournisseur d'analyse. Rien n'est recalculé à partir de la peau : les étapes, leurs
   rôles, leurs précautions et leur fréquence de départ viennent de la routine et des fiches d'actifs existantes.

   Règles (éditoriales, prudentes, sans score) :
   - Les étapes de base (nettoyage, hydratation, protection solaire) commencent le jour 1 et restent quotidiennes.
   - Les soins ciblés sont introduits UN À LA FOIS, à une semaine d'intervalle, dans l'ordre d'introduction de la routine.
   - Leur fréquence de départ est celle de la fiche de l'actif (« un soir sur deux », « un soir par semaine »…). Elle n'augmente jamais toute seule :
     le bilan hebdomadaire rappelle la consigne de la fiche, l'utilisatrice décide.
   - Une fréquence absente ou non reconnue n'est JAMAIS remplacée par une valeur par défaut : le soin concerné n'est pas planifié automatiquement
     (état « unscheduled »), la fiche de l'actif fait foi et l'écran le dit.
   - Gêne modérée : le soin concerné (ou tous les soins ciblés si la cause est inconnue) est mis en pause 3 jours, puis repart à sa fréquence de départ.
   - Réaction importante : tous les soins ciblés sont suspendus jusqu'à ce que l'utilisatrice choisisse de les reprendre, puis réintroduits un par un.
   Le programme ne promet aucun résultat et ne remplace pas l'avis d'un professionnel de santé. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { const NS = (root.DermaiEngine = root.DermaiEngine || {}); NS.program = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAYS = 30, PAUSE_DAYS = 3, GAP_DAYS = 7, MAX_LOGS = 120;
  const LEVELS = ['none', 'mild', 'moderate', 'strong'];
  const SLOTS = ['morning', 'evening'], KINDS = ['cleanse', 'treatment', 'moisturize', 'spf'], ORIGINS = ['base', 'priority', 'accompaniment'];
  const WEEKS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
  /* Texte de fréquence des fiches d'actifs (data/actives.js) → cadence. Correspondance EXACTE et explicite : tout autre texte (inconnu, vide, absent)
     n'a pas de cadence, donc le soin n'est pas planifié automatiquement. Un test impose qu'un actif utilisable par la routine ait une fréquence ici. */
  const CADENCE = {
    'Une fois par jour': 'daily', 'Chaque jour': 'daily', 'Deux soirs par semaine': 'w2',
    'Un soir sur deux au début': 'alt', 'Un matin sur deux au début': 'alt', 'Un soir par semaine au début': 'w1'
  };
  const CADENCES = ['daily', 'alt', 'w2', 'w1'];
  const CADENCE_LABEL = { daily: 'Chaque jour', alt: 'Un jour sur deux', w2: 'Deux fois par semaine', w1: 'Une fois par semaine' };

  /* Textes. Mêmes garde-fous de vocabulaire que le reste de l'interface (test/care-program.test.js) : ni diagnostic, ni promesse, ni produit imposé. */
  const COPY = {
    title: 'Mon programme de 30 jours',
    intro: 'Un calendrier simple, construit à partir de la routine de votre dernière analyse. DERMAI réutilise les résultats déjà obtenus : aucune nouvelle analyse n\'est lancée, jamais automatiquement.',
    how: [
      'Les étapes de base (nettoyage doux, hydratation, protection solaire le matin) commencent dès le premier jour.',
      'Les soins ciblés arrivent un par un, à une semaine d\'intervalle, avec la fréquence de départ indiquée sur la fiche de l\'actif.',
      'Vous cochez ce que vous faites et vous notez comment votre peau réagit : le programme ralentit ou fait une pause si besoin.',
      'Un bilan hebdomadaire résume votre régularité et votre tolérance. Il ne mesure pas l\'évolution de votre peau.'
    ],
    notPromise: 'Ce programme ne promet aucun résultat : l\'évolution de la peau dépend de nombreux facteurs. Il ne remplace pas l\'avis d\'un professionnel de santé.',
    budgetTitle: 'Rester raisonnable côté budget',
    budget: [
      'Commencez par les étapes de base : un nettoyant doux, un hydratant simple et une protection solaire. Le soin ciblé est un plus, pas un préalable.',
      'N\'achetez le soin ciblé suivant qu\'après une semaine de bonne tolérance du précédent : cela évite des dépenses inutiles.',
      'Regardez l\'actif et sa concentration sur l\'étiquette plutôt que la marque. Si votre peau est sensible, privilégiez une formule courte et sans parfum.',
      'DERMAI n\'impose aucun produit. Les prix et la disponibilité varient selon les points de vente au Bénin : un prix n\'est affiché dans « Produits » que s\'il est vérifié. Un pharmacien peut aussi vous orienter vers des produits simples.'
    ],
    budgetByKind: {
      cleanse: 'Option économique : un nettoyant doux et simple, sans parfum, suffit. Évitez les produits très décapants.',
      moisturize: 'Option économique : un hydratant simple à formule courte peut suffire. Choisissez une texture que vous tolérez et que vous utiliserez chaque jour.',
      spf: 'Option économique : une protection solaire simple appliquée régulièrement est préférable à un produit coûteux utilisé rarement. Vérifiez l\'indice indiqué sur l\'étiquette ou demandez conseil à un pharmacien.',
      treatment: 'Option économique : n\'achetez ce soin ciblé qu\'après avoir installé les étapes de base, et cherchez l\'actif sur l\'étiquette plutôt qu\'une marque précise.'
    },
    safetyTitle: 'Quand demander un avis professionnel',
    safety: [
      'Rougeurs ou brûlures qui persistent, desquamation importante, boutons qui s\'étendent ou douloureux : arrêtez le soin concerné, rincez à l\'eau tiède et demandez conseil à un pharmacien, un médecin ou un dermatologue.',
      'Gonflement du visage, des lèvres ou des paupières, difficulté à respirer, douleur vive, yeux douloureux ou vision gênée : arrêtez tout produit et consultez en urgence.',
      'Une plaie qui ne cicatrise pas, un grain de beauté qui change d\'aspect ou de taille, ou une question sur votre santé : parlez-en à un professionnel de santé. DERMAI n\'est pas un outil de diagnostic.',
      'Grossesse, allaitement, peau très réactive ou prise de médicaments : demandez l\'avis d\'un professionnel avant d\'ajouter un actif.'
    ],
    levelLabel: { none: 'Aucune gêne', mild: 'Gêne légère et brève', moderate: 'Gêne modérée ou persistante', strong: 'Réaction importante' },
    levelHint: {
      none: 'Picotements, rougeurs ou tiraillements : aucun.',
      mild: 'Légers picotements ou tiraillements qui passent vite.',
      moderate: 'Rougeurs, brûlures ou desquamation qui durent.',
      strong: 'Brûlure vive, gonflement, cloques ou douleur.'
    },
    reaction: {
      none: 'Noté. Continuez ainsi, sans ajouter de nouveau produit avant la date prévue.',
      mild: 'Noté. Gardez la même fréquence, hydratez bien et n\'ajoutez rien de nouveau cette semaine.',
      moderate: 'Noté. Le soin concerné est mis en pause 3 jours. Ne le reprenez que si votre peau est apaisée, à sa fréquence de départ. Si la gêne persiste ou revient, ne le reprenez pas et demandez conseil à un professionnel. Si un autre produit pique aussi, arrêtez-le.',
      strong: 'Noté. Arrêtez tous les soins ciblés et tout produit qui pique ou brûle, et rincez à l\'eau tiède. Le programme suspend les soins ciblés : demandez conseil à un professionnel de santé avant de les reprendre. En cas de gonflement, de difficulté à respirer ou de douleur vive, consultez en urgence.'
    },
    askStep: 'Quel soin pensez-vous concerné ?',
    stepUnknown: 'Je ne sais pas',
    resumeBtn: 'Reprendre mes soins ciblés',
    resumeNote: 'À faire seulement quand la peau est apaisée et après l\'avis d\'un professionnel de santé. Les soins reviennent un par un, à une semaine d\'intervalle.',
    suspended: 'Suspendu : réaction importante notée.',
    finished: 'Programme terminé. Le bilan ci-dessous résume votre régularité et votre tolérance. Vous pouvez le recommencer ou faire une nouvelle analyse quand vous le souhaitez (facultatif : DERMAI n\'en lance jamais automatiquement).',
    weekTitle: n => n === 5 ? 'Bilan des jours 29 et 30' : 'Bilan de la semaine ' + n,
    regularity: { wait: 'Pas encore assez de jours écoulés pour juger la régularité.', none: 'Aucune action prévue sur cette période.', good: 'Régularité satisfaisante.', mid: 'Régularité partielle : ce n\'est pas grave, vous pouvez simplifier.', low: 'Régularité faible : vous pouvez simplifier en gardant seulement les étapes de base.' },
    noTolerance: 'Aucune tolérance notée : indiquez chaque jour comment votre peau réagit pour adapter le programme.',
    tolerant: 'Bonne tolérance notée. Continuez à la même fréquence.',
    mildOnly: 'Quelques gênes légères notées : gardez la même fréquence et n\'ajoutez rien de nouveau.',
    moderateWeek: 'Gêne modérée notée cette semaine : le soin concerné a été mis en pause. Ne le reprenez que si la peau est apaisée ; si la gêne revient, demandez conseil à un professionnel.',
    strongWeek: 'Réaction importante notée cette semaine : les soins ciblés sont suspendus. Demandez conseil à un professionnel de santé avant de les reprendre.',
    repeated: 'Plusieurs gênes modérées ont été notées : un avis professionnel est conseillé avant de continuer.',
    progressHint: 'Si la tolérance reste bonne, vous pouvez, sans précipitation et un seul changement à la fois, suivre la consigne de la fiche :',
    unscheduled: 'Fréquence non reconnue : ce soin n\'est pas planifié automatiquement. Suivez la consigne de sa fiche d\'actif ou demandez conseil à un pharmacien.',
    unscheduledNote: labels => 'Fréquence non reconnue pour : ' + labels + '. Ces soins ne sont pas planifiés automatiquement : suivez la consigne de leur fiche d\'actif ou demandez conseil à un pharmacien.',
    tolNote: 'Ces notes sont les vôtres : DERMAI ne les interprète pas comme un avis médical.',
    newStep: (label, day) => label + ' est introduit à partir du jour ' + day + '.',
    final: 'Ce bilan décrit votre régularité et votre tolérance, pas l\'évolution de votre peau. Pour comparer, une nouvelle analyse est possible, mais facultative.'
  };

  const isDay = d => Number.isInteger(d) && d >= 1 && d <= DAYS;
  const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '');
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  /* Date locale AAAA-MM-JJ valide (le jour du calendrier, pas un instant) ou null. */
  function parseDate(s) {
    const m = DATE_RE.exec(String(s || '')); if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]), d = new Date(t);
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
  }
  const localDate = (d = new Date()) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  /* Numéro du jour (1 = jour de départ). 0 : le départ est dans le futur (horloge reculée) ou une date est invalide. Indépendant du fuseau et de l'heure d'été. */
  function dayNumber(start, today) {
    const a = parseDate(start), b = parseDate(today);
    if (a === null || b === null || b < a) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }
  const addDays = (start, n) => { const t = parseDate(start); if (t === null) return null; const d = new Date(t + n * 86400000); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); };

  /* null si la fréquence est absente ou non reconnue (aucune valeur par défaut). Peau sensible : « chaque jour » commence un jour sur deux, comme la fiche le suggère. */
  function cadenceOf(frequency, slowDown) {
    const key = typeof frequency === 'string' ? frequency.trim() : '';
    const c = Object.prototype.hasOwnProperty.call(CADENCE, key) ? CADENCE[key] : null;
    return c === 'daily' && slowDown ? 'alt' : c;
  }
  const onCadence = (cad, k) => k >= 0 && (cad === 'daily' || (cad === 'alt' && k % 2 === 0) || (cad === 'w2' && (k % 7 === 0 || k % 7 === 3)) || (cad === 'w1' && k % 7 === 0));

  /* ---------- Plan : figé au départ, tiré de la routine ---------- */
  function cleanStep(s) {
    if (!s || typeof s !== 'object' || !SLOTS.includes(s.slot) || !KINDS.includes(s.kind) || !ORIGINS.includes(s.origin)) return null;
    const id = text(s.id, 60); if (!/^(morning|evening):[a-z_]+(:[a-z0-9_]+)?$/.test(id) || !id.startsWith(s.slot + ':')) return null;
    const label = text(s.label, 60); if (!label) return null;
    const treat = s.kind === 'treatment';
    return {
      id, slot: s.slot, kind: s.kind, origin: s.origin, activeId: treat ? text(s.activeId, 40) || null : null, label, role: text(s.role, 400),
      cad: treat ? (CADENCES.includes(s.cad) ? s.cad : null) : 'daily', first: isDay(s.first) ? s.first : 1, order: treat && Number.isInteger(s.order) && s.order >= 1 && s.order <= 9 ? s.order : 0,
      freq: text(s.freq, 80), note: text(s.note, 160), cautions: (Array.isArray(s.cautions) ? s.cautions : []).map(c => text(c, 200)).filter(Boolean).slice(0, 4)
    };
  }
  function cleanPlan(p) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.steps)) return null;
    const steps = p.steps.slice(0, 12).map(cleanStep), seen = new Set();
    if (!steps.length || steps.some(s => !s || seen.size === seen.add(s.id).size)) return null;      // une étape invalide ou en double : tout le plan est refusé, rien n'est corrigé en silence
    if (!steps.some(s => s.slot === 'morning') && !steps.some(s => s.slot === 'evening')) return null;
    const bd = p.base && typeof p.base === 'object' ? p.base : {};
    return { steps, notes: (Array.isArray(p.notes) ? p.notes : []).map(n => text(n, 240)).filter(Boolean).slice(0, 6), summary: text(p.summary, 400),
      base: { id: /^[0-9a-f-]{36}$/i.test(String(bd.id || '')) ? bd.id : null, at: Number.isNaN(Date.parse(bd.at)) ? null : new Date(bd.at).toISOString() } };
  }

  /* routinePlan : sortie de routine.js (engine.routinePlan) ; explain : synthesis.steps (rôle de chaque étape) ; base : { id, at } de l'analyse d'origine. */
  function build(routinePlan, opts) {
    const o = opts || {}, explain = o.explain || {}, slots = (routinePlan && routinePlan.slots) || {};
    const steps = [];
    for (const slot of SLOTS) for (const s of slots[slot] || []) {
      const treat = s.kind === 'treatment', order = treat ? (s.introduction && s.introduction.order) || 1 : 0;
      steps.push({
        id: s.id, slot, kind: s.kind, origin: s.origin || 'base', activeId: treat ? s.activeId : null, label: treat ? s.activeLabel : ({ cleanse: 'Nettoyant doux', moisturize: 'Hydratant', spf: 'Protection solaire' })[s.kind],
        role: explain[s.id] || s.reason || '', cad: treat ? cadenceOf(s.introduction && s.introduction.frequency, s.slowDown) : 'daily',
        first: treat ? Math.min(1 + GAP_DAYS * (Math.max(order, 1) - 1), DAYS) : 1, order, freq: treat ? (s.introduction && s.introduction.frequency) || '' : '',
        note: treat ? (s.introduction && s.introduction.note) || '' : '', cautions: treat ? s.cautions || [] : []
      });
    }
    return cleanPlan({ steps, notes: (routinePlan && routinePlan.notes) || [], summary: (routinePlan && routinePlan.summary) || '', base: o.base });
  }

  /* ---------- État : plan + date de départ + cases cochées + journal de tolérance ---------- */
  function cleanState(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
    const plan = cleanPlan(raw.plan), start = parseDate(raw.start) === null ? null : raw.start;
    if (!plan || !start) return null;
    const ids = new Set(plan.steps.map(s => s.id)), treat = new Set(plan.steps.filter(s => s.kind === 'treatment').map(s => s.id));
    const checks = {};
    if (raw.checks && typeof raw.checks === 'object' && !Array.isArray(raw.checks)) {
      for (const k of Object.keys(raw.checks).slice(0, DAYS)) {
        const d = Number(k); if (!isDay(d) || !Array.isArray(raw.checks[k])) continue;
        const list = [...new Set(raw.checks[k].filter(x => typeof x === 'string' && ids.has(x)))]; if (list.length) checks[d] = list;
      }
    }
    const logs = (Array.isArray(raw.logs) ? raw.logs : []).slice(0, MAX_LOGS).map(l => {
      if (!l || typeof l !== 'object' || !isDay(l.d)) return null;
      if (l.l === 'resume') return { d: l.d, l: 'resume', s: null };
      if (!LEVELS.includes(l.l)) return null;
      return { d: l.d, l: l.l, s: typeof l.s === 'string' && treat.has(l.s) ? l.s : null };
    }).filter(Boolean).sort((a, b) => a.d - b.d);
    return { v: 1, start, plan, checks, logs };
  }
  const newState = (plan, start) => cleanState({ v: 1, plan, start, checks: {}, logs: [] });

  /* ---------- Calendrier réel : pauses, suspensions, reprises ----------
     Un événement du journal ne change que les jours qui le suivent (à partir du jour où il est noté) : le passé garde son calendrier. */
  function timeline(st) {
    const treat = st.plan.steps.filter(s => s.kind === 'treatment');
    const anchors = {}, holds = {};
    treat.forEach(s => { anchors[s.id] = [{ from: 1, at: s.first }]; holds[s.id] = []; });
    let suspended = false;
    for (const ev of st.logs) {
      if (ev.l === 'moderate') {
        for (const s of treat) if (!ev.s || ev.s === s.id) { holds[s.id].push({ from: ev.d, to: ev.d + PAUSE_DAYS, kind: 'pause' }); anchors[s.id].push({ from: ev.d, at: ev.d + PAUSE_DAYS + 1 }); }
      } else if (ev.l === 'strong') {
        suspended = true;
        for (const s of treat) if (!holds[s.id].some(h => h.to === Infinity)) holds[s.id].push({ from: ev.d, to: Infinity, kind: 'suspended' });
      } else if (ev.l === 'resume' && suspended) {
        suspended = false;
        for (const s of treat) { holds[s.id].forEach(h => { if (h.to === Infinity) h.to = ev.d - 1; }); anchors[s.id].push({ from: ev.d, at: ev.d + GAP_DAYS * (s.order - 1) }); }
      }
    }
    return { anchors, holds, suspended };
  }
  /* Jour de départ du calendrier d'un soin tel qu'il s'applique ce jour-là (jamais avant son jour d'introduction prévu). */
  const anchorFor = (tl, step, day) => { let a = step.first; for (const c of tl.anchors[step.id]) if (c.from <= day) a = Math.max(step.first, c.at); return a; };
  /* Premier jour où le soin est réellement introduit (après d'éventuelles pauses qui repoussent son introduction). */
  const introDay = (tl, step) => { if (!step.cad) return null; for (let d = step.first; d <= DAYS; d++) if (d >= anchorFor(tl, step, d) && !tl.holds[step.id].some(h => d >= h.from && d <= h.to)) return d; return null; };

  /* État d'une étape un jour donné : due | rest (pas aujourd'hui selon la fréquence) | later (pas encore introduite) | paused | suspended | unscheduled (fréquence non reconnue). */
  function stepState(st, tl, step, day) {
    const checked = ((st.checks[day]) || []).includes(step.id);
    if (step.kind !== 'treatment') return { state: 'due', checked, cadence: 'daily' };
    if (!step.cad) return { state: 'unscheduled', checked: false };                          // fréquence non reconnue : jamais planifié, jamais coché
    const active = tl.holds[step.id].filter(h => day >= h.from && day <= h.to), hold = active.find(h => h.kind === 'suspended') || active[0];   // la suspension l'emporte sur une pause
    if (hold && !checked) return hold.kind === 'suspended' ? { state: 'suspended', checked } : { state: 'paused', until: hold.to + 1, checked };
    const anchor = anchorFor(tl, step, day);
    if (day < anchor) return { state: checked ? 'due' : 'later', from: anchor, checked };
    const due = onCadence(step.cad, day - anchor);
    return { state: due || checked ? 'due' : 'rest', checked, cadence: step.cad };
  }

  /* Vue d'un jour : étapes du matin et du soir avec leur état, cases cochées, prévues / faites. */
  function dayView(st, day) {
    const tl = timeline(st), out = { day, slots: { morning: [], evening: [] }, expected: 0, done: 0, suspended: tl.suspended };
    for (const step of st.plan.steps) {
      const s = stepState(st, tl, step, day), item = Object.assign({ step }, s);
      out.slots[step.slot].push(item);
      if (s.state === 'due') { out.expected++; if (s.checked) out.done++; }
    }
    return out;
  }

  /* ---------- Actions (renvoient un nouvel état, ou null si elles sont refusées) ---------- */
  const copyState = st => ({ v: 1, start: st.start, plan: st.plan, checks: Object.assign({}, st.checks), logs: st.logs.slice() });
  function tick(st, day, stepId, on, today) {
    const cur = dayNumber(st.start, today);
    if (!isDay(day) || day > Math.min(cur, DAYS)) return null;                                  // jamais un jour à venir
    const step = st.plan.steps.find(s => s.id === stepId); if (!step) return null;
    const v = stepState(st, timeline(st), step, day);
    if (v.state !== 'due' && !v.checked) return null;                                           // seulement ce qui est prévu ce jour-là
    const next = copyState(st), list = new Set(next.checks[day] || []);
    if (on) list.add(stepId); else list.delete(stepId);
    if (list.size) next.checks[day] = [...list]; else delete next.checks[day];
    return next;
  }
  function logTolerance(st, day, level, stepId, today) {
    const cur = dayNumber(st.start, today);
    if (!isDay(day) || day > Math.min(cur, DAYS) || !LEVELS.includes(level) || st.logs.length >= MAX_LOGS) return null;
    const treat = st.plan.steps.find(s => s.id === stepId && s.kind === 'treatment');
    const next = copyState(st);
    next.logs = st.logs.concat([{ d: day, l: level, s: (level === 'moderate' || level === 'strong') && treat ? treat.id : null }]).sort((a, b) => a.d - b.d);
    return next;
  }
  function resume(st, today) {
    const cur = Math.min(dayNumber(st.start, today), DAYS);
    if (!timeline(st).suspended || cur < 1 || st.logs.length >= MAX_LOGS) return null;
    const next = copyState(st); next.logs = st.logs.concat([{ d: cur, l: 'resume', s: null }]).sort((a, b) => a.d - b.d);
    return next;
  }

  /* ---------- Bilan hebdomadaire ---------- */
  function review(st, today) {
    const raw = dayNumber(st.start, today), cur = Math.min(raw, DAYS), weeks = [];
    if (cur < 1) return weeks;
    const closed = raw > DAYS ? DAYS : cur - 1;          // jours terminés : la journée en cours n'est pas encore comptée comme manquée
    const tl = timeline(st);
    WEEKS.forEach(([from, to], i) => {
      if (cur < from) return;
      const upto = Math.min(to, cur), counted = Math.min(to, closed);
      let expected = 0, done = 0;
      for (let d = from; d <= counted; d++) { const v = dayView(st, d); expected += v.expected; done += v.done; }
      const logs = st.logs.filter(l => l.d >= from && l.d <= upto && l.l !== 'resume');
      const tol = { none: 0, mild: 0, moderate: 0, strong: 0 }; logs.forEach(l => { tol[l.l]++; });
      const adherence = expected ? done / expected : null;
      const regularity = counted < from ? 'wait' : adherence === null ? 'none' : adherence >= 0.8 ? 'good' : adherence >= 0.5 ? 'mid' : 'low';
      const messages = [COPY.regularity[regularity]];
      if (tol.strong) messages.push(COPY.strongWeek);
      else if (tol.moderate) messages.push(COPY.moderateWeek);
      else if (tol.mild) messages.push(COPY.mildOnly);
      else if (tol.none) messages.push(COPY.tolerant);
      else messages.push(COPY.noTolerance);
      if (st.logs.filter(l => l.l === 'moderate').length >= 2 || (tol.moderate && tol.strong)) messages.push(COPY.repeated);
      const started = st.plan.steps.filter(s => { const f = s.kind === 'treatment' ? introDay(tl, s) : null; return f !== null && f >= from && f <= Math.min(to, cur); });
      const intro = started.map(s => COPY.newStep(s.label, introDay(tl, s)));
      /* Consigne de progression de la fiche, seulement si rien de gênant n'a été noté et si un soin a déjà commencé. */
      const hints = !tol.moderate && !tol.strong && !tl.suspended
        ? st.plan.steps.filter(s => s.kind === 'treatment' && s.note && introDay(tl, s) !== null && from >= introDay(tl, s) + 7).map(s => s.label + ' : ' + s.note) : [];
      const complete = raw > to;
      weeks.push({ week: i + 1, from, to, upto, complete, title: COPY.weekTitle(i + 1), expected, done, adherence, regularity, tolerance: tol, messages, intro, hints,
        final: i === WEEKS.length - 1 });
    });
    return weeks;
  }

  const unscheduled = plan => plan.steps.filter(s => s.kind === 'treatment' && !s.cad);

  return { DAYS, LEVELS, WEEKS, CADENCE, CADENCES, CADENCE_LABEL, COPY, PAUSE_DAYS, GAP_DAYS, MAX_LOGS,
    cadenceOf, unscheduled, onCadence, build, cleanPlan, cleanState, newState, timeline, stepState, dayView, tick, logTolerance, resume, review, dayNumber, parseDate, localDate, addDays };
});
