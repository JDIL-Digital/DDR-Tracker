-- 0008_rls_lockdown.sql
-- Close the temporary public/anon read access (0003 + 0005 benchmarks) and
-- replace it with: read ONLY for authenticated users who have an APPROVED
-- profile. Writes stay off the browser entirely — the server-side pipeline uses
-- the service-role key, which bypasses RLS.
--
-- After this runs:
--   * logged-in + approved -> can read all data tables
--   * logged-in + pending  -> reads return ZERO rows (DB-enforced, not just UI)
--   * anon / not logged in  -> no access to any data table
--   * own profile row       -> still readable by any authenticated user (so the
--                              app can discover its own pending/approved status)
--
-- Depends on 0006 (public.profiles). Wrapped in a transaction; safe to re-run.

begin;

-- 1. Helper: is the current user an APPROVED profile? ------------------------
-- SECURITY DEFINER (owned by postgres, the profiles owner) so it reads profiles
-- WITHOUT triggering profiles' own RLS -> no recursion. Returns false for anon
-- (auth.uid() is null) and for pending/rejected users.
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved'
  );
$$;
grant execute on function public.is_approved() to authenticated;

-- 2. Drop the temporary public/anon read policies ---------------------------
drop policy if exists "public read rigs"        on public.rigs;
drop policy if exists "public read code_master" on public.code_master;
drop policy if exists "public read reports"     on public.reports;
drop policy if exists "public read activities"  on public.activities;
drop policy if exists "public read inventory"   on public.inventory;
drop policy if exists "public read benchmarks"  on public.benchmarks;

-- 3. Table privileges: revoke anon, keep authenticated ----------------------
-- RLS already blocks anon (no anon policy below), but revoking the table-level
-- grant is defense-in-depth: anon can't touch these tables at all.
revoke select on
  public.rigs, public.code_master, public.reports,
  public.activities, public.inventory, public.benchmarks
from anon;

-- authenticated keeps the base SELECT privilege; the policies gate WHICH rows.
grant select on
  public.rigs, public.code_master, public.reports,
  public.activities, public.inventory, public.benchmarks
to authenticated;

-- 4. RLS on (no-op if already enabled) + approved-only SELECT policies -------
alter table public.rigs        enable row level security;
alter table public.code_master enable row level security;
alter table public.reports     enable row level security;
alter table public.activities  enable row level security;
alter table public.inventory   enable row level security;
alter table public.benchmarks  enable row level security;

drop policy if exists "approved read rigs" on public.rigs;
create policy "approved read rigs" on public.rigs
  for select to authenticated using (public.is_approved());

drop policy if exists "approved read code_master" on public.code_master;
create policy "approved read code_master" on public.code_master
  for select to authenticated using (public.is_approved());

drop policy if exists "approved read reports" on public.reports;
create policy "approved read reports" on public.reports
  for select to authenticated using (public.is_approved());

drop policy if exists "approved read activities" on public.activities;
create policy "approved read activities" on public.activities
  for select to authenticated using (public.is_approved());

drop policy if exists "approved read inventory" on public.inventory;
create policy "approved read inventory" on public.inventory
  for select to authenticated using (public.is_approved());

drop policy if exists "approved read benchmarks" on public.benchmarks;
create policy "approved read benchmarks" on public.benchmarks
  for select to authenticated using (public.is_approved());

-- 5. No write policies on data tables — INSERT/UPDATE/DELETE stay closed to
--    anon + authenticated. Only the service-role key (server pipeline) writes,
--    and it bypasses RLS. (profiles' own read/update policies from 0006 are
--    untouched: a user can always read their OWN row; admins read/update all.)

commit;
