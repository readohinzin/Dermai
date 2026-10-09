'use strict';
/* MATCHING PRODUIT : « cette fiche commerciale est-elle PROBABLEMENT le même produit que cette identité du catalogue ? »
   Déterministe, explicable, sans réseau. Pur : il LIT une identité (data/market/identities.json) et un objet candidat ; il ne modifie ni l'un ni l'autre.
   Il ne répond PAS à « est-ce une offre fiable ? » (qualité de source, fraîcheur, pays du vendeur, lien : confidence.js) ni à LOCAL/REGIONAL/IMPORT (classify.js), qui lisent la CLASSE de ce résultat sans jamais le modifier.

   PRINCIPE : une TABLE DE DÉCISION, pas une formule. Chaque signal vaut MATCH, MISMATCH ou UNKNOWN. Aucun coefficient, aucun seuil : la classe vient des signaux et des contradictions.
   Le `score` numérique renvoyé est AUXILIAIRE (observer, trier) ; il est calculé APRÈS la classe et ne la décide jamais.
   « Il vaut mieux dire POSSIBLE_MATCH que se tromper de produit » : toute information absente qui pourrait distinguer deux produits frères empêche STRONG et EXACT.

   Candidat : { title (obligatoire), brand?, description?, volume? ({ value, unit } ou texte), gtin?, mpn?, sku? }.
   `sku` est une référence VENDEUR : ignorée (jamais assimilée à un MPN fabricant).
   Les alias de marque et de nom, le lexique FR/EN et les ingrédients viennent de normalize.js, attributes.js et de l'identité : le matcher n'en invente aucun. */
const N = require('./normalize.js');
const A = require('./attributes.js');

const CLASSES = ['EXACT_MATCH', 'STRONG_MATCH', 'POSSIBLE_MATCH', 'VARIANT_MATCH', 'NO_MATCH'];
const CLASS_RANK = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const M = 'MATCH', X = 'MISMATCH', U = 'UNKNOWN';
const SIGNAL_ORDER = ['gtin', 'mpn', 'brand', 'name', 'actives', 'concentration', 'volume', 'variant'];

const FORMULATIONS = ['with_ceramides', 'original', 'old_formula', 'new_formula'];
const PACKAGINGS = ['kit', 'set', 'duo', 'refill', 'supersize', 'multipack'];          // multipack : « 2 x 30 ml » (détecté ici, hors vocabulaire d'extraction)
const NEUTRAL_WORDS = new Set(['serum', 'face', 'facial', 'skin', 'treatment']);                       // mots qui ne changent pas le produit
/* Mots qui désignent un AUTRE produit : type de soin ou zone d'usage. S'ils figurent dans la fiche sans figurer dans l'identité, le nom est incompatible. */
const CONFLICT_WORDS = new Set(['cream', 'lotion', 'mask', 'cleanser', 'toner', 'oil', 'spray', 'stick', 'patch', 'wash', 'foam', 'mist', 'shampoo', 'conditioner', 'soap', 'scrub', 'sunscreen', 'gel', 'balm',
  'eye', 'hair', 'body', 'lip', 'hand', 'foot', 'neck', 'scalp', 'night', 'day']);
const INGREDIENT_WORDS = new Set(N.INGREDIENTS.flatMap(i => i.tokens));
const FLOZ_ROUNDING = 0.02;       // une étiquette américaine arrondit 30 ml en « 1 fl oz » (29,5735 ml) : écart toléré de 2 % POUR CE CAS SEULEMENT (unité d'origine fl oz)
const SIBLING_PATTERNS = { anhydrous: /\banhydrous\b|\banhydre\b/ };                                  // frères de l'identité hors vocabulaire d'extraction (« version anhydre » du catalogue)

