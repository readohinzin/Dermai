/* DERMAI : « Simuler une amélioration » (aperçu cosmétique avant/après). Chargé avant app.js.
   C'est une ILLUSTRATION générée par ordinateur, pas une prédiction, pas une promesse de résultat, pas un résultat médical : l'écran le dit.

   Ce module parle à /api/skin-simulation (jamais à Perfect Corp, jamais à /api/skin-analysis) et ne lance JAMAIS d'analyse.
   - Disponibilité : une requête GET légère demande au serveur si la simulation est ouverte POUR CE COMPTE (verrou + liste d'utilisateurs autorisés).
     Sinon, aucun bouton n'apparaît. Aucune consommation.
   - Photo : celle de l'analyse en cours si elle est encore en mémoire, sinon celle que l'utilisatrice a choisi de garder dans son compte,
     sinon on lui demande de choisir une photo de face (et on lui explique pourquoi). Rien n'est stocké ici.
   - Une seule demande à la fois, déclenchée par un clic explicite. Une demande sans réponse (réseau coupé, délai) laisse une trace dans
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
    gone: 'La photo de cette analyse n\'est plus disponible dans DERMAI.'
  };
  const PENDING = 'dermai.sim.pending.';
  const TIMEOUT_MS = 65000;
  const DATA_IMG = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
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
    const fresh = () => ({ who: undefined, avail: 'unknown', scanKey: null, concern: null, status: 'idle', error: '', unsure: false, acked: false, photo: null, photoBusy: false, needPhoto: false, beforeUrl: '', image: '', pos: 50 });
    let ui = fresh();

    const marker = {
      get() { try { const s = store(); return !!(s && uid() && s.getItem(PENDING + uid())); } catch (e) { return false; } },
      set() { try { const s = store(); if (s && uid()) s.setItem(PENDING + uid(), String(Date.now())); } catch (e) { /* sans importance */ } },
      clear() { try { const s = store(); if (s && uid()) s.removeItem(PENDING + uid()); } catch (e) { /* sans importance */ } }
    };
    const revoke = () => { if (ui.beforeUrl) { try { URL.revokeObjectURL(ui.beforeUrl); } catch (e) { /* sans importance */ } } ui.beforeUrl = ''; };
    /* Un autre compte (ou une déconnexion) : rien ne se transmet d'un compte à l'autre. */
    function sync() {
      const w = uid() || 'none';
      if (ui.who !== w) { revoke(); ui = fresh(); ui.who = w; }
    }
    const keyOf = s => (s && s.rec && s.rec.id) || (s && s.id) || 'cur';
    function forScan(s) {
      sync();
      if (ui.scanKey !== keyOf(s)) {
        if (ui.status === 'running' || ui.status === 'fetching') return;       // une demande est en cours : on ne change rien sous ses pieds
        revoke();
        Object.assign(ui, { scanKey: keyOf(s), concern: null, status: 'idle', error: '', photo: null, needPhoto: false, image: '', pos: 50, unsure: false, acked: false });
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
        <p class="muted" style="margin-bottom:14px">Un aperçu visuel, à titre d'illustration, sur une zone de votre choix. Ce n'est pas une prédiction de résultat.</p>
        <button class="c-btn c-btn--secondary c-btn--block" data-sim="open">Simuler une amélioration</button></section>`;
    }

    const blobOf = scan => {
      if (ui.photo) return ui.photo;
      return scan && scan.blob instanceof Blob && scan.blob.size ? scan.blob : null;
    };
    const urlOf = scan => (scan && typeof scan.photo === 'string' && /^https:\/\//.test(scan.photo) ? scan.photo : '');

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
      const chips = CONCERNS.map(([k, l]) => `<button class="c-chip" data-sim="pick" data-c="${k}" aria-pressed="${ui.concern === k}"${busy ? ' disabled' : ''}>${esc(l)}</button>`).join('');
      const picker = `<div style="margin-top:10px"><input type="file" accept="image/*" data-sim="file" aria-label="Choisir une photo de face"${busy || ui.photoBusy ? ' disabled' : ''}></div>`;
      const askPhoto = mustAsk ? `<div class="c-notice u-my-5">${ic('info')}<div><span class="c-notice__title">Une photo est nécessaire</span>${esc(MSG.gone)} La simulation modifie une photo de votre visage. DERMAI ne garde pas la photo de vos analyses, sauf si vous l'avez choisi : vous devez donc en choisir une de face, bien éclairée. Elle sert uniquement à créer l'image simulée. Aucune nouvelle analyse n'est lancée.${picker}</div></div>`
        : ui.photo ? `<div class="c-notice u-my-5">${ic('check')}<div><span class="c-notice__title">Photo prête</span>Cette photo servira uniquement à la simulation. Aucune analyse n'est lancée.${picker}</div></div>` : '';
      const notice = ui.error ? `<div class="c-notice c-notice--error u-my-5" role="alert">${ic('info')}<div><span class="c-notice__title">${ui.unsure ? 'Réponse non reçue' : 'Simulation impossible'}</span>${esc(ui.error)}</div></div>` : '';
      const ack = pending && !ui.acked ? `<div class="c-notice u-my-5" role="status">${ic('info')}<div><span class="c-notice__title">Une simulation précédente est restée sans réponse</span>Elle a peut-être été comptée dans votre quota. Relancer en consomme une autre.
          <div style="margin-top:10px"><button class="c-btn c-btn--secondary" data-sim="ack">Je comprends, continuer</button></div></div></div>` : '';
      const disclaimer = `<div class="c-notice u-my-5">${ic('info')}<div><span class="c-notice__title">Une illustration, pas une prédiction</span>Cette image est générée par ordinateur sur une seule zone. Elle ne prédit pas l'effet de vos soins, ne promet aucun résultat et n'a aucune valeur médicale. Vos vrais résultats dépendent de nombreux facteurs.</div></div>`;
      const ready = !!ui.concern && !busy && !mustAsk && (!pending || ui.acked);
      const result = ui.status === 'done' && ui.image ? beforeAfter(scan) : '';
      return `<div class="pagehead"><p class="kicker">Illustration</p><h1>Simulation cosmétique</h1><p>Choisissez une zone : DERMAI génère une image illustrative de cette zone un peu améliorée, à comparer avec votre photo.</p></div>
        ${disclaimer}
        <section><div class="hd"><h2 class="h3">Quelle zone ?</h2></div><div class="chips" style="margin-bottom:14px">${chips}</div></section>
        ${askPhoto}${ack}${notice}
        <p class="muted" style="margin-bottom:12px">Chaque simulation compte dans votre quota de simulations, même si elle échoue, et reste indépendante de vos analyses. L'image simulée n'est pas conservée par DERMAI.</p>
        <button class="c-btn c-btn--primary c-btn--block" data-sim="run"${ready ? '' : ' disabled'} aria-busy="${busy}">${ui.status === 'fetching' ? 'Préparation de la photo…' : ui.status === 'running' ? 'Simulation en cours…' : 'Lancer la simulation'}</button>
        ${result}
        <div class="stack" style="margin-top:16px"><button class="link" data-sim="back">Retour à mon analyse</button></div>`;
    }

    function beforeAfter() {
      const label = (CONCERNS.find(c => c[0] === ui.concern) || [, ''])[1];
      return `<section style="margin-top:22px"><div class="hd"><h2 class="h3">Avant / après simulation${label ? ' : ' + esc(label) : ''}</h2></div>
        <div style="position:relative;overflow:hidden;border-radius:20px;border:1px solid var(--line);background:var(--surface);line-height:0" data-sim="frame">
          <img src="${esc(ui.beforeUrl)}" alt="Votre photo d'origine" style="width:100%;display:block">
          <img src="${esc(ui.image)}" alt="Image simulée, illustrative" data-sim="after" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;clip-path:inset(0 0 0 ${ui.pos}%)">
          <span style="position:absolute;top:10px;left:10px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:99px;background:var(--ink);color:var(--bg)">Avant</span>
          <span style="position:absolute;top:10px;right:10px;font-size:13px;font-weight:600;padding:4px 10px;border-radius:99px;background:var(--ink);color:var(--bg)">Simulation</span>
        </div>
        <input type="range" min="0" max="100" value="${ui.pos}" data-sim="range" aria-label="Comparer avant et simulation" style="width:100%;margin-top:12px">
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
      if (!ui.concern || !CONCERNS.some(c => c[0] === ui.concern)) return;
      if (marker.get() && !ui.acked) { redraw(); return; }
      ui.status = 'fetching'; ui.error = ''; ui.unsure = false; ui.image = ''; redraw();
      const ep = epoch(), who = ui.who, concern = ui.concern;
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
        const r = await doFetch('/api/skin-simulation?concern=' + encodeURIComponent(concern), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: blob, signal: ctl ? ctl.signal : undefined });
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
        if (s && s.concern === concern && typeof s.image === 'string' && s.image.length < 5 * 1024 * 1024 && DATA_IMG.test(s.image)) {
          revoke(); ui.beforeUrl = URL.createObjectURL(blob); ui.image = s.image; ui.pos = 50; ui.status = 'done';
        } else { ui.status = 'error'; ui.error = MSG.badImage; }
      } else if (status === 401) { ui.status = 'error'; ui.error = MSG.sessionExpired; }
      else { ui.status = 'error'; ui.error = typeof out.error === 'string' && out.error ? out.error : MSG.generic; }
      redraw();
    }

    async function chosen(input, scan) {
      const f = input && input.files && input.files[0];
      if (!f || ui.photoBusy) return;
      ui.photoBusy = true; ui.error = ''; redraw();
      const ep = epoch(), who = ui.who;
      try {
        const blob = d.toJpeg ? await d.toJpeg(f) : null;
        if (ep !== epoch() || who !== ui.who) return;
        ui.photo = blob; ui.needPhoto = false;
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
        else if (act === 'pick') { if (ui.status !== 'running' && ui.status !== 'fetching') { ui.concern = el.getAttribute('data-c'); if (ui.status === 'done' || ui.status === 'error') { ui.status = 'idle'; ui.image = ''; ui.error = ''; revoke(); } redraw(); } }
        else if (act === 'ack') { ui.acked = true; redraw(); }
        else if (act === 'run') run(cur());
      });
      doc.addEventListener('change', ev => { const el = ev.target; if (el && el.getAttribute && el.getAttribute('data-sim') === 'file') chosen(el, cur()); });
      doc.addEventListener('input', ev => {
        const el = ev.target;
        if (!el || !el.getAttribute || el.getAttribute('data-sim') !== 'range') return;
        const p = Math.max(0, Math.min(100, Number(el.value) || 0)); ui.pos = p;
        const img = doc.querySelector('[data-sim="after"]'); if (img) img.style.clipPath = 'inset(0 0 0 ' + p + '%)';
      });
    }

    /* Déconnexion / suppression de compte : on oublie tout (image, photo choisie, choix). */
    function reset() { revoke(); ui = fresh(); }
    return { entry, page, attach, reset, probe, state: () => ui, CONCERNS };
  }

  return { create, CONCERNS, MSG, PENDING };
});
