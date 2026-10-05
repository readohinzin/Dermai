'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../js/skin-model.js');

/* Deux fixtures aux rôles distincts :
   - JSON_RESP : réponse de statut AI Skin Analysis v2.1 avec format = "json" (data.results.output[]). SEULE source parsée par DERMAI.
   - SCORE_INFO : contenu de score_info.json du format ZIP (objet indexé par métrique, avec all, skin_age, skin_type).
     Non parsé par DERMAI : sert de référence de valeurs et de preuve que les trois champs absents de output[] ne sont pas déduits. */
const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');
const SCORE_INFO = require('./fixtures/perfectcorp-score-info.json');

/* Spécification du mapping, écrite ICI indépendamment du module : type Perfect Corp → clé DERMAI (15 métriques à deux scores). */
const SPEC = {
  acne: 'acne', pore: 'pores', oiliness: 'oiliness', texture: 'texture', moisture: 'hydration', redness: 'redness',
  age_spot: 'pigmentation', wrinkle: 'wrinkles', firmness: 'firmness', radiance: 'radiance', eye_bag: 'eyeBag',
  tear_trough: 'tearTrough', dark_circle_v2: 'darkCircle', droopy_upper_eyelid: 'droopyUpperEyelid', droopy_lower_eyelid: 'droopyLowerEyelid'
};
const UI_KEYS = ['acne', 'pigmentation', 'pores', 'oiliness', 'hydration', 'redness', 'texture', 'wrinkles'];
const clone = o => JSON.parse(JSON.stringify(o));
const OUT = JSON_RESP.data.results.output;                         // éléments de référence
const item = type => OUT.find(e => e.type === type);
const wrap = output => ({ status: 200, data: { results: { output }, task_status: 'success' } });
const parse = output => M.parseSkinResponse(wrap(output));
const normOf = output => { const r = parse(output); assert.equal(r.status, 'ok'); return r.normalized; };

/* Générateur déterministe d'éléments synthétiques : prouve que le mapping ne dépend d'aucune valeur des fixtures. */
function synthetic(seed, { outOfRange = false } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Object.keys(SPEC).map(type => ({ type, ui_score: Math.round(rnd() * 100), raw_score: outOfRange ? rnd() * 400 - 150 : rnd() * 100, mask_urls: ['https://example.invalid/' + type] }));
}

/* ================= A. réponse API format = "json" : data.results.output[] ================= */
test('A1 fixtures : rôles et structures distincts', () => {
  assert.deepEqual(Object.keys(JSON_RESP.data.results), ['output']);
  assert.ok(Array.isArray(OUT) && OUT.length === 15);
  for (const e of OUT) assert.deepEqual(Object.keys(e).sort(), ['mask_urls', 'raw_score', 'type', 'ui_score']);
  assert.deepEqual(OUT.map(e => e.type).sort(), Object.keys(SPEC).sort());
  assert.ok(!Array.isArray(SCORE_INFO) && SCORE_INFO.all && SCORE_INFO.skin_age !== undefined && SCORE_INFO.skin_type);   // forme score_info.json
  for (const e of OUT) assert.deepEqual([e.raw_score, e.ui_score], [SCORE_INFO[e.type].raw_score, SCORE_INFO[e.type].ui_score], `${e.type} : mêmes valeurs de référence dans les deux fixtures`);
});

test('A2 chemin officiel data.results.output : 15 métriques mappées, rawScore intact au bit près', () => {
  const r = M.parseSkinResponse(JSON_RESP);
  assert.equal(r.status, 'ok');
  assert.equal(r.path, 'data.results.output');
  assert.equal(r.form, 'array');
  for (const [type, key] of Object.entries(SPEC)) assert.strictEqual(r.normalized[key].rawScore, item(type).raw_score, `${type} → ${key}.rawScore`);
  assert.deepEqual(r.types.sort(), Object.keys(SPEC).sort());
  assert.deepEqual(r.ignoredTypes, []);
});

test('A3 uiScore conservé à part, distinct du rawScore', () => {
  const n = normOf(OUT);
  for (const [type, key] of Object.entries(SPEC)) {
    assert.strictEqual(n[key].uiScore, item(type).ui_score, `${type} → ${key}.uiScore`);
    assert.notStrictEqual(n[key].uiScore, n[key].rawScore);
  }
});

