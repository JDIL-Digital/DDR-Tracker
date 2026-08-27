-- 0017_allow_advisor.sql
-- Grant ORBIT access to ONE external email (advisor@jindaldrilling.in) as an
-- explicit allow-list exception — WITHOUT opening the whole jindaldrilling.in
-- domain. Supersedes handle_new_user() from 0011.
--
-- Rule change: an email is "allowed" if its domain is jindalmumbai.com OR it is
-- on the explicit allow-list. Allowed -> created 'pending' AND its status is
-- PRESERVED on the on-conflict (re-login) path, so an admin approval sticks
-- across logins. Anything else -> 'rejected' (unchanged from 0011). The
-- bootstrap-admin re-assert is kept. Idempotent + atomic.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker", NOT "JDIL-Navigation",
--    before running. Run after 0016. Keep this in sync with the client
--    ALLOWED_EMAILS list in src/auth/AuthProvider.jsx.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean :=
    lower(split_part(new.email, '@', 2)) = 'jindalmumbai.com'
    or lower(new.email) = lower('advisor@jindaldrilling.in');
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    case when v_allowed then 'pending' else 'rejected' end
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        -- allowed users keep their existing status (so approval persists);
        -- everyone else is forced back to 'rejected'.
        status    = case when v_allowed then public.profiles.status else 'rejected' end;

  -- Re-assert the bootstrap admin (a Jindal address, unaffected by the above).
  perform public.ensure_bootstrap_admin();
  return new;
end;
$$;

-- The on_auth_user_created trigger already points at handle_new_user() by name,
-- so replacing the body above is sufficient — no trigger recreation needed.

commit;
