-- 0001_init.sql
-- DDR Tracker — initial schema
-- Row Level Security is intentionally NOT enabled here; auth comes in a later step.

-- gen_random_uuid() lives in pgcrypto (already available on Supabase; kept for portability).
create extension if not exists pgcrypto;

-- Rigs -----------------------------------------------------------------------
create table rigs (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  rig_type   text,
  created_at timestamptz default now()
);

-- Activity code master -------------------------------------------------------
create table code_master (
  code        text primary key,
  description text not null,
  category    text not null check (category in ('Productive','Non-Productive','Completion')),
  is_npt      boolean not null default false
);

-- Daily reports --------------------------------------------------------------
create table reports (
  id                uuid primary key default gen_random_uuid(),
  rig_id            uuid references rigs(id),
  well_no           text,
  report_no         text,
  report_date       date not null,
  days_on_location  numeric,
  days_on_well      numeric,
  depth_md_m        numeric,
  depth_tvd_m       numeric,
  day_meterage_m    numeric,
  present_operation text,
  next_operation    text,
  fuel_open_kl      numeric,
  fuel_recv_kl      numeric,
  fuel_consumed_kl  numeric,
  fuel_close_kl     numeric,
  extraction_status text default 'ok',
  raw_file_path     text,
  raw_extract       jsonb,
  created_at        timestamptz default now(),
  unique (rig_id, report_date)
);

-- Time-log activities per report --------------------------------------------
create table activities (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid references reports(id) on delete cascade,
  seq         int,
  time_from   text,
  time_to     text,
  hrs         numeric,
  code        text references code_master(code),
  depth_in_m  numeric,
  depth_out_m numeric,
  meterage_m  numeric generated always as (
    case
      when depth_out_m is not null and depth_in_m is not null
      then greatest(depth_out_m - depth_in_m, 0)
    end
  ) stored,
  remarks     text
);

-- Inventory / materials per report ------------------------------------------
create table inventory (
  id        uuid primary key default gen_random_uuid(),
  report_id uuid references reports(id) on delete cascade,
  item      text,
  unit      text,
  opening   numeric,
  received  numeric,
  generated numeric,
  consumed  numeric,
  closing   numeric
);
