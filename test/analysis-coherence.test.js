'use strict';
/* Étape 26 : cohérence détection (masque) / score / décision / affichage, à partir des deux analyses réelles.
   Le moteur de décision n'est PAS modifié (repères raw 50 / 25 inchangés) : C0 compare son empreinte de décisions à celle d'avant l'étape.
   Aucun appel réseau, aucune analyse Perfect Corp. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { M, Engine, norm, randomCase } = require('./helpers/engine.js');
const C = require('../js/engine/data/catalog.js');
const DEC = require('../js/engine/data/decision.js');
const FM = require('../js/face-map.js');
const copy = require('../js/engine/copy.fr.js');
const REF = require('./fixtures/real-analysis-2.json');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = f => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const app = read('js/app.js');

/* Navigateur simulé minimal pour la vue (js/insight-view.js lit window.SkinModel et window.DermaiEngine). */
global.SkinModel = M; global.DermaiEngine = Object.assign({}, Engine, { copy, indicatorsData: require('../js/engine/data/indicators.js'), decisionData: require('../js/engine/data/decision.js') });
const { DermaiInsight } = require('../js/insight-view.js');
const esc = s => String(s).replace(/"/g, '&quot;');

const realCase = (o = {}, profile = {}) => Engine.run(norm({}, Object.assign({ fill: REF.uiForDisplayTests, rawMap: REF.raw, skin: REF.skinType, global: REF.globalScore, age: REF.skinAge }, o)),
  Object.assign({ goals: [], level: 'simple', cats: [] }, profile), { catalog: C.PRODUCTS });
const prio = r => r.priorities.items.map(i => i.indicator);
const tids = r => r.activePlan.treatments.map(t => t.activeId);

test('C0 moteur inchangé : empreinte des DÉCISIONS (2000 profils, dont 500 avec raw) identique à celle d\'avant l\'étape 26', () => {
  const dec = r => JSON.stringify([r.interpretation.basis, r.interpretation.indicators.map(i => [i.id, i.score, i.value, i.band, i.role]), r.interpretation.context,
    r.priorities.mode, r.priorities.items.map(i => [i.indicator, i.band, i.rank, i.objectiveMatch]), r.priorities.informational.map(i => i.indicator),
    r.activePlan.treatments.map(t => [t.activeId, t.indicators, t.choice]), r.activePlan.supports.map(s => [s.activeId, s.indicators]), r.activePlan.deferred.map(d => [d.activeId, d.kind]),
    ['morning', 'evening'].map(k => r.routinePlan.slots[k].map(s => [s.id, s.kind, s.activeId || null, !!s.slowDown, s.owned])), r.productMatches.map(m => [m.stepId, m.productId, m.selection && m.selection.rule]),
    r.personalization.goals.map(g => [g.id, g.status])]);
  const out = [];
  for (let s = 1; s <= 1500; s++) { const c = randomCase(s * 37 + 5); out.push(dec(Engine.run(norm(c.ui, c.o), c.profile, { catalog: C.PRODUCTS }))); }
  const rng = seed => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
  for (let s = 1; s <= 500; s++) {
    const r = rng(9000 + s), ui = {}, raw = {};
    for (const k of M.METRIC_KEYS) { raw[k] = 5 + r() * 95; ui[k] = Math.min(99, Math.round(raw[k] + 10)); }
    out.push(dec(Engine.run(norm(ui, { rawMap: raw, skin: ['Normal', 'Oily', 'Dry', 'Combination', 'Oily & Redness'][s % 5] }),
      { goals: [[], ['tone'], ['aging'], ['hydration', 'texture']][s % 4], level: ['none', 'simple', 'full'][s % 3] }, { catalog: C.PRODUCTS })));
  }
  /* Valeur calculée avec le code du commit c31d0c8 (avant l'étape 26) ET avec le code actuel : identiques. */
  assert.equal(crypto.createHash('sha256').update(out.join('\n')).digest('hex'), '4c56df43b75c630702ef98732e2a3c40d755458a21dbab83c71e49a2bcbc4c4b');
  assert.deepEqual(DEC.RAW_BANDS.map(b => b.min), [50, 25, 0], 'repères raw provisoires inchangés');
});

test('C1 (17, 19, 20, 21) cas réel de référence : acné favorable sans priorité, pores et hydratation retenus, niacinamide pour les pores', () => {
  const r = realCase();
  assert.equal(r.interpretation.basis, 'raw');
  assert.deepEqual(prio(r), ['hydration', 'pores']);
  assert.deepEqual(r.priorities.items.map(i => i.band), ['mid', 'mid'], 'axes à soutenir, aucune priorité forte');
  assert.deepEqual(tids(r), ['niacinamide']);
  assert.deepEqual(r.activePlan.treatments[0].indicators, ['pores']);
  assert.deepEqual(r.activePlan.supports.map(s => s.activeId), ['hyaluronic', 'ceramides']);
  const st = r.synthesis.indicators;
  assert.equal(st.acne.state, 'favorable'); assert.equal(st.redness.state, 'favorable'); assert.equal(st.pigmentation.state, 'favorable');
  assert.equal(st.pores.state, 'support'); assert.equal(st.hydration.state, 'support'); assert.equal(st.texture.state, 'descriptive');
  assert.equal(st.acne.text, 'Le niveau global de cet indicateur reste favorable selon l\'interprétation actuelle de DERMAI. Il n\'est donc pas retenu comme priorité de soin.');
  assert.match(r.synthesis.sections.retained, /^Aucun indicateur ne ressort comme priorité forte\. En revanche, DERMAI retient deux axes à soutenir : hydratation \(70\) et pores \(70\)\./);
  assert.match(r.synthesis.strategy.text, /^Stratégie : soutenir hydratation \(70\) et pores \(70\) avec 1 soin ciblé/);
  assert.equal(r.productMatches.length, 1); assert.equal(r.productMatches[0].stepId, 'morning:treatment:niacinamide');
  assert.match(r.synthesis.products['morning:treatment:niacinamide'].text, /^Proposé par DERMAI\. Choisi parce qu'il contient l'actif recherché pour cet axe : niacinamide\./);
});

test('C2 (1) raw présent → décision raw : les ui_score (non communiqués pour ce cas) ne changent aucune décision', () => {
  const base = realCase();
  for (const fill of [40, 55, 70, 85, 99]) {
    const r = realCase({ fill });
    assert.deepEqual(prio(r), prio(base), 'ui ' + fill);
    assert.deepEqual(r.activePlan, base.activePlan, 'ui ' + fill);
    assert.deepEqual(Object.values(r.synthesis.indicators).map(i => i.state), Object.values(base.synthesis.indicators).map(i => i.state));
  }
});

test('C3 (2, 15) raw absent → repli documenté (score affiché, anciens repères 61 / 31), dit explicitement, rien de reconstruit', () => {
  const r = Engine.run(norm({ hydration: 55, acne: 79 }), {});
  assert.equal(r.interpretation.basis, 'ui');
  assert.deepEqual(prio(r), ['hydration']);
  assert.ok(r.interpretation.indicators.every(i => i.rawScore === null));
  assert.match(r.synthesis.sections.retained, /Analyse historique : données brutes non disponibles\./);
  // historique : une ligne sans raw_metrics est relue sans raw, et l'écran le signale (jamais « décidée sur raw »)
  assert.match(app, /noRaw:!Object\.keys\(a\.rawMetrics\|\|\{\}\)\.length/);
  assert.match(app, /\$\{s\.noRaw\?` \$\{Engine\.copy\.SYNTH\.compat\}`:``\}/);
});

test('C4 (3, 16) un seul ui_score par indicateur, partout : résultat, synthèse, statuts, routine et produits lisent la même valeur', () => {
  const check = (r, n) => {
    const shown = Object.fromEntries(M.toResultView(n).priorities.concat(M.toResultView(n).others).map(m => [m.label.toLowerCase(), m.score]));
    const y = r.synthesis;
    const texts = [...Object.values(y.sections), y.goals.text, ...Object.values(y.steps), ...Object.values(y.products).map(p => p.text), ...r.priorities.items.map(i => i.label + ' (' + i.score + ')')].join(' ');
    for (const m of texts.matchAll(/([A-Za-zÀ-ÿ' ]+?) \((\d+)\)/g)) {
      const label = m[1].trim().toLowerCase().replace(/^(?:.*[:,] |et |pour |soutenir |retient |avec )/, '').trim();
      const key = Object.keys(shown).find(l => label.endsWith(l));
      if (key) assert.equal(Number(m[2]), shown[key], `« ${m[0].trim()} » ≠ score affiché ${shown[key]}`);
    }
    for (const s of Object.values(y.indicators)) assert.equal(s.score, shown[s.label.toLowerCase()], s.id);
    for (const it of r.priorities.items) assert.equal(it.score, shown[it.label.toLowerCase()], it.indicator);
  };
  const ui = { acne: 79, pores: 64, oiliness: 71, texture: 66, hydration: 66, redness: 97, pigmentation: 78, wrinkles: 70, firmness: 72, radiance: 74 };
  const n = norm(ui, { rawMap: REF.raw, skin: 'Oily' });
  check(Engine.run(n, { goals: ['oil_pores'] }, { catalog: C.PRODUCTS }), n);
  for (let s = 1; s <= 200; s++) { const c = randomCase(s * 11 + 1), nn = norm(c.ui, c.o); check(Engine.run(nn, c.profile, { catalog: C.PRODUCTS }), nn); }
  // un seul helper d'affichage (SkinModel.displayScore) : jamais un autre arrondi
  assert.doesNotMatch(code('js/engine/synthesis.js') + code('js/insight-view.js'), /Math\.round|toFixed/);
});

test('C5 badges des indicateurs : « Favorable » / « Intermédiaire » / « Plus bas » (mêmes seuils d\'affichage) ; le score global garde les siens', () => {
  const v = M.toResultView(norm({ acne: 79, pores: 45, hydration: 20 }));
  const by = k => v.priorities.concat(v.others).find(m => m.key === k);
  assert.deepEqual([by('acne').bandLabel, by('pores').bandLabel, by('hydration').bandLabel], ['Favorable', 'Intermédiaire', 'Plus bas']);
  assert.deepEqual([by('acne').band, by('pores').band, by('hydration').band], ['good', 'mid', 'low'], 'mêmes bandes (61 / 31)');
  assert.equal(M.scoreBand(75).label, 'Bien', 'score global : libellés inchangés');
  const i = Engine.run(norm({ acne: 79 }), {}).interpretation.indicators.find(x => x.id === 'acne');
  assert.equal(i.uiBandLabel, 'Favorable');
  for (const l of Object.values(M.INDICATOR_BAND_LABELS)) assert.doesNotMatch(l, /priorit|soutenir|surveiller|bien/i, 'jamais le vocabulaire des décisions');
});

test('C6 trois niveaux distincts : favorable / axe à soutenir / priorité de soin ; les rôles restent une contrainte (18)', () => {
  const r = Engine.run(norm({ hydration: 60, pores: 70, acne: 70, texture: 30, firmness: 30 }, { rawMap: { hydration: 20, pores: 40, acne: 80, texture: 10, firmness: 10 }, rawFill: 85 }), {});
  const st = r.synthesis.indicators;
  assert.deepEqual([st.hydration.state, st.pores.state, st.acne.state, st.texture.state, st.firmness.state], ['priority', 'support', 'favorable', 'descriptive', 'descriptive']);
  assert.deepEqual([st.hydration.level, st.pores.level, st.acne.level], ['Priorité de soin', 'Axe à soutenir', 'Favorable']);
  assert.ok(!tids(r).some(id => r.activePlan.treatments.find(t => t.activeId === id).indicators.some(x => x === 'texture' || x === 'firmness')), 'texture et fermeté : aucun actif');
  assert.match(r.synthesis.sections.retained, /^DERMAI retient une priorité de soin : hydratation \(60\), et un axe à soutenir : pores \(70\)\./);
  // texture raw < 50 (cas réel) : descriptive, jamais d'actif, même avec l'objectif texture
  const t = realCase({}, { goals: ['texture'] });
  assert.equal(t.synthesis.indicators.texture.state, 'descriptive');
  assert.ok(!t.activePlan.treatments.some(x => x.indicators.includes('texture')));
});

test('C7 (11, 12) le masque ne décide rien : ni sa présence, ni son nombre de pixels, ni sa forme ne changent une décision ; le score ne déplace aucun masque', () => {
  const n = norm({}, { fill: 70, rawMap: REF.raw, skin: 'Oily' });
  const base = Engine.run(n, {}, { catalog: C.PRODUCTS });
  const big = 'data:image/png;base64,' + 'A'.repeat(4000), small = 'data:image/png;base64,AAAA';
  for (const loc of [{ acne: [big, big, big, big] }, { acne: [small] }, { pores: [big], hydration: [small] }]) assert.deepEqual(Engine.run(Object.assign({}, n, { localization: loc }), {}, { catalog: C.PRODUCTS }), base);
  for (const f of ['js/engine/interpret.js', 'js/engine/priorities.js', 'js/engine/synthesis.js', 'js/engine/personalization.js', 'js/engine/actives.js', 'js/engine/data/decision.js'])
    assert.doesNotMatch(code(f), /mask|localization|pixel|naturalWidth/i, f);
  // la carte ne reçoit ni score, ni bande, ni priorité : seulement l'indicateur choisi et ses masques
  assert.doesNotMatch(code('js/face-map.js'), /\b(score|band|priorit\w*|value|raw\w*)\b/i);
  const W = 8, H = 8, a = new Uint8ClampedArray(W * H); a[9] = 255; a[10] = 255;
  assert.deepEqual(FM.paint(a, W, H), FM.paint(a, W, H), 'même masque → même dessin, quel que soit le reste');
});

test('C8 (4, 5, 8, 9, 10) carte : un indicateur à la fois, ses seuls masques réels ; sans masque, aucun calque et le message prévu', () => {
  const r = realCase(), s = { photo: 'blob:photo' }, withMasks = ['acne', 'pores'];
  const html = key => DermaiInsight.faceMap(s, withMasks, { faceKey: key, faceHide: false }, esc, r.synthesis);
  assert.doesNotMatch(html('acne'), /Toutes les zones|data-v="all"/, 'plus de mode « toutes les zones »');
  assert.match(html(undefined), /data-facemap data-key="acne"/, 'première vue : le premier indicateur qui a un masque, seul');
  assert.match(html('pores'), /data-facemap data-key="pores"/);
  assert.match(html('acne'), /Des éléments associés aux imperfections ont été détectés sur votre photo\./);
  assert.match(html('acne'), /Acné · 70\/100 · Favorable\.<\/b> Le niveau global de cet indicateur reste favorable/);
  assert.match(html('pores'), /Pores · 70\/100 · Axe à soutenir\.<\/b> DERMAI retient cet indicateur comme axe à soutenir/);
  const none = html('hydration');
  assert.match(none, /data-facemap data-key=""/, 'hydratation sans masque : aucun calque');
  assert.match(none, /Localisation visuelle indisponible pour cet indicateur\./);
  assert.doesNotMatch(none, /ont été détecté/);
  assert.match(none, /Hydratation · 70\/100 · Axe à soutenir/);
  for (const k of [undefined, 'acne', 'hydration']) assert.match(html(k), /Une zone peut être détectée sur votre photo sans devenir une priorité de soin\./);
  assert.doesNotMatch(html('acne') + none, /diagnostic|maladie|gravité|sévère/i);
  // le navigateur ne monte que les masques de l'indicateur choisi (jamais ceux d'un autre, jamais rien sans masque)
  assert.match(app, /DermaiFaceMap\.mount\(fm,\{items:k&&loc\[k\]\?\[\{key:k,label:SkinModel\.METRIC_LABELS\[k\],masks:loc\[k\]\}\]:\[\]/);
  assert.doesNotMatch(app, /key===`all`|Toutes les zones/);
});

test('C9 (6, 7) masques : invalides écartés, plusieurs masques valides tous conservés dans l\'ordre (4 au plus)', () => {
  const ok = n => 'data:image/png;base64,' + 'A'.repeat(n);
  assert.deepEqual(FM.sanitize({ acne: [ok(4), ok(8), 'http://x/y.png', 'data:text/html;base64,AAAA', 42, ok(12)] }, M.METRIC_KEYS), { acne: [ok(4), ok(8), ok(12)] });
  assert.deepEqual(FM.sanitize({ acne: [ok(1), ok(2), ok(3), ok(4), ok(5)] }, M.METRIC_KEYS).acne.length, 4);
  assert.equal(FM.sanitize({ inconnu: [ok(4)] }, M.METRIC_KEYS), null);
  // format illisible ou cadre plein : rien n'est dessiné (interprétation stricte du masque)
  const W = 4, H = 4, opaqueColor = new Uint8ClampedArray(W * H * 4).fill(200);
  for (let i = 0; i < W * H; i++) { opaqueColor[i * 4] = (i * 53) % 255; opaqueColor[i * 4 + 3] = 255; }
  assert.equal(FM.interpretMask(opaqueColor, W, H).mode, 'unknown');
});

test('C10 (13, 14) pays : ne touche ni la carte ni la décision', () => {
  const n = norm({}, { fill: 70, rawMap: REF.raw, skin: 'Oily' });
  assert.deepEqual(Engine.run(n, {}, { catalog: C.PRODUCTS, market: 'BJ' }), Engine.run(n, {}, { catalog: C.PRODUCTS, market: 'NG' }));
  assert.doesNotMatch(code('js/face-map.js') + code('js/insight-view.js'), /market|country|pays|MK\./i);
});

test('C11 textes : résultats les moins élevés descriptifs ; routine et produits justifiés ; hydratation sans « déshydratée » ; aucun mot médical', () => {
  const r = realCase(), y = r.synthesis;
  assert.match(y.sections.lowest, /Vos résultats les moins élevés correspondent à une comparaison entre les indicateurs analysés\. Un résultat plus bas ne constitue pas automatiquement une priorité de soin\./);
  assert.equal(y.steps['morning:treatment:niacinamide'], 'Pores (70) : axe retenu selon les règles DERMAI. Actif recherché pour cet axe : niacinamide.');
  assert.match(realCase({}, { goals: ['oil_pores'] }).synthesis.steps['morning:treatment:niacinamide'], /Il rejoint votre objectif « niveau d'huile et pores »\.$/);
  assert.match(y.steps['morning:moisturize'], /DERMAI retient l'hydratation comme axe de soin dans cette analyse\. L'objectif est de soutenir le confort et l'hydratation de la peau\./);
  const all = JSON.stringify([y, r.explanations.map(e => e.text), r.personalization]);
  assert.doesNotMatch(all, /déshydrat|diagnostic|maladie|gravité|pathologi|traitement/i);
  assert.doesNotMatch(all, /Aucune priorité forte ne ressort/, 'jamais « aucune priorité forte » seul quand des axes sont retenus');
  assert.equal(copy.MARKET_TEXTS.international, 'Voir une offre internationale');
});

test('C12 confidentialité : les masques ne sont jamais conservés (base, navigateur, URL, historique)', () => {
  const rec = app.slice(app.indexOf('function recordOfScan'), app.indexOf('function isRecordable'));
  assert.doesNotMatch(rec, /localization|mask/i);
  assert.doesNotMatch(code('js/app.js'), /(localStorage|sessionStorage)\.setItem\([^)]*(localization|mask)/i);
  assert.doesNotMatch(read('js/account.js'), /localization|mask_urls/);
});

test('C13 carte : chaque nouvelle analyse s\'ouvre sur son premier indicateur localisé (le choix précédent n\'est pas repris)', () => {
  assert.match(app.slice(app.indexOf('function commitRealScan'), app.indexOf('const provider=')), /state\.faceKey=``;state\.faceHide=false;/);
});