test('A4 droopy_upper_eyelid : valeur de la fixture du dépôt (source de vérité des tests)', () => {
  assert.strictEqual(normOf(OUT).droopyUpperEyelid.rawScore, item('droopy_upper_eyelid').raw_score);
  assert.strictEqual(item('droopy_upper_eyelid').raw_score, SCORE_INFO.droopy_upper_eyelid.raw_score);
});

test('A5 mask_urls ignoré : aucune URL dans le résultat normalisé', () => {
  const s = JSON.stringify(parse(OUT));
  for (const interdit of ['https', 'example.invalid', 'mask', '_output.jpg']) assert.ok(!s.includes(interdit), interdit);
});

test('A6 normalized : champs connus seulement, aucun calcul DERMAI', () => {
  const n = normOf(OUT);
  assert.deepEqual(Object.keys(n).sort(), [...Object.values(SPEC), 'globalScore', 'skinType', 'skinAge'].sort());
  for (const key of Object.values(SPEC)) assert.deepEqual(Object.keys(n[key]).sort(), ['rawScore', 'uiScore']);
});

test('A7 aucune donnée perdue : tous les scores de output[] se retrouvent dans normalized, et rien d\'autre', () => {
  const attendus = OUT.flatMap(e => [e.raw_score, e.ui_score]).sort((a, b) => a - b);
  const n = normOf(OUT);
  const vus = Object.values(SPEC).flatMap(k => [n[k].rawScore, n[k].uiScore]).sort((a, b) => a - b);
  assert.deepEqual(vus, attendus);
});

/* ---- all.score, skin_age, skin_type : jamais inventés ---- */
test('A8 globalScore, skinAge, skinType restent null : leur représentation dans output[] n\'est pas établie', () => {
  const n = normOf(OUT);
  assert.strictEqual(n.globalScore, null);
  assert.strictEqual(n.skinAge, null);
  assert.deepEqual(n.skinType, { whole: null, tZone: null, uZone: null });
});

test('A9 même si score_info.json en contient, rien n\'est copié : éléments all / skin_age / skin_type et clés voisines ignorées', () => {
  const env = wrap([...clone(OUT), { type: 'skin_type', whole: SCORE_INFO.skin_type.whole, t_zone: 'Oily', u_zone: 'Oily' },
    { type: 'all', score: SCORE_INFO.all.score }, { type: 'skin_age', value: SCORE_INFO.skin_age }]);
  env.data.results.all = clone(SCORE_INFO.all); env.data.results.skin_age = SCORE_INFO.skin_age; env.data.skin_type = clone(SCORE_INFO.skin_type);
  const r = M.parseSkinResponse(env);
  assert.equal(r.status, 'ok');
  assert.strictEqual(r.normalized.globalScore, null);
  assert.strictEqual(r.normalized.skinAge, null);
  assert.deepEqual(r.normalized.skinType, { whole: null, tZone: null, uZone: null });
  assert.deepEqual(r.ignoredTypes.sort(), ['all', 'skin_age', 'skin_type']);       // noms seulement, pour les logs
  assert.ok(!JSON.stringify(r.normalized).includes('Oily'));
});

/* ---- chemin unique, aucun repli ---- */
test('A10 chemin unique : un résultat placé ailleurs n\'est jamais trouvé (not_found, pas de repli)', () => {
  const ailleurs = [
    { data: { results: OUT } }, { data: { output: OUT } }, { data: { result: OUT } }, { results: { output: OUT } }, { output: OUT },
    OUT, { data: OUT }, { a: { b: { c: OUT } } }, { data: { results: { x: { output: OUT } } } },
    { data: { results: SCORE_INFO } }, { data: { results: { output: undefined } } }, { data: { results: {} } },
    { data: { results: null } }, { data: null }, null, undefined, 'x', 42, [], {}
  ];
  for (const env of ailleurs) assert.equal(M.parseSkinResponse(env).status, 'not_found', JSON.stringify(env === undefined ? 'undefined' : env).slice(0, 60));
});

