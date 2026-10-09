'use strict';
/* IDENTITÉ PRODUIT pour l'outillage Market Discovery : ce qui permet, plus tard, de comparer une fiche commerciale à un produit du catalogue sans lire le texte brut de catalog.js.
   Fonctions PURES (aucun fichier, aucun réseau). Hors du bundle client. Aucune identité n'est inventée : tout attribut absent vaut null, [] ou « unknown » ;
   un GTIN, une référence fabricant (MPN) ou un SKU n'existent que s'ils portent leur source ; un produit frère, un alias de nom ou une note ne sont acceptés qu'avec la
   source (champ du catalogue) ET l'extrait de texte qui les établit (voir validateIdentityFile : l'extrait doit se retrouver tel quel dans le catalogue).
   Ce module ne fait AUCUN matching : il décrit seulement chaque produit du catalogue. */
const N = require('./normalize.js');
const A = require('./attributes.js');

const IDENTITY_VERSION = 1;
const EXACTNESS = ['explicit', 'inferred'];
const SIBLING_RELATIONS = ['formulation', 'size', 'regional', 'sun_protection'];
const SIBLING_VARIANTS = A.VARIANT_IDS.concat(['anhydrous', 'with_spf']);
const SIBLING_STATUS = ['known', 'candidate'];                                   // known : établi par le catalogue ; candidate : à vérifier
const QUALIFIER_IDS = A.QUALIFIERS.map(q => q[1]);
const TOP_KEYS = ['brand', 'name', 'volume', 'volumeHints', 'variant', 'attributes', 'identifiers', 'siblings', 'notes'];
const CURATED_KEYS = ['volumeHints', 'siblings', 'notes'];                       // + name.aliases : portés à la main, avec source et extrait ; tout le reste est DÉRIVÉ du catalogue
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const isText = x => typeof x === 'string' && x.trim().length > 0;

/* ---------- Dérivation ---------- */
function volumeOf(format) {
  const q = N.parseVolume(typeof format === 'string' ? format : '');
  return q ? { raw: q.raw, value: q.value, unit: q.unit, normalized: q.normalized, kind: q.kind } : null;
}

/* deriveIdentity(produit du catalogue) : la partie de l'identité qui se DÉDUIT du produit. Les champs portés à la main (alias de nom, indices de volume, frères, notes)
   sont vides ici. Retourne null pour une entrée qui n'est pas un produit. */
function deriveIdentity(product) {
  if (!isObj(product) || !isText(product.id) || !isText(product.name) || !isText(product.brand)) return null;
  const known = A.BRANDS.find(b => b.canonical === product.brand);
  const brand = { canonical: product.brand, aliases: known ? known.aliases.slice() : [N.normalizeText(product.brand)].filter(Boolean) };
  // variante : seulement celle qui est ÉCRITE entre parenthèses à la fin du nom du catalogue (« … (with Ceramides) »)
  let canonical = product.name.trim(), variant = null;
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(canonical);
  if (m) { const inner = A.extractVariants(m[2]); if (inner.length === 1) { canonical = m[1].trim(); variant = { id: inner[0].id, raw: m[2].trim(), exactness: inner[0].exactness, source: 'name' }; } }
  const variantTerms = A.extractVariants(canonical).map(v => v.id);            // ex. « duo » dans « Effaclar Duo+M » : un nom de gamme, pas un coffret
  const ingredients = Array.isArray(product.ingredients) ? product.ingredients.filter(isObj) : [];
  const actives = ingredients.filter(i => isText(i.activeId)).map(i => ({ activeId: i.activeId, label: String(i.label || '') }));
  // concentrations : le nom d'abord, puis chaque ingrédient du catalogue ; une même (ingrédient, pourcentage) est fusionnée en gardant toutes ses sources
  const concentrations = [], add = (c, source) => {
    const hit = concentrations.find(x => x.ingredient === c.ingredient && x.percentage === c.percentage);
    if (hit) { if (!hit.sources.includes(source)) hit.sources.push(source); for (const q of c.qualifiers) if (!hit.qualifiers.includes(q)) hit.qualifiers.push(q); if (!hit.activeId && c.activeId) hit.activeId = c.activeId; }
    else concentrations.push({ ingredient: c.ingredient, activeId: c.activeId, percentage: c.percentage, qualifiers: c.qualifiers.slice(), sources: [source] });
  };
  for (const c of A.extractConcentrations(product.name)) add(c, 'name');
  ingredients.forEach((ing, i) => { for (const c of A.extractConcentrations(String(ing.label || ''))) add(c, 'ingredients[' + i + '].label'); });
  return { brand, name: { canonical, aliases: [], variantTerms }, volume: volumeOf(product.format), volumeHints: [], variant,
    attributes: { actives, concentrations }, identifiers: { gtin: null, mpn: null, sku: null }, siblings: [], notes: [] };
}

