-- DERMAI : quota d'analyses par utilisateur, vérifié CÔTÉ BASE (atomique), avant tout appel au fournisseur d'analyse.
-- Une ligne de analysis_usage = une analyse réservée (photo valide, juste avant l'appel au fournisseur). Rien n'est jamais remboursé :
-- une tentative qui a atteint l'étape fournisseur compte, quel que soit son résultat (la facturation exacte du fournisseur n'est pas
-- vérifiée : on retient l'hypothèse la plus sûre pour le coût). Les refus en amont (non connecté, verrou, photo invalide) ne comptent pas.
-- Ce quota est indépendant de skin_analyses : supprimer son historique ne rend aucune analyse.
-- Sécurité : table fermée (RLS sans politique, aucun droit) ; seule la fonction reserve_analysis y écrit, avec l'identité du jeton
-- (auth.uid()). Le navigateur ne peut ni lire, ni modifier, ni effacer ses lignes. Appeler directement la fonction ne peut que consommer
-- SON propre quota.

create table if not exists public.analysis_usage (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  used_at timestamptz not null default now()
);
comment on table public.analysis_usage is 'Analyses réservées par utilisateur (quota). Ni photo, ni résultat, ni donnée du fournisseur.';
create index if not exists analysis_usage_user_used_idx on public.analysis_usage (user_id, used_at desc);

alter table public.analysis_usage enable row level security;
revoke all on public.analysis_usage from anon, authenticated;   -- aucune politique : aucun accès direct

-- Réserve une analyse si le quota le permet. Atomique par utilisateur : un verrou consultatif sérialise les requêtes simultanées du même
-- compte, donc deux requêtes ne peuvent pas se partager la dernière analyse.
-- p_limit : nombre maximal d'analyses sur la période ; p_window_seconds : durée de la période (valeurs bornées).
-- Renvoie { ok, used, limit, retry_after } ; retry_after (secondes) seulement si refusé.
create or replace function public.reserve_analysis(p_limit integer, p_window_seconds integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  used integer;
  oldest timestamptz;
  total integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_limit is null or p_limit < 0 or p_limit > 1000 or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 31536000 then
    raise exception 'invalid parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  -- Ménage : les lignes de plus de 400 jours ne servent plus (la période maximale est d'un an).
  delete from public.analysis_usage where user_id = uid and used_at < now() - interval '400 days';

  -- Borne de stockage par compte : appeler la fonction directement avec des paramètres choisis ne peut pas remplir la table.
  select count(*) into total from public.analysis_usage where user_id = uid;
  if total >= 2000 then
    return jsonb_build_object('ok', false, 'used', total, 'limit', p_limit, 'retry_after', 86400);
  end if;

  select count(*), min(used_at) into used, oldest
    from public.analysis_usage
   where user_id = uid and used_at > now() - make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return jsonb_build_object('ok', false, 'used', used, 'limit', p_limit,
      'retry_after', greatest(1, ceil(extract(epoch from (coalesce(oldest, now()) + make_interval(secs => p_window_seconds) - now())))::integer));
  end if;

  insert into public.analysis_usage (user_id) values (uid);
  return jsonb_build_object('ok', true, 'used', used + 1, 'limit', p_limit);
end $$;

revoke all on function public.reserve_analysis(integer, integer) from public, anon;
grant execute on function public.reserve_analysis(integer, integer) to authenticated;
