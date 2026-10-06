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
- Rien d'autre n'est enregistré : ni photo, ni masque, ni `task_id`, ni donnée brute du fournisseur d'analyse. Les analyses ne sont pas persistantes.
- Réglages Supabase à vérifier : confirmation par e-mail (si activée, l'inscription demande de confirmer l'adresse avant la connexion), longueur minimale du mot de passe.