const REASONS = {
  gtin_match: 'GTIN identique', gtin_mismatch: 'GTIN différent', mpn_match: 'référence fabricant (MPN) identique', mpn_mismatch: 'référence fabricant (MPN) différente',
  brand_match: 'marque concordante', brand_mismatch: 'marque différente', brand_unknown: 'marque non établie',
  name_match: 'nom concordant', name_conflict: 'nom incompatible (mots qui désignent un autre produit)', name_plus_suffix: 'nom incompatible (suffixe « + » différent)', name_incomplete: 'nom incomplet dans la fiche', name_no_overlap: 'le titre désigne un autre produit : aucun mot du nom du produit, des mots en plus', name_extra_words: 'mots du titre non expliqués', name_absent: 'aucun mot de nom exploitable',
  actives_match: 'actifs concordants', actives_mismatch: 'actif incompatible', actives_unknown: 'actifs non établis',
  concentration_match: 'concentration concordante', concentration_mismatch: 'concentration différente', concentration_absent: 'concentration absente de la fiche', concentration_not_in_catalog: 'concentration non écrite au catalogue',
  volume_match: 'volume concordant', volume_format_differs: 'format différent du produit ciblé', volume_kind_mismatch: 'volume incompatible (unité de nature différente)', volume_absent: 'volume absent de la fiche', volume_not_in_catalog: 'volume absent du catalogue', volume_several: 'plusieurs formats dans la fiche',
  variant_match: 'formulation concordante', variant_formulation_mismatch: 'autre formulation que le produit ciblé', variant_packaging: 'conditionnement différent du produit seul', variant_sibling: 'variante connue du produit', variant_absent: 'formulation absente de la fiche', variant_conflict: 'mentions de formulation contradictoires', variant_negated: 'formulation explicitement exclue',
  candidate_invalid: 'fiche inexploitable : objet absent ou titre manquant', identity_invalid: 'identité inexploitable'
};
const WARNINGS = {
  sibling_formulation_exists: 'le catalogue possède un produit frère avec une formulation différente : l\'absence de formulation n\'est pas une preuve d\'identité',
  variant_not_resolved: 'la formulation de la fiche n\'est pas précisée',
  catalog_concentration_uncertain: 'la concentration du catalogue est à confirmer',
  candidate_gtin_ignored: 'GTIN fourni par la fiche mais absent du catalogue : sans valeur de preuve', candidate_mpn_ignored: 'référence fabricant fournie par la fiche mais absente du catalogue : sans valeur de preuve',
  invalid_candidate_gtin: 'GTIN de la fiche invalide (longueur ou clé de contrôle)', sku_ignored: 'SKU vendeur ignoré (ce n\'est pas une référence fabricant)',
  multiple_brands: 'plusieurs marques dans le titre', ambiguous_unit: 'unité ambiguë (oz) ignorée', unbound_percentage: 'pourcentage sans ingrédient reconnu',
  extra_concentration: 'concentration d\'un ingrédient absent des concentrations du catalogue', identifier_conflicts_with_text: 'identifiant concordant mais texte contradictoire : à vérifier',
  variant_family_unconfirmed: 'variante détectée mais famille de produit non confirmée', variant_from_description: 'formulation lue dans la description et non dans le titre',
  name_via_alias: 'nom reconnu par un alias déclaré (libellé de source du catalogue) : jamais EXACT par le texte seul',
  title_has_extra_neutral_words: 'mots neutres supplémentaires dans le titre',
  insufficient_evidence: 'éléments insuffisants pour rattacher la fiche à ce produit (ni marque établie ni nom reconnu) : aucune contradiction, mais rien ne l\'établit'
};

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const str = x => (typeof x === 'string' ? x : '');
const uniq = a => [...new Set(a)];

/* ---------- Identifiants ---------- */
/* isValidGtin : 8, 12, 13 ou 14 chiffres et clé de contrôle GS1 correcte. */
function isValidGtin(v) {
  const d = String(v == null ? '' : v).replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d)) return false;
  const digits = d.split('').map(Number), check = digits.pop();
  const sum = digits.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}
const gtinKey = v => String(v).replace(/[\s-]/g, '').padStart(14, '0');           // GTIN-12/13 et GTIN-14 de même base se comparent
const mpnKey = v => str(v).toUpperCase().replace(/[^A-Z0-9]/g, '');

function identifierSignals(identity, c, warnings) {
  const out = { gtin: U, mpn: U };
  const idG = identity.identifiers && identity.identifiers.gtin && identity.identifiers.gtin.value, idM = identity.identifiers && identity.identifiers.mpn && identity.identifiers.mpn.value;
  if (c.gtin != null && c.gtin !== '') {
    if (!isValidGtin(c.gtin)) warnings.push('invalid_candidate_gtin');
    else if (!idG) warnings.push('candidate_gtin_ignored');
    else out.gtin = isValidGtin(idG) && gtinKey(idG) === gtinKey(c.gtin) ? M : (isValidGtin(idG) ? X : U);
  }
  if (c.mpn != null && c.mpn !== '') {
    if (!idM) warnings.push('candidate_mpn_ignored');
    else if (mpnKey(c.mpn) && mpnKey(idM)) out.mpn = mpnKey(idM) === mpnKey(c.mpn) ? M : X;
  }
  if (c.sku != null && c.sku !== '') warnings.push('sku_ignored');
  return out;
}

