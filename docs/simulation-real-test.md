# Simulation cosmétique : procédure du test réel unique

**Statut : préparée, JAMAIS exécutée. Ne rien lancer sans autorisation explicite de la fondatrice.**
Objectif : une seule simulation réelle, pour (1) confirmer les points non vérifiés du contrat Perfect Corp, (2) mesurer le coût réel en unités, (3) mesurer la durée.
Le code livré est fermé par défaut : tant que les étapes 3 et 4 ne sont pas faites, personne ne peut déclencher de simulation, et aucune unité n'est consommée.

## 0. Règles non négociables
- Une seule simulation réelle. Pas de boucle, pas de script, pas de « un deuxième essai pour comparer ».
- Environnement **Preview** uniquement. Aucune variable `DERMAI_SIMULATION_*` en **Production**, avant, pendant et après.
- Une photo autorisée : celle de la fondatrice, ou d'une personne ayant donné son accord écrit. Jamais la photo d'une utilisatrice sans autorisation.
- **Une issue incertaine n'est jamais relancée** (voir section 8) : elle a peut-être consommé des unités.
- Aucun secret dans Git, dans une capture d'écran ou dans un message : ni la clé Perfect Corp, ni les jetons de session.

## 1. Variables d'environnement et portée (Vercel)
| Variable | Valeur pendant le test | Portée | Remarque |
|---|---|---|---|
| `DERMAI_SIMULATION_ENABLED` | `1` | **Preview seulement** | absente = fermé. Ajoutée à l'étape 4, retirée à l'étape 9 |
| `DERMAI_SIMULATION_ALLOWED_USER_IDS` | l'UUID Supabase du compte de test, seul | **Preview seulement** | liste vide ou absente = personne. `*` = tout compte connecté (choix délibéré, voir README) |
| `DERMAI_MAX_SIMULATIONS_PER_PERIOD` | `1` | Preview | c'est aussi la valeur par défaut ; ne jamais l'augmenter pour « réessayer » |
| `DERMAI_SIMULATION_PERIOD_HOURS` | `24` (défaut) | Preview | |
| `DERMAI_DEBUG_RAW` | `1` | **Preview seulement, le temps du test** | renvoie la réponse brute du fournisseur au navigateur pour fixer le chemin du résultat. À retirer à l'étape 9 |
| `DERMAI_ANALYSIS_ENABLED` | **absente ou `0`** | Preview | l'analyse n'est pas nécessaire : une analyse déjà présente dans l'historique du compte suffit pour afficher le bouton. Ne pas en lancer une (16 unités) |
| `DERMAI_DEMO_MODE` | `false` | Preview | indispensable pour que l'interface appelle le serveur |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | déjà configurées (base existante, probablement celle de la production) | déjà en place, ne pas modifier | voir section 1bis |
| `PERFECT_CORP_API_KEY` | clé existante | Preview | la clé et son solde sont partagés avec tout autre usage : voir section 5 |

Un changement de variable ne s'applique qu'à un nouveau déploiement Preview.

## 1bis. Quelle base Supabase la Preview utilise-t-elle ? (à vérifier AVANT tout)
Décision : pas de projet Supabase de test séparé. La Preview utilisera donc très probablement la **base de production** (les variables `SUPABASE_URL` et `SUPABASE_ANON_KEY` sont en général définies pour tous les environnements Vercel). Cela n'a pas pu être vérifié depuis le développement (aucun accès à Vercel ni à Supabase) ; à confirmer en 2 minutes, sans afficher de secret :
1. Vercel, Settings, Environment Variables : pour `SUPABASE_URL`, noter les **environnements cochés** (Production, Preview, Development). Si Production et Preview sont cochés pour la même entrée, c'est la même base. Deux entrées distinctes = deux bases. Ne pas copier la valeur de `SUPABASE_ANON_KEY` nulle part.
2. Contre-vérification publique (aucun appel à un fournisseur) : ouvrir `https://<adresse de la Preview>/api/config-js` et `https://<adresse de production>/api/config-js` dans le navigateur. Ces pages exposent seulement l'URL du projet Supabase (publique) : comparer le sous-domaine `xxxx.supabase.co`. Identique = même base.
3. Même contrôle pour `PERFECT_CORP_API_KEY` : si elle est cochée Production ET Preview, la Preview dépense le **solde de production** (aucune importance pour le test unique, mais aucun autre usage ne doit consommer pendant la mesure).
4. Si Vercel crée déjà un déploiement Preview pour chaque branche (intégration Git), `feature/skin-simulation` en a probablement déjà un depuis le push. Il est fermé tant qu'aucune variable `DERMAI_SIMULATION_*` n'existe. Vérifier surtout qu'aucune de ces variables n'est cochée « Production » ou « All Environments » : une variable de simulation ne doit exister qu'en Preview.

