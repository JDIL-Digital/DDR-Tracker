-- 0016_processed_emails.sql
-- Durable, Replit-safe processed-email marker for the background pipeline.
-- Replaces the machine-local .processed-dmr-emails.json file so idempotency
-- survives redeploys / runs on different hosts.
--
-- ACCESS: server / service-role ONLY. This table is never read or written by the
-- browser. We enable RLS and add NO policies, so authenticated/anon have zero
-- access; the service_role key (used by scripts/ingest-dmr.js) bypasses RLS.
--
-- Correctness backstop stays maintenance_reports (rig_id, report_date) uniqueness
-- (migration 0015) — this table just avoids re-downloading handled emails.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker", NOT "JDIL-Navigation",
--    before running. Run after 0015. Idempotent + atomic.

begin;

create table if not exists public.processed_emails (
  message_id    text primary key,          -- Gmail message id
  kind          text,                      -- 'dmr' | 'ddr' | ... (which pipeline handled it)
  processed_at  timestamptz not null default now(),
  rig_id        uuid references public.rigs(id),
  report_date   date
);

-- Server-only: enable RLS, define NO policies. authenticated/anon get nothing;
-- the service_role key bypasses RLS entirely.
alter table public.processed_emails enable row level security;

commit;
