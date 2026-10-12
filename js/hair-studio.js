/* DERMAI : Studio Beauté, volet CAPILLAIRE (coiffure, couleur, extensions, franges, ondulations, volume, via /api/hair-vto). Chargé avant js/makeup-studio.js, qui l'intègre dans le MÊME écran
   (même photo, mêmes règles) : ce module n'a ni entrée de menu ni route propres.
   L'image obtenue est une ILLUSTRATION générée par ordinateur ; chaque écran dit la nature exacte de la transformation (une extension n'est pas une perruque, le volume n'est pas un diagnostic).

   - Rien de payant à l'ouverture d'un onglet ni au choix d'un modèle ou d'une couleur : seule la LISTE des modèles est lue (lecture seule, aucune tâche). SEUL le bouton « Essayer » (clic
     explicite) envoie la photo, pour UNE tâche. Une seule demande à la fois, tous modules confondus (maquillage compris). Aucune relance automatique : une demande sans réponse laisse
     une trace dans sessionStorage (la même que le maquillage) et la relance demande une confirmation explicite.
   - Les modèles viennent du fournisseur (jamais d'identifiant inventé). Le navigateur n'envoie jamais d'URL : la photo (réduite à 1 024 px, exigence documentée pour les extensions) et,
     pour une coiffure par photo de référence, la photo de référence à la suite, séparées par ref_at.
   - Photos et résultats : en MÉMOIRE de la page seulement. Seuls des FAVORIS de réglages (nom, couleur ou identifiant de modèle) sont gardés, une clé par compte (`dermai.studio.hair.<identifiant>`). */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiHairStudio = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const Data = () => (typeof module === 'object' && module.exports ? require('./hair-data.js') : root.DermaiHairData);
  const FAV_PREFIX = 'dermai.studio.hair.';
  const MAX_FAVORITES = 12, MAX_RESULTS = 3, MAX_NAME = 30, TIMEOUT_MS = 65000, MAX_FILE = 10 * 1024 * 1024, MAX_SIDE = 1024;
  const MSG = {
    sessionExpired: 'Votre session a expiré. Reconnectez-vous pour utiliser le Studio Beauté.',
    unsure: 'Nous n\'avons pas reçu de réponse. Cet essai a peut-être été compté dans votre quota.',
    generic: 'L\'essai n\'a pas pu être terminé.',
    badImage: 'L\'image reçue n\'est pas utilisable. Cet essai a peut-être été compté dans votre quota.',
    imageLoad: 'L\'image générée n\'a pas pu être chargée : son lien est temporaire. Vous pouvez refaire un essai, qui sera compté dans votre quota.',
    templates: 'Les modèles n\'ont pas pu être chargés.',
    format: 'Format non pris en charge. Choisissez une photo JPEG ou PNG.',
    tooBig: 'Cette photo est trop lourde (10 Mo au maximum). Choisissez une photo plus légère.',
    unreadable: 'Impossible de lire cette photo. Essayez une autre image.',
    download: 'Le téléchargement direct n\'est pas possible ici : l\'image s\'est ouverte dans un nouvel onglet. Appuyez longuement dessus pour l\'enregistrer.'
  };
  const DATA_NOTE = 'Aperçu généré par ordinateur : le rendu réel (couleur, texture, tenue) peut différer. Cet aperçu ne remplace pas l\'avis d\'un professionnel de la coiffure.';
  const okImage = u => {
    if (typeof u !== 'string' || u.length > 4096) return false;
    try {
      const p = new URL(u), h = p.hostname.toLowerCase();
      return p.protocol === 'https:' && !p.username && !p.password && !p.port && h.includes('.') && !h.endsWith('.local') && !h.endsWith('.internal') && !/^\d+\.\d+\.\d+\.\d+$/.test(h) && !h.includes(':');
    } catch (e) { return false; }
  };
  /* Libellés de catégories : seuls les deux mots anglais vus chez le fournisseur sont traduits pour l'affichage ; la valeur de filtrage reste celle du fournisseur. */
  const CAT_FR = { male: 'Homme', female: 'Femme' };
  const extOf = name => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

  /* Réduction JPEG à 1 024 px (grand côté) dans le navigateur : exigence documentée pour les extensions, appliquée à tous les essais capillaires par prudence. */
  async function shrinkJpeg(blob, max = MAX_SIDE) {
    const url = URL.createObjectURL(blob);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const w = im.naturalWidth, h = im.naturalHeight; if (!w || !h) throw new Error('vide');
      const k = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
      c.width = Math.min(max, Math.max(1, Math.round(w * k))); c.height = Math.min(max, Math.max(1, Math.round(h * k)));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      return await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('vide'))), 'image/jpeg', 0.9));
    } finally { try { URL.revokeObjectURL(url); } catch (e) { /* sans importance */ } }
  }

  /* core : { esc, uid(), acc(), epoch(), who(), redraw(), doFetch, marker:{get,set,clear}, photo() → {blob,url}|null, busy() → autre demande en cours,
              toJpeg(file), shrink(blob), storage(), features() → [{id,label,units,templates}] } */
  function create(core) {
    const D = Data(), c = core || {}, esc = c.esc || (s => String(s));
    const doc = () => (typeof document !== 'undefined' ? document : null);
    const shrink = c.shrink || shrinkJpeg;
    const local = () => { try { return c.storage ? c.storage() : root.localStorage; } catch (e) { return null; } };
    const uid = () => (c.uid ? c.uid() : null);
    let S = {}, sub = {}, running = false, shrunk = { from: null, out: null }, favOpen = false, favMsg = '', favName = '', lastUid = null;
    const st = fid => S[fid] || (S[fid] = { sel: D.fresh(fid), tpl: { status: 'idle', items: [], next: null, error: '', more: false }, cat: '', results: [], shown: -1, pos: 50, status: 'idle', error: '', unsure: false, acked: false, notice: '', seq: 0, refBlob: null, refUrl: '', refBusy: false, refError: '', label: '' });
    const revoke = () => { for (const k of Object.keys(S)) if (S[k].refUrl) { try { URL.revokeObjectURL(S[k].refUrl); } catch (e) { /* sans importance */ } } };
    function reset() { revoke(); S = {}; sub = {}; running = false; shrunk = { from: null, out: null }; favOpen = false; favMsg = ''; favName = ''; }
    const feat = fid => (c.features ? c.features() : []).find(f => f.id === fid) || null;
    const known = fid => D.FEATURES[fid];

    /* ---------- Modèles du fournisseur : lecture seule, aucune tâche ---------- */
    async function loadTemplates(fid, more) {
      const s = st(fid), t = s.tpl, f = feat(fid);
      if (!f || !f.templates || t.status === 'loading' || (!more && t.status !== 'idle' && t.status !== 'retry')) return;
      t.status = 'loading'; t.error = ''; t.more = !!more;
      const ep = c.epoch(), who = c.who();
      let ok = null;
      try {
        const a = c.acc(), token = a && a.accessToken ? await a.accessToken() : null;
        if (!token) throw new Error('session');
        const r = await c.doFetch('/api/hair-vto?templates=' + encodeURIComponent(fid) + (more && t.next ? '&next=' + encodeURIComponent(t.next) : ''), { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
        const j = await r.json().catch(() => null);
        ok = r && r.ok && j && j.ok === true && Array.isArray(j.templates) ? j : { error: j && typeof j.error === 'string' ? j.error : MSG.templates };
      } catch (e) { ok = { error: MSG.templates }; }
      if (ep !== c.epoch() || who !== c.who() || S[fid] !== s) return;
      if (ok.error) { t.status = 'error'; t.error = ok.error; }
      else {
        const seen = new Set(more ? t.items.map(x => x.id) : []), list = (more ? t.items : []).slice();
        for (const x of ok.templates) if (x && typeof x.id === 'string' && !seen.has(x.id)) { seen.add(x.id); list.push({ id: x.id, title: String(x.title || ''), category: String(x.category || ''), thumb: okImage(x.thumb) ? x.thumb : '' }); }
        t.items = list; t.next = typeof ok.next === 'string' && ok.next ? ok.next : null; t.status = 'ready';
        if (!list.some(x => x.id === s.sel.templateId)) s.sel.templateId = '';
      }
      t.more = false; c.redraw();
    }

    /* ---------- Favoris : réglages seulement ---------- */
    function loadFavs() {
      const w = uid(); if (!w) return [];
      try {
        const s = local(), raw = s && s.getItem(FAV_PREFIX + w), j = raw ? JSON.parse(raw) : null;
        return (j && j.v === 1 && Array.isArray(j.favorites) ? j.favorites : []).map(f => (f && typeof f.id === 'string' && /^[a-z0-9_-]{2,30}$/i.test(f.id) && typeof f.name === 'string' && f.name.trim() && known(f.feature) ? { id: f.id, name: f.name.trim().slice(0, MAX_NAME), feature: f.feature, sel: D.sanitizeSelection(f.feature, f.sel) } : null)).filter(f => f && D.toConfig(f.feature, f.sel)).slice(0, MAX_FAVORITES);
      } catch (e) { return []; }
    }
    function saveFavs(list) {
      const w = uid(); if (!w) return false;
      try { const s = local(); if (!s) throw new Error('indisponible'); if (list.length) s.setItem(FAV_PREFIX + w, JSON.stringify({ v: 1, favorites: list })); else s.removeItem(FAV_PREFIX + w); return true; }
      catch (e) { return false; }
    }
    function clear() {
      const w = uid() || lastUid;
      reset();
      if (w) { try { const s = local(); if (s) s.removeItem(FAV_PREFIX + w); } catch (e) { /* rien à effacer */ } }
    }

    /* ---------- Photo de référence (coiffure) : en mémoire seulement ---------- */
    async function refChosen(input) {
      const f = input && input.files && input.files[0], s = st('hairstyle');
      if (!f || s.refBusy) return;
      s.refError = '';
      const okType = f.type === 'image/jpeg' || f.type === 'image/png' || (!f.type && ['jpg', 'jpeg', 'png'].includes(extOf(f.name)));
      if (!okType) { s.refError = MSG.format; c.redraw(); return; }
      if (f.size > MAX_FILE) { s.refError = MSG.tooBig; c.redraw(); return; }
      s.refBusy = true; c.redraw();
      const ep = c.epoch(), who = c.who();
      try {
        const big = c.toJpeg ? await c.toJpeg(f) : null; if (!big) throw new Error('vide');
        const small = await shrink(big);
        if (ep !== c.epoch() || who !== c.who() || S.hairstyle !== s) return;
        if (s.refUrl) { try { URL.revokeObjectURL(s.refUrl); } catch (e) { /* sans importance */ } }
        s.refBlob = small; s.refUrl = URL.createObjectURL(small);
      } catch (e) { if (ep === c.epoch() && who === c.who() && S.hairstyle === s) s.refError = (e && e.userMessage) || MSG.unreadable; }
      s.refBusy = false; c.redraw();
    }
    function refRemove() { const s = st('hairstyle'); if (s.refUrl) { try { URL.revokeObjectURL(s.refUrl); } catch (e) { /* sans importance */ } } s.refUrl = ''; s.refBlob = null; s.refError = ''; }

    /* ---------- Essai : UNE demande ---------- */
    const cfgOf = fid => D.toConfig(fid, st(fid).sel);
    const needsRef = fid => fid === 'hairstyle' && st(fid).sel.mode === 'reference';
    const ready = fid => { const s = st(fid), p = c.photo(); return !!p && !!cfgOf(fid) && (!needsRef(fid) || !!s.refBlob) && !running && !c.busy() && (!c.marker.get() || s.acked); };
    async function run(fid) {
      const s = st(fid), p = c.photo();
      if (running || c.busy()) return;
      if (!p || !cfgOf(fid) || (needsRef(fid) && !s.refBlob)) return;
      if (c.marker.get() && !s.acked) { c.redraw(); return; }
      running = true; s.status = 'running'; s.error = ''; s.unsure = false; s.notice = ''; c.redraw();
      const ep = c.epoch(), who = c.who(), cfg = cfgOf(fid), stale = () => ep !== c.epoch() || who !== c.who() || S[fid] !== s;
      const label = labelOf(fid, s);
      const done = () => { running = false; };
      let token = null;
      try { const a = c.acc(); token = a && a.accessToken ? await a.accessToken() : null; } catch (e) { token = null; }
      if (stale()) { done(); return; }
      if (!token) { done(); s.status = 'idle'; s.error = MSG.sessionExpired; c.redraw(); return; }
      let body, refAt = null;
      try {
        if (shrunk.from !== p.blob) shrunk = { from: p.blob, out: await shrink(p.blob) };
        body = shrunk.out;
        if (needsRef(fid)) { refAt = body.size; body = new Blob([body, s.refBlob], { type: 'image/jpeg' }); }
      } catch (e) { done(); if (!stale()) { s.status = 'error'; s.error = MSG.unreadable; c.redraw(); } return; }
      if (stale()) { done(); return; }
      c.marker.set(); s.acked = false;
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
      let verdict = false, out = null, status = 0;
      try {
        const r = await c.doFetch('/api/hair-vto?feature=' + encodeURIComponent(fid) + '&cfg=' + encodeURIComponent(JSON.stringify(cfg)) + (refAt ? '&ref_at=' + refAt : ''), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/jpeg' }, body, signal: ctl ? ctl.signal : undefined });
        status = r.status;
        let j = null; try { j = await r.json(); } catch (e) { j = null; }
        verdict = !!(j && typeof j.ok === 'boolean'); out = j;
      } catch (e) { verdict = false; }
      if (timer) clearTimeout(timer);
      done();
      if (stale()) return;
      if (verdict) c.marker.clear();
      if (!verdict) { s.status = 'error'; s.unsure = true; s.error = MSG.unsure; c.redraw(); return; }
      if (out.ok === true) {
        const h = out.hair;
        if (h && h.feature === fid && okImage(h.image)) {
          s.seq += 1; s.results.push({ id: s.seq, image: h.image, label, expired: false });
          if (s.results.length > MAX_RESULTS) s.results.shift();
          s.shown = s.results.length - 1; s.pos = 50; s.status = 'done';
        } else { s.status = 'error'; s.error = MSG.badImage; }
      } else if (status === 401) { s.status = 'error'; s.error = MSG.sessionExpired; }
      else { s.status = 'error'; s.error = typeof out.error === 'string' && out.error ? out.error : MSG.generic; }
      c.redraw();
    }
    function labelOf(fid, s) {
      const info = D.FEATURES[fid], t = s.tpl.items.find(x => x.id === s.sel.templateId);
      if (fid === 'haircolor') return s.sel.mode === 'preset' ? (D.presetLabel(s.sel.preset) || info.kind) : (s.sel.mode === 'ombre' ? 'Dégradé personnalisé' : 'Couleur personnalisée');
      if (fid === 'hairstyle' && s.sel.mode === 'reference') return 'Photo de référence';
      return (t && t.title) || info.kind;
    }
    async function download(fid) {
      const s = st(fid), r = s.results[s.shown]; if (!r) return;
      try {
        const resp = await c.doFetch(r.image, { method: 'GET' });
        if (!resp || !resp.ok) throw new Error('lien');
        const blob = await resp.blob(), a = doc().createElement('a'), url = URL.createObjectURL(blob);
        a.href = url; a.download = 'studio-beaute-' + fid + '.' + (blob.type === 'image/png' ? 'png' : 'jpg'); doc().body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* sans importance */ } }, 4000);
        s.notice = '';
      } catch (e) {
        try { root.open(r.image, '_blank', 'noopener'); } catch (e2) { /* fenêtre bloquée */ }
        s.notice = MSG.download;
      }
      c.redraw();
    }

    /* ---------- Affichage ---------- */
    const note = (t, cls, role) => `<div class="c-notice${cls ? ' ' + cls : ''} u-my-5" role="${role || 'status'}"><div>${esc(t)}</div></div>`;
    const chip = (attrs, pressed, text) => `<button type="button" class="c-chip" ${attrs} aria-pressed="${pressed}">${esc(text)}</button>`;
    const slider = (fid, field, label, val, min, max, step, shown) => `<div class="c-ms-range"><label for="hs-${fid}-${field}">${esc(label)} <output id="hs-${fid}-${field}-out">${esc(shown !== undefined ? shown : val)}</output></label><input type="range" min="${min}" max="${max}" step="${step}" value="${val}" id="hs-${fid}-${field}" data-hs="range" data-f="${fid}" data-k="${field}"></div>`;
    const swatch = (fid, key, color, label, cur) => `<button type="button" class="c-ms-swatch" data-hs="color" data-f="${fid}" data-k="${key}" data-c="${color}" aria-pressed="${String(color).toLowerCase() === String(cur).toLowerCase()}" aria-label="${esc(label)}" title="${esc(label)}"><span style="background:${color}"></span></button>`;
    const picker = (fid, key, label, cur) => `<div class="c-ms-block"><p class="c-ms-label">${esc(label)}</p><div class="c-ms-swatches" role="group" aria-label="${esc(label)}">${D.CUSTOM.map(p => swatch(fid, key, p[1], p[0], cur)).join('')}</div>
      <label class="c-ms-custom">Autre couleur <input type="color" data-hs="custom" data-f="${fid}" data-k="${key}" value="${esc(cur)}" aria-label="Choisir une autre couleur : ${esc(label)}"></label></div>`;

    function templateGrid(fid) {
      const s = st(fid), t = s.tpl;
      if (t.status === 'idle' || (t.status === 'loading' && !t.items.length)) return `<p class="muted" role="status"><span class="c-spinner" aria-hidden="true"></span> Chargement des modèles…</p>`;
      if (t.status === 'error' && !t.items.length) return `${note(t.error || MSG.templates, 'c-notice--error', 'alert')}<button type="button" class="c-btn c-btn--secondary" data-hs="retry-templates" data-f="${fid}">Réessayer</button>`;
      const cats = [...new Set(t.items.map(x => x.category).filter(Boolean))];
      const shown = t.items.filter(x => !s.cat || x.category === s.cat);
      const chips = cats.length > 1 ? `<div class="chips" role="group" aria-label="Catégories de modèles">${chip(`data-hs="cat" data-f="${fid}" data-v=""`, !s.cat, 'Tous')}${cats.map(k => chip(`data-hs="cat" data-f="${fid}" data-v="${esc(k)}"`, s.cat === k, CAT_FR[k.toLowerCase()] || k)).join('')}</div>` : '';
      const cards = shown.map((x, i) => `<button type="button" class="c-hs-card" data-hs="tpl" data-f="${fid}" data-id="${esc(x.id)}" aria-pressed="${s.sel.templateId === x.id}">${x.thumb ? `<img src="${esc(x.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="c-hs-card__ph" aria-hidden="true"></span>'}<span class="c-hs-card__t">${esc(x.title || 'Modèle ' + (i + 1))}</span></button>`).join('');
      const more = t.next ? `<button type="button" class="c-btn c-btn--ghost c-btn--block" data-hs="more-templates" data-f="${fid}"${t.status === 'loading' ? ' disabled' : ''}>${t.status === 'loading' ? 'Chargement…' : 'Voir plus de modèles'}</button>` : '';
      return `${chips}<div class="c-hs-grid" role="group" aria-label="Modèles proposés">${cards}</div>${t.status === 'error' ? note(t.error || MSG.templates, 'c-notice--error', 'alert') : ''}${more}<p class="muted">${t.items.length} modèle${t.items.length > 1 ? 's' : ''} proposé${t.items.length > 1 ? 's' : ''} par le service. Rien n'est envoyé tant que vous n'avez pas lancé l'essai.</p>`;
    }

    function colorEditor() {
      const fid = 'haircolor', s = st(fid), v = s.sel;
      const modes = `<div class="chips" role="group" aria-label="Type de couleur">${D.TEXT.haircolorMode.map(m => chip(`data-hs="mode" data-f="${fid}" data-v="${m[0]}"`, v.mode === m[0], m[1])).join('')}</div>`;
      if (v.mode === 'preset') {
        const card = (p, ombre) => `<button type="button" class="c-hs-card c-hs-card--color" data-hs="preset" data-f="${fid}" data-v="${esc(p[0])}" aria-pressed="${v.preset === p[0]}"><span class="c-hs-card__sw" style="background:${ombre ? `linear-gradient(${p[2][0]} 0 50%,${p[2][1]} 50% 100%)` : p[2]}" aria-hidden="true"></span><span class="c-hs-card__t">${esc(p[1])}</span></button>`;
        return `${modes}<p class="c-ms-label">Teintes unies</p><div class="c-hs-grid" role="group" aria-label="Teintes unies">${D.PRESETS_FULL.map(p => card(p, false)).join('')}</div><p class="c-ms-label">Dégradés (ombré)</p><div class="c-hs-grid" role="group" aria-label="Dégradés">${D.PRESETS_OMBRE.map(p => card(p, true)).join('')}</div>`;
      }
      if (v.mode === 'full') return `${modes}${picker(fid, 'color', 'Couleur', v.color)}${slider(fid, 'colorIntensity', 'Intensité de la couleur', v.colorIntensity, 0, 100, 1)}${slider(fid, 'shineIntensity', 'Brillance', v.shineIntensity, 0, 100, 1)}`;
      return `${modes}${picker(fid, 'color', 'Couleur 1', v.color)}${picker(fid, 'color2', 'Couleur 2', v.color2)}${slider(fid, 'blend', 'Fondu entre les deux couleurs', v.blend, 0, 100, 1)}${slider(fid, 'offset', 'Position du dégradé', Math.round(v.offset * 100), -99, 99, 1, v.offset.toFixed(2))}<p class="muted">Le service ne précise pas laquelle des deux couleurs est en haut : voyez le résultat.</p>`;
    }
    function styleEditor() {
      const fid = 'hairstyle', s = st(fid), v = s.sel;
      const modes = `<div class="chips" role="group" aria-label="Source de la coiffure">${chip(`data-hs="mode" data-f="${fid}" data-v="template"`, v.mode !== 'reference', 'Modèles')}${chip(`data-hs="mode" data-f="${fid}" data-v="reference"`, v.mode === 'reference', 'Ma photo de référence')}</div>`;
      if (v.mode === 'reference') {
        return `${modes}<p class="muted">Choisissez la photo d'une coiffure que vous aimez : elle est reportée sur vous, avec la couleur de cheveux de cette photo. Elle reste dans cette page, comme votre photo.</p>
          ${s.refUrl ? `<div class="c-ms-preview"><img src="${esc(s.refUrl)}" alt="Photo de la coiffure de référence"></div>` : `<div class="c-ms-empty"><p class="muted">${s.refBusy ? 'Préparation de la photo…' : 'Aucune photo de référence.'}</p></div>`}
          ${s.refError ? note(s.refError, 'c-notice--error', 'alert') : ''}
          <div class="stack" style="gap:8px"><button type="button" class="c-btn c-btn--secondary c-btn--block" data-hs="pick-ref"${s.refBusy || running ? ' disabled' : ''}>${s.refUrl ? 'Remplacer la référence' : 'Choisir la photo de référence'}</button>${s.refUrl ? `<button type="button" class="link" data-hs="ref-remove"${running ? ' disabled' : ''}>Retirer la référence</button>` : ''}</div>
          <input type="file" id="hs-ref" data-hs="ref-file" accept="image/jpeg,image/png" hidden>`;
      }
      return `${modes}${templateGrid(fid)}<div class="c-ms-block"><p class="c-ms-label">Couleur des cheveux sur le résultat</p><div class="chips" role="group" aria-label="Couleur des cheveux">${chip(`data-hs="haircolor-src" data-f="${fid}" data-v="ref"`, v.hairColor !== 'src', 'Celle du modèle')}${chip(`data-hs="haircolor-src" data-f="${fid}" data-v="src"`, v.hairColor === 'src', 'La mienne')}</div></div>`;
    }

    function resultView(fid) {
      const s = st(fid), r = s.results[s.shown], p = c.photo();
      if (!r) return '';
      const thumbs = s.results.length > 1 ? `<div class="chips" role="group" aria-label="Essais précédents">${s.results.map((x, i) => chip(`data-hs="show" data-f="${fid}" data-i="${i}"`, i === s.shown, `Essai ${i + 1} : ${x.label}`)).join('')}</div>` : '';
      return `<section class="c-ms-result" id="hs-result"><div class="hd"><h2 class="h3">Résultat : ${esc(D.FEATURES[fid].kind)}</h2></div>${thumbs}
        ${r.expired || !p ? note(MSG.imageLoad, 'c-notice--error', 'alert') : `<div class="c-ms-compare" data-hs="frame">
          <img src="${esc(p.url)}" alt="Votre photo d'origine">
          <img src="${esc(r.image)}" alt="Votre photo avec l'essai capillaire, image générée" data-hs="after" style="clip-path:inset(0 0 0 ${s.pos}%)">
          <span class="c-ms-tag c-ms-tag--l">Avant</span><span class="c-ms-tag c-ms-tag--r">${esc(D.FEATURES[fid].label)}</span></div>
        <input type="range" min="0" max="100" value="${s.pos}" data-hs="pos" data-f="${fid}" aria-label="Comparer avant et après" class="c-ms-pos">`}
        ${s.notice ? note(s.notice) : ''}
        <div class="stack" style="gap:8px;margin-top:12px"><button class="c-btn c-btn--secondary c-btn--block" data-hs="download" data-f="${fid}"${r.expired ? ' disabled' : ''}>Télécharger l'image</button><button class="c-btn c-btn--secondary c-btn--block" data-hs="again" data-f="${fid}">Changer de modèle ou de couleur</button></div>
        <p class="c-disclaimer">${esc(DATA_NOTE)}</p></section>`;
    }

    function favoritesView(fid) {
      const list = loadFavs().filter(f => f.feature === fid);
      return `<details class="c-why" id="hs-favs"${favOpen ? ' open' : ''}><summary>Mes favoris (${list.length})</summary>
        ${list.length ? `<ul class="c-ms-favs">${list.map(f => `<li><span>${esc(f.name)}</span><button type="button" class="c-btn c-btn--ghost c-btn--sm" data-hs="fav-use" data-id="${esc(f.id)}" aria-label="Appliquer le favori ${esc(f.name)}">Appliquer</button><button type="button" class="c-btn c-btn--ghost c-btn--sm" data-hs="fav-del" data-id="${esc(f.id)}" aria-label="Supprimer le favori ${esc(f.name)}">Supprimer</button></li>`).join('')}</ul>` : '<p class="muted">Aucun favori pour le moment.</p>'}
        <div class="c-field"><label class="c-field__label" for="hs-favname">Nom de ce réglage</label><input class="c-input" id="hs-favname" maxlength="${MAX_NAME}" value="${esc(favName)}" autocomplete="off"><p class="c-field__hint">Seuls le choix du modèle ou de la couleur sont gardés, dans ce navigateur. Aucune photo ni image n'est enregistrée.</p></div>
        <button type="button" class="c-btn c-btn--secondary c-btn--block" data-hs="fav-save" data-f="${fid}"${loadFavs().length >= MAX_FAVORITES || !cfgOf(fid) || needsRef(fid) ? ' disabled' : ''}>Enregistrer ce réglage</button>
        ${favMsg ? `<p class="muted" role="status">${esc(favMsg)}</p>` : ''}</details>`;
    }

    /* Corps d'un onglet : sous-onglets si l'onglet regroupe plusieurs fonctions, puis choix, essai et résultat. */
    function body(tabId) {
      const tab = D.TABS.find(t => t.id === tabId); if (!tab) return '';
      const avail = tab.features.filter(f => feat(f));
      if (!avail.length) return note('Cette fonction n\'est pas disponible pour votre compte pour le moment.');
      const fid = avail.includes(sub[tabId]) ? sub[tabId] : avail[0], info = D.FEATURES[fid], s = st(fid), f = feat(fid);
      if (f.templates && s.tpl.status === 'idle') loadTemplates(fid);   // lecture seule des modèles : aucune tâche, aucune unité
      const tabs = avail.length > 1 ? `<div class="chips" role="group" aria-label="Fonction">${avail.map(x => chip(`data-hs="sub" data-t="${tabId}" data-f="${x}"`, x === fid, D.FEATURES[x].label)).join('')}</div>` : '';
      const editor = fid === 'haircolor' ? colorEditor() : fid === 'hairstyle' ? styleEditor() : templateGrid(fid);
      const busy = s.status === 'running', pending = c.marker.get() && !s.acked;
      const units = D.unitsText(f.units || info.units);
      const run = `<button class="c-btn c-btn--primary c-btn--block" data-hs="run" data-f="${fid}"${ready(fid) && !busy ? '' : ' disabled'} aria-busy="${busy}">${busy ? 'Essai en cours…' : 'Essayer'}</button>`;
      return `<section class="c-ms-looks"><div class="hd"><h2 class="h3">${esc(info.kind)}</h2></div>${tabs}<p class="muted">${esc(info.about)}</p>${note(info.limit)}</section>
        <section class="c-ms-custom-box"><div class="hd"><h2 class="h3">Votre choix</h2></div>${editor}${favoritesView(fid)}</section>
        <section class="c-ms-go"><div class="hd"><h2 class="h3">Essayer</h2></div>
          ${pending ? `<div class="c-notice u-my-5" role="status"><div><span class="c-notice__title">Un essai précédent est resté sans réponse</span>Il a peut-être été compté dans votre quota. Relancer en consomme peut-être un autre.<div style="margin-top:10px"><button class="c-btn c-btn--secondary" data-hs="ack" data-f="${fid}">Je comprends, continuer</button></div></div></div>` : ''}
          ${s.error ? note(s.error, 'c-notice--error', 'alert') : ''}
          <p class="muted" style="margin-bottom:12px">Cet essai consomme ${esc(units)} chez le fournisseur (valeur annoncée par sa documentation, non mesurée par DERMAI) et compte dans votre quota d'essais capillaires, même s'il échoue. Il est indépendant du maquillage, de vos analyses et de la simulation. Changer de modèle ne lance rien.</p>
          ${run}${busy ? '<p class="muted" role="status"><span class="c-spinner" aria-hidden="true"></span> Cela peut prendre une minute. Ne quittez pas la page.</p>' : ''}</section>
        ${resultView(fid)}`;
    }

    /* ---------- Interactions ---------- */
    const fidOf = el => { const f = el.getAttribute('data-f'); return known(f) ? f : null; };
    function attach(x) {
      if (!x || !x.addEventListener) return;
      x.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-hs]') : null;
        if (!el || el.disabled || el.tagName === 'INPUT') return;
        lastUid = uid() || lastUid;
        const a = el.getAttribute('data-hs'), fid = fidOf(el);
        if (a === 'sub') { const t = el.getAttribute('data-t'); if (D.TABS.some(v => v.id === t && v.features.includes(fid))) { sub[t] = fid; c.redraw(); } return; }
        if (!fid && !['fav-use', 'fav-del'].includes(a)) return;
        const s = fid ? st(fid) : null;
        if (a === 'run') run(fid);
        else if (a === 'tpl') { s.sel.templateId = el.getAttribute('data-id'); c.redraw(); }
        else if (a === 'cat') { s.cat = el.getAttribute('data-v') || ''; c.redraw(); }
        else if (a === 'mode') { const v = el.getAttribute('data-v'); if (fid === 'haircolor' && ['preset', 'full', 'ombre'].includes(v)) s.sel.mode = v; else if (fid === 'hairstyle' && (v === 'template' || v === 'reference')) s.sel.mode = v; c.redraw(); }
        else if (a === 'preset') { s.sel.preset = el.getAttribute('data-v'); c.redraw(); }
        else if (a === 'color') { s.sel[el.getAttribute('data-k') === 'color2' ? 'color2' : 'color'] = String(el.getAttribute('data-c')).toLowerCase(); c.redraw(); }
        else if (a === 'haircolor-src') { s.sel.hairColor = el.getAttribute('data-v') === 'src' ? 'src' : 'ref'; c.redraw(); }
        else if (a === 'retry-templates') { s.tpl.status = 'retry'; loadTemplates(fid); c.redraw(); }
        else if (a === 'more-templates') { loadTemplates(fid, true); c.redraw(); }
        else if (a === 'pick-ref') { const f = x.getElementById('hs-ref'); if (f) f.click(); }
        else if (a === 'ref-remove') { refRemove(); c.redraw(); }
        else if (a === 'show') { const i = Number(el.getAttribute('data-i')); if (i >= 0 && i < s.results.length) { s.shown = i; s.pos = 50; s.notice = ''; c.redraw(); } }
        else if (a === 'download') download(fid);
        else if (a === 'again') { const t = x.getElementById('hs-favs'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'center' }); }
        else if (a === 'ack') { s.acked = true; c.redraw(); }
        else if (a === 'fav-save') {
          const n = String((x.getElementById('hs-favname') || {}).value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME), list = loadFavs();
          if (!n) favMsg = 'Donnez un nom à ce réglage.';
          else if (!cfgOf(fid) || needsRef(fid)) favMsg = 'Choisissez d\'abord un modèle ou une couleur.';
          else if (list.length >= MAX_FAVORITES) favMsg = `Vous avez déjà ${MAX_FAVORITES} favoris : supprimez-en un.`;
          else { const id = 'h' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); favMsg = saveFavs(list.concat({ id, name: n, feature: fid, sel: D.sanitizeSelection(fid, s.sel) })) ? 'Réglage enregistré.' : 'Ce navigateur refuse de garder vos favoris.'; favName = ''; }
          favOpen = true; c.redraw();
        } else if (a === 'fav-use') { const f = loadFavs().find(v => v.id === el.getAttribute('data-id')); if (f) { const t = st(f.feature); t.sel = D.sanitizeSelection(f.feature, f.sel); favMsg = ''; if (f.feature === 'hairstyle') t.sel.mode = 'template'; } favOpen = true; c.redraw(); }
        else if (a === 'fav-del') { saveFavs(loadFavs().filter(v => v.id !== el.getAttribute('data-id'))); favMsg = 'Favori supprimé.'; favOpen = true; c.redraw(); }
      });
      x.addEventListener('change', ev => {
        const t = ev.target; if (!t || !t.getAttribute) return;
        const a = t.getAttribute('data-hs'); if (!a) return;
        const fid = fidOf(t);
        if (a === 'ref-file') refChosen(t);
        else if (a === 'custom' && fid && /^#[0-9a-fA-F]{6}$/.test(t.value)) { st(fid).sel[t.getAttribute('data-k') === 'color2' ? 'color2' : 'color'] = t.value.toLowerCase(); c.redraw(); }
      });
      /* Réglages en cours de glissement : mise à jour de la sélection et de l'affichage SANS réafficher l'écran ; rien n'est envoyé. */
      x.addEventListener('input', ev => {
        const t = ev.target; if (!t || !t.getAttribute) return;
        const a = t.getAttribute('data-hs');
        if (!a) { if (t.id === 'hs-favname') favName = t.value; return; }
        const fid = fidOf(t); if (!fid) return;
        const s = st(fid);
        if (a === 'range') {
          const k = t.getAttribute('data-k'), n = Number(t.value);
          if (['colorIntensity', 'shineIntensity', 'blend'].includes(k)) s.sel[k] = Math.max(0, Math.min(100, Math.round(n) || 0));
          else if (k === 'offset') s.sel.offset = Math.max(-0.99, Math.min(0.99, Math.round(n) / 100 || 0));
          else return;
          const o = x.getElementById(`hs-${fid}-${k}-out`); if (o) o.textContent = k === 'offset' ? s.sel.offset.toFixed(2) : String(s.sel[k]);
        } else if (a === 'pos') {
          s.pos = Math.max(0, Math.min(100, Number(t.value) || 0));
          const img = x.querySelector('[data-hs="after"]'); if (img) img.style.clipPath = 'inset(0 0 0 ' + s.pos + '%)';
        }
      });
      x.addEventListener('toggle', ev => { if (ev.target && ev.target.id === 'hs-favs') favOpen = !!ev.target.open; }, true);
      x.addEventListener('error', ev => {
        const el = ev.target;
        if (el && el.getAttribute && el.getAttribute('data-hs') === 'after') for (const fid of Object.keys(S)) { const r = S[fid].results[S[fid].shown]; if (r && el.getAttribute('src') === r.image) { r.expired = true; c.redraw(); } }
      }, true);
    }
    /* Photo remplacée ou retirée : les résultats ne se comparent plus à la bonne photo d'origine, ils sont oubliés. */
    function dropResults() { for (const k of Object.keys(S)) { S[k].results = []; S[k].shown = -1; if (S[k].status === 'done') S[k].status = 'idle'; } shrunk = { from: null, out: null }; }
    return { body, attach, reset, clear, dropResults, busy: () => running, favorites: loadFavs, state: () => S, templates: loadTemplates, ready, tabsFor: ids => D.TABS.filter(t => t.features.some(f => ids.includes(f))) };
  }
  return { create, MSG, DATA_NOTE, FAV_PREFIX, MAX_FAVORITES, MAX_RESULTS, MAX_SIDE, shrinkJpeg };
});