/* ---------- Identité préparée (calculs réutilisables pour des milliers de fiches) ---------- */
function prepareIdentity(identity, productId) {
  if (!isObj(identity) || !isObj(identity.brand) || !isObj(identity.name) || !str(identity.name.canonical)) return null;
  const forms = [identity.name.canonical].concat((Array.isArray(identity.name.aliases) ? identity.name.aliases : []).map(a => str(a && a.text)).filter(Boolean));
  const concs = ((identity.attributes && identity.attributes.concentrations) || []).filter(c => isObj(c));
  const siblings = Array.isArray(identity.siblings) ? identity.siblings.filter(isObj) : [];
  const actives = new Set(((identity.attributes && identity.attributes.actives) || []).map(a => a.activeId));
  const headline = new Set();
  for (const f of [identity.name.canonical]) for (const i of A.extractIngredients(f)) if (i.activeId) headline.add(i.activeId);
  for (const c of concs) if (c.activeId) headline.add(c.activeId);
  for (const a of headline) actives.add(a);
  const ownWords = new Set(N.INGREDIENTS.filter(i => actives.has(i.activeId)).flatMap(i => i.tokens));      // les noms des propres actifs du produit ne sont jamais des mots « en trop »
  return {
    productId: productId || identity.productId || null, identity, ownWords,
    brand: { canonical: str(identity.brand.canonical), aliases: Array.isArray(identity.brand.aliases) ? identity.brand.aliases : [] },
    forms: forms.map(text => ({ text, tokens: N.comparableTokens(text) })),
    variantTerms: Array.isArray(identity.name.variantTerms) ? identity.name.variantTerms : [],
    targetVariant: isObj(identity.variant) ? identity.variant.id : null,
    concentrations: concs, certainConcentrations: concs.filter(c => !(c.qualifiers || []).includes('to_confirm')),
    volume: isObj(identity.volume) && isObj(identity.volume.normalized) ? identity.volume : null,
    siblings, activeIds: actives, headline,
    /* Un produit frère de formulation ou d'indice solaire (connu OU candidat) rend la formulation de la fiche indispensable : son absence n'est pas une preuve d'identité. */
    variantRelevant: isObj(identity.variant) || siblings.some(s => ['formulation', 'sun_protection'].includes(s.relation))
  };
}

/* ---------- Signaux ---------- */
function brandSignal(P, c, title) {
  const own = { canonical: P.brand.canonical, aliases: P.brand.aliases };
  const known = [own].concat(A.BRANDS.filter(b => b.canonical !== own.canonical));
  const warnings = [], fromTitle = A.extractBrand(title, known);
  let stated = null;
  if (str(c.brand).trim()) stated = A.extractBrand(c.brand, known) || { canonical: null, unrecognized: true };
  let signal = U, removeAlias = null;
  if (stated) {
    if (stated.ambiguous) signal = U;
    else if (stated.canonical === own.canonical) signal = M;
    else signal = X;                                           // marque annoncée, reconnue comme une autre marque ou absente des alias déclarés
  }
  if (fromTitle) {
    if (fromTitle.ambiguous) { warnings.push('multiple_brands'); if (signal === M) signal = U; }
    else if (fromTitle.canonical === own.canonical) { if (!stated) signal = M; removeAlias = fromTitle.alias; }
    else signal = X;                                           // une autre marque déclarée figure dans le titre
  }
  return { signal, removeAlias, warnings };
}

