-- 0033_run_log.sql
-- Scheduler heartbeat / job-log table. Each scheduled pipeline run (ingest-ddr,
-- ingest-dmr, and a future heartbeat-check) writes ONE row here — unconditionally,
-- whether it saved reports, found nothing, or errored. This gives a durable
-- "did today's run actually happen, and how did it go?" signal that the existing
-- processed_emails / reports rows can't provide (those are silent on a quiet day
-- or a dead scheduler). A failure alert can key off the absence of a recent
-- 'success'/'empty' row for a job, or the presence of an 'error' row.
--
-- WRITE MODEL: rows are written by the scheduler using the service_role key, which
-- bypasses RLS. No browser/authenticated INSERT path (and none needed). READS are
-- gated to approved users so the log can surface on a dashboard later.
--
-- status: 'success' (ran, saved >=1 report) | 'empty' (ran, nothing new to save)
--         | 'error' (ran, failed — see error_message/details).
--
-- Follows the same lockdown pattern as every other table (0008/0015/0018): RLS on,
-- approved-only SELECT, anon explicitly revoked (0025's default-privileges revoke
-- already covers anon on new tables; the explicit revoke below is belt-and-braces).
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
--    NOT "JDIL-Navigation", before running. Idempotent + atomic; safe to re-run.

begin;

-- 1. Table -------------------------------------------------------------------
create table if not exists public.run_log (
  id            uuid primary key default gen_random_uuid(),
  job           text not null,          -- 'ingest-ddr' | 'ingest-dmr' | 'heartbeat-check' | ...
  status        text not null,          -- 'success' | 'empty' | 'error'
  started_at    timestamptz,
  finished_at   timestamptz default now(),
  emails_found  int,
  reports_saved int,
  error_message text,
  details       jsonb                   -- optional extra context (per-rig counts, etc.)
);

-- 2. Indexes for the "did a run happen today?" queries -----------------------
create index if not exists run_log_finished_at_idx on public.run_log(finished_at);
create index if not exists run_log_job_finished_at_idx on public.run_log(job, finished_at);

-- 3. RLS ---------------------------------------------------------------------
alter table public.run_log enable row level security;

-- Approved users may READ (so a dashboard can show run history). Writes are
-- service_role only (bypasses RLS) — no authenticated INSERT/UPDATE/DELETE grant
-- or policy, so the browser can never write a fake run.
grant select on public.run_log to authenticated;

-- Explicitly ensure anon has nothing on this table (consistent with 0025).
revoke all privileges on table public.run_log from anon;

drop policy if exists "approved read run_log" on public.run_log;
create policy "approved read run_log" on public.run_log
  for select to authenticated using ((select public.is_approved()));

commit;
