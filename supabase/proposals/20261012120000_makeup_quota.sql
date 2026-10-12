-- PROPOSITION, NON APPLIQUÉE : ce fichier n'est volontairement PAS dans supabase/migrations/ : il ne doit être exécuté qu'après autorisation explicite.
--
-- DERMAI : quota d'ESSAYAGES de maquillage (Studio Beauté, AI Makeup Virtual Try-On), distinct du quota d'analyses et de celui des simulations.
-- Pourquoi une migration : le quota doit être appliqué par la base (atomique, une ligne = un essayage réservé), comme ceux des analyses et des simulations ; en
-- mémoire de la fonction serverless il serait contournable (fonctions dupliquées ou recyclées). Compter les essayages dans analysis_usage ou simulation_usage les
-- confondrait avec d'autres fonctions (un essayage ne doit ni consommer ni libérer une analyse ou une simulation). Sans cette fonction, le Studio Beauté est refusé
-- (échec fermé : le serveur reçoit 404 et répond « indisponible ») : appliquer ce fichier ne suffit pas à l'ouvrir, DERMAI_MAKEUP_ENABLED et
-- DERMAI_MAKEUP_ALLOWED_USER_IDS restent nécessaires.
--
-- Même modèle que supabase/proposals/20261011120000_simulation_quota.sql : table fermée (RLS sans politique, aucun droit direct), fonction security definer qui
-- n'utilise que auth.uid() (identité du jeton vérifié), verrou consultatif par utilisateur, paramètres bornés, ménage à 400 jours, plafond de 2000 lignes par
-- compte. Rien n'est jamais remboursé : une demande qui a atteint le fournisseur compte, quel que soit son résultat.
-- La suppression du compte (delete_my_account) emporte ces lignes (ON DELETE CASCADE).

create table if not exists public.makeup_usage (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  used_at timestamptz not null default now()
);
comment on table public.makeup_usage is 'Essayages de maquillage réservés par utilisateur (quota). Ni photo, ni image, ni donnée du fournisseur.';
create index if not exists makeup_usage_user_used_idx on public.makeup_usage (user_id, used_at desc);

alter table public.makeup_usage enable row level security;
revoke all on public.makeup_usage from anon, authenticated;   -- aucune politique : aucun accès direct

create or replace function public.reserve_makeup(p_limit integer, p_window_seconds integer) returns jsonb
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
  if p_limit is null or p_limit < 0 or p_limit > 100 or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 31536000 then
    raise exception 'invalid parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('makeup:' || uid::text, 0));   -- verrou propre aux essayages : ne bloque ni les analyses ni les simulations

  delete from public.makeup_usage where user_id = uid and used_at < now() - interval '400 days';

  select count(*) into total from public.makeup_usage where user_id = uid;
  if total >= 2000 then
    return jsonb_build_object('ok', false, 'used', total, 'limit', p_limit, 'retry_after', 86400);
  end if;

  select count(*), min(used_at) into used, oldest
    from public.makeup_usage
   where user_id = uid and used_at > now() - make_interval(secs => p_window_seconds);

  if used >= p_limit then
    return jsonb_build_object('ok', false, 'used', used, 'limit', p_limit,
      'retry_after', greatest(1, ceil(extract(epoch from (coalesce(oldest, now()) + make_interval(secs => p_window_seconds) - now())))::integer));
  end if;

  insert into public.makeup_usage (user_id) values (uid);
  return jsonb_build_object('ok', true, 'used', used + 1, 'limit', p_limit);
end $$;

revoke all on function public.reserve_makeup(integer, integer) from public, anon;
grant execute on function public.reserve_makeup(integer, integer) to authenticated;
