'use strict';
/* NORMALISATION de texte et d'unités pour l'outillage Market Discovery.
   Fonctions PURES : aucune lecture de fichier, aucun réseau, aucun état global modifié. Jamais envoyé au navigateur (hors de js/).
   But : rendre COMPARABLES deux écritures d'un même nom commercial, sans jamais effacer ce qui distingue deux produits.

   JETONS PROTÉGÉS : nombres, concentrations (« 2% » reste « 2% »), « + », volumes avec leur unité (« 30ml »), SPF, et les mentions de variante
   (with, kit, set, duo, refill, supersize, old/new/original formula...) ne sont jamais supprimés ni fusionnés. Les mots vides retirés
   (the, le, la, de...) ne sont jamais discriminants.
   La traduction FR/EN passe UNIQUEMENT par le lexique fermé ci-dessous : un mot absent du lexique n'est pas traduit, deux écritures
   non déclarées restent différentes. Les alias de marque vivent dans attributes.js. */

const LEXICON_VERSION = 1;
const MAX_LEN = 1000;                                   // un texte plus long est tronqué : borne le coût sur des entrées hostiles

/* Lexique FR → EN, fermé et versionné. Ajouter une ligne = une équivalence utile et justifiée par un produit ou une variante du catalogue.
   Les expressions (PHRASES) passent avant les mots ; elles sont écrites SANS accent, en minuscules, comme après normalizeText. */
const PHRASES = [
  ['acide hyaluronique', 'hyaluronic acid'], ['acide salicylique', 'salicylic acid'], ['acide azelaique', 'azelaic acid'], ['acide mandelique', 'mandelic acid'],
  ['acide glycolique', 'glycolic acid'], ['acide lactique', 'lactic acid'], ['acide ascorbique', 'ascorbic acid'],
  ['hyaluronate de sodium', 'sodium hyaluronate'], ['palmitate de retinyle', 'retinyl palmitate'],
  ['vitamine b3', 'niacinamide'], ['vitamine b5', 'vitamin b5'], ['vitamine c', 'vitamin c'],
  ['formule originale', 'original formula'], ['formulation originale', 'original formulation'], ['super size', 'supersize']
];
const WORDS = {
  serum: 'serum', creme: 'cream', baume: 'balm', avec: 'with', sans: 'without', glycerine: 'glycerin', coffret: 'set', recharge: 'refill',
  ancienne: 'old', nouvelle: 'new', formule: 'formula', vitamine: 'vitamin',
  acide: 'acid', hyaluronique: 'hyaluronic', salicylique: 'salicylic', azelaique: 'azelaic', mandelique: 'mandelic', glycolique: 'glycolic', lactique: 'lactic', ascorbique: 'ascorbic'
};
const STOPWORDS = new Set(['the', 'le', 'la', 'les', 'de', 'du', 'des', 'd', 'l', 'et', 'and', 'of']);

/* Ingrédients reconnus, en anglais, avec l'actif DERMAI qu'ils représentent quand le catalogue actuel les relie (jamais un nouvel actif).
   [écriture normalisée, ingrédient canonique, activeId | null]. Les écritures les plus longues sont essayées d'abord. */
const INGREDIENTS = [
  ['hyaluronic acid', 'hyaluronic acid', 'hyaluronic'], ['sodium hyaluronate', 'sodium hyaluronate', 'hyaluronic'], ['ha', 'hyaluronic acid', 'hyaluronic'],
  ['niacinamide', 'niacinamide', 'niacinamide'], ['zinc pca', 'zinc', 'zinc'], ['zinc', 'zinc', 'zinc'],
  ['salicylic acid', 'salicylic acid', 'salicylic'], ['azelaic acid', 'azelaic acid', 'azelaic'],
  ['ascorbyl glucoside', 'ascorbyl glucoside', 'vitamin_c'], ['ascorbic acid', 'ascorbic acid', 'vitamin_c'], ['vitamin c', 'vitamin c', 'vitamin_c'],
  ['mandelic acid', 'mandelic acid', 'aha_pha'], ['glycolic acid', 'glycolic acid', 'aha_pha'], ['lactic acid', 'lactic acid', 'aha_pha'],
  ['panthenol', 'panthenol', 'panthenol'], ['vitamin b5', 'panthenol', 'panthenol'], ['b5', 'panthenol', 'panthenol'],
  ['ceramides', 'ceramides', 'ceramides'], ['ceramide', 'ceramides', 'ceramides'], ['glycerin', 'glycerin', 'glycerin'],
  ['retinyl palmitate', 'retinyl palmitate', 'retinoid']
].map(([form, id, activeId]) => ({ tokens: form.split(' '), id, activeId })).sort((a, b) => b.tokens.length - a.tokens.length);
const FILLERS = new Set(['solution', 'suspension', 'serum', 'pure', 'gel', 'cream']);      // mots qui peuvent séparer un ingrédient de son pourcentage

