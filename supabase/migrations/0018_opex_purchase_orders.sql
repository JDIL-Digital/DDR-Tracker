-- 0018_opex_purchase_orders.sql
-- OPEX Stage 2a — Step 1: persistence schema for purchase data (tables + RLS
-- only; no UI). Two tables: opex_uploads (one row per upload batch) and
-- purchase_orders (one row per valid PO-line from the per-rig sheets).
--
-- NOTE ON NUMBERING: requested as "0017" but 0017 is already taken
-- (0017_allow_advisor.sql). Named 0018 to avoid a collision / ordering break.
--
-- SECURITY: reuses the app's existing approved-user gate exactly as
-- maintenance_reports (0015): SELECT -> public.is_approved(). INSERT is also
-- approved-user (not admin) BY DESIGN — approved users perform the uploads.
-- No UPDATE/DELETE policy from the browser (re-uploads managed later); the
-- service-role key bypasses RLS for server-side management.
--
-- ⚠️ Confirm the Supabase project is "DDR-Tracker", NOT "JDIL-Navigation",
--    before running. Run after 0017. Idempotent + atomic.

begin;

-- 1. Upload batches ----------------------------------------------------------
create table if not exists public.opex_uploads (
  id               uuid primary key default gen_random_uuid(),
  uploaded_by      uuid references auth.users(id),
  uploaded_at      timestamptz not null default now(),
  local_filename   text,
  import_filename  text,
  local_row_count  int,
  import_row_count int,
  total_row_count  int,
  notes            text
);

-- 2. Purchase order lines ----------------------------------------------------
create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  upload_batch_id  uuid references public.opex_uploads(id) on delete cascade,
  source           text not null check (source in ('local','import')),
  location         text,          -- the rig / sheet name
  po_number        text,
  order_date       date,
  status           text,
  vendor           text,
  description      text,
  department       text,
  currency         text,
  amount           numeric,
  gst_amount       numeric,
  amount_to_vendor numeric,       -- local
  usd_equivalent   numeric,       -- import
  row_fingerprint  text,          -- hash of source|po_number|location|amount|order_date|description (future dedup)
  raw              jsonb,         -- original parsed row (audit/safety)
  created_at       timestamptz not null default now()
);

create index if not exists purchase_orders_source_idx       on public.purchase_orders(source);
create index if not exists purchase_orders_location_idx      on public.purchase_orders(location);
create index if not exists purchase_orders_po_number_idx     on public.purchase_orders(po_number);
create index if not exists purchase_orders_upload_batch_idx  on public.purchase_orders(upload_batch_id);
create index if not exists purchase_orders_fingerprint_idx   on public.purchase_orders(row_fingerprint);

-- 3. RLS ---------------------------------------------------------------------
alter table public.opex_uploads     enable row level security;
alter table public.purchase_orders  enable row level security;

-- Browser may SELECT + INSERT; no UPDATE/DELETE grant (service-role only).
grant select, insert on public.opex_uploads    to authenticated;
grant select, insert on public.purchase_orders to authenticated;

-- opex_uploads: approved read + approved insert.
drop policy if exists "approved read opex_uploads" on public.opex_uploads;
create policy "approved read opex_uploads" on public.opex_uploads
  for select to authenticated using (public.is_approved());
drop policy if exists "approved insert opex_uploads" on public.opex_uploads;
create policy "approved insert opex_uploads" on public.opex_uploads
  for insert to authenticated with check (public.is_approved());

-- purchase_orders: approved read + approved insert.
drop policy if exists "approved read purchase_orders" on public.purchase_orders;
create policy "approved read purchase_orders" on public.purchase_orders
  for select to authenticated using (public.is_approved());
drop policy if exists "approved insert purchase_orders" on public.purchase_orders;
create policy "approved insert purchase_orders" on public.purchase_orders
  for insert to authenticated with check (public.is_approved());

-- No UPDATE/DELETE policies: those operations are closed to anon + authenticated
-- (only the service-role key, which bypasses RLS, can manage/re-upload for now).

commit;
