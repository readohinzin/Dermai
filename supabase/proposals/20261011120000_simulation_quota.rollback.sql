-- ANNULATION de supabase/proposals/20261011120000_simulation_quota.sql (à n'exécuter qu'en cas de besoin, après relecture).
-- Ne supprime QUE les deux objets créés par la proposition : la fonction reserve_simulation et la table simulation_usage (avec son index et sa clé primaire).
-- Aucun objet existant n'est touché : ni analysis_usage, ni reserve_analysis, ni profiles, ni skin_analyses, ni delete_my_account.
-- Effet sur les données : seul l'historique des simulations réservées est perdu (aucune photo ni image n'y est stockée).
-- Tant que la fonction est absente, le serveur refuse toute simulation (échec fermé).
drop function if exists public.reserve_simulation(integer, integer);
drop table if exists public.simulation_usage;
