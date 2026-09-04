-- 0021_rig_find_or_create_ci.sql
-- ROOT-CAUSE FIX for mis-cased rig rows (e.g. "VIRTUE-1" vs "Virtue-1").
--
-- The DDR save RPC (0009) resolved the rig with a CASE-SENSITIVE exact match:
--     select id into v_rig_id from public.rigs where name = v_rig_name;
--     if not found -> insert (v_rig_name)
-- So a DDR whose extracted rig_name spelled the rig "VIRTUE-1" would NOT match an
-- existing "Virtue-1" row and would INSERT a new, mis-cased DUPLICATE rig. That is
-- how the uppercase "VIRTUE-1" row was created (rig created_at 2026-07-28).
--
-- This migration replaces save_ddr_report so the rig lookup is
-- case/punctuation-INSENSITIVE — it strips non-alphanumerics and lowercases both
-- sides (the SQL mirror of scripts/dmr-match.js normRig). An existing rig is
-- always reused regardless of case/spacing, so the pipeline can never mint a
-- mis-cased duplicate again. Only a genuinely-new rig (no normalized match) is
-- inserted, and it is inserted as given (there is no canonical roster in SQL to
-- normalize a brand-new name against — that stays a data-entry concern).
--
-- Everything else in the function is byte-for-byte identical to 0009. Idempotent
-- (CREATE OR REPLACE) + re-asserts the service_role-only EXECUTE grant.
-- ⚠️ Confirm the Supabase project is "DDR-Tracker" (edrmbzcqffatjnommfcc),
--    NOT "JDIL-Navigation", before running this. Run after 0020.

begin;

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

  -- (b) report: upsert on (rig_id, report_date) -----------------------------
  select exists (
    select 1 from public.reports where rig_id = v_rig_id and report_date = v_report_date
  ) into v_prior;
  v_report_action := case when v_prior then 'updated' else 'inserted' end;

  insert into public.reports (
    rig_id, well_no, report_no, report_date,
    depth_md_m, day_meterage_m, fuel_consumed_kl,
    extraction_status, raw_extract
  ) values (
    v_rig_id,
    payload->>'well_no',
    payload->>'report_no',
    v_report_date,
    nullif(payload->>'depth_md_m','')::numeric,
    nullif(payload->>'day_meterage_m','')::numeric,
    nullif(payload->>'fuel_consumed_kl','')::numeric,
    coalesce(payload->>'extraction_status','ok'),
    payload->'raw_extract'
  )
  on conflict (rig_id, report_date) do update set
    well_no           = excluded.well_no,
    report_no         = excluded.report_no,
    depth_md_m        = excluded.depth_md_m,
    day_meterage_m    = excluded.day_meterage_m,
    fuel_consumed_kl  = excluded.fuel_consumed_kl,
    extraction_status = excluded.extraction_status,
    raw_extract       = excluded.raw_extract
  returning id into v_report_id;

  -- (c) children: clean replace ---------------------------------------------
  delete from public.activities where report_id = v_report_id;
  delete from public.inventory  where report_id = v_report_id;

  -- activities (meterage_m is GENERATED — never inserted). seq falls back to
  -- array order if the caller didn't set it.
  insert into public.activities
    (report_id, seq, time_from, time_to, hrs, code, depth_in_m, depth_out_m, remarks)
  select
    v_report_id,
    coalesce(nullif(a->>'seq','')::int, ord::int),
    a->>'time_from',
    a->>'time_to',
    nullif(a->>'hrs','')::numeric,
    a->>'code',
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
