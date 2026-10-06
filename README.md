# DERMAI

Maquette interactive d'une application d'analyse de peau (français, mobile d'abord, responsive bureau).

Fichiers : `index.html`, `css/styles.css`, `js/app.js`. Ouvre `index.html` dans un navigateur, aucune installation.

## Écrans
Accueil, inscription, onboarding, scan (3 photos), analyse, résultats, détail par préoccupation,
actifs, routine matin/soir, produits, progression, historique des analyses, profil, confidentialité.

## Données d'analyse
Dans `js/app.js` : `DEMO_MODE = true` : données et photo fictives (`MockProvider`).
Mettre `false` pour appeler `POST /api/skin-analysis` (`PerfectCorpProvider`).
Ce backend n'existe pas encore : il doit garder la clé API et renvoyer le JSON brut du fournisseur.
Une valeur absente reste `null` et l'indicateur est masqué, jamais inventé.

## Configuration par environnement (Vercel)
- `DERMAI_DEMO_MODE` : vide ou absente = mode démo (défaut, Production). `false` (ou `0`, `no`, `off`) = le frontend appelle le backend.
  À définir uniquement sur l'environnement Preview de test. Le frontend lit cette valeur via `/api/config-js` (fonction `api/config-js.js`), chargé par `index.html` avant `app.js`.
- `DERMAI_ANALYSIS_ENABLED` : verrou de `/api/skin-analysis`, fermé par défaut.
- `PERFECT_CORP_API_KEY` : clé Perfect Corp, côté serveur uniquement.
- `DERMAI_DEBUG_RAW` : diagnostic, renvoie le JSON brut au navigateur. Laisser vide.
- `SUPABASE_URL` et `SUPABASE_ANON_KEY` : comptes et profil persistant (Supabase Auth). Valeurs PUBLIQUES, exposées au navigateur par `/api/config-js` (URL du projet en `https://…` et clé « anon »).
  Sans elles (ou en mode démo), les comptes sont simplement indisponibles. Ne jamais définir la clé `service_role` dans le frontend ni dans `/api/config-js`.

## Comptes et profil (Supabase)
- Authentification : e-mail + mot de passe (Supabase Auth). Aucun mot de passe n'est stocké par DERMAI ; seule la session d'authentification est mémorisée dans le navigateur (clé `dermai.session`).
- Profil : table `public.profiles` (objectifs, niveau de routine, approche douce, exclusions). Migration : `supabase/migrations/20261006120000_create_profiles.sql`
  (à appliquer avec `supabase db push` ou en l'exécutant dans l'éditeur SQL du projet). RLS activée : chaque utilisateur ne lit et ne modifie que sa propre ligne ; `user_id` vient de `auth.uid()`.
- Historique : table `public.skin_analyses` (une ligne par analyse réelle réussie d'un utilisateur connecté). Migration : `supabase/migrations/20261007120000_create_skin_analyses.sql`
  (à appliquer **avant** de promouvoir cette version en production, comme la précédente). Elle conserve ce que DERMAI a mesuré et recommandé à la date de l'analyse : score global, type de peau, âge cutané,
  les 15 `uiScore` (entiers 0-100, 100 = meilleur ; `null` = indisponible), priorités (id, libellé, score, bande), objectifs du moment, version des règles (`engine_version`, `Engine.VERSION`).
  Une analyse enregistrée est figée (aucune modification possible côté client) et n'est jamais recalculée. RLS : lecture, ajout et suppression de ses propres lignes seulement.
  Pas d'enregistrement en mode démo, pour un visiteur non connecté, ni pour une analyse échouée.
- Analyse : `POST /api/skin-analysis` exige une session Supabase valide (`Authorization: Bearer <access_token>`). Le serveur vérifie le jeton auprès de Supabase (`GET /auth/v1/user`, clé publique `SUPABASE_URL` / `SUPABASE_ANON_KEY`, aucune clé `service_role`) AVANT de lire la photo et d'appeler Perfect Corp ; ordre : méthode, authentification, verrou `DERMAI_ANALYSIS_ENABLED`, validation de la photo, Perfect Corp. Sans session, jeton invalide, expiré, falsifié, ou Supabase injoignable : refus (401 / 503), aucune unité consommée. Un visiteur peut naviguer ; lancer une analyse l'oriente vers la connexion.
- Quota d'analyses : la base réserve chaque analyse avant l'appel à Perfect Corp (`reserve_analysis`, migration `20261008120000_analysis_quota.sql`, atomique par utilisateur, indépendant de l'historique). Réglable par variables Vercel : `DERMAI_MAX_ANALYSES_PER_PERIOD` (défaut 3) et `DERMAI_ANALYSIS_PERIOD_HOURS` (défaut 24). Tout ce qui atteint l'étape fournisseur compte, même en échec ; photo invalide, non connecté ou verrou fermé ne comptent pas. Si la fonction est absente ou la base injoignable, l'analyse est refusée (503).
- Suppression de compte : fonction SQL `delete_my_account()` (migration `20261008121000_delete_my_account.sql`), sans paramètre, qui supprime uniquement le compte du jeton ; profil, analyses et quota partent en cascade. Aucune clé `service_role` n'est nécessaire ni utilisée.
- Mot de passe oublié et confirmation d'adresse : parcours Supabase Auth (e-mail avec lien vers le site). Réglages à faire dans le tableau de bord Supabase : « Confirm email » activé, « Site URL » = adresse du site, adresse du site dans « Redirect URLs », et un expéditeur d'e-mails adapté à l'usage public (SMTP personnalisé).
- Catalogue produits : dernière couche de la chaîne mesure, interprétation, priorité, actif, routine, produit. Un produit est une conséquence de la routine (il ne change ni score, ni priorité, ni actif). Deux catalogues jamais mélangés : démonstration (`js/engine/data/products.js`, produits `demo: true`, mode démo seulement) et réel (`js/engine/data/catalog.js`). Modèle et règles d'ajout dans l'en-tête de ces fichiers ; `Engine.products.validateCatalog` valide chaque entrée (tests). Aucun score ni pourcentage de correspondance.
- Catalogue réel africain (étape 14B) : **un produit, plusieurs offres, plusieurs pays**. Chaque offre (`offers`) porte son pays (code ISO, les 54 pays africains), son vendeur, son type (site de la marque, revendeur, pharmacie, place de marché, importateur), SA devise (jamais convertie : un prix en FCFA hors zone FCFA ou en naira hors Nigeria est refusé), son prix (ou « Prix à vérifier »), sa disponibilité locale, son lien https réel, sa source et sa date de relevé. Aucun prix ni aucune disponibilité global(e), aucun pays par défaut. Le bouton « Acheter en ligne » n'existe que pour une offre en stock avec un vrai lien. Une annonce de place de marché n'est pas une preuve d'authenticité. Un produit réel est `validated` (nom, marque, format, INCI complet, source fabricant) ou `to_verify` (conservé pour mémoire, jamais affiché, avec ce qui manque). État au 2026-10-06 : 13 produits (10 validés, 3 à vérifier) ; les pages fabricant The Ordinary, CeraVe Afrique et La Roche-Posay Afrique ont été lues directement ; une seule offre est renseignée : Dermastore (Afrique du Sud) pour le CeraVe Blemish Control Gel, avec prix en ZAR et stock lus sur sa page ; le lien BuyBetter (Nigeria) cité par CeraVe renvoie 404 et a été écarté ; aucune image. Pour ajouter une offre : une entrée dans `offers` du produit, avec source et date.
- Rien d'autre n'est enregistré : ni photo, ni masque, ni `task_id`, ni `rawScore`, ni donnée brute du fournisseur d'analyse.
- Réglages Supabase à vérifier : confirmation par e-mail (si activée, l'inscription demande de confirmer l'adresse avant la connexion), longueur minimale du mot de passe.
