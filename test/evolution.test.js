'use strict';
/* DERMAI Évolution (js/evolution.js) : bilan en langage clair entre deux analyses ENREGISTRÉES. Tests purs, sans navigateur ni réseau.
   Vérifie : classement exact au seuil technique provisoire, indicateurs absents jamais classés, huile / texture / radiance et contour des yeux traités sans jugement,
   analyses non enregistrées exclues, cas à une seule analyse ou sans photo, départ du programme, aucune causalité, aucun accès réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EvoReal = require('../js/evolution.js');
/* Les apostrophes sont échappées dans le HTML (&#39;) : on les rétablit pour lire le texte tel que l'utilisatrice le voit. */
const Evo = Object.assign({}, EvoReal, { create: deps => { const e = EvoReal.create(deps), w = Object.assign({}, e); ['card', 'photos', 'priorities'].forEach(k => { w[k] = (...a) => e[k](...a).replace(/&#39;/g, '\''); }); return w; } });
const SkinModel = require('../js/skin-model.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KEYS = SkinModel.METRIC_KEYS;

/* Entrée SCANS minimale : tous les indicateurs à `base`, surchargés par `over` (null = valeur absente). */
const mk = (id, day, over = {}, extra = {}) => {
  const normalized = { globalScore: 'g' in over ? over.g : 60 };
  KEYS.forEach(k => { const v = k in over ? over[k] : 50; if (v !== undefined) normalized[k] = { uiScore: v, rawScore: v }; });
  return Object.assign({ id, real: true, saved: true, rec: { id: 'rec-' + id, analyzedAt: `2026-10-${String(day).padStart(2, '0')}T09:00:00.000Z` }, normalized, photo: '' }, extra);
};
/* Deux analyses enregistrées : le bilan n'est produit que si l'historique en contient au moins deux. */
const TWO = [mk(90, 1), mk(91, 2)];
const rep = (a, b) => Evo.report(Evo.fromScan(a), Evo.fromScan(b));
const rowOf = (r, key) => ['up', 'flat', 'down', 'observed', 'eye'].map(g => r.groups[g].find(x => x.key === key)).find(Boolean);
const groupOf = (r, key) => ['up', 'flat', 'down', 'observed', 'eye'].find(g => r.groups[g].some(x => x.key === key));

test('EV1 classement exact au seuil provisoire : +3 hausse, +2 faible, −2 faible, −3 baisse, 0 faible', () => {
  assert.equal(SkinModel.TREND_STEP, 2);
  const r = rep(mk(0, 1), mk(1, 8, { acne: 53, pores: 52, hydration: 48, redness: 47, pigmentation: 50, wrinkles: 80, firmness: 20 }));
  assert.equal(groupOf(r, 'acne'), 'up'); assert.equal(rowOf(r, 'acne').delta, 3);
  assert.equal(groupOf(r, 'pores'), 'flat'); assert.equal(groupOf(r, 'hydration'), 'flat');
  assert.equal(groupOf(r, 'redness'), 'down'); assert.equal(rowOf(r, 'redness').delta, -3);
  assert.equal(groupOf(r, 'pigmentation'), 'flat'); assert.equal(groupOf(r, 'wrinkles'), 'up'); assert.equal(groupOf(r, 'firmness'), 'down');
  assert.equal(r.threshold, 2);
  assert.ok(r.groups.up.every(x => x.delta > 2) && r.groups.down.every(x => x.delta < -2) && r.groups.flat.every(x => Math.abs(x.delta) <= 2));
});

test('EV2 le classement suit les dates, pas l\'ordre de sélection', () => {
  const old = mk(0, 1, { acne: 40 }), recent = mk(1, 9, { acne: 60 });
  const r = rep(recent, old);
  assert.equal(r.swapped, true); assert.equal(r.before.at, old.rec.analyzedAt);
  assert.equal(rowOf(r, 'acne').before, 40); assert.equal(rowOf(r, 'acne').after, 60); assert.equal(groupOf(r, 'acne'), 'up');
  assert.equal(rep(old, recent).swapped, false);
});

test('EV3 un indicateur absent ou nul d\'un côté n\'est ni classé ni inventé', () => {
  const r = rep(mk(0, 1, { acne: null, pores: undefined, texture: null }), mk(1, 8, { acne: 70, pores: 70, texture: 70 }));
  ['acne', 'pores', 'texture'].forEach(k => assert.equal(groupOf(r, k), undefined, k));
  assert.deepEqual(r.missing.sort(), ['acne', 'pores', 'texture'].map(k => SkinModel.METRIC_LABELS[k]).sort());
  const bad = rep(mk(0, 1, { acne: 'x', pores: 140, redness: -4 }), mk(1, 8));
  ['acne', 'pores', 'redness'].forEach(k => assert.equal(groupOf(bad, k), undefined, 'valeur invalide ignorée : ' + k));
  assert.equal(rep(mk(0, 1, { g: null }), mk(1, 8)).global, null, 'pas de variation de score global inventée');
  const none = rep(mk(0, 1, Object.fromEntries(KEYS.map(k => [k, null]))), mk(1, 8));
  assert.equal(none.status, 'empty'); assert.equal(none.comparable, 0);
});

test('EV4 huile, texture, radiance : « Variation observée », jamais hausse ni baisse ; contour des yeux : indicatif', () => {
  const r = rep(mk(0, 1), mk(1, 8, { oiliness: 90, texture: 10, radiance: 52, eyeBag: 90, tearTrough: 10, darkCircle: 51, droopyUpperEyelid: 70, droopyLowerEyelid: 30 }));
  ['oiliness', 'texture', 'radiance'].forEach(k => assert.equal(groupOf(r, k), 'observed', k));
  Evo.EYE.forEach(k => assert.equal(groupOf(r, k), 'eye', k));
  assert.ok(![...r.groups.up, ...r.groups.flat, ...r.groups.down].some(x => Evo.NEUTRAL.includes(x.key) || Evo.EYE.includes(x.key)));
  const card = Evo.create({ scans: () => TWO, state: () => ({}), demo: () => false }).card(mk(0, 1), mk(1, 8, { oiliness: 90, eyeBag: 90 }));
  const part = h => card.slice(card.indexOf(h)).split('c-evo__group')[0];
  assert.match(card, /Variation observée/); assert.match(card, /Contour des yeux, à titre indicatif/);
  assert.match(card, /sans dire si elle est favorable/); assert.match(card, /ne permettent pas de conclure à une amélioration/);
  const obs = card.slice(card.indexOf('Variation observée'), card.indexOf('Contour des yeux, à titre indicatif'));
  assert.ok(!/c-delta--(up|down)/.test(obs), 'aucune pastille de hausse ou de baisse dans la rubrique neutre');
  assert.ok(!/c-delta--(up|down)/.test(card.slice(card.indexOf('Contour des yeux, à titre indicatif'))));
  assert.ok(part('Variation observée') !== undefined);
});

test('EV5 les analyses non enregistrées sont exclues, avec un message clair', () => {
  const draft = mk(1, 8, {}, { saved: false });
  assert.equal(rep(mk(0, 1), draft).status, 'unsaved');
  assert.equal(rep(draft, mk(0, 1)).status, 'unsaved');
  const card = Evo.create({ scans: () => [...TWO, draft], state: () => ({}), demo: () => false }).card(mk(0, 1), draft);
  assert.match(card, /n'est pas encore enregistrée dans votre historique : elle n'est pas incluse dans ce bilan/);
  assert.ok(!/Score en hausse|Score en baisse|Variation faible/.test(card), 'aucun classement produit');
  assert.equal(Evo.fromScan(Object.assign(mk(2, 3), { saved: undefined })).saved, false, 'seul saved === true compte');
  assert.equal(Evo.fromScan(null), null);
});

test('EV6 une seule analyse, deux fois la même, aucune photo, une seule photo', () => {
  const a = mk(0, 1), b = mk(1, 8);
  assert.equal(Evo.report(null, null).status, 'none'); assert.equal(Evo.report(Evo.fromScan(a), null).status, 'none');
  assert.equal(rep(a, a).status, 'same');
  const mkEvo = () => Evo.create({ scans: () => [a, b], state: () => ({}), demo: () => false, label: s => 'jour ' + s.id });
  assert.match(mkEvo().card(a, a), /Choisissez deux analyses différentes/);
  assert.match(mkEvo().photos(a, b), /Aucune photo n'est affichée/); assert.match(mkEvo().photos(a, b), /comparatif de scores reste disponible/);
  const one = mkEvo().photos(Object.assign({}, a, { photo: 'blob:http://x/abc' }), b);
  assert.match(one, /Une seule photo est disponible/); assert.equal((one.match(/<img /g) || []).length, 1);
  const two = mkEvo().photos(Object.assign({}, a, { photo: 'blob:http://x/abc' }), Object.assign({}, b, { photo: 'https://demo.supabase.co/sig?token=t' }));
  assert.equal((two.match(/<img /g) || []).length, 2); assert.match(two, /c-evo__photos/); assert.match(two, /Avant · jour 0/); assert.match(two, /Maintenant · jour 1/);
  const swapped = mkEvo().photos(Object.assign({}, b, { photo: 'blob:http://x/b' }), Object.assign({}, a, { photo: 'blob:http://x/a' }));
  assert.ok(swapped.indexOf('blob:http://x/a') < swapped.indexOf('blob:http://x/b'), 'la photo la plus ancienne vient en premier');
  assert.equal(Evo.create({ demo: () => true }).photos(a, b), ''); assert.equal(Evo.create({ demo: () => true }).card(a, b), '');
});

test('EV7 seules les adresses blob: et https: sont affichées (jamais data:, javascript:, http:) et rien n\'est conservé', () => {
  const a = mk(0, 1), b = mk(1, 8), e = Evo.create({ scans: () => [], state: () => ({}), demo: () => false, label: () => 'x' });
  for (const bad of ['javascript:alert(1)', 'data:image/jpeg;base64,AAAA', 'http://x/p.jpg', '"><script>', 'x'.repeat(5000)])
    assert.ok(!/<img /.test(e.photos(Object.assign({}, a, { photo: bad }), Object.assign({}, b, { photo: bad }))), bad.slice(0, 20));
  const html = e.photos(Object.assign({}, a, { photo: 'https://x/p.jpg?a=1&b="2"' }), Object.assign({}, b, { photo: 'blob:http://x/y' }));
  assert.ok(!/src="[^"]*"[^>]*"2"/.test(html) && html.includes('&quot;'), 'guillemets échappés');
  const src = read('js/evolution.js');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(src), 'aucun stockage');
});

/* ---- raccourcis : départ du programme, première analyse ---- */
function setup({ scans, program, history = {}, user = 'u1' }) {
  const state = { cmpA: 0, cmpB: 1, history }, calls = { go: [], render: 0 }, ctx = { program, user, scans };
  const evo = Evo.create({
    scans: () => ctx.scans, state: () => state, select: (i, j) => { state.cmpA = i; state.cmpB = j; }, go: r => { calls.go.push(r); }, render: () => { calls.render++; },
    program: () => ctx.program, label: s => 'J' + s.id, demo: () => false, userId: () => ctx.user, trend: () => ({})
  });
  return { evo, state, calls, ctx };
}
const prog = (baseId, start = '2026-10-02') => ({ v: 1, start, plan: { steps: [], notes: [], summary: '', base: { id: baseId, at: '2026-10-02T08:00:00.000Z' } }, checks: {}, logs: [] });

test('EV8 « Depuis le début du programme » : sélectionne plan.base.id et la plus récente analyse enregistrée', () => {
  const s = [mk(0, 1), mk(1, 2), mk(2, 9), mk(3, 12, {}, { saved: false })];
  const t = setup({ scans: s, program: prog('rec-1') });
  assert.equal(t.evo.fromProgram(false), true);
  assert.deepEqual([t.state.cmpA, t.state.cmpB], [1, 2], 'départ = rec-1 ; la plus récente ENREGISTRÉE (pas la non enregistrée)');
  assert.deepEqual(t.calls.go, ['progress']);
  const card = t.evo.card(s[t.state.cmpA], s[t.state.cmpB]);
  assert.match(card, /Programme commencé le/); assert.match(card, /ne disent pas que le programme a causé les variations|n'ont pas causé|ne dit pas/i);
  assert.match(card, /data-evo="program"/);
});

test('EV9 départ introuvable, programme absent, aucune analyse plus récente : message adapté, sélection inchangée', () => {
  const s = [mk(0, 1), mk(1, 9)];
  let t = setup({ scans: s, program: prog('rec-inconnue') });
  assert.equal(t.evo.fromProgram(false), false); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1], 'jamais une autre analyse choisie en silence');
  assert.match(t.evo.card(s[0], s[1]), /analyse de départ de votre programme est introuvable/); assert.ok(!/data-evo="program"/.test(t.evo.card(s[0], s[1])));
  t = setup({ scans: s, program: prog('rec-1') });
  assert.equal(t.evo.fromProgram(false), false); assert.match(t.evo.card(s[0], s[1]), /Aucune analyse n'est plus récente/);
  t = setup({ scans: s, program: null });
  assert.equal(t.evo.fromProgram(false), false); assert.match(t.evo.card(s[0], s[1]), /Aucun programme de soins n'est commencé/);
  t = setup({ scans: [mk(0, 1, {}, { saved: false }), s[1]], program: prog('rec-0') });
  assert.equal(t.evo.fromProgram(false), false, 'une analyse de départ non enregistrée n\'est pas retenue');
  t = setup({ scans: s, program: { v: 1, plan: null } });
  assert.equal(t.evo.fromProgram(false), false);
  t = setup({ scans: s, program: { v: 1, start: '2026-10-02', plan: { base: { id: null } } } });
  assert.equal(t.evo.fromProgram(false), false);
});

test('EV10 le message « aucun programme » ne reste affiché que tant que la sélection n\'a pas été changée', () => {
  const s = [mk(0, 1), mk(1, 9)];
  const t = setup({ scans: s, program: null });
  t.evo.fromProgram(true);
  assert.equal(t.calls.render, 1); assert.deepEqual(t.calls.go, []);
  assert.match(t.evo.card(s[0], s[1]), /Aucun programme de soins n'est commencé/);
  t.state.cmpA = 1; t.state.cmpB = 0;
  assert.ok(!/Aucun programme de soins/.test(t.evo.card(s[1], s[0])), 'la sélection a changé : message retiré');
  const m = setup({ scans: s, program: prog('rec-inconnue') });
  m.evo.fromProgram(true);
  assert.equal((m.evo.card(s[0], s[1]).match(/introuvable/g) || []).length, 1, 'une seule fois, jamais en double');
});

test('EV11 « Depuis ma première analyse » : la plus ancienne et la plus récente enregistrées ; refusé tant que l\'historique est incomplet', () => {
  const s = [mk(0, 5), mk(1, 1), mk(2, 9), mk(3, 12, {}, { saved: false })];
  let t = setup({ scans: s, program: null });
  assert.equal(t.evo.fromFirst(), true); assert.deepEqual([t.state.cmpA, t.state.cmpB], [1, 2]);
  t = setup({ scans: s, program: null, history: { hasMore: true } });
  assert.equal(t.evo.fromFirst(), false); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  const card = t.evo.card(s[0], s[1]);
  assert.match(card, /Voir plus d'analyses/); assert.ok(!/data-evo="first"/.test(card), 'pas de faux « première analyse »');
  t = setup({ scans: [s[0]], program: null });
  assert.equal(t.evo.fromFirst(), false);
});

test('EV12 changement de compte : le message du raccourci ne passe pas d\'un compte à l\'autre', () => {
  const s = [mk(0, 1), mk(1, 9)];
  const t = setup({ scans: s, program: null });
  t.evo.fromProgram(true);
  assert.match(t.evo.card(s[0], s[1]), /Aucun programme de soins/);
  t.ctx.user = 'u2';
  const other = t.evo.card(s[0], s[1]);
  assert.ok(!/Aucun programme de soins/.test(other), 'message du compte précédent effacé');
  assert.ok(!/data-evo="program"/.test(other));
  t.ctx.user = 'u1'; t.evo.fromProgram(true); assert.match(t.evo.card(s[0], s[1]), /Aucun programme/);
  t.evo.reset(); assert.ok(!/Aucun programme de soins/.test(t.evo.card(s[0], s[1])));
  const p = setup({ scans: s, program: prog('rec-0') });
  assert.match(p.evo.card(s[0], s[1]), /data-evo="program"/);
  p.ctx.user = 'u2'; p.ctx.program = null;
  assert.ok(!/data-evo="program"/.test(p.evo.card(s[0], s[1])), 'le programme d\'un autre compte n\'est pas proposé');
});

test('EV13 aucune causalité : ni produit, ni ingrédient, ni routine, ni programme n\'explique une variation ; avertissement exact', () => {
  const e = Evo.create({ scans: () => TWO, state: () => ({}), demo: () => false });
  const card = e.card(mk(0, 1), mk(1, 9, { acne: 70, redness: 20, oiliness: 90 }));
  assert.ok(card.includes('Ces résultats décrivent les variations de scores de l\'analyse. Ils ne prouvent pas à eux seuls une amélioration clinique ni l\'efficacité d\'un produit. Les conditions de prise de vue et les variations de mesure peuvent influencer les résultats.'));
  assert.match(card, /valeur technique provisoire : il n'est pas validé scientifiquement/);
  const own = Object.values(Evo.COPY).map(v => (typeof v === 'function' ? v('x', 'y') : v)).join(' ') + ' ' + card.replace(/<[^>]+>/g, ' ');
  const stripped = own.replace(/ni l'efficacité d'un produit/g, '').replace(/ne disent pas que le programme a causé les variations/g, '');
  assert.ok(!/grâce|à cause|résultat d[eu]|efficace|guéri|soigné|traitement a|votre routine a|le produit a|le programme a|prouve que|améliorée par|dû à|causé par/i.test(stripped), 'aucune attribution : ' + (stripped.match(/grâce|à cause|efficace|dû à|causé par/i) || [''])[0]);
  assert.ok(!/ingrédient|sérum|crème|routine|produit/i.test(card.replace(/ni l'efficacité d'un produit/g, '')), 'le bilan ne nomme aucun produit ni aucune routine');
  assert.ok(!/(?:^|[^a-zé])(?:guérison|diagnostic|prouvé|garanti|certain|certitude|définitif)/i.test(card.replace(/ni une amélioration clinique/g, '')));
  assert.ok(!/ — | – /.test(own), 'pas de tiret cadratin dans le texte affiché');
});

test('EV14 sorties échappées : aucune injection par des libellés ou des dates', () => {
  const s = mk(0, 1); s.rec.analyzedAt = '<img src=x onerror=alert(1)>';
  const e = Evo.create({ scans: () => TWO, state: () => ({}), demo: () => false, label: () => '<b>x</b>' });
  const out = e.card(s, mk(1, 9)) + e.photos(Object.assign(mk(2, 2), { photo: 'blob:http://x/a' }), Object.assign(mk(3, 3), { photo: 'blob:http://x/b' }));
  assert.ok(!/<img src=x|<b>x<\/b>/.test(out));
});

test('EV15 module : aucun réseau, aucun fournisseur, aucune écriture ; chargé avant app.js ; app.js sous son plafond', () => {
  const src = read('js/evolution.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|skin-analysis|perfect|youcam|makeupar|supabase|analy[sz]eSkin|runRealAnalysis|localStorage|\.setItem\(|innerHTML\s*=/i.test(src), 'module sans réseau, sans fournisseur et sans stockage');
  const html = read('index.html'), at = f => html.indexOf(`<script src="${f}"></script>`);
  assert.equal((html.match(/js\/evolution\.js/g) || []).length, 1); assert.ok(at('js/skin-model.js') < at('js/evolution.js') && at('js/evolution.js') < at('js/app.js'));
  assert.ok(fs.statSync(path.join(ROOT, 'js/app.js')).size < 150000, 'js/app.js sous 150 000 octets');
  const app = read('js/app.js'), prog = app.slice(app.indexOf('V.progress='), app.indexOf('const historyMore'));
  assert.ok(prog.indexOf('${EVO.card(A,B)}') > 0 && prog.indexOf('${EVO.card(A,B)}') < prog.indexOf('gchart(pts)') && prog.indexOf('${EVO.card(A,B)}') < prog.indexOf('cmpRow(cmp.global'), 'le bilan précède graphique et tableaux');
  assert.match(prog, /id="cmp"/, 'le curseur avant/après est conservé'); assert.match(prog, /\$\{EVO\.photos\(A,B\)\}/);
  assert.match(prog, /EVO\.priorities\(engineFor\(SCANS\[SCANS\.length-1\]\)\.personalization\.evolution\)/, 'bloc des priorités conservé, déplacé dans le module');
  assert.doesNotMatch(app, /Vos priorités actuelles(?!,)/);
  assert.match(app, /Votre évolution/);
  assert.ok(!/skin-analysis|simulation/.test(src), 'aucun appel d\'analyse ni de simulation');
});

test('EV16 priorités : bloc d\'origine inchangé (même texte, mêmes classes)', () => {
  const e = Evo.create({ trend: () => ({ up: 'Amélioration', down: 'Baisse', same: 'Stable' }) });
  const out = e.priorities({ available: true, note: 'Une note.', indicators: [{ label: 'Pores', previous: 40, current: 46, delta: 6, trend: 'up' }, { label: 'Rougeurs', delta: null }] });
  assert.match(out, /Vos priorités actuelles, depuis l'analyse précédente/); assert.match(out, /40 → 46<small>\/100<\/small>/); assert.match(out, /c-delta--up">Amélioration/); assert.match(out, /Comparaison indisponible/); assert.match(out, /Une note\./);
  assert.equal(e.priorities({ available: false }), ''); assert.equal(e.priorities(null), ''); assert.equal(e.priorities({ available: true, indicators: [] }), '');
});

test('EV17 programme : bouton « Voir mon évolution depuis le début du programme » → data-cp="evolution", aucun calcul dans le programme', () => {
  const cp = read('js/care-program.js');
  assert.match(cp, /data-cp="evolution">Voir mon évolution depuis le début du programme</);
  assert.match(cp, /case 'evolution': if \(st && d\.evolution\) d\.evolution\(\); return;/);
  assert.ok(!/DermaiEvolution|SkinModel/.test(cp), 'care-program.js ne lit aucune analyse');
  const app = read('js/app.js');
  assert.match(app, /evolution:\(\)=>EVO\.fromProgram\(\)/); assert.match(app, /program:\(\)=>CP\.state\(\)/);
});

/* ---- sélection par défaut avec une analyse récente non enregistrée ---- */
const draftOf = (id, day) => mk(id, day, {}, { saved: false, rec: undefined, analyzedAt: `2026-10-${String(day).padStart(2, '0')}T08:00:00.000Z` });
const view = t => { const l = t.ctx.scans, s = t.state; return t.evo.card(l[s.cmpA], l[s.cmpB]); };

test('EV18 deux analyses enregistrées puis une non enregistrée : la sélection par défaut devient les deux enregistrées, avec explication', () => {
  const s = [mk(0, 1, { acne: 40 }), mk(1, 5, { acne: 60 }), draftOf(2, 9)];
  const t = setup({ scans: s, program: null });
  t.state.cmpA = 1; t.state.cmpB = 2;                        // sélection par défaut de l'application : les deux dernières de la liste
  t.evo.settle();
  assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  const card = view(t);
  assert.match(card, /Score en hausse/); assert.match(card, /40 → 60/);
  assert.match(card, /Une analyse récente n'est pas encore enregistrée dans votre historique/); assert.match(card, /vos deux dernières analyses enregistrées/);
  t.evo.settle(); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1], 'idempotent');
  // l'analyse non enregistrée plus ancienne que deux enregistrées, plusieurs non enregistrées, ordre mélangé : toujours les deux plus récentes ENREGISTRÉES
  const m = [mk(0, 1), draftOf(1, 3), mk(2, 8), mk(3, 6), draftOf(4, 12)];
  const u = setup({ scans: m, program: null }); u.state.cmpA = 3; u.state.cmpB = 4; u.evo.settle();
  assert.deepEqual([u.state.cmpA, u.state.cmpB], [3, 2], 'saved du 6 puis du 8 (positions 3 et 2)');
});

test('EV19 une seule analyse enregistrée avec une non enregistrée plus récente : état explicite, aucune sélection modifiée', () => {
  const s = [mk(0, 1), draftOf(1, 9)];
  const t = setup({ scans: s, program: prog('rec-0') });
  t.evo.settle(); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  const card = view(t);
  assert.match(card, /Une seule analyse est enregistrée dans votre historique : une comparaison nécessite une seconde analyse enregistrée/);
  assert.match(card, /Une analyse récente n'est pas encore enregistrée : elle n'est pas incluse/);
  assert.ok(!/Score en hausse|Variation faible|Score en baisse|data-evo|Ces résultats décrivent/.test(card), 'ni classement, ni raccourci');
  assert.equal(t.evo.fromFirst(), false); assert.equal(t.evo.fromProgram(true), false); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
});

test('EV20 aucune analyse enregistrée : état vide explicite (une ou plusieurs analyses non enregistrées, ou aucune)', () => {
  const s = [draftOf(0, 3), draftOf(1, 9)];
  const t = setup({ scans: s, program: null });
  t.evo.settle(); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  const card = view(t);
  assert.match(card, /Aucune analyse n'est enregistrée dans votre historique : le bilan nécessite au moins deux analyses enregistrées/);
  assert.match(card, /pas encore enregistrée/); assert.ok(!/Score en hausse|data-evo/.test(card));
  const e = Evo.create({ scans: () => [], state: () => ({}), demo: () => false });
  assert.match(e.card(undefined, undefined), /Aucune analyse n'est enregistrée/);
  e.settle();
});

test('EV21 sélecteurs manuels : jamais écrasés ; la sélection par défaut seule est corrigée', () => {
  const s = [mk(0, 1), mk(1, 5), draftOf(2, 9)];
  // choix manuel d'une analyse non enregistrée : conservé, et le bilan l'exclut avec un message
  let t = setup({ scans: s, program: null });
  t.state.cmpA = 1; t.state.cmpB = 2; t.evo.pick(); t.evo.settle();
  assert.deepEqual([t.state.cmpA, t.state.cmpB], [1, 2], 'choix manuel respecté');
  assert.match(view(t), /L'analyse du 9 octobre n'est pas encore enregistrée dans votre historique : elle n'est pas incluse dans ce bilan/);
  // le choix manuel suit les analyses, pas les positions : une autre sélection redevient « par défaut »
  t.state.cmpA = 0; t.state.cmpB = 1; t.evo.settle(); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  // sélection qui n'est pas celle par défaut : intacte
  t = setup({ scans: s, program: null }); t.state.cmpA = 0; t.state.cmpB = 2; t.evo.settle();
  assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 2]);
  // deux analyses enregistrées par défaut : rien à corriger
  t = setup({ scans: [mk(0, 1), mk(1, 5)], program: null }); t.evo.settle(); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  // démonstration : aucun effet
  const d = Evo.create({ scans: () => s, state: () => ({ cmpA: 1, cmpB: 2 }), select: () => assert.fail('pas de sélection en démo'), demo: () => true }); d.settle();
});

test('EV22 raccourcis avec analyses non enregistrées et historique paginé : jamais une analyse incorrecte choisie en silence', () => {
  const s = [mk(0, 1), mk(1, 3), mk(2, 8), draftOf(3, 12)];
  let t = setup({ scans: s, program: null });
  assert.equal(t.evo.fromFirst(), true); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 2], 'la plus récente ENREGISTRÉE, pas la non enregistrée');
  t = setup({ scans: s, program: prog('rec-1') });
  assert.equal(t.evo.fromProgram(false), true); assert.deepEqual([t.state.cmpA, t.state.cmpB], [1, 2]);
  // départ du programme = analyse non enregistrée : introuvable
  t = setup({ scans: s, program: prog('rec-3') });
  assert.equal(t.evo.fromProgram(false), false); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  // historique incomplet : « première analyse » refusé, programme dont le départ n'est pas chargé : message, sélection inchangée
  t = setup({ scans: s.slice(1), program: prog('rec-0'), history: { hasMore: true } });
  assert.equal(t.evo.fromFirst(), false); assert.equal(t.evo.fromProgram(true), false);
  assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
  const card = view(t); assert.match(card, /pas être encore chargée/); assert.ok(!/data-evo="first"/.test(card));
  // départ chargé alors que l'historique est incomplet : le raccourci du programme reste valable (départ réel, dernière analyse chargée)
  t = setup({ scans: s.slice(1), program: prog('rec-1'), history: { hasMore: true } });
  assert.equal(t.evo.fromProgram(false), true); assert.deepEqual([t.state.cmpA, t.state.cmpB], [0, 1]);
});
