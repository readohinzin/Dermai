'use strict';
/* EXTRACTION D'ATTRIBUTS depuis un nom ou un texte commercial brut. Fonctions PURES (aucun réseau, aucun fichier). Hors du bundle client.
   Règle : l'extraction ne prétend jamais savoir ce qui n'est pas écrit. Un élément absent vaut null (ou une liste vide) ; une entrée invalide ne lève jamais d'exception.
   Aucun score de confiance (phase ultérieure) : les variantes portent seulement une EXACTITUDE catégorielle (explicit | inferred) et leur source. */
const N = require('./normalize.js');

/* Marques et alias, DÉCLARÉS explicitement (écriture normalisée). Un alias n'appartient qu'à une seule marque (voir validateBrands). */
const BRANDS = [
  { canonical: 'The Ordinary', aliases: ['the ordinary', 'theordinary'] },
  { canonical: 'CeraVe', aliases: ['cerave', 'cera ve'] },
  { canonical: 'La Roche-Posay', aliases: ['la roche posay', 'laroche posay', 'lrp'] },
  { canonical: 'Vichy', aliases: ['vichy'] }
];

/* Mentions de variante reconnues (lexique fermé). Chaque entrée : id, motifs sur le texte normalisé ET traduit (voir normalize.js), exactitude du motif.
   « with_ceramides » : explicite avec « with/avec ceramides », seulement déduit avec « + ceramides ». */
const VARIANT_PATTERNS = [
  { id: 'with_ceramides', exactness: 'explicit', re: /\bwith ceramides?\b/ },
  { id: 'with_ceramides', exactness: 'inferred', re: /(?:\+|\band) ceramides?\b/ },
  { id: 'original', exactness: 'explicit', re: /\boriginal (?:formula|formulation)\b|\b(?:formula|formulation) original\b/ },
  { id: 'old_formula', exactness: 'explicit', re: /\bold (?:formula|formulation)\b/ },
  { id: 'new_formula', exactness: 'explicit', re: /\bnew (?:formula|formulation)\b/ },
  { id: 'kit', exactness: 'explicit', re: /\bkit\b/ },
  { id: 'set', exactness: 'explicit', re: /\bset\b/ },
  { id: 'duo', exactness: 'explicit', re: /\bduo\b/ },
  { id: 'refill', exactness: 'explicit', re: /\brefill\b/ },
  { id: 'supersize', exactness: 'explicit', re: /\bsupersize\b/ }
];
const VARIANT_IDS = [...new Set(VARIANT_PATTERNS.map(v => v.id))];

const text = x => (typeof x === 'string' ? x : '');
const tokensOf = s => s.split(' ').filter(Boolean);

/* validateBrands(brands) : liste d'erreurs (vide = valide). Refuse un alias partagé par deux marques ou un alias qui n'est pas en écriture normalisée. */
function validateBrands(brands) {
  const errors = [], seen = new Map();
  for (const b of Array.isArray(brands) ? brands : []) {
    if (!b || typeof b.canonical !== 'string' || !b.canonical.trim() || !Array.isArray(b.aliases) || !b.aliases.length) { errors.push('marque invalide'); continue; }
    for (const a of b.aliases) {
      if (typeof a !== 'string' || a !== N.normalizeText(a) || !a) errors.push(b.canonical + ' : alias non normalisé : ' + a);
      else if (seen.has(a) && seen.get(a) !== b.canonical) errors.push('alias partagé par deux marques : ' + a);
      else seen.set(a, b.canonical);
    }
  }
  return errors;
}

/* extractBrand(texte, marques) : { canonical, alias } | { canonical: null, ambiguous: true, candidates } | null. Correspondance par mots entiers, alias déclarés seulement. */
function extractBrand(input, knownBrands) {
  const toks = tokensOf(N.normalizeText(text(input))), brands = Array.isArray(knownBrands) ? knownBrands : BRANDS, hits = new Map();
  for (const b of brands) for (const alias of (b && Array.isArray(b.aliases) ? b.aliases : [])) {
    const a = tokensOf(alias);
    for (let i = 0; a.length && i + a.length <= toks.length; i++) if (a.every((w, k) => toks[i + k] === w)) { if (!hits.has(b.canonical) || hits.get(b.canonical).length < alias.length) hits.set(b.canonical, alias); }
  }
  if (!hits.size) return null;
  if (hits.size > 1) return { canonical: null, ambiguous: true, candidates: [...hits.keys()].sort() };
  const [canonical, alias] = [...hits.entries()][0];
  return { canonical, alias };
}

