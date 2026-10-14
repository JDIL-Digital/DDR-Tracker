-- 0032_revoke_anon_is_approved.sql
-- Follow-up to 0031: after 0031, is_approved()'s proacl STILL showed anon with
-- EXECUTE (anon=X), while is_admin() correctly lost anon. That means anon holds a
-- DIRECT execute grant on is_approved() (0008 granted it explicitly), not just the
-- inherited PUBLIC one — so 0031's "revoke ... from public" did not remove it. A
-- direct grant must be revoked from the role directly.
--
-- This migration explicitly revokes anon's DIRECT grant, re-asserts the
-- revoke-from-public for safety, and KEEPS execute for authenticated (MANDATORY —
-- is_approved() gates read access on every data table via RLS; dropping
-- authenticated would break all data reads). Idempotent / safe to re-run.
--
-- Reload the signed-in app immediately after applying and confirm an approved
-- non-admin user can still read data.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
-- NOT "JDIL-Navigation", before running.

begin;
revoke execute on function public.is_approved() from anon;
revoke execute on function public.is_approved() from public;
grant  execute on function public.is_approved() to authenticated;
commit;
