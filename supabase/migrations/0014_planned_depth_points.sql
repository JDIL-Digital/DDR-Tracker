-- 0014_planned_depth_points.sql
-- Depth-vs-Days chart, Part 1: store DRAFT planned depth milestone points for a
-- well plan, plus a flag marking whether an admin has verified those depths
-- against the GTO.
--
-- WHY a separate verify flag: the DAYS come reliably from the GTO summary box,
-- but the planned DEPTHS are read off the plotted depth-vs-days CURVE at LOW
-- confidence (DRAFT watermark + overlapping labels). So the extractor only ever
-- writes DRAFTS; an admin must verify/edit them before the chart trusts them.
--
-- WRITE MODEL: unchanged from 0013 — admins may UPDATE well_plans rows (RLS
-- "admin update well_plans"), so no new policy is needed; admins editing the
-- depth points + flipping depths_verified goes through that existing UPDATE
-- policy. Reads stay any-approved-user. Run after 0013. Idempotent + atomic.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker", NOT "JDIL-Navigation",
--    before running this in the SQL editor.

begin;

-- Draft planned depth milestone points, read off the GTO curve by the vision
-- extractor. Array of objects, each:
--   { activity, planned_depth_m, phase_days, cumulative_days, depth_confidence }
-- where depth_confidence is 'low' | 'medium' | 'high'. NULL depth_m = unreadable
-- (never fabricated). Days are copied from the reliable summary-box milestones.
alter table public.well_plans
  add column if not exists planned_depth_points jsonb;

-- Have the depth values been checked/edited by an admin against the actual GTO?
-- The chart (Part 2) should only trust depths where this is true.
alter table public.well_plans
  add column if not exists depths_verified boolean not null default false;

commit;
