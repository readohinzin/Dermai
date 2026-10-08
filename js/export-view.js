/* DERMAI : exporter et partager le résultat d'une analyse (PDF créé SUR L'APPAREIL, partage du système).
   Aucune décision ici : tout vient du moteur (Engine.run → synthesis) et de l'analyse affichée ; ce module met en page ce que l'écran Résultat montre.
   Confidentialité :
     - rien n'est envoyé à un serveur, rien n'est enregistré (ni localStorage, ni base, ni URL) : le fichier naît dans le navigateur ;
     - jamais de rawScore (seuls les scores affichés), jamais de masque de localisation ;
     - la photo n'est incluse que si l'utilisatrice coche « Inclure ma photo » (décochée par défaut), repassée par un canvas : le fichier ne contient
       alors ni métadonnées EXIF ni position GPS ;
     - « Copier le résumé » met un texte court dans le presse-papiers (aucun PDF) ;
     - « Partager » ouvre le partage du système (fichier PDF si l'appareil le permet, sinon texte, sinon copie dans le presse-papiers) : aucun lien public.
   Chargé avant app.js ; js/export-pdf.js fournit la mise en forme PDF. */
(function (root) {
  'use strict';
  const G = typeof globalThis !== 'undefined' ? globalThis : root;
  const SM = () => root.SkinModel || G.SkinModel, EN = () => root.DermaiEngine || G.DermaiEngine, PDF = () => root.DermaiPdf || G.DermaiPdf;

  const TEXT = {
    titles: { result: 'Garder ou partager votre résultat', routine: 'Garder ou partager votre routine', products: 'Garder ou partager vos soins recommandés' },
    intro: 'Un PDF créé sur votre appareil : rien n\'est envoyé à DERMAI ni enregistré.', introDoc: 'Un seul PDF avec votre analyse, votre routine et les produits proposés, créé sur votre appareil : rien n\'est envoyé à DERMAI ni enregistré.',
    photo: 'Inclure ma photo', photoNote: 'Le fichier pourra circuler hors de DERMAI : ne l\'incluez que si vous le souhaitez.',
    download: 'Télécharger en PDF', share: 'Partager', copy: 'Copier le résumé',
    downloaded: 'PDF téléchargé.', downloadedNoPhoto: 'PDF téléchargé sans la photo : elle n\'a pas pu être ajoutée.', sharedNoPhoto: 'PDF partagé sans la photo : elle n\'a pas pu être ajoutée.', copied: 'Résumé copié : vous pouvez le coller où vous voulez.',
    sharedFallback: 'Le partage n\'est pas disponible ici : le PDF a été téléchargé.',
    failed: 'Le PDF n\'a pas pu être créé. Réessayez.', copyFailed: 'La copie n\'a pas fonctionné. Vous pouvez télécharger le PDF à la place.', shareFailed: 'Le partage n\'a pas pu se faire. Vous pouvez télécharger le PDF.',
    footer: 'Analyse cosmétique visuelle. DERMAI ne pose pas de diagnostic médical.',
    disclaimer: 'Analyse cosmétique de l\'état apparent de la peau, ce n\'est pas un diagnostic médical. Les résultats peuvent varier selon la lumière et la prise de vue.',
    subtitle: 'Analyse cosmétique de la peau', earlier: 'Cette analyse n\'est pas la plus récente : la routine de l\'application correspond à votre analyse la plus récente.',
    unavailable: 'Donnée indisponible', info: 'Information', kept: 'Retenu par DERMAI'
  };
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dateLabel = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); };
  const dateSlug = iso => { const d = new Date(iso), p = n => String(n).padStart(2, '0'); return Number.isNaN(d.getTime()) ? 'resultat' : d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const filename = iso => 'dermai-analyse-' + dateSlug(iso) + '.pdf';
  const lowerFirst = s => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  /* Adresses de photo acceptées : https (stockage du compte), blob et data (photo de la session), et le bouclage local pour le développement. Jamais un autre http. */
  const PHOTO_URL = /^(https:|blob:|data:|http:\/\/(localhost|127\.0\.0\.1)[:/])/;
  const stepName = st => (st.kind === 'treatment' ? st.activeLabel : { cleanse: 'Nettoyant doux', moisturize: 'Hydratant', spf: 'Protection solaire' }[st.kind]);

  /* Modèle du document : uniquement des textes et des scores AFFICHÉS, déjà produits par le moteur. ctx : { eng, s, H, catalog }.
     H : analyse plus ancienne que la dernière : seules les priorités enregistrées à sa date sont montrées (comme l'écran), jamais recalculées. */
  function modelOf(ctx) {
    const { eng, s, H, catalog } = ctx, M = SM(), E = EN(), S = E.copy.SYNTH, Y = eng.synthesis, r = M.toResultView(s.normalized), DEC = E.decisionData;
    const indicators = M.METRIC_KEYS.map(k => {
      const i = eng.interpretation.indicators.find(x => x.id === k), st = Y.indicators[k];
      const level = i.score === null ? TEXT.unavailable : DEC.isInformative(k) ? TEXT.info : (!H && st ? st.level : i.uiBandLabel) || '';
      return { id: k, label: i.label, score: i.score, level };
    });
    const priorities = H ? s.rec.priorities.map(p => ({ label: p.label, score: p.score, level: TEXT.kept, reason: '' }))
      : eng.priorityItems.map(p => ({ label: p.label, score: p.score, level: S.LEVELS[p.band === 'low' ? 'priority' : 'support'], reason: p.reason }));
    const stepOf = st => {
      const m = eng.productMatches.find(x => x.stepId === st.id), p = m && E.products.byId(m.productId, catalog);
      const product = p ? (p.demo ? 'Exemple (démonstration) : ' : 'Proposé par DERMAI : ') + p.name : '';
      return { label: E.copy.STEP_LABELS[st.origin === 'accompaniment' ? 'accompaniment' : st.kind], name: stepName(st), detail: [Y.steps[st.id] || st.reason, product].filter(Boolean).join(' ') };
    };
    return {
      date: dateLabel(s.analyzedAt), H: !!H, slug: filename(s.analyzedAt),
      global: r.global, skin: r.skinType, age: r.skinAge, indicators, priorities,
      maintenance: priorities.length ? null : E.copy.MAINTENANCE.title + ' ' + E.copy.MAINTENANCE.text,
      accompaniment: H ? '' : Y.sections.accompaniment, strategy: H ? '' : Y.strategy.text,
      goals: H ? s.rec.goals.map(id => E.copy.GOAL_LABELS[id]) : Y.goals.items.map(g => g.text),
      routine: H ? null : { summary: eng.routinePlan.summary, morning: eng.routinePlan.slots.morning.map(stepOf), evening: eng.routinePlan.slots.evening.map(stepOf) },
      scoreNote: S.scoreNote
    };
  }

  /* Résumé court, pour le partage en texte : scores et axes affichés, aucune photo, aucune donnée brute. */
  function summaryOf(m) {
    const parts = ['Mon analyse DERMAI' + (m.date ? ' du ' + m.date : '') + (m.global.score === null ? '.' : ' : score global ' + m.global.score + '/100' + (m.global.bandLabel ? ' (' + m.global.bandLabel + ').' : '.'))];
    if (m.skin) parts.push(m.skin.label + '.');
    if (m.priorities.length) parts.push((m.H ? 'Axes retenus : ' : 'Axes de soin : ') + m.priorities.map(p => lowerFirst(p.label) + (p.score === null ? '' : ' (' + p.score + ')')).join(', ') + '.');
    parts.push(TEXT.footer);
    return parts.join(' ');
  }

  /* Blocs de mise en page (js/export-pdf.js). */
  function blocksOf(m, photo) {
    const B = [{ t: 'title', sub: TEXT.subtitle, date: 'Analyse du ' + m.date + (m.H ? ' · analyse précédente' : '') }];
    const hero = [{ text: 'Score global', size: 10, bold: false, color: [0.43, 0.38, 0.4] }];
    if (m.global.score === null) hero.push({ text: 'Score global indisponible', size: 16, bold: true, color: [0.35, 0.17, 0.23] });
    else hero.push({ text: m.global.score + '/100', size: 34, bold: true, color: [0.35, 0.17, 0.23] }, { text: m.global.bandLabel || '', size: 12, bold: true });
    if (m.skin) hero.push({ text: m.skin.label + ' · ' + m.skin.description, size: 10, bold: false });
    if (m.age !== null) hero.push({ text: 'Âge cutané estimé : ' + m.age + ' ans. Estimation cosmétique, ce n\'est pas un âge biologique.', size: 9, bold: false, color: [0.43, 0.38, 0.4] });
    B.push({ t: 'hero', lines: hero, image: photo || null });
    B.push({ t: 'heading', text: 'Vos indicateurs' });
    for (const i of m.indicators) B.push({ t: 'bar', label: i.label, score: i.score, tag: i.level });
    B.push({ t: 'heading', text: m.H ? 'Axes retenus à cette date' : 'Vos axes de soin' });
    if (m.priorities.length) B.push({ t: 'list', items: m.priorities.map(p => p.label + (p.score === null ? '' : ' (' + p.score + '/100)') + ' : ' + p.level + '.' + (p.reason ? ' ' + p.reason : '')) });
    else B.push({ t: 'para', text: m.maintenance });
    if (m.accompaniment) B.push({ t: 'heading', text: 'Accompagnement léger' }, { t: 'para', text: m.accompaniment });
    if (m.strategy) B.push({ t: 'heading', text: 'Votre stratégie' }, { t: 'para', text: m.strategy });
    if (m.goals.length) B.push({ t: 'heading', text: 'Vos objectifs' }, { t: 'list', items: m.goals });
    if (m.routine) {
      B.push({ t: 'heading', text: 'Votre routine' }, { t: 'para', text: m.routine.summary });
      for (const [title, list] of [['Matin', m.routine.morning], ['Soir', m.routine.evening]]) {
        B.push({ t: 'para', text: title, bold: true, size: 11 });
        for (const st of list) B.push({ t: 'step', label: st.label, name: st.name, detail: st.detail });
      }
    } else B.push({ t: 'note', text: TEXT.earlier });
    B.push({ t: 'space', h: 6 }, { t: 'note', text: m.scoreNote }, { t: 'note', text: TEXT.disclaimer });
    return B;
  }

  /* Photo : un Blob (photo de la session) ou l'adresse signée de la photo gardée dans le compte (celle qui s'affiche déjà à l'écran : une simple lecture,
     rien n'est envoyé). Repassée par un canvas (orientation appliquée, EXIF et GPS supprimés), réduite, en JPEG. null si impossible. */
  async function photoOf(src, env) {
    if (!src) return null;
    try {
      let blob = src;
      if (typeof src === 'string') {
        if (!env.fetch || !PHOTO_URL.test(src)) return null;
        const res = await env.fetch(src, { credentials: 'omit' });
        if (!res.ok) return null;
        blob = await res.blob();
      }
      const bmp = await env.createImageBitmap(blob), k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const c = env.doc.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const out = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
      if (!out) return null;
      const bytes = new Uint8Array(await out.arrayBuffer()), info = PDF().jpegInfo(bytes);
      return info ? { bytes, width: info.width, height: info.height } : null;
    } catch (e) { return null; }
  }

  const defaults = () => ({ doc: typeof document !== 'undefined' ? document : null, nav: typeof navigator !== 'undefined' ? navigator : null,
    URL: G.URL, Blob: G.Blob, File: G.File, createImageBitmap: G.createImageBitmap ? G.createImageBitmap.bind(G) : null, fetch: G.fetch ? G.fetch.bind(G) : null, setTimeout: G.setTimeout.bind(G), now: () => new Date() });

  async function makePdf(ctx, opts, env) {
    const m = modelOf(ctx), photo = opts && opts.photo && (ctx.blob || ctx.photoUrl) ? await photoOf(ctx.blob || ctx.photoUrl, env) : null;
    const bytes = PDF().build({ title: 'Résultat de votre analyse DERMAI', footer: TEXT.footer, date: env.now(), blocks: blocksOf(m, photo) });
    return { blob: new env.Blob([bytes], { type: 'application/pdf' }), name: m.slug, model: m, withPhoto: !!photo };
  }

  function save(blob, name, env) {
    const url = env.URL.createObjectURL(blob), a = env.doc.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; env.doc.body.appendChild(a); a.click(); a.remove();
    env.setTimeout(() => env.URL.revokeObjectURL(url), 60000);
  }

  /* kind : 'download' ou 'share'. Renvoie { ok, message }. Une annulation du partage par l'utilisatrice n'est pas une erreur (message vide). */
  /* Copie du résumé (texte court : scores affichés et axes, plus l'adresse du site). Presse-papiers moderne, sinon l'ancienne copie par sélection ; aucun PDF n'est créé. */
  async function copyText(text, env) {
    const nav = env.nav || {};
    try { if (nav.clipboard && nav.clipboard.writeText) { await nav.clipboard.writeText(text); return true; } } catch (e) { /* repli ci-dessous */ }
    try {
      const d = env.doc, ta = d.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      d.body.appendChild(ta); ta.select();
      const ok = !!d.execCommand('copy'); ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  async function perform(kind, ctx, opts, env) {
    env = Object.assign(defaults(), env || {});
    if (kind === 'copy') {
      let text;
      try { text = summaryOf(modelOf(ctx)) + (env.doc && env.doc.location ? '\n' + env.doc.location.origin : ''); } catch (e) { return { ok: false, message: TEXT.copyFailed, via: 'error' }; }
      return (await copyText(text, env)) ? { ok: true, message: TEXT.copied, via: 'copy', withPhoto: false } : { ok: false, message: TEXT.copyFailed, via: 'error' };
    }
    let pdf;
    try { pdf = await makePdf(ctx, opts, env); } catch (e) { return { ok: false, message: TEXT.failed }; }
    if (kind === 'download') { try { save(pdf.blob, pdf.name, env); } catch (e) { return { ok: false, message: TEXT.failed }; } return { ok: true, message: opts && opts.photo && !pdf.withPhoto ? TEXT.downloadedNoPhoto : TEXT.downloaded, withPhoto: pdf.withPhoto }; }
    const nav = env.nav || {}, text = summaryOf(pdf.model), url = env.doc && env.doc.location ? env.doc.location.origin : undefined;
    try {
      if (nav.share && nav.canShare && env.File) {
        const file = new env.File([pdf.blob], pdf.name, { type: 'application/pdf' });
        if (nav.canShare({ files: [file] })) { await nav.share({ files: [file], title: 'Mon analyse DERMAI', text }); return { ok: true, message: opts && opts.photo && !pdf.withPhoto ? TEXT.sharedNoPhoto : '', via: 'file', withPhoto: pdf.withPhoto }; }
      }
      if (nav.share) { await nav.share({ title: 'Mon analyse DERMAI', text, url }); return { ok: true, message: '', via: 'text', withPhoto: false }; }
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: true, message: '', via: 'cancelled', withPhoto: false };
      return { ok: false, message: TEXT.shareFailed, via: 'error' };
    }
    try { if (nav.clipboard && nav.clipboard.writeText) { await nav.clipboard.writeText(text + (url ? '\n' + url : '')); return { ok: true, message: TEXT.copied, via: 'clipboard', withPhoto: false }; } } catch (e) { /* repli ci-dessous */ }
    try { save(pdf.blob, pdf.name, env); return { ok: true, message: TEXT.sharedFallback, via: 'download', withPhoto: pdf.withPhoto }; } catch (e) { return { ok: false, message: TEXT.failed, via: 'error' }; }
  }

  /* Écran : une carte sur le résultat. L'analyse affichée est mémorisée au moment du rendu ; les clics la relisent. */
  let current = null, busy = false;
  function card(eng, s, opts) {
    const o = opts || {};
    if (o.demo || !eng || !s) { current = null; return ''; }
    current = { eng, s, H: !!o.H, catalog: o.catalog, blob: s.blob || null, photoUrl: typeof s.photo === 'string' && PHOTO_URL.test(s.photo) ? s.photo : null };
    const kind = TEXT.titles[o.kind] ? o.kind : 'result';
    return `<section class="c-card c-export${kind === 'result' ? '' : ' c-export--page'}" aria-labelledby="ex-title"><p class="kicker">Exporter</p><div class="hd"><h2 class="h3" id="ex-title">${TEXT.titles[kind]}</h2></div>
     <p class="muted">${kind === 'result' ? TEXT.intro : TEXT.introDoc}</p>
     ${current.blob || current.photoUrl ? `<label class="c-export__opt"><input type="checkbox" data-export-photo><span>${TEXT.photo}<small>${TEXT.photoNote}</small></span></label>` : ''}
     <div class="stack"><button class="c-btn c-btn--primary c-btn--block" data-export="download">${TEXT.download}</button><button class="c-btn c-btn--secondary c-btn--block" data-export="share">${TEXT.share}</button><button class="c-btn c-btn--ghost c-btn--block" data-export="copy">${TEXT.copy}</button></div>
     <p class="muted c-export__status" data-export-status role="status" aria-live="polite"></p></section>`;
  }

  async function onClick(e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-export]') : null;
    if (!b || !current || busy) return;
    busy = true; b.setAttribute('aria-busy', 'true');
    const box = document.querySelector('[data-export-photo]'), status = document.querySelector('[data-export-status]');
    try {
      const r = await perform(b.dataset.export, current, { photo: !!(box && box.checked) });
      if (status) status.textContent = r.message;
    } finally { busy = false; b.removeAttribute('aria-busy'); }
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', onClick);

  root.DermaiExport = { card, modelOf, blocksOf, summaryOf, perform, makePdf, photoOf, copyText, filename, TEXT };
})(typeof self !== 'undefined' ? self : this);
