'use strict';
/* Lot 3 (peaux foncées) : choix du teint (échelle Monk, 10 teintes), stocké SUR L'APPAREIL, estimation.
   Adapte, sans rien inventer : masque la mesure de rougeur pour un teint foncé (copie d'affichage, jamais la donnée enregistrée),
   avertit qu'une irritation peut laisser une tache durable, ralentit l'introduction des soins qui irritent. Aucun réseau. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../js/skin-tone.js');
const D = require('../js/declared-concerns.js');
const Engine = require('../js/engine/index.js');
const M = require('../js/skin-model.js');
const { run, norm } = require('./helpers/engine.js');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const fake = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };

test('TT1 échelle Monk : dix teintes distinctes, du plus clair au plus foncé', () => {
  assert.equal(T.MONK.length, 10);
  assert.deepEqual(T.MONK.map(m => m.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(T.MONK.every(m => /^#[0-9a-f]{6}$/.test(m.hex)));
  assert.equal(new Set(T.MONK.map(m => m.hex)).size, 10);
  /* l'échelle Monk n'est pas strictement monotone en luminance parmi les teintes claires (la 3 est plus jaune que la 2) : on vérifie l'ordre d'ensemble */
  assert.ok(lum(T.MONK[0].hex) > lum(T.MONK[4].hex) && [0, 1, 2, 3].every(i => lum(T.MONK[i].hex) > lum(T.MONK[4].hex)), 'les teintes 1 à 4 sont plus claires que la 5');
  for (let i = 5; i < 10; i++) assert.ok(lum(T.MONK[i].hex) < lum(T.MONK[i - 1].hex), 'teinte ' + (i + 1) + ' plus foncée que ' + i);
  assert.equal(T.DEEP_FROM, 6);
});

test('TT2 stockage sur l\'appareil : valeur valide seulement, effaçable, tolère un stockage refusé', () => {
  const s = fake();
  assert.equal(T.write(s, 7), true); assert.equal(T.read(s), 7); assert.equal(s.m.get('dermai.skinTone'), '7');
  for (const bad of [0, 11, 3.5, '4', NaN, 'abc', {}, []]) { assert.equal(T.write(s, bad), false, String(bad)); assert.equal(T.read(s), 7, 'inchangé'); }
  assert.equal(T.write(s, null), true); assert.equal(T.read(s), null);
  for (const raw of ['0', '11', '2.5', 'x', '', '  ']) assert.equal(T.read(fake({ 'dermai.skinTone': raw })), null, 'valeur corrompue : ' + raw);
  const refuse = { getItem() { throw new Error('refusé'); }, setItem() { throw new Error('refusé'); }, removeItem() { throw new Error('refusé'); } };
  assert.equal(T.write(refuse, 5), false); assert.equal(T.read(refuse), null);
  assert.equal(T.set(5, refuse), false); assert.equal(T.get(refuse), 5, 'le choix vaut pour la visite');
  T.set(null, refuse); assert.equal(T.get(refuse), null);
});

