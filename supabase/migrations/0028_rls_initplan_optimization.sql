-- 0028_rls_initplan_optimization.sql
-- Security-advisor fix (Tier-2): "Auth RLS Init Plan" on profiles + opex_uploads.
--
-- The flagged policies call auth.uid() / is_admin() / is_approved() DIRECTLY in
-- their predicates, so Postgres re-evaluates them once PER ROW. Wrapping each in
-- a scalar subquery — (select auth.uid()) etc. — makes Postgres compute it ONCE
-- per statement (an InitPlan). This is Supabase's recommended optimization and is
-- VALUE-IDENTICAL: it changes performance only, never WHO can access WHAT.
--
-- Each predicate below is transcribed VERBATIM from the migration that created
-- the policy (0006 profiles, 0018/0019 opex_uploads); only the function calls are
-- wrapped in (select ...). ALTER POLICY is used (not drop/recreate) so there is
-- no window in which the policy is absent.
--
-- Safe to re-run (ALTER POLICY just resets the predicate to the same optimized
-- form). ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
-- NOT "JDIL-Navigation", before running.

begin;

-- profiles --------------------------------------------------------------------
-- 0006: for select to authenticated using (id = auth.uid() or public.is_admin())
alter policy "profiles read own or admin" on public.profiles
  using (id = (select auth.uid()) or (select public.is_admin()));

-- 0006: for update to authenticated using (public.is_admin()) with check (public.is_admin())
alter policy "profiles admin update" on public.profiles
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- opex_uploads ----------------------------------------------------------------
-- 0018: for select to authenticated using (public.is_approved())
alter policy "approved read opex_uploads" on public.opex_uploads
  using ((select public.is_approved()));

-- 0018: for insert to authenticated with check (public.is_approved())
alter policy "approved insert opex_uploads" on public.opex_uploads
  with check ((select public.is_approved()));

-- 0019: for delete to authenticated using (public.is_approved() and uploaded_by = auth.uid())
alter policy "owner delete opex_uploads" on public.opex_uploads
  using ((select public.is_approved()) and uploaded_by = (select auth.uid()));

commit;
