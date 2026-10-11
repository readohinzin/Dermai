/* DERMAI : lancement unique d'une analyse payante, conservation d'un résultat reçu et reprise de son enregistrement.
   Module sans accès au DOM ni au réseau : tout ce qui touche le navigateur ou Supabase est injecté (voir create). Il n'appelle jamais
   /api/skin-analysis : il ne fait qu'autoriser (ou refuser) le lancement, et enregistrer le résultat DÉJÀ reçu (ligne `skin_analyses`).

   1. Un lancement = une intention explicite (arm) consommée une seule fois (begin). Un rendu, un changement d'écran ou une reprise
      d'enregistrement ne peuvent donc jamais relancer une analyse. Une analyse à la fois par onglet (verrou posé avant tout await).
   2. Issue ambiguë (aucune réponse DERMAI exploitable : coupure, délai dépassé, page rechargée) : le fournisseur a pu terminer et décompter
      l'analyse. Blocage de 65 s (≥ maxDuration 60 s du serveur + marge), puis confirmation explicite avant toute nouvelle analyse.
      Le marqueur est dans sessionStorage : un rechargement de l'onglet conserve le blocage.
   3. Tampon d'enregistrement (sessionStorage, clé dermai.pending) : le résultat reçu y est écrit AVANT l'envoi à Supabase. Il ne contient que
      la ligne d'historique (scores, priorités, objectifs) : ni photo, ni masque, ni task_id, ni jeton. Chaque entrée reste liée au compte
      d'origine : elle n'est jamais envoyée sous un autre compte, ni présentée à un autre utilisateur ; elle est effacée à la déconnexion,
      au changement de compte, à la suppression de l'historique ou du compte, après 23 h, ou quand le navigateur ferme l'onglet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DermaiAnalysisFlow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BLOCK_MS = 65000;               // fenêtre pendant laquelle l'issue d'une requête sans réponse est inconnue
  const INTENT_MS = 5000;               // un clic « Analyser » reste valable ce temps pour l'écran qui s'ouvre
  const MAX_AGE_MS = 23 * 3600 * 1000;  // la base remplace analyzed_at au-delà d'un jour (trigger) : on s'arrête avant
  const FUTURE_MS = 5 * 60 * 1000;      // tolérance d'horloge ; au-delà, la date est jugée invalide
  const MIN_GAP_MS = 15000;             // écart minimal entre deux reprises automatiques
  const RETRY_MS = [1000, 4000];        // nouvelles tentatives automatiques (erreurs réseau / serveur uniquement)
  const MAX_ENTRIES = 5, MAX_BYTES = 16384;
  const PENDING_KEY = 'dermai.pending', RUN_KEY = 'dermai.run';
  const METRICS = ['acne', 'pores', 'oiliness', 'texture', 'hydration', 'redness', 'pigmentation', 'wrinkles', 'firmness', 'radiance',
    'eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];
  const GOALS = ['hydration', 'oil_pores', 'blemishes', 'tone', 'redness_comfort', 'texture', 'aging', 'maintenance'];
  const BANDS = ['good', 'mid', 'low'];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const MSG = {
    busy: 'Une analyse est déjà en cours. Patientez : son résultat s\'affichera dès qu\'il arrive.',
    blocked: s => 'L\'analyse précédente n\'a pas répondu et son issue reste incertaine : elle a peut-être été réalisée. Pour ne pas en consommer deux, patientez encore ' + s + ' s avant d\'en lancer une autre.',
    confirm: 'L\'issue de votre analyse précédente reste incertaine : nous n\'avons reçu aucune réponse, mais elle a peut-être été réalisée et décomptée. Lancer une nouvelle analyse peut en consommer une seconde. La lancer quand même ?',
    uncertain: 'Nous n\'avons reçu aucune réponse de l\'analyse. Elle a peut-être été réalisée malgré tout. Patientez environ une minute avant d\'en relancer une, pour ne pas en consommer deux.',
    ready: 'Votre analyse est terminée.',
    abandonedEpoch: 'Votre analyse est terminée, mais le compte a changé pendant son traitement : le résultat n\'a pas été conservé.',
    saving: 'Enregistrement de votre analyse…',
    saved: 'Analyse enregistrée dans votre historique.',
    failed: 'Votre analyse est disponible, mais nous n\'avons pas pu l\'enregistrer dans votre historique. Réessayez.',
    kept: ' Le résultat reste conservé sur cet appareil tant que cet onglet reste ouvert.',
    waiting: 'Cette analyse n\'est pas encore enregistrée. Elle le sera à votre prochaine connexion avec ce compte, tant que cet onglet reste ouvert.',
    visitor: 'Cette analyse n\'est pas enregistrée : elle disparaîtra quand vous quitterez cette session. Créez un compte ou connectez-vous avant votre prochaine analyse pour conserver votre historique.',
    skipped: 'Votre analyse est disponible, mais elle n\'a pas été ajoutée à votre historique : certaines valeurs ne sont pas exploitables.',
    expired: n => (n > 1 ? n + ' analyses non enregistrées ont été abandonnées : trop anciennes (plus de 23 heures) ou invalides.' : 'Une analyse non enregistrée a été abandonnée : trop ancienne (plus de 23 heures) ou invalide.'),
    foreign: 'Une analyse non enregistrée d\'un autre compte a été supprimée de cet appareil.',
    leave: 'Une analyse n\'est pas encore enregistrée dans votre historique. Si vous vous déconnectez maintenant, elle sera perdue. Vous déconnecter quand même ?',
    note: ' Votre dernière analyse non enregistrée est conservée sur cet appareil : elle sera enregistrée quand vous vous reconnecterez avec ce compte, tant que cet onglet reste ouvert.',
    unsaved: n => n + (n > 1 ? ' analyses ne sont pas encore enregistrées' : ' analyse n\'est pas encore enregistrée') + ' dans votre historique.'
  };

  const score = v => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
  const text = (v, n) => (typeof v === 'string' && v.trim() && v.trim().length <= n ? v.trim() : null);

  /* Liste blanche stricte d'une ligne d'historique (même forme que recordOfScan). null si inutilisable : identifiant, date ou scores invalides. */
  function cleanRecord(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !UUID_RE.test(r.id)) return null;
    if (typeof r.analyzedAt !== 'string' || Number.isNaN(Date.parse(r.analyzedAt))) return null;
    if (!r.metrics || typeof r.metrics !== 'object' || typeof r.engineVersion !== 'string' || !r.engineVersion) return null;
    const metrics = {}, rawMetrics = {};
    METRICS.forEach(k => { metrics[k] = score(r.metrics[k]); const v = r.rawMetrics && r.rawMetrics[k]; if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) rawMetrics[k] = v; });
    if (METRICS.every(k => metrics[k] === null)) return null;
    return {
      id: r.id, analyzedAt: new Date(r.analyzedAt).toISOString(), globalScore: score(r.globalScore),
      skinType: text(r.skinType, 40), skinAge: typeof r.skinAge === 'number' && Number.isInteger(r.skinAge) && r.skinAge >= 1 && r.skinAge <= 120 ? r.skinAge : null,
      metrics, rawMetrics,
      priorities: (Array.isArray(r.priorities) ? r.priorities : []).filter(p => p && METRICS.includes(p.id) && text(p.label, 60)).slice(0, 15)
        .map(p => ({ id: p.id, label: p.label.trim(), score: score(p.score), band: BANDS.includes(p.band) ? p.band : null })),
      goals: (Array.isArray(r.goals) ? r.goals : []).filter((g, i, a) => GOALS.includes(g) && a.indexOf(g) === i).slice(0, 3),
      engineVersion: r.engineVersion.slice(0, 40)
    };
  }

  /* Identifiant propre à l'analyse (pas le task_id du fournisseur) : un nouvel envoi de la même ligne ne crée jamais de doublon. */
  const newId = () => {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* repli ci-dessous */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  };

  /* deps : storage() → sessionStorage ou null · now() → ms · userId() → identifiant du compte connecté ou null
     save(rec, ownerId) → Promise<{ok, expired?, foreign?, retryable?}> · confirm(msg) → bool · toast(msg) · onChange() · onSaved(id) · onExpired()
     timer(fn, ms) → poignée · untimer(handle) */
  function create(deps) {
    const d = deps || {};
    const now = d.now || Date.now;
    const store = () => { try { return d.storage ? d.storage() : null; } catch (e) { return null; } };
    const rd = k => { try { const s = store(); return s ? s.getItem(k) : null; } catch (e) { return null; } };
    const wr = (k, v) => { try { const s = store(); if (s) { if (v === null) s.removeItem(k); else s.setItem(k, v); } } catch (e) { /* stockage indisponible : le résultat reste en mémoire */ } };
    const uid = () => { try { return (d.userId && d.userId()) || null; } catch (e) { return null; } };
    const say = m => { try { if (d.toast) d.toast(m); } catch (e) { /* sans importance */ } };
    const changed = () => { try { if (d.onChange) d.onChange(); } catch (e) { /* sans importance */ } };
    const entries = new Map();          // id de l'analyse → entrée : { uid, rec, status, tries, busy, at, timer }
    let loaded = false, intent = 0, running = false;

    /* ---------- Lancement ---------- */
    /* Un marqueur par compte (le quota est propre à chaque compte) : { t: début de la requête, s: run | amb }. Il disparaît quand le serveur
       DERMAI a répondu (succès ou refus), et reste dans le cas contraire : requête sans réponse, délai dépassé, page rechargée. */
    const readRuns = () => { try { const m = JSON.parse(rd(RUN_KEY)); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch (e) { return {}; } };
    const setRun = (u, v) => { const m = readRuns(); if (v) m[u] = v; else delete m[u]; const k = Object.keys(m); wr(RUN_KEY, k.length ? JSON.stringify(Object.fromEntries(k.slice(-5).map(x => [x, m[x]]))) : null); };
    const me = () => uid() || 'anon';
    /* Marqueur valable de ce compte. Une date impossible (horloge reculée de plus de 5 min) le rend inutilisable : il est effacé. */
    function unknownRun() {
      const u = me(), m = readRuns()[u];
      if (!m) return null;
      if (!Number.isFinite(m.t) || m.t > now() + FUTURE_MS) { setRun(u, null); return null; }
      return m;
    }
    const wait = m => Math.min(Math.max(Math.ceil((m.t + BLOCK_MS - now()) / 1000), 0), BLOCK_MS / 1000);

    /* Intention explicite de l'utilisateur (clic sur « Analyser ») : contrôle ce qui peut l'être avant d'ouvrir l'écran d'analyse. */
    function arm() {
      if (running) { say(MSG.busy); return false; }
      const m = unknownRun();
      if (m) {
        const w = wait(m);
        if (w > 0) { say(MSG.blocked(w)); return false; }
        if (!d.confirm || !d.confirm(MSG.confirm)) return false;                        // issue incertaine : jamais de relance sans accord explicite
      }
      intent = now();
      return true;
    }
    const armed = () => intent > 0 && now() - intent >= 0 && now() - intent <= INTENT_MS;
    const disarm = () => { intent = 0; };
    /* Démarrage effectif : consomme l'intention, pose le verrou AVANT tout await. Renvoie { end(ambiguous) } ou null. */
    function begin() {
      if (running || !armed()) return null;
      intent = 0;
      const m = unknownRun();
      if (m && wait(m) > 0) return null;                                                // fenêtre de blocage ouverte entre le clic et l'écran
      running = true;
      const u = me(), t = now();
      setRun(u, { t, s: 'run' });
      let over = false;
      return {
        end(ambiguous) {
          if (over) return; over = true; running = false;
          setRun(u, ambiguous ? { t, s: 'amb' } : null);
        }
      };
    }

    /* ---------- Tampon ---------- */
    const unsavedOf = e => e.status !== 'saved' && e.status !== 'skipped' && e.status !== 'visitor';
    function persist() {
      const list = [...entries.values()].filter(unsavedOf).sort((a, b) => b.at - a.at), keep = [];
      let size = 0;
      for (const e of list) {
        const item = { uid: e.uid, at: e.at, rec: e.rec }, n = JSON.stringify(item).length;
        if (keep.length >= MAX_ENTRIES || size + n > MAX_BYTES) break;
        keep.push(item); size += n;
      }
      wr(PENDING_KEY, keep.length ? JSON.stringify({ v: 1, items: keep }) : null);
    }
    function drop(e, silent) { if (e.timer) { d.untimer && d.untimer(e.timer); e.timer = null; } entries.delete(e.rec.id); if (!silent) persist(); }
    /* Date effective : analyzedAt de l'enregistrement, jamais l'heure d'écriture. Passé de plus de 23 h, futur ou invalide → abandon. */
    const expiredAt = rec => { const t = Date.parse(rec.analyzedAt), n = now(); return Number.isNaN(t) || t > n + FUTURE_MS || n - t > MAX_AGE_MS; };
    function load() {
      if (loaded) return; loaded = true;
      const raw = rd(PENDING_KEY); if (!raw) return;
      let bad = 0, data = null;
      try { data = JSON.parse(raw); } catch (e) { data = null; }
      const items = data && data.v === 1 && Array.isArray(data.items) ? data.items : null;
      if (!items) { wr(PENDING_KEY, null); say(MSG.expired(1)); return; }
      items.slice(0, 50).forEach(it => {
        const rec = it && typeof it.uid === 'string' && it.uid ? cleanRecord(it.rec) : null;
        if (!rec || expiredAt(rec) || entries.has(rec.id) || entries.size >= MAX_ENTRIES) { bad++; return; }
        entries.set(rec.id, { uid: it.uid, rec, status: 'pending', tries: 0, busy: false, at: Number.isFinite(it.at) ? it.at : now(), last: 0, timer: null });
      });
      bad += Math.max(items.length - 50, 0);
      if (bad) { say(MSG.expired(bad)); persist(); }
    }
    function sweep() {
      load(); let n = 0;
      [...entries.values()].forEach(e => { if (!e.busy && unsavedOf(e) && expiredAt(e.rec)) { drop(e, true); n++; } });
      if (n) { persist(); say(MSG.expired(n)); }
    }
    /* Entrées du compte donné. Celles d'un autre compte sont abandonnées ici même (jamais envoyées, jamais montrées). */
    function list(who) {
      const u = who || uid(); if (!u) return [];                    // sans compte connecté : rien n'est listé, rien n'est purgé
      sweep(); let foreign = 0;
      [...entries.values()].forEach(e => { if (e.uid !== u) { if (unsavedOf(e)) foreign++; drop(e, true); } });
      if (foreign) { persist(); say(MSG.foreign); }
      return [...entries.values()].sort((a, b) => a.at - b.at);
    }
    const own = () => { const u = uid(); return u ? list(u).filter(unsavedOf) : []; };

    /* ---------- Enregistrement ---------- */
    async function attempt(e) {
      if (e.busy || e.status === 'saved') return;
      if (e.uid !== uid()) { if (!e.busy && e.status === 'saving') e.status = 'pending'; return; }   // jamais sous un autre compte ; reste en attente pour le sien
      if (e.timer) { d.untimer && d.untimer(e.timer); e.timer = null; }
      if (expiredAt(e.rec)) { sweep(); return; }
      e.busy = true; e.status = 'saving'; e.last = now(); changed();
      let r;
      try { r = await d.save(e.rec, e.uid); } catch (x) { r = { ok: false, retryable: true }; }
      e.busy = false;
      if (entries.get(e.rec.id) !== e) return;                      // supprimée pendant l'envoi (déconnexion, historique effacé)
      if (r && r.ok) { e.status = 'saved'; persist(); try { d.onSaved && d.onSaved(e.rec.id); } catch (x) { /* sans importance */ } changed(); return; }
      if (r && (r.expired || r.foreign)) { e.status = 'pending'; changed(); if (r.expired && d.onExpired) d.onExpired(); return; }   // gardée pour ce compte
      e.status = 'error'; e.retryable = !!(r && r.retryable);
      if (e.retryable && e.tries < RETRY_MS.length && d.timer) { e.status = 'saving'; e.timer = d.timer(() => { e.timer = null; attempt(e); }, RETRY_MS[e.tries++]); }   // nouvel essai automatique, borné
      changed();
    }
    /* Ajoute une analyse reçue : écrite dans le tampon AVANT l'envoi. Sans compte connecté ou sans valeurs exploitables, elle n'est pas
       enregistrée (et donc pas tamponnée) : seul son état est gardé pour l'affichage. */
    function add(rec, o) {
      const opt = o || {}, rc = cleanRecord(rec), id = (rc || rec || {}).id;
      if (!id) return;
      const u = opt.signedIn ? uid() : null, base = { uid: u, rec: rc || rec, tries: 0, busy: false, at: now(), last: 0, timer: null };
      if (!opt.recordable || !rc) entries.set(id, Object.assign(base, { status: 'skipped' }));
      else if (!u) entries.set(id, Object.assign(base, { status: 'visitor' }));
      else {
        list(u);
        const e = Object.assign(base, { status: 'pending' });
        entries.set(id, e); persist();
        attempt(e);
        return;
      }
      changed();
    }
    /* Reprise sans nouvelle analyse : renvoie la même ligne (même identifiant, donc sans doublon). `manual` : bouton « Réessayer ». */
    function resume(manual) {
      const t = now();
      own().forEach(e => { if (!e.busy && (manual || (t - e.last >= MIN_GAP_MS && (e.status === 'pending' || e.status === 'error')))) { if (manual) e.tries = 0; attempt(e); } });
    }
    /* À la connexion : envoie les analyses en attente de CE compte, puis rend la main (l'historique est chargé ensuite). */
    async function flush(u) {
      const mine = list(u).filter(unsavedOf);
      await Promise.all(mine.map(e => { if (e.status === 'saving' || e.busy) return null; e.tries = 0; return attempt(e); }));   // nouvelle session : nouvelle série d'essais
    }
    function clear() { [...entries.values()].forEach(e => drop(e, true)); wr(PENDING_KEY, null); }
    /* Déconnexion : rien de ce compte ne reste sur l'appareil. Demande confirmation si une analyse n'est pas encore enregistrée. */
    function leave() {
      if (own().length && !(d.confirm && d.confirm(MSG.leave))) return false;
      clear(); return true;
    }

    const noticeOf = id => {
      const e = entries.get(id);
      if (!e) return null;
      const s = e.status;
      return s === 'saving' ? { status: s, message: MSG.saving }
        : s === 'saved' ? { status: s, message: MSG.saved }
        : s === 'error' ? { status: s, message: MSG.failed + MSG.kept }
        : s === 'pending' ? { status: s, message: MSG.waiting }
        : s === 'visitor' ? { status: s, message: MSG.visitor }
        : s === 'skipped' ? { status: s, message: MSG.skipped } : null;
    };
    const banner = () => {
      const l = own().filter(e => e.status === 'error' || e.status === 'pending');
      return l.length ? '<div class="c-notice u-my-5" role="status"><div>' + MSG.unsaved(l.length) + MSG.kept + ' <button class="link" data-act="retry-analysis">Réessayer</button></div></div>' : '';
    };
    return {
      arm, armed, disarm, begin, busy: () => running, newId,
      add, list, flush, resume, clear, leave, banner, notice: noticeOf,
      pending: () => own().length,
      note: () => ([...entries.values()].some(unsavedOf) ? MSG.note : ''),
      markers: { PENDING_KEY, RUN_KEY }
    };
  }

  return { create, cleanRecord, newId, MSG, BLOCK_MS, INTENT_MS, MAX_AGE_MS, FUTURE_MS, MAX_ENTRIES, MAX_BYTES, PENDING_KEY, RUN_KEY, RETRY_MS };
});
