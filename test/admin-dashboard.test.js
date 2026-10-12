'use strict';
/* Page d'administration du fondateur : module d'écran (js/admin-dashboard.js) et son hébergement par js/makeup-studio.js, sans navigateur. Aucune requête réelle : fetchImpl est un faux.
   Les parcours complets (menu, 420 px, clavier, accès refusé) sont dans test/admin-browser.test.js ; la protection du serveur dans test/admin-server.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AD = require('../js/admin-dashboard.js');
const S = require('../js/makeup-studio.js');
const A = require('../server/admin.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const ENV = { PERFECT_CORP_API_KEY: 'k', SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'a', DERMAI_ANALYSIS_ENABLED: '1', DERMAI_MAKEUP_ENABLED: '1', DERMAI_MAKEUP_ALLOWED_USER_IDS: '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222' };
const NOW = '2026-10-14T09:30:00.000Z';
const BODY = {
  access: { ok: true, admin: true },
  features: { ok: true, generatedAt: NOW, features: A.featureRows(ENV) },
  quotas: { ok: true, generatedAt: NOW, quotas: A.quotaRows({ DERMAI_MAX_HAIR_UNITS_PER_PERIOD: '12' }) },
  credit: { ok: true, credit: { status: 'ok', fetchedAt: NOW, cached: false, spendable: 150, categories: [{ type: 'Api Purchased', amount: 120, spendable: true }, { type: 'Api Gift', amount: 30, spendable: true }, { type: 'Web Trial', amount: 5, spendable: false }] } },
  usage: { ok: true, usage: { status: 'ok', fetchedAt: NOW, cached: false, accounts: { total: 42, new_7d: 5, new_30d: 17, signed_in_7d: 20, signed_in_30d: 31, active_7d: 12, active_30d: 25, returned_7d: 7, never_used: 9, inactive_30d: 11 },
    functions: [{ key: 'analysis', name: 'Analyse de la peau', available: true, runs_7d: 30, runs_30d: 90, users_30d: 25 }, { key: 'simulation', name: 'Simulation cosmétique', available: true, runs_7d: 4, runs_30d: 10, users_30d: 6 }, { key: 'makeup', name: 'Studio Beauté : maquillage', available: false }, { key: 'hair', name: 'Studio Beauté : cheveux', available: true, runs_7d: 3, runs_30d: 8, users_30d: 4, units_7d: 5, units_30d: 14 }],
    savedAnalyses: { total: 120, last_30d: 40, users: 30 } } },
  costs: { ok: true, costs: Object.assign({ status: 'ok', fetchedAt: NOW, cached: true, total: 3, pages: 1, truncated: false }, A.matchCosts([{ description: 'Skin <b>analysis</b>', amount: 4, unit: 'unit', procUnit: 'task', slug: 'skin-analysis' }, { description: 'Hair color', amount: null, unit: 'unit', procUnit: null, slug: 'hair-color' }, { description: 'Autre', amount: 3, unit: 'unit', procUnit: null, slug: 'face-attr-analysis' }])) }
};
function setup(o = {}) {
  const ctx = Object.assign({ uid: 'u1', token: 'tok-1', epoch: 0, renders: 0, calls: [], access: 'yes', overrides: {} }, o);
  const acct = () => (ctx.uid ? { user: { id: ctx.uid }, accessToken: async () => ctx.token } : null);
  const fetchImpl = async (url, init = {}) => {
    const sec = (String(url).match(/section=([a-z]+)/) || [])[1], rec = { url: String(url), method: init.method || 'GET', headers: init.headers || {} }; ctx.calls.push(rec);
    if (sec === 'access') return ctx.access === 'yes' ? json(200, BODY.access) : ctx.access === 'network' ? Promise.reject(new TypeError('network')) : json(ctx.access === 'error' ? 500 : 404, 'Not found');
    const ov = ctx.overrides[sec]; if (ov) return typeof ov === 'function' ? ov(rec) : ov;
    return json(200, BODY[sec]);
  };
  ctx.ad = AD.create({ account: acct, epoch: () => ctx.epoch, render: () => { ctx.renders++; }, fetchImpl });
  return ctx;
}
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const open = async ctx => { ctx.ad.page(); await tick(); await tick(); const h = ctx.ad.page(); await tick(15); return ctx.ad.page(); };
const sections = ctx => ctx.calls.filter(c => !/section=access/.test(c.url));
const txt = h => h.replace(/&#39;/g, '\'');

test('AU1 accès : seul « fondateur » ouvre le menu ; 404, erreur, réseau ou visiteur → pas de menu, page « introuvable » sans aucun mot sur l\'administration ; une seule requête d\'accès par compte', async () => {
  const c = setup(); assert.equal(c.ad.ready(), false, 'avant la réponse : masqué'); await tick(); assert.equal(c.ad.ready(), true); c.ad.ready(); c.ad.page(); await tick();
  assert.equal(c.calls.filter(x => /section=access/.test(x.url)).length, 1); assert.deepEqual(c.calls[0], { url: '/api/admin-stats?section=access', method: 'GET', headers: { Authorization: 'Bearer tok-1' } });
  for (const access of ['404', 'error', 'network']) {
    const n = setup({ access }); n.ad.ready(); await tick(); assert.equal(n.ad.ready(), false, access); const h = txt(n.ad.page());
    assert.match(h, /Page introuvable/); assert.ok(!/Administration|fondateur|Fondateur|solde|quota/i.test(h), 'rien ne révèle la page : ' + access); assert.equal(sections(n).length, 0, 'aucune section demandée');
  }
  const v = setup({ uid: null }); assert.equal(v.ad.ready(), false); assert.match(v.ad.page(), /Page introuvable/); assert.equal(v.calls.length, 0, 'visiteur : aucune requête');
  const t = setup({ token: null }); t.ad.ready(); await tick(); assert.equal(t.ad.ready(), false); assert.equal(t.calls.length, 0, 'sans jeton : aucune requête');
});

test('AU2 compte changé ou session périmée : l\'accès et les données ne passent jamais à un autre compte ; une réponse tardive d\'une ancienne session est ignorée', async () => {
  const c = setup(); c.ad.ready(); await tick(); assert.equal(c.ad.ready(), true);
  c.uid = 'u2'; c.access = '404'; assert.equal(c.ad.ready(), false, 'autre compte : accès recalculé, jamais repris'); await tick(); assert.equal(c.ad.ready(), false); assert.match(c.ad.page(), /Page introuvable/);
  const slow = setup(); const orig = slow.ad.probe; slow.ad.ready(); slow.epoch++; await tick(20); assert.equal(slow.ad.state().access, 'checking', 'réponse d\'une ancienne session : ignorée'); 
  const out = setup(); await open(out); out.uid = null; assert.match(out.ad.page(), /Page introuvable/); assert.deepEqual(Object.keys(out.ad.state().sec), [], 'déconnexion : plus aucune donnée');
});

test('AU3 page du fondateur : cinq sections demandées en lecture (GET, jeton), aucune autre route ; chargement visible puis les six blocs ; aucune action de modification', async () => {
  const c = setup(); c.ad.ready(); await tick();
  const first = c.ad.page(); assert.match(first, /Chargement…/); assert.match(first, /Lecture seule/); await tick(15);
  assert.deepEqual(sections(c).map(x => x.url).sort(), ['/api/admin-stats?section=costs', '/api/admin-stats?section=credit', '/api/admin-stats?section=features', '/api/admin-stats?section=quotas', '/api/admin-stats?section=usage']);
  assert.ok(c.calls.every(x => x.method === 'GET' && x.headers.Authorization === 'Bearer tok-1'));
  const h = txt(c.ad.page());
  for (const l of ['Solde Perfect Corp', 'Comptes', 'Utilisation par fonction', 'Coûts officiels annoncés', 'Fonctionnalités', 'Quotas configurés', 'Administration', 'Lecture seule']) assert.match(h, new RegExp(l));
  assert.equal((h.match(/<button/g) || []).length, 1, 'un seul bouton : Actualiser'); assert.match(h, /data-ad="refresh"/); assert.ok(!/<form|<input|<select|<textarea|href=|data-act=|data-go="(?!home)|supprimer|désactiver|activer |modifier|lancer/i.test(h.replace(/data-ad="refresh"/, '')), 'aucune commande de modification');
  assert.equal(c.renders > 0, true);
});

test('AU4 solde : total « Api » annoncé avec sa source, catégories telles que retournées, historique « non disponible », date du relevé ; jamais zéro à la place d\'une absence', async () => {
  const c = setup(); const h = txt(await open(c));
  assert.match(h, /150 <small>unités API/); assert.match(h, /commence par « Api »/); assert.match(h, /non confirmée par la documentation/); assert.match(h, /Api Purchased/); assert.match(h, /Web Trial/); assert.match(h, /non dépensable en API/); assert.match(h, /Les autres catégories ne sont pas additionnées/);
  assert.match(h, /Historique non disponible/); assert.match(h, /ne sont pas une dépense confirmée/); assert.match(h, /Relevé du .*\(lecture directe\)/);
  const na = setup({ overrides: { credit: json(200, { ok: true, credit: { status: 'ok', fetchedAt: NOW, spendable: null, categories: [] } }) } }); const n = txt(await open(na));
  assert.match(n, /Indisponible/); assert.match(n, /ce n'est pas zéro/); assert.ok(!/<p class="c-ad-big">0/.test(n));
  for (const reason of Object.keys(AD.REASONS)) {
    const u = setup({ overrides: { credit: json(200, { ok: true, credit: { status: 'unavailable', reason, fetchedAt: NOW } }) } }); const hu = txt(await open(u));
    assert.match(hu, /<b>Indisponible<\/b>/, reason); assert.ok(hu.includes(AD.REASONS[reason].replace(/&/g, '&amp;')) || hu.includes(txt(AD.REASONS[reason])), reason); assert.ok(!/c-ad-big">/.test(hu.split('id="ad-accounts"')[0]), reason + ' : aucun chiffre de solde');
  }
  const odd = setup({ overrides: { credit: json(200, { ok: true, credit: { status: 'unavailable', reason: '<script>x</script>', fetchedAt: NOW } }) } }); assert.match(txt(await open(odd)), new RegExp(AD.REASONS.unavailable), 'cause inconnue : message générique, rien d\'injecté');
});

test('AU5 coûts : groupes par fonction DERMAI, lignes telles que reçues, montant absent = « Indisponible », « non rapprochés » à part, jamais un coût unique par catégorie ; descriptions échappées', async () => {
  const c = setup(); const h = txt(await open(c));
  for (const g of ['Analyse cutanée', 'Simulation', 'Maquillage', 'Coiffure et couleur de cheveux']) assert.match(h, new RegExp(`<h3 class="c-ad-h">${g}</h3>`));
  assert.ok(!/<b>4 unit<\/b>/.test('') && /<b>4 unit<\/b>/.test(h), 'coût officiel de l\'analyse tel que reçu'); assert.match(h, /Skin &lt;b&gt;analysis&lt;\/b&gt;/); assert.ok(!/<b>analysis<\/b>/.test(h));
  assert.match(h, /<code>hair-color<\/code>[\s\S]{0,80}<b>Indisponible<\/b>/, 'montant absent : indisponible, pas 0'); assert.match(h, /Aucun coût officiel rapproché de cette fonction \(identifiants attendus : <code>skin-simulation<\/code>/);
  assert.match(h, /Non rapprochés d'une fonction DERMAI \(1\)/); assert.match(h, /<code>face-attr-analysis<\/code>/); assert.match(h, /Ce n'est pas la consommation réelle observée/); assert.match(h, /aucun coût unique n'est attribué à une catégorie/);
  assert.match(h, /3 lignes sur 1 page\./); assert.match(h, /mémorisé par le serveur/);
  const tr = setup({ overrides: { costs: json(200, { ok: true, costs: Object.assign({}, BODY.costs.costs, { truncated: true }) }) } }); assert.match(txt(await open(tr)), /Liste tronquée/);
  const bad = setup({ overrides: { costs: json(200, { ok: true, costs: { status: 'unavailable', reason: 'malformed', fetchedAt: NOW } }) } }); const hb = txt(await open(bad)); assert.match(hb, /forme inconnue/); assert.ok(!/c-ad-group/.test(hb), 'aucun groupe inventé');
});

test('AU6 fonctionnalités et quotas : libellés d\'état, autorisation avec NOMBRE de comptes (jamais d\'identifiants), prérequis, fermetures expliquées, quota en unités pour les cheveux, sources des valeurs', async () => {
  const c = setup(); const h = txt(await open(c));
  assert.match(h, /Analyse cutanée<\/h3><span class="c-badge c-badge--mid">Configurée : disponibilité non vérifiée/); assert.match(h, /Tous les comptes connectés/); assert.match(h, /Maquillage \(Studio Beauté\)<\/h3>/); assert.match(h, /Liste restreinte \(2 comptes\)/);
  assert.match(h, /Cheveux : Coiffures et perruques<\/h3><span class="c-badge c-badge--outline">Fermée/); assert.match(h, /chemin REST non confirmé/); assert.match(h, /Fonction SQL reserve_analysis : <b>Non vérifiable<\/b>/); assert.match(h, /Clé Perfect Corp configurée : <b>OK<\/b>/);
  assert.match(h, /Aucune liste d'utilisateurs/); assert.match(h, /variable DERMAI_ANALYSIS_ENABLED/); assert.match(h, /« Configurée » ne signifie pas « disponible »/); assert.ok(!/11111111|22222222/.test(h), 'aucun identifiant');
  assert.match(h, /12 unités \/ 24 h/); assert.match(h, /Quota compté en unités Perfect Corp documentées/); assert.match(h, /valeur par défaut du code/); assert.match(h, /variable d'environnement/); assert.match(h, /3 analyses \/ 24 h/); assert.match(h, /Limites CONFIGURÉES côté serveur, pas la consommation/);
  assert.ok(!/consommé|restant|utilisé/i.test(h.split('Quotas configurés')[1].split('Limites CONFIGURÉES')[0]), 'aucune consommation affichée');
  const blocked = setup({ overrides: { features: json(200, { ok: true, features: A.featureRows(Object.assign({}, ENV, { PERFECT_CORP_API_KEY: '' })) }) } }); const hb = txt(await open(blocked)); assert.match(hb, /Maquillage \(Studio Beauté\)<\/h3><span class="c-badge c-badge--low">Bloquée/); assert.match(hb, /Clé Perfect Corp configurée : <b>Manquant<\/b>/);
});

test('AU7 une section en échec n\'efface pas les autres ; message d\'erreur clair ; un 404 en cours de route retire tout (droit perdu) ; « Actualiser » relit sans doubler les requêtes', async () => {
  const c = setup({ overrides: { quotas: () => Promise.reject(new TypeError('network')), costs: json(500, 'x') } }); const h = txt(await open(c));
  assert.match(h, /Connexion impossible/); assert.match(h, /n'a pas pu être chargée/); assert.match(h, /150 <small>unités API/, 'le solde reste affiché'); assert.match(h, /Tous les comptes connectés/);
  const d = setup({ overrides: { credit: json(404, 'Not found') } }); const hd = txt(await open(d)); assert.match(hd, /Page introuvable/); assert.ok(!/150|Solde|Quotas|Fonctionnalités/.test(hd), 'droit retiré : plus rien n\'est montré'); assert.equal(d.ad.ready(), false);
  const r = setup(); await open(r); const before = sections(r).length; const doc = { addEventListener: (t, fn) => { doc.fn = fn; } }; r.ad.attach(doc);
  const btn = { disabled: false, getAttribute: k => (k === 'data-ad' ? 'refresh' : null), closest: () => btn };
  doc.fn({ target: btn }); doc.fn({ target: btn }); await tick(25); assert.equal(sections(r).length, before + 5, 'un seul rechargement malgré le double clic');
  const busyHtml = (() => { const x = setup({ overrides: { credit: () => new Promise(res => setTimeout(() => res(json(200, BODY.credit)), 30)) } }); return x; })(); await open(busyHtml); busyHtml.ad.attach(doc); doc.fn({ target: btn }); assert.match(busyHtml.ad.page(), /data-ad="refresh" disabled/); await tick(60);
});

test('AU8 module AUTONOME : lecture seule, une seule route, aucun stockage, aucune écriture HTML directe, aucun fournisseur ni secret ; ne connaît ni le Studio ni les modules capillaires, et n\'en est connu d\'aucun', async () => {
  const src = read('js/admin-dashboard.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual([...new Set(src.match(/\/api\/[a-z-]+/g))], ['/api/admin-stats']); assert.ok(!/localStorage|sessionStorage|indexedDB|innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|document\.write|XMLHttpRequest|sendBeacon|perfectcorp|makeupar|supabase|PERFECT_CORP|method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src));
  assert.ok(!/studio|makeup|hair|DermaiStudio|DermaiHair|DermaiMakeup|require\(['"]\.\/(makeup|hair)/i.test(src), 'le module d\'administration ne mentionne pas le Studio Beauté');
  assert.deepEqual(AD.SECTIONS, ['features', 'quotas', 'credit', 'costs', 'usage']);
  for (const f of ['js/makeup-studio.js', 'js/makeup-data.js', 'js/hair-studio.js', 'js/hair-data.js']) assert.ok(!/admin|DermaiAdmin/i.test(read(f)), f + ' ne contient plus rien d\'administratif');
  /* deux instances côte à côte : états et requêtes indépendants */
  const a = setup(), st = S.create({ account: () => ({ user: { id: 'u1' }, accessToken: async () => 'tok' }), epoch: () => 0, render: () => {}, session: () => null, storage: () => null, fetchImpl: async () => json(200, { ok: true, available: false, features: [] }) });
  assert.equal(st.admin, undefined, 'le Studio n\'expose aucune administration'); assert.equal(typeof st.page, 'function'); assert.equal(st.page.length, 0, 'page() du Studio ne prend aucun paramètre de vue');
  a.ad.ready(); await tick(); assert.equal(a.ad.ready(), true); st.ready(); await tick();
  const before = JSON.stringify(st.state()); await open(a); a.ad.attach({ addEventListener() {} }); assert.equal(JSON.stringify(st.state()), before, 'ouvrir l\'administration ne touche pas l\'état du Studio');
  st.reset(); st.clear(); assert.equal(a.ad.state().access, 'yes', 'réinitialiser le Studio ne touche pas l\'administration'); assert.ok(a.ad.state().loaded);
  assert.match(txt(a.ad.page()), /Solde Perfect Corp/); assert.ok(!/Administration/.test(st.page()), 'la page du Studio ne parle jamais de l\'administration');
  assert.ok(!a.calls.some(c => c.method !== 'GET'), 'aucune requête autre que GET');
});