/* Compare les jetons d'un nom d'identité à ceux du titre (après retrait de la marque, des quantités et des mentions de variante). */
function compareName(idTokens0, cTokens0, ownWords) {
  /* Les concentrations ne se comparent PAS ici : elles ont leur propre signal, lié à l'ingrédient. Le nom ne garde que ses mots. */
  const idTokens = idTokens0.filter(t => !t.includes('=')), cTokens = cTokens0.filter(t => !t.includes('='));
  const idSet = new Set(idTokens.filter(t => t !== '+')), cSet = new Set(cTokens.filter(t => t !== '+'));
  if (!cSet.size) return { signal: U, code: 'name_absent' };
  if ((idTokens[idTokens.length - 1] === '+') !== (cTokens[cTokens.length - 1] === '+')) return { signal: X, code: 'name_plus_suffix' };
  const missing = [...idSet].filter(t => !cSet.has(t));
  const extra = [...cSet].filter(t => !idSet.has(t) && !(ownWords && ownWords.has(t)));
  const neutral = extra.filter(t => NEUTRAL_WORDS.has(t));
  const real = extra.filter(t => !NEUTRAL_WORDS.has(t));
  const conflicting = real.filter(t => t.includes('=') || /^\d/.test(t) || CONFLICT_WORDS.has(t) || INGREDIENT_WORDS.has(t));
  const plain = real.filter(t => !conflicting.includes(t));
  if (conflicting.length) return { signal: X, code: 'name_conflict', conflicting, missing };
  if (missing.length && plain.length && ![...idSet].some(t => !NEUTRAL_WORDS.has(t) && cSet.has(t))) return { signal: X, code: 'name_no_overlap', missing };        // aucun mot propre au produit dans le titre
  if (!missing.length && !plain.length) return { signal: M, code: 'name_match', neutral };
  if (!missing.length) return { signal: U, code: 'name_extra_words', plain };
  return { signal: U, code: 'name_incomplete', missing, plain };
}
const NAME_RANK = { MATCH: 0, UNKNOWN: 1, MISMATCH: 2 };

/* Retire de `tokens` la sous-suite contiguë `seq` (dernière occurrence) ; à défaut, retire chaque jeton une fois (hors « + »). */
function removeSeq(tokens, seq, keep) {
  const t = tokens.slice(), s = seq.filter(x => !keep.has(x));
  if (!s.length) return t;
  for (let i = t.length - s.length; i >= 0; i--) if (s.every((w, k) => t[i + k] === w)) { t.splice(i, s.length); return t; }
  for (const w of s) { if (w === '+') continue; const j = t.indexOf(w); if (j >= 0) t.splice(j, 1); }
  return t;
}

function detectVariants(P, title, description) {
  const opts = { exclude: P.variantTerms };
  const fromTitle = A.extractVariants(title, opts).map(v => Object.assign({ source: 'title' }, v));
  const fromDesc = description ? A.extractVariants(description, opts).map(v => Object.assign({ source: 'description' }, v)) : [];
  const found = fromTitle.length ? fromTitle : fromDesc;
  const tNorm = N.normalizeText(title), dNorm = fromTitle.length ? '' : N.normalizeText(description), extra = [];
  for (const [id, re] of Object.entries(SIBLING_PATTERNS)) {
    if (re.test(tNorm)) extra.push({ id, exactness: 'explicit', raw: id, source: 'title' });
    else if (dNorm && re.test(dNorm)) extra.push({ id, exactness: 'explicit', raw: id, source: 'description' });
  }
  const mp = /(?<![a-z0-9.])(\d+)\s?x(?=\s?\d)/.exec(tNorm);
  if (mp && Number(mp[1]) >= 2) extra.push({ id: 'multipack', exactness: 'explicit', raw: mp[1] + ' x', source: 'title' });
  const mpRemoval = mp && Number(mp[1]) < 2 ? [mp[1] + ' x'] : [];                          // « 1 x 30 ml » : un seul flacon, le multiplicateur est retiré du nom
  const spf = A.extractSpf(title);
  if (spf && P.siblings.some(s => s.variant === 'with_spf')) extra.push({ id: 'with_spf', exactness: 'explicit', raw: 'spf' + spf.value, source: 'title' });
  const joined = N.translate(N.normalizeText(title)).join(' ');
  const negated = /\bwithout ceramides?\b/.test(joined);
  return { found, extra, negatedCeramides: negated, removals: found.concat(extra).filter(x => x.source === 'title').map(x => x.raw).concat(negated ? ['without ceramides'] : [], mpRemoval) };
}

