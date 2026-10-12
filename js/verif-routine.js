/* DERMAI : écran « Vérif'Routine » (produits de la routine, ingrédients saisis ou du catalogue, points d'attention). Chargé avant app.js, après js/engine/verif.js.
   Aucune décision cosmétique ici : l'analyse vient de js/engine/verif.js (fiches et règles DERMAI). Ce module n'appelle jamais le réseau ni le service d'analyse.

   Données et vie privée (version 1) : les produits (nom, catégorie, moments d'utilisation, liste INCI confirmée, origine, « m'a déjà irrité(e) ») sont gardés dans ce navigateur
   seulement (localStorage, une clé par compte : `dermai.verif.<identifiant du compte>`), 20 produits au plus. Ils ne sont ni envoyés, ni synchronisés entre appareils.
   ATTENTION : séparer les données par clé locale évite de mélanger deux comptes dans l'écran, mais ce n'est PAS une isolation côté serveur : quiconque utilise ce navigateur
   et ses outils de développement peut lire ces clés. Supprimer un produit l'efface ; supprimer le compte efface toutes les clés. Sans compte (démonstration) : mémoire seulement. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiVerif = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const V = () => (typeof module === 'object' && module.exports ? require('./engine/verif.js') : root.DermaiEngine.verif);
  const KEY_PREFIX = 'dermai.verif.';

  const COPY = {
    title: 'Vérif\'Routine',
    intro: 'Ajoutez les produits de votre routine et vérifiez leurs ingrédients. DERMAI s\'appuie seulement sur ses fiches, ses règles et ce que vous saisissez : il ne devine jamais la composition d\'un produit.',
    local: 'Vos produits sont gardés dans ce navigateur seulement : ils ne sont pas synchronisés avec vos autres appareils.',
    memory: 'Dans cette version de démonstration, vos produits ne sont pas conservés : ils disparaissent quand vous quittez la page.',
    visitor: 'Connectez-vous ou créez un compte pour enregistrer les produits de votre routine : ils sont gardés pour votre compte, dans ce navigateur.',
    warn: 'Ce navigateur refuse de garder vos produits : ils restent visibles pendant cette visite mais ne seront pas conservés.',
    empty: 'Aucun produit pour le moment. Ajoutez un produit du catalogue DERMAI ou saisissez sa liste d\'ingrédients (INCI), écrite sur l\'emballage.',
    full: 'Votre routine contient déjà 20 produits, le maximum de cette version. Supprimez-en un pour en ajouter.',
    catalogDemo: 'Le catalogue vérifié n\'est pas affiché en démonstration. Vous pouvez saisir un produit à la main.',
    catalogNone: 'Aucun produit du catalogue ne correspond. Le catalogue vérifié est volontairement petit : vous pouvez saisir la liste INCI à la main.',
    unknownBadge: 'Composition inconnue',
    originCatalog: 'Catalogue DERMAI sourcé',
    originUser: 'Saisi par vous',
    orderNote: 'Ordre indicatif DERMAI : nettoyant, soin ciblé, hydratant, protection solaire. Les produits « Autre » : suivez la notice.',
    freqNote: 'Ce repère concerne l\'actif reconnu seulement. Il dépend de la concentration et de la formule du produit : suivez la notice du fabricant.',
    freqMultiple: 'Ce produit contient plusieurs actifs ciblés : DERMAI ne propose pas de fréquence globale. Consultez la notice du produit.',
    freqUnknown: 'Composition inconnue : DERMAI ne propose aucune fréquence. Consultez la notice du produit.',
    freqUnvalidated: 'La fiche de cet actif est encore à valider : DERMAI ne propose pas de repère de fréquence. Consultez la notice du produit.',
    noInci: 'Aucune liste INCI enregistrée pour ce produit. Utilisez « Modifier » pour la saisir : DERMAI ne peut rien vérifier tant qu\'elle manque.',
    unknownNote: 'Non reconnu : DERMAI n\'a pas de fiche pour cet ingrédient. Ce n\'est ni bon ni mauvais, simplement non documenté ici.',
    reviewIntro: 'Vérifiez et corrigez chaque ingrédient avant d\'enregistrer. Rien n\'est enregistré tant que vous n\'avez pas confirmé.',
    reviewEmpty: 'Aucune liste INCI saisie : le produit sera enregistré avec une « composition inconnue ». DERMAI ne pourra rien vérifier pour lui tant que vous n\'aurez pas saisi sa liste.',
    pointsEmpty: 'Aucun point d\'attention avec les produits et les règles actuels. Cela ne veut pas dire que la routine est adaptée : DERMAI ne vérifie que ce qui est documenté.'
  };

  const fmtDay = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return ''; } };
  const newId = list => { let id; do { id = 'v' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); } while (list.some(p => p.id === id)); return id; };

  /* deps : userId() → identifiant du compte ou null · status() → 'signedIn' | 'visitor' | 'checking' | 'off' | 'demo' · render() · ic(nom) · esc(texte)
     storage() → localStorage ou null · catalog() → produits du catalogue (par défaut le catalogue vérifié de DERMAI ; vide en démonstration) */
  function create(deps) {
    const d = deps || {}, E = V();
    const esc = d.esc || (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c])));
    const ic = d.ic || (() => '');
    const uid = () => { try { return (d.userId && d.userId()) || null; } catch (e) { return null; } };
    const status = () => { try { return d.status ? d.status() : 'off'; } catch (e) { return 'off'; } };
    const store = () => { try { return d.storage ? d.storage() : (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) { return null; } };
    const redraw = () => { try { if (d.render) d.render(); } catch (e) { /* sans importance */ } };
    const doc = () => (typeof document !== 'undefined' ? document : null);
    const el = id => { const x = doc(); return x ? x.getElementById(id) : null; };

    let cache = { who: undefined, products: [] }, lastUid = null;
    let ui = { who: undefined, view: 'home', tab: 'catalog', draft: null, q: '', detail: null, confirm: null, notice: '', warn: false };
    const who = () => { const u = uid(); if (u) lastUid = u; return u || 'mem'; };
    const catalogRows = () => {
      let list = [];
      try { list = d.catalog ? d.catalog() : ((root.DermaiEngine && root.DermaiEngine.catalogData) ? root.DermaiEngine.catalogData.PRODUCTS : []); } catch (e) { list = []; }
      return (Array.isArray(list) ? list : []).filter(p => p && p.active !== false && p.status !== 'to_verify' && Array.isArray(p.inci) && p.inci.length && !p.demo);
    };
    const catalogById = id => catalogRows().find(p => p.id === id) || null;
    const productName = p => `${p.brand} ${p.name}`.replace(/\s+/g, ' ').trim().slice(0, E.MAX_NAME);

    /* Un autre compte (ou une déconnexion) : rien ne se transmet d'un compte à l'autre dans l'écran. */
    function sync() {
      const w = who();
      if (ui.who !== w) { ui = { who: w, view: 'home', tab: 'catalog', draft: null, q: '', detail: null, confirm: null, notice: '', warn: false }; cache = { who: w, products: [] }; }
    }
    function load() {
      const w = who();
      if (w === 'mem' || (ui.warn && cache.who === w)) return cache.products;
      let products = [];
      try { const s = store(), raw = s && s.getItem(KEY_PREFIX + w), j = raw ? JSON.parse(raw) : null; products = (j && j.v === 1 && Array.isArray(j.products) ? j.products : []).map(E.cleanProduct).filter(Boolean).slice(0, E.MAX_PRODUCTS); } catch (e) { products = []; }
      cache = { who: w, products };
      return products;
    }
    function save(products) {
      const w = who(); cache = { who: w, products };
      if (w === 'mem') return true;
      try { const s = store(); if (!s) throw new Error('indisponible'); if (products.length) s.setItem(KEY_PREFIX + w, JSON.stringify({ v: 1, products })); else s.removeItem(KEY_PREFIX + w); ui.warn = false; return true; }
      catch (e) { ui.warn = true; return false; }
    }
    /* Effacement du compte courant (ou du dernier compte connu : la suppression du compte a déjà fermé la session). */
    function clear() {
      const w = uid() || lastUid || 'mem';
      cache = { who: undefined, products: [] }; ui = { who: undefined, view: 'home', tab: 'catalog', draft: null, q: '', detail: null, confirm: null, notice: '', warn: false };
      if (w !== 'mem') { try { const s = store(); if (s) s.removeItem(KEY_PREFIX + w); } catch (e) { /* rien à effacer */ } }
    }

    /* ---------- Lecture des champs de formulaire ---------- */
    const readSlots = () => { const x = doc(); return x ? [...x.querySelectorAll('input[name=vr-slot]:checked')].map(i => i.value) : []; };
    const readRows = () => { const x = doc(); return x ? [...x.querySelectorAll('input[data-vr-row]')].map(i => i.value) : []; };
    const val = id => { const e = el(id); return e ? e.value : ''; };

    /* ---------- Actions ---------- */
    function handle(name, data) {
      sync();
      const v = data || {}, products = load();
      ui.notice = '';
      switch (name) {
        case 'home': ui.view = 'home'; ui.draft = null; ui.detail = null; ui.confirm = null; break;
        case 'add': if (products.length >= E.MAX_PRODUCTS) { ui.notice = COPY.full; break; } ui.view = 'add'; ui.draft = null; ui.q = ''; break;
        case 'tab': ui.tab = v.t === 'manual' ? 'manual' : 'catalog'; break;
        case 'pick': { const c = catalogById(v.pid); if (!c) break; ui.draft = { mode: 'catalog', pid: c.id, slots: [] }; ui.view = 'slots'; break; }
        case 'slots-save': {
          const slots = readSlots();
          if (!slots.length) { ui.notice = 'Choisissez au moins un moment : matin, soir, ou les deux.'; break; }
          const dr = ui.draft;
          if (dr && dr.id) { save(products.map(p => (p.id === dr.id ? Object.assign({}, p, { slots: E.SLOTS.filter(s => slots.includes(s)) }) : p))); ui.detail = dr.id; ui.view = 'detail'; ui.draft = null; ui.notice = 'Moments d\'utilisation mis à jour.'; break; }
          const c = dr && catalogById(dr.pid);
          if (!c || products.length >= E.MAX_PRODUCTS) { ui.view = 'home'; ui.draft = null; break; }
          const src = (c.sources || [])[0] || {};
          const np = E.cleanProduct({ id: newId(products), name: productName(c), category: c.category, slots, inci: c.inci, origin: { kind: 'catalog', productId: c.id, label: src.label, checkedAt: src.checkedAt } });
          if (np) { save(products.concat(np)); ui.notice = 'Produit ajouté à votre routine.'; }
          ui.view = 'home'; ui.draft = null; break;
        }
        case 'manual': ui.view = 'form'; ui.draft = { mode: 'manual', name: '', category: 'serum', slots: [], raw: '' }; break;
        case 'form-next': {
          const name = val('vr-name').replace(/\s+/g, ' ').trim(), slots = readSlots(), dr = ui.draft || { mode: 'manual' };
          Object.assign(dr, { name, category: val('vr-cat'), slots, raw: val('vr-inci') });
          ui.draft = dr;
          if (!name) { ui.notice = 'Indiquez le nom du produit.'; break; }
          if (name.length > E.MAX_NAME) { ui.notice = `Le nom est trop long (${E.MAX_NAME} caractères au plus).`; break; }
          if (!slots.length) { ui.notice = 'Choisissez au moins un moment : matin, soir, ou les deux.'; break; }
          const parsed = E.parseInci(dr.raw);
          dr.tokens = parsed.tokens;
          if (parsed.truncated) ui.notice = `Seuls les ${E.MAX_INCI} premiers ingrédients sont gardés.`;
          else if (parsed.tooLong) ui.notice = `Certains noms dépassent ${E.MAX_TOKEN} caractères : ils ont été raccourcis, vérifiez-les.`;
          ui.view = 'review'; break;
        }
        case 'form-back': if (ui.draft) ui.draft.raw = readRows().filter(x => x.trim()).join(', '); ui.view = 'form'; break;
        case 'row-add': if (ui.draft) { ui.draft.tokens = readRows(); if (ui.draft.tokens.length < E.MAX_INCI) ui.draft.tokens.push(''); } break;
        case 'row-del': if (ui.draft) { const r = readRows(); r.splice(Number(v.i), 1); ui.draft.tokens = r; } break;
        case 'review-save': {
          const dr = ui.draft; if (!dr) break;
          const inci = E.parseInci(readRows().join(',')).tokens;
          const edited = dr.id ? products.find(p => p.id === dr.id) : null;
          if (!edited && products.length >= E.MAX_PRODUCTS) { ui.view = 'home'; ui.notice = COPY.full; break; }
          const np = E.cleanProduct({ id: dr.id || newId(products), name: dr.name, category: dr.category, slots: dr.slots, inci, origin: { kind: 'user' }, irritated: !!(edited && edited.irritated) });
          if (!np) { ui.notice = 'Ce produit ne peut pas être enregistré : vérifiez son nom et ses moments d\'utilisation.'; break; }
          save(edited ? products.map(p => (p.id === np.id ? np : p)) : products.concat(np));
          ui.notice = edited ? 'Produit modifié.' : 'Produit enregistré.'; ui.view = 'home'; ui.draft = null; break;
        }
        case 'view': if (products.some(p => p.id === v.id)) { ui.detail = v.id; ui.view = 'detail'; ui.confirm = null; } break;
        case 'edit': {
          const p = products.find(x => x.id === v.id); if (!p) break;
          if (p.origin.kind === 'catalog') { ui.draft = { mode: 'catalog', id: p.id, slots: p.slots.slice() }; ui.view = 'slots'; }
          else { ui.draft = { mode: 'manual', id: p.id, name: p.name, category: p.category, slots: p.slots.slice(), raw: p.inci.join(', ') }; ui.view = 'form'; }
          break;
        }
        case 'del': ui.confirm = v.id; break;
        case 'del-no': ui.confirm = null; break;
        case 'del-yes': { save(products.filter(p => p.id !== v.id)); ui.confirm = null; ui.detail = null; ui.view = 'home'; ui.notice = 'Produit supprimé.'; break; }
        case 'irr': { save(products.map(p => (p.id === v.id ? Object.assign({}, p, { irritated: !p.irritated }) : p))); break; }
        default: return;
      }
      redraw();
    }

    /* ---------- Affichage ---------- */
    const badge = (t, cls) => `<span class="c-badge${cls ? ' ' + cls : ''}">${esc(t)}</span>`;
    const catLabel = k => (E.CATEGORIES.find(c => c[0] === k) || [k, 'Autre'])[1];
    const slotChips = slots => slots.map(s => badge(s === 'morning' ? 'Matin' : 'Soir', 'c-badge--outline')).join(' ');
    const originBadge = p => (p.origin.kind === 'catalog' ? badge(COPY.originCatalog, 'c-badge--good') : badge(COPY.originUser, 'c-badge--outline'));
    const note = (t, cls) => `<div class="c-notice${cls ? ' ' + cls : ''} u-my-5" role="status"><div>${esc(t)}</div></div>`;
    const levelClass = l => ({ prudence: 'c-badge--error', precaution: 'c-badge--mid', to_validate: 'c-badge--outline', info: 'c-badge--outline', missing: 'c-badge--outline' })[l] || 'c-badge--outline';

    const pointHtml = pt => `<article class="c-vr-point c-vr-point--${pt.level}"><p>${badge(pt.levelLabel, levelClass(pt.level))}</p><h3 class="c-vr-point__title">${esc(pt.title)}</h3><p>${esc(pt.text)}</p>
      <details class="c-why"><summary>Pourquoi ce message ?</summary><p><b>Règle :</b> ${esc(pt.why.rule)}</p><p><b>Source :</b> ${esc(pt.why.source)}</p><p><b>Validation :</b> ${esc(pt.why.validation)}</p></details></article>`;

    function slotList(products, slot) {
      const rows = E.bySlot(products, slot);
      const title = slot === 'morning' ? 'Matin' : 'Soir', icon = slot === 'morning' ? 'sun' : 'moon';
      return `<section class="c-vr-slot"><div class="hd"><h2 class="h3" style="display:flex;gap:10px;align-items:center">${ic(icon)}${title}</h2></div>${rows.length ? `<div class="stack" style="gap:12px">${rows.map((p, i) => `<div class="c-routine-step"><span class="c-routine-step__ord">${String(i + 1).padStart(2, '0')}</span><div class="c-routine-step__body"><div class="c-routine-step__meta">${esc(catLabel(p.category))}</div><div class="c-routine-step__name">${esc(p.name)}</div>
        <p class="c-vr-badges">${originBadge(p)}${p.inci.length ? '' : ' ' + badge(COPY.unknownBadge, 'c-badge--mid')}${p.irritated ? ' ' + badge('M\'a déjà irrité(e)', 'c-badge--outline') : ''}</p>
        <button class="link" data-vr="view" data-id="${esc(p.id)}">Voir la fiche</button></div></div>`).join('')}</div>` : `<p class="muted">Aucun produit pour ${title.toLowerCase() === 'matin' ? 'le matin' : 'le soir'}.</p>`}</section>`;
    }

    function home(products) {
      const an = E.analyze(products), left = E.MAX_PRODUCTS - products.length;
      const add = products.length >= E.MAX_PRODUCTS ? note(COPY.full) : '';
      return `${ui.notice ? note(ui.notice, 'c-notice--success') : ''}
        <div class="stack" style="gap:10px"><button class="c-btn c-btn--primary c-btn--block" data-vr="add"${products.length >= E.MAX_PRODUCTS ? ' disabled' : ''}>Ajouter un produit</button><p class="muted">${products.length} produit${products.length > 1 ? 's' : ''} sur ${E.MAX_PRODUCTS}${left <= 3 && left > 0 ? ` : plus que ${left} place${left > 1 ? 's' : ''}` : ''}.</p></div>${add}
        ${products.length ? `${slotList(products, 'morning')}${slotList(products, 'evening')}<p class="muted">${esc(COPY.orderNote)}</p>
        <section class="c-vr-points"><div class="hd"><h2 class="h3">Points d'attention</h2></div>${an.points.length ? `<div class="stack" style="gap:14px">${an.points.map(pointHtml).join('')}</div>` : note(COPY.pointsEmpty)}</section>` : `<div class="c-empty"><p class="c-empty__text">${esc(COPY.empty)}</p></div>`}
        <p class="c-disclaimer">${esc(E.DISCLAIMER)}</p>`;
    }

    function resultsHtml() {
      const rows = catalogRows(), q = E.normalizeName(ui.q).split(' ').filter(Boolean);
      if (!rows.length) return note(COPY.catalogDemo);
      const hit = rows.filter(p => { const t = E.normalizeName(`${p.brand} ${p.name} ${p.format || ''}`); return q.every(w => t.includes(w)); }).slice(0, 8);
      if (!hit.length) return note(COPY.catalogNone);
      return `<div class="stack" style="gap:10px">${hit.map(p => { const s = (p.sources || [])[0] || {};
        return `<div class="c-card c-vr-card"><b>${esc(productName(p))}</b><p class="muted">${esc(p.format || '')}${p.format ? ' · ' : ''}${p.inci.length} ingrédients${s.checkedAt ? ` · relevé le ${esc(fmtDay(s.checkedAt))}` : ''}</p><button class="c-btn c-btn--secondary c-btn--block" data-vr="pick" data-pid="${esc(p.id)}" aria-label="Ajouter ${esc(productName(p))} à ma routine">Ajouter à ma routine</button></div>`; }).join('')}</div>`;
    }

    const slotBoxes = slots => `<fieldset class="c-field"><legend class="c-field__label">Moments d'utilisation</legend><div class="chips"><label class="c-check-row"><input type="checkbox" name="vr-slot" value="morning"${slots.includes('morning') ? ' checked' : ''}> Matin</label> <label class="c-check-row"><input type="checkbox" name="vr-slot" value="evening"${slots.includes('evening') ? ' checked' : ''}> Soir</label></div></fieldset>`;

    function addView() {
      const demo = !catalogRows().length;
      return `<div class="chips" role="group" aria-label="Méthode d'ajout"><button class="c-chip" data-vr="tab" data-t="catalog" aria-pressed="${ui.tab === 'catalog'}">Catalogue DERMAI</button><button class="c-chip" data-vr="tab" data-t="manual" aria-pressed="${ui.tab === 'manual'}">Saisir à la main</button></div>
        ${ui.tab === 'catalog' ? `<div class="c-field" style="margin-top:14px"><label class="c-field__label" for="vr-q">Rechercher un produit</label><input class="c-input" id="vr-q" type="search" autocomplete="off" value="${esc(ui.q)}" placeholder="Marque ou nom"${demo ? ' disabled' : ''}></div><div id="vr-results" aria-live="polite">${resultsHtml()}</div>
        <p class="muted">Le catalogue contient des produits dont la liste INCI a été relevée sur la fiche du fabricant. Un produit absent du catalogue : saisissez sa liste à la main.</p>`
          : `<div class="stack" style="margin-top:14px;gap:10px"><p>Vous saisirez le nom du produit puis la liste INCI écrite sur l'emballage. DERMAI ne devine jamais la composition d'un produit à partir de son nom.</p><button class="c-btn c-btn--primary c-btn--block" data-vr="manual">Continuer</button></div>`}
        <div class="stack" style="margin-top:18px"><button class="link" data-vr="home">Retour à ma routine</button></div>`;
    }

    function slotsView(products) {
      const dr = ui.draft || {}, c = dr.id ? null : catalogById(dr.pid), p = dr.id ? products.find(x => x.id === dr.id) : null;
      const name = p ? p.name : c ? productName(c) : '';
      return `${ui.notice ? note(ui.notice, 'c-notice--error') : ''}<div class="c-card c-vr-card"><b>${esc(name)}</b><p class="muted">${esc(COPY.originCatalog)} : la liste INCI vient du catalogue et n'est pas modifiable ici.</p></div>
        <div style="margin-top:14px">${slotBoxes(dr.slots || [])}</div>
        <div class="stack" style="margin-top:14px;gap:8px"><button class="c-btn c-btn--primary c-btn--block" data-vr="slots-save">${dr.id ? 'Enregistrer' : 'Ajouter à ma routine'}</button><button class="link" data-vr="${dr.id ? 'view' : 'add'}" data-id="${esc(dr.id || '')}">Annuler</button></div>`;
    }

    function formView() {
      const dr = ui.draft || {};
      return `${ui.notice ? note(ui.notice, 'c-notice--error') : ''}
        <div class="c-field"><label class="c-field__label" for="vr-name">Nom du produit</label><input class="c-input" id="vr-name" maxlength="${E.MAX_NAME}" autocomplete="off" value="${esc(dr.name || '')}"></div>
        <div class="c-field"><label class="c-field__label" for="vr-cat">Catégorie</label><select class="sel" id="vr-cat">${E.CATEGORIES.map(c => `<option value="${c[0]}"${(dr.category || 'serum') === c[0] ? ' selected' : ''}>${esc(c[1])}</option>`).join('')}</select></div>
        ${slotBoxes(dr.slots || [])}
        <div class="c-field"><label class="c-field__label" for="vr-inci">Liste INCI (facultative)</label><textarea class="c-input" id="vr-inci" rows="6" autocomplete="off" spellcheck="false" placeholder="Aqua, Glycerin, Niacinamide, …">${esc(dr.raw || '')}</textarea>
        <p class="c-field__hint">Recopiez la liste écrite sur l'emballage, séparée par des virgules. Sans liste, le produit est enregistré avec une composition inconnue.</p></div>
        <div class="stack" style="gap:8px"><button class="c-btn c-btn--primary c-btn--block" data-vr="form-next">Continuer</button><button class="link" data-vr="${dr.id ? 'view' : 'add'}" data-id="${esc(dr.id || '')}">Annuler</button></div>`;
    }

    const rowHtml = (t, i) => { const r = E.recognize(t); return `<div class="c-vr-row"><label class="sr" for="vr-r${i}">Ingrédient ${i + 1}</label><input class="c-input" id="vr-r${i}" data-vr-row maxlength="${E.MAX_TOKEN}" value="${esc(t)}" autocomplete="off" spellcheck="false"><span class="c-vr-row__state" data-vr-state>${stateBadge(r)}</span><button class="c-btn c-btn--ghost c-btn--sm" data-vr="row-del" data-i="${i}" aria-label="Retirer l'ingrédient ${i + 1}">Retirer</button></div>`; };
    function stateBadge(r) {
      if (r.kind === 'active') { const a = E.activeById(r.activeId); return badge(`Reconnu : ${a ? a.label : r.activeId}`, 'c-badge--good'); }
      if (r.kind === 'excluded') return badge('Substance sans conseil DERMAI', 'c-badge--error');
      return badge('Non reconnu', 'c-badge--outline');
    }
    function reviewView() {
      const dr = ui.draft || {}, toks = dr.tokens || [];
      return `${ui.notice ? note(ui.notice) : ''}<div class="c-card c-vr-card"><b>${esc(dr.name || '')}</b><p class="muted">${esc(catLabel(dr.category))} · ${(dr.slots || []).map(s => (s === 'morning' ? 'matin' : 'soir')).join(' et ')}</p></div>
        <p style="margin:14px 0">${esc(toks.length ? COPY.reviewIntro : COPY.reviewEmpty)}</p>
        <div class="stack c-vr-rows" style="gap:10px">${toks.map(rowHtml).join('')}</div>
        <div class="stack" style="margin-top:14px;gap:8px"><button class="c-btn c-btn--secondary c-btn--block" data-vr="row-add">Ajouter un ingrédient</button><button class="c-btn c-btn--primary c-btn--block" data-vr="review-save">${dr.id ? 'Enregistrer les modifications' : 'Enregistrer le produit'}</button><button class="link" data-vr="form-back">Modifier la saisie</button></div>`;
    }

    function detailView(products) {
      const p = products.find(x => x.id === ui.detail);
      if (!p) return `<p>Ce produit n'existe plus.</p><button class="link" data-vr="home">Retour à ma routine</button>`;
      const x = E.analyzeProduct(p);
      const known = x.tokens.filter(t => t.kind === 'active'), unknown = x.tokens.filter(t => t.kind === 'unknown'), excl = x.tokens.filter(t => t.kind === 'excluded');
      const f = x.frequency;
      const freq = f.kind === 'single' ? `<p><b>Repère DERMAI pour ${esc(f.label)} :</b> ${esc(f.text)}.${f.note ? ' ' + esc(f.note) : ''}</p><p class="muted">${esc(COPY.freqNote)}</p>`
        : f.kind === 'multiple' ? `<p>${esc(COPY.freqMultiple)}</p>` : f.kind === 'unknown' ? `<p>${esc(COPY.freqUnknown)}</p>` : f.kind === 'unvalidated' ? `<p>${esc(COPY.freqUnvalidated)}</p>` : `<p class="muted">Aucune fréquence proposée : suivez la notice du produit.</p>`;
      const origin = p.origin.kind === 'catalog'
        ? `<p>${badge(COPY.originCatalog, 'c-badge--good')}</p><p class="muted">${esc(p.origin.label || '')}${p.origin.checkedAt ? `. Relevé le ${esc(fmtDay(p.origin.checkedAt))}.` : ''}</p>`
        : `<p>${badge(COPY.originUser, 'c-badge--outline')}</p><p class="muted">Cette liste vient de votre saisie : DERMAI ne l'a pas vérifiée sur l'emballage.</p>`;
      const mine = an => an.points.filter(pt => pt.productIds.includes(p.id) && ['EXCL', 'USER'].includes(pt.rule));
      return `${ui.notice ? note(ui.notice, 'c-notice--success') : ''}<div class="c-card c-vr-card"><h2 class="h3">${esc(p.name)}</h2><p class="muted">${esc(catLabel(p.category))}</p><p>${slotChips(p.slots)}</p>${origin}</div>
        ${mine(E.analyze(products)).map(pointHtml).join('')}
        <section style="margin-top:18px"><div class="hd"><h3 class="h3">Ingrédients</h3></div>${!x.known ? note(COPY.noInci) : `
          <p class="muted">${known.length + excl.length} reconnu${known.length + excl.length > 1 ? 's' : ''}, ${unknown.length} non reconnu${unknown.length > 1 ? 's' : ''}.</p>
          ${known.length ? `<ul class="c-vr-list">${known.map(t => { const a = E.activeById(t.activeId); return `<li><b>${esc(t.raw)}</b> : ${esc(a.label)}${a.status === 'validated' ? '' : ' (fiche à valider)'}${t.validation === 'a_relire' ? ' <span class="muted">(correspondance à relire)</span>' : ''}${a.summary ? `<br><span class="muted">${esc(a.summary)}</span>` : ''}</li>`; }).join('')}</ul>` : ''}
          ${excl.length ? `<ul class="c-vr-list">${excl.map(t => `<li><b>${esc(t.raw)}</b> : ${stateBadge(t)}</li>`).join('')}</ul>` : ''}
          ${unknown.length ? `<details class="c-why"><summary>Ingrédients non reconnus (${unknown.length})</summary><p class="muted">${esc(COPY.unknownNote)}</p><p>${unknown.map(t => esc(t.raw)).join(', ')}</p></details>` : ''}`}</section>
        ${x.cautions.length ? `<section style="margin-top:18px"><div class="hd"><h3 class="h3">Précautions des fiches DERMAI</h3></div><ul class="c-vr-list">${x.cautions.map(c => `<li><b>${esc(c.label)}</b>${c.status === 'validated' ? '' : ' (fiche à valider)'} : ${c.texts.map(esc).join(' ')}</li>`).join('')}</ul></section>` : ''}
        <section style="margin-top:18px"><div class="hd"><h3 class="h3">Fréquence</h3></div>${freq}</section>
        <section style="margin-top:18px"><label class="c-check-row"><input type="checkbox" data-vr="irr" data-id="${esc(p.id)}"${p.irritated ? ' checked' : ''}> Ce produit m'a déjà irrité(e)</label><p class="muted">Information gardée dans ce navigateur seulement.</p></section>
        ${ui.confirm === p.id ? `<div class="c-notice c-notice--error u-my-5" role="alert"><div>Supprimer ce produit de votre routine ?<div class="stack" style="gap:8px;margin-top:10px"><button class="c-btn c-btn--primary c-btn--block" data-vr="del-yes" data-id="${esc(p.id)}">Supprimer</button><button class="link" data-vr="del-no">Annuler</button></div></div></div>`
          : `<div class="stack" style="margin-top:18px;gap:8px"><button class="c-btn c-btn--secondary c-btn--block" data-vr="edit" data-id="${esc(p.id)}">Modifier</button><button class="c-btn c-btn--ghost c-btn--block" data-vr="del" data-id="${esc(p.id)}">Supprimer</button><button class="link" data-vr="home">Retour à ma routine</button></div>`}
        <p class="c-disclaimer">${esc(E.DISCLAIMER)}</p>`;
    }

    /* Contenu de l'écran. */
    function page() {
      sync();
      const st = status(), head = `<div class="pagehead"><h1>${esc(COPY.title)}</h1><p>${esc(COPY.intro)}</p></div>`;
      if (st === 'checking') return `${head}<p class="muted" role="status">Vérification de votre session…</p>`;
      if (st === 'visitor') return `${head}${note(COPY.visitor)}<div class="stack" style="gap:8px"><button class="c-btn c-btn--primary c-btn--block" data-go="signup">Créer un compte</button><button class="c-btn c-btn--secondary c-btn--block" data-go="login">Se connecter</button></div>`;
      const products = load(), mem = who() === 'mem';
      const body = ui.view === 'add' ? addView() : ui.view === 'slots' ? slotsView(products) : ui.view === 'form' ? formView() : ui.view === 'review' ? reviewView() : ui.view === 'detail' ? detailView(products) : home(products);
      return `${head}${mem ? note(COPY.memory) : ui.view === 'home' ? `<p class="muted">${esc(COPY.local)}</p>` : ''}${ui.warn ? note(COPY.warn, 'c-notice--error') : ''}${body}`;
    }

    function attach(x) {
      if (!x || !x.addEventListener) return;
      x.addEventListener('click', e => {
        const t = e.target && e.target.closest ? e.target.closest('[data-vr]') : null;
        if (!t || t.tagName === 'INPUT') return;
        handle(t.getAttribute('data-vr'), t.dataset);
      });
      x.addEventListener('change', e => {
        const t = e.target;
        if (t && t.getAttribute && t.getAttribute('data-vr') === 'irr') handle('irr', t.dataset);
      });
      x.addEventListener('input', e => {
        const t = e.target;
        if (!t || !t.id) return;
        if (t.id === 'vr-q') { sync(); ui.q = t.value; const r = el('vr-results'); if (r) r.innerHTML = resultsHtml(); }
        else if (t.hasAttribute && t.hasAttribute('data-vr-row')) { const s = t.parentNode && t.parentNode.querySelector('[data-vr-state]'); if (s) s.innerHTML = stateBadge(E.recognize(t.value)); }
      });
    }
    return { page, attach, clear, handle, state: () => ({ view: ui.view, products: load() }) };
  }

  return { create, COPY, KEY_PREFIX };
});
