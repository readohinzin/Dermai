/* DERMAI : page d'administration PRIVÉE du fondateur, V1, LECTURE SEULE (via /api/admin-stats). Module INDÉPENDANT du Studio Beauté : chargé avant js/app.js, qui le crée (AD) et lui donne sa propre vue (V.admin) et sa propre
   dépendance de menu ; il ne connaît ni le Studio ni ses fichiers.
   Ce module n'est PAS un contrôle d'accès : l'API refuse (404) tout compte non autorisé. L'entrée de menu n'apparaît que si l'API a répondu « fondateur » à une requête d'accès authentifiée ;
   sinon la page se présente comme une page inexistante, sans rien révéler.
   Six blocs : solde Perfect Corp, comptes, utilisation par fonction (nombres agrégés lus en base par l'API, jamais d'identité), coûts officiels annoncés, état des fonctionnalités, quotas configurés. Aucun bouton de modification, de suppression, d'activation, ni de lancement d'une
   analyse ; le seul bouton « Actualiser » relit les mêmes sources en lecture. Les données indisponibles s'affichent « Indisponible », jamais zéro. Rien n'est écrit dans le navigateur
   (ni localStorage, ni sessionStorage) et aucun secret, identifiant d'utilisateur ou donnée personnelle ne transite par ici. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DermaiAdmin = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const ENDPOINT = '/api/admin-stats';
  const SECTIONS = ['features', 'quotas', 'credit', 'costs', 'usage'];
  const REASONS = {
    key_missing: 'La clé Perfect Corp n\'est pas configurée sur le serveur.',
    provider_error: 'Perfect Corp a refusé la requête ou n\'a pas pu répondre.',
    timeout: 'Délai dépassé.',
    network: 'Connexion au fournisseur impossible.',
    malformed: 'La réponse du fournisseur a une forme inconnue : rien n\'est affiché plutôt qu\'une valeur inventée.',
    not_applied: 'La fonction SQL de lecture n\'est pas appliquée dans la base (proposition 20261014120000_admin_overview.sql).',
    not_authorized: 'La base refuse la lecture : ajoutez votre identifiant dans la table admin_users (voir la proposition SQL).',
    unavailable: 'Source indisponible.'
  };
  const MSG = { loadFail: 'Cette section n\'a pas pu être chargée.', network: 'Connexion impossible. Vérifiez votre réseau.', history: 'Historique non disponible : aucune source confirmée, et les réservations de quota ne sont pas une dépense confirmée.' };
  const STATE = { closed: ['Fermée', 'c-badge--outline'], blocked: ['Bloquée', 'c-badge--low'], configured: ['Configurée : disponibilité non vérifiée', 'c-badge--mid'] };
  const PRE = { ok: 'OK', missing: 'Manquant', unverifiable: 'Non vérifiable' };

  function create(deps) {
    const d = deps || {};
    const esc = d.esc || (s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c])));
    const doFetch = (...a) => (d.fetchImpl || root.fetch).apply(root, a);
    const acc = () => { try { return d.account ? d.account() : null; } catch (e) { return null; } };
    const uid = () => { const a = acc(); return a && a.user && a.user.id ? a.user.id : null; };
    const epoch = () => { try { return d.epoch ? d.epoch() : 0; } catch (e) { return 0; } };
    const redraw = () => { try { if (d.render) d.render(); } catch (e) { /* sans importance */ } };
    const fresh = () => ({ who: undefined, access: 'unknown', loaded: false, busy: false, sec: {} });
    let ui = fresh();
    function sync() { const w = uid() || 'none'; if (ui.who !== w) { ui = fresh(); ui.who = w; } }

    async function request(section) {
      const a = acc(), token = a && a.accessToken ? await a.accessToken() : null;
      if (!token) return { status: 'error', message: MSG.loadFail };
      try {
        const r = await doFetch(ENDPOINT + '?section=' + section, { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
        if (r.status === 404) return { status: 'denied' };
        const j = r.ok ? await r.json().catch(() => null) : null;
        return j && j.ok === true ? { status: 'ok', data: j } : { status: 'error', message: MSG.loadFail };
      } catch (e) { return { status: 'error', message: MSG.network }; }
    }

    /* Accès : une seule requête par compte et par session. 404 (ou toute autre réponse) = pas d'entrée de menu. */
    async function probe() {
      sync();
      if (ui.access !== 'unknown' || !uid()) return;
      ui.access = 'checking';
      const ep = epoch(), who = ui.who, r = await request('access');
      if (ep !== epoch() || who !== ui.who) return;
      ui.access = r.status === 'ok' && r.data.admin === true ? 'yes' : 'no';
      if (ui.access === 'yes') redraw();
    }
    function ready() { probe(); return ui.access === 'yes'; }

    /* `silent` : appelée pendant l'affichage de la page, qui lit déjà l'état « chargement » (pas de nouvel affichage imbriqué). */
    async function loadAll(silent) {
      if (ui.busy) return;
      ui.busy = true;
      for (const s of SECTIONS) ui.sec[s] = Object.assign({}, ui.sec[s], { status: 'loading' });
      if (!silent) redraw();
      const ep = epoch(), who = ui.who, results = await Promise.all(SECTIONS.map(s => request(s)));
      if (ep !== epoch() || who !== ui.who) return;
      SECTIONS.forEach((s, i) => { ui.sec[s] = results[i]; });
      if (results.some(r => r.status === 'denied')) { ui.access = 'no'; ui.sec = {}; }   // droit retiré en cours de route : plus rien n'est montré
      ui.busy = false; ui.loaded = true; redraw();
    }

    /* ---------- Affichage ---------- */
    const when = iso => { try { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : t.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }); } catch (e) { return ''; } };
    const num = v => (typeof v === 'number' && Number.isFinite(v) ? new Intl.NumberFormat('fr-FR').format(v) : 'Indisponible');
    const note = (t, cls, role) => `<div class="c-notice${cls ? ' ' + cls : ''} u-my-5" role="${role || 'status'}"><div>${esc(t)}</div></div>`;
    const stamp = o => (o && o.fetchedAt ? `<p class="muted c-ad-stamp">Relevé du ${esc(when(o.fetchedAt))}${o.cached ? ' (mémorisé par le serveur : au plus 60 s pour le solde, les comptes et l\'utilisation, 10 min pour les coûts)' : ' (lecture directe)'}.</p>` : '');
    const card = (title, inner, id) => `<section class="c-card c-ad-card" id="${id}" aria-labelledby="${id}-t"><h2 class="h3" id="${id}-t">${esc(title)}</h2>${inner}</section>`;
    const wait = () => '<p class="muted" role="status"><span class="c-spinner" aria-hidden="true"></span> Chargement…</p>';
    const unavailable = o => `<div class="c-ad-unavail" role="status"><b>Indisponible</b><span>${esc(REASONS[o.reason] || REASONS.unavailable)}</span></div>${stamp(o)}`;
    /* Enveloppe d'une section : chargement, refus de chargement, ou données. */
    function shell(name, id, title, body) {
      const s = ui.sec[name];
      if (!s || s.status === 'loading') return card(title, wait(), id);
      if (s.status === 'error' || s.status === 'denied') return card(title, note(s.message || MSG.loadFail, 'c-notice--error', 'alert'), id);
      return card(title, body(s.data), id);
    }

    function creditBody(data) {
      const c = data.credit;
      if (!c || c.status !== 'ok') return unavailable(c || {});
      const total = c.spendable === null ? '<p class="c-ad-big c-ad-big--na">Indisponible</p><p class="muted">Aucune catégorie « Api » dans la réponse du fournisseur : le total n\'est pas calculé (ce n\'est pas zéro).</p>'
        : `<p class="c-ad-big">${esc(num(c.spendable))} <small>unités API</small></p><p class="muted">Total des lots dont le type commence par « Api » (convention du code officiel de Perfect Corp, non confirmée par la documentation en ligne). Les autres catégories ne sont pas additionnées.</p>`;
      const cats = c.categories.length ? `<ul class="c-ad-list">${c.categories.map(x => `<li><span>${esc(x.type)}</span><b>${esc(num(x.amount))}</b>${x.spendable ? '' : '<span class="c-badge c-badge--outline">non dépensable en API</span>'}</li>`).join('')}</ul>` : '<p class="muted">Aucune catégorie retournée.</p>';
      return `${total}${cats}<p class="c-ad-history"><b>Consommation 24 h, 7 j, 30 j :</b> ${esc(MSG.history)}</p>${stamp(c)}`;
    }

    function costItem(x) {
      const cost = typeof x.amount === 'number' ? `${esc(num(x.amount))}${x.unit ? ' ' + esc(x.unit) : ''}` : 'Indisponible';
      return `<li><span>${esc(x.description || 'Sans description')}${x.slug ? ` <code>${esc(x.slug)}</code>` : ''}${x.procUnit ? `<small> · par ${esc(x.procUnit)}</small>` : ''}${x.matchNote ? `<small> · ${esc(x.matchNote)}</small>` : ''}</span><b>${cost}</b></li>`;
    }
    function costsBody(data) {
      const c = data.costs;
      if (!c || c.status !== 'ok') return unavailable(c || {});
      const groups = c.groups.map(g => {
        const exp = (c.expected.find(e => e.category === g.category) || { slugs: [] }).slugs;
        return `<div class="c-ad-group"><h3 class="c-ad-h">${esc(g.category)}</h3>${g.items.length ? `<ul class="c-ad-list">${g.items.map(costItem).join('')}</ul>` : `<p class="muted">Aucun coût officiel rapproché de cette fonction (identifiants attendus : ${exp.map(s => `<code>${esc(s)}</code>`).join(', ') || 'aucun'}).</p>`}</div>`;
      }).join('');
      const un = c.unmatched.length ? `<details class="c-why"><summary>Non rapprochés d'une fonction DERMAI (${c.unmatched.length})</summary><ul class="c-ad-list">${c.unmatched.map(costItem).join('')}</ul></details>` : '';
      return `<p class="muted">Coût officiel ANNONCÉ par Perfect Corp, par type d'opération. Ce n'est pas la consommation réelle observée, qui n'est pas disponible. Plusieurs lignes peuvent exister pour une même fonction : aucun coût unique n'est attribué à une catégorie.</p>${groups}${un}${c.truncated ? note('Liste tronquée : toutes les pages n\'ont pas été lues.', 'c-notice--warning') : ''}<p class="muted c-ad-stamp">${esc(String(c.total))} ligne${c.total > 1 ? 's' : ''} sur ${esc(String(c.pages))} page${c.pages > 1 ? 's' : ''}.</p>${stamp(c)}`;
    }

    /* Comptes et utilisation : NOMBRES agrégés lus en base par l'API (fonction SQL admin_overview). Une valeur absente ou invalide s'affiche « Indisponible », jamais 0. */
    const pair = (a, b) => `${esc(num(a))} <small>sur 7 j</small> · ${esc(num(b))} <small>sur 30 j</small>`;
    function accountsBody(data) {
      const u = data.usage;
      if (!u || u.status !== 'ok') return unavailable(u || {});
      const a = u.accounts, row = (label, v) => `<li><span>${label}</span><b>${v}</b></li>`;
      return `<p class="c-ad-big">${esc(num(a.total))} <small>comptes</small></p>
        <ul class="c-ad-list">${row('Nouveaux comptes', pair(a.new_7d, a.new_30d))}${row('Connectés (dernière connexion)', pair(a.signed_in_7d, a.signed_in_30d))}${row('Actifs (au moins une demande)', pair(a.active_7d, a.active_30d))}${row('Retour à 7 jours', esc(num(a.returned_7d)))}${row('Inactifs depuis 30 jours', esc(num(a.inactive_30d)))}${row('Jamais utilisé une fonction', esc(num(a.never_used)))}</ul>
        <p class="muted">Actif : au moins une demande (analyse, simulation, maquillage ou cheveux) sur la période. Retour à 7 jours : compte créé il y a plus de 7 jours et actif ces 7 derniers jours. Inactif : compte de plus de 30 jours sans aucune demande sur 30 jours. « Connectés » repose sur la dernière connexion enregistrée, une seule date par compte. Nombres seulement : aucun compte n'est identifié.</p>${stamp(u)}`;
    }
    function usageBody(data) {
      const u = data.usage;
      if (!u || u.status !== 'ok') return unavailable(u || {});
      const rows = u.functions.map(f => {
        if (!f.available) return `<article class="c-ad-row"><div class="c-ad-row__hd"><h3 class="c-ad-h">${esc(f.name)}</h3><span class="c-badge c-badge--outline">Non mesurée</span></div><p class="muted">Aucun compteur en base pour cette fonction (proposition SQL de quota non appliquée) : rien n'est affiché plutôt qu'un zéro.</p></article>`;
        const unit = typeof f.units_30d === 'number' ? `<div><dt>Unités</dt><dd>${pair(f.units_7d, f.units_30d)}</dd></div>` : '';
        return `<article class="c-ad-row"><div class="c-ad-row__hd"><h3 class="c-ad-h">${esc(f.name)}</h3><b class="c-ad-limit">${esc(num(f.runs_30d))} <small>sur 30 j</small></b></div>
          <dl class="c-ad-dl"><div><dt>Demandes</dt><dd>${pair(f.runs_7d, f.runs_30d)}</dd></div><div><dt>Comptes concernés</dt><dd>${esc(num(f.users_30d))} <small>sur 30 j</small></dd></div>${unit}</dl></article>`;
      }).join('');
      const s = u.savedAnalyses;
      return `<p class="muted">Une demande = une réservation de quota, c'est-à-dire une demande qui a atteint l'étape fournisseur, réussie ou non. Ce n'est pas un coût confirmé ni un nombre de résultats obtenus.</p>${rows}
        <div class="c-ad-row"><h3 class="c-ad-h">Analyses enregistrées dans l'historique</h3><dl class="c-ad-dl"><div><dt>Total</dt><dd>${esc(num(s.total))}</dd></div><div><dt>Sur 30 jours</dt><dd>${esc(num(s.last_30d))}</dd></div><div><dt>Comptes concernés</dt><dd>${esc(num(s.users))}</dd></div></dl></div>${stamp(u)}`;
    }

    function featuresBody(data) {
      const rows = data.features.map(f => {
        const st = STATE[f.state] || ['Inconnu', 'c-badge--outline'];
        const auth = f.authorization.label + (typeof f.authorization.count === 'number' && f.authorization.mode === 'list' ? ` (${f.authorization.count} compte${f.authorization.count > 1 ? 's' : ''})` : '');
        return `<article class="c-ad-row"><div class="c-ad-row__hd"><h3 class="c-ad-h">${esc(f.name)}</h3><span class="c-badge ${st[1]}">${esc(st[0])}</span></div>
          <dl class="c-ad-dl"><div><dt>Activation</dt><dd>${f.enabled ? 'Activée' : 'Non activée'} <small>(variable ${esc(f.enabledSource)})</small></dd></div>
          <div><dt>Autorisation</dt><dd>${esc(auth)}${f.authorizationSource ? ` <small>(variable ${esc(f.authorizationSource)})</small>` : ''}</dd></div>
          <div><dt>Prérequis</dt><dd>${f.prerequisites.map(p => `${esc(p.label)} : <b>${esc(PRE[p.state] || p.state)}</b>`).join('<br>')}</dd></div>
          ${typeof f.units === 'number' ? `<div><dt>Coût annoncé</dt><dd>${esc(String(f.units))} unité${f.units > 1 ? 's' : ''} par essai${f.pathConfirmed ? '' : ' <small>(chemin REST non confirmé)</small>'}</dd></div>` : ''}
          ${f.closedReason ? `<div><dt>Raison</dt><dd>${esc(f.closedReason)}</dd></div>` : ''}${f.note ? `<div><dt>Note</dt><dd>${esc(f.note)}</dd></div>` : ''}</dl></article>`;
      }).join('');
      return `<p class="muted">Configuration lue par le serveur à chaque affichage. « Configurée » ne signifie pas « disponible » : la fonction SQL de quota ne peut pas être vérifiée sans réserver un crédit. Les identifiants des comptes autorisés ne sont jamais affichés.</p>${rows}`;
    }

    function quotasBody(data) {
      const rows = data.quotas.map(q => `<article class="c-ad-row"><div class="c-ad-row__hd"><h3 class="c-ad-h">${esc(q.name)}</h3><b class="c-ad-limit">${esc(num(q.limit))} ${esc(q.unit)} / ${esc(num(q.windowHours))} h</b></div>
        <dl class="c-ad-dl"><div><dt>Limite</dt><dd>${esc(q.limitSource)} <small>(${esc(q.limitVariable)})</small></dd></div><div><dt>Fenêtre</dt><dd>${esc(q.windowSource)} <small>(${esc(q.windowVariable)})</small></dd></div>
        <div><dt>Par défaut du code</dt><dd>${esc(num(q.defaults.limit != null ? q.defaults.limit : q.defaults.units))} ${esc(q.unit)} / ${esc(num(q.defaults.hours))} h</dd></div>${q.note ? `<div><dt>Note</dt><dd>${esc(q.note)}</dd></div>` : ''}</dl></article>`).join('');
      return `<p class="muted">Limites CONFIGURÉES côté serveur, pas la consommation. Si une variable n'est pas définie, c'est la valeur par défaut du code qui s'applique : la valeur réelle de Vercel n'est connue que par ce biais.</p>${rows}`;
    }

    function page() {
      sync();
      const missing = `<div class="pagehead"><h1>Page introuvable</h1><p>Cette page n'existe pas.</p></div><div class="stack"><button class="c-btn c-btn--secondary c-btn--block" data-go="home" data-reset="1">Retour à l'accueil</button></div>`;
      if (!uid()) return missing;
      probe();
      if (ui.access === 'unknown' || ui.access === 'checking') return `<div class="pagehead"><h1>Chargement…</h1></div>`;
      if (ui.access !== 'yes') return missing;
      if (!ui.loaded && !ui.busy) loadAll(true);
      return `<div class="pagehead"><p class="kicker">Fondateur</p><h1>Administration</h1><p>Lecture seule : cette page ne modifie rien et ne lance aucune analyse.</p></div>
        <div class="c-ad-bar"><button type="button" class="c-btn c-btn--secondary" data-ad="refresh"${ui.busy ? ' disabled' : ''} aria-busy="${ui.busy}">${ui.busy ? 'Actualisation…' : 'Actualiser'}</button><span class="muted">Relit les mêmes sources, sans effet.</span></div>
        <div class="c-ad-grid">${shell('credit', 'ad-credit', 'Solde Perfect Corp', creditBody)}${shell('usage', 'ad-accounts', 'Comptes', accountsBody)}${shell('usage', 'ad-usage', 'Utilisation par fonction', usageBody)}${shell('costs', 'ad-costs', 'Coûts officiels annoncés', costsBody)}${shell('features', 'ad-features', 'Fonctionnalités', featuresBody)}${shell('quotas', 'ad-quotas', 'Quotas configurés', quotasBody)}</div>`;
    }

    function attach(x) {
      if (!x || !x.addEventListener) return;
      x.addEventListener('click', ev => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-ad]') : null;
        if (!el || el.disabled) return;
        sync();
        if (el.getAttribute('data-ad') === 'refresh' && ui.access === 'yes') { ui.loaded = false; loadAll(); }
      });
    }
    function reset() { ui = fresh(); }
    return { page, attach, probe, ready, reset, state: () => ui };
  }
  return { create, ENDPOINT, SECTIONS, REASONS, MSG };
});