function variantSignal(P, v) {
  const target = P.targetVariant, all = v.found.concat(v.extra);
  const forms = uniq(v.found.filter(x => FORMULATIONS.includes(x.id)).map(x => x.id));
  const packsExtra = v.extra.map(x => x.id).filter(id => PACKAGINGS.includes(id));
  const packs = uniq(v.found.filter(x => PACKAGINGS.includes(x.id) && x.id !== target).map(x => x.id).concat(packsExtra));
  const sibs = uniq(v.extra.map(x => x.id).filter(id => id !== target && !PACKAGINGS.includes(id)));
  if (forms.length > 1) return { signal: U, code: 'variant_conflict', ids: forms };
  if (forms.length === 1 && forms[0] !== target) return { signal: X, code: 'variant_formulation_mismatch', ids: forms.concat(packs), kind: 'formulation' };
  if (packs.length) return { signal: X, code: 'variant_packaging', ids: packs, kind: 'packaging' };
  if (sibs.length) return { signal: X, code: 'variant_sibling', ids: sibs, kind: 'sibling' };
  if (forms.length === 1) { const hit = v.found.find(x => x.id === forms[0]); return { signal: M, code: 'variant_match', ids: forms, exactness: hit.exactness, source: hit.source }; }
  if (target && all.some(x => x.id === target)) { const hit = all.find(x => x.id === target); return { signal: M, code: 'variant_match', ids: [target], exactness: hit.exactness, source: hit.source }; }
  return { signal: U, code: 'variant_absent' };
}

function concentrationSignal(P, title) {
  const det = A.extractConcentrationsDetailed(title), warnings = [];
  const cand = det.items;
  if (cand.some(c => c.ingredient === null)) warnings.push('unbound_percentage');
  if (P.concentrations.some(c => (c.qualifiers || []).includes('to_confirm'))) warnings.push('catalog_concentration_uncertain');
  if (!P.certainConcentrations.length) return { signal: U, code: 'concentration_not_in_catalog', warnings };
  let anyMismatch = false, matched = 0;
  for (const c of P.certainConcentrations) {
    const same = cand.filter(x => x.ingredient === c.ingredient);
    if (!same.length) continue;
    if (same.some(x => x.percentage === c.percentage)) matched++; else anyMismatch = true;
  }
  const known = new Set(P.concentrations.map(c => c.ingredient));
  if (cand.some(x => x.ingredient !== null && !known.has(x.ingredient))) warnings.push('extra_concentration');
  if (anyMismatch) return { signal: X, code: 'concentration_mismatch', warnings };
  if (matched === P.certainConcentrations.length) return { signal: M, code: 'concentration_match', warnings };
  return { signal: U, code: 'concentration_absent', warnings };
}

function equivalentQty(q, id) {
  if (q.normalized.value === id.normalized.value) return true;
  return /^fl\.?\s*oz$/i.test(q.unit) && Math.abs(q.normalized.value - id.normalized.value) / id.normalized.value <= FLOZ_ROUNDING;
}
function volumeSignal(P, c, title) {
  const warnings = [], qs = N.parseQuantities(title).slice();
  let structured = null;
  if (isObj(c.volume)) { const r = N.normalizeUnit(c.volume.value, c.volume.unit); if (r.ok) structured = { raw: String(c.volume.value) + ' ' + c.volume.unit, value: r.raw.value, unit: r.raw.unit, normalized: r.normalized, kind: r.kind }; }
  else if (typeof c.volume === 'string') structured = N.parseVolume(c.volume);
  if (structured) qs.unshift(structured);
  if (qs.some(q => q.kind === 'ambiguous')) warnings.push('ambiguous_unit');
  const usable = qs.filter(q => q.normalized);
  if (!P.volume) return { signal: U, code: 'volume_not_in_catalog', warnings };
  if (!usable.length) return { signal: U, code: 'volume_absent', warnings };
  const sameKind = usable.filter(q => q.normalized.unit === P.volume.normalized.unit);
  if (!sameKind.length) return { signal: X, code: 'volume_kind_mismatch', kind: true, warnings };
  const eq = sameKind.filter(q => equivalentQty(q, P.volume));
  if (eq.length === sameKind.length) return { signal: M, code: 'volume_match', warnings };
  if (eq.length) return { signal: U, code: 'volume_several', warnings };
  return { signal: X, code: 'volume_format_differs', format: true, warnings };
}

function activesSignal(P, title) {
  const ings = A.extractIngredients(title).filter(i => i.activeId), ids = uniq(ings.map(i => i.activeId));
  if (!ids.length || !P.activeIds.size) return { signal: U, code: 'actives_unknown' };
  if (ids.some(id => !P.activeIds.has(id))) return { signal: X, code: 'actives_mismatch', extra: ids.filter(id => !P.activeIds.has(id)) };
  if ([...P.headline].every(id => ids.includes(id)) && P.headline.size) return { signal: M, code: 'actives_match' };
  return { signal: U, code: 'actives_unknown' };
}

