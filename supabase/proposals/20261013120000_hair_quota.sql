-- PROPOSITION, NON APPLIQUÉE : ce fichier n'est volontairement PAS dans supabase/migrations/ : il ne doit être exécuté qu'après autorisation explicite.
--
-- DERMAI : quota des ESSAIS CAPILLAIRES (Studio Beauté : coiffure, couleur, extensions, franges, ondulations, volume), distinct du quota d'analyses, de celui des simulations
-- et de celui du maquillage. Compté en UNITÉS Perfect Corp documentées (coiffure et volume : 2, les autres : 1), pas en nombre de tâches : une coiffure pèse deux fois une
-- couleur. Une ligne = une réservation, avec son poids (units). Sans cette fonction, les essais capillaires sont refusés (échec fermé : le serveur reçoit 404 et répond
-- « indisponible ») : appliquer ce fichier ne suffit pas à les ouvrir, DERMAI_HAIR_ENABLED et DERMAI_HAIR_ALLOWED_USER_IDS restent nécessaires.
--
-- Même modèle que supabase/proposals/20261012120000_makeup_quota.sql : table fermée (RLS sans politique, aucun droit direct), fonction security definer qui n'utilise que
-- auth.uid() (identité du jeton vérifié), verrou consultatif par utilisateur, paramètres bornés, ménage à 400 jours, plafond de 2000 lignes par compte. Rien n'est jamais
-- remboursé : une demande qui a atteint le fournisseur compte, quel que soit son résultat. Refus : used + p_units > p_limit ; retry_after = délai avant que la plus
-- ancienne réservation de la fenêtre n'expire (au plus tôt, la capacité peut ne pas suffire alors). La suppression du compte emporte ces lignes (ON DELETE CASCADE).

create table if not exists public.hair_usage (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  used_at timestamptz not null default now(),
  units   integer not null check (units between 1 and 10)
);
comment on table public.hair_usage is 'Essais capillaires réservés par utilisateur (quota en unités). Ni photo, ni image, ni donnée du fournisseur.';
create index if not exists hair_usage_user_used_idx on public.hair_usage (user_id, used_at desc);

alter table public.hair_usage enable row level security;
revoke all on public.hair_usage from anon, authenticated;   -- aucune politique : aucun accès direct

create or replace function public.reserve_hair(p_limit integer, p_window_seconds integer, p_units integer) returns jsonb
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
  if p_limit is null or p_limit < 0 or p_limit > 100 or p_window_seconds is null or p_window_seconds < 60 or p_window_seconds > 31536000
     or p_units is null or p_units < 1 or p_units > 10 then
    raise exception 'invalid parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('hair:' || uid::text, 0));   -- verrou propre aux essais capillaires : ne bloque ni les analyses, ni les simulations, ni le maquillage

  delete from public.hair_usage where user_id = uid and used_at < now() - interval '400 days';

  select count(*) into total from public.hair_usage where user_id = uid;
  if total >= 2000 then
    return jsonb_build_object('ok', false, 'used', total, 'limit', p_limit, 'retry_after', 86400);
  end if;

  select coalesce(sum(units), 0), min(used_at) into used, oldest
    from public.hair_usage
   where user_id = uid and used_at > now() - make_interval(secs => p_window_seconds);

  if used + p_units > p_limit then
    return jsonb_build_object('ok', false, 'used', used, 'limit', p_limit,
      'retry_after', greatest(1, ceil(extract(epoch from (coalesce(oldest, now()) + make_interval(secs => p_window_seconds) - now())))::integer));
  end if;

  insert into public.hair_usage (user_id, units) values (uid, p_units);
  return jsonb_build_object('ok', true, 'used', used + p_units, 'limit', p_limit);
end $$;

revoke all on function public.reserve_hair(integer, integer, integer) from public, anon;
grant execute on function public.reserve_hair(integer, integer, integer) to authenticated;