test('A11 data.results.output présent mais pas un tableau → invalid (dont la forme score_info.json)', () => {
  for (const bad of [SCORE_INFO, {}, 'texte', 42, true]) assert.equal(M.parseSkinResponse(wrap(bad)).status, 'invalid', JSON.stringify(bad).slice(0, 40));
  assert.equal(M.parseSkinResponse(wrap(SCORE_INFO)).normalized, null);
});

test('A12 élément sans type valide → invalid (pas de saut silencieux)', () => {
  for (const bad of [null, 'texte', 42, [], { ui_score: 1, raw_score: 2 }, { type: '' }, { type: '  ' }, { type: 7 }, { type: null }]) {
    const r = parse([...clone(OUT), bad]);
    assert.equal(r.status, 'invalid', JSON.stringify(bad));
    assert.equal(r.normalized, null);
  }
});

test('A13 métrique répétée → ambiguous, aucun résultat choisi (même avec des valeurs identiques)', () => {
  for (const dup of [{ type: 'acne', ui_score: 1, raw_score: 2 }, clone(item('acne'))]) {
    const r = parse([...clone(OUT), dup]);
    assert.equal(r.status, 'ambiguous');
    assert.equal(r.normalized, null);
    assert.deepEqual(r.types, ['acne']);
  }
});

test('A14 tableau vide ou sans métrique connue → not_found', () => {
  assert.equal(parse([]).status, 'not_found');
  const r = parse([{ type: 'inconnu', raw_score: 1, ui_score: 2 }, { type: 'autre' }]);
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.ignoredTypes.sort(), ['autre', 'inconnu']);
});

test('A15 types inconnus ignorés, métriques connues lues ; noms douteux masqués dans ignoredTypes', () => {
  const r = parse([...clone(OUT), { type: 'nouvelle_metrique', raw_score: 9 }, { type: 'https://x.example/a?sig=1', raw_score: 1 }]);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.ignoredTypes.sort(), ['<autre>', 'nouvelle_metrique']);
  assert.ok(!JSON.stringify(r.ignoredTypes).includes('sig'));
  assert.deepEqual(r.normalized, normOf(OUT));
});

/* ---- validation générique ---- */
test('A16 un nombre fini est conservé tel quel, même hors 0-100 (aucune plage inventée)', () => {
  for (const v of [0, 100, 120.5, -5, 1e-9, 99.99999999]) {
    const n = normOf([{ type: 'acne', raw_score: v, ui_score: v }]);
    assert.strictEqual(n.acne.rawScore, v);
    assert.strictEqual(n.acne.uiScore, v);
  }
});

test('A17 null, undefined, texte, NaN, Infinity, booléen, objet, tableau → null', () => {
  for (const bad of [null, undefined, '55', '', NaN, Infinity, -Infinity, true, {}, [], () => 1]) {
    const n = normOf([{ type: 'acne', raw_score: bad, ui_score: bad }, { type: 'pore', raw_score: 50 }]);
    assert.strictEqual(n.acne.rawScore, null, `acne=${String(bad)}`);
    assert.strictEqual(n.acne.uiScore, null);
    assert.strictEqual(n.pores.rawScore, 50);
    assert.strictEqual(n.pores.uiScore, null);
  }
});

test('A18 métriques absentes : null, jamais copiées d\'une autre métrique ni calculées', () => {
  const n = normOf([{ type: 'acne', raw_score: 30, ui_score: 40 }]);
  assert.deepEqual(n.acne, { rawScore: 30, uiScore: 40 });
  for (const key of Object.values(SPEC).filter(k => k !== 'acne')) assert.deepEqual(n[key], { rawScore: null, uiScore: null }, key);
  assert.strictEqual(M.deriveConcern(n).concernScore.pores, null);
});

test('A19 mapping dynamique : jeux synthétiques (dont hors plage), valeurs suivies exactement', () => {
  for (const [seed, outOfRange] of [[1, false], [7, false], [42, false], [2024, true], [99999, true]]) {
    const els = synthetic(seed, { outOfRange });
    const n = normOf(els), d = M.deriveConcern(n);
    for (const e of els) {
      const key = SPEC[e.type];
      assert.strictEqual(n[key].rawScore, e.raw_score, `seed ${seed} ${e.type}`);
      assert.strictEqual(n[key].uiScore, e.ui_score);
      assert.strictEqual(d.concernScore[key], 100 - e.raw_score);
    }
    assert.ok(!JSON.stringify(n).includes('example.invalid'));
  }
});

