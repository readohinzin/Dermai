-- Retour arrière de 20261014120000_admin_overview.sql : supprime la fonction de lecture et la table des comptes autorisés. Aucune donnée d'utilisatrice n'est touchée.
drop function if exists public.admin_overview();
drop table if exists public.admin_users;
