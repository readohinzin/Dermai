# DERMAI

Maquette interactive d'une application d'analyse de peau (français, mobile d'abord, responsive bureau).

Un seul fichier : `index.html`. Ouvre-le dans un navigateur, aucune installation.

## Écrans
Accueil, inscription, onboarding, scan (3 photos), analyse, résultats, détail par préoccupation,
actifs, routine matin/soir, produits, progression, historique des analyses, profil, confidentialité.

## Données d'analyse
`DEMO_MODE = true` : données et photo fictives (`MockProvider`).
Mettre `false` pour appeler `POST /api/skin-analysis` (`PerfectCorpProvider`).
Ce backend n'existe pas encore : il doit garder la clé API et renvoyer le JSON brut du fournisseur.
Une valeur absente reste `null` et l'indicateur est masqué, jamais inventé.
