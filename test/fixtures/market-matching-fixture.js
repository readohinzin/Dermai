'use strict';
/* JEU DE RÉFÉRENCE ÉTIQUETÉ du matcher (tools/market/match.js). Chaque cas : le produit visé (identité de data/market/identities.json, éventuellement modifiée par un `patch` de TEST),
   la fiche candidate (objet fabriqué à la main : aucun réseau), la classe attendue, quelques signaux attendus, la raison attendue (code) et un commentaire.
   Les GTIN / MPN des `patch` sont des valeurs de test, jamais des données du catalogue. Les titres imitent des fiches commerciales (FR/EN, ponctuation variable).
   RÈGLE DU JEU : en cas de doute, la classe attendue est la plus prudente (POSSIBLE_MATCH plutôt qu'un faux EXACT/STRONG). */
const gtin13 = base12 => { const d = String(base12).split('').map(Number); const sum = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 1 : 3), 0); return base12 + String((10 - (sum % 10)) % 10); };
const G1 = gtin13('506000000001'), G2 = gtin13('506000000002');
const HA = 'to-hyaluronic-b5-ceramides', NIA = 'to-niacinamide-10-zinc-1', SAL = 'to-salicylic-2-solution', EFF = 'lrp-effaclar-duo-m', CIC = 'lrp-cicaplast-baume-b5-plus', CHA = 'cerave-hydrating-ha-serum', MEL = 'lrp-mela-b3-serum';
const TO = 'The Ordinary';
const withGtin = { identifiers: { gtin: { value: G1, source: 'valeur de test' } } };
const withMpn = { identifiers: { mpn: { value: 'TO-HA-30', source: 'valeur de test' } } };

/* [id, famille, produit, titre/candidat, attendu, signaux attendus, code de raison attendu, commentaire, options] */
const c = (id, family, productId, candidate, expected, signals, reason, note, extra) => Object.assign({ id, family, productId, candidate, expected, signals: signals || {}, reason: reason || null, note: note || '' }, extra || {});

