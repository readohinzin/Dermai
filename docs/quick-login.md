# Lien magique : connexion par e-mail, sans mot de passe

Sous le formulaire de connexion et d'inscription : « Recevoir un lien de connexion par e-mail ».

## Fonctionnement
1. La personne saisit son adresse dans le champ e-mail, puis touche ce lien. Un e-mail part (même service d'envoi que la confirmation du compte : le Gmail configuré dans Supabase, SMTP personnalisé).
2. Elle ouvre le lien depuis sa messagerie : elle arrive sur le site, connectée (« Vous êtes connecté. Bienvenue ! »). Le compte est créé au premier passage ; le lien d'un nouvel inscrit sert aussi de confirmation d'adresse.
3. Réponse identique que l'adresse existe ou non (« Si cette adresse est valide, un lien de connexion vient d'être envoyé… ») : aucune énumération d'adresses. Aucun mot de passe.
4. La session revient dans l'adresse du site, est lue par le code existant de retour de lien (`js/account.js`), vérifiée auprès de Supabase, puis effacée de la barre d'adresse. Un lien expiré ou déjà utilisé affiche le message de lien invalide.

## Prérequis (déjà en place)
- Envoi d'e-mails fonctionnel (Supabase, Authentication, Emails, SMTP Settings).
- **Site URL** = `https://dermai-afric.vercel.app` et **Redirect URLs** contenant `https://dermai-afric.vercel.app/**` (Authentication, URL Configuration).
- Fournisseur **Email** activé (Authentication, Sign In / Providers).
- Les liens expirent (une heure par défaut) et ne servent qu'une fois. Supabase limite le nombre d'e-mails par heure et par adresse : en cas de dépassement, l'app affiche « Trop de tentatives. »
- Pour personnaliser le message : Authentication, Emails, Templates, **Magic Link** (et **Confirm signup** pour une première connexion).

## À savoir
- Une personne déjà inscrite avec e-mail et mot de passe peut utiliser le lien magique sur la même adresse : c'est le même compte.
- Le lien arrive dans la messagerie : si elle l'ouvre sur un autre appareil, c'est cet appareil qui sera connecté.
- Les messages partent de l'adresse « no reply » configurée dans Supabase : penser à regarder les courriers indésirables au premier essai.
- Connexion Google et Apple : abandonnées (compte payant ou carte bancaire non prépayée exigés). Le code a été retiré.
