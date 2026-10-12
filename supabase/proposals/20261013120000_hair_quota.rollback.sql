-- ANNULATION de supabase/proposals/20261013120000_hair_quota.sql (à n'exécuter qu'en cas de besoin, après relecture).
-- Ne supprime QUE les deux objets créés par la proposition : la fonction reserve_hair et la table hair_usage (avec son index et sa clé primaire).
-- Aucun objet existant n'est touché : ni analysis_usage, ni simulation_usage, ni makeup_usage, ni les fonctions reserve_*, ni profiles, ni skin_analyses, ni delete_my_account.
-- Effet sur les données : seul l'historique des essais capillaires réservés est perdu (aucune photo ni image n'y est stockée).
-- Tant que la fonction est absente, le serveur refuse tout essai capillaire (échec fermé).
drop function if exists public.reserve_hair(integer, integer, integer);
drop table if exists public.hair_usage;
