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
  À définir uniquement sur l'environnement Preview de test. Le frontend lit cette valeur via `/js/config.js`, servi par `api/config-js.js`.
- `DERMAI_ANALYSIS_ENABLED` : verrou de `/api/skin-analysis`, fermé par défaut.
- `PERFECT_CORP_API_KEY` : clé Perfect Corp, côté serveur uniquement.
- `DERMAI_DEBUG_RAW` : diagnostic, renvoie le JSON brut au navigateur. Laisser vide.
