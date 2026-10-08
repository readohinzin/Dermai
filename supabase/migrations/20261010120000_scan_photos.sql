-- DERMAI : conservation des photos de scan, au choix de l'utilisatrice.
-- 1. profiles.keep_photos : null = pas encore demandé (la question est posée au premier résultat), true = garder les photos des
--    prochaines analyses, false = ne plus en garder (les photos déjà gardées restent, jusqu'à leur suppression par l'utilisatrice).
-- 2. Bucket Storage PRIVÉ `scan-photos` : un fichier JPEG par analyse, rangé dans le dossier de l'utilisatrice : `<user_id>/<id>.jpg`.
--    Lecture, ajout et suppression de ses propres fichiers seulement (le premier dossier du chemin doit être auth.uid()). Aucune
--    modification (une photo d'analyse est figée), aucun accès anonyme, aucun lien public : l'affichage passe par des liens signés
--    temporaires. Taille et type limités comme la photo envoyée à l'analyse (JPEG, 4 Mo).
-- Jamais conservés : masques de détection, réponse brute du fournisseur, task_id.
-- Suppression du compte : le Storage ne suit pas la suppression de auth.users ; l'application efface les photos AVANT de supprimer le
-- compte et annule la suppression si cela échoue.

alter table public.profiles add column if not exists keep_photos boolean;
comment on column public.profiles.keep_photos is 'Conservation des photos de scan : null = pas encore demandé, true = garder, false = ne plus garder.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-photos', 'scan-photos', false, 4194304, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists scan_photos_select_own on storage.objects;
drop policy if exists scan_photos_insert_own on storage.objects;
drop policy if exists scan_photos_delete_own on storage.objects;

create policy scan_photos_select_own on storage.objects
  for select to authenticated using (bucket_id = 'scan-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy scan_photos_insert_own on storage.objects
  for insert to authenticated with check (bucket_id = 'scan-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy scan_photos_delete_own on storage.objects
  for delete to authenticated using (bucket_id = 'scan-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
