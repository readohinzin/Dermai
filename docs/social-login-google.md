# Connexion avec Google : mise en place

Statut : le code est prêt et **fermé par défaut**. Aucun bouton n'apparaît tant que `DERMAI_SOCIAL_PROVIDERS` n'est pas défini sur Vercel ET que le fournisseur n'est pas activé dans Supabase.

## Comment ça marche
1. La personne clique sur « Continuer avec Google ». Le navigateur va sur `https://<projet>.supabase.co/auth/v1/authorize?provider=google&redirect_to=<site>/`.
2. Supabase l'envoie chez Google, qui demande son accord.
3. Google renvoie vers Supabase, qui crée le compte au premier passage (aucune confirmation par e-mail : Google a déjà vérifié l'adresse) puis revient sur le site avec la session dans l'adresse (`#access_token=…`).
4. L'app lit cette session (code existant de retour de lien), la vérifie auprès de Supabase, efface les jetons de l'adresse et ouvre l'espace de la personne. Compte neuf : questionnaire de départ.
Aucun mot de passe, aucun jeton Google ni secret n'est lu ou gardé par le code de l'app. Un refus chez Google ramène sur la connexion avec « Connexion annulée. »

## 1. Google Cloud (gratuit)
1. Ouvrez `https://console.cloud.google.com`, connecté avec le compte Google de DERMAI, et créez un projet (nom : DERMAI).
2. **Google Auth Platform** (ou **APIs & Services**, **OAuth consent screen**) :
   - Type d'utilisateurs : **Externe**.
   - Nom de l'application : `DERMAI`. Adresse d'assistance : l'adresse de contact de DERMAI. Adresse de contact du développeur : la même.
   - Accès (scopes) : seulement `openid`, `.../auth/userinfo.email` et `.../auth/userinfo.profile`. Ce sont des accès de base : pas de validation Google exigée.
   - **Publiez l'application** (état « En production »). Tant qu'elle est en « Test », seules les adresses ajoutées comme testeurs peuvent se connecter.
3. **Identifiants** : « Créer des identifiants », **ID client OAuth**, type **Application Web**, nom `DERMAI web` :
   - **Origines JavaScript autorisées** : `https://dermai-afric.vercel.app`
   - **URI de redirection autorisés** : `https://zdoeyezzqjwpddwmlcai.supabase.co/auth/v1/callback` (l'adresse de callback de votre projet Supabase ; elle est aussi affichée dans Supabase, sous Authentication, Sign In / Providers, Google).
4. Créez. Google affiche un **ID client** et un **code secret client** : copiez-les, ne les partagez jamais (ni dans un message, ni dans Git).

## 2. Supabase
1. **Authentication**, **Sign In / Providers**, **Google** : activez, collez l'**ID client** et le **code secret client**, enregistrez.
2. **Authentication**, **URL Configuration** : **Site URL** `https://dermai-afric.vercel.app` ; **Redirect URLs** contient `https://dermai-afric.vercel.app/**` (et, pour tester sur une Preview, l'adresse de la Preview).

## 3. Vercel
Ajoutez en **Production** : `DERMAI_SOCIAL_PROVIDERS` = `google` , puis redéployez. Valeur publique : ce sont seulement les noms des boutons à afficher.

## 4. Test
1. Ouvrez le site en navigation privée, page de connexion : le bouton « Continuer avec Google » est au-dessus du formulaire.
2. Cliquez, choisissez un compte Google : vous revenez dans l'app, connecté, avec « Vous êtes connecté. Bienvenue ! ».
3. Refusez l'accès sur l'écran de Google : retour à la connexion avec « Connexion annulée… ».
4. Dans Supabase, **Authentication**, **Users** : le compte apparaît avec le fournisseur Google.

## À savoir
- **Même adresse, deux modes** : une personne qui s'est inscrite avec e-mail et mot de passe, puis se connecte avec Google sur la même adresse, peut avoir ses deux identités reliées au même compte (comportement de Supabase quand l'adresse est vérifiée). À vérifier avec un compte de test avant d'ouvrir largement.
- **Navigateurs intégrés** (Instagram, Facebook, TikTok…) : Google refuse la connexion (erreur `disallowed_useragent`). Il faut ouvrir le lien dans Safari ou Chrome.
- **Confidentialité** : la page de confidentialité de l'app devra mentionner ces modes de connexion.
- **Retour en arrière** : retirer `DERMAI_SOCIAL_PROVIDERS` sur Vercel (et redéployer) fait disparaître les boutons ; les comptes déjà créés restent.
