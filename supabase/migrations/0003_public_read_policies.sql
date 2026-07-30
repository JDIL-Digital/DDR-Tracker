-- 0003_public_read_policies.sql
-- Let the front-end (anon / publishable key) READ the DDR tables for the local
-- dashboard. RLS stays ENABLED; these are SELECT-only policies. Writes remain
-- restricted to the server-side secret key (which bypasses RLS).
--
-- ⚠️ The publishable/anon key is embedded in the browser bundle and is public
-- once the app is deployed. Before go-live, add real authentication and tighten
-- these policies (e.g. per-role or per-rig access) instead of blanket read.

-- RLS on (no-op if already enabled)
alter table rigs        enable row level security;
alter table code_master enable row level security;
alter table reports     enable row level security;
alter table activities  enable row level security;
alter table inventory   enable row level security;

-- Table-level SELECT grants for the API roles
grant select on rigs, code_master, reports, activities, inventory to anon, authenticated;

-- Read-only policies (idempotent)
drop policy if exists "public read rigs" on rigs;
create policy "public read rigs" on rigs
  for select to anon, authenticated using (true);

drop policy if exists "public read code_master" on code_master;
create policy "public read code_master" on code_master
  for select to anon, authenticated using (true);

drop policy if exists "public read reports" on reports;
create policy "public read reports" on reports
  for select to anon, authenticated using (true);

drop policy if exists "public read activities" on activities;
create policy "public read activities" on activities
  for select to anon, authenticated using (true);

drop policy if exists "public read inventory" on inventory;
create policy "public read inventory" on inventory
  for select to anon, authenticated using (true);