/* ---------- Décision ---------- */
function decide(S, f) {
  const hard = [];
  if (S.gtin === X) hard.push('gtin_mismatch');
  if (S.mpn === X) hard.push('mpn_mismatch');
  if (S.brand === X) hard.push('brand_mismatch');
  if (S.actives === X) hard.push('actives_mismatch');
  if (S.concentration === X) hard.push('concentration_mismatch');
  if (S.name === X) hard.push(f.nameCode);
  if (f.volumeKind) hard.push('volume_kind_mismatch');
  if (f.negated) hard.push('variant_negated');
  const identifierMatch = S.gtin === M || (S.mpn === M && S.brand !== X);
  const soft = S.variant === X || f.volumeFormat;
  if (hard.length) return identifierMatch ? { cls: 'POSSIBLE_MATCH', primary: [], warn: ['identifier_conflicts_with_text'], contradictions: hard } : { cls: 'NO_MATCH', primary: hard, warn: [], contradictions: hard };
  if (identifierMatch) {
    if (soft) return { cls: 'POSSIBLE_MATCH', primary: [S.gtin === M ? 'gtin_match' : 'mpn_match'], warn: ['identifier_conflicts_with_text'], contradictions: [] };
    return { cls: S.gtin === M || S.brand === M ? 'EXACT_MATCH' : 'STRONG_MATCH', primary: [S.gtin === M ? 'gtin_match' : 'mpn_match'], warn: [], contradictions: [] };
  }
  const nameEvidence = S.name === M || (S.name === U && f.nameCode !== 'name_absent' && S.brand === M);
  /* Information insuffisante n'est PAS une contradiction : POSSIBLE_MATCH (NO_MATCH est réservé à une contradiction explicite). */
  if (!nameEvidence) return { cls: 'POSSIBLE_MATCH', primary: [], warn: soft ? ['insufficient_evidence', 'variant_family_unconfirmed'] : ['insufficient_evidence'], contradictions: [] };
  if (soft) {
    if (S.brand === M && S.name === M) return { cls: 'VARIANT_MATCH', primary: [], warn: [], contradictions: [] };
    return { cls: 'POSSIBLE_MATCH', primary: [], warn: ['variant_family_unconfirmed'], contradictions: [] };
  }
  const essentialOk = (!f.idHasConc || S.concentration === M) && (!f.idHasVolume || S.volume === M) && (!f.variantRelevant || S.variant === M);
  const discriminated = f.idHasConc || f.idHasVolume || f.variantRelevant;
  const strong = S.brand === M && S.name === M && essentialOk && discriminated;
  const exact = strong && f.nameClean && f.idHasVolume && (f.idHasConc || f.variantRelevant) && (!f.variantRelevant || f.variantExplicitTitle) && S.actives === M;
  if (exact) return { cls: 'EXACT_MATCH', primary: [], warn: [], contradictions: [] };
  if (strong) return { cls: 'STRONG_MATCH', primary: [], warn: [], contradictions: [] };
  return { cls: 'POSSIBLE_MATCH', primary: [], warn: [], contradictions: [] };
}

/* ---------- API ---------- */
/* validateCandidate(candidat) → { valid, errors } : validation PRÉALABLE (forme seulement). Une fiche sans titre lisible ne peut pas être comparée : ce n'est ni un rejet ni un doute sur le produit. */
function validateCandidate(candidate) {
  const errors = [];
  if (!isObj(candidate) || !str(candidate.title).trim()) errors.push('candidate_invalid');
  return { valid: errors.length === 0, errors };
}

/* matchCandidate(candidat, identité, { productId }) → { productId, valid, matchClass, signals, reasons, reasonCodes, warnings, contradictions, evidence, score }. Ne lève jamais d'exception.
   Entrée inexploitable (fiche sans titre, identité illisible) : { valid: false, matchClass: null, error: { code, reason } } : aucune classe, jamais NO_MATCH (réservé à une contradiction explicite). */
