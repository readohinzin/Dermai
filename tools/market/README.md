# tools/market : identité produit, matching, confiance, marché

Briques du futur Market Discovery Engine. **Outillage seulement** : rien ici n'est chargé par le navigateur, par `app.js` ni par le moteur de décision. Aucun réseau, aucun fichier lu implicitement, aucune écriture. `normalize`, `attributes` et `identity` décrivent et normalisent ; `match` compare une fiche à une identité ; `confidence` évalue la fiabilité d'une observation ; `classify` la situe par rapport à un pays cible. Ni le catalogue ni le moteur cosmétique n'en dépendent.

## Trois questions, trois modules (ne jamais les confondre)
| Question | Module | Réponse |
|---|---|---|
| « Cette fiche est-elle probablement CE produit ? » | `match.js` | `EXACT / STRONG / POSSIBLE / VARIANT / NO_MATCH` |
| « Quelle est la FIABILITÉ de ce que nous avons trouvé ? » | `confidence.js` | `HIGH / MEDIUM / LOW / REJECTED` + 8 dimensions |
| « Dans quel MARCHÉ cette offre est-elle disponible pour le pays cible ? » | `classify.js` | `LOCAL / REGIONAL / IMPORT / UNAVAILABLE / UNKNOWN` |

`EXACT_MATCH` n'est pas automatiquement `HIGH` ; `HIGH` n'est pas automatiquement `LOCAL` ; `LOCAL` n'est pas une recommandation cosmétique. Pipeline : fiche → matching → confiance → classification marché → (revue, catalogue : phases futures). Chaque étape reçoit le résultat de la précédente par sa CLASSE seulement, jamais par un score.

## Fichiers

| Fichier | Rôle |
|---|---|
| `normalize.js` | Texte et unités : `normalizeText`, `translate`, `normalizeUnit`, `parseQuantities`, `parseVolume`, `scanConcentrations`, `comparableTokens`, `comparableKey`. Lexique FR/EN fermé et versionné. |
| `attributes.js` | Extraction depuis un texte brut : marque (alias déclarés), concentrations, ingrédients, variantes, SPF, volume. |
| `identity.js` | `deriveIdentity(produit)`, validation (`validateIdentity`, `validateIdentityFile`), vérification des sources citées. |
| `match.js` | `matchCandidate(fiche, identité)`, `buildIndex(identités, { products })`, `findMatches(fiche, index)`. Voir « Matching ». |
| `observation.js` | Schéma partagé d'une observation commerciale (vendeur, pays, prix, stock, lien, source, date, livraison), validation et normalisation (ne décide rien) ; `fromCatalogProduct(produit)` : pont en lecture seule vers le catalogue. |
| `confidence.js` | `assess(observation, { now })` : fiabilité par dimensions et plafonds. Voir « Confiance ». |
| `classify.js` | `classify({ targetCountry, observation, marketChecks })` et `classifyMarket({ targetCountry, observations, marketChecks })`. Voir « Classification marché ». |
| `../../data/market/identities.json` | Identité des produits du catalogue (14 produits). |

