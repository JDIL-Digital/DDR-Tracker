-- 0031_lock_is_approved_grants.sql
-- Security-advisor fix (Tier-2): PUBLIC/anon have EXECUTE on public.is_approved().
--
-- is_approved() is SECURITY DEFINER and gates READ access on EVERY data table
-- (rigs, code_master, reports, activities, inventory, benchmarks, maintenance_*,
-- opex_uploads, purchase_orders) via their RLS policies, evaluated as the
-- authenticated role. 0008 granted it to authenticated but never revoked the
-- default PUBLIC grant, so PUBLIC (incl. anon) can still call it.
--
-- Same atomicity rule as 0030: revoke-from-PUBLIC strips authenticated's
-- INHERITED grant, so the grant-to-authenticated MUST be in the SAME transaction
-- or EVERY data read breaks. This is the HIGHEST-blast-radius change of the set —
-- reload the signed-in app IMMEDIATELY after applying and confirm an approved
-- non-admin user can still read data.
--
-- Apply AFTER 0030 has been tested. Safe to re-run.
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
-- NOT "JDIL-Navigation", before running.

begin;
revoke execute on function public.is_approved() from public;
grant  execute on function public.is_approved() to authenticated;
commit;
