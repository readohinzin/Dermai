-- DERMAI : rawScore des analyses (étape 25).
-- Pourquoi : le moteur DERMAI décide sur le raw_score de Perfect Corp (mesure de l'analyse) et n'affiche que le ui_score (score ajusté
-- pour l'écran). Pour qu'une analyse relue depuis l'historique soit décidée comme le jour où elle a été faite, son raw_score est conservé.
-- Contenu : { <indicateur>: nombre de 0 à 100 }, seulement les 15 indicateurs connus, tels que reçus (jamais arrondis).
-- Toujours rien d'autre : NI photo, NI masque, NI URL, NI task_id, NI JSON brut du fournisseur.
-- Anciennes lignes : raw_metrics = {} (aucune valeur reconstruite) ; l'application les lit en mode de compatibilité.
-- L'application fonctionne aussi tant que cette migration n'est pas appliquée (elle réessaie alors sans la colonne).

create or replace function public.dermai_valid_raw_metrics(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(m) = 'object'
    and not exists (
      select 1 from jsonb_each(m) e
      where e.key <> all (array['acne','pores','oiliness','texture','hydration','redness','pigmentation','wrinkles','firmness','radiance',
                                'eyeBag','tearTrough','darkCircle','droopyUpperEyelid','droopyLowerEyelid']::text[])
         or jsonb_typeof(e.value) <> 'number'
         or (e.value #>> '{}')::numeric not between 0 and 100)
$$;

alter table public.skin_analyses add column if not exists raw_metrics jsonb not null default '{}'::jsonb;
alter table public.skin_analyses drop constraint if exists skin_analyses_raw_metrics_valid;
alter table public.skin_analyses add constraint skin_analyses_raw_metrics_valid check (public.dermai_valid_raw_metrics(raw_metrics));

comment on column public.skin_analyses.raw_metrics is 'raw_score Perfect Corp par indicateur (0-100, tel que reçu), lu par le moteur DERMAI pour décider. Jamais affiché.';
comment on table public.skin_analyses is 'Historique des analyses DERMAI : scores affichés 0-100 (100 = meilleur), raw_score par indicateur (décision seulement) et priorités à la date. Aucune photo, aucun masque, aucun task_id, aucun JSON brut.';

revoke all on function public.dermai_valid_raw_metrics(jsonb) from public;
grant execute on function public.dermai_valid_raw_metrics(jsonb) to authenticated;
