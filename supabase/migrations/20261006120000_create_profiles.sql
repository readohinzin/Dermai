-- DERMAI : profil utilisateur persistant (préférences de personnalisation uniquement).
-- Ne stocke ni photo, ni masque, ni identifiant de tâche, ni donnée brute du fournisseur d'analyse, ni donnée de santé.
-- Sécurité : RLS activée ; chaque utilisateur ne lit et ne modifie que sa propre ligne. L'identité vient du jeton d'authentification
-- (auth.uid()), jamais d'une valeur fournie par le navigateur.

create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique default auth.uid() references auth.users (id) on delete cascade,
  goals         text[] not null default '{}',
  routine_level text,
  prefer_gentle boolean not null default false,
  exclusions    text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Objectifs optionnels, trois au maximum, identifiants connus du moteur (jamais de valeur libre).
  constraint profiles_goals_max3 check (cardinality(goals) <= 3),
  constraint profiles_goals_known check (goals <@ array['hydration','oil_pores','blemishes','tone','redness_comfort','texture','aging','maintenance']::text[]),
  -- null = pas encore choisi (le moteur applique alors son niveau neutre).
  constraint profiles_level_known check (routine_level is null or routine_level in ('none','simple','full')),
  constraint profiles_exclusions_max check (cardinality(exclusions) <= 20)
);

comment on table public.profiles is 'Préférences de personnalisation DERMAI. Aucune photo, aucun masque, aucun task_id.';

alter table public.profiles enable row level security;

-- Aucun accès anonyme ; accès authentifié limité aux opérations nécessaires (pas de suppression directe : elle suit le compte).
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = auth.uid());
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.profiles_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch_updated_at before update on public.profiles
  for each row execute function public.profiles_touch_updated_at();

-- Profil créé à l'inscription, avec des valeurs neutres : aucun objectif pré-coché.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
