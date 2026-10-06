-- DERMAI : historique des analyses de peau (scores seulement), base de la progression.
-- Une ligne = « ce que DERMAI a mesuré et recommandé à cette date ». Elle n'est jamais recalculée : une ancienne analyse reste telle quelle
-- (les règles futures du moteur ne la modifient pas ; engine_version dit avec quelles règles elle a été produite).
-- Ne stocke NI photo, NI selfie, NI masque, NI URL, NI task_id du fournisseur, NI JSON brut, NI rawScore, NI jeton ou clé.
-- Les scores sont ceux affichés à l'utilisateur : entiers de 0 à 100, 100 = meilleur résultat (uiScore et score global).
-- Sécurité : RLS activée ; chaque utilisateur ne lit, n'ajoute et ne supprime que ses propres lignes. Aucune modification (une analyse
-- enregistrée est figée). L'identité vient du jeton (auth.uid()), jamais d'une valeur envoyée par le navigateur.

-- Les 15 indicateurs DERMAI (mêmes clés que js/skin-model.js, METRICS).
create or replace function public.dermai_valid_score(v jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(v)
    when 'null' then true
    when 'number' then (v #>> '{}')::numeric between 0 and 100 and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
    else false end
$$;

create or replace function public.dermai_valid_metrics(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(m) = 'object'
    and not exists (
      select 1 from jsonb_each(m) e
      where e.key <> all (array['acne','pores','oiliness','texture','hydration','redness','pigmentation','wrinkles','firmness','radiance',
                                'eyeBag','tearTrough','darkCircle','droopyUpperEyelid','droopyLowerEyelid']::text[])
         or not public.dermai_valid_score(e.value))
$$;

-- Priorités calculées à la date de l'analyse, pour l'affichage historique : liste ordonnée de { id, label, score, band } (15 au plus),
-- aucun autre champ. `score` = uiScore affiché (0 à 100, 100 = meilleur), `band` = bande d'affichage (good | mid | low).
create or replace function public.dermai_valid_priorities(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 15
    and not exists (
      select 1 from jsonb_array_elements(p) e
      where jsonb_typeof(e.value) <> 'object'
         or exists (select 1 from jsonb_object_keys(e.value) k where k <> all (array['id','label','score','band']::text[]))
         or coalesce(e.value ->> 'id', '') <> all (array['acne','pores','oiliness','texture','hydration','redness','pigmentation','wrinkles','firmness','radiance',
                                                         'eyeBag','tearTrough','darkCircle','droopyUpperEyelid','droopyLowerEyelid']::text[])
         or jsonb_typeof(e.value -> 'label') is distinct from 'string'
         or char_length(e.value ->> 'label') not between 1 and 60
         or not public.dermai_valid_score(coalesce(e.value -> 'score', 'null'::jsonb))
         or (e.value -> 'band' is not null and jsonb_typeof(e.value -> 'band') <> 'null'
             and (jsonb_typeof(e.value -> 'band') <> 'string' or (e.value ->> 'band') <> all (array['good','mid','low']::text[]))))
$$;

create table if not exists public.skin_analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  analyzed_at    timestamptz not null default now(),
  global_score   smallint,
  skin_type      text,
  skin_age       smallint,
  metrics        jsonb not null,
  priorities     jsonb not null default '[]'::jsonb,
  goals_snapshot text[] not null default '{}',
  engine_version text not null,
  created_at     timestamptz not null default now(),
  constraint skin_analyses_global_score_range check (global_score is null or global_score between 0 and 100),
  constraint skin_analyses_skin_type_short check (skin_type is null or char_length(skin_type) between 1 and 40),
  constraint skin_analyses_skin_age_range check (skin_age is null or skin_age between 1 and 120),
  constraint skin_analyses_metrics_valid check (public.dermai_valid_metrics(metrics)),
  constraint skin_analyses_priorities_valid check (public.dermai_valid_priorities(priorities)),
  constraint skin_analyses_goals_max3 check (cardinality(goals_snapshot) <= 3),
  constraint skin_analyses_goals_known check (goals_snapshot <@ array['hydration','oil_pores','blemishes','tone','redness_comfort','texture','aging','maintenance']::text[]),
  constraint skin_analyses_engine_version_short check (char_length(engine_version) between 1 and 40)
);

comment on table public.skin_analyses is 'Historique des analyses DERMAI : scores 0-100 (100 = meilleur) et priorités à la date. Aucune photo, aucun masque, aucun task_id, aucun JSON brut, aucun rawScore.';

create index if not exists skin_analyses_user_date_idx on public.skin_analyses (user_id, analyzed_at desc);

-- Date de l'analyse : celle envoyée par l'application (utile si l'enregistrement est repris plus tard) mais jamais dans le futur ni plus
-- ancienne qu'un jour : on ne peut pas antidater un historique. Plafond de volume par compte (protection contre un remplissage abusif).
create or replace function public.skin_analyses_before_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.analyzed_at is null or new.analyzed_at > now() or new.analyzed_at < now() - interval '1 day' then
    new.analyzed_at := now();
  end if;
  if (select count(*) from public.skin_analyses where user_id = new.user_id) >= 1000 then
    raise exception 'analysis history limit reached' using errcode = '54000';
  end if;
  return new;
end $$;

create trigger skin_analyses_before_insert before insert on public.skin_analyses
  for each row execute function public.skin_analyses_before_insert();

alter table public.skin_analyses enable row level security;

-- Aucun accès anonyme. Lecture, ajout et suppression de ses propres analyses ; jamais de modification.
revoke all on public.skin_analyses from anon, authenticated;
grant select, insert, delete on public.skin_analyses to authenticated;
revoke all on function public.dermai_valid_score(jsonb), public.dermai_valid_metrics(jsonb), public.dermai_valid_priorities(jsonb) from public;
grant execute on function public.dermai_valid_score(jsonb), public.dermai_valid_metrics(jsonb), public.dermai_valid_priorities(jsonb) to authenticated;

create policy skin_analyses_select_own on public.skin_analyses
  for select to authenticated using (user_id = auth.uid());
create policy skin_analyses_insert_own on public.skin_analyses
  for insert to authenticated with check (user_id = auth.uid());
create policy skin_analyses_delete_own on public.skin_analyses
  for delete to authenticated using (user_id = auth.uid());
