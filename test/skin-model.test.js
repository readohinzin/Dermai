'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../js/skin-model.js');
const CONFIG = require('../server/config');

/* Deux fixtures aux rôles distincts :
   - JSON_RESP : réponse de statut AI Skin Analysis v2.1 avec format = "json" (data.results.output[]). SEULE source parsée par DERMAI.
     Contient les 15 métriques (valeurs du résultat de référence) et les éléments skin_type, all et skin_age tels que montrés par
     l'OpenAPI officiel (valeurs d'exemple de l'OpenAPI : Combination / Oily / Dry & Redness, 28.5, 29).
   - SCORE_INFO : contenu de score_info.json du format ZIP (objet indexé par métrique). Non parsé par DERMAI : référence de valeurs. */
const JSON_RESP = require('./fixtures/perfectcorp-json-response.json');
const SCORE_INFO = require('./fixtures/perfectcorp-score-info.json');

/* Spécification du mapping, écrite ICI indépendamment du module : type Perfect Corp → clé DERMAI (15 métriques à deux scores). */
const SPEC = {
  acne: 'acne', pore: 'pores', oiliness: 'oiliness', texture: 'texture', moisture: 'hydration', redness: 'redness',
  age_spot: 'pigmentation', wrinkle: 'wrinkles', firmness: 'firmness', radiance: 'radiance', eye_bag: 'eyeBag',
  tear_trough: 'tearTrough', dark_circle_v2: 'darkCircle', droopy_upper_eyelid: 'droopyUpperEyelid', droopy_lower_eyelid: 'droopyLowerEyelid'
};
const clone = o => JSON.parse(JSON.stringify(o));
const OUT = JSON_RESP.data.results.output;                          // 20 éléments : 15 métriques + 3 skin_type + all + skin_age
const METRIC_OUT = OUT.filter(e => SPEC[e.type]);                   // les 15 métriques seules
const item = type => OUT.find(e => e.type === type);
const wrap = output => ({ status: 200, data: { results: { output }, task_status: 'success' } });
const parse = output => M.parseSkinResponse(wrap(output));
const normOf = output => { const r = parse(output); assert.equal(r.status, 'ok'); return r.normalized; };
const metricsOf = n => Object.fromEntries(Object.values(SPEC).map(k => [k, n[k]]));
const NULL_SKIN_TYPE = { whole: null, tZone: null, uZone: null };

/* Générateur déterministe d'éléments synthétiques : prouve que le mapping ne dépend d'aucune valeur des fixtures. */
function synthetic(seed, { outOfRange = false } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Object.keys(SPEC).map(type => ({ type, ui_score: Math.round(rnd() * 100), raw_score: outOfRange ? rnd() * 400 - 150 : rnd() * 100, mask_urls: ['https://example.invalid/' + type] }));
}

/* ================= A. réponse API format = "json" : data.results.output[] ================= */
test('A1 fixtures : rôles et structures distincts', () => {
  assert.deepEqual(Object.keys(JSON_RESP.data.results), ['output']);
  assert.ok(Array.isArray(OUT) && OUT.length === 20 && METRIC_OUT.length === 15);
  for (const e of METRIC_OUT) assert.deepEqual(Object.keys(e).sort(), ['mask_urls', 'raw_score', 'type', 'ui_score']);
  const st = OUT.filter(e => e.type === 'skin_type');
  assert.equal(st.length, 3);
  for (const e of st) assert.deepEqual(Object.keys(e).sort(), ['region', 'skin_type', 'type']);          // forme de l'OpenAPI
  assert.deepEqual(st.map(e => e.region).sort(), ['t_zone', 'u_zone', 'whole']);
  assert.deepEqual(Object.keys(item('all')).sort(), ['score', 'type']);
  assert.deepEqual(Object.keys(item('skin_age')).sort(), ['score', 'type']);
  assert.ok(!Array.isArray(SCORE_INFO) && SCORE_INFO.all && SCORE_INFO.skin_age !== undefined && SCORE_INFO.skin_type);   // forme score_info.json
  for (const e of METRIC_OUT) assert.deepEqual([e.raw_score, e.ui_score], [SCORE_INFO[e.type].raw_score, SCORE_INFO[e.type].ui_score], `${e.type} : mêmes valeurs de référence`);
});

