-- 0023_ddr_report_fields.sql
-- Extend the DDR schema for the real DPR format and update the save RPC to write
-- the new fields, under the OWNERSHIP-BY-DATE model for the ~30h overlap.
--
-- OVERLAP / OWNERSHIP MODEL (the correctness contract the extractor must honour):
--   Each DDR covers its own day 00:00-24:00 PLUS the next morning 00:00-06:00, so
--   consecutive reports overlap on that 6h window. To store/count each activity
--   exactly once WITHOUT the re-extract hazard of a shared dedup key, each report
--   persists ONLY its own-day activities (activity_date = report_date). The
--   next-morning block is parsed for hour-reconciliation but NOT sent to this RPC;
--   it is persisted authoritatively by the NEXT report as ITS own day.
--   => report_id -> activity_date is 1:1, so the existing "delete children by
--      report_id then re-insert" re-extract is safe: it only ever touches the
--      re-extracted report's own calendar date, never an adjacent report's rows.
--   The activities_slot_uidx below is a DEFENSIVE guard (fail-loud) that catches
--   any extractor bug mis-assigning activity_date — it must NOT be softened with
--   ON CONFLICT DO NOTHING (a silent skip would drop a billed hour).
--
-- Everything the 0021 RPC did is preserved: case/punctuation-insensitive rig
-- find-or-create, report upsert on (rig_id, report_date) [= RDDR supersede],
-- atomic all-or-nothing, service_role-only EXECUTE.
--
-- ⚠️ The DDL in section (a) is IDEMPOTENT (if not exists) and has ALREADY been run
--    in the live DB — it is included here only so the schema change is recorded in
--    version control. Re-running it is a no-op. Section (b) (the RPC) is the part
--    still to run. ⚠️ Confirm project "DDR-Tracker" (edrmbzcqffatjnommfcc). Run after 0022.

begin;

-- =============================================================================
-- (a) SCHEMA DDL  (idempotent; already applied — kept for the record)
-- =============================================================================

-- reports: DDR header/status/diesel/downtime/cost fields.
-- (daily diesel consumption reuses the existing fuel_consumed_kl column.)
alter table reports add column if not exists spud_date          date;
alter table reports add column if not exists move_in_date       date;
alter table reports add column if not exists oim                text;
alter table reports add column if not exists pob_total          int;
alter table reports add column if not exists lti_days           int;      -- actual Lost Time Injury days
alter table reports add column if not exists diesel_rob_kl      numeric;  -- remaining on board
alter table reports add column if not exists downtime_daily_hrs numeric;
alter table reports add column if not exists downtime_cum_hrs   numeric;
alter table reports add column if not exists daily_cost         numeric;
alter table reports add column if not exists cumulative_cost    numeric;