test('A20 entrées hostiles : aucune exception', () => {
  const hostiles = [JSON.parse('{"data":{"results":{"output":[{"type":"__proto__","raw_score":1}]}}}'), JSON.parse('{"data":{"results":{"__proto__":{"output":[]}}}}'),
    { data: { results: { output: [{ type: 'acne', raw_score: { valueOf() { throw new Error('x'); } } }] } } }];
  for (const x of hostiles) assert.doesNotThrow(() => M.parseSkinResponse(x));
});

/* ================= S. skin_type : décision protégée contre toute régression =================
   skin_type est une dst_action SD officielle, mais la forme de son élément dans data.results.output[] n'est pas établie par une
   source officielle. Décision : l'élément est ignoré, normalized.skinType reste null. Si ces tests échouent, quelqu'un a rendu
   skinType alimenté par output[] : il faut alors une source officielle citée, une fixture mise à jour et ces tests réécrits. */
const CONFIG = require('../server/config');
const baseline = () => M.parseSkinResponse(JSON_RESP);
const NULL_SKIN_TYPE = { whole: null, tZone: null, uZone: null };

test('S1 un élément skin_type, quelle que soit sa forme, est ignoré : 15 métriques inchangées, skinType null', () => {
  const formes = [
    { type: 'skin_type', whole: 'Oily', t_zone: 'Oily', u_zone: 'Oily' },                                  // sous-catégories à plat
    { type: 'skin_type', skin_type: { whole: 'Dry', t_zone: 'Oily', u_zone: 'Dry' } },                     // imbriquées
    { type: 'skin_type', value: 'Combination' },
    { type: 'skin_type', ui_score: 55, raw_score: 66, mask_urls: ['https://example.invalid/skin_type.jpg'] },  // avec des scores
    { type: 'skin_type', results: { whole: 'Normal' } },
    { type: 'skin_type' }
  ];
  const ref = baseline();
  for (const forme of formes) {
    const r = parse([...clone(OUT), forme]);
    assert.equal(r.status, 'ok', JSON.stringify(forme));
    assert.deepEqual(r.normalized, ref.normalized, `la forme ${JSON.stringify(forme)} ne doit rien changer`);
    assert.deepEqual(r.normalized.skinType, NULL_SKIN_TYPE);
    assert.deepEqual(r.types.sort(), ref.types.sort());
    assert.deepEqual(r.ignoredTypes, ['skin_type']);                       // règle documentée : ignoré, nom journalisé
    const s = JSON.stringify(r.normalized);
    for (const interdit of ['Oily', 'Dry', 'Combination', 'Normal', '"skin_type"', 'example.invalid']) assert.ok(!s.includes(interdit), interdit);
  }
});

test('S2 aucun type inconnu n\'est transformé en score, même avec raw_score / ui_score numériques', () => {
  const ref = baseline().normalized;
  const inconnus = [{ type: 'skin_type', raw_score: 123.456, ui_score: 654.321 }, { type: 'all', score: 111.111, raw_score: 222.222 },
    { type: 'skin_age', raw_score: 333.333 }, { type: 'nouvelle_metrique', raw_score: 444.444, ui_score: 555.555 }, { type: 'acne_v2', raw_score: 666.666 }];
  const r = parse([...clone(OUT), ...inconnus]);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.normalized, ref);
  const s = JSON.stringify(r.normalized);
  for (const n of ['123.456', '654.321', '111.111', '222.222', '333.333', '444.444', '555.555', '666.666']) assert.ok(!s.includes(n), n);
  assert.deepEqual(r.ignoredTypes.sort(), ['acne_v2', 'all', 'nouvelle_metrique', 'skin_age', 'skin_type']);
});