test('A2 chemin officiel data.results.output : 15 métriques mappées, rawScore intact au bit près', () => {
  const r = M.parseSkinResponse(JSON_RESP);
  assert.equal(r.status, 'ok');
  assert.equal(r.path, 'data.results.output');
  assert.equal(r.form, 'array');
  for (const [type, key] of Object.entries(SPEC)) assert.strictEqual(r.normalized[key].rawScore, item(type).raw_score, `${type} → ${key}.rawScore`);
  assert.deepEqual(r.types.sort(), [...Object.keys(SPEC), 'all', 'skin_age', 'skin_type'].sort());
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

test('A5 mask_urls, url et champs inconnus ne sont jamais exposés dans normalized', () => {
  const sale = clone(OUT).map(e => ({ ...e, url: 'https://example.invalid/URL_SECRET', mask_urls: ['https://example.invalid/MASK_SECRET'], extra_field: 'INCONNU_SECRET' }));
  const r = parse(sale);
  assert.equal(r.status, 'ok');
  const s = JSON.stringify(r.normalized);
  for (const interdit of ['https', 'example.invalid', 'URL_SECRET', 'MASK_SECRET', 'INCONNU_SECRET', 'mask', 'url', 'extra']) assert.ok(!s.includes(interdit), interdit);
  assert.deepEqual(r.normalized, normOf(OUT));                           // aucun champ non listé n'a d'effet
});

test('A6 normalized : champs connus seulement, aucun calcul DERMAI', () => {
  const n = normOf(OUT);
  assert.deepEqual(Object.keys(n).sort(), [...Object.values(SPEC), 'globalScore', 'skinType', 'skinAge'].sort());
  for (const key of Object.values(SPEC)) assert.deepEqual(Object.keys(n[key]).sort(), ['rawScore', 'uiScore']);
  assert.deepEqual(Object.keys(n.skinType).sort(), ['tZone', 'uZone', 'whole']);
});

test('A7 aucune donnée perdue : tous les scores et textes confirmés se retrouvent dans normalized, et rien d\'autre', () => {
  const nums = [...METRIC_OUT.flatMap(e => [e.raw_score, e.ui_score]), item('all').score, item('skin_age').score].sort((a, b) => a - b);
  const n = normOf(OUT);
  const vus = [...Object.values(SPEC).flatMap(k => [n[k].rawScore, n[k].uiScore]), n.globalScore, n.skinAge].sort((a, b) => a - b);
  assert.deepEqual(vus, nums);
  assert.deepEqual([n.skinType.whole, n.skinType.tZone, n.skinType.uZone].sort(), OUT.filter(e => e.type === 'skin_type').map(e => e.skin_type).sort());
});

/* ================= K. skin_type, all, skin_age : formes confirmées par l'OpenAPI officiel ================= */
test('K1 skin_type : region whole / t_zone / u_zone → skinType.whole / tZone / uZone, valeur = champ skin_type', () => {
  const n = normOf([...METRIC_OUT,
    { type: 'skin_type', region: 'whole', skin_type: 'Combination' },
    { type: 'skin_type', region: 't_zone', skin_type: 'Oily' },
    { type: 'skin_type', region: 'u_zone', skin_type: 'Dry & Redness' }]);
  assert.deepEqual(n.skinType, { whole: 'Combination', tZone: 'Oily', uZone: 'Dry & Redness' });
  // même résultat quel que soit l'ordre des éléments
  const inverse = normOf([...METRIC_OUT,
    { type: 'skin_type', region: 'u_zone', skin_type: 'Dry & Redness' },
    { type: 'skin_type', region: 't_zone', skin_type: 'Oily' },
    { type: 'skin_type', region: 'whole', skin_type: 'Combination' }]);
  assert.deepEqual(inverse.skinType, n.skinType);
  // et via la fixture
  const fx = normOf(OUT);
  for (const [region, key] of [['whole', 'whole'], ['t_zone', 'tZone'], ['u_zone', 'uZone']]) assert.strictEqual(fx.skinType[key], OUT.find(e => e.type === 'skin_type' && e.region === region).skin_type);
});

test('K2 skin_type : aucun score utilisé (raw_score, ui_score, score ignorés) ; seule une région fournie est remplie', () => {
  const n = normOf([...METRIC_OUT, { type: 'skin_type', region: 'whole', skin_type: 'Dry', score: 11, raw_score: 22, ui_score: 33 }]);
  assert.deepEqual(n.skinType, { whole: 'Dry', tZone: null, uZone: null });
  assert.deepEqual(metricsOf(n), metricsOf(normOf(METRIC_OUT)));
  assert.strictEqual(n.globalScore, null);
  assert.strictEqual(n.skinAge, null);
  assert.ok(!JSON.stringify(n).includes('"11"') && ![11, 22, 33].some(v => JSON.stringify(n).includes(`:${v},`) || JSON.stringify(n).includes(`:${v}}`)));
});

test('K3 all : score 28.5 → globalScore 28.5, exactement (ni inversé, ni arrondi, ni transformé)', () => {
  const n = normOf([...METRIC_OUT, { type: 'all', score: 28.5 }]);
  assert.strictEqual(n.globalScore, 28.5);
  assert.notStrictEqual(n.globalScore, 100 - 28.5);
  assert.strictEqual(normOf(OUT).globalScore, item('all').score);
  for (const v of [0, 1, 73.33333333333333, 100, 120.5, -3]) assert.strictEqual(normOf([...METRIC_OUT, { type: 'all', score: v }]).globalScore, v);   // aucune plage imposée
});

test('K4 all : raw_score et ui_score ne sont jamais utilisés', () => {
  const n = normOf([...METRIC_OUT, { type: 'all', raw_score: 11, ui_score: 22 }]);
  assert.strictEqual(n.globalScore, null);
  const m = normOf([...METRIC_OUT, { type: 'all', score: 28.5, raw_score: 11, ui_score: 22 }]);
  assert.strictEqual(m.globalScore, 28.5);
});

test('K5 skin_age : score 29 → skinAge 29 ; raw_score et ui_score jamais utilisés', () => {
  assert.strictEqual(normOf([...METRIC_OUT, { type: 'skin_age', score: 29 }]).skinAge, 29);
  assert.strictEqual(normOf(OUT).skinAge, item('skin_age').score);
  assert.strictEqual(normOf([...METRIC_OUT, { type: 'skin_age', raw_score: 44, ui_score: 55 }]).skinAge, null);
  assert.strictEqual(normOf([...METRIC_OUT, { type: 'skin_age', score: 29, raw_score: 44, ui_score: 55 }]).skinAge, 29);
  for (const v of [0, 18, 29.5, 120, -1]) assert.strictEqual(normOf([...METRIC_OUT, { type: 'skin_age', score: v }]).skinAge, v);
});

test('K6 absence de ces éléments : valeurs nulles, sans NaN ni valeur inventée', () => {
  const r = parse(METRIC_OUT);
  assert.equal(r.status, 'ok');
  assert.strictEqual(r.normalized.globalScore, null);
  assert.strictEqual(r.normalized.skinAge, null);
  assert.deepEqual(r.normalized.skinType, NULL_SKIN_TYPE);
  for (const v of [r.normalized.globalScore, r.normalized.skinAge]) assert.ok(v === null && !Number.isNaN(v));
  assert.ok(!JSON.stringify(r.normalized.skinType).includes('NaN'));
  assert.deepEqual(r.types.sort(), Object.keys(SPEC).sort());
  const v = M.toResultView(r.normalized);
  assert.strictEqual(v.global.score, null);
  assert.strictEqual(v.skinType, null);
  assert.strictEqual(v.skinAge, null);
});

test('K7 valeurs invalides pour all et skin_age : null, sans crash', () => {
  for (const bad of [null, undefined, '28.5', '', NaN, Infinity, -Infinity, true, {}, [], () => 1, { valueOf() { throw new Error('x'); } }]) {
    const n = normOf([...METRIC_OUT, { type: 'all', score: bad }, { type: 'skin_age', score: bad }]);
    assert.strictEqual(n.globalScore, null, `all.score=${String(typeof bad === 'function' ? 'fn' : bad)}`);
    assert.strictEqual(n.skinAge, null);
    assert.strictEqual(n.acne.rawScore, normOf(METRIC_OUT).acne.rawScore);   // le reste n'est pas touché
  }
});

test('K8 valeurs invalides pour skin_type : null pour cette région seulement, sans crash', () => {
  for (const bad of [null, undefined, 7, true, {}, [], '', '   ', 'x'.repeat(41), NaN]) {
    const n = normOf([...METRIC_OUT, { type: 'skin_type', region: 'whole', skin_type: bad }, { type: 'skin_type', region: 't_zone', skin_type: 'Oily' }]);
    assert.strictEqual(n.skinType.whole, null, `skin_type=${String(bad)}`);
    assert.strictEqual(n.skinType.tZone, 'Oily');
    assert.strictEqual(n.skinType.uZone, null);
  }
  const sansChamp = normOf([...METRIC_OUT, { type: 'skin_type', region: 'whole' }]);
  assert.deepEqual(sansChamp.skinType, NULL_SKIN_TYPE);
});

test('K9 skin_type avec région absente, inconnue ou non texte : élément ignoré, aucune valeur attribuée', () => {
  for (const region of [undefined, null, 'forehead', 'cheek', 'WHOLE', '', 5, {}, ['whole']]) {
    const r = parse([...METRIC_OUT, { type: 'skin_type', region, skin_type: 'Oily' }]);
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.normalized.skinType, NULL_SKIN_TYPE, `region=${JSON.stringify(region)}`);
    assert.ok(r.ignoredTypes.some(t => t.startsWith('skin_type@')), 'élément ignoré journalisable');
    assert.ok(!r.types.includes('skin_type'));
  }
});

test('K10 resize_image : toujours ignoré, quelle que soit sa forme', () => {
  const ref = parse(OUT);
  const formes = [{ type: 'resize_image' }, { type: 'resize_image', url: 'https://example.invalid/RESIZED', score: 5, raw_score: 6, ui_score: 7, region: 'whole', skin_type: 'Oily', mask_urls: ['https://example.invalid/m'] }];
  for (const f of formes) {
    const r = parse([...clone(OUT), f]);
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.normalized, ref.normalized);
    assert.deepEqual(r.ignoredTypes, ['resize_image']);
    assert.ok(!r.types.includes('resize_image'));
    assert.ok(!JSON.stringify(r.normalized).includes('RESIZED'));
  }
});

