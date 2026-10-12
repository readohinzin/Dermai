-- DERMAI : lecture AGRÉGÉE pour la page d'administration du fondateur (comptes et utilisation par fonction). PROPOSITION, NON appliquée : à relire puis à exécuter par le fondateur.
-- Lecture seule : la fonction ne contient aucun insert, update, delete ni DDL. Elle ne renvoie que des NOMBRES : jamais d'identifiant de compte, d'e-mail, de photo, de résultat.
-- Droit d'accès (vérifié ICI, en plus du contrôle du serveur) : la table fermée admin_users (RLS sans politique, aucun droit direct). Tant qu'elle est vide, la fonction refuse tout le monde.
-- Aucune clé service_role : l'API appelle la fonction avec le jeton du fondateur ; auth.uid() vient de ce jeton, jamais d'un paramètre.
-- Tables d'utilisation : analysis_usage est supposée appliquée (migration 20261008120000). simulation_usage, makeup_usage, hair_usage n'existent que si leurs propositions ont été appliquées :
-- la fonction teste leur présence (to_regclass) et signale « available: false » au lieu d'échouer ; elle n'invente jamais de zéro pour une table absente.
-- Définitions (affichées telles quelles par la page) :
--   utilisation d'une fonction = une réservation de quota, c'est-à-dire une demande qui a atteint l'étape fournisseur (réussie ou non) ; ce n'est PAS un coût confirmé.
--   compte actif = au moins une réservation, toutes fonctions confondues, sur la période ; retour à 7 jours = compte créé il y a plus de 7 jours et actif ces 7 derniers jours ;
--   inactif 30 jours = compte créé il y a plus de 30 jours sans aucune réservation sur 30 jours ; jamais utilisé = aucune réservation, jamais.
--   « signed_in » = date de dernière connexion enregistrée par Supabase (une seule date par compte, donc pas un historique).
-- Les réservations de plus de 400 jours sont effacées par les fonctions de quota : les totaux sur 7 et 30 jours ne sont pas touchés.
--
-- Après application, le fondateur s'ajoute lui-même (SQL Editor, rôle postgres) ; remplacer <UID> par la colonne UID de Authentication > Users :
--   insert into public.admin_users (user_id) values ('<UID>');
-- Retour arrière : supabase/proposals/20261014120000_admin_overview.rollback.sql

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
comment on table public.admin_users is 'Comptes autorisés à lire les statistiques agrégées (page d''administration). Remplie à la main par le fondateur.';
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;   -- aucune politique : aucun accès direct

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  acc jsonb; act jsonb; saved jsonb; r jsonb;
  fn jsonb := '{}'::jsonb;
  src text := 'select user_id, used_at from public.analysis_usage';
  t record;
begin
  if uid is null or not exists (select 1 from public.admin_users a where a.user_id = uid) then
    raise exception 'not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'new_7d', count(*) filter (where u.created_at > now() - interval '7 days'),
    'new_30d', count(*) filter (where u.created_at > now() - interval '30 days'),
    'signed_in_7d', count(*) filter (where u.last_sign_in_at > now() - interval '7 days'),
    'signed_in_30d', count(*) filter (where u.last_sign_in_at > now() - interval '30 days'))
    into acc from auth.users u;

  for t in select * from (values ('analysis', 'analysis_usage'), ('simulation', 'simulation_usage'), ('makeup', 'makeup_usage'), ('hair', 'hair_usage')) v (k, tbl) loop
    if to_regclass('public.' || t.tbl) is null then
      fn := fn || jsonb_build_object(t.k, jsonb_build_object('available', false));
    else
      execute format(
        'select jsonb_build_object(''available'', true, ''runs_7d'', count(*) filter (where used_at > now() - interval ''7 days''), ''runs_30d'', count(*) filter (where used_at > now() - interval ''30 days''), ''users_30d'', count(distinct user_id) filter (where used_at > now() - interval ''30 days'')%s) from public.%I',
        case when t.tbl = 'hair_usage' then ', ''units_7d'', coalesce(sum(units) filter (where used_at > now() - interval ''7 days''), 0), ''units_30d'', coalesce(sum(units) filter (where used_at > now() - interval ''30 days''), 0)' else '' end,
        t.tbl) into r;
      fn := fn || jsonb_build_object(t.k, r);
      if t.tbl <> 'analysis_usage' then src := src || ' union all select user_id, used_at from public.' || t.tbl; end if;
    end if;
  end loop;

  execute format($q$
    with act as (%s)
    select jsonb_build_object(
      'active_7d', (select count(distinct user_id) from act where used_at > now() - interval '7 days'),
      'active_30d', (select count(distinct user_id) from act where used_at > now() - interval '30 days'),
      'returned_7d', (select count(distinct a.user_id) from act a join auth.users u on u.id = a.user_id where a.used_at > now() - interval '7 days' and u.created_at < now() - interval '7 days'),
      'never_used', (select count(*) from auth.users u where not exists (select 1 from act a where a.user_id = u.id)),
      'inactive_30d', (select count(*) from auth.users u where u.created_at < now() - interval '30 days' and not exists (select 1 from act a where a.user_id = u.id and a.used_at > now() - interval '30 days')))
  $q$, src) into act;

  select jsonb_build_object('total', count(*), 'last_30d', count(*) filter (where analyzed_at > now() - interval '30 days'), 'users', count(distinct user_id))
    into saved from public.skin_analyses;

  return jsonb_build_object('v', 1, 'generated_at', now(), 'accounts', acc || act, 'functions', fn, 'saved_analyses', saved);
end $$;

revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;   -- l'autorisation est dans la fonction (admin_users), pas dans ce droit