function matchCandidate(candidate, identity, opts) {
  const P = identity && identity.__prepared ? identity : prepareIdentity(identity, opts && opts.productId);
  const productId = P ? P.productId : (opts && opts.productId) || null;
  /* Une entrée INEXPLOITABLE n'est pas une contradiction produit : elle ne reçoit AUCUNE classe de matching. Résultat technique séparé : valid false, matchClass null, error. */
  const invalid = (code) => ({ productId, valid: false, matchClass: null, error: { code, reason: REASONS[code] }, signals: Object.fromEntries(SIGNAL_ORDER.map(k => [k, U])), reasons: [], reasonCodes: [], warnings: [], warningCodes: [], contradictions: [], evidence: null, score: 0 });
  if (!P) return invalid('identity_invalid');
  if (!validateCandidate(candidate).valid) return invalid('candidate_invalid');
  const title = str(candidate.title), description = str(candidate.description);
  const warnings = [];
  const ids = identifierSignals(P.identity, candidate, warnings);
  const b = brandSignal(P, candidate, title); warnings.push(...b.warnings);
  const v = detectVariants(P, title, description);
  const vs = variantSignal(P, v);
  const negated = v.negatedCeramides && P.targetVariant === 'with_ceramides';
  // nom : jetons du titre sans la marque, les quantités et les mentions de variante (sauf s'ils font partie du nom de l'identité)
  const cAll = N.comparableTokens(title);
  let best = null, bestIndex = 0;
  for (const [fi, form] of P.forms.entries()) {
    const idSet = new Set(form.tokens.filter(w => w !== '+'));          // « + » se retire avec la mention qui l'emporte (« + Ceramides »)
    let t = cAll.slice();
    if (b.removeAlias) t = removeSeq(t, N.comparableTokens(b.removeAlias), idSet);
    for (const raw of v.removals) t = removeSeq(t, N.comparableTokens(raw), idSet);
    t = t.filter(w => !/^\d+(?:\.\d+)?(?:ml|g|oz)$/.test(w));
    const r = compareName(form.tokens, t, P.ownWords);
    if (!best || NAME_RANK[r.signal] < NAME_RANK[best.signal]) { best = r; bestIndex = fi; }
  }
  const conc = concentrationSignal(P, title); warnings.push(...conc.warnings);
  const vol = volumeSignal(P, candidate, title); warnings.push(...vol.warnings);
  const act = activesSignal(P, title);
  const S = { gtin: ids.gtin, mpn: ids.mpn, brand: b.signal, name: best.signal, actives: act.signal, concentration: conc.signal, volume: vol.signal, variant: negated ? X : vs.signal };
  const f = {
    nameCode: best.code, volumeKind: !!vol.kind, volumeFormat: !!vol.format, negated,
    idHasConc: P.certainConcentrations.length > 0, idHasVolume: !!P.volume, variantRelevant: P.variantRelevant,
    nameClean: best.code === 'name_match' && !(best.neutral && best.neutral.length) && bestIndex === 0,        // un nom reconnu par ALIAS plafonne à STRONG
    variantExplicitTitle: vs.signal === M && vs.exactness === 'explicit' && vs.source === 'title'
  };
  if (best.neutral && best.neutral.length) warnings.push('title_has_extra_neutral_words');
  if (best.code === 'name_match' && bestIndex > 0) warnings.push('name_via_alias');
  const d = decide(S, f);
  // raisons : dans l'ordre fixe des signaux (déterministe) ; pour un NO_MATCH, les contradictions
  const codes = [];
  if (S.gtin !== U) codes.push(S.gtin === M ? 'gtin_match' : 'gtin_mismatch');
  if (S.mpn !== U) codes.push(S.mpn === M ? 'mpn_match' : 'mpn_mismatch');
  codes.push(S.brand === M ? 'brand_match' : S.brand === X ? 'brand_mismatch' : 'brand_unknown');
  codes.push(S.name === M ? 'name_match' : best.code);
  if (S.actives === M) codes.push('actives_match'); else if (S.actives === X) codes.push('actives_mismatch');
  codes.push(conc.code, vol.code, negated ? 'variant_negated' : vs.code);
  const reasonCodes = d.cls === 'NO_MATCH' ? d.contradictions.slice() : uniq(codes);
  if (d.cls !== 'NO_MATCH' && S.variant === U && P.variantRelevant) { warnings.push('variant_not_resolved'); warnings.push('sibling_formulation_exists'); }
  for (const w of d.warn) warnings.push(w);
  if (vs.signal === M && vs.source === 'description') warnings.push('variant_from_description');
  const matches = SIGNAL_ORDER.filter(k => S[k] === M).length;
  return {
    productId, valid: true, matchClass: d.cls, signals: S,
    reasons: reasonCodes.map(c => REASONS[c] || c), reasonCodes, warnings: uniq(warnings).sort().map(w => WARNINGS[w] || w), warningCodes: uniq(warnings).sort(),
    contradictions: d.contradictions.map(c => REASONS[c] || c),
    evidence: { brand: b.removeAlias, volume: N.parseVolume(title) && N.parseVolume(title).raw, concentrations: A.extractConcentrations(title).map(x => ({ ingredient: x.ingredient, percentage: x.percentage })),
      variants: v.found.concat(v.extra).map(x => ({ id: x.id, exactness: x.exactness, source: x.source })) },
    score: Math.round(matches / SIGNAL_ORDER.length * 1000) / 1000        // AUXILIAIRE : calculé après la classe, ne la décide jamais
  };
}

