# Outil interne d'évaluation DermAI (hors production)

Compare **ce que le moteur dit d'une photo** à **ce qu'une personne voit**, par groupe de teint.
Il répond à une question précise : les repères du moteur (raw_score 50 et 25) sont-ils justes sur les peaux foncées ?
Il mesure surtout la **fausse rassurance** : la personne voit un signe modéré ou marqué (l'acné, par exemple) et le moteur dit « bon ».

> Cet outil n'est **pas** dans l'application. Il tourne sur votre ordinateur, à l'adresse `127.0.0.1`, et n'envoie rien nulle part.

## Lancer

```bash
node tools/eval/serve.js --sample     # données FICTIVES de démonstration (lecture seule, aucune photo)
node tools/eval/serve.js              # vos données : dossier eval-data/ (ignoré par git)
```

Puis ouvrir l'adresse affichée. Deux onglets : **Évaluer** (évaluation à l'aveugle, le moteur ne s'affiche qu'après votre enregistrement) et **Comparaison**.

## Vos données : `eval-data/`

```
eval-data/
  manifest.json     la liste des photos et le résultat du moteur
  photos/           les photos (jamais dans git)
  ratings.json      créé par l'outil : les évaluations (jamais dans git)
```

`manifest.json` :

```json
{ "items": [ {
  "id": "P001",
  "photo": "P001.jpg",
  "monk": 7,
  "consent": { "given": true, "date": "2026-11-20", "scope": "évaluation interne de DermAI, conservée 12 mois" },
  "engine": { "acne": { "rawScore": 71.5, "uiScore": 80 }, "pigmentation": { "rawScore": 40, "uiScore": 55 } }
} ] }
```

- `id` : un pseudonyme (lettres, chiffres, tiret), **jamais un nom**.
- `monk` : le teint de la personne, de 1 à 10 (échelle Monk), noté par la personne ou à ses côtés.
- `engine` : les mesures renvoyées par l'analyse de cette même photo (`normalized`, voir `js/skin-model.js`). Seul le `rawScore` sert à comparer.
- `consent` : **obligatoire**. Sans `given: true`, sans date ou sans `scope`, la photo est **exclue** et aucune évaluation n'est enregistrée. `"withdrawn": true` retire une photo.

## Consentement et vie privée

- Une photo de visage est une donnée sensible. **Faites valider le formulaire de consentement** (et l'autorisation auprès de l'autorité de protection des données du Bénin) par une personne compétente avant de collecter quoi que ce soit : cet outil ne remplace pas cela.
- Le consentement dit : à quoi servent les photos (évaluer et régler DermAI, rien d'autre), qui les voit, combien de temps elles sont gardées, comment les faire effacer (supprimer la ligne du manifeste, la photo, et les évaluations dans `ratings.json`).
- Ne mettez jamais ces fichiers dans git, dans un cloud public, ni dans un message. Le dossier `eval-data/` est ignoré par git ; l'outil lui-même (`tools/eval/`) est exclu du déploiement (`.vercelignore`).

## Lire la comparaison

- **Fausse rassurance** : part des cas où la personne voit un signe modéré ou marqué et où le moteur dit « bon ». Au-delà de 30 %, un écart est signalé.
- **Seuil suggéré** : le raw_score en dessous duquel le moteur devrait voir un point à soutenir pour coller à l'évaluation. **Jamais appliqué tout seul** : une personne décide avant de toucher à `js/engine/data/decision.js`.
- **Vu par les personnes, non mesuré par le moteur** : marques après bouton, boutons de rasage, cicatrices, aspect cendré.
- En dessous de 10 photos par groupe, l'outil écrit « trop petit pour conclure ». Visez au moins 30 photos par groupe de teint, évaluées par deux personnes.

## Avant de déployer

`.vercelignore` exclut `tools/eval` et `eval-data`. Après un déploiement, ouvrez `/tools/eval/index.html` sur le site : vous devez voir l'application DermAI, **pas** cette page.