test('S3 cohérence config ↔ modèle : 16 actions SD demandées = 15 métriques à scores + skin_type (seule sans score parsé)', () => {
  const actions = CONFIG.PERFECT_CORP_SKIN_ACTIONS;
  assert.equal(actions.length, 16);
  assert.equal(new Set(actions).size, 16, 'aucun doublon');
  assert.ok(actions.every(a => /^[a-z0-9_]+$/.test(a) && !a.startsWith('hd_')), 'noms valides, aucune action HD');
  const parsees = M.METRICS.map(m => m[0]);
  assert.deepEqual(parsees.sort(), Object.keys(SPEC).sort());
  for (const m of parsees) assert.ok(actions.includes(m), `${m} est parsé mais n'est pas demandé`);
  assert.deepEqual(actions.filter(a => !parsees.includes(a)), ['skin_type']);   // la seule action demandée sans métrique parsée
  assert.ok(!parsees.includes('skin_type'));
});

test('S4 la fixture format=json reflète l\'état réel des connaissances : 15 éléments, aucun skin_type / all / skin_age inventé', () => {
  assert.equal(OUT.length, 15);
  const types = OUT.map(e => e.type);
  for (const absent of ['skin_type', 'all', 'skin_age']) assert.ok(!types.includes(absent), `${absent} ne doit pas figurer dans la fixture`);
  assert.deepEqual(CONFIG.PERFECT_CORP_SKIN_ACTIONS.filter(a => !types.includes(a)), ['skin_type']);   // incohérence assumée et visible
  const readme = fs.readFileSync(path.join(__dirname, 'fixtures', 'README.md'), 'utf8');
  assert.ok(readme.includes('aucun élément `skin_type`') && /on n'invente donc rien/i.test(readme), 'la limitation doit rester documentée');
});

test('S5 l\'interface n\'affiche aucun type de peau tant que skinType est null (pas de libellé inventé)', () => {
  const n = baseline().normalized;
  assert.strictEqual(M.toDisplay(n, M.deriveConcern(n)).skinType, null);
  assert.equal(M.SKIN_TYPE_LABELS.mixed, undefined);
  assert.equal(M.SKIN_TYPE_LABELS.redness, undefined);   // valeurs documentées sans traduction établie : null plutôt qu'inventé
});

/* ================= B. couche derived (transformation DERMAI) ================= */
test('B1 concernScore = 100 − rawScore pour TOUTES les métriques ayant un rawScore', () => {
  const d = M.deriveConcern(normOf(OUT));
  assert.equal(Object.keys(d.concernScore).length, 15);
  for (const [type, key] of Object.entries(SPEC)) assert.strictEqual(d.concernScore[key], 100 - item(type).raw_score, key);
});

test('B2 derived ne modifie jamais normalized et ne dépend jamais de uiScore', () => {
  const n = normOf(OUT), before = JSON.stringify(n), d1 = M.deriveConcern(n);
  assert.equal(JSON.stringify(n), before);
  const autre = clone(OUT).map(e => ({ ...e, ui_score: 1 }));
  assert.deepEqual(M.deriveConcern(normOf(autre)), d1);
});

test('B3 concernScore sur valeurs hors plage : 100 − rawScore sans correction', () => {
  assert.equal(M.concernScore(120), -20);
  assert.equal(M.concernScore(-5), 105);
  assert.equal(M.concernScore(0), 100);
  for (const bad of [null, undefined, '50', NaN, Infinity]) assert.equal(M.concernScore(bad), null);
});

/* ================= C. couche display (adaptation à l'interface) ================= */
test('C1 display : concernScore pour les préoccupations, rawScore pour l\'hydratation (convention actuelle de l\'interface)', () => {
  const n = normOf(OUT), d = M.deriveConcern(n), v = M.toDisplay(n, d, { goodWhenHigh: ['hydration'] });
  for (const key of UI_KEYS) {
    const type = Object.keys(SPEC).find(t => SPEC[t] === key);
    assert.strictEqual(v[key], key === 'hydration' ? item(type).raw_score : 100 - item(type).raw_score, key);
  }
  assert.strictEqual(M.toDisplay(n, d, { goodWhenHigh: [] }).hydration, 100 - item('moisture').raw_score);
});

test('C2 hydratation : rawScore, uiScore et concernScore restent séparés et intacts malgré la convention d\'affichage', () => {
  const n = normOf(OUT), d = M.deriveConcern(n);
  M.toDisplay(n, d, { goodWhenHigh: ['hydration'] });
  assert.strictEqual(n.hydration.rawScore, item('moisture').raw_score);
  assert.strictEqual(n.hydration.uiScore, item('moisture').ui_score);
  assert.strictEqual(d.concernScore.hydration, 100 - n.hydration.rawScore);
});

test('C3 format = json : global et type de peau absents → null à l\'affichage (rien d\'inventé)', () => {
  const n = normOf(OUT), v = M.toDisplay(n, M.deriveConcern(n));
  assert.strictEqual(v.global, null);
  assert.strictEqual(v.skinType, null);
});

test('C4 règle d\'affichage du global, si une source établie le fournit : jamais inversé, arrondi seulement dans la vue', () => {
  const n = { ...normOf(OUT), globalScore: SCORE_INFO.all.score, skinType: { whole: SCORE_INFO.skin_type.whole, tZone: null, uZone: null } };
  const v = M.toDisplay(n, M.deriveConcern(n));
  assert.strictEqual(v.global, Math.round(SCORE_INFO.all.score));
  assert.notStrictEqual(v.global, 100 - Math.round(SCORE_INFO.all.score));
  assert.strictEqual(n.globalScore, SCORE_INFO.all.score);
  assert.equal(v.skinType, M.SKIN_TYPE_LABELS[SCORE_INFO.skin_type.whole.toLowerCase()]);
  const inconnu = { ...n, skinType: { whole: 'Zorglub', tZone: null, uZone: null } };
  assert.equal(M.toDisplay(inconnu, M.deriveConcern(inconnu)).skinType, null);
});

/* ================= D. contrôle côté navigateur ================= */
test('D1 sanitizeNormalized : aller-retour fidèle, champs inconnus ignorés, version du schéma exigée', () => {
  const n = normOf(OUT);
  assert.deepEqual(M.sanitizeNormalized({ schemaVersion: M.SCHEMA_VERSION, normalized: n }), n);
  const sale = { schemaVersion: M.SCHEMA_VERSION, normalized: { ...clone(n), task_id: 'T', url: 'https://x.example' }, raw: { a: 1 } };
  assert.deepEqual(M.sanitizeNormalized(sale), n);
  assert.equal(M.sanitizeNormalized({ schemaVersion: 99, normalized: n }), null);
  assert.equal(M.sanitizeNormalized({ normalized: n }), null);
  for (const x of [null, undefined, 'x', 1, [], {}, { schemaVersion: 1 }]) assert.equal(M.sanitizeNormalized(x), null);
  const s = M.sanitizeNormalized({ schemaVersion: 1, normalized: { acne: { rawScore: '5', uiScore: NaN }, globalScore: 'x', skinAge: Infinity } });
  assert.deepEqual(s.acne, { rawScore: null, uiScore: null });
  assert.strictEqual(s.globalScore, null);
  assert.strictEqual(s.skinAge, null);
});

/* ================= E. score_info.json : non supporté (le format ZIP n'est pas demandé) ================= */
test('E1 DERMAI n\'expose aucun parseur de score_info.json ; le format ZIP n\'est jamais demandé', () => {
  assert.equal(M.normalizeSkinResult, undefined);
  assert.equal(M.normalizeResultObject, undefined);
  assert.equal(M.parseScoreInfo, undefined);
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'perfectcorp.js'), 'utf8');
  assert.ok(code.includes("format: 'json'") && !/format:\s*'zip'/.test(code));
});

/* ================= F. hygiène ================= */
test('F1 aucune valeur des fixtures n\'est écrite dans le code métier', () => {
  const fichiers = ['js/skin-model.js', 'js/app.js', 'api/skin-analysis.js', 'server/perfectcorp.js', 'server/structure.js', 'server/errors.js'];
  const nombres = new Set();
  (function walk(o) { for (const v of Object.values(o)) { if (typeof v === 'number' && !Number.isInteger(v)) nombres.add(String(v).slice(0, 8)); else if (v && typeof v === 'object') walk(v); } })([JSON_RESP, SCORE_INFO]);
  assert.ok(nombres.size > 10);
  for (const f of fichiers) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    for (const n of nombres) assert.ok(!code.includes(n), `${f} contient ${n}`);
  }
});

test('F2 scanLabels : date longue et courte en français', () => {
  const l = M.scanLabels(new Date(2026, 9, 5));
  assert.equal(l.date, '5 octobre');
  assert.equal(l.short, '5 OCT');
});
