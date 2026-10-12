-- DERMAI : liste des comptes (adresses e-mail) et présence « en ligne » pour la page d'administration du fondateur. PROPOSITION, NON appliquée : à relire puis à exécuter par le fondateur.
-- Prérequis : supabase/proposals/20261014120000_admin_overview.sql (table admin_users). Sans elle, ce script s'arrête avec un message clair, sans rien créer.
--
-- Présence : l'application connectée appelle touch_presence() toutes les 30 secondes tant que la page est visible. La fonction enregistre UNE date par compte (user_presence.last_seen) ; rien d'autre :
-- ni page visitée, ni appareil, ni adresse IP, ni position. Un compte est « en ligne » si cette date a moins de 75 secondes (deux battements manqués de marge).
-- La date n'est réécrite que si elle a plus de 20 secondes (un appel direct répété ne peut pas saturer la base) ; chaque compte n'écrit que SA ligne (auth.uid() du jeton, jamais un paramètre).
-- La suppression du compte efface sa ligne (ON DELETE CASCADE).
--
-- Lecture : admin_accounts() renvoie, pour les comptes les plus récents (500 au plus), l'adresse e-mail, la date de création, la dernière connexion, la dernière présence et l'indicateur « en ligne ».
-- C'est une donnée personnelle (adresses e-mail) : la fonction est refusée à tout compte absent de admin_users, ne renvoie aucun identifiant interne et n'écrit rien (stable).
-- Aucune clé service_role : l'API appelle la fonction avec le jeton du fondateur.
-- Retour arrière : supabase/proposals/20261015120000_admin_accounts_presence.rollback.sql

do $$ begin
  if to_regclass('public.admin_users') is null then
    raise exception 'Appliquer d''abord supabase/proposals/20261014120000_admin_overview.sql (table admin_users manquante)';
  end if;
end $$;

create table if not exists public.user_presence (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  last_seen timestamptz not null default now()
);
comment on table public.user_presence is 'Dernière présence de chaque compte connecté (une date, rien d''autre). Sert à l''indicateur « en ligne » de la page d''administration.';
alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;   -- aucune politique : aucun accès direct

create or replace function public.touch_presence() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.user_presence as p (user_id, last_seen) values (uid, now())
  on conflict (user_id) do update set last_seen = now() where p.last_seen < now() - interval '20 seconds';
end $$;

revoke all on function public.touch_presence() from public, anon;
grant execute on function public.touch_presence() to authenticated;

create or replace function public.admin_accounts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  total integer;
  rows jsonb;
begin
  if uid is null or not exists (select 1 from public.admin_users a where a.user_id = uid) then
    raise exception 'not found' using errcode = '42501';
  end if;

  select count(*) into total from auth.users;

  select coalesce(jsonb_agg(jsonb_build_object(
      'email', u.email,
      'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at,
      'last_seen_at', p.last_seen,
      'online', coalesce(p.last_seen > now() - interval '75 seconds', false))
    order by coalesce(p.last_seen > now() - interval '75 seconds', false) desc, coalesce(p.last_seen, u.last_sign_in_at, u.created_at) desc, u.created_at desc), '[]'::jsonb)
    into rows
    from (select * from auth.users order by created_at desc limit 500) u
    left join public.user_presence p on p.user_id = u.id;

  return jsonb_build_object('v', 1, 'generated_at', now(), 'total', total, 'truncated', total > 500, 'accounts', rows);
end $$;

revoke all on function public.admin_accounts() from public, anon;
grant execute on function public.admin_accounts() to authenticated;   -- l'autorisation est dans la fonction (admin_users), pas dans ce droit