test('K11 les 15 métriques restent strictement inchangées avec ou sans skin_type / all / skin_age', () => {
  assert.deepEqual(metricsOf(normOf(OUT)), metricsOf(normOf(METRIC_OUT)));
  assert.deepEqual(M.toResultView(normOf(OUT)).priorities, M.toResultView(normOf(METRIC_OUT)).priorities);
  for (const [type, key] of Object.entries(SPEC)) {
    const n = normOf(OUT);
    assert.strictEqual(n[key].rawScore, item(type).raw_score);
    assert.strictEqual(n[key].uiScore, item(type).ui_score);
  }
});

test('K12 types spéciaux répétés → ambiguous (même règle de prudence que les 15 métriques), jamais de choix arbitraire', () => {
  const cas = {
    all: [{ type: 'all', score: 28.5 }, { type: 'all', score: 28.5 }],
    skin_age: [{ type: 'skin_age', score: 29 }, { type: 'skin_age', score: 30 }],
    'skin_type (même région)': [{ type: 'skin_type', region: 'whole', skin_type: 'Oily' }, { type: 'skin_type', region: 'whole', skin_type: 'Dry' }]
  };
  for (const [nom, extra] of Object.entries(cas)) {
    const r = parse([...METRIC_OUT, ...extra]);
    assert.equal(r.status, 'ambiguous', nom);
    assert.equal(r.normalized, null);
  }
  assert.equal(parse([...METRIC_OUT, { type: 'skin_type', region: 'whole', skin_type: 'A' }, { type: 'skin_type', region: 't_zone', skin_type: 'B' }]).status, 'ok');   // régions différentes : normal
});

