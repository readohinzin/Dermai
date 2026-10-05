# Fixtures Perfect Corp

Deux fixtures, deux rôles. Ne pas les confondre.

## `perfectcorp-json-response.json` : fixture PRINCIPALE
Réponse de statut AI Skin Analysis v2.1 demandée avec `format: "json"`.

    { status, data: { results: { output: [ { type, ui_score, raw_score, mask_urls }, … ] }, task_status } }

- 15 éléments : les 15 métriques à deux scores (wrinkle, acne, moisture, age_spot, radiance, redness, oiliness, pore, texture,
  firmness, tear_trough, eye_bag, dark_circle_v2, droopy_upper_eyelid, droopy_lower_eyelid).
- Valeurs : celles du résultat de référence (identiques à `perfectcorp-score-info.json`). `mask_urls` : URL factices.
- Construite d'après la structure documentée ; seuls `texture` et `pore` figurent dans l'exemple officiel, les autres valeurs de
  `type` sont supposées égales aux noms d'actions (à confirmer au prochain retour réel).
- **Ne contient volontairement aucun élément `skin_type`, `all` ou `skin_age`.** Le code demande 16 `dst_actions` (dont `skin_type`),
  mais aucune source officielle ne décrit la forme d'un élément `skin_type` dans `output[]`. On n'invente donc rien : la fixture
  reflète ce qui est établi, pas ce qui serait pratique. `normalized.skinType`, `globalScore` et `skinAge` restent `null`.

## `perfectcorp-score-info.json` : référence du format ZIP
Contenu de `skinanalysisResult/score_info.json` (format ZIP) : objet indexé par métrique, avec `all.score`, `skin_age`, `skin_type`
(`whole`, `t_zone`, `u_zone`). **DERMAI ne le parse pas** (le format ZIP n'est jamais demandé). Il sert uniquement de référence de
valeurs et à prouver que ces trois champs ne sont pas copiés dans le résultat `format: "json"`.

Valeur à vérifier : `droopy_upper_eyelid.raw_score` = 79.99314036947925 dans ces fixtures (une recopie antérieure donnait
79.99314069747925 ; la divergence reste à confirmer sur un retour réel).
