/* DermAI : « Simuler une amélioration » (aperçu cosmétique avant/après). Chargé avant app.js.
   C'est une ILLUSTRATION générée par ordinateur, pas une prédiction, pas une promesse de résultat, pas un résultat médical : l'écran le dit.

   Ce module parle à /api/skin-simulation (jamais à Perfect Corp, jamais à /api/skin-analysis) et ne lance JAMAIS d'analyse.
   - Disponibilité : une requête GET légère demande au serveur si la simulation est ouverte POUR CE COMPTE (verrou + liste d'utilisateurs autorisés).
     Sinon, aucun bouton n'apparaît. Aucune consommation.
   - Photo : celle de l'analyse en cours si elle est encore en mémoire, sinon celle que l'utilisatrice a choisi de garder dans son compte,
     sinon on lui demande de choisir une photo de face (et on lui explique pourquoi). Rien n'est stocké ici.
   - Une ou plusieurs zones (case « Sélectionner plusieurs zones ») : une seule demande, une seule image, une seule simulation comptée.
   Une seule demande à la fois, déclenchée par un clic explicite. Une demande sans réponse (réseau coupé, délai) laisse une trace dans
     sessionStorage : avant d'en relancer une, l'écran prévient que la précédente a peut-être été comptée.
   - L'image simulée reste en mémoire de la page (jamais dans localStorage, ni dans l'URL, ni envoyée ailleurs). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiSimulation = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  /* Même liste blanche que server/config.js (SIM_CONCERNS) : un test vérifie l'égalité. */
  const CONCERNS = [
    ['wrinkle', 'Rides'], ['radiance', 'Radiance'], ['acne', 'Acné'], ['eye_bags', 'Poches'], ['dark_circle', 'Cernes'],
    ['spots', 'Taches'], ['pores', 'Pores'], ['texture', 'Texture'], ['redness', 'Rougeurs']
  ];
  const MSG = {
    sessionExpired: 'Votre session a expiré. Reconnectez-vous pour utiliser la simulation.',
    network: 'Connexion impossible. Vérifiez votre réseau.',
    unsure: 'Nous n\'avons pas reçu de réponse. Cette simulation a peut-être été comptée dans votre quota.',
    generic: 'La simulation n\'a pas pu être terminée.',
    badImage: 'L\'image reçue n\'est pas utilisable. Cette simulation a peut-être été comptée dans votre quota.',
    imageLoad: 'L\'image simulée n\'a pas pu être chargée. Cette simulation est comptée dans votre quota.',
    gone: 'La photo de cette analyse n\'est plus disponible dans DermAI.',
    format: 'Format non pris en charge. Choisissez une photo JPEG ou PNG.',
    tooBig: 'Cette photo est trop lourde (10 Mo au maximum). Choisissez-en une plus légère.'
  };
  const MAX_FILE = 10 * 1024 * 1024;
  /* Préréglage « Peau ultra lisse » : acné, taches, pores et texture ensemble (une seule demande). Quatre zones exactement : le fournisseur compte 4 unités pour 1 à 4 zones
     et 6 pour 5 à 10 (docs.perfectcorp.com), donc le préréglage ne coûte pas plus qu'une zone seule. Les rougeurs n'y sont pas (mesure peu fiable sur peau foncée). */
  const SMOOTH = ['acne', 'spots', 'pores', 'texture'];
  const PENDING = 'dermai.sim.pending.';
  const TIMEOUT_MS = 65000;
  const DATA_IMG = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  /* Image simulée : l'URL https temporaire du fournisseur (cas normal), ou une image data: (jamais d'autre schéma). Rien n'est exécuté : c'est une balise <img>. */
  const okImage = u => {
    if (typeof u !== 'string') return false;
    if (DATA_IMG.test(u)) return u.length < 5 * 1024 * 1024;
    if (u.length > 4096) return false;
    try {
      const p = new URL(u), h = p.hostname.toLowerCase();
      return p.protocol === 'https:' && !p.username && !p.password && !p.port && h.includes('.') && !h.endsWith('.local') && !h.endsWith('.internal') && !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.includes(':');
    } catch (e) { return false; }
  };
  const isJpeg = u8 => u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;

  /* deps : token() → Promise<jeton|null> · userId() · epoch() → numéro de session · render() · go(route) · ic(nom) · esc(texte)
     toJpeg(file) → Promise<Blob> (réduction JPEG faite par l'application) · fetchImpl · session() → sessionStorage ou null */
  function create(deps) {
    const d = deps || {};
    const esc = d.esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const ic = d.ic || (() => '');
    const doFetch = (...a) => (d.fetchImpl || root.fetch).apply(root, a);
    const uid = () => { try { return (d.userId && d.userId()) || null; } catch (e) { return null; } };
    const epoch = () => { try { return d.epoch ? d.epoch() : 0; } catch (e) { return 0; } };
    const redraw = () => { try { if (d.render) d.render(); } catch (e) { /* sans importance */ } };
    const store = () => { try { return d.session ? d.session() : root.sessionStorage; } catch (e) { return null; } };
    const fresh = () => ({ who: undefined, avail: 'unknown', scanKey: null, concern: null, status: 'idle', error: '', unsure: false, acked: false, photo: null, photoBusy: false, needPhoto: false, beforeUrl: '', image: '', pos: 50, multi: false, concerns: [], shown: [], photoUrl: '', autoUrl: '' });
    let ui = fresh();

    const marker = {
      get() { try { const s = store(); return !!(s && uid() && s.getItem(PENDING + uid())); } catch (e) { return false; } },
      set() { try { const s = store(); if (s && uid()) s.setItem(PENDING + uid(), String(Date.now())); } catch (e) { /* sans importance */ } },
      clear() { try { const s = store(); if (s && uid()) s.removeItem(PENDING + uid()); } catch (e) { /* sans importance */ } }
    };
    /* Aperçus de la photo (photo choisie, ou photo de l'analyse en mémoire) : adresses locales libérées dès qu'elles ne servent plus. */
    const revokePhoto = () => { for (const k of ['photoUrl', 'autoUrl']) { if (ui[k]) { try { URL.revokeObjectURL(ui[k]); } catch (e) { /* sans importance */ } } ui[k] = ''; } };
    const revoke = () => { if (ui.beforeUrl) { try { URL.revokeObjectURL(ui.beforeUrl); } catch (e) { /* sans importance */ } } ui.beforeUrl = ''; };
    /* Un autre compte (ou une déconnexion) : rien ne se transmet d'un compte à l'autre. */
    function sync() {
      const w = uid() || 'none';
      if (ui.who !== w) { revoke(); revokePhoto(); ui = fresh(); ui.who = w; }
    }
    const keyOf = s => (s && s.rec && s.rec.id) || (s && s.id) || 'cur';
    function forScan(s) {
      sync();
      if (ui.scanKey !== keyOf(s)) {
        if (ui.status === 'running' || ui.status === 'fetching') return;       // une demande est en cours : on ne change rien sous ses pieds
        revoke(); revokePhoto();
        Object.assign(ui, { scanKey: keyOf(s), concern: null, concerns: [], shown: [], multi: false, status: 'idle', error: '', photo: null, needPhoto: false, image: '', pos: 50, unsure: false, acked: false });
      }
    }

    /* Disponibilité pour CE compte : GET sans effet (ni fournisseur, ni quota). */
    async function probe() {
      sync();
      if (ui.avail !== 'unknown' || !uid()) return;
      ui.avail = 'checking';
      const ep = epoch(), who = ui.who;
      let ok = false;
      try {
        const token = d.token ? await d.token() : null;
        if (token) {
          const r = await doFetch('/api/skin-simulation', { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
          const j = r && r.ok ? await r.json() : null;
          ok = !!(j && j.ok === true && j.available === true);
        }
      } catch (e) { ok = false; }
      if (ep !== epoch() || who !== ui.who) return;
      ui.avail = ok ? 'yes' : 'no';
      if (ok) redraw();
    }

    /* Bloc affiché dans l'analyse : seulement si la simulation est ouverte pour ce compte. */
    function entry(scan) {
      sync();
      if (!scan || !scan.real || !uid()) return '';
      if (ui.avail === 'unknown') probe();
      if (ui.avail !== 'yes') return '';
      return `<section><p class="kicker">Illustration</p><div class="hd"><h2 class="h3">Simulation cosmétique</h2></div>
        <p class="muted" style="margin-bottom:14px">Un aperçu visuel, à titre d'illustration, sur la ou les zones de votre choix. Ce n'est pas une prédiction de résultat.</p>
        <button class="c-btn c-btn--secondary c-btn--block" data-sim="open">Simuler une amélioration</button></section>`;
    }

    const blobOf = scan => {
      if (ui.photo) return ui.photo;
      return scan && scan.blob instanceof Blob && scan.blob.size ? scan.blob : null;
    };
    const urlOf = scan => (scan && typeof scan.photo === 'string' && /^https:\/\//.test(scan.photo) ? scan.photo : '');

    /* Photo de l'analyse encore en mémoire : une adresse locale par analyse, pour l'aperçu seulement. */
    function autoUrl(scan) {
      if (ui.photo || !(scan && scan.blob instanceof Blob && scan.blob.size)) return '';
      if (!ui.autoUrl) { try { ui.autoUrl = URL.createObjectURL(scan.blob); } catch (e) { ui.autoUrl = ''; } }
      return ui.autoUrl;
    }

    function page(scan) {
      forScan(scan);
      if (ui.avail !== 'yes') {
        return `<div class="pagehead"><h1>Simulation cosmétique</h1><p>La simulation n'est pas disponible pour votre compte pour le moment.</p></div>
          <button class="c-btn c-btn--secondary c-btn--block" data-sim="back">Retour à mon analyse</button>`;
      }
      const busy = ui.status === 'fetching' || ui.status === 'running';
      const hasPhoto = !!blobOf(scan) || !!urlOf(scan);
      const mustAsk = ui.needPhoto || !hasPhoto;
      const pending = marker.get() && !busy && ui.status !== 'done';
      const chips = CONCERNS.map(([k, l]) => `<button class="c-chip" data-sim="pick" data-c="${k}" aria-pressed="${ui.concerns.includes(k)}"${busy ? ' disabled' : ''}>${esc(l)}</button>`).join('');
      const smoothBtn = `<button type="button" class="c-btn c-btn--secondary c-btn--block" data-sim="preset" data-p="smooth"${busy ? ' disabled' : ''}>Peau ultra lisse</button><p class="muted" style="margin:6px 0 14px">Choisit d'un geste Acné, Taches, Pores et Texture, pour un rendu le plus lisse possible. Une seule simulation.</p>`;
      const multiBox = `<label class="c-checkrow"><input type="checkbox" data-sim="multi"${ui.multi ? ' checked' : ''}${busy ? ' disabled' : ''}><span>Sélectionner plusieurs zones</span></label>`;
      const shownUrl = ui.photoUrl || autoUrl(scan) || urlOf(scan);
      const off = busy || ui.photoBusy ? ' disabled' : '';
      const preview = shownUrl
        ? `<div class="c-ms-preview"><img src="${esc(shownUrl)}" alt="Votre photo, prête pour la simulation"></div>`
        : `<div class="c-ms-empty"><p class="muted">${ui.photoBusy ? 'Préparation de la photo…' : 'Aucune photo choisie.'}</p></div>`;
      const askPhoto = mustAsk ? `<div class="c-notice u-my-5">${ic('info')}<div><span class="c-notice__title">Une photo est nécessaire</span>${esc(MSG.gone)} La simulation modifie une photo de votre visage. DermAI ne garde pas la photo de vos analyses, sauf si vous l'avez choisi : vous devez donc en choisir une de face, bien éclairée. Elle sert uniquement à créer l'image simulée. Aucune nouvelle analyse n'est lancée.</div></div>`
        : ui.photo ? `<div class="c-notice u-my-5">${ic('check')}<div><span class="c-notice__title">Photo prête</span>Cette photo servira uniquement à la simulation. Aucune analyse n'est lancée.</div></div>` : '';
      const hasScanPhoto = !!(scan && ((scan.blob instanceof Blob && scan.blob.size) || urlOf(scan)));
      const photoSection = `<section class="c-ms-photo"><div class="hd"><h2 class="h3">1. Votre photo</h2></div>
        <ul class="c-ms-tips"><li>Visage de face, regard vers l'appareil.</li><li>Bien éclairé, avec une lumière douce.</li><li>Visage entièrement visible : cheveux, mains et lunettes écartés.</li><li>Assez proche : le visage doit remplir une bonne partie de la photo.</li></ul>
        ${preview}${askPhoto}
        <div class="stack" style="gap:8px"><button type="button" class="c-btn c-btn--secondary c-btn--block" data-sim="pick-file"${off}>${shownUrl ? 'Remplacer la photo' : 'Choisir une photo'}</button>
        <button type="button" class="c-btn c-btn--ghost c-btn--block" data-sim="pick-selfie"${off}>Prendre un selfie</button>
        ${ui.photo ? `<button type="button" class="link" data-sim="photo-remove"${off}>${hasScanPhoto ? 'Utiliser la photo de mon analyse' : 'Retirer la photo'}</button>` : ''}</div>
        <p class="muted">JPEG ou PNG, moins de 10 Mo. La photo est réduite sur votre appareil.</p>
        <input type="file" id="sim-file" data-sim="file" accept="image/jpeg,image/png" aria-label="Choisir une photo de face" hidden><input type="file" id="sim-selfie" data-sim="selfie" accept="image/jpeg,image/png" capture="user" aria-label="Prendre un selfie" hidden></section>`;
      const notice = ui.error ? `<div class="c-notice c-notice--error u-my-5" role="alert">${ic('info')}<div><span class="c-notice__title">${ui.unsure ? 'Réponse non reçue' : 'Simulation impossible'}</span>${esc(ui.error)}</div></div>` : '';
      const ack = pending && !ui.acked ? `<div class="c-notice u-my-5" role="status">${ic('info')}<div><span class="c-notice__title">Une simulation précédente est restée sans réponse</span>Elle a peut-être été comptée dans votre quota. Relancer en consomme une autre.
          <div style="margin-top:10px"><button class="c-btn c-btn--secondary" data-sim="ack">Je comprends, continuer</button></div></div></div>` : '';
      const disclaimer = `<div class="c-notice u-my-5">${ic('info')}<div><span class="c-notice__title">Une illustration, pas une prédiction</span>Cette image est générée par ordinateur sur les zones choisies. Elle ne prédit pas l'effet de vos soins, ne promet aucun résultat et n'a aucune valeur médicale. Vos vrais résultats dépendent de nombreux facteurs.</div></div>`;
      const ready = ui.concerns.length > 0 && !busy && !mustAsk && (!pending || ui.acked);
      const result = ui.status === 'done' && ui.image ? beforeAfter(scan) : '';
      return `<div class="pagehead"><p class="kicker">Illustration</p><h1>Simulation cosmétique</h1><p>Choisissez une zone, ou plusieurs : DermAI génère une image illustrative de ces zones améliorées, à comparer avec votre photo.</p></div>
        ${disclaimer}
        ${photoSection}
        <section><div class="hd"><h2 class="h3">${ui.multi ? '2. Quelles zones ?' : '2. Quelle zone ?'}</h2></div>${smoothBtn}${multiBox}<div class="chips" style="margin-bottom:14px">${chips}</div></section>
        ${ack}${notice}
        <p class="muted" style="margin-bottom:12px">Chaque simulation compte dans votre quota de simulations, même si elle échoue, et reste indépendante de vos analyses. Plusieurs zones choisies ensemble donnent une seule image et comptent pour une seule simulation. L'image simulée n'est pas conservée par DermAI.</p>
        <button class="c-btn c-btn--primary c-btn--block" data-sim="run"${ready ? '' : ' disabled'} aria-busy="${busy}">${ui.status === 'fetching' ? 'Préparation de la photo…' : ui.status === 'running' ? 'Simulation en cours…' : 'Lancer la simulation'}</button>
        ${result}
        <div class="stack" style="margin-top:16px"><button class="link" data-sim="back">Retour à mon analyse</button></div>`;
    }

    /* Curseur : tout à GAUCHE = photo d'origine (Avant), tout à DROITE = image simulée (Après). L'image simulée se découvre depuis le bord droit : elle est toujours
       à droite, la photo d'origine toujours à gauche, comme les deux étiquettes. `pos` = part de l'image visible qui est simulée (0 à 100). */
    const clipOf = p => 'inset(0 0 0 ' + (100 - p) + '%)';
    function beforeAfter() {
      const label = ui.shown.map(k => (CONCERNS.find(c => c[0] === k) || [, ''])[1]).filter(Boolean).join(', ');
      const tag = side => `position:absolute;top:10px;${side}:10px;font-size:13px;font-weight:600;padding:4px 10px;line-height:1.3;border-radius:99px;background:var(--ink);color:var(--bg)`;
      return `<section style="margin-top:22px"><div class="hd"><h2 class="h3">Avant / après simulation${label ? ' : ' + esc(label) : ''}</h2></div>
        <div style="position:relative;overflow:hidden;border-radius:20px;border:1px solid var(--line);background:var(--surface);line-height:0" data-sim="frame">
          <img src="${esc(ui.beforeUrl)}" alt="Votre photo d'origine" style="width:100%;display:block">
          <img src="${esc(ui.image)}" alt="Image simulée, illustrative" data-sim="after" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:${clipOf(ui.pos)}">
          <span style="${tag('left')}">Avant</span>
          <span style="${tag('right')}">Après (simulation)</span>
        </div>
        <input type="range" min="0" max="100" value="${ui.pos}" data-sim="range" aria-label="Comparer avant et après : à gauche la photo d'origine, à droite l'image simulée" style="width:100%;margin-top:12px">
        <div class="c-sim-ends" aria-hidden="true"><span>Avant</span><span>Après</span></div>
        <p class="c-disclaimer">Simulation cosmétique générée par ordinateur, à titre d'illustration seulement. Elle ne prédit pas l'effet d'un produit ou d'une routine et ne constitue ni une promesse de résultat ni un avis médical.</p></section>`;
    }

    /* Photo d'une analyse gardée dans le compte : lien temporaire de Supabase. Tout doute (réseau, type, taille) = on redemande une photo. */
    async function fetchKept(url) {
      try {
        const r = await doFetch(url, { method: 'GET' });
        if (!r || !r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (!buf.length || buf.length > 4 * 1024 * 1024 || !isJpeg(buf)) return null;
        return new Blob([buf], { type: 'image/jpeg' });
      } catch (e) { return null; }
    }

    async function run(scan) {
      if (ui.status === 'fetching' || ui.status === 'running') return;          // une seule demande à la fois (contrôlé avant toute attente)
      if (!ui.concerns.length || !ui.concerns.every(k => CONCERNS.some(c => c[0] === k))) return;
      if (marker.get() && !ui.acked) { redraw(); return; }
      ui.status = 'fetching'; ui.error = ''; ui.unsure = false; ui.image = ''; redraw();
      const ep = epoch(), who = ui.who, wanted = CONCERNS.map(c => c[0]).filter(k => ui.concerns.includes(k));   // ordre de la liste, sans doublon
      const stale = () => ep !== epoch() || who !== ui.who;
      let blob = blobOf(scan);
      if (!blob && urlOf(scan)) blob = await fetchKept(urlOf(scan));
      if (stale()) return;
      if (!blob) { ui.status = 'idle'; ui.needPhoto = true; redraw(); return; }
      let token = null;
      try { token = d.token ? await d.token() : null; } catch (e) { token = null; }
      if (stale()) return;
      if (!token) { ui.status = 'idle'; ui.error = MSG.sessionExpired; redraw(); return; }
      ui.status = 'running'; marker.set(); ui.acked = false; redraw();
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
      let verdict = false, out = null, status = 0;
      try {
        const r = await doFetch('/api/skin-simulation?concern=' + wanted.map(encodeURIComponent).join(','), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: blob, signal: ctl ? ctl.signal : undefined });
        status = r.status;
        let j = null; try { j = await r.json(); } catch (e) { j = null; }
        verdict = !!(j && typeof j.ok === 'boolean');
        out = j;
      } catch (e) { verdict = false; }
      if (timer) clearTimeout(timer);
      if (stale()) return;                                                       // session changée : le résultat n'est affiché à personne
      if (verdict) marker.clear();
      if (!verdict) { ui.status = 'error'; ui.unsure = true; ui.error = MSG.unsure; redraw(); return; }
      if (out.ok === true) {
        const s = out.simulation;
        const got = s && (Array.isArray(s.concerns) ? s.concerns : [s.concern]);
        if (got && got.length === wanted.length && wanted.every(k => got.includes(k)) && okImage(s.image)) {
          revoke(); ui.beforeUrl = URL.createObjectURL(blob); ui.image = s.image; ui.shown = wanted; ui.pos = 50; ui.status = 'done';
        } else { ui.status = 'error'; ui.error = MSG.badImage; }
      } else if (status === 401) { ui.status = 'error'; ui.error = MSG.sessionExpired; }
      else { ui.status = 'error'; ui.error = typeof out.error === 'string' && out.error ? out.error : MSG.generic; }
      redraw();
    }

    async function chosen(input) {
      const f = input && input.files && input.files[0];
      if (!f || ui.photoBusy) return;
      try { input.value = ''; } catch (e) { /* le même fichier pourra être rechoisi */ }
      const ext = ((f.name || '').split('.').pop() || '').toLowerCase();
      if (!(f.type === 'image/jpeg' || f.type === 'image/png' || (!f.type && ['jpg', 'jpeg', 'png'].includes(ext)))) { ui.error = MSG.format; redraw(); return; }
      if (f.size > MAX_FILE) { ui.error = MSG.tooBig; redraw(); return; }
      ui.photoBusy = true; ui.error = ''; redraw();
      const ep = epoch(), who = ui.who;
      try {
        const blob = d.toJpeg ? await d.toJpeg(f) : null;
        if (ep !== epoch() || who !== ui.who) return;
        if (!blob) throw new Error('vide');
        revokePhoto(); ui.photo = blob; ui.photoUrl = URL.createObjectURL(blob); ui.needPhoto = false;
        if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; revoke(); }       // une autre photo : l'ancien résultat ne la concerne plus
      } catch (e) { if (ep === epoch() && who === ui.who) ui.error = (e && e.userMessage) || 'Impossible de lire cette photo. Essayez une autre image.'; }
      ui.photoBusy = false; redraw();
    }

    /* Délégation unique : aucun écouteur par élément, rien à nettoyer au réaffichage. */
    function attach(doc) {
      const cur = () => (d.scan ? d.scan() : null);
      doc.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest && ev.target.closest('[data-sim]');
        if (!el || el.disabled) return;
        const act = el.getAttribute('data-sim');
        if (act === 'open') { if (d.go) d.go('simulation'); }
        else if (act === 'back') { if (d.back) d.back(); else if (d.go) d.go('result'); }
        else if (act === 'pick') {
          if (ui.status !== 'running' && ui.status !== 'fetching') {
            const c = el.getAttribute('data-c');
            if (ui.multi) ui.concerns = ui.concerns.includes(c) ? ui.concerns.filter(k => k !== c) : ui.concerns.concat(c); else ui.concerns = [c];
            ui.concern = ui.concerns[0] || null;
            if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; ui.error = ''; revoke(); }
            redraw();
          }
        }
        else if (act === 'preset') {
          if (ui.status !== 'running' && ui.status !== 'fetching' && el.getAttribute('data-p') === 'smooth') {
            ui.multi = true; ui.concerns = SMOOTH.slice(); ui.concern = ui.concerns[0];
            if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; ui.error = ''; revoke(); }
            redraw();
          }
        }
        else if (act === 'ack') { ui.acked = true; redraw(); }
        else if (act === 'pick-file') { const f = doc.getElementById('sim-file'); if (f) f.click(); }
        else if (act === 'pick-selfie') { const f = doc.getElementById('sim-selfie'); if (f) f.click(); }
        else if (act === 'photo-remove') { if (ui.status !== 'running' && ui.status !== 'fetching') { revokePhoto(); ui.photo = null; ui.needPhoto = false; if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; revoke(); } redraw(); } }
        else if (act === 'run') run(cur());
      });
      /* Image simulée illisible (lien expiré, réseau) : message clair plutôt qu'un cadre vide. L'événement « error » ne remonte pas : écoute en capture. */
      doc.addEventListener('error', ev => {
        const el = ev.target;
        if (el && el.getAttribute && el.getAttribute('data-sim') === 'after' && ui.status === 'done') { ui.status = 'error'; ui.image = ''; ui.error = MSG.imageLoad; revoke(); redraw(); }
      }, true);
      doc.addEventListener('change', ev => {
        const el = ev.target; if (!el || !el.getAttribute) return;
        const k = el.getAttribute('data-sim');
        if (k === 'file' || k === 'selfie') chosen(el);
        else if (k === 'multi' && ui.status !== 'running' && ui.status !== 'fetching') {
          ui.multi = !!el.checked;
          if (!ui.multi && ui.concerns.length > 1) { ui.concerns = ui.concerns.slice(0, 1); ui.concern = ui.concerns[0]; if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; ui.error = ''; revoke(); } }   // une seule zone : on garde la première
          redraw();
        }
      });
      doc.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.getAttribute || el.getAttribute('data-sim') !== 'range') return;
        const p = Math.max(0, Math.min(100, Number(el.value) || 0)); ui.pos = p;
        const img = doc.querySelector('[data-sim="after"]'); if (img) img.style.clipPath = clipOf(p);
      });
    }

    /* Déconnexion / suppression de compte : on oublie tout (image, photo choisie, choix). */
    function reset() { revoke(); revokePhoto(); ui = fresh(); }
    return { entry, page, attach, reset, probe, state: () => ui, CONCERNS };
  }

  return { create, CONCERNS, MSG, PENDING, SMOOTH };
});