## Identité d'un produit
Dérivée de `catalog.js` et vérifiée par test : marque (+ alias déclarés), nom canonique (la variante écrite entre parenthèses à la fin du nom est séparée : « Hyaluronic Acid 2% + B5 (with Ceramides) » → nom + variante `with_ceramides`), volume structuré, actifs reliés, concentrations structurées.
Portés à la main, **toujours avec leur source** (champ du catalogue) **et l'extrait qui l'établit** (le test exige que l'extrait se retrouve tel quel dans le catalogue) : alias de nom, indices de volume, produits frères, notes.
`gtin`, `mpn`, `sku` : `null` tant qu'aucune source ne les fournit ; renseignés, ils exigent `{ value, source }`.
Une donnée absente reste `null`, `[]` ou « unverified » : jamais devinée.

## Normalisation
- Unicode NFKD, accents retirés, minuscules, tirets et ponctuation → espaces, virgule décimale → point.
- Collés : `2 %` → `2%`, `30 ml` → `30ml`, `SPF 50+` → `spf50+`. Isolés : `+`, `/`.
- Unités : ml, cl, l (→ ml), g, kg (→ g), fl oz (→ ml, 29,5735). `oz` seul est **ambigu** et n'est jamais converti. La valeur d'origine est toujours conservée ; la valeur normalisée ne sert qu'à comparer. Deux formats différents (30 ml / 60 ml) restent deux formats.
- `comparableKey` : indépendante de la casse, des accents, de la ponctuation, de l'ordre des mots et de la langue (lexique). Chaque concentration est liée à son ingrédient (`niacinamide=10%`).

## Jetons protégés
Jamais supprimés ni fusionnés : nombres, `%`, `+` (y compris en fin de nom : `Baume B5+` ≠ `Baume B5`), volumes avec unité, SPF, `with`/`avec`, `kit`, `set`, `duo`, `refill`, `supersize`, `old/new/original formula`. Seuls des mots vides sans valeur discriminante sont retirés (the, le, la, de...).

## Variantes
Vocabulaire fermé (`with_ceramides`, `original`, `old_formula`, `new_formula`, `kit`, `set`, `duo`, `refill`, `supersize`). Chaque détection porte son **exactitude** : `explicit` (écrit) ou `inferred` (déduit, ex. « + Ceramides »). Un terme qui fait partie du nom du produit (« Duo » dans Effaclar Duo+M) se déclare dans `name.variantTerms` et s'exclut de la détection.

## Matching (`match.js`)
**Question posée : « cette fiche est-elle probablement le même produit ? »** Pas « l'offre est-elle fiable ? » (qualité de source, fraîcheur, pays du vendeur, lien : `confidence.js`) ni « LOCAL / REGIONAL / IMPORT ? » (`classify.js`) : ces deux modules lisent la CLASSE du résultat et ne le modifient pas. Le matcher n'ouvre jamais le catalogue d'offres et ne touche à aucune donnée : il lit une identité et un objet fiche `{ title, brand?, description?, volume?, gtin?, mpn?, sku? }`.

**Une table de décision, pas une formule.** Huit signaux, chacun `MATCH`, `MISMATCH` ou `UNKNOWN` : `gtin`, `mpn`, `brand`, `name`, `actives`, `concentration`, `volume`, `variant`. Aucun coefficient, aucun seuil. Le `score` renvoyé (part des signaux concordants) est **auxiliaire** : il sert à trier et à observer, il est calculé après la classe et ne la décide jamais.

| Classe | Définition |
|---|---|
| `EXACT_MATCH` | GTIN identique (valide, présent au catalogue avec sa source) ; ou MPN identique avec marque concordante ; ou, par le texte seul, TOUT est écrit et concordant : marque, nom (sans mot en trop, nom canonique et non alias), actifs, concentrations, volume, et formulation explicite dans le titre quand elle compte. Rare par construction. |
| `STRONG_MATCH` | Marque et nom concordants, aucune contradiction, chaque dimension qui compte pour ce produit (concentration, volume, formulation si un frère existe) est établie. Il manque seulement la pureté d'EXACT (mot neutre en plus, formulation déduite ou lue dans la description, nom par alias, pas de GTIN). |
| `POSSIBLE_MATCH` | Pas de contradiction, mais une information qui distingue deux produits manque (volume, concentration, formulation d'un produit à frères, marque non établie, mot du titre non expliqué). C'est la classe par défaut en cas de doute ou d'information insuffisante. |
| `VARIANT_MATCH` | Marque et nom concordants, mais la fiche décrit un autre format (60 ml) ou une autre variante (original, ancienne formule, recharge, kit, coffret, duo, lot, supersize, version anhydre, avec indice solaire). Identifiable, jamais acceptée comme le produit ciblé. |
| `NO_MATCH` | **Contradiction explicite uniquement** : GTIN ou MPN différent, marque différente, actif en plus ou différent, concentration différente, mot d'un autre produit (crème, masque, yeux...), suffixe `+` différent, unité de nature différente (g au lieu de ml), formulation exclue (« sans céramides »). Des éléments insuffisants ne sont pas une contradiction : c'est `POSSIBLE_MATCH` (avertissement `insufficient_evidence`). Une entrée **inexploitable** (fiche sans titre, identité illisible) n'est pas une contradiction produit : elle ne reçoit **aucune classe**. Le résultat est `valid: false`, `matchClass: null`, `error: { code, reason }` (`validateCandidate` permet de la tester avant). |

**Principes.** (1) Un identifiant concordant avec un texte contradictoire donne `POSSIBLE_MATCH`, jamais EXACT. (2) Un GTIN/MPN de la fiche sans équivalent sourcé au catalogue n'est pas une preuve. Un SKU vendeur n'est jamais un MPN. (3) Les produits frères (connus ou candidats) et la variante du catalogue rendent la formulation obligatoire : son absence plafonne à POSSIBLE. (4) Les concentrations restent liées à leur ingrédient (`Niacinamide 10% + Zinc 1%` ≠ `Niacinamide 1% + Zinc 10%`). (5) Les volumes se comparent après normalisation (`30 ml` = `0.03 L` = `3 cl` ; `1 fl oz` = 30 ml étiqueté, écart toléré de 2 % pour ce seul cas) ; `oz` seul est ignoré. (6) Seuls les alias de marque, les alias de nom et le lexique FR/EN déjà déclarés sont utilisés : aucun synonyme n'est deviné. (7) Un mot propre à un autre produit (type de soin, zone d'usage, autre ingrédient) rend le nom incompatible.

**Explicabilité.** Chaque résultat contient `signals`, `reasons` (textes fixes, ex. « marque concordante », « formulation absente de la fiche »), `reasonCodes`, `warnings` (ex. « le catalogue possède un produit frère avec une formulation différente »), `contradictions` pour un rejet, et `evidence` (ce qui a été lu dans la fiche).

**Exemple Lynia** (`to-hyaluronic-b5-ceramides`) :
- « The Ordinary Acide Hyaluronique 2% + B5 30ml vendu au bénin » → `POSSIBLE_MATCH` (aucune formulation, mots non expliqués). Le matcher ne reproduit pas la décision humaine prise sur la capture : la preuve doit figurer dans la fiche.
- « The Ordinary Acide Hyaluronique 2% + B5 30ml avec céramides » → `EXACT_MATCH`. « … 60ml with Ceramides » → `VARIANT_MATCH`. « … 30ml Original Formulation » → `VARIANT_MATCH`.

**Index.** `buildIndex` regroupe les identités préparées et les index marque / GTIN / MPN ; un produit du catalogue sans identité enregistrée reçoit l'identité dérivée (sans frère). `findMatches` préfiltre par GTIN, MPN ou marque détectée et trie par classe, score auxiliaire, identifiant. Pour une entrée invalide (fiche sans titre, index illisible) il renvoie `[]`, ce qui n'est pas « aucune correspondance » : `validateCandidate(fiche)` permet de distinguer les deux cas avant l'appel.

**Jeu de référence** : `test/fixtures/market-matching-fixture.js` (cas étiquetés avec classe, signaux et raison attendus) ; `test/market-matching.test.js` le rejoue, plus des propriétés sur 6000 fiches aléatoires.

## Confiance (`confidence.js`)
**Des dimensions et des règles, pas une formule.** Huit dimensions, chacune `HIGH / MEDIUM / LOW / UNKNOWN` avec un code d'explication : `product`, `seller`, `market` (pays du vendeur), `price`, `stock`, `url`, `source`, `freshness`. Le niveau global part de celui du **produit**, ne peut qu'être **abaissé** par des plafonds nommés (`CAP_*`) et ne monte jamais. Le `score` renvoyé (moyenne des rangs de dimensions) est **auxiliaire** : calculé après le niveau, jamais lu par la décision, aucun seuil.

| Dimension | Règle |
|---|---|
| `product` | `EXACT` → HIGH ; `STRONG` → HIGH (le code `PRODUCT_STRONG_MATCH` garde la différence) ; `POSSIBLE` → LOW (identité ambiguë, jamais l'offre du produit exact) ; `VARIANT` → LOW (`targetProduct: false`) ; `NO_MATCH` → **REJECTED**, global REJECTED, jamais plus. Aucun résultat de matching, ou résultat inexploitable (`valid: false`, dont la classe éventuelle n'est jamais lue) → UNKNOWN, global LOW. |
| `seller` | enregistré et vérifié → HIGH ; enregistré ou identifié par son nom → MEDIUM ; inconnu → UNKNOWN (neutre : plafonne à MEDIUM, ne descend pas à LOW). |
| `market` | pays du vendeur : base explicite + source → HIGH ; simple indice (devise, domaine, langue, téléphone) → LOW ; absent → UNKNOWN ; contradictoire ou invalide → LOW. **Information seulement : ne plafonne pas** le niveau (produit sûr, marché inconnu = HIGH + UNKNOWN côté marché). |
| `price` | affiché, chiffré, avec devise, pour le produit visé → HIGH ; absent → UNKNOWN (n'invalide rien) ; incomplet, estimé, converti ou lié à un autre produit → LOW. Jamais de conversion. |
| `stock` | `IN_STOCK`, `OUT_OF_STOCK`, `COMING_SOON` : mention explicite → HIGH (une rupture est une information fiable) ; sinon `UNKNOWN`. Jamais déduit. |
| `url` | fiche produit (déclarée et non contredite) → HIGH ; recherche, catégorie, page d'accueil → LOW ; absente ou non typée → UNKNOWN. Une adresse de recherche l'emporte sur toute déclaration. |
| `source` | page du vendeur **rouverte** → HIGH ; page non rouverte, relevé fourni par l'équipe, place de marché rouverte → MEDIUM ; fiche fabricant (établit le produit, pas une vente), moteur de recherche, extrait, source secondaire → LOW ; absente → UNKNOWN. |
| `freshness` | `checkedAt` face à la date de référence **fournie** (`opts.now`, jamais d'horloge) : ≤ 30 jours HIGH, ≤ 90 MEDIUM, au-delà LOW (relevé ancien : conservé, non présenté comme frais) ; date absente ou invalide → UNKNOWN ; date future → LOW + contradiction. Bornes réglables (`opts.freshness`). |

Plafonds du niveau global : `CAP_PRODUCT_NOT_TARGET` et `CAP_CONTRADICTION` et `CAP_SOURCE_WEAK` → LOW ; `CAP_SOURCE_NOT_FIRST_HAND`, `CAP_SELLER_UNKNOWN`, `CAP_FRESHNESS`, `CAP_INCOMPLETE` (prix, stock explicite ou fiche produit manquants) → MEDIUM. `HIGH` exige donc : produit EXACT ou STRONG, source de première main, relevé frais, vendeur identifié, fiche complète, aucune contradiction. Un vendeur excellent ne rachète jamais une identité POSSIBLE. Contradictions détectées, jamais corrigées : date future, deux pays de vendeur différents, livraison à la fois confirmée et refusée pour un même pays.

Sortie : `{ schema, observationId, productId, matchClass, level, identity, targetProduct, dimensions, caps, contradictions, reasonCodes, reasons, warningCodes, warnings, issues, score }`, sérialisable sans perte (prête pour un futur mode ombre).

## Classification marché (`classify.js`)
Entrée : un pays cible, une ou plusieurs observations, les `marketChecks` du produit. **Le statut par défaut est UNKNOWN** ; un statut plus fort exige une preuve explicite.

| Statut | Condition |
|---|---|
| `LOCAL` | identité confirmée (EXACT ou STRONG), vendeur nommé, **pays du vendeur établi = pays cible** (base explicite : `seller_page`, `registry`, `team_provided`, `catalog_offer` ET source), offre non en rupture. Le stock inconnu n'empêche pas LOCAL (avertissement `W_STOCK_UNKNOWN`). |
| `REGIONAL` | vendeur établi dans un **autre pays africain du référentiel DERMAI** + livraison vers le pays cible **explicitement** établie (`shipsTo`: `explicit: true` + source). La zone est une règle simple et remplaçable (`opts.isRegional`), pas une zone économique. |
| `IMPORT` | vendeur établi hors de ces pays + livraison vers le pays cible explicitement établie. |
| `UNAVAILABLE` | uniquement par une recherche explicite valide : `marketChecks` du pays cible, `searched_none`, validée par `validateMarketCheck` de `products.js` (même règle que `availabilityStatus`), sans offre qualifiante. Bloqué si une offre établie dans le pays, une offre locale seulement POSSIBLE, une observation d'identité non résolue (matching absent ou inexploitable), une livraison affirmée vers le pays ou une « livraison internationale » non précisée existe, ou si deux recherches se contredisent. |
| `UNKNOWN` | tout le reste. Chaque cause a son code : `IDENTITY_NOT_CONFIRMED`, `SELLER_UNKNOWN`, `MARKET_COUNTRY_UNKNOWN`, `MARKET_COUNTRY_NOT_ESTABLISHED`, `OUT_OF_STOCK`, `DELIVERY_TO_TARGET_UNKNOWN`, `NO_SEARCH_RECORDED`, `INSUFFICIENT_SEARCH_COVERAGE`... |

**Jamais déduits** : le pays par la devise (`XOF` ≠ Bénin), le domaine (`.bj`), la langue, un numéro, une ville seule ; la livraison par « livraison internationale » ; le stock ; `UNAVAILABLE` par une absence, un site inaccessible, un stock ou un vendeur inconnu. Le prix, la devise, la source, la fraîcheur et la confiance **ne sont pas lus** par la classification (un test le démontre).
**Rupture de stock** (`OUT_OF_STOCK`, `COMING_SOON`) : jamais une disponibilité actuelle, jamais transformée en `UNAVAILABLE` ; le résultat garde `historicalOffer: true` (le vendeur et son pays restent en preuve).
**Plusieurs observations** : `classifyMarket` retient la meilleure (LOCAL, puis REGIONAL, puis IMPORT) et garde le détail de chacune dans `observations`.
**Cas Lynia** : `to-hyaluronic-b5-ceramides`, vendeur Lynia Shop, pays BJ établi par le relevé de l'équipe (`team_provided` + source), 12 700 XOF, `in_stock`, titre « avec céramides » : matcher `EXACT_MATCH`, classification `LOCAL` (`LOCAL_SELLER_IN_TARGET_CONFIRMED`), confiance `MEDIUM` (relevé de l'équipe, page non rouverte, pas de lien). Sans la preuve de pays, ou avec la seule devise XOF, la même fiche est `UNKNOWN`.

### Contrat avec `availabilityStatus()` : une source de vérité par étage
| Question | Réponse |
|---|---|
| A. Fonction de référence du statut **catalogue** | `availabilityStatus(produit, pays)` (`js/engine/products.js`), à partir des offres et des `marketChecks` enregistrés. Elle n'est **pas** appelée par l'application : l'affichage actuel passe par `marketView` et `commerceOf` (`js/app.js`), qui ont leur propre logique et ne sont pas modifiés ici. Aucune autre fonction ne la remplace ; elle n'a pas été modifiée. |
| B. Rôle de `classify.js` | **Barrière d'admission** d'une observation candidate qui n'est pas encore au catalogue : quel statut peut-elle revendiquer avec des preuves explicites ? Il n'appelle pas `availabilityStatus` et n'écrit rien. |
| C. Lecture des `marketChecks` | Par la **même validation** (`validateMarketCheck`, importée de `products.js`) : seule une recherche valide du pays cible compte. `searched_none` + aucune offre qualifiante → UNAVAILABLE ; `searched_found` seul n'en fait pas une offre ; un enregistrement invalide donne `INSUFFICIENT_SEARCH_COVERAGE`. |
| D. Quand `classify` est plus prudent | Seulement quand le catalogue affirme un statut sur une preuve que `classify` juge insuffisante, et il répond alors UNKNOWN : jamais un autre statut fort. |
| E. Écarts volontaires | Les quatre ci-dessous, et aucun autre. `reconcile(statutCatalogue, résultat)` classe tout couple en `AGREE`, `MORE_CAUTIOUS` (avec le nom de l'écart) ou `VIOLATION` ; un test exige zéro `VIOLATION` sur le catalogue réel et 600 produits d'essai. |

Règle : **`classify` n'est jamais plus permissif.** S'il donne un statut fort, `availabilityStatus` donne le même sur la forme catalogue de l'observation (`fromCatalogProduct`). `LOCAL` et `UNKNOWN` du catalogue sont toujours repris à l'identique. Sur le catalogue réel actuel, les deux fonctions donnent exactement le même résultat pour chaque produit et chaque pays (aucun écart).

| Écart | Catalogue | classify | Pourquoi (et pourquoi c'est acceptable) |
|---|---|---|---|
| `D1_INTERNATIONAL_UNSPECIFIED` | IMPORT | UNKNOWN | `shipping: international` sans pays nommé : le catalogue lit une livraison internationale comme IMPORT ; rien ne prouve la livraison vers le pays cible. |
| `D2_LOCAL_ONLY_DELIVERY` | REGIONAL | UNKNOWN | le vendeur indique une livraison locale mais liste le pays cible dans `servesMarkets` : les deux indications se contredisent. |
| `D3_UNAVAILABLE_GUARDED` | UNAVAILABLE | UNKNOWN | une offre établie dans le pays, une offre probable, une livraison affirmée (en rupture, par exemple) ou une livraison internationale non précisée existe : déclarer l'indisponibilité serait plus fort que les preuves. |
| `D4_SEARCH_CONFLICT` | UNAVAILABLE | UNKNOWN | deux recherches contradictoires pour un pays (le catalogue retient la première valide). Ne naît que d'un catalogue déjà invalide. |

Cohérence avec la suite : une future phase d'application devra écrire, pour chaque observation admise, des offres dont `availabilityStatus` redonne le statut de `classify` ; en cas d'écart, le catalogue (`availabilityStatus`) fait référence et `reconcile` le signale. Brancher l'une de ces fonctions sur l'affichage serait une décision séparée. Limite actuelle : une offre du catalogue doit avoir un pays africain du référentiel (`validateOffer`) ; un vendeur hors d'Afrique (statut `IMPORT` de `classify`) ne peut donc pas encore y être enregistré.

## Limites connues (phases suivantes)
- Confiance et classification sont purement hors ligne, sur des données fournies : aucune collecte (`safe-fetch`), extraction HTML, découverte, revue (`NEEDS_REVIEW`) ni écriture au catalogue. Le mode ombre (calculer matcher + confiance + classification sans rien écrire) n'est pas implémenté : les sorties sont prêtes pour lui.
- Pas de registre de vendeurs : `registered` / `verified` sont des champs fournis, jamais inférés. Aucun vendeur n'est donc « HIGH » tant qu'un registre n'existe pas.
- La zone « régionale » est « pays africain du référentiel » (remplaçable) ; aucune zone économique (CEDEAO, UEMOA) n'est modélisée. `shipsTo` n'existe pas encore dans le schéma d'offre du catalogue : le pont n'en tire que `servesMarkets`.
- Le type d'une adresse (fiche, catégorie, recherche) repose sur des motifs d'URL courants et sur la déclaration de l'extracteur futur ; une adresse non typée reste « inconnue », jamais « fiche produit ».
- Les bornes de fraîcheur (30 et 90 jours) sont des choix de politique réglables, pas des mesures.
- Pour un produit dont le nom contient un mot de variante (« Duo » dans Effaclar Duo+M), ce mot ne peut pas signaler un lot. « 2 x 30 ml » est reconnu comme un lot ; « 30 ml 2x » non (rejet prudent).
- `vitamin c` et `ascorbic acid` sont deux ingrédients distincts (aucune équivalence déclarée) : la comparaison reste prudente.
- Les produits à frères non distinguables par un mot (ancienne formule, version anhydre) ne peuvent pas dépasser POSSIBLE par le texte seul.
- Les mots du titre non expliqués (marketing, ville) plafonnent à POSSIBLE : une liste de mots neutres pourra être élargie avec des données réelles.
- Un pourcentage sans ingrédient reconnu se compare comme un jeton libre. Les ingrédients reconnus sont ceux du catalogue actuel (liste fermée).
- « Vitamin C10 » n'est pas lu comme 10 % (non écrit).
- Les alias de nom viennent des libellés de sources du catalogue ; aucun alias n'est déduit.
- « Next gen », « V2 » et autres mentions de version ne sont pas encore des variantes.
- `identities.json` est tenu à la main pour les champs sourcés ; un test signale tout écart avec le catalogue. Un nouveau produit sans identité ne casse aucun test.