test('TT3 confidentialité : le teint ne quitte jamais l\'appareil', () => {
  assert.doesNotMatch(read('js/skin-tone.js').replace(/\/\*[\s\S]*?\*\//g, ''), /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|supabase|\.rpc\(/i);
  /* ni le profil enregistré, ni l'enregistrement d'une analyse, ni le compte ne le lisent */
  const app = read('js/app.js');
  const seg = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
  assert.doesNotMatch(seg('const profileForSave', '\n'), /TN|DermaiTone|tone/i);
  assert.doesNotMatch(seg('async function saveScan', 'async function deleteHistory'), /TN\.|DermaiTone/);
  assert.doesNotMatch(read('js/account.js'), /DermaiTone|skinTone|dermai\.skinTone/);
  assert.doesNotMatch(read('js/analysis-flow.js'), /DermaiTone|skinTone/);
  for (const f of fs.readdirSync(path.join(__dirname, '../supabase/migrations'))) assert.doesNotMatch(read('supabase/migrations/' + f), /skin_?tone|\bteint\b|\bmonk\b/i, f);
  for (const f of fs.readdirSync(path.join(__dirname, '../server')).filter(x => x.endsWith('.js'))) assert.doesNotMatch(read('server/' + f), /DermaiTone|skinTone|dermai\.skinTone/, f);
});

test('TT4 sélecteur : dix pastilles accessibles, phrase d\'estimation, mention de confidentialité', () => {
  const h = T.picker(null);
  assert.equal((h.match(/role="radio"/g) || []).length, 10);
  assert.equal((h.match(/aria-checked="false"/g) || []).length, 10);
  for (let i = 1; i <= 10; i++) assert.ok(h.includes('data-tone="' + i + '"') && h.includes('aria-label="Teint ' + i + ' sur 10"'));
  assert.match(h, /C'est une estimation : l'écran de votre téléphone peut fausser les couleurs\./);
  assert.match(h, /Ce choix reste sur votre appareil\. DermAI ne l'envoie à personne/);
  assert.match(h, /role="radiogroup"/); assert.match(h, /aria-live="polite"/);
  assert.match(h, /data-tone-clear hidden/, 'rien à retirer tant qu\'aucun teint n\'est choisi');
  const sel = T.picker(8);
  assert.equal((sel.match(/aria-checked="true"/g) || []).length, 1);
  assert.ok(/data-tone="8"[^>]*>|aria-checked="true" data-tone="8"/.test(sel));
  assert.match(sel, /Teint 8 sur 10 choisi/); assert.doesNotMatch(sel, /data-tone-clear hidden/);
  assert.ok(Math.min(...[...read('css/components/skin-tone.css').matchAll(/min-(?:width|height):(\d+)px/g)].map(m => +m[1])) >= 44, 'zone tactile d\'au moins 44 px');
  assert.match(read('css/styles.css'), /components\/skin-tone\.css/);
});

test('TT5 masquage : copie d\'affichage pour un teint foncé, jamais la donnée enregistrée', () => {
  const n = norm({ redness: 30, acne: 60 }, { raw: 40, skin: 'Dry & Redness' });
  const frozen = JSON.stringify(n);
  for (const t of [null, 1, 3, 5]) assert.equal(T.view(n, t), n, 'teint clair ou absent : le même objet (' + t + ')');
  for (const t of [6, 7, 10]) {
    const v = T.view(n, t);
    assert.notEqual(v, n); assert.deepEqual(v.redness, { rawScore: null, uiScore: null });
    assert.equal(v.acne.uiScore, 60, 'les autres mesures sont intactes'); assert.equal(v.globalScore, n.globalScore);
    assert.equal(v.skinType.whole, 'Dry', '« Dry & Redness » devient « Dry » (même source, rien d\'inventé)');
  }
  assert.equal(JSON.stringify(n), frozen, 'la donnée enregistrée n\'est pas modifiée');
  assert.equal(T.view(norm({}, { skin: 'Redness' }), 8).skinType.whole, null, '« Redness » seul : type inconnu');
  assert.equal(T.view(norm({}, { skin: 'Oily' }), 8).skinType.whole, 'Oily');
  for (const bad of [undefined, null, 0, 'x', []]) assert.doesNotThrow(() => T.view(bad, 8));
  assert.equal(T.REDNESS_FOR_DEEP, 'mask');
});

test('TT6 moteur : rougeur masquée = ni priorité, ni mode confort venu de la rougeur ; le moteur reçoit une copie', () => {
  const n = norm({ redness: 10 }, { raw: 10 });
  const open = Engine.run(n, { goals: [], level: 'simple' }), masked = Engine.run(T.view(n, 8), { goals: [], level: 'simple' });
  assert.ok(open.priorities.items.some(p => p.indicator === 'redness') || open.interpretation.context.comfortReasons.includes('redness_low'), 'témoin : sans masque, la rougeur pèse');
  assert.ok(!masked.priorities.items.some(p => p.indicator === 'redness'));
  assert.ok(!masked.interpretation.context.comfortReasons.includes('redness_low'));
  assert.equal(masked.interpretation.indicators.find(i => i.id === 'redness').available, false);
  assert.equal(n.redness.uiScore, 10, 'valeur d\'origine intacte');
});

test('TT7 « peau qui marque » : introduction plus lente des soins qui irritent, sans effet sur les soins doux ni sans le drapeau', () => {
  assert.equal(Engine.VERSION, '1.4.0');
  const base = { goals: ['tone'], level: 'full' }, ui = { pigmentation: 20, acne: 30, hydration: 30 }, raws = { rawMap: { pigmentation: 20, acne: 30, hydration: 30 }, rawFill: 80 }, steps = r => [...r.routinePlan.slots.morning, ...r.routinePlan.slots.evening].filter(s => s.kind === 'treatment');
  const a = run(ui, raws, base), b = run(ui, raws, Object.assign({ marks: false }, base)), c = run(ui, raws, Object.assign({ marks: true }, base));
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'sans « marks » : sorties identiques à avant');
  assert.equal(Object.prototype.hasOwnProperty.call(Engine.normalizeProfile({ marks: false }), 'marks'), false);
  assert.equal(Engine.normalizeProfile({ marks: true }).marks, true);
  assert.equal(Engine.normalizeProfile({ marks: 'yes' }).marks, undefined, 'seul « true » compte');
  const irritating = steps(c).filter(s => require('../js/engine/actives.js').byId(s.activeId).irritation !== 'low');
  assert.ok(irritating.length >= 1, 'le cas contient un soin qui irrite');
  for (const s of irritating) assert.equal(s.slowDown, true, s.activeId);
  for (const s of steps(c).filter(s => require('../js/engine/actives.js').byId(s.activeId).irritation === 'low')) assert.notEqual(s.slowDown, true, s.activeId);
  assert.ok(steps(a).some(s => !s.slowDown && require('../js/engine/actives.js').byId(s.activeId).irritation !== 'low'), 'témoin : sans le drapeau, ces soins ne sont pas ralentis');
  /* les décisions (priorités, soins retenus) ne changent pas : seule la cadence */
  assert.deepEqual(c.priorities.items.map(p => p.indicator), a.priorities.items.map(p => p.indicator));
  assert.deepEqual(steps(c).map(s => s.activeId), steps(a).map(s => s.activeId));
});

test('TT8 écran Résultat : avertissement pour un teint foncé, note ou masque pour la rougeur, rien sans teint', () => {
  const eng = run({ redness: 70 }, { raw: 62 }, { goals: [] });
  const none = D.top(eng, null, null), light = D.top(eng, null, 3), deep = D.top(Engine.run(T.view(norm({ redness: 70 }, { raw: 62 }), 8), { goals: [], level: 'simple' }), null, 8);
  assert.ok(!none.includes('data-tone-alert') && !none.includes('data-redness-masked') && none.includes('data-redness-note'));
  assert.ok(!light.includes('data-tone-alert') && !light.includes('data-redness-masked') && light.includes('data-redness-note'));
  assert.ok(deep.includes('data-tone-alert') && deep.includes('data-redness-masked') && !deep.includes('data-redness-note'));
  const t = deep.replace(/<[^>]+>/g, ' ');
  assert.match(t, /Rougeurs non affichées/); assert.match(t, /peu fiable/); assert.match(t, /brune, violacée ou grise/);
  assert.match(t, /laisser une tache qui met longtemps à partir/); assert.match(t, /ne grattez pas/); assert.match(t, /il fonce les marques/);
  assert.match(deep, /data-go="profile"/);
});

test('TT9 vocabulaire : cosmétique, aucun diagnostic, aucune promesse, aucun mot d\'éclaircissement, pas de tiret cadratin', () => {
  const forbidden = [/(?<![\p{L}])vous avez (?!indiqu[ée]|choisi)/iu, /vous souffrez/i, /(?<![\p{L}])traiter/i, /(?<![\p{L}])il faut/i, /malad/i, /patholog/i, /pr[ée]scri/i, /gu[ée]ri/i, /(?<![\p{L}])soigner/i,
    /[ée]claircir/i, /[ée]claircissant/i, /blanchi/i, /d[ée]pigment/i, /prouve/i];
  for (const x of Object.values(T.TEXT)) { const t = typeof x === 'function' ? x(7) : x; for (const re of forbidden) assert.doesNotMatch(t, re, t); assert.ok(!/[—–]/.test(t), t); }
});

test('TT10 câblage : module chargé avant son lecteur, moteur et historique alimentés par une COPIE, enregistrement sur la donnée d\'origine', () => {
  const html = read('index.html'), at = s => html.indexOf('<script src="js/' + s + '"></script>');
  assert.ok(at('skin-tone.js') > 0 && at('skin-tone.js') < at('declared-concerns.js') && at('declared-concerns.js') < at('app.js'));
  const app = read('js/app.js');
  assert.match(app, /Engine\.run\(TN\.view\(s\.normalized\),/); assert.match(app, /marks:TN\.marks\(\)/); assert.match(app, /previous:TN\.view\(prev\.normalized\)/);
  assert.match(app, /const viewOf=s=>SkinModel\.toResultView\(TN\.view\(s\.normalized\)\)/); assert.match(app, /compareScans\(TN\.view\(A\.normalized\),TN\.view\(B\.normalized\)\)/);
  assert.equal((app.match(/\$\{TN\.picker\(\)\}/g) || []).length, 2, 'avant le scan et dans le profil');
  assert.match(app, /\$\{tipsHtml\(\)\}\$\{TN\.picker\(\)\}<button class="c-btn c-btn--primary c-btn--block" data-act="scan-start"/);
  /* les chemins d'enregistrement lisent la donnée d'origine */
  assert.doesNotMatch(app.slice(app.indexOf('async function saveScan'), app.indexOf('async function deleteHistory')), /TN\./);
  assert.match(read('js/evolution.js'), /scan\.normalized\)/); assert.match(read('js/export-view.js'), /DermaiTone\.view\(s\.normalized\)/);
  assert.ok(Buffer.byteLength(app) <= 149737, 'app.js ne grossit pas : plafond non relevé');
});

test('TT11 la mesure de rougeur n\'est jamais rebaptisée par le teint (règle du propriétaire)', () => {
  assert.equal(M.METRIC_LABELS.redness, 'Rougeurs');
  for (const x of Object.values(T.TEXT)) assert.doesNotMatch(typeof x === 'function' ? x(7) : x, /inflammation|zones plus fonc/i);
});
