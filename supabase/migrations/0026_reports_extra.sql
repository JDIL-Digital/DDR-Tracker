-- 0026_reports_extra.sql
-- Rig-console EXTRA sections (metocean / BOP / HSE / POB split / casing / pumps / mud).
-- ADDITIVE ONLY: adds a single nullable `reports.extra jsonb` column and re-creates
-- save_ddr_report to also persist it (extra = payload->'extra'). Nothing else changes —
-- the function body is byte-for-byte the 0023 version with ONLY three added lines
-- (insert column, insert value, on-conflict set). No existing column or RPC field is
-- altered. Safe to run once or re-run (create-or-replace + add-column-if-not-exists).
--
-- NOTE: migration number 0025 is intentionally skipped here — it is reserved by the
-- pending 0025_revoke_anon_grants migration on the chore/revoke-anon-grants branch.

begin;

alter table public.reports add column if not exists extra jsonb;  -- nullable, default null

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
    extra,
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
    payload->'extra',
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
    extra              = excluded.extra,
    extraction_status  = excluded.extraction_status,
    raw_extract        = excluded.raw_extract
  returning id into v_report_id;

  -- (c) children: clean replace (scoped to THIS report_id) -------------------
  delete from public.activities where report_id = v_report_id;
  delete from public.inventory  where report_id = v_report_id;

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