/* extractConcentrations(texte) : [{ ingredient, activeId, percentage, raw, qualifiers }]. Pourcentage hors ]0, 100] : ignoré (voir extractConcentrationsDetailed).
   qualifiers : réserves écrites juste après le chiffre (« selon la marque », « fiche US », « à confirmer »), jamais gommées. */
const QUALIFIERS = [['selon la marque', 'per_brand'], ['selon la fiche consultee', 'per_consulted_sheet'], ['fiche us', 'us_sheet'], ['a confirmer', 'to_confirm']];
function extractConcentrationsDetailed(input) {
  const norm = N.normalizeText(text(input)), tokens = N.translate(norm), warnings = [], items = [];
  let from = 0;
  for (const c of N.scanConcentrations(tokens)) {
    if (c.invalid) { warnings.push('invalid_percentage:' + c.raw); continue; }
    const at = norm.indexOf(c.raw, from); if (at >= 0) from = at + c.raw.length;
    const after = at >= 0 ? norm.slice(at + c.raw.length, at + c.raw.length + 60) : '';
    items.push({ ingredient: c.ingredient, activeId: c.activeId, percentage: c.percentage, raw: c.raw, qualifiers: QUALIFIERS.filter(([p]) => after.includes(p)).map(([, q]) => q) });
  }
  return { items, warnings };
}
const extractConcentrations = input => extractConcentrationsDetailed(input).items;

/* extractIngredients(texte) : ingrédients reconnus (lexique fermé), distincts, dans l'ordre : [{ ingredient, activeId }]. */
function extractIngredients(input) {
  const tokens = N.translate(N.normalizeText(text(input))), out = [], seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const ing = N.INGREDIENTS.find(x => x.tokens.every((w, k) => tokens[i + k] === w));
    if (ing) { if (!seen.has(ing.id)) { seen.add(ing.id); out.push({ ingredient: ing.id, activeId: ing.activeId }); } i += ing.tokens.length - 1; }
  }
  return out;
}

/* extractVariants(texte, { exclude }) : [{ id, exactness, raw }]. `exclude` : ids de variante à ignorer parce qu'ils font partie du NOM du produit
   (« Effaclar Duo+M » : « duo » n'est pas un coffret duo). Un motif explicite l'emporte sur un motif déduit du même identifiant. */
function extractVariants(input, opts) {
  const exclude = new Set(opts && Array.isArray(opts.exclude) ? opts.exclude : []);
  const joined = N.translate(N.normalizeText(text(input))).join(' '), found = new Map();
  for (const v of VARIANT_PATTERNS) {
    if (exclude.has(v.id)) continue;
    const m = v.re.exec(joined);
    if (m && (!found.has(v.id) || (found.get(v.id).exactness === 'inferred' && v.exactness === 'explicit'))) found.set(v.id, { id: v.id, exactness: v.exactness, raw: m[0].trim() });
  }
  return [...found.values()];
}

/* extractSpf(texte) : indice solaire écrit, ou null. */
function extractSpf(input) { const m = /\bspf(\d{1,3})(\+)?/.exec(N.normalizeText(text(input))); return m ? { value: Number(m[1]), plus: !!m[2] } : null; }

/* extractAttributes(texte, { brands }) : tout ce qui est écrit, rien de plus. */
function extractAttributes(input, opts) {
  const raw = text(input), normalized = N.normalizeText(raw), det = extractConcentrationsDetailed(raw), quantities = N.parseQuantities(raw);
  return {
    raw, normalized, key: N.comparableKey(raw),
    brand: extractBrand(raw, opts && opts.brands),
    volume: quantities[0] || null, quantities,
    ingredients: extractIngredients(raw), concentrations: det.items,
    variants: extractVariants(raw, opts && { exclude: opts.exclude }), spf: extractSpf(raw),
    warnings: det.warnings.concat(quantities.some(q => q.kind === 'ambiguous') ? ['ambiguous_unit'] : [])
  };
}

module.exports = { BRANDS, VARIANT_PATTERNS, VARIANT_IDS, QUALIFIERS, validateBrands, extractBrand, extractConcentrations, extractConcentrationsDetailed, extractIngredients, extractVariants, extractSpf, extractAttributes };
