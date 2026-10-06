# Fixtures Perfect Corp

Deux fixtures, deux rôles. Ne pas les confondre.

## `perfectcorp-json-response.json` : fixture PRINCIPALE
Réponse de statut AI Skin Analysis v2.1 demandée avec `format: "json"`.

    { status, data: { results: { output: [ … ] }, task_status } }

`data.results.output` contient 20 éléments :

- 15 métriques à deux scores : `{ type, ui_score, raw_score, mask_urls }` (wrinkle, acne, moisture, age_spot, radiance, redness,
  oiliness, pore, texture, firmness, tear_trough, eye_bag, dark_circle_v2, droopy_upper_eyelid, droopy_lower_eyelid).
  Valeurs : celles du résultat de référence (identiques à `perfectcorp-score-info.json`). `mask_urls` : URL factices.
- 3 éléments `skin_type`, un par région : `{ type: "skin_type", region: "whole" | "t_zone" | "u_zone", skin_type: "<valeur>" }`.
- 1 élément `all` : `{ type: "all", score }`.
- 1 élément `skin_age` : `{ type: "skin_age", score }`.

Provenance des 5 derniers éléments : les exemples de l'OpenAPI officiel
(<https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.json>) : `skin_type` région whole = "Combination", t_zone = "Oily",
u_zone = "Dry & Redness" (l'OpenAPI les montre avec `hd_skin_type`, la documentation décrit la même structure pour l'action SD
`skin_type`), `all.score` = 28.5, `skin_age.score` = 29. Ces valeurs d'exemple ne sont PAS celles du résultat de référence des 15
métriques : elles sont volontairement différentes de `score_info.json` (all = 73.33…, skin_age = 36, type = Oily).

Non inclus : `resize_image` (type observé en Production, forme non documentée ; il est ignoré par le parseur et testé à part).
Les valeurs de `type` des métriques autres que `texture` et `pore` sont supposées égales aux noms d'actions (à confirmer au prochain
retour réel).

## `perfectcorp-score-info.json` : référence du format ZIP
Contenu de `skinanalysisResult/score_info.json` (format ZIP) : objet indexé par métrique, avec `all.score`, `skin_age`, `skin_type`
(`whole`, `t_zone`, `u_zone`). **DERMAI ne le parse pas** (le format ZIP n'est jamais demandé). Il sert uniquement de référence de
valeurs pour les 15 métriques.

Valeur à vérifier : `droopy_upper_eyelid.raw_score` = 79.99314036947925 dans ces fixtures (une recopie antérieure donnait
79.99314069747925 ; la divergence reste à confirmer sur un retour réel).
