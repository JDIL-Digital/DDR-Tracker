-- 0030_lock_is_admin_grants.sql
-- Security-advisor fix (Tier-2): PUBLIC/anon have EXECUTE on public.is_admin().
--
-- is_admin() is SECURITY DEFINER and is called INSIDE the profiles RLS policies,
-- evaluated as the authenticated role. Functions get a default EXECUTE grant to
-- PUBLIC on creation (0006), and 0011's "revoke ... from anon" was ineffective
-- because anon still inherited EXECUTE via that PUBLIC grant.
--
-- revoke-from-PUBLIC strips the blanket grant — including authenticated's
-- INHERITED access — so the grant-to-authenticated in the SAME transaction is
-- MANDATORY: without it the profiles RLS policies can no longer call is_admin()
-- and profile read/update break for everyone. anon loses the direct-call ability
-- it never legitimately needs (the browser never calls is_admin() via rpc).
--
-- Apply 0030, test the signed-in app, THEN apply 0031. Safe to re-run.
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
-- NOT "JDIL-Navigation", before running.

begin;
revoke execute on function public.is_admin() from public;
grant  execute on function public.is_admin() to authenticated;
commit;