/* Unités prises en charge. `kind` : volume → ml ; mass → g. « oz » seul est AMBIGU (once liquide ou once de poids) : jamais converti. */
const UNITS = {
  ml: { kind: 'volume', to: 'ml', factor: 1 }, cl: { kind: 'volume', to: 'ml', factor: 10 }, l: { kind: 'volume', to: 'ml', factor: 1000 },
  floz: { kind: 'volume', to: 'ml', factor: 29.5735 },
  g: { kind: 'mass', to: 'g', factor: 1 }, kg: { kind: 'mass', to: 'g', factor: 1000 },
  oz: { kind: 'ambiguous', to: null, factor: null }
};
const round4 = x => Math.round(x * 10000) / 10000;
const unitKey = u => String(u).toLowerCase().replace(/[\s.]/g, '');          // « fl. oz » → floz

/* ---------- Texte ---------- */
/* normalizeText : NFKD, accents retirés, minuscules, tirets et ponctuation → espaces, virgule décimale → point, « % » collé au nombre,
   « + » et « / » isolés par des espaces, unités collées au nombre (« 30 ml » → « 30ml »), « spf 30 » → « spf30 ». Entrée non texte → ''. */
function normalizeText(input) {
  if (typeof input !== 'string') return '';
  let s = input.slice(0, MAX_LEN).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  s = s.replace(/(\d),(\d)/g, '$1.$2').replace(/&/g, ' and ');
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, ' $1\u0002 ').replace(/%/g, ' ').replace(/\u0002/g, '%');   // « 2 % » → « 2% » ; un « % » sans nombre est ignoré
  s = s.replace(/\bspf\s*(\d{1,3})\s*(\+)?/g, (m, n, plus) => ' spf' + n + (plus ? '\u0003' : '') + ' ');       // « SPF 50+ » : le « + » fait partie de l'indice
  s = s.replace(/\+/g, ' + ').replace(/\//g, ' / ');
  s = s.replace(/(?<![a-z0-9.])(\d+)\s?x\s?(?=\d)/g, ' $1 x ');                       // « 2x30ml » → « 2 x 30ml » : le multiplicateur reste lisible
  s = s.replace(/(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|ml|cl|kg|g|l|oz)(?![a-z0-9])/g, (m, n, u) => ' ' + n + unitKey(u) + ' ');
  s = s.replace(/(\d)\.(\d)/g, '$1\u0001$2').replace(/[^a-z0-9%+/\u0001\u0003\s]/g, ' ').replace(/\u0001/g, '.').replace(/\u0003/g, '+');
  return s.replace(/\s+/g, ' ').trim();
}

/* translate : applique le lexique fermé (expressions puis mots) à un texte déjà normalisé. Retourne la liste de jetons. */
function translate(normalized) {
  const toks = String(normalized || '').split(' ').filter(Boolean), out = [];
  for (let i = 0; i < toks.length; i++) {
    let hit = null;
    for (const [fr, en] of PHRASES) { const f = fr.split(' '); if (f.every((w, k) => toks[i + k] === w)) { hit = [f.length, en.split(' ')]; break; } }
    if (hit) { out.push(...hit[1]); i += hit[0] - 1; } else out.push(Object.prototype.hasOwnProperty.call(WORDS, toks[i]) ? WORDS[toks[i]] : toks[i]);
  }
  return out;
}

/* ---------- Unités ---------- */
/* normalizeUnit(value, unit) : { ok, raw: {value, unit}, normalized: {value, unit} | null, kind } ou { ok: false, error }.
   La valeur d'origine est toujours conservée dans `raw` ; `normalized` ne sert qu'à comparer. Jamais d'exception. */
function normalizeUnit(value, unit) {
  const v = typeof value === 'string' ? Number(value.replace(',', '.').trim()) : value;
  if (value === null || value === undefined || value === '') return { ok: false, error: 'missing_value' };
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return { ok: false, error: 'invalid_value' };
  if (typeof unit !== 'string' || !unit.trim()) return { ok: false, error: 'missing_unit' };
  const def = UNITS[unitKey(unit)];
  if (!def) return { ok: false, error: 'unknown_unit' };
  const raw = { value: v, unit: unit.trim() };
  if (def.kind === 'ambiguous') return { ok: true, raw, normalized: null, kind: 'ambiguous', warning: 'ambiguous_unit' };
  return { ok: true, raw, normalized: { value: round4(v * def.factor), unit: def.to }, kind: def.kind };
}

