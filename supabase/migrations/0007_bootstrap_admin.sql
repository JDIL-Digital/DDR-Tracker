-- 0007_bootstrap_admin.sql
-- Make the admin bootstrap idempotent and rebuild-proof.
--
-- GUARANTEE: akshay.manjramkar@jindalmumbai.com is ALWAYS role='admin',
-- status='approved' — case-insensitive — in every scenario:
--   * account already exists when this runs   -> promoted now
--   * account signs in later (fresh rebuild)   -> promoted by the signup trigger
--   * profile later demoted/rejected + re-run  -> restored
-- So a fresh DB rebuild or deploy can never lock the admin out.
--
-- Depends on 0006 (public.profiles + the on_auth_user_created trigger).
-- Safe to re-run any number of times.

begin;

-- Single source of truth for the bootstrap email (change here only, ever).
create or replace function public.bootstrap_admin_email()
returns text
language sql
immutable
as $$ select 'akshay.manjramkar@jindalmumbai.com' $$;

-- Idempotent promoter: for whichever auth.users row matches the bootstrap email
-- (case-insensitive), ensure a profiles row EXISTS and is admin + approved.
-- Handles both "profile missing" (insert) and "profile exists but wrong" (update).
create or replace function public.ensure_bootstrap_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status, approved_at)
  select u.id,
         u.email,
         coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
         'admin', 'approved', now()
  from auth.users u
  where lower(u.email) = lower(public.bootstrap_admin_email())
  on conflict (id) do update
    set role        = 'admin',
        status      = 'approved',
        approved_at = coalesce(public.profiles.approved_at, now());
end;
$$;

-- Run it now — covers "account already exists" at deploy / rebuild time.
select public.ensure_bootstrap_admin();

-- Re-assert on every new signup too — covers "signs in later". Replace the
-- signup handler so it (1) provisions every new user as pending/viewer, then
-- (2) re-runs the guarantee, which promotes the row if it's the bootstrap admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (id) do update
    set email     = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);

  perform public.ensure_bootstrap_admin();
  return new;
end;
$$;

-- Recreate the trigger defensively so it points at the updated function
-- (harmless / no-op if 0006's trigger is already identical).
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
