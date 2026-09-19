-- 0025_revoke_anon_grants.sql
-- Belt-and-suspenders (from Security review S2): REVOKE all table privileges from
-- the anon (unauthenticated / public publishable-key) role on every data table.
--
-- WHY: S2 found anon still holds table GRANTS (INSERT on all 13 tables; SELECT on 7;
-- DELETE on several) — today those are blocked only by RLS returning no rows / failing
-- the WITH CHECK. Removing the grants adds a second, independent lock: even a future
-- accidental over-permissive RLS policy could not expose or accept anon data, because
-- anon would lack the underlying privilege entirely.
--
-- SCOPE: ONLY the `anon` role loses privileges. The `authenticated` role (approved
-- users, gated by public.is_approved() in the existing RLS policies) and `service_role`
-- (the pipeline, via the secret key) are NOT named here and keep every grant + policy
-- they have. RLS itself is unchanged. No app behaviour changes: the dashboard reads as
-- `authenticated`, the pipeline writes as `service_role`; anon already sees nothing.
--
-- Idempotent: REVOKE of a privilege the role doesn't hold is a harmless no-op, so this
-- is safe to run once or re-run.

revoke all privileges on table public.rigs                    from anon;
revoke all privileges on table public.code_master             from anon;
revoke all privileges on table public.reports                 from anon;
revoke all privileges on table public.activities              from anon;
revoke all privileges on table public.inventory               from anon;
revoke all privileges on table public.benchmarks              from anon;
revoke all privileges on table public.maintenance_reports     from anon;
revoke all privileges on table public.maintenance_activities  from anon;
revoke all privileges on table public.well_plans              from anon;
revoke all privileges on table public.purchase_orders         from anon;
revoke all privileges on table public.opex_uploads            from anon;
revoke all privileges on table public.profiles                from anon;
revoke all privileges on table public.processed_emails        from anon;

-- NOTE: intentionally NOT touching `authenticated` or `service_role`, RLS policies,
-- storage.objects (already anon-locked), or the save_ddr_report function
-- (EXECUTE already not granted to anon — verified in S2).

-- Stop FUTURE new tables in schema public from auto-granting anon (Supabase's default
-- privileges GRANT ALL ON TABLES TO anon are why the grants existed in the first place).
-- Applies to tables created by the role that runs this statement (the migration owner);
-- future migrations run as that same owner will inherit this no-anon-grant default.
alter default privileges in schema public revoke all on tables from anon;

-- Verify after running (should return ZERO rows):
--   select table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public';
