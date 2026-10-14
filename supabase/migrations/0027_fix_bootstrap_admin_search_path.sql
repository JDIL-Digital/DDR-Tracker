-- 0027_fix_bootstrap_admin_search_path.sql
-- Security-advisor fix (Tier-2): "Function Search Path Mutable" on
-- public.bootstrap_admin_email().
--
-- The function (0007) returns a STRING LITERAL and references NO database
-- objects, so search_path has zero effect on its behavior — this change is
-- purely to satisfy the linter and is a ZERO behavior change. The function is
-- already locked to the owner (0011 revoked execute from public/anon/
-- authenticated), so nothing in the app or RLS calls it directly.
--
-- Safe to re-run. ⚠️ Confirm the Supabase project is "DDR-Tracker"
-- (edrmbzcqffatjnommfcc), NOT "JDIL-Navigation", before running.

alter function public.bootstrap_admin_email() set search_path = '';