const CASES = [
  // ---------- A. EXACT ----------
  c('A1', 'EXACT', HA, { brand: TO, title: 'Hyaluronic Acid 2% + B5', gtin: G1 }, 'EXACT_MATCH', { gtin: 'MATCH' }, 'gtin_match', 'GTIN identique (catalogue de test + fiche) : preuve forte, même sans volume ni formulation', { patch: withGtin }),
  c('A1b', 'EXACT', HA, { title: 'Hyaluronic Acid 2% + B5', gtin: '0' + G1 }, 'EXACT_MATCH', { gtin: 'MATCH' }, 'gtin_match', 'GTIN-14 de même base que le GTIN-13 : même identifiant', { patch: withGtin }),
  c('A1c', 'IDENTIFIER', HA, { brand: 'CeraVe', title: 'CeraVe Hydrating Cleanser 30 ml', gtin: G1 }, 'POSSIBLE_MATCH', { gtin: 'MATCH', brand: 'MISMATCH' }, 'gtin_match', 'GTIN concordant mais texte contradictoire (autre marque, autre produit) : jamais EXACT ni NO_MATCH automatique, à vérifier', { patch: withGtin, warning: 'identifier_conflicts_with_text' }),
  c('A1d', 'IDENTIFIER', HA, { brand: TO, title: 'The Ordinary Hyaluronic Acid 2% + B5 60 ml with Ceramides Refill', gtin: G1 }, 'POSSIBLE_MATCH', { gtin: 'MATCH', variant: 'MISMATCH' }, 'gtin_match', 'GTIN concordant mais le texte décrit une recharge de 60 ml : à vérifier', { patch: withGtin, warning: 'identifier_conflicts_with_text' }),
  c('A1e', 'IDENTIFIER', HA, { brand: TO, title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml with Ceramides', gtin: '5060000000000' }, 'EXACT_MATCH', { gtin: 'UNKNOWN' }, 'variant_match', 'GTIN de la fiche invalide (clé de contrôle) : ignoré, le texte décide seul', { patch: withGtin, warning: 'invalid_candidate_gtin' }),
  c('A2', 'EXACT', HA, { brand: TO, title: 'Hyaluronic Acid 2% + B5', mpn: 'to ha 30' }, 'EXACT_MATCH', { mpn: 'MATCH', brand: 'MATCH' }, 'mpn_match', 'référence fabricant identique après normalisation, marque concordante', { patch: withMpn }),
  c('A3', 'EXACT', HA, { brand: TO, title: 'The Ordinary Hyaluronic Acid 2% + B5 (with Ceramides) 30 ml' }, 'EXACT_MATCH', { brand: 'MATCH', name: 'MATCH', concentration: 'MATCH', volume: 'MATCH', variant: 'MATCH' }, 'variant_match', 'marque + nom + volume + concentration + formulation explicites et concordants, sans mot en trop'),
  c('A4', 'EXACT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml' }, 'EXACT_MATCH', { concentration: 'MATCH', volume: 'MATCH' }, 'concentration_match', 'produit sans frère connu : tout est écrit et concordant'),
  // ---------- B. STRONG ----------
  c('B1', 'STRONG', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% Serum 30 ml' }, 'STRONG_MATCH', { name: 'MATCH' }, 'name_match', 'même produit sans identifiant ; un mot neutre (Serum) suffit à ne pas être EXACT'),
  c('B2', 'STRONG', HA, { title: 'The Ordinary Acide Hyaluronique 2% + B5 Sérum 30 ml avec céramides' }, 'STRONG_MATCH', { variant: 'MATCH', brand: 'MATCH' }, 'variant_match', 'formulation explicitement concordante (FR) mais identifiant absent et mot neutre en plus'),
  c('B3', 'STRONG', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml + Ceramides' }, 'STRONG_MATCH', { variant: 'MATCH' }, 'variant_match', 'formulation DÉDUITE (« + Ceramides ») et non écrite comme variante : jamais EXACT'),
  c('B4', 'STRONG', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml', description: 'Formule actuelle avec céramides.' }, 'STRONG_MATCH', { variant: 'MATCH' }, 'variant_match', 'variante confirmée par la description : STRONG, jamais EXACT (variant_from_description)', { warning: 'variant_from_description' }),
  c('B5', 'STRONG', HA, { title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides', mpn: 'TO-HA-30' }, 'STRONG_MATCH', { mpn: 'MATCH', brand: 'UNKNOWN' }, 'mpn_match', 'référence fabricant identique mais marque non établie : STRONG, pas EXACT', { patch: withMpn }),
  // ---------- C. POSSIBLE ----------
  c('C1', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml' }, 'POSSIBLE_MATCH', { variant: 'UNKNOWN', volume: 'MATCH' }, 'variant_absent', 'formulation absente alors qu\'un produit frère existe', { warning: 'sibling_formulation_exists' }),
  c('C2', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 with Ceramides' }, 'POSSIBLE_MATCH', { volume: 'UNKNOWN' }, 'volume_absent', 'volume absent'),
  c('C3', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid + B5 30 ml with Ceramides' }, 'POSSIBLE_MATCH', { concentration: 'UNKNOWN' }, 'concentration_absent', 'concentration absente'),
  c('C4', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid' }, 'POSSIBLE_MATCH', { name: 'UNKNOWN' }, 'name_incomplete', 'fiche de liste aux informations incomplètes'),
  c('C5', 'POSSIBLE', HA, { title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, 'POSSIBLE_MATCH', { brand: 'UNKNOWN', name: 'MATCH' }, 'brand_unknown', 'marque non établie : jamais STRONG'),
  c('C6', 'POSSIBLE', HA, { title: 'The Ordinary Acide Hyaluronique 2% + B5 30 ml avec céramides vendu au bénin' }, 'POSSIBLE_MATCH', { name: 'UNKNOWN' }, 'name_extra_words', 'mots du titre non expliqués : prudence'),
  c('C7', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml', sku: 'LYN-0042' }, 'POSSIBLE_MATCH', { variant: 'UNKNOWN' }, 'variant_absent', 'un SKU vendeur n\'est pas une référence fabricant : ignoré', { warning: 'sku_ignored' }),
  c('C8', 'POSSIBLE', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml', gtin: G1 }, 'POSSIBLE_MATCH', { gtin: 'UNKNOWN' }, 'variant_absent', 'GTIN fourni par la fiche alors que le catalogue n\'en a pas : sans valeur de preuve', { warning: 'candidate_gtin_ignored' }),
  c('C9', 'POSSIBLE', SAL, { title: 'The Ordinary Salicylic Acid 2% Solution 30 ml' }, 'POSSIBLE_MATCH', { variant: 'UNKNOWN', volume: 'MATCH', concentration: 'MATCH' }, 'variant_absent', 'une version anhydre existe : l\'absence de « anhydrous » n\'est pas une preuve', { warning: 'sibling_formulation_exists' }),
  c('C10', 'POSSIBLE', CIC, { title: 'La Roche-Posay Cicaplast Baume B5+ 40 ml' }, 'POSSIBLE_MATCH', { name: 'MATCH', volume: 'MATCH' }, 'variant_absent', 'ancien Baume B5 et version avec indice solaire existent : formulation non établie'),
  // ---------- D. VARIANT ----------
  c('D1', 'VARIANT', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 60 ml with Ceramides' }, 'VARIANT_MATCH', { volume: 'MISMATCH', variant: 'MATCH' }, 'volume_format_differs', 'même produit, 60 ml au lieu de 30 ml'),
  c('D2', 'VARIANT', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml Original Formulation' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_formulation_mismatch', 'original vs with_ceramides'),
  c('D3', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml Old Formula' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_formulation_mismatch', 'old_formula vs new_formula (cible de test : new_formula)', { patch: { variant: { id: 'new_formula', raw: 'New Formula', exactness: 'explicit', source: 'valeur de test' } } }),
  c('D3b', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml Nouvelle formule' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_formulation_mismatch', 'new_formula vs old_formula (cible de test : old_formula), en français', { patch: { variant: { id: 'old_formula', raw: 'Old Formula', exactness: 'explicit', source: 'valeur de test' } } }),
  c('D4', 'VARIANT', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml with Ceramides Refill' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_packaging', 'recharge'),
  c('D5', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml Kit' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_packaging', 'kit'),
  c('D5b', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% Coffret 30 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_packaging', 'set (coffret)'),
  c('D5c', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% Duo 2 x 30 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_packaging', 'duo'),
  c('D5d', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 2 x 30 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH', volume: 'MATCH' }, 'variant_packaging', 'lot de 2 : jamais pris pour un flacon de 30 ml'),
  c('D6', 'VARIANT', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% Supersize 60 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH', volume: 'MISMATCH' }, 'variant_packaging', 'supersize'),
  c('D7', 'VARIANT', SAL, { title: 'The Ordinary Salicylic Acid 2% Anhydrous Solution 30 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_sibling', 'version anhydre : frère connu du catalogue'),
  c('D8', 'VARIANT', CIC, { title: 'La Roche-Posay Cicaplast Baume B5+ SPF 50 40 ml' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_sibling', 'version avec indice solaire : frère connu'),
  c('D9', 'VARIANT', CIC, { title: 'La Roche-Posay Cicaplast Baume B5+ 100 ml' }, 'VARIANT_MATCH', { volume: 'MISMATCH' }, 'volume_format_differs', 'format 100 ml'),
  c('D10', 'VARIANT', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml Ancienne formule' }, 'VARIANT_MATCH', { variant: 'MISMATCH' }, 'variant_formulation_mismatch', 'ancienne formule'),
  // ---------- E. NO_MATCH ----------
  c('E1', 'NO_MATCH', HA, { brand: 'CeraVe', title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, 'NO_MATCH', { brand: 'MISMATCH' }, 'brand_mismatch', 'marque différente (champ marque)'),
  c('E1b', 'NO_MATCH', HA, { title: 'CeraVe Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, 'NO_MATCH', { brand: 'MISMATCH' }, 'brand_mismatch', 'marque différente (dans le titre)'),
  c('E1c', 'NO_MATCH', HA, { brand: 'Garnier', title: 'Hyaluronic Acid 2% + B5 30 ml with Ceramides' }, 'NO_MATCH', { brand: 'MISMATCH' }, 'brand_mismatch', 'marque annoncée absente des alias déclarés : jamais assimilée'),
  c('E2', 'NO_MATCH', HA, { title: 'The Ordinary Hyaluronic Acid 20% + B5 30 ml with Ceramides' }, 'NO_MATCH', { concentration: 'MISMATCH' }, 'concentration_mismatch', 'concentration différente'),
  c('E2b', 'NO_MATCH', NIA, { title: 'The Ordinary Niacinamide 1% + Zinc 10% 30 ml' }, 'NO_MATCH', { concentration: 'MISMATCH' }, 'concentration_mismatch', 'concentrations échangées : chaque pourcentage reste lié à son ingrédient'),
  c('E3', 'NO_MATCH', HA, { title: 'The Ordinary Salicylic Acid 2% + B5 30 ml with Ceramides' }, 'NO_MATCH', { actives: 'MISMATCH' }, 'actives_mismatch', 'actif différent'),
  c('E4', 'NO_MATCH', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 g with Ceramides' }, 'NO_MATCH', { volume: 'MISMATCH' }, 'volume_kind_mismatch', 'volume incompatible : masse au lieu d\'un volume'),
  c('E5', 'NO_MATCH', HA, { brand: TO, title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml with Ceramides', gtin: G2 }, 'NO_MATCH', { gtin: 'MISMATCH' }, 'gtin_mismatch', 'GTIN différent : contradiction forte, même si le texte concorde parfaitement', { patch: withGtin }),
  c('E6', 'NO_MATCH', HA, { brand: TO, title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml with Ceramides', mpn: 'TO-HA-60' }, 'NO_MATCH', { mpn: 'MISMATCH' }, 'mpn_mismatch', 'référence fabricant différente', { patch: withMpn }),
  c('E7', 'NO_MATCH', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml sans céramides' }, 'NO_MATCH', { variant: 'MISMATCH' }, 'variant_negated', 'formulation explicitement exclue'),
  c('E8', 'NO_MATCH', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 Eye Cream 30 ml' }, 'NO_MATCH', { name: 'MISMATCH' }, 'name_conflict', 'produit manifestement différent au nom proche (soin contour des yeux)'),
  c('E8b', 'NO_MATCH', CHA, { title: 'CeraVe Hydrating Cleanser 30 ml' }, 'NO_MATCH', { name: 'MISMATCH' }, 'name_conflict', 'même marque, même gamme « Hydrating », autre produit'),
  c('E9', 'POSSIBLE', HA, { title: 'Garnier Hyaluronic Acid 2% + B5 30 ml' }, 'POSSIBLE_MATCH', { brand: 'UNKNOWN' }, 'name_extra_words', 'marque non déclarée dans le titre : aucune contradiction explicite, mais rien n\'établit le rattachement (information insuffisante = POSSIBLE_MATCH, jamais NO_MATCH)'),
  c('E11', 'NO_MATCH', SAL, { brand: 'La Roche-Posay', title: 'Effaclar Duo+M 40 ml' }, 'NO_MATCH', { brand: 'MISMATCH' }, 'brand_mismatch', 'autre marque et autre produit'),
  // ---------- Pièges : le moteur préfère POSSIBLE à un faux EXACT ----------
  c('T1', 'TRAP', HA, { title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml Original' }, 'POSSIBLE_MATCH', {}, 'variant_absent', '« Original » seul n\'est pas « Original Formulation » : aucune variante reconnue, donc formulation non établie'),
  c('T2', 'TRAP', NIA, { title: 'The Ordinary Niacinamide 10% 30 ml' }, 'POSSIBLE_MATCH', { name: 'UNKNOWN' }, 'name_incomplete', 'même actif, produit incomplet (le zinc manque) : jamais EXACT'),
  c('T3', 'TRAP', EFF, { title: 'La Roche-Posay Effaclar Duo+M 40 ml' }, 'STRONG_MATCH', { variant: 'UNKNOWN' }, 'name_match', '« Duo » fait partie du nom de gamme : ce n\'est pas un coffret duo'),
  c('T4', 'TRAP', EFF, { title: 'La Roche-Posay Effaclar Duo+ 40 ml' }, 'NO_MATCH', { name: 'MISMATCH' }, 'name_plus_suffix', 'Duo+ n\'est pas Duo+M'),
  c('T5', 'TRAP', CIC, { title: 'La Roche-Posay Cicaplast Baume B5 40 ml' }, 'NO_MATCH', { name: 'MISMATCH' }, 'name_plus_suffix', 'ancien Baume B5 : « B5+ » et « B5 » sont deux produits'),
  c('T6', 'TRAP', HA, { title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml' }, 'POSSIBLE_MATCH', { variant: 'UNKNOWN' }, 'variant_absent', 'nom traduit, formulation non indiquée : POSSIBLE'),
  c('T7', 'TRAP', MEL, { title: 'La Roche-Posay Mela B3 Dark Spot Serum 30 ml' }, 'POSSIBLE_MATCH', { name: 'MATCH', concentration: 'UNKNOWN' }, 'concentration_absent', 'alias de nom déclaré (libellé de source du catalogue) : le nom est accepté ; la concentration du catalogue (10 %) manque dans la fiche : POSSIBLE'),
  c('T7b', 'TRAP', MEL, { title: 'La Roche-Posay Mela B3 Dark Spot Serum Niacinamide 10% 30 ml' }, 'STRONG_MATCH', { name: 'MATCH', concentration: 'MATCH' }, 'concentration_match', 'même alias déclaré, concentration écrite et concordante : STRONG (un nom reconnu par alias ne donne jamais EXACT par le texte seul)', { warning: 'name_via_alias' }),
  c('T8', 'TRAP', MEL, { title: 'La Roche-Posay Mela B3 Anti Dark Spot Serum 30 ml' }, 'POSSIBLE_MATCH', { name: 'UNKNOWN' }, 'name_extra_words', 'alias non déclaré (« Anti » en plus) : jamais inventé, donc POSSIBLE'),
  c('T9', 'TRAP', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% + Salicylic Acid 2% 30 ml' }, 'NO_MATCH', { actives: 'MISMATCH' }, 'actives_mismatch', 'actif en plus : autre composition'),
  c('T10', 'TRAP', NIA, { title: 'The Ordinary Niacinamide 10% + Zinc 1% 30 ml Hydrating Mask' }, 'NO_MATCH', { name: 'MISMATCH' }, 'name_conflict', 'même formule nommée mais autre type de soin')
];

/* Les 4 cas hyaluroniques obligatoires (section 20 du brief) et les cas Lynia (section 21). */
const HYALURONIC = [
  { id: 'H-A', title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml with Ceramides', expected: 'EXACT_MATCH' },
  { id: 'H-B', title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml', expected: 'POSSIBLE_MATCH' },
  { id: 'H-C', title: 'The Ordinary Hyaluronic Acid 2% + B5 60ml with Ceramides', expected: 'VARIANT_MATCH' },
  { id: 'H-D', title: 'The Ordinary Hyaluronic Acid 2% + B5 30ml Original Formulation', expected: 'VARIANT_MATCH' }
];
const LYNIA = [
  { id: 'L-1', title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml vendu au bénin', expected: 'POSSIBLE_MATCH', why: 'titre historique : aucune mention de formulation, et des mots non expliqués' },
  { id: 'L-2', title: 'The Ordinary Hyaluronic Acid 2% + B5 30 ml', expected: 'POSSIBLE_MATCH', why: 'titre propre sans formulation : le matcher ne reproduit pas la décision humaine prise sur la capture' },
  { id: 'L-3', title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml avec céramides', expected: 'EXACT_MATCH', why: 'la fiche contient explicitement « avec céramides »' },
  { id: 'L-4', title: 'The Ordinary Acide Hyaluronique 2% + B5 30ml avec céramides vendu au bénin', expected: 'POSSIBLE_MATCH', why: 'formulation explicite mais mots non expliqués : prudence' }
];
/* Équivalents après normalisation (stabilité) et paires qui doivent rester différentes. */
const STABLE = ['The Ordinary Hyaluronic Acid 2% + B5 30ml with Ceramides', 'The Ordinary Hyaluronic Acid 2% + B5 - 30 mL with Ceramides', 'THE ORDINARY ACIDE HYALURONIQUE 2 % + B5 3cl avec céramides', 'the-ordinary hyaluronic acid 2% + b5 0.03 L (with ceramides)'];

/* Applique un patch de test sur une copie de l'identité (fusion profonde simple ; les objets du patch remplacent les champs visés). */
function applyPatch(identity, patch) {
  const out = JSON.parse(JSON.stringify(identity));
  const merge = (t, p) => { for (const [k, v] of Object.entries(p)) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k]) && k !== 'variant') merge(t[k], v); else t[k] = JSON.parse(JSON.stringify(v)); } };
  if (patch) merge(out, patch);
  return out;
}
/* Entrées INEXPLOITABLES : ce ne sont pas des cas de matching (aucune classe), mais des erreurs de validation préalable. Jamais NO_MATCH. */
const INVALID_INPUTS = [
  { id: 'V1', candidate: { title: '' }, error: 'candidate_invalid', note: 'fiche sans titre' }, { id: 'V2', candidate: { title: '   ' }, error: 'candidate_invalid', note: 'titre blanc' },
  { id: 'V3', candidate: { brand: 'The Ordinary' }, error: 'candidate_invalid', note: 'titre absent' }, { id: 'V4', candidate: { title: 42 }, error: 'candidate_invalid', note: 'titre non textuel' },
  { id: 'V5', candidate: null, error: 'candidate_invalid', note: 'fiche absente' }, { id: 'V6', candidate: 'x', error: 'candidate_invalid', note: 'fiche non objet' }
];

module.exports = { CASES, INVALID_INPUTS, HYALURONIC, LYNIA, STABLE, G1, G2, gtin13, applyPatch };
