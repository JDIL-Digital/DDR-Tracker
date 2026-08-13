-- 0006_profiles.sql
-- Admin-approval gate on top of the existing Google auth (jindalmumbai.com only).
-- Adds a `profiles` table (one row per auth user), an auto-provision trigger on
-- signup, a bootstrap admin, and RLS so users see only their own profile while
-- admins can see/approve everyone.
--
-- Roles:   admin | viewer          Status: pending | approved | rejected
-- Bootstrap admin (always admin+approved): Akshay.Manjramkar@jindalmumbai.com
--
-- Idempotent + atomic: wrapped in a transaction; safe to re-run.

begin;

-- 1. Table -------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'viewer'  check (role   in ('admin','viewer')),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid
);

-- 2. Admin check helper ------------------------------------------------------
-- SECURITY DEFINER (owned by postgres, the table owner) so it reads profiles
-- WITHOUT triggering the RLS policies below — this avoids infinite recursion
-- (an RLS policy on profiles that needs to look at profiles to decide access).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved'
  );
$$;

-- 3. RLS ---------------------------------------------------------------------
alter table public.profiles enable row level security;
grant select, update on public.profiles to authenticated;
grant execute on function public.is_admin() to authenticated, anon;

-- Read: your own row, OR any row if you are an approved admin.
drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Update: ONLY approved admins, and they may update any row. Viewers cannot
-- update anything (so a viewer can never approve themselves or others).
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT/DELETE policy on purpose: rows are created by the signup trigger
-- (SECURITY DEFINER, below), never directly by the browser client.

-- 4. Auto-provision a profile on signup -------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_bootstrap boolean := lower(new.email) = lower('Akshay.Manjramkar@jindalmumbai.com');
begin
  insert into public.profiles (id, email, full_name, role, status, approved_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    case when is_bootstrap then 'admin'    else 'viewer'  end,
    case when is_bootstrap then 'approved' else 'pending' end,
    case when is_bootstrap then now()      else null      end
  )
  on conflict (id) do update set
    email     = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    -- Only the bootstrap admin is force-promoted; everyone else keeps their row.
    role      = case when is_bootstrap then 'admin'    else public.profiles.role   end,
    status    = case when is_bootstrap then 'approved' else public.profiles.status end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. Backfill existing auth users -------------------------------------------
-- The trigger only fires for NEW signups, so anyone who already logged in has no
-- profile yet. Give them the default pending/viewer row (do nothing if present).
insert into public.profiles (id, email, full_name)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
from auth.users u
on conflict (id) do nothing;

-- 6. Bootstrap admin ---------------------------------------------------------
-- Force Akshay to admin+approved whether the row was just backfilled or already
-- existed. (If the user has never signed in yet, this matches zero rows and the
-- trigger's is_bootstrap branch will promote them on first signup.)
update public.profiles p
set role = 'admin', status = 'approved', approved_at = coalesce(p.approved_at, now())
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('Akshay.Manjramkar@jindalmumbai.com');

commit;
