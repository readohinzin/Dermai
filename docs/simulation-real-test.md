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
| `DERMAI_SIMULATION_ALLOWED_USER_IDS` | l'UUID Supabase du compte de test, seul | **Preview seulement** | liste vide ou absente = personne. Pas de joker |
| `DERMAI_MAX_SIMULATIONS_PER_PERIOD` | `1` | Preview | c'est aussi la valeur par défaut ; ne jamais l'augmenter pour « réessayer » |
| `DERMAI_SIMULATION_PERIOD_HOURS` | `24` (défaut) | Preview | |
| `DERMAI_DEBUG_RAW` | `1` | **Preview seulement, le temps du test** | renvoie la réponse brute du fournisseur au navigateur pour fixer le chemin du résultat. À retirer à l'étape 9 |
| `DERMAI_ANALYSIS_ENABLED` | **absente ou `0`** | Preview | l'analyse n'est pas nécessaire : une analyse déjà présente dans l'historique du compte suffit pour afficher le bouton. Ne pas en lancer une (16 unités) |
| `DERMAI_DEMO_MODE` | `false` | Preview | indispensable pour que l'interface appelle le serveur |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | projet de test | Preview | voir section 2 |
| `PERFECT_CORP_API_KEY` | clé existante | Preview | la clé et son solde sont partagés avec tout autre usage : voir section 5 |

Un changement de variable ne s'applique qu'à un nouveau déploiement Preview.

## 2. Base de données : migration du quota
Le fichier `supabase/proposals/20261011120000_simulation_quota.sql` crée la table fermée `simulation_usage` et la fonction `reserve_simulation`. Il n'est pas dans `supabase/migrations/` : rien ne l'applique automatiquement.
1. **Choisir la base.** Recommandé : un projet Supabase de TEST (ou une branche) distinct de la production. Si la Preview partage la base de production, appliquer ce fichier est un changement de la base de production : il est purement additif et fermé (RLS sans politique), mais il exige l'autorisation explicite de la fondatrice.
2. **Relire** le fichier en entier avant de l'exécuter. Il ne touche ni `analysis_usage`, ni `reserve_analysis`, ni les données existantes.
3. **Appliquer** dans l'éditeur SQL du projet choisi (une seule fois).
4. **Vérifier** : `select to_regproc('public.reserve_simulation');` renvoie la fonction ; `select count(*) from public.simulation_usage;` renvoie 0 ; un compte connecté ne peut pas lire la table (`permission denied`).
5. Tant que la fonction est absente, le serveur répond « indisponible » et n'appelle pas Perfect Corp : c'est le comportement sûr.

## 3. Déploiement Preview, fonctionnalité FERMÉE
1. Déployer la branche `feature/skin-simulation` en Preview **sans** aucune variable `DERMAI_SIMULATION_*`.
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
- [ ] Facultatif et gratuit d'après le dépôt officiel : demander le coût annoncé de la fonction `AI-Skin-simulation` (outil `Get_Feature_Cost` du serveur MCP officiel, ou la page de tarifs https://yce.perfectcorp.com/ai-api/api-pricing). Noter la valeur pour la comparer au constat. Ne pas confondre avec une mesure.
- [ ] La photo est autorisée (section 0), de face, bien éclairée.
- [ ] Les journaux de la fonction `api/skin-simulation` sont ouverts (Vercel, Logs), filtrés sur ce chemin.

## 6. Une seule simulation
1. Ouvrir l'application Preview avec le compte de test, ouvrir l'analyse la plus récente, cliquer « Simuler une amélioration ».
2. Choisir UNE zone (par exemple « Éclat »). Si l'écran demande une photo, choisir la photo autorisée.
3. Cliquer UNE fois sur « Lancer la simulation ». Ne pas recharger la page, ne pas cliquer à nouveau, ne pas changer d'onglet pour « réessayer ».
4. Attendre la fin (jusqu'à environ une minute). Noter l'heure de début et de fin.
5. Alternative en ligne de commande, équivalente et à n'utiliser qu'UNE fois : `curl -X POST "https://<preview>/api/skin-simulation?concern=radiance" -H "Authorization: Bearer <jeton du compte de test>" -H "Content-Type: image/jpeg" --data-binary @photo.jpg`. Le jeton ne doit pas rester dans l'historique du terminal.

Le quota (1 par 24 h) refuse toute seconde demande. Ne pas le relever pour contourner ce refus.

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