/* ---------- Source d'un énoncé ---------- */
/* resolveSource(produit, chemin) : le texte du catalogue désigné par `chemin` (name, description, inciNote, format, sources[i].label, ingredients[i].label), ou null. */
function resolveSource(product, path) {
  if (!isObj(product) || typeof path !== 'string') return null;
  const m = /^(sources|ingredients)\[(\d+)\]\.label$/.exec(path);
  if (m) { const row = Array.isArray(product[m[1]]) ? product[m[1]][Number(m[2])] : null; return isObj(row) && typeof row.label === 'string' ? row.label : null; }
  return ['name', 'description', 'inciNote', 'format'].includes(path) && typeof product[path] === 'string' ? product[path] : null;
}

/* ---------- Validation ---------- */
function validVolume(v, where, e) {
  if (!isObj(v)) { e.push(where + ' : volume invalide'); return; }
  if (!isText(v.raw)) e.push(where + ' : raw manquant');
  if (!(typeof v.value === 'number' && Number.isFinite(v.value) && v.value > 0)) e.push(where + ' : valeur invalide');
  if (!isText(v.unit) || !N.normalizeUnit(v.value, v.unit).ok) e.push(where + ' : unité inconnue');
  else if (v.normalized != null) { const r = N.normalizeUnit(v.value, v.unit); if (!r.normalized || r.normalized.value !== v.normalized.value || r.normalized.unit !== v.normalized.unit) e.push(where + ' : valeur normalisée incohérente'); }
}
/* validateIdentity(identité, { activeIds }) : liste d'erreurs (vide = valide). `activeIds` : actifs DERMAI existants (jamais de nouvel actif). */
function validateIdentity(id, ctx) {
  const e = [], activeIds = new Set(ctx && Array.isArray(ctx.activeIds) ? ctx.activeIds : []);
  if (!isObj(id)) return ['identité absente'];
  for (const k of Object.keys(id)) if (!TOP_KEYS.includes(k)) e.push('champ inattendu : ' + k);
  if (!isObj(id.brand) || !isText(id.brand.canonical) || !Array.isArray(id.brand.aliases) || id.brand.aliases.some(a => !isText(a) || a !== N.normalizeText(a))) e.push('marque invalide (alias en écriture normalisée)');
  if (!isObj(id.name) || !isText(id.name.canonical) || !Array.isArray(id.name.aliases) || !Array.isArray(id.name.variantTerms) || id.name.variantTerms.some(t => !A.VARIANT_IDS.includes(t))) e.push('nom invalide');
  else for (const a of id.name.aliases) if (!isObj(a) || !isText(a.text) || !isText(a.source) || !isText(a.evidence) || a.status !== 'source_label') e.push('alias de nom sans source ou sans extrait');
  if (id.volume !== null) validVolume(id.volume, 'volume', e);
  if (!Array.isArray(id.volumeHints)) e.push('volumeHints doit être une liste');
  else for (const h of id.volumeHints) { validVolume(h, 'volumeHints', e); if (!isObj(h) || !isText(h.source) || !isText(h.evidence) || h.status !== 'unverified') e.push('indice de volume sans source, extrait ou statut « unverified »'); }
  if (id.variant !== null && !(isObj(id.variant) && A.VARIANT_IDS.includes(id.variant.id) && isText(id.variant.raw) && EXACTNESS.includes(id.variant.exactness) && isText(id.variant.source))) e.push('variante invalide (id connu, texte, exactitude, source)');
  if (!isObj(id.attributes) || !Array.isArray(id.attributes.actives) || !Array.isArray(id.attributes.concentrations)) e.push('attributes invalide');
  else {
    for (const a of id.attributes.actives) if (!isObj(a) || !activeIds.has(a.activeId) || typeof a.label !== 'string') e.push('actif inconnu de DERMAI : ' + (isObj(a) ? a.activeId : a));
    for (const c of id.attributes.concentrations) {
      if (!isObj(c) || !(typeof c.percentage === 'number' && c.percentage > 0 && c.percentage <= 100)) e.push('pourcentage invalide');
      else {
        if (c.ingredient !== null && !isText(c.ingredient)) e.push('ingrédient invalide');
        if (c.activeId !== null && !activeIds.has(c.activeId)) e.push('concentration : actif inconnu de DERMAI : ' + c.activeId);
        if (!Array.isArray(c.sources) || !c.sources.length || c.sources.some(s => !isText(s))) e.push('concentration sans source');
        if (!Array.isArray(c.qualifiers) || c.qualifiers.some(q => !QUALIFIER_IDS.includes(q))) e.push('réserve de concentration inconnue');
      }
    }
  }
  if (!isObj(id.identifiers)) e.push('identifiers invalide');
  else for (const k of ['gtin', 'mpn', 'sku']) {
    const v = id.identifiers[k];
    if (v === null) continue;
    if (!isObj(v) || !isText(v.value) || !isText(v.source)) e.push(k + ' : valeur ET source obligatoires (jamais un identifiant sans source)');
    else if (k === 'gtin' && !/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(v.value)) e.push('gtin : 8, 12, 13 ou 14 chiffres');
  }
  if (!Array.isArray(id.siblings)) e.push('siblings doit être une liste');
  else for (const s of id.siblings) {
    if (!isObj(s) || !SIBLING_RELATIONS.includes(s.relation) || !isText(s.label) || !SIBLING_STATUS.includes(s.status)) { e.push('produit frère invalide (relation, libellé, statut)'); continue; }
    if (s.variant != null && !SIBLING_VARIANTS.includes(s.variant)) e.push('frère : variante inconnue : ' + s.variant);
    if (s.volume != null) validVolume(s.volume, 'frère', e);
    if (s.productId != null && !isText(s.productId)) e.push('frère : productId invalide');
    if (s.status === 'known' && (!isText(s.source) || !isText(s.evidence))) e.push('un frère « known » exige sa source et son extrait');
  }
  if (!Array.isArray(id.notes)) e.push('notes doit être une liste');
  else for (const n of id.notes) if (!isObj(n) || !isText(n.text) || !isText(n.source) || !isText(n.evidence)) e.push('note sans source ou sans extrait');
  return e;
}

