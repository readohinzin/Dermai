-- ANNULATION de supabase/proposals/20261012120000_makeup_quota.sql (à n'exécuter qu'en cas de besoin, après relecture).
-- Ne supprime QUE les deux objets créés par la proposition : la fonction reserve_makeup et la table makeup_usage (avec son index et sa clé primaire).
-- Aucun objet existant n'est touché : ni analysis_usage, ni simulation_usage, ni reserve_analysis, ni reserve_simulation, ni profiles, ni skin_analyses, ni delete_my_account.
-- Effet sur les données : seul l'historique des essayages réservés est perdu (aucune photo ni image n'y est stockée).
-- Tant que la fonction est absente, le serveur refuse tout essayage (échec fermé).
drop function if exists public.reserve_makeup(integer, integer);
drop table if exists public.makeup_usage;