/* ---------- Index (milliers de fiches) ---------- */
/* buildIndex(fichier d'identités, { products }) : identités préparées + index par marque (nom canonique), GTIN et MPN. Un produit du catalogue sans identité reçoit l'identité DÉRIVÉE
   (sans frères ni alias de nom) ; le catalogue peut donc grandir sans casser le matching. Lecture seule. */
function buildIndex(file, opts) {
  const identity = require('./identity.js');
  const entries = new Map();
  for (const [id, x] of Object.entries(isObj(file) && isObj(file.products) ? file.products : {})) entries.set(id, x);
  for (const p of (opts && Array.isArray(opts.products) ? opts.products : [])) if (isObj(p) && p.id && !entries.has(p.id)) { const d = identity.deriveIdentity(p); if (d) entries.set(p.id, d); }
  const byProduct = new Map(), byBrand = new Map(), byGtin = new Map(), byMpn = new Map(), brands = new Map();
  const add = (m, k, id) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(id); };
  for (const [id, x] of entries) {
    const P = prepareIdentity(x, id); if (!P) continue;
    P.__prepared = true; byProduct.set(id, P);
    add(byBrand, P.brand.canonical, id);
    brands.set(P.brand.canonical, { canonical: P.brand.canonical, aliases: P.brand.aliases });
    const g = x.identifiers && x.identifiers.gtin, m = x.identifiers && x.identifiers.mpn;
    if (g && g.value && isValidGtin(g.value)) add(byGtin, gtinKey(g.value), id);
    if (m && m.value) add(byMpn, mpnKey(m.value), id);
  }
  return { size: byProduct.size, byProduct, byBrand, byGtin, byMpn, brands: [...brands.values()] };
}

/* findMatches(candidat, index, { includeNoMatch, limit }) : les identités vraisemblables pour cette fiche, meilleures d'abord (classe, puis score auxiliaire, puis productId).
   Une entrée INVALIDE (fiche sans titre, index illisible) renvoie [] : ce n'est pas « aucune correspondance ». Appeler validateCandidate(fiche) avant pour distinguer les deux cas.
   Préfiltre : GTIN / MPN exacts, sinon marque détectée ; sans marque détectée, toutes les identités sont évaluées. */
function findMatches(candidate, index, opts) {
  if (!isObj(index) || !(index.byProduct instanceof Map) || !isObj(candidate)) return [];
  const pool = new Set();
  if (candidate.gtin && isValidGtin(candidate.gtin)) for (const id of index.byGtin.get(gtinKey(candidate.gtin)) || []) pool.add(id);
  if (candidate.mpn) for (const id of index.byMpn.get(mpnKey(candidate.mpn)) || []) pool.add(id);
  const hit = A.extractBrand(str(candidate.brand) || str(candidate.title), index.brands.concat(A.BRANDS.filter(b => !index.brands.some(x => x.canonical === b.canonical))));
  if (hit && hit.canonical) for (const id of index.byBrand.get(hit.canonical) || []) pool.add(id);
  const ids = pool.size ? [...pool] : [...index.byProduct.keys()];
  const out = ids.map(id => matchCandidate(candidate, index.byProduct.get(id))).filter(r => r.valid && ((opts && opts.includeNoMatch) || r.matchClass !== 'NO_MATCH'));
  out.sort((a, b) => CLASS_RANK[a.matchClass] - CLASS_RANK[b.matchClass] || b.score - a.score || String(a.productId).localeCompare(String(b.productId)));
  return opts && opts.limit > 0 ? out.slice(0, opts.limit) : out;
}

module.exports = { CLASSES, SIGNAL_ORDER, REASONS, WARNINGS, isValidGtin, validateCandidate, prepareIdentity, matchCandidate, buildIndex, findMatches };