test('K13 sans aucune des 15 métriques : not_found (règle inchangée), même si all, skin_age ou skin_type sont présents', () => {
  const r = parse([{ type: 'all', score: 28.5 }, { type: 'skin_age', score: 29 }, { type: 'skin_type', region: 'whole', skin_type: 'Oily' }]);
  assert.equal(r.status, 'not_found');
  assert.equal(r.normalized, null);
});

test('K14 éléments hors chemin officiel (clés voisines de type score_info.json) jamais lus', () => {
  const env = wrap(METRIC_OUT);
  env.data.results.all = { score: 99 }; env.data.results.skin_age = 99; env.data.skin_type = { whole: 'Dry' }; env.data.results.output.push();
  const n = M.parseSkinResponse(env).normalized;
  assert.strictEqual(n.globalScore, null);
  assert.strictEqual(n.skinAge, null);
  assert.deepEqual(n.skinType, NULL_SKIN_TYPE);
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
  const pores = M.toResultView(n).others.find(m => m.key === 'pores');
  assert.strictEqual(pores.score, null);                               // absente : indisponible, jamais copiée ni calculée
});

test('A19 mapping dynamique : jeux synthétiques (dont hors plage), valeurs suivies exactement', () => {
  for (const [seed, outOfRange] of [[1, false], [7, false], [42, false], [2024, true], [99999, true]]) {
    const els = synthetic(seed, { outOfRange });
    const n = normOf(els), view = M.toResultView(n), shown = [...view.priorities, ...view.others];
    for (const e of els) {
      const key = SPEC[e.type];
      assert.strictEqual(n[key].rawScore, e.raw_score, `seed ${seed} ${e.type}`);
      assert.strictEqual(n[key].uiScore, e.ui_score);
      assert.strictEqual(shown.find(m => m.key === key).score, e.ui_score, 'affichage = ui_score, jamais le raw_score');
    }
    assert.ok(!JSON.stringify(n).includes('example.invalid'));
  }
});