test('AU9 comptes et utilisation : nombres lus tels que reçus, fonction sans compteur = « Non mesurée » (jamais zéro), valeur invalide = « Indisponible », causes lisibles, aucun compte identifié', async () => {
  const c = setup(); const h = txt(await open(c));
  assert.match(h, /<p class="c-ad-big">42 <small>comptes/); assert.match(h, /Nouveaux comptes<\/span><b>5 <small>sur 7 j<\/small> · 17 <small>sur 30 j/); assert.match(h, /Actifs \(au moins une demande\)<\/span><b>12 <small>sur 7 j<\/small> · 25/);
  assert.match(h, /Retour à 7 jours<\/span><b>7</); assert.match(h, /Inactifs depuis 30 jours<\/span><b>11</); assert.match(h, /Jamais utilisé une fonction<\/span><b>9</);
  assert.match(h, /Analyse de la peau/); assert.match(h, /Demandes<\/dt><dd>30 <small>sur 7 j<\/small> · 90 <small>sur 30 j/); assert.match(h, /Unités<\/dt><dd>5 <small>sur 7 j<\/small> · 14/);
  assert.equal((h.match(/Unités<\/dt>/g) || []).length, 1, 'les unités ne concernent que les cheveux');
  assert.match(h, /Studio Beauté : maquillage<\/h3><span class="c-badge c-badge--outline">Non mesurée/); assert.match(h, /rien n'est affiché plutôt qu'un zéro/);
  assert.match(h, /Analyses enregistrées dans l'historique/); assert.match(h, /Total<\/dt><dd>120</); assert.match(h, /ce n'est pas un coût confirmé|Ce n'est pas un coût confirmé/);
  assert.match(h, /Nombres seulement : aucun compte n'est identifié/); assert.ok(!/@|[0-9a-f]{8}-[0-9a-f]{4}-/.test(h.replace(/<[^>]+>/g, ' ').replace(/20261014120000/g, '')), 'ni e-mail ni identifiant');
  const bad = JSON.parse(JSON.stringify(BODY.usage)); bad.usage.accounts.total = null; bad.usage.accounts.active_7d = null; bad.usage.functions[0].runs_30d = null; bad.usage.savedAnalyses.total = null;
  const n = txt(await open(setup({ overrides: { usage: json(200, bad) } })));
  assert.match(n, /<p class="c-ad-big">Indisponible <small>comptes/); assert.match(n, /Actifs \(au moins une demande\)<\/span><b>Indisponible <small>sur 7 j/); assert.match(n, /Total<\/dt><dd>Indisponible</); assert.ok(!/<p class="c-ad-big">0 /.test(n));
  for (const [reason, re] of [['not_applied', /fonction SQL de lecture n'est pas appliquée/], ['not_authorized', /table admin_users/], ['timeout', /Délai dépassé/], ['malformed', /forme inconnue/]]) {
    const u = txt(await open(setup({ overrides: { usage: json(200, { ok: true, usage: { status: 'unavailable', reason, fetchedAt: NOW } }) } })));
    assert.match(u, re, reason); assert.equal((u.match(/c-ad-unavail/g) || []).length, 2, 'les deux blocs disent « Indisponible » avec la cause'); assert.ok(!/<p class="c-ad-big">0/.test(u));
    assert.match(u, /Solde Perfect Corp/); assert.match(u, /150 <small>unités API/, 'le solde reste affiché');
  }
  const evil = JSON.parse(JSON.stringify(BODY.usage)); evil.usage.functions[0].name = '<img src=x onerror=alert(1)>'; const e = await open(setup({ overrides: { usage: json(200, evil) } })); assert.ok(!/<img src=x/.test(e), 'noms échappés');
});
