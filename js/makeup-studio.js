/* DERMAI : « Studio Beauté », essayage virtuel de maquillage (Perfect Corp AI Makeup Virtual Try-On, via /api/makeup-vto). Chargé avant app.js, après js/makeup-data.js.
   L'image obtenue est une ILLUSTRATION générée par ordinateur, pas une promesse de rendu : le rendu réel d'un produit peut différer. L'écran le dit.

   Ce module ne parle qu'à /api/makeup-vto (jamais à Perfect Corp, jamais à l'analyse ni à la simulation) et ne lance JAMAIS d'analyse.
   - Disponibilité : une requête GET légère demande au serveur si le Studio est ouvert POUR CE COMPTE (verrou + liste d'utilisateurs autorisés). Sinon, aucun écran, aucune
     entrée de menu, aucune consommation.
   - Aucune requête payante n'est déclenchée par l'ouverture de l'écran, le choix d'un look, d'une couleur, d'une texture ou d'une intensité : SEUL le bouton « Essayer ce
     maquillage » (clic explicite) envoie la photo, et il envoie TOUS les effets choisis dans une seule demande.
   - Une seule demande à la fois. Une demande sans réponse (réseau coupé, délai) laisse une trace dans sessionStorage : avant d'en relancer une, l'écran prévient que la
     précédente a peut-être été comptée.
   - Photo : choisie sur l'appareil (JPEG ou PNG, moins de 10 Mo), réduite et convertie en JPEG par le navigateur, gardée en MÉMOIRE de la page seulement. Les résultats aussi
     (liens temporaires du fournisseur, quatre au plus). Rien n'est écrit dans localStorage, ni photo, ni résultat. Seuls les FAVORIS (couleurs, textures, intensités, nom) sont
     gardés dans ce navigateur, une clé par compte (`dermai.studio.<identifiant du compte>`). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiStudio = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const Data = () => (typeof module === 'object' && module.exports ? require('./makeup-data.js') : root.DermaiMakeupData);
  const Hair = () => (typeof module === 'object' && module.exports ? require('./hair-studio.js') : root.DermaiHairStudio);
  const HairData = () => (typeof module === 'object' && module.exports ? require('./hair-data.js') : root.DermaiHairData);
  const FAV_PREFIX = 'dermai.studio.', PENDING = 'dermai.studio.pending.';
  const MAX_FAVORITES = 12, MAX_RESULTS = 4, MAX_NAME = 30, TIMEOUT_MS = 65000, MAX_FILE = 10 * 1024 * 1024;
  const MSG = {
    sessionExpired: 'Votre session a expiré. Reconnectez-vous pour utiliser le Studio Beauté.',
    network: 'Connexion impossible. Vérifiez votre réseau.',
    unsure: 'Nous n\'avons pas reçu de réponse. Cet essayage a peut-être été compté dans votre quota.',
    generic: 'L\'essayage n\'a pas pu être terminé.',
    badImage: 'L\'image reçue n\'est pas utilisable. Cet essayage a peut-être été compté dans votre quota.',
    imageLoad: 'L\'image générée n\'a pas pu être chargée : son lien est temporaire. Vous pouvez refaire un essayage, qui sera compté dans votre quota.',
    format: 'Format non pris en charge. Choisissez une photo JPEG ou PNG.',
    tooBig: 'Cette photo est trop lourde (10 Mo au maximum). Choisissez une photo plus légère.',
    unreadable: 'Impossible de lire cette photo. Essayez une autre image.',
    download: 'Le téléchargement direct n\'est pas possible ici : l\'image s\'est ouverte dans un nouvel onglet. Appuyez longuement dessus pour l\'enregistrer.'
  };
  const DATA_NOTE = 'Aperçu généré par ordinateur : le rendu réel d\'un produit peut différer (couleur, texture, tenue). Votre peau n\'est pas retouchée : DERMAI n\'applique aucun lissage et ne modifie ni vos scores ni votre analyse.';
  const okImage = u => {
    if (typeof u !== 'string' || u.length > 4096) return false;
    try {
      const p = new URL(u), h = p.hostname.toLowerCase();
      return p.protocol === 'https:' && !p.username && !p.password && !p.port && h.includes('.') && !h.endsWith('.local') && !h.endsWith('.internal') && !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.includes(':');
    } catch (e) { return false; }
  };
  const extOf = name => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

  /* deps : account() → objet du compte (user.id, accessToken()) · epoch() → numéro de session · render() · ic(nom) · esc(texte)
     toJpeg(file) → Promise<Blob> (réduction JPEG faite par l'application) · inspect(blob) → Promise<{level,title,body}|null> (contrôle de la photo sur l'appareil)
     fetchImpl · storage() → localStorage ou null · session() → sessionStorage ou null */
  function create(deps) {
    const d = deps || {}, D = Data();
    const esc = d.esc || (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c])));
    const ic = d.ic || (() => '');
    const doFetch = (...a) => (d.fetchImpl || root.fetch).apply(root, a);
    const acc = () => { try { return d.account ? d.account() : null; } catch (e) { return null; } };
    const uid = () => { const a = acc(); return a && a.user && a.user.id ? a.user.id : null; };
    const epoch = () => { try { return d.epoch ? d.epoch() : 0; } catch (e) { return 0; } };
    const redraw = () => { try { if (d.render) d.render(); } catch (e) { /* sans importance */ } };
    const local = () => { try { return d.storage ? d.storage() : root.localStorage; } catch (e) { return null; } };
    const session = () => { try { return d.session ? d.session() : root.sessionStorage; } catch (e) { return null; } };
    const doc = () => (typeof document !== 'undefined' ? document : null);

    const fresh = () => ({ who: undefined, avail: 'unknown', tone: 'medium', look: null, sel: D.fresh(), tab: 'lips', photo: null, photoUrl: '', photoBusy: false, photoNote: null, photoError: '',
      status: 'idle', error: '', unsure: false, acked: false, results: [], shown: -1, pos: 50, notice: '', favName: '', favMsg: '', favOpen: false, seq: 0, mode: '', hair: 'unknown', hairFeatures: [] });
    let ui = fresh();
    const revoke = () => { if (ui.photoUrl) { try { URL.revokeObjectURL(ui.photoUrl); } catch (e) { /* sans importance */ } } ui.photoUrl = ''; };
    /* Un autre compte (ou une déconnexion) : rien ne se transmet d'un compte à l'autre (photo, résultats, sélection). */
    function sync() { const w = uid() || 'none'; if (ui.who !== w) { revoke(); HS.reset(); ui = fresh(); ui.who = w; } }

    const marker = {
      get() { try { const s = session(); return !!(s && uid() && s.getItem(PENDING + uid())); } catch (e) { return false; } },
      set() { try { const s = session(); if (s && uid()) s.setItem(PENDING + uid(), String(Date.now())); } catch (e) { /* sans importance */ } },
      clear() { try { const s = session(); if (s && uid()) s.removeItem(PENDING + uid()); } catch (e) { /* sans importance */ } }
    };

    /* Volet capillaire (js/hair-studio.js) : mêmes photo, session et règles que le maquillage ; une seule demande à la fois, tous modules confondus. */
    const HS = Hair().create({ esc, uid, acc, epoch, who: () => ui.who, redraw, doFetch, marker, storage: local, toJpeg: d.toJpeg, shrink: d.shrink,
      photo: () => (ui.photo ? { blob: ui.photo, url: ui.photoUrl } : null), busy: () => ui.status === 'running', features: () => ui.hairFeatures });

    /* ---------- Disponibilité pour CE compte : GET sans effet (ni fournisseur, ni quota) ---------- */
    /* Deux lectures GET sans effet (ni fournisseur, ni quota) : le maquillage et le volet capillaire sont ouverts INDÉPENDAMMENT pour ce compte. */
    async function ask(url, token) {
      try {
        const r = await doFetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
        const j = r && r.ok ? await r.json() : null;
        return j && j.ok === true && j.available === true ? j : null;
      } catch (e) { return null; }
    }
    async function probe() {
      sync();
      if (ui.avail !== 'unknown' || !uid()) return;
      ui.avail = 'checking';
      const ep = epoch(), who = ui.who;
      let mk = null, hr = null;
      try {
        const a = acc(), token = a && a.accessToken ? await a.accessToken() : null;
        if (token) [mk, hr] = await Promise.all([ask('/api/makeup-vto', token), ask('/api/hair-vto', token)]);
      } catch (e) { mk = null; hr = null; }
      if (ep !== epoch() || who !== ui.who) return;
      const HD = HairData(), feats = hr && Array.isArray(hr.features) ? hr.features.filter(f => f && HD.FEATURES[f.id] && Number.isInteger(f.units) && f.units > 0 && f.units <= 10).map(f => ({ id: f.id, units: f.units, templates: f.templates === true })) : [];
      ui.avail = mk ? 'yes' : 'no'; ui.hair = feats.length ? 'yes' : 'no'; ui.hairFeatures = feats;
      if (mk || feats.length) redraw();
    }
    /* Pour le menu : l'entrée n'apparaît que si le Studio est ouvert pour ce compte. */
    function ready() { probe(); return ui.avail === 'yes' || ui.hair === 'yes'; }

    /* ---------- Favoris : paramètres seulement (jamais d'image), une clé par compte ---------- */
    function loadFavs() {
      const w = uid(); if (!w) return [];
      try {
        const s = local(), raw = s && s.getItem(FAV_PREFIX + w), j = raw ? JSON.parse(raw) : null;
        return (j && j.v === 1 && Array.isArray(j.favorites) ? j.favorites : []).map(f => (f && typeof f.id === 'string' && /^[a-z0-9_-]{2,30}$/i.test(f.id) && typeof f.name === 'string' && f.name.trim() ? { id: f.id, name: f.name.trim().slice(0, MAX_NAME), sel: D.sanitizeSelection(f.sel) } : null)).filter(f => f && D.hasMakeup(f.sel)).slice(0, MAX_FAVORITES);
      } catch (e) { return []; }
    }
    function saveFavs(list) {
      const w = uid(); if (!w) return false;
      try { const s = local(); if (!s) throw new Error('indisponible'); if (list.length) s.setItem(FAV_PREFIX + w, JSON.stringify({ v: 1, favorites: list })); else s.removeItem(FAV_PREFIX + w); return true; }
      catch (e) { return false; }
    }
    /* Suppression du compte : favoris du compte effacés (le dernier compte connu : la session est déjà fermée). */
    let lastUid = null;
    function clear() {
      const w = uid() || lastUid || ui.who;
      HS.clear(); revoke(); ui = fresh(); marker.clear();
      if (w && w !== 'none') { try { const s = local(); if (s) s.removeItem(FAV_PREFIX + w); } catch (e) { /* rien à effacer */ } }
    }

    /* ---------- Photo ---------- */
    async function chosen(input) {
      const f = input && input.files && input.files[0];
      if (!f || ui.photoBusy) return;
      ui.photoError = ''; ui.photoNote = null;
      const ext = extOf(f.name), okType = f.type === 'image/jpeg' || f.type === 'image/png' || (!f.type && ['jpg', 'jpeg', 'png'].includes(ext));
      if (!okType) { ui.photoError = MSG.format; redraw(); return; }
      if (f.size > MAX_FILE) { ui.photoError = MSG.tooBig; redraw(); return; }
      ui.photoBusy = true; redraw();
      const ep = epoch(), who = ui.who;
      try {
        const blob = d.toJpeg ? await d.toJpeg(f) : null;
        if (ep !== epoch() || who !== ui.who) return;
        if (!blob) throw new Error('vide');
        let chk = null;
        try { chk = d.inspect ? await d.inspect(blob) : null; } catch (e) { chk = null; }
        if (ep !== epoch() || who !== ui.who) return;
        if (chk && chk.level === 'block') { ui.photoError = chk.issues && chk.issues[0] && chk.issues[0].text ? chk.issues[0].text : (chk.body || MSG.unreadable); ui.photoBusy = false; redraw(); return; }
        revoke(); ui.photo = blob; ui.photoUrl = URL.createObjectURL(blob); ui.results = []; ui.shown = -1; HS.dropResults();
        ui.photoNote = chk && chk.level === 'warn' ? { title: chk.title, issues: (chk.issues || []).map(i => i.text).filter(Boolean) } : null;
      } catch (e) { if (ep === epoch() && who === ui.who) ui.photoError = (e && e.userMessage) || MSG.unreadable; }
      ui.photoBusy = false; redraw();
    }
    function removePhoto() { revoke(); ui.results = []; ui.shown = -1; HS.dropResults(); ui.photo = null; ui.photoNote = null; ui.photoError = ''; }

    /* ---------- Essayage : UNE demande, tous les effets ---------- */
    const cfgNow = () => D.toConfig(ui.sel);
    const canRun = () => !!ui.photo && D.hasMakeup(ui.sel) && ui.status !== 'running' && !HS.busy() && (!marker.get() || ui.acked);
    async function run() {
      sync();
      if (ui.status === 'running' || HS.busy()) return;                          // une seule demande à la fois, tous modules confondus (contrôlé avant toute attente)
      if (!ui.photo || !D.hasMakeup(ui.sel)) return;
      if (marker.get() && !ui.acked) { redraw(); return; }
      ui.status = 'running'; ui.error = ''; ui.unsure = false; ui.notice = ''; redraw();
      const ep = epoch(), who = ui.who, blob = ui.photo, cfg = cfgNow(), label = ui.look ? (D.LOOKS.find(l => l.id === ui.look) || {}).label : 'Personnalisé';
      const stale = () => ep !== epoch() || who !== ui.who;
      let token = null;
      try { const a = acc(); token = a && a.accessToken ? await a.accessToken() : null; } catch (e) { token = null; }
      if (stale()) return;
      if (!token) { ui.status = 'idle'; ui.error = MSG.sessionExpired; redraw(); return; }
      marker.set(); ui.acked = false;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
      let verdict = false, out = null, status = 0;
      try {
        const r = await doFetch('/api/makeup-vto?cfg=' + encodeURIComponent(JSON.stringify(cfg)), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body: blob, signal: ctl ? ctl.signal : undefined });
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
        const m = out.makeup;
        if (m && okImage(m.image)) {
          ui.seq += 1; ui.results.push({ id: ui.seq, image: m.image, label: label || 'Personnalisé', expired: false });
          if (ui.results.length > MAX_RESULTS) ui.results.shift();
          ui.shown = ui.results.length - 1; ui.pos = 50; ui.status = 'done';
        } else { ui.status = 'error'; ui.error = MSG.badImage; }
      } else if (status === 401) { ui.status = 'error'; ui.error = MSG.sessionExpired; }
      else { ui.status = 'error'; ui.error = typeof out.error === 'string' && out.error ? out.error : MSG.generic; }
      redraw();
    }

    async function download() {
      const r = ui.results[ui.shown]; if (!r) return;
      try {
        const resp = await doFetch(r.image, { method: 'GET' });
        if (!resp || !resp.ok) throw new Error('lien');
        const blob = await resp.blob(), a = doc().createElement('a'), url = URL.createObjectURL(blob);
        a.href = url; a.download = 'studio-beaute.' + (blob.type === 'image/png' ? 'png' : 'jpg'); doc().body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* sans importance */ } }, 4000);
        ui.notice = '';
      } catch (e) {
        try { root.open(r.image, '_blank', 'noopener'); } catch (e2) { /* fenêtre bloquée */ }
        ui.notice = MSG.download;
      }
      redraw();
    }

    /* ---------- Affichage ---------- */
    const note = (t, cls, role) => `<div class="c-notice${cls ? ' ' + cls : ''} u-my-5" role="${role || 'status'}"><div>${esc(t)}</div></div>`;
    const sw = (cat, p, cur) => `<button type="button" class="c-ms-swatch" data-ms="color" data-cat="${cat}" data-c="${p.color}" aria-pressed="${p.color.toLowerCase() === String(cur).toLowerCase()}" aria-label="${esc(p.label)}" title="${esc(p.label)}"><span style="background:${p.color}"></span></button>`;
    const slider = (cat, field, label, val) => `<div class="c-ms-range"><label for="ms-${cat}-${field}">${esc(label)} <output id="ms-${cat}-${field}-out">${val}</output></label><input type="range" min="0" max="100" step="1" value="${val}" id="ms-${cat}-${field}" data-ms="range" data-cat="${cat}" data-f="${field}"></div>`;

    function editor(cat) {
      const s = ui.sel[cat], label = (D.CATEGORIES.find(c => c[0] === cat) || [, cat])[1];
      const toggle = `<label class="c-check-row"><input type="checkbox" data-ms="toggle" data-cat="${cat}"${s.on ? ' checked' : ''}> Ajouter ${esc(label.toLowerCase())} à l'essayage</label>`;
      if (!s.on) return `<div class="c-ms-editor">${toggle}<p class="muted">Cette catégorie n'est pas envoyée tant qu'elle n'est pas ajoutée.</p></div>`;
      const textures = cat === 'foundation' ? '' : `<div class="c-ms-block"><p class="c-ms-label">Texture</p><div class="chips" role="group" aria-label="Texture">${D.TEXTURES[cat].map(t => `<button type="button" class="c-chip" data-ms="texture" data-cat="${cat}" data-t="${t[0]}" aria-pressed="${s.texture === t[0]}">${esc(t[1])}</button>`).join('')}</div></div>`;
      const sliders = cat === 'foundation'
        ? slider(cat, 'colorIntensity', 'Intensité de la teinte', s.colorIntensity) + slider(cat, 'glowIntensity', 'Éclat', s.glowIntensity) + slider(cat, 'coverageIntensity', 'Couvrance', s.coverageIntensity)
        : slider(cat, 'colorIntensity', 'Intensité', s.colorIntensity);
      return `<div class="c-ms-editor">${toggle}
        <div class="c-ms-block"><p class="c-ms-label">${cat === 'foundation' ? 'Nuance de fond de teint' : 'Couleur'} : <b data-ms-name="${cat}">${esc(D.colorName(cat, s.color))}</b></p>
          <div class="c-ms-swatches" role="group" aria-label="Couleurs ${esc(label.toLowerCase())}">${D.PALETTES[cat].map(p => sw(cat, p, s.color)).join('')}</div>
          <label class="c-ms-custom">Autre couleur <input type="color" data-ms="custom" data-cat="${cat}" value="${s.color}" aria-label="Choisir une autre couleur pour ${esc(label.toLowerCase())}"></label></div>
        ${textures}<div class="c-ms-block">${sliders}</div></div>`;
    }

    function resultView() {
      const r = ui.results[ui.shown];
      if (!r) return '';
      const thumbs = ui.results.length > 1 ? `<div class="chips" role="group" aria-label="Essais précédents">${ui.results.map((x, i) => `<button type="button" class="c-chip" data-ms="show" data-i="${i}" aria-pressed="${i === ui.shown}">Essai ${i + 1} : ${esc(x.label)}</button>`).join('')}</div>` : '';
      return `<section class="c-ms-result" id="ms-result"><div class="hd"><h2 class="h3">Résultat</h2></div>${thumbs}
        ${r.expired ? note(MSG.imageLoad, 'c-notice--error', 'alert') : `<div class="c-ms-compare" data-ms="frame">
          <img src="${esc(ui.photoUrl)}" alt="Votre photo d'origine">
          <img src="${esc(r.image)}" alt="Votre photo avec le maquillage essayé, image générée" data-ms="after" style="clip-path:inset(0 0 0 ${ui.pos}%)">
          <span class="c-ms-tag c-ms-tag--l">Avant</span><span class="c-ms-tag c-ms-tag--r">Avec maquillage</span></div>
        <input type="range" min="0" max="100" value="${ui.pos}" data-ms="pos" aria-label="Comparer avant et avec maquillage" class="c-ms-pos">`}
        ${ui.notice ? note(ui.notice) : ''}
        <div class="stack" style="gap:8px;margin-top:12px"><button class="c-btn c-btn--secondary c-btn--block" data-ms="download"${r.expired ? ' disabled' : ''}>Télécharger l'image</button><button class="c-btn c-btn--secondary c-btn--block" data-ms="again">Recommencer avec d'autres couleurs</button></div>
        <p class="c-disclaimer">${esc(DATA_NOTE)}</p></section>`;
    }

    function favoritesView() {
      const list = loadFavs();
      return `<details class="c-why" id="ms-favs"${ui.favOpen ? ' open' : ''}><summary>Mes favoris (${list.length})</summary>
        ${list.length ? `<ul class="c-ms-favs">${list.map(f => `<li><span>${esc(f.name)}</span><button type="button" class="c-btn c-btn--ghost c-btn--sm" data-ms="fav-use" data-id="${esc(f.id)}" aria-label="Appliquer le favori ${esc(f.name)}">Appliquer</button><button type="button" class="c-btn c-btn--ghost c-btn--sm" data-ms="fav-del" data-id="${esc(f.id)}" aria-label="Supprimer le favori ${esc(f.name)}">Supprimer</button></li>`).join('')}</ul>` : '<p class="muted">Aucun favori pour le moment.</p>'}
        <div class="c-field"><label class="c-field__label" for="ms-favname">Nom de cette combinaison</label><input class="c-input" id="ms-favname" maxlength="${MAX_NAME}" value="${esc(ui.favName)}" autocomplete="off"><p class="c-field__hint">Seuls les réglages (couleurs, textures, intensités) sont gardés, dans ce navigateur. Aucune photo ni image n'est enregistrée.</p></div>
        <button type="button" class="c-btn c-btn--secondary c-btn--block" data-ms="fav-save"${list.length >= MAX_FAVORITES ? ' disabled' : ''}>Enregistrer cette combinaison</button>
        ${ui.favMsg ? `<p class="muted" role="status">${esc(ui.favMsg)}</p>` : ''}</details>`;
    }

    function page() {
      sync();
      const head = `<div class="pagehead"><p class="kicker">${ui.hair === 'yes' ? 'Maquillage et cheveux' : 'Maquillage virtuel'}</p><h1>Studio Beauté</h1><p>Essayez des looks sur votre propre photo : choisissez vos couleurs, puis lancez un essayage. Votre peau n'est pas retouchée.</p></div>`;
      if (!uid()) return `${head}${note('Connectez-vous ou créez un compte pour utiliser le Studio Beauté.')}<div class="stack" style="gap:8px"><button class="c-btn c-btn--primary c-btn--block" data-go="signup">Créer un compte</button><button class="c-btn c-btn--secondary c-btn--block" data-go="login">Se connecter</button></div>`;
      lastUid = uid();
      probe();
      if (ui.avail === 'unknown' || ui.avail === 'checking') return `${head}<p class="muted" role="status">Vérification de votre accès…</p>`;
      if (ui.avail !== 'yes' && ui.hair !== 'yes') return `${head}${note('Le Studio Beauté n\'est pas disponible pour votre compte pour le moment.')}`;
      /* Onglets : Maquillage (si ouvert pour ce compte) puis les fonctions capillaires ouvertes ; un seul onglet = aucune barre. */
      const HD = HairData(), hairTabs = ui.hair === 'yes' ? HS.tabsFor(ui.hairFeatures.map(f => f.id)) : [];
      const modes = (ui.avail === 'yes' ? [{ id: 'makeup', label: 'Maquillage' }] : []).concat(hairTabs.map(t => ({ id: t.id, label: t.label })));
      if (!modes.some(m => m.id === ui.mode)) ui.mode = modes[0].id;
      const studioTabs = modes.length > 1 ? `<div class="chips c-ms-modes" role="group" aria-label="Espaces du Studio">${modes.map(m => `<button type="button" class="c-chip" data-ms="mode" data-v="${m.id}" aria-pressed="${ui.mode === m.id}">${esc(m.label)}</button>`).join('')}</div>` : '';
      const busy = ui.status === 'running', pending = marker.get() && !ui.acked, locked = busy || HS.busy();
      const lookChips = D.LOOKS.map(l => `<button type="button" class="c-chip" data-ms="look" data-id="${l.id}" aria-pressed="${ui.look === l.id}" title="${esc(l.about)}">${esc(l.label)}</button>`).join('');
      const toneChips = D.TONES.map(t => `<button type="button" class="c-chip" data-ms="tone" data-t="${t[0]}" aria-pressed="${ui.tone === t[0]}">${esc(t[1])}</button>`).join('');
      const tabs = D.CATEGORIES.map(c => `<button type="button" class="c-chip" data-ms="tab" data-cat="${c[0]}" aria-pressed="${ui.tab === c[0]}">${esc(c[1])}${ui.sel[c[0]].on ? ' <span aria-hidden="true">●</span><span class="sr"> (ajouté)</span>' : ''}</button>`).join('');
      const photo = ui.photoUrl
        ? `<div class="c-ms-preview"><img src="${esc(ui.photoUrl)}" alt="Votre photo, prête pour l'essayage"></div>${ui.photoNote ? note(ui.photoNote.title + (ui.photoNote.issues.length ? ' : ' + ui.photoNote.issues.join(' ') : ''), 'c-notice--warning') : note('Photo prête : elle ne sert qu\'à cet essayage et reste dans cette page.', 'c-notice--success')}`
        : `<div class="c-ms-empty"><p class="muted">${ui.photoBusy ? 'Préparation de la photo…' : 'Aucune photo choisie.'}</p></div>`;
      const sections = D.CATEGORIES.filter(c => c[0] === ui.tab).map(c => editor(c[0])).join('');
      const run = `<button class="c-btn c-btn--primary c-btn--block" data-ms="run"${canRun() && !busy ? '' : ' disabled'} aria-busy="${busy}">${busy ? 'Essayage en cours…' : 'Essayer ce maquillage'}</button>`;
      const photoSection = `
        <section class="c-ms-photo"><div class="hd"><h2 class="h3">1. Votre photo</h2></div>
          ${ui.mode === 'makeup' ? `<ul class="c-ms-tips"><li>Visage de face, regard vers l'appareil.</li><li>Bien éclairé, avec une lumière douce.</li><li>Visage entièrement visible : cheveux, mains et lunettes écartés.</li><li>Assez proche : le visage doit remplir une bonne partie de la photo.</li></ul>` : `<ul class="c-ms-tips"><li>Visage de face, regard vers l'appareil.</li><li>Bien éclairé, avec une lumière douce.</li><li>Cheveux entiers dans le cadre et épaules visibles : ni chapeau, ni foulard, ni main devant les cheveux.</li><li>Assez proche pour un visage bien visible, mais pas coupé.</li></ul>`}
          ${photo}${ui.photoError ? note(ui.photoError, 'c-notice--error', 'alert') : ''}
          <div class="stack" style="gap:8px"><button type="button" class="c-btn c-btn--secondary c-btn--block" data-ms="pick-file"${ui.photoBusy || locked ? ' disabled' : ''}>${ui.photoUrl ? 'Remplacer la photo' : 'Choisir une photo'}</button>
          <button type="button" class="c-btn c-btn--ghost c-btn--block" data-ms="pick-selfie"${ui.photoBusy || locked ? ' disabled' : ''}>Prendre un selfie</button>
          ${ui.photoUrl ? `<button type="button" class="link" data-ms="photo-remove"${locked ? ' disabled' : ''}>Retirer la photo</button>` : ''}</div>
          <p class="muted">JPEG ou PNG, moins de 10 Mo. La photo est réduite sur votre appareil.</p>
          <input type="file" id="ms-file" data-ms="file" accept="image/jpeg,image/png" hidden><input type="file" id="ms-selfie" data-ms="file" accept="image/jpeg,image/png" capture="user" hidden></section>`;
      if (ui.mode !== 'makeup') return `${head}${studioTabs}${photoSection}${HS.body(ui.mode)}`;
      return `${head}${studioTabs}${photoSection}
        <section class="c-ms-looks"><div class="hd"><h2 class="h3">2. Un look pour commencer</h2></div>
          <p class="c-ms-label">Votre carnation (pour proposer des couleurs adaptées)</p><div class="chips" role="group" aria-label="Carnation">${toneChips}</div>
          <p class="c-ms-label" style="margin-top:12px">Look</p><div class="chips" role="group" aria-label="Looks">${lookChips}</div>
          <p class="muted">${esc(ui.look ? (D.LOOKS.find(l => l.id === ui.look) || {}).about : 'Choisir un look remplit les couleurs ; vous pouvez ensuite tout modifier. Rien n\'est envoyé tant que vous n\'avez pas lancé l\'essayage.')}</p></section>
        <section class="c-ms-custom-box" id="ms-custom"><div class="hd"><h2 class="h3">3. Vos couleurs</h2></div><div class="chips" role="group" aria-label="Catégorie de maquillage">${tabs}</div>${sections}${favoritesView()}</section>
        <section class="c-ms-go"><div class="hd"><h2 class="h3">4. Essayer</h2></div>
          ${pending ? `<div class="c-notice u-my-5" role="status"><div><span class="c-notice__title">Un essayage précédent est resté sans réponse</span>Il a peut-être été compté dans votre quota. Relancer en consomme peut-être un autre.<div style="margin-top:10px"><button class="c-btn c-btn--secondary" data-ms="ack">Je comprends, continuer</button></div></div></div>` : ''}
          ${ui.error ? note(ui.error, 'c-notice--error', 'alert') : ''}
          <p class="muted" style="margin-bottom:12px">Un seul essayage regroupe tous vos choix. Changer une couleur ne lance rien. Chaque essayage compte dans votre quota d'essayages, même s'il échoue, et reste indépendant de vos analyses.</p>
          ${run}${busy ? '<p class="muted" role="status"><span class="c-spinner" aria-hidden="true"></span> Cela peut prendre une minute. Ne quittez pas la page.</p>' : ''}</section>
        ${resultView()}`;
    }

    /* ---------- Interactions ---------- */
    const catOf = el => { const c = el.getAttribute('data-cat'); return ['foundation', 'lips', 'blush', 'eyes'].includes(c) ? c : null; };
    const custom = () => { if (ui.look) { ui.look = null; const x = doc(); if (x) x.querySelectorAll('[data-ms=look]').forEach(b => b.setAttribute('aria-pressed', 'false')); } };
    function attach(x) {
      if (!x || !x.addEventListener) return;
      HS.attach(x);
      x.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-ms]') : null;
        if (!el || el.disabled || el.tagName === 'INPUT') return;
        sync();
        const a = el.getAttribute('data-ms'), cat = catOf(el);
        if (a === 'run') run();
        else if (a === 'pick-file') { const f = x.getElementById('ms-file'); if (f) f.click(); }
        else if (a === 'pick-selfie') { const f = x.getElementById('ms-selfie'); if (f) f.click(); }
        else if (a === 'photo-remove') { removePhoto(); redraw(); }
        else if (a === 'mode') { ui.mode = el.getAttribute('data-v'); redraw(); }
        else if (a === 'tone') { ui.tone = el.getAttribute('data-t'); if (ui.look) ui.sel = D.applyLook(ui.sel, ui.look, ui.tone); redraw(); }
        else if (a === 'look') { ui.look = el.getAttribute('data-id'); ui.sel = D.applyLook(ui.sel, ui.look, ui.tone); redraw(); }
        else if (a === 'tab' && cat) { ui.tab = cat; redraw(); }
        else if (a === 'color' && cat) { ui.sel[cat].color = String(el.getAttribute('data-c')).toLowerCase(); custom(); redraw(); }
        else if (a === 'texture' && cat) { ui.sel[cat].texture = el.getAttribute('data-t'); custom(); redraw(); }
        else if (a === 'show') { const i = Number(el.getAttribute('data-i')); if (i >= 0 && i < ui.results.length) { ui.shown = i; ui.pos = 50; ui.notice = ''; redraw(); } }
        else if (a === 'download') download();
        else if (a === 'again') { const t = x.getElementById('ms-custom'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' }); }
        else if (a === 'ack') { ui.acked = true; redraw(); }
        else if (a === 'fav-save') {
          const name = (x.getElementById('ms-favname') || {}).value || '', n = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME), list = loadFavs();
          if (!n) ui.favMsg = 'Donnez un nom à cette combinaison.';
          else if (!D.hasMakeup(ui.sel)) ui.favMsg = 'Ajoutez au moins un maquillage avant d\'enregistrer.';
          else if (list.length >= MAX_FAVORITES) ui.favMsg = `Vous avez déjà ${MAX_FAVORITES} favoris : supprimez-en un.`;
          else { const id = 'f' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); ui.favMsg = saveFavs(list.concat({ id, name: n, sel: JSON.parse(JSON.stringify(ui.sel)) })) ? 'Combinaison enregistrée.' : 'Ce navigateur refuse de garder vos favoris.'; ui.favName = ''; }
          redraw();
        } else if (a === 'fav-use') { const f = loadFavs().find(v => v.id === el.getAttribute('data-id')); if (f) { ui.sel = f.sel; ui.look = null; ui.favMsg = ''; } redraw(); }
        else if (a === 'fav-del') { saveFavs(loadFavs().filter(v => v.id !== el.getAttribute('data-id'))); ui.favMsg = 'Favori supprimé.'; redraw(); }
      });
      x.addEventListener('change', ev => {
        const t = ev.target; if (!t || !t.getAttribute) return;
        const a = t.getAttribute('data-ms'); if (!a) return;
        sync();
        if (a === 'file') chosen(t);
        else if (a === 'toggle') { const cat = catOf(t); if (cat) { ui.sel[cat].on = !!t.checked; custom(); redraw(); } }
        else if (a === 'custom') { const cat = catOf(t); if (cat && /^#[0-9a-fA-F]{6}$/.test(t.value)) { ui.sel[cat].color = t.value.toLowerCase(); custom(); redraw(); } }
      });
      /* Réglages en cours de glissement : on met à jour la sélection et l'affichage SANS réafficher l'écran (le curseur garde le focus) ; rien n'est envoyé. */
      x.addEventListener('input', ev => {
        const t = ev.target; if (!t || !t.getAttribute) return;
        const a = t.getAttribute('data-ms'); if (!a) { if (t.id === 'ms-favname') { sync(); ui.favName = t.value; } return; }
        sync();
        if (a === 'range') {
          const cat = catOf(t), f = t.getAttribute('data-f'), v = Math.max(0, Math.min(100, Math.round(Number(t.value) || 0)));
          if (cat && ['colorIntensity', 'glowIntensity', 'coverageIntensity'].includes(f) && ui.sel[cat] && f in ui.sel[cat]) {
            ui.sel[cat][f] = v; custom();
            const o = x.getElementById(`ms-${cat}-${f}-out`); if (o) o.textContent = String(v);
          }
        } else if (a === 'pos') {
          ui.pos = Math.max(0, Math.min(100, Number(t.value) || 0));
          const img = x.querySelector('[data-ms="after"]'); if (img) img.style.clipPath = 'inset(0 0 0 ' + ui.pos + '%)';
        } else if (a === 'custom') {
          const cat = catOf(t); if (cat && /^#[0-9a-fA-F]{6}$/.test(t.value)) {
            ui.sel[cat].color = t.value.toLowerCase(); custom();
            x.querySelectorAll(`[data-ms=color][data-cat=${cat}]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
            const n = x.querySelector(`[data-ms-name=${cat}]`); if (n) n.textContent = D.colorName(cat, t.value);
          }
        }
      });
      /* Image générée illisible (lien temporaire expiré, réseau) : message clair plutôt qu'un cadre vide. L'événement « error » ne remonte pas : écoute en capture. */
      x.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'ms-favs') ui.favOpen = !!ev.target.open; }, true);   // l'état ouvert / fermé survit à l'affichage
      x.addEventListener('error', ev => {
        const el = ev.target;
        if (el && el.getAttribute && el.getAttribute('data-ms') === 'after') { const r = ui.results[ui.shown]; if (r) { r.expired = true; redraw(); } }
      }, true);
    }

    /* Déconnexion ou changement de compte : on oublie tout (photo, résultats, sélection). */
    function reset() { revoke(); HS.reset(); ui = fresh(); }
    return { page, attach, probe, ready, clear, reset, state: () => ui, favorites: loadFavs, hair: HS };
  }

  return { create, MSG, DATA_NOTE, FAV_PREFIX, PENDING, MAX_FAVORITES, MAX_RESULTS };
});