test('A19b all, skin_age et skin_type suivent aussi les valeurs reçues (jeux générés)', () => {
  for (const seed of [3, 11, 77]) {
    let s = seed; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const all = rnd() * 100, age = Math.round(18 + rnd() * 60), vals = ['Normal', 'Dry', 'Oily & Redness'];
    const n = normOf([...synthetic(seed), { type: 'all', score: all }, { type: 'skin_age', score: age },
      { type: 'skin_type', region: 'whole', skin_type: vals[0] }, { type: 'skin_type', region: 't_zone', skin_type: vals[1] }, { type: 'skin_type', region: 'u_zone', skin_type: vals[2] }]);
    assert.strictEqual(n.globalScore, all);
    assert.strictEqual(n.skinAge, age);
    assert.deepEqual(n.skinType, { whole: vals[0], tZone: vals[1], uZone: vals[2] });
  }
});

test('A20 entrées hostiles : aucune exception', () => {
  const hostiles = [JSON.parse('{"data":{"results":{"output":[{"type":"__proto__","raw_score":1}]}}}'), JSON.parse('{"data":{"results":{"__proto__":{"output":[]}}}}'),
    { data: { results: { output: [{ type: 'acne', raw_score: { valueOf() { throw new Error('x'); } } }] } } },
    { data: { results: { output: [{ type: 'skin_type', region: 'whole', skin_type: { toString() { throw new Error('x'); } } }, { type: 'all', score: { valueOf() { throw new Error('x'); } } }] } } }];
  for (const x of hostiles) assert.doesNotThrow(() => M.parseSkinResponse(x));
});

/* ================= B. plus d'ancien système de score ================= */
test('B1 le modèle n\'expose plus concernScore, deriveConcern ni toDisplay (aucune formule 100 − rawScore)', () => {
  for (const name of ['concernScore', 'deriveConcern', 'toDisplay', 'UI_KEYS']) assert.equal(M[name], undefined, name);
});

/* ================= C. données d'affichage depuis la fixture complète ================= */
test('C1 score global = all.score (jamais recalculé), type de peau whole en français', () => {
  const n = normOf(OUT), v = M.toResultView(n);
  assert.strictEqual(v.global.score, Math.round(item('all').score));
  assert.strictEqual(n.globalScore, item('all').score);                  // normalized garde la valeur exacte
  assert.notStrictEqual(v.global.score, 100 - Math.round(item('all').score));
  assert.equal(v.skinType.label, 'Peau mixte');                          // whole = Combination
});