/* parseQuantities(text) : toutes les quantités « nombre + unité » du texte, dans l'ordre. raw = l'écriture d'origine. */
function parseQuantities(text) {
  if (typeof text !== 'string') return [];
  const out = [], re = /(\d+(?:[.,]\d+)?)\s*(fl\.?\s*oz|ml|cl|kg|g|l|oz)(?![a-z0-9])/gi;
  let m;
  for (const src = text.slice(0, MAX_LEN); (m = re.exec(src)) !== null;) {
    const r = normalizeUnit(m[1], m[2]);
    if (r.ok) out.push({ raw: m[0], value: r.raw.value, unit: r.raw.unit, normalized: r.normalized, kind: r.kind });
  }
  return out;
}
/* parseVolume(text) : la première quantité du texte, ou null. */
const parseVolume = text => parseQuantities(text)[0] || null;

/* ---------- Concentrations ---------- */
/* scanConcentrations(tokens) : chaque « n% » est rattaché à l'ingrédient qui le précède (au plus 2 mots de remplissage entre les deux, sans franchir « + » ni « / »),
   sinon à celui qui le suit. Pourcentage hors ]0, 100] : { invalid: true }. Ingrédient inconnu : null (le pourcentage est conservé). */
function scanConcentrations(tokens) {
  const out = [], isSep = t => t === '+' || t === '/';
  const endsWith = (j, ing) => ing.tokens.every((w, k) => tokens[j - ing.tokens.length + 1 + k] === w);
  const startsAt = (j, ing) => ing.tokens.every((w, k) => tokens[j + k] === w);
  for (let i = 0; i < tokens.length; i++) {
    const m = /^(\d+(?:\.\d+)?)%$/.exec(tokens[i]);
    if (!m) continue;
    const percentage = Number(m[1]);
    if (!(percentage > 0 && percentage <= 100)) { out.push({ index: i, raw: tokens[i], invalid: true }); continue; }
    let found = null, j = i - 1, skipped = 0;
    while (j >= 0 && skipped < 2 && FILLERS.has(tokens[j])) { j--; skipped++; }
    if (j >= 0 && !isSep(tokens[j])) found = INGREDIENTS.find(ing => endsWith(j, ing)) || null;
    if (!found) { let k = i + 1, n = 0; while (k < tokens.length && n < 2 && FILLERS.has(tokens[k])) { k++; n++; } if (k < tokens.length) found = INGREDIENTS.find(ing => startsAt(k, ing)) || null; }
    out.push({ index: i, raw: tokens[i], percentage, ingredient: found ? found.id : null, activeId: found ? found.activeId : null });
  }
  return out;
}

/* ---------- Clé comparable ---------- */
/* comparableTokens(text) : les jetons comparables, dans l'ordre d'écriture (casse, accents, langue, quantités et concentrations normalisés, mots vides retirés ; « + » conservé).
   comparableKey en est la forme triée. */
/* comparableKey(text) : représentation comparable, indépendante de la casse, des accents, de la ponctuation, de l'ordre des mots et de la langue (lexique fermé).
   Les quantités sont ramenées à une unité commune (30ml, 0.03l → 30ml). Les mots vides sont retirés ; JAMAIS un nombre, un « % », un « + » ni une mention de variante.
   Chaque concentration est LIÉE à son ingrédient (« niacinamide=10% ») : « Niacinamide 10% + Zinc 1% » ≠ « Niacinamide 1% + Zinc 10% » malgré le tri des mots.
   Limite connue : un pourcentage sans ingrédient reconnu est lié à « ? » et se compare comme un jeton libre. */
function comparableTokens(text) {
  const base = translate(normalizeText(text)).map(t => {
    const q = /^(\d+(?:\.\d+)?)(floz|ml|cl|kg|g|l|oz)$/.exec(t);
    if (!q) return t;
    const r = normalizeUnit(q[1], q[2]);
    return r.ok && r.normalized ? r.normalized.value + r.normalized.unit : t;
  });
  const bound = base.slice();
  for (const c of scanConcentrations(base)) bound[c.index] = (c.invalid ? '?' : (c.ingredient || '?').replace(/ /g, '_')) + '=' + c.raw;
  return bound.filter(t => !STOPWORDS.has(t));
}
function comparableKey(text) {
  const toks = comparableTokens(text);
  /* Les segments séparés par « + » ou « / » sont triés entre eux et en eux : « B5 + Hyaluronic Acid 2% » égale « Hyaluronic Acid 2% + B5 ». */
  const segs = []; let cur = [];
  for (const t of toks) { if (t === '+' || t === '/') { segs.push(cur.sort().join(' ')); cur = []; } else cur.push(t); }
  segs.push(cur.sort().join(' '));
  return segs.sort().join(' + ');                 // un « + » en tête ou en queue reste visible : « Baume B5+ » ≠ « Baume B5 », « Duo+ » ≠ « Duo »
}

module.exports = { LEXICON_VERSION, PHRASES, WORDS, STOPWORDS, INGREDIENTS, FILLERS, UNITS, normalizeText, translate, normalizeUnit, parseQuantities, parseVolume, scanConcentrations, comparableTokens, comparableKey };
