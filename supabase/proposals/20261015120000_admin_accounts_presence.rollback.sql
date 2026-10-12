-- Retour arrière de 20261015120000_admin_accounts_presence.sql : supprime les deux fonctions et la table de présence. admin_users et admin_overview() ne sont pas touchés.
drop function if exists public.admin_accounts();
drop function if exists public.touch_presence();
drop table if exists public.user_presence;
