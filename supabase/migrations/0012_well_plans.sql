-- 0012_well_plans.sql
-- Well Plan feature — Stage 1: store the uploaded plan file + metadata. No
-- extraction yet. Adds the well_plans table, its RLS, a private Storage bucket
-- for the files, and Storage RLS. Run after 0001..0011. Idempotent + atomic.
--
-- ⚠️ WRITE-MODEL NOTE (please read before running):
--   Every other table's writes are service-role-only (the browser is read-only).
--   This feature's upload happens IN THE BROWSER (Settings → Well Plans) and there
--   is no server endpoint in Stage 1, so the browser is allowed to write — but
--   locked tightly:
--     * WRITES (well_plans INSERT + Storage upload) -> approved ADMINS only  (is_admin())
--     * READS  (well_plans SELECT + Storage read)   -> any approved user      (is_approved())
--     * UPDATE/DELETE                                -> no policy (service-role only)
--   anon is excluded everywhere. is_admin() already means approved AND role='admin'.

begin;

-- 1. Table --------------------------------------------------------------------
create table if not exists public.well_plans (
  id                 uuid primary key default gen_random_uuid(),
  rig_id             uuid references public.rigs(id),
  well_name          text,
  well_type          text check (well_type in ('exploratory','workover','sidetrack')),
  target_depth_m     numeric,
  planned_milestones jsonb,   -- later: [{step, description, planned_days, cumulative_days}]
  well_history       text,    -- later: reference text from the plan doc
  source_file_path   text,    -- path in the 'well-plans' Storage bucket
  source_file_name   text,
  extraction_status  text not null default 'uploaded'
                     check (extraction_status in ('uploaded','extracted','needs_review','failed')),
  uploaded_by        uuid,
  created_at         timestamptz not null default now(),
  raw_extract        jsonb    -- later: full extractor output
);

-- 2. RLS ----------------------------------------------------------------------
alter table public.well_plans enable row level security;
-- Approved users may read; only admins may insert; no update/delete grant → those
-- stay service-role only (which bypasses RLS) for later extraction/edits.
grant select, insert on public.well_plans to authenticated;

drop policy if exists "approved read well_plans" on public.well_plans;
create policy "approved read well_plans" on public.well_plans
  for select to authenticated using (public.is_approved());

drop policy if exists "approved insert well_plans" on public.well_plans;
drop policy if exists "admin insert well_plans" on public.well_plans;
create policy "admin insert well_plans" on public.well_plans
  for insert to authenticated with check (public.is_admin());

-- 3. Storage bucket (private) -------------------------------------------------
-- Reference for the plan files. If this INSERT errors on permissions in the SQL
-- editor, create the bucket instead via Dashboard → Storage → New bucket:
-- name "well-plans", Public = OFF.
insert into storage.buckets (id, name, public)
values ('well-plans', 'well-plans', false)
on conflict (id) do nothing;

-- 4. Storage RLS --------------------------------------------------------------
-- Read: any approved user, in this bucket only. Upload: admins only.
-- (If these CREATE POLICY statements error on ownership in the SQL editor, add
--  the equivalent policies via Dashboard → Storage → Policies instead.)
drop policy if exists "well-plans read" on storage.objects;
create policy "well-plans read" on storage.objects
  for select to authenticated
  using (bucket_id = 'well-plans' and public.is_approved());

drop policy if exists "well-plans upload" on storage.objects;
create policy "well-plans upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'well-plans' and public.is_admin());

commit;
