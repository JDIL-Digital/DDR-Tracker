-- 0024_drilling_reports_bucket.sql
-- Storage bucket for raw DDR (Daily Drilling Report) .xlsx files, mirroring the
-- maintenance-reports bucket (0015).
--
-- WRITE MODEL: the DDR ingest pipeline (scripts/ingest-ddr.js) uploads with the
-- SERVICE ROLE (secret key), which BYPASSES RLS — so no write policy is needed
-- for the pipeline. The policies below govern BROWSER (authenticated) access:
--   * READ  (select)         -> any approved user
--   * WRITE (insert/delete)  -> admins only
--   * anon excluded everywhere.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc), NOT
--    "JDIL-Navigation", before running this. Idempotent. Run after 0023.

begin;

-- 1. Private bucket. If this INSERT errors on permissions in the SQL editor,
--    create it via Dashboard → Storage → New bucket: name "drilling-reports",
--    Public = OFF, then re-run (the policies below are the important part).
insert into storage.buckets (id, name, public)
values ('drilling-reports', 'drilling-reports', false)
on conflict (id) do nothing;

-- 2. Storage RLS — read: any approved user; upload/delete: admins only; this bucket only.
drop policy if exists "drilling-reports read" on storage.objects;
create policy "drilling-reports read" on storage.objects
  for select to authenticated
  using (bucket_id = 'drilling-reports' and public.is_approved());

drop policy if exists "drilling-reports upload" on storage.objects;
create policy "drilling-reports upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drilling-reports' and public.is_admin());

drop policy if exists "drilling-reports delete" on storage.objects;
create policy "drilling-reports delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'drilling-reports' and public.is_admin());

commit;
