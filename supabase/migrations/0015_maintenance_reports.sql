-- 0015_maintenance_reports.sql
-- DMR (Daily Maintenance Report) feature — Stage 1: store an uploaded DMR (.docx)
-- + its extracted, department-wise maintenance activities.
--
-- WRITE MODEL (matches well_plans, 0012/0013): the upload happens IN THE BROWSER
-- (Maintenance tab) with no server endpoint yet, so the browser may write — but
-- tightly gated:
--   * WRITES (insert/update/delete on both tables, Storage upload/delete) -> approved ADMINS only
--   * READS  (select on both tables, Storage read)                         -> any approved user
--   * anon excluded everywhere. is_admin() = approved AND role='admin'.
-- The service-role extractor (scripts/extract-dmr.js) bypasses RLS to write rows.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker", NOT "JDIL-Navigation",
--    before running this in the SQL editor. Run after 0014. Idempotent + atomic.

begin;

-- 1. Reports table -----------------------------------------------------------
create table if not exists public.maintenance_reports (
  id                 uuid primary key default gen_random_uuid(),
  rig_id             uuid references public.rigs(id),
  report_date        date,
  source_file_path   text,   -- path in the 'maintenance-reports' Storage bucket
  source_file_name   text,
  extraction_status  text not null default 'uploaded'
                     check (extraction_status in ('uploaded','extracted','needs_review','failed')),
  raw_extract        jsonb,  -- full extractor output (audit / re-render)
  uploaded_by        uuid,
  created_at         timestamptz not null default now(),
  -- one report per rig per day (idempotent re-upload / re-extract)
  unique (rig_id, report_date)
);

-- 2. Activities table (department-wise, one row per activity) -----------------
create table if not exists public.maintenance_activities (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references public.maintenance_reports(id) on delete cascade,
  department     text,   -- Barge | Electrical | Mechanical | HSE | other
  chief_in_charge text,
  activity_text  text,
  activity_kind  text check (activity_kind in ('last_day','planned')),
  -- status applies to last_day items; planned items leave it null
  status         text check (status in ('completed','pending','routine')),
  created_at     timestamptz not null default now()
);
create index if not exists maintenance_activities_report_idx
  on public.maintenance_activities(report_id);

-- 3. RLS ---------------------------------------------------------------------
alter table public.maintenance_reports enable row level security;
alter table public.maintenance_activities enable row level security;

grant select, insert, update, delete on public.maintenance_reports to authenticated;
grant select, insert, update, delete on public.maintenance_activities to authenticated;

-- maintenance_reports: approved read, admin write.
drop policy if exists "approved read maint_reports" on public.maintenance_reports;
create policy "approved read maint_reports" on public.maintenance_reports
  for select to authenticated using (public.is_approved());
drop policy if exists "admin insert maint_reports" on public.maintenance_reports;
create policy "admin insert maint_reports" on public.maintenance_reports
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admin update maint_reports" on public.maintenance_reports;
create policy "admin update maint_reports" on public.maintenance_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete maint_reports" on public.maintenance_reports;
create policy "admin delete maint_reports" on public.maintenance_reports
  for delete to authenticated using (public.is_admin());

-- maintenance_activities: approved read, admin write (incl. status edits).
drop policy if exists "approved read maint_acts" on public.maintenance_activities;
create policy "approved read maint_acts" on public.maintenance_activities
  for select to authenticated using (public.is_approved());
drop policy if exists "admin insert maint_acts" on public.maintenance_activities;
create policy "admin insert maint_acts" on public.maintenance_activities
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admin update maint_acts" on public.maintenance_activities;
create policy "admin update maint_acts" on public.maintenance_activities
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete maint_acts" on public.maintenance_activities;
create policy "admin delete maint_acts" on public.maintenance_activities
  for delete to authenticated using (public.is_admin());

-- 4. Storage bucket (private) ------------------------------------------------
-- New dedicated bucket for DMR files. If this INSERT errors on permissions in
-- the SQL editor, create it via Dashboard → Storage → New bucket:
-- name "maintenance-reports", Public = OFF.
insert into storage.buckets (id, name, public)
values ('maintenance-reports', 'maintenance-reports', false)
on conflict (id) do nothing;

-- 5. Storage RLS -------------------------------------------------------------
-- Read: any approved user; upload/delete: admins only — this bucket only.
drop policy if exists "maintenance-reports read" on storage.objects;
create policy "maintenance-reports read" on storage.objects
  for select to authenticated
  using (bucket_id = 'maintenance-reports' and public.is_approved());
drop policy if exists "maintenance-reports upload" on storage.objects;
create policy "maintenance-reports upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'maintenance-reports' and public.is_admin());
drop policy if exists "maintenance-reports delete" on storage.objects;
create policy "maintenance-reports delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'maintenance-reports' and public.is_admin());

commit;