-- activities: actual calendar date/time identity + the rig's raw form code.
--   rig_id       - denormalized (from the report's rig) for the slot key + rig-scoped reads
--   activity_date- the REAL date the activity occurred (own-day only; see model above)
--   raw_code     - the bare family number as written on the form ("6","23")
--   code (existing, FK->code_master) holds the AI-mapped IADC code (e.g. 6A, 23A)
alter table activities add column if not exists rig_id        uuid references rigs(id);
alter table activities add column if not exists activity_date date;
alter table activities add column if not exists raw_code      text;

-- Defensive slot uniqueness: one activity per rig per start-time per date.
-- Partial (a WHERE not-null predicate) so legacy pre-0023 rows (null activity_date) are excluded.
create unique index if not exists activities_slot_uidx
  on activities (rig_id, activity_date, time_from)
  where activity_date is not null and rig_id is not null and time_from is not null;

-- =============================================================================
-- (b) RPC  save_ddr_report(jsonb)  — writes the new columns (ownership model)
-- =============================================================================

create or replace function public.save_ddr_report(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rig_name      text := payload->>'rig_name';
  v_report_date   date := nullif(payload->>'report_date','')::date;
  v_rig_id        uuid;
  v_rig_created   boolean := false;
  v_report_id     uuid;
  v_prior         boolean;
  v_report_action text;
  v_act_count     int := 0;
  v_inv_count     int := 0;
begin
  if v_rig_name is null or btrim(v_rig_name) = '' then
    raise exception 'rig_name is empty; cannot resolve a rig';
  end if;
  if v_report_date is null then
    raise exception 'report_date is empty or invalid';
  end if;

  -- (a) rig: find (CASE/PUNCTUATION-INSENSITIVE) or create -------------------
  -- Reuse any existing rig whose normalized name matches, so "VIRTUE-1",
  -- "Virtue 1" and "virtue1" all resolve to the same row. Never mint a mis-cased
  -- duplicate. Only a name with NO normalized match is inserted (as given).
  select id into v_rig_id
  from public.rigs
  where lower(regexp_replace(name,       '[^a-zA-Z0-9]', '', 'g'))
      = lower(regexp_replace(v_rig_name, '[^a-zA-Z0-9]', '', 'g'))
  order by created_at asc
  limit 1;
  if v_rig_id is null then
    insert into public.rigs (name, rig_type) values (v_rig_name, null)
    returning id into v_rig_id;
    v_rig_created := true;
  end if;

  -- (b) report: upsert on (rig_id, report_date) [RDDR supersede] -------------
  select exists (
    select 1 from public.reports where rig_id = v_rig_id and report_date = v_report_date
  ) into v_prior;
  v_report_action := case when v_prior then 'updated' else 'inserted' end;

  insert into public.reports (
    rig_id, well_no, report_no, report_date,
    days_on_location, days_on_well,
    depth_md_m, depth_tvd_m, day_meterage_m,
    present_operation, next_operation,
    fuel_open_kl, fuel_recv_kl, fuel_consumed_kl, fuel_close_kl,
    spud_date, move_in_date, oim, pob_total, lti_days,
    diesel_rob_kl, downtime_daily_hrs, downtime_cum_hrs, daily_cost, cumulative_cost,
    extraction_status, raw_extract
  ) values (
    v_rig_id,
    payload->>'well_no',
    payload->>'report_no',
    v_report_date,
    nullif(payload->>'days_on_location','')::numeric,
    nullif(payload->>'days_on_well','')::numeric,
    nullif(payload->>'depth_md_m','')::numeric,
    nullif(payload->>'depth_tvd_m','')::numeric,
    nullif(payload->>'day_meterage_m','')::numeric,
    payload->>'present_operation',
    payload->>'next_operation',
    nullif(payload->>'fuel_open_kl','')::numeric,
    nullif(payload->>'fuel_recv_kl','')::numeric,
    nullif(payload->>'fuel_consumed_kl','')::numeric,
    nullif(payload->>'fuel_close_kl','')::numeric,
    nullif(payload->>'spud_date','')::date,
    nullif(payload->>'move_in_date','')::date,
    payload->>'oim',
    nullif(payload->>'pob_total','')::int,
    nullif(payload->>'lti_days','')::int,
    nullif(payload->>'diesel_rob_kl','')::numeric,
    nullif(payload->>'downtime_daily_hrs','')::numeric,
    nullif(payload->>'downtime_cum_hrs','')::numeric,
    nullif(payload->>'daily_cost','')::numeric,
    nullif(payload->>'cumulative_cost','')::numeric,
    coalesce(payload->>'extraction_status','ok'),
    payload->'raw_extract'
  )
  on conflict (rig_id, report_date) do update set
    well_no            = excluded.well_no,
    report_no          = excluded.report_no,
    days_on_location   = excluded.days_on_location,
    days_on_well       = excluded.days_on_well,
    depth_md_m         = excluded.depth_md_m,
    depth_tvd_m        = excluded.depth_tvd_m,
    day_meterage_m     = excluded.day_meterage_m,
    present_operation  = excluded.present_operation,
    next_operation     = excluded.next_operation,
    fuel_open_kl       = excluded.fuel_open_kl,
    fuel_recv_kl       = excluded.fuel_recv_kl,
    fuel_consumed_kl   = excluded.fuel_consumed_kl,
    fuel_close_kl      = excluded.fuel_close_kl,
    spud_date          = excluded.spud_date,
    move_in_date       = excluded.move_in_date,
    oim                = excluded.oim,
    pob_total          = excluded.pob_total,
    lti_days           = excluded.lti_days,
    diesel_rob_kl      = excluded.diesel_rob_kl,
    downtime_daily_hrs = excluded.downtime_daily_hrs,
    downtime_cum_hrs   = excluded.downtime_cum_hrs,
    daily_cost         = excluded.daily_cost,
    cumulative_cost    = excluded.cumulative_cost,
    extraction_status  = excluded.extraction_status,
    raw_extract        = excluded.raw_extract
  returning id into v_report_id;

  -- (c) children: clean replace (scoped to THIS report_id) -------------------
  -- Safe under the ownership-by-date model: this report owns exactly one
  -- activity_date, so deleting its own children never touches an adjacent
  -- report's overlapping-window rows.
  delete from public.activities where report_id = v_report_id;
  delete from public.inventory  where report_id = v_report_id;

  -- activities. meterage_m is GENERATED (never inserted). seq falls back to array
  -- order. rig_id/activity_date/raw_code are the new ownership-model columns.
  -- NOTE: no ON CONFLICT here by design — the activities_slot_uidx guard is
  -- fail-loud so a mis-assigned activity_date aborts the atomic save instead of
  -- silently dropping/duplicating a billed hour.
  insert into public.activities
    (report_id, rig_id, activity_date, seq, time_from, time_to, hrs, code, raw_code, depth_in_m, depth_out_m, remarks)
  select
    v_report_id,
    v_rig_id,
    nullif(a->>'activity_date','')::date,
    coalesce(nullif(a->>'seq','')::int, ord::int),
    a->>'time_from',
    a->>'time_to',
    nullif(a->>'hrs','')::numeric,
    a->>'code',
    a->>'raw_code',
    nullif(a->>'depth_in_m','')::numeric,
    nullif(a->>'depth_out_m','')::numeric,
    a->>'remarks'
  from jsonb_array_elements(coalesce(payload->'activities', '[]'::jsonb))
       with ordinality as t(a, ord);
  get diagnostics v_act_count = row_count;

  -- inventory
  insert into public.inventory
    (report_id, item, unit, opening, received, generated, consumed, closing)
  select
    v_report_id,
    r->>'item',
    r->>'unit',
    nullif(r->>'opening','')::numeric,
    nullif(r->>'received','')::numeric,
    nullif(r->>'generated','')::numeric,
    nullif(r->>'consumed','')::numeric,
    nullif(r->>'closing','')::numeric
  from jsonb_array_elements(coalesce(payload->'inventory', '[]'::jsonb)) as r;
  get diagnostics v_inv_count = row_count;

  return jsonb_build_object(
    'rig_id',             v_rig_id,
    'rig_created',        v_rig_created,
    'report_id',          v_report_id,
    'report_action',      v_report_action,
    'activities_written', v_act_count,
    'inventory_written',  v_inv_count
  );
end;
$$;

-- Lock down EXECUTE: server-side (service_role) only; never the browser.
revoke all on function public.save_ddr_report(jsonb) from public;
revoke all on function public.save_ddr_report(jsonb) from anon, authenticated;
grant execute on function public.save_ddr_report(jsonb) to service_role;

commit;
