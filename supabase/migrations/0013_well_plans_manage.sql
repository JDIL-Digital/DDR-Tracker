-- 0013_well_plans_manage.sql
-- Well Plans management: let admins EDIT and DELETE plans (row + stored file).
-- Reads stay any-approved-user; writes/edits/deletes stay admins only, matching
-- 0012. Run after 0012. Idempotent + atomic.

begin;

-- Table privileges: authenticated may attempt update/delete; RLS gates to admins.
grant update, delete on public.well_plans to authenticated;

-- UPDATE — admins only (edit rig / well_name / well_type metadata).
drop policy if exists "admin update well_plans" on public.well_plans;
create policy "admin update well_plans" on public.well_plans
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- DELETE — admins only.
drop policy if exists "admin delete well_plans" on public.well_plans;
create policy "admin delete well_plans" on public.well_plans
  for delete to authenticated
  using (public.is_admin());

-- Storage DELETE — admins only, in the 'well-plans' bucket only, so removing a
-- plan can also remove its file (no orphaned Storage object).
-- (If this errors on ownership in the SQL editor, add it via Dashboard → Storage
--  → Policies instead.)
drop policy if exists "well-plans delete" on storage.objects;
create policy "well-plans delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'well-plans' and public.is_admin());

commit;
