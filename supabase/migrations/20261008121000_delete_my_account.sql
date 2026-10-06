-- DERMAI : suppression de son propre compte.
-- Pourquoi une fonction : supprimer un utilisateur d'authentification (auth.users) exige un droit privilégié que le navigateur n'a pas.
-- Plutôt que d'ajouter une clé « service_role » à l'application (un secret très puissant à garder côté serveur), on expose UNE seule
-- opération, bornée par construction : « supprimer le compte de l'appelant ». L'identité vient exclusivement du jeton vérifié (auth.uid()) ;
-- la fonction n'accepte aucun paramètre : il est impossible de viser un autre compte.
-- La suppression de la ligne auth.users entraîne, par les clés étrangères déjà validées (ON DELETE CASCADE) : profil, analyses,
-- usage du quota, ainsi que les sessions et identités gérées par Supabase Auth.

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