Conséquences si la base est celle de la production : le compte de test est un vrai compte de production ; seul l'identifiant listé peut utiliser la simulation (contrôle serveur), les autres comptes voient une application inchangée ; la migration de l'étape 2 touche la base de production et exige une autorisation distincte.

## 2. Base de données : migration du quota
Fichiers : `supabase/proposals/20261011120000_simulation_quota.sql` (application) et `supabase/proposals/20261011120000_simulation_quota.rollback.sql` (annulation). Ils ne sont pas dans `supabase/migrations/` : rien ne les applique automatiquement.

**Ce que la migration crée (et uniquement cela)** : la table `public.simulation_usage` (colonnes `id`, `user_id` avec clé étrangère vers `auth.users` en cascade, `used_at`), son index `simulation_usage_user_used_idx`, sa clé primaire, la sécurité par ligne activée SANS politique et tous les droits retirés à `anon` et `authenticated`, et la fonction `public.reserve_simulation(integer, integer)` (`security definer`, `search_path` vide, droit d'exécution retiré à `public` et `anon`, accordé à `authenticated` seulement).
**Ce qu'elle ne touche pas** : `analysis_usage`, `reserve_analysis`, `profiles`, `skin_analyses`, `delete_my_account`, le bucket Storage, les données. Aucun `alter` d'objet existant, aucun `drop`, aucune donnée lue ou modifiée. Les quotas d'analyse sont donc inchangés (le verrou consultatif de la simulation a une clé distincte, `simulation:<uid>`).
**Vérifié sur un PostgreSQL 16 jetable avec des simulations minimales de Supabase** (`test/simulation-quota-db.test.js`) : exactement 4 objets nouveaux et aucun objet existant retiré ou remplacé ; rejouable deux fois sans erreur ; essai à blanc dans une transaction annulée sans trace ; annulation propre ; `analysis_usage` et `reserve_analysis` intactes ; atomicité sous 10 requêtes simultanées ; droits. **Non vérifié** : l'exécution sur le vrai projet Supabase (version de PostgreSQL, privilèges par défaut du projet). Les privilèges sont retirés explicitement, comme dans la migration du quota d'analyses déjà en service.

**Procédure sur la base de production (seulement avec une autorisation explicite)**
1. Pré-contrôle (doit renvoyer deux fois `null`, sinon S'ARRÊTER : un objet du même nom existe déjà) : `select to_regclass('public.simulation_usage'), to_regproc('public.reserve_simulation');`
2. Essai à blanc dans l'éditeur SQL : écrire `begin;`, coller le contenu du fichier d'application, puis `rollback;`. Aucune erreur attendue, rien ne reste.
3. Application réelle : coller le contenu du fichier d'application (sans `begin`/`rollback`) et exécuter une fois.
4. Post-contrôles : `select to_regproc('public.reserve_simulation');` renvoie la fonction ; `select count(*) from public.simulation_usage;` renvoie 0 ; `select has_function_privilege('anon', 'public.reserve_simulation(integer,integer)', 'execute');` renvoie `false` ; `select has_table_privilege('authenticated', 'public.simulation_usage', 'select');` renvoie `false`.
5. Annulation si nécessaire : exécuter le fichier d'annulation. Il supprime la fonction et la table de simulation seulement ; la simulation redevient impossible (échec fermé).
Tant que la fonction est absente, le serveur répond « indisponible » et n'appelle pas Perfect Corp.

## 3. Déploiement Preview, fonctionnalité FERMÉE
1. Utiliser exclusivement la branche `feature/skin-simulation` (jamais `master`, jamais Production) en Preview, **sans** aucune variable `DERMAI_SIMULATION_*`. Si Vercel a déjà construit cette branche automatiquement, ce déploiement convient.
2. Vérifier que tout est fermé (aucun coût) : avec le jeton du compte de test, `GET /api/skin-simulation` doit répondre `{"ok":true,"available":false}` ; sans jeton, 401 ; `POST /api/skin-simulation?concern=radiance` doit répondre 503 « La simulation n'est pas disponible pour le moment. » sans lire la photo. Le bouton « Simuler une amélioration » n'apparaît pas dans l'application.
3. Vérifier que l'analyse existante n'a pas changé : l'écran d'accueil et l'historique s'ouvrent comme avant. Ne pas lancer de nouvelle analyse.

## 4. Un seul compte autorisé
1. Récupérer l'UUID du compte de test (tableau de bord Supabase, Authentication, Users).
2. Définir `DERMAI_SIMULATION_ENABLED=1`, `DERMAI_SIMULATION_ALLOWED_USER_IDS=<UUID>`, `DERMAI_MAX_SIMULATIONS_PER_PERIOD=1`, `DERMAI_DEBUG_RAW=1`, en **Preview seulement**, puis redéployer la Preview.
3. Contrôler : `GET /api/skin-simulation` avec le jeton du compte de test renvoie `available:true` ; avec le jeton d'un AUTRE compte, `available:false` ; `POST` avec l'autre compte : 403.

## 5. Contrôles avant l'appel (tous doivent être bons)
- [ ] La Preview est bien celle déployée à l'étape 4 ; la Production n'a aucune variable de simulation.
- [ ] La fonction `reserve_simulation` existe et `simulation_usage` contient 0 ligne pour ce compte.
- [ ] Le compte de test a une analyse dans son historique (sinon le bouton n'apparaît pas) ; `DERMAI_ANALYSIS_ENABLED` est fermé.
- [ ] Personne d'autre n'utilise la clé Perfect Corp pendant le test (autre application, autre Preview, Production). Sinon le solde ne permettra pas de conclure.
- [ ] **Solde AVANT** relevé dans la console Perfect Corp (https://yce.perfectcorp.com/api-console/), avec date, heure, valeur exacte, et une capture si possible.
- [ ] Facultatif, **seulement après avoir lu les conditions officielles** : comparer le coût annoncé de la fonction de simulation (page de tarifs https://yce.perfectcorp.com/ai-api/api-pricing, à ouvrir dans un navigateur ; l'outil MCP `Get-Feature-Cost` existe aussi). Sa gratuité n'est PAS vérifiée : ne pas l'appeler avec la clé sans l'avoir confirmée. Noter la valeur pour la comparer au constat. Ce n'est pas une mesure.
- [ ] La photo est autorisée (section 0), de face, bien éclairée.
- [ ] Les journaux de la fonction `api/skin-simulation` sont ouverts (Vercel, Logs), filtrés sur ce chemin.

## 6. Une seule simulation
1. Ouvrir l'application Preview avec le compte de test, ouvrir l'analyse la plus récente, cliquer « Simuler une amélioration ».
2. Choisir UNE zone (par exemple « Radiance »). Si l'écran demande une photo, choisir la photo autorisée.
3. Cliquer UNE fois sur « Lancer la simulation ». Ne pas recharger la page, ne pas cliquer à nouveau, ne pas changer d'onglet pour « réessayer ».
4. Attendre la fin (jusqu'à environ une minute). Noter l'heure de début et de fin.
5. Alternative en ligne de commande, équivalente et à n'utiliser qu'UNE fois : `curl -X POST "https://<preview>/api/skin-simulation?concern=radiance" -H "Authorization: Bearer <jeton du compte de test>" -H "Content-Type: image/jpeg" --data-binary @photo.jpg`. Le jeton ne doit pas rester dans l'historique du terminal.

Le quota (1 par 24 h) refuse toute seconde demande. Ne pas le relever pour contourner ce refus.

## 6bis. Statut du contrat API (résumé ; détail dans le README, « Contrat de l'API »)
- **Confirmé** : par le dépôt officiel MCP (Bearer, `src_file_id`, intensités 0 à 1, asynchrone) ET par le premier essai réel du 11/10/2026 : création `POST /s2s/v2.0/task/skin-simulation`, statut `GET …/task/skin-simulation/{task_id}`, corps `{ src_file_id, <zone>: 0.5 }`, image dans `data.results.url`, tâche terminée en environ 4,4 s, **4 unités débitées** pour cette simulation (zone acné, un seul relevé).
- **Rapporté** (résumés de recherche, pages officielles non ouvertes) : existence de points d'accès au solde et à l'historique des unités (chemins non connus).
- **Non vérifié** : facturation d'une tâche en erreur, tarif ferme par zone ou résolution (un seul relevé), durée de validité de l'URL du résultat, chemins et gratuité des points d'accès au solde et à l'historique. La console Perfect Corp reste la référence pour le solde.
- Ne pas appeler les points d'accès au solde ou à l'historique des unités tant que leur chemin et leurs conditions n'ont pas été lus dans la documentation officielle : leur gratuité n'est pas vérifiée.

## 7. Mesures
1. **Solde APRÈS** : relever le solde de la console (attendre 5 à 10 minutes s'il est différé), avec date et heure.
2. **Consommation réelle** = solde avant − solde après (unités). Avec 24 € pour 500 unités : **0,048 € par unité**, soit **31,486 FCFA par unité** (1 € = 655,957 FCFA). Coût = unités × 0,048 € = unités × 31,486 FCFA. Repères pour 9, 12, 16, 22 unités : 283, 378, 504 (le coût d'un scan), 693 FCFA.
3. **Côté base** : `select count(*) from public.simulation_usage where user_id = '<UUID>';` doit renvoyer 1.
4. **Côté journaux** (aucune valeur sensible, seulement des étapes) : `Simulation started`, `Simulation quota reserved`, `Simulation task created`, `Simulation task completed`, `Simulation result structure [...]`. Noter la durée entre la création et la fin de la tâche.
5. **Résultat visuel** : image reçue ? même cadrage que la photo ? effet visible à l'intensité 0,5 ? artefacts ? Noter le jugement honnêtement.
6. **Contrat** : avec `DERMAI_DEBUG_RAW`, la réponse brute (dans l'onglet réseau du navigateur) montre où se trouve l'URL du résultat. S'il diffère de `extractResultUrl`, ou si les journaux contiennent la structure de la réponse parce que l'image a été refusée, corriger la fonction concernée (un changement de quelques lignes) SANS refaire d'essai payant. Si le chemin REST ou le corps de création ont été refusés par le fournisseur, noter le code HTTP des journaux.
7. Consigner dans un seul compte rendu : solde avant et après, unités, FCFA, durée, erreurs, structure de la réponse. Si le solde ne permet pas de conclure (arrondi, différé, partagé), le dire tel quel et ne lancer aucune autre requête pour « mesurer ».

## 8. Résultat ambigu : conduite à tenir
Sont ambigus : pas de réponse, réseau coupé, délai dépassé (504), page rechargée pendant l'attente, réponse illisible, image refusée par DERMAI (`La simulation n'a pas pu être terminée`) alors que les journaux montrent « Simulation task completed ».
- **Ne rien relancer**, ni depuis l'interface, ni en `curl`. L'application demande d'ailleurs une confirmation avant toute nouvelle demande après une réponse manquante : ne pas confirmer.
- La simulation est comptée dans le quota même si elle échoue, par prudence (aucun remboursement automatique). Ne pas supprimer la ligne de `simulation_usage` ni relever le quota.
- Attendre 10 minutes, relever le solde de la console : une baisse indique que la tâche a été facturée.
- Lire les journaux : « Simulation task created » sans « completed » signifie que la tâche existe chez le fournisseur ; l'état exact n'est connu que de la console Perfect Corp.
- Consigner l'incident et décider par écrit, avec la fondatrice, de la suite. Un nouvel essai exige une autorisation explicite distincte.

## 9. Désactivation immédiate après le test
1. Retirer de la Preview `DERMAI_SIMULATION_ENABLED`, `DERMAI_SIMULATION_ALLOWED_USER_IDS` et `DERMAI_DEBUG_RAW` (ou mettre `DERMAI_SIMULATION_ENABLED=0`), puis redéployer la Preview.
2. Revérifier : `GET /api/skin-simulation` répond `available:false`, `POST` répond 503, le bouton a disparu.
3. Vérifier que la Production n'a jamais reçu ces variables et que le solde ne bouge plus.
4. Si la migration a été appliquée sur une base partagée, la laisser en place (fermée, additive) ou la retirer sur décision écrite ; ne rien supprimer sans relire.

## 10. Avant toute ouverture aux utilisatrices (hors de ce test)
Ce test ne suffit pas à ouvrir la fonction. Il reste à décider par écrit : coût mesuré et quotas par offre, intégration au quota de chaque abonnement, texte d'information sur l'envoi de la photo, passage de `maxDuration` si la durée réelle l'exige, appréciation de la qualité visuelle.