test('C2 libellé du type de peau : les 8 valeurs documentées sont traduites, une valeur inconnue → aucun libellé, rien d\'inventé', () => {
  for (const [whole, attendu] of [['Oily', 'Peau grasse'], ['Dry', 'Peau sèche'], ['Normal', 'Peau normale'], ['Combination', 'Peau mixte'],
    ['Dry & Redness', 'Peau sèche avec tendance aux rougeurs'], ['Oily & Redness', 'Peau grasse avec tendance aux rougeurs'],
    ['Combination & Redness', 'Peau mixte avec tendance aux rougeurs'], ['Redness', 'Tendance aux rougeurs'], ['Zorglub', null]]) {
    const n = { ...normOf(METRIC_OUT), skinType: { whole, tZone: null, uZone: null } };
    const label = M.toResultView(n).skinType;
    assert.strictEqual(label ? label.label : null, attendu, whole);
    assert.strictEqual(n.skinType.whole, whole);                         // le texte reçu est conservé tel quel dans normalized
  }
  assert.equal(M.SKIN_TYPE_LABELS.mixed, undefined);
});

test('C3 les régions t_zone et u_zone ne servent pas à l\'affichage du type de peau', () => {
  const n = { ...normOf(METRIC_OUT), skinType: { whole: null, tZone: 'Oily', uZone: 'Dry' } };
  assert.strictEqual(M.toResultView(n).skinType, null);
});

/* ================= D. contrôle côté navigateur ================= */
test('D1 sanitizeNormalized : aller-retour fidèle (y compris global, âge, type de peau), champs inconnus ignorés, version exigée', () => {
  const n = normOf(OUT);
  assert.deepEqual(M.sanitizeNormalized({ schemaVersion: M.SCHEMA_VERSION, normalized: n }), n);
  assert.strictEqual(M.sanitizeNormalized({ schemaVersion: 1, normalized: n }).globalScore, item('all').score);
  assert.strictEqual(M.sanitizeNormalized({ schemaVersion: 1, normalized: n }).skinAge, item('skin_age').score);
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

/* ================= E. score_info.json : non supporté (le format ZIP n'est jamais demandé) ================= */
test('E1 DERMAI n\'expose aucun parseur de score_info.json ; le format ZIP n\'est jamais demandé', () => {
  assert.equal(M.normalizeSkinResult, undefined);
  assert.equal(M.normalizeResultObject, undefined);
  assert.equal(M.parseScoreInfo, undefined);
  const code = fs.readFileSync(path.join(__dirname, '..', 'server', 'perfectcorp.js'), 'utf8');
  assert.ok(code.includes("format: 'json'") && !/format:\s*'zip'/.test(code));
});

/* ================= S. cohérence configuration ↔ modèle ================= */
test('S3 16 actions SD demandées = 15 métriques à scores + skin_type (lu via region/skin_type) ; all et skin_age ne sont pas des actions', () => {
  const actions = CONFIG.PERFECT_CORP_SKIN_ACTIONS;
  assert.equal(actions.length, 16);
  assert.equal(new Set(actions).size, 16, 'aucun doublon');
  assert.ok(actions.every(a => /^[a-z0-9_]+$/.test(a) && !a.startsWith('hd_')), 'noms valides, aucune action HD');
  const parsees = M.METRICS.map(m => m[0]);
  assert.deepEqual(parsees.sort(), Object.keys(SPEC).sort());
  for (const m of parsees) assert.ok(actions.includes(m), `${m} est parsé mais n'est pas demandé`);
  assert.deepEqual(actions.filter(a => !parsees.includes(a)), ['skin_type']);
  assert.ok(!actions.includes('all') && !actions.includes('skin_age'));
});

test('S4 la fixture format=json contient les formes confirmées par l\'OpenAPI et sa provenance est documentée', () => {
  const types = OUT.map(e => e.type);
  for (const t of ['skin_type', 'all', 'skin_age']) assert.ok(types.includes(t), `${t} doit figurer dans la fixture`);
  assert.ok(!types.includes('resize_image'), 'resize_image : forme non documentée, absente de la fixture (testée à part)');
  const readme = fs.readFileSync(path.join(__dirname, 'fixtures', 'README.md'), 'utf8');
  assert.ok(/OpenAPI/.test(readme) && readme.includes('skin_type') && readme.includes('28.5'), 'la provenance doit rester documentée');
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
