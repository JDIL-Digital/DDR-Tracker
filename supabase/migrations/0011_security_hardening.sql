-- 0011_security_hardening.sql
-- Addresses the security audit's real items. Additive; supersedes the
-- handle_new_user() from 0007 and tightens EXECUTE grants on the helper
-- functions. Idempotent + atomic. Run after 0001..0010.
--
--   M-1  enforce @jindalmumbai.com server-side (not just in the browser)
--   M-2  ensure_bootstrap_admin() no longer callable from the API
--   L-1  bootstrap_admin_email() no longer callable from the API (email disclosure)
--   L-2  handle_new_user() not directly callable; is_admin() no longer granted to anon

begin;

-- 1. M-1 — Domain enforcement in the DB -------------------------------------
-- Redefine the signup handler so any account whose email domain is NOT exactly
-- jindalmumbai.com (case-insensitive) is created as status='rejected'. A rejected
-- profile fails is_approved(), so RLS denies it all data regardless of the client.
-- (Alternative: `raise exception` to block the auth signup entirely — we use
-- 'rejected' instead so it flows into the app's existing "Access denied" screen
-- and doesn't risk aborting the GoTrue signup transaction.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_jindal boolean := lower(split_part(new.email, '@', 2)) = 'jindalmumbai.com';
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    case when v_is_jindal then 'pending' else 'rejected' end
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        -- keep a Jindal user's existing status; force any non-Jindal to rejected.
        status    = case when v_is_jindal then public.profiles.status else 'rejected' end;

  -- Re-assert the bootstrap admin (a Jindal address, so unaffected by the above).
  perform public.ensure_bootstrap_admin();
  return new;
end;
$$;
-- (No need to recreate the trigger: on_auth_user_created already points at this
--  function by name and now runs the new body.)

-- 2. M-2 / L-1 — Lock the definer helpers to trigger/migration use only ------
-- These are SECURITY DEFINER and were left callable by everyone (functions
-- default to PUBLIC execute). They must never be invoked from the browser via
-- supabase.rpc(). Revoking EXECUTE does NOT break them: handle_new_user() calls
-- ensure_bootstrap_admin() (which calls bootstrap_admin_email()) as the owner
-- (postgres), and the migration-time call runs as postgres too.
revoke execute on function public.ensure_bootstrap_admin() from public, anon, authenticated;
revoke execute on function public.bootstrap_admin_email()  from public, anon, authenticated;

-- 3. L-2 — Tighten the remaining grants -------------------------------------
-- handle_new_user() only ever runs as a trigger (and returns `trigger`, so it
-- isn't even REST-invocable) — remove the default PUBLIC execute. The trigger
-- keeps firing: EXECUTE is checked at CREATE TRIGGER time, not on each fire.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_admin() is evaluated inside the profiles RLS policies, which are `to
-- authenticated` only — anon never needs it. Drop the unnecessary anon grant
-- (0006 granted it to both); authenticated keeps EXECUTE so policies still work.
revoke execute on function public.is_admin() from anon;

commit;
