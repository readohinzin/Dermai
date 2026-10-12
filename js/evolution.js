/* DERMAI Évolution : bilan en langage clair entre deux analyses ENREGISTRÉES, raccourcis de sélection, photos côte à côte. Chargé avant app.js.
   Module sans accès au réseau, au stockage ni au fournisseur d'analyse : il ne lit que les analyses déjà chargées dans l'application (tableau SCANS) et l'état du
   programme de 30 jours déjà présent dans ce navigateur. Il ne lance jamais d'analyse, n'écrit rien, ne garde aucun lien de photo.

   Règles de lecture, volontairement prudentes :
   - Seuls les indicateurs présents dans les DEUX analyses sont comparés ; une valeur absente ou nulle n'est ni inventée ni classée.
   - Classement par l'écart des scores affichés (0 à 100, 100 = meilleur), avec le seuil technique PROVISOIRE de SkinModel.TREND_STEP (2 points), jamais présenté comme
     validé scientifiquement : en hausse, variation faible, en baisse.
   - Huile, texture et radiance : le fournisseur ne documente pas la direction exacte de ces mesures. Elles sont rangées dans « Variation observée », sans jugement.
   - Contour des yeux : information indicative seulement, jamais classée en amélioration ou en baisse.
   - Une variation de score ne prouve ni une amélioration clinique ni l'efficacité d'un produit : aucune variation n'est attribuée à un ingrédient, un produit,
     une routine ou au programme. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiEvolution = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const skin = () => (typeof module === 'object' && module.exports ? require('./skin-model.js') : root.SkinModel);
  const NEUTRAL = ['oiliness', 'texture', 'radiance'];                                   // direction non documentée par le fournisseur
  const EYE = ['eyeBag', 'tearTrough', 'darkCircle', 'droopyUpperEyelid', 'droopyLowerEyelid'];   // information indicative seulement
  const DAY_MS = 86400000;

  const COPY = {
    title: 'Bilan de votre évolution',
    warning: 'Ces résultats décrivent les variations de scores de l\'analyse. Ils ne prouvent pas à eux seuls une amélioration clinique ni l\'efficacité d\'un produit. Les conditions de prise de vue et les variations de mesure peuvent influencer les résultats.',
    threshold: 'Le seuil de variation faible (2 points) est une valeur technique provisoire : il n\'est pas validé scientifiquement.',
    up: 'Score en hausse', flat: 'Variation faible', down: 'Score en baisse', observed: 'Variation observée', eye: 'Contour des yeux, à titre indicatif',
    observedNote: 'Pour ces mesures, le sens exact du score n\'est pas documenté : nous indiquons la variation sans dire si elle est favorable.',
    eyeNote: 'Ces repères sont donnés à titre d\'information : ils ne permettent pas de conclure à une amélioration.',
    globalNote: 'Le score global est une information séparée : sa variation ne signifie pas que tous les indicateurs ont évolué dans le même sens.',
    sameDay: 'Ces deux analyses datent du même jour : les écarts reflètent surtout la variation de mesure et de prise de vue.',
    swapped: 'Les analyses sont présentées dans l\'ordre des dates.',
    same: 'Choisissez deux analyses différentes pour obtenir un bilan.',
    none: 'Aucun indicateur n\'est présent dans les deux analyses : le bilan n\'est pas possible.',
    unsaved: d => `L'analyse ${d} n'est pas encore enregistrée dans votre historique : elle n'est pas incluse dans ce bilan.`,
    settled: 'Une analyse récente n\'est pas encore enregistrée dans votre historique : elle n\'est pas incluse dans ce bilan. La comparaison porte sur vos deux dernières analyses enregistrées ; vous pouvez choisir d\'autres analyses ci-dessous.',
    oneSaved: 'Une seule analyse est enregistrée dans votre historique : une comparaison nécessite une seconde analyse enregistrée.',
    noneSaved: 'Aucune analyse n\'est enregistrée dans votre historique : le bilan nécessite au moins deux analyses enregistrées.',
    unsavedSome: 'Une analyse récente n\'est pas encore enregistrée : elle n\'est pas incluse dans ce bilan.',
    hasMore: 'Votre historique contient d\'autres analyses, plus anciennes que celles affichées. Affichez-les avec « Voir plus d\'analyses » dans « Mes analyses » pour comparer depuis votre toute première analyse.',
    programMissing: 'L\'analyse de départ de votre programme est introuvable : elle a pu être supprimée, ne pas être enregistrée, ou ne pas être encore chargée. Choisissez les deux analyses à comparer ci-dessous.',
    programLatest: 'Aucune analyse n\'est plus récente que celle du début de votre programme. Une nouvelle analyse reste possible quand vous le souhaitez ; DERMAI n\'en lance jamais automatiquement.',
    programNone: 'Aucun programme de soins n\'est commencé sur cet appareil.',
    programInfo: (s, a) => `Programme commencé le ${s}${a ? `, à partir de votre analyse du ${a}` : ''}. Ces dates sont indicatives : elles ne disent pas que le programme a causé les variations.`,
    photoBoth: 'Photos côte à côte',
    photoOne: d => `Une seule photo est disponible pour cette comparaison (analyse du ${d}). Le comparatif de scores reste disponible plus bas.`,
    photoNone: 'Aucune photo n\'est affichée pour ces deux analyses : elles ne sont conservées que si vous l\'avez choisi, ou elles sont encore en cours de chargement. Le comparatif de scores reste disponible plus bas.'
  };

  const isScore = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
  const fmtDay = iso => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }); } catch (e) { return ''; } };
  const signed = n => (n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0');
  const safePhoto = u => (typeof u === 'string' && /^(blob:|https:\/\/)/.test(u) && u.length < 4096 ? u : '');

  /* Forme neutre d'une analyse chargée (entrée SCANS de l'application) : { saved, at, scores, global }. Rien n'est déduit : un score invalide donne null. */
  function fromScan(scan) {
    const M = skin(), n = scan && scan.normalized;
    if (!scan || !n) return null;
    const scores = {};
    M.METRIC_KEYS.forEach(k => { const v = M.displayScore(n[k] && n[k].uiScore); scores[k] = isScore(v) ? v : null; });
    const g = M.displayScore(n.globalScore);
    const at = (scan.rec && scan.rec.analyzedAt) || scan.analyzedAt || null;
    return { saved: scan.saved === true, at: at && !Number.isNaN(Date.parse(at)) ? at : null, scores, global: isScore(g) ? g : null, id: scan.rec ? scan.rec.id : null };
  }

  /* Bilan de deux analyses (formes de fromScan). Pure : aucun effet, aucune lecture extérieure. */
  function report(a, b) {
    const M = skin(), TH = M.TREND_STEP;
    if (!a || !b) return { status: 'none' };
    if (a === b || (a.id && a.id === b.id)) return { status: 'same' };
    const bad = [a, b].filter(x => !x.saved);
    if (bad.length) return { status: 'unsaved', which: bad.map(x => x.at) };
    const swapped = a.at && b.at && Date.parse(a.at) > Date.parse(b.at);
    const before = swapped ? b : a, after = swapped ? a : b;
    const groups = { up: [], flat: [], down: [], observed: [], eye: [] }, missing = [];
    M.METRIC_KEYS.forEach(key => {
      const x = before.scores[key], y = after.scores[key], label = M.METRIC_LABELS[key];
      if (!isScore(x) || !isScore(y)) { missing.push(label); return; }
      const row = { key, label, before: x, after: y, delta: y - x };
      if (EYE.includes(key)) groups.eye.push(row);
      else if (NEUTRAL.includes(key)) groups.observed.push(row);
      else groups[row.delta > TH ? 'up' : row.delta < -TH ? 'down' : 'flat'].push(row);
    });
    const comparable = groups.up.length + groups.flat.length + groups.down.length + groups.observed.length + groups.eye.length;
    const days = before.at && after.at ? (Date.parse(after.at) - Date.parse(before.at)) / DAY_MS : null;
    return {
      status: comparable ? 'ok' : 'empty', before, after, groups, missing, comparable, swapped: !!swapped, threshold: TH,
      sameDay: days !== null && days < 1,
      global: isScore(before.global) && isScore(after.global) ? { before: before.global, after: after.global, delta: after.global - before.global } : null
    };
  }

  /* deps : scans() → SCANS · state() → state (cmpA, cmpB, history) · select(i, j) · go(route) · render() · program() → état du programme local ou null
     label(scan) → date lisible · demo() · userId() · trend() → libellés de tendance du moteur */
  function create(deps) {
    const d = deps || {};
    const call = (f, dflt) => { try { return typeof f === 'function' ? f() : dflt; } catch (e) { return dflt; } };
    const scans = () => call(d.scans, []) || [];
    const st = () => call(d.state, {}) || {};
    const demo = () => !!call(d.demo, false);
    const lab = s => { try { return d.label ? d.label(s) : ''; } catch (e) { return ''; } };
    let who, notice = null;
    function sync() { const u = call(d.userId, null) || 'none'; if (u !== who) { who = u; notice = null; } }

    const savedScans = () => scans().filter(s => s && s.saved === true && s.normalized);
    const tsOf = s => { const t = Date.parse((s.rec && s.rec.analyzedAt) || s.analyzedAt); return Number.isNaN(t) ? 0 : t; };
    const newest = list => list.reduce((m, s) => (!m || tsOf(s) >= tsOf(m) ? s : m), null);
    const oldest = list => list.reduce((m, s) => (!m || tsOf(s) < tsOf(m) ? s : m), null);
    const idx = s => scans().indexOf(s);

    /* Départ du programme : { found, latest, reason }. Jamais une autre analyse choisie en silence. */
    function programTarget() {
      const p = call(d.program, null);
      if (!p || !p.plan || !p.start) return { reason: 'none' };
      const list = savedScans(), bid = p.plan.base && p.plan.base.id;
      const base = bid ? list.find(s => s.rec && s.rec.id === bid) : null;
      if (!base) return { reason: 'missing', p };
      const latest = newest(list);
      if (!latest || latest === base) return { reason: 'latest', p, base };
      return { reason: 'ok', p, base, latest };
    }
    function programDates(p) {
      const a = p.plan && p.plan.base && p.plan.base.at ? fmtDay(p.plan.base.at) : '';
      const s = /^\d{4}-\d{2}-\d{2}$/.test(String(p.start)) ? fmtDay(p.start + 'T12:00:00') : '';
      return [s, a];
    }
    const remember = text => { const s = st(); notice = { text, a: s.cmpA, b: s.cmpB }; };

    /* Choix à la main (listes « Avant » / « Maintenant ») : retenu par analyse (pas par position), valable tant que ces deux analyses restent sélectionnées. */
    let manual = null;
    const chosen = () => { const l = scans(), s = st(); return [l[s.cmpA], l[s.cmpB]]; };
    function pick() { const [a, b] = chosen(); manual = a && b ? { a, b } : null; }
    /* Sélection PAR DÉFAUT de l'écran (les deux dernières analyses de la liste) : si l'une n'est pas enregistrée, elle ne doit pas empêcher le bilan des analyses
       enregistrées. On sélectionne alors les deux plus récentes ENREGISTRÉES. Un choix manuel, ou une sélection autre que celle par défaut, n'est jamais modifié. */
    function settle() {
      if (demo()) return;
      sync();
      const l = scans(), s = st(), last = l.length - 1, [a, b] = chosen();
      if (l.length < 2 || s.cmpA !== last - 1 || s.cmpB !== last || (a && a.saved === true && b && b.saved === true)) return;
      if (manual && manual.a === a && manual.b === b) return;
      const two = savedScans().map(x => ({ x, t: tsOf(x), i: idx(x) })).sort((p, q) => p.t - q.t || p.i - q.i).slice(-2);
      if (two.length < 2 || !d.select) return;
      d.select(two[0].i, two[1].i);
      remember(COPY.settled);
    }

    /* Raccourci « Depuis le début du programme » : sélectionne l'analyse de départ (plan.base.id) et la plus récente, ou explique pourquoi c'est impossible. */
    function fromProgram(stay) {
      sync();
      const t = programTarget();
      if (t.reason === 'ok') { if (d.select) d.select(idx(t.base), idx(t.latest)); notice = null; }   // les notes « Comparer rapidement » expliquent déjà ce cas
      else if (t.reason === 'none') remember(COPY.programNone);                                         // missing / latest : la note permanente du bloc l'explique, sans doublon
      if (stay) { if (d.render) d.render(); } else if (d.go) d.go('progress');
      return t.reason === 'ok';
    }
    function fromFirst() {
      sync();
      const list = savedScans();
      const s = st();
      if (list.length < 2 || (s.history && s.history.hasMore)) return false;
      if (d.select) d.select(idx(oldest(list)), idx(newest(list)));
      notice = null;
      if (d.render) d.render();
      return true;
    }

    function rowHtml(r, mode) {
      const tag = mode === 'up' ? 'up' : mode === 'down' ? 'down' : 'flat';
      return `<li class="c-indicator"><span class="c-indicator__name">${esc(r.label)}</span><span class="c-indicator__value"><span class="c-indicator__score">${r.before} → ${r.after}<small>/100</small></span><span class="c-delta c-delta--${tag}">${signed(r.delta)}</span></span></li>`;
    }
    function groupHtml(title, rows, mode, note) {
      if (!rows.length) return '';
      return `<div class="c-evo__group"><h3 class="c-evo__title">${esc(title)} <span class="c-badge c-badge--outline">${rows.length}</span></h3><ul class="c-indicators">${rows.map(r => rowHtml(r, mode)).join('')}</ul>${note ? `<p class="muted c-evo__note">${esc(note)}</p>` : ''}</div>`;
    }
    function shortcutsHtml() {
      const out = [], s = st(), list = savedScans();
      if (list.length >= 2) {
        if (s.history && s.history.hasMore) out.push(`<p class="muted c-evo__note">${esc(COPY.hasMore)}</p>`);
        else out.push('<button type="button" class="c-btn c-btn--secondary c-btn--block" data-evo="first">Depuis ma première analyse</button>');
      }
      const t = programTarget();
      if (t.reason === 'ok') out.push(`<button type="button" class="c-btn c-btn--secondary c-btn--block" data-evo="program">Depuis le début du programme</button><p class="muted c-evo__note">${esc(COPY.programInfo(...programDates(t.p)))}</p>`);
      else if (t.reason !== 'none') out.push(`<p class="muted c-evo__note">${esc(t.reason === 'missing' ? COPY.programMissing : COPY.programLatest)}</p>`);
      return out.length ? `<div class="c-evo__shortcuts"><p class="kicker">Comparer rapidement</p><div class="stack" style="gap:8px">${out.join('')}</div></div>` : '';
    }

    /* Bloc « Bilan de votre évolution » pour les deux analyses choisies (entrées SCANS). Chaîne vide en démonstration. */
    function card(A, B) {
      if (demo()) return '';
      sync();
      const frame = inner => `<section class="c-card c-evo" aria-labelledby="evo-title"><h2 class="h3" id="evo-title">${esc(COPY.title)}</h2>${inner}</section>`;
      const saved = savedScans().length;
      if (saved < 2) {                                                  // état explicite : jamais de bilan avec moins de deux analyses enregistrées
        const some = scans().some(x => x && x.saved !== true);
        return frame(`<p class="muted">${esc(saved === 1 ? COPY.oneSaved : COPY.noneSaved)}</p>${some ? `<div class="c-notice u-my-5" role="status"><div>${esc(COPY.unsavedSome)}</div></div>` : ''}`);
      }
      const rep = report(fromScan(A), fromScan(B));
      const s = st();
      const msg = notice && notice.a === s.cmpA && notice.b === s.cmpB ? `<div class="c-notice u-my-5" role="status"><div>${esc(notice.text)}</div></div>` : '';
      let body = '';
      if (rep.status === 'same') body = `<p class="muted">${esc(COPY.same)}</p>`;
      else if (rep.status === 'unsaved') body = rep.which.map(at => `<div class="c-notice u-my-5" role="status"><div>${esc(COPY.unsaved(at ? 'du ' + fmtDay(at) : 'choisie'))}</div></div>`).join('');
      else if (rep.status === 'none' || rep.status === 'empty') body = `<p class="muted">${esc(COPY.none)}</p>${rep.missing && rep.missing.length ? `<p class="muted c-evo__note">Valeur absente d'une des deux analyses : ${esc(rep.missing.join(', '))}.</p>` : ''}`;
      else {
        const g = rep.groups, up = g.up.length, fl = g.flat.length, dn = g.down.length;
        body = `<p class="c-evo__period">Du ${esc(fmtDay(rep.before.at))} au ${esc(fmtDay(rep.after.at))}${rep.swapped ? ` <span class="muted">(${esc(COPY.swapped)})</span>` : ''}</p>
          <p class="c-evo__summary">Sur ${up + fl + dn + g.observed.length + g.eye.length} indicateurs comparables : ${up} en hausse, ${fl} avec une variation faible, ${dn} en baisse${g.observed.length + g.eye.length ? `, ${g.observed.length + g.eye.length} en variation observée ou indicative` : ''}.</p>
          ${rep.sameDay ? `<div class="c-notice u-my-5" role="status"><div>${esc(COPY.sameDay)}</div></div>` : ''}
          ${groupHtml(COPY.up, g.up, 'up')}${groupHtml(COPY.flat, g.flat, 'flat')}${groupHtml(COPY.down, g.down, 'down')}
          ${groupHtml(COPY.observed, g.observed, 'flat', COPY.observedNote)}${groupHtml(COPY.eye, g.eye, 'flat', COPY.eyeNote)}
          ${rep.global ? `<p class="c-evo__global"><b>Score global :</b> ${rep.global.before} → ${rep.global.after} (${signed(rep.global.delta)}). <span class="muted">${esc(COPY.globalNote)}</span></p>` : ''}
          ${rep.missing.length ? `<p class="muted c-evo__note">Non comparés (valeur absente d'une des deux analyses) : ${esc(rep.missing.join(', '))}.</p>` : ''}`;
      }
      return `<section class="c-card c-evo" aria-labelledby="evo-title"><h2 class="h3" id="evo-title">${esc(COPY.title)}</h2>${msg}${shortcutsHtml()}${body}
        <div class="c-notice u-my-5" role="note"><div><p>${esc(COPY.warning)}</p><p class="muted c-evo__note">${esc(COPY.threshold)}</p></div></div></section>`;
    }

    /* Photos des deux analyses, côte à côte (le curseur avant/après reste dans l'écran). Seuls blob: et https: sont acceptés ; rien n'est gardé. */
    function photos(A, B) {
      if (demo()) return '';
      const fa = fromScan(A), fb = fromScan(B);
      if (!fa || !fb) return '';
      let first = A, second = B;
      if (fa.at && fb.at && Date.parse(fa.at) > Date.parse(fb.at)) { first = B; second = A; }
      const pa = safePhoto(first.photo), pb = safePhoto(second.photo);
      const fig = (s, p, cap) => `<figure class="c-evo__fig"><img src="${esc(p)}" alt="Photo de l'analyse du ${esc(lab(s))}" loading="lazy" decoding="async"><figcaption>${cap} · ${esc(lab(s))}</figcaption></figure>`;
      if (pa && pb) return `<div class="c-evo__photos" role="group" aria-label="${esc(COPY.photoBoth)}">${fig(first, pa, 'Avant')}${fig(second, pb, 'Maintenant')}</div>`;
      if (pa || pb) {
        const s = pa ? first : second;
        return `<div class="c-notice" role="status"><div>${esc(COPY.photoOne(lab(s)))}</div></div><div class="c-evo__photos c-evo__photos--one">${fig(s, pa || pb, pa ? 'Avant' : 'Maintenant')}</div>`;
      }
      return `<div class="c-notice" role="status"><div>${esc(COPY.photoNone)}</div></div>`;
    }

    /* Priorités « depuis l'analyse précédente » (bloc extrait de l'écran d'évolution, contenu inchangé). `ev` : personalization.evolution du moteur. */
    function priorities(ev) {
      const trend = call(d.trend, {}) || {};
      if (!ev || !ev.available || !ev.indicators || !ev.indicators.length) return '';
      return `<section class="sand" style="margin-bottom:24px"><div class="hd"><h2 class="h3">Vos priorités actuelles, depuis l'analyse précédente</h2></div><ul class="c-indicators">${ev.indicators.map(i => `<li class="c-indicator"><span class="c-indicator__name">${i.label}</span><span class="c-indicator__value">${i.delta === null ? '<span class="muted">Comparaison indisponible</span>' : `<span class="c-indicator__score">${i.previous} → ${i.current}<small>/100</small></span><span class="c-delta c-delta--${i.trend === 'up' ? 'up' : i.trend === 'down' ? 'down' : 'flat'}">${trend[i.trend]}</span>`}</span></li>`).join('')}</ul><p class="muted" style="margin-top:10px">${ev.note}</p></section>`;
    }

    function attach(doc) {
      if (!doc || !doc.addEventListener) return;
      doc.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-evo]') : null;
        if (!el || el.disabled) return;
        const a = el.getAttribute('data-evo');
        if (a === 'first') fromFirst(); else if (a === 'program') fromProgram(true);
      });
    }
    return { card, photos, priorities, attach, fromProgram, fromFirst, settle, pick, reset: () => { notice = null; who = undefined; manual = null; } };
  }

  return { create, report, fromScan, COPY, NEUTRAL, EYE };
});