/* validateIdentityFile(fichier, { products, activeIds }) : version, structure, alias de marque jamais partagés entre deux marques, et — si le catalogue est fourni —
   chaque identité vise un produit existant et chaque extrait cité se retrouve tel quel dans le champ du catalogue désigné. */
function validateIdentityFile(file, ctx) {
  const e = [];
  if (!isObj(file) || file.version !== IDENTITY_VERSION || !isObj(file.products)) return ['fichier d\'identités invalide (version 1 et products attendus)'];
  const catalog = ctx && Array.isArray(ctx.products) ? new Map(ctx.products.map(p => [p.id, p])) : null, aliasOwner = new Map();
  for (const [pid, id] of Object.entries(file.products)) {
    for (const m of validateIdentity(id, ctx)) e.push(pid + ' : ' + m);
    if (!isObj(id) || !isObj(id.brand)) continue;
    for (const a of Array.isArray(id.brand.aliases) ? id.brand.aliases : []) { if (aliasOwner.has(a) && aliasOwner.get(a) !== id.brand.canonical) e.push(pid + ' : alias de marque partagé par deux marques : ' + a); aliasOwner.set(a, id.brand.canonical); }
    if (!catalog) continue;
    const product = catalog.get(pid);
    if (!product) { e.push(pid + ' : produit absent du catalogue'); continue; }
    const cited = [].concat((id.name && id.name.aliases) || [], id.volumeHints || [], (id.siblings || []).filter(s => s && s.status === 'known'), id.notes || []);
    for (const c of cited) { const txt = resolveSource(product, c && c.source); if (txt === null || !isText(c.evidence) || !txt.includes(c.evidence)) e.push(pid + ' : extrait introuvable dans ' + (c && c.source) + ' : ' + (c && c.evidence)); }
  }
  return e;
}

/* La partie dérivée d'une identité enregistrée (sans les champs portés à la main) : à comparer avec deriveIdentity(produit). */
function derivedPart(id) {
  const out = JSON.parse(JSON.stringify(id));
  for (const k of CURATED_KEYS) out[k] = [];
  if (out.name) out.name.aliases = [];
  return out;
}

module.exports = { IDENTITY_VERSION, EXACTNESS, SIBLING_RELATIONS, SIBLING_VARIANTS, SIBLING_STATUS, TOP_KEYS, CURATED_KEYS, deriveIdentity, resolveSource, validateIdentity, validateIdentityFile, derivedPart };
