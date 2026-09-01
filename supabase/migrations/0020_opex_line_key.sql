-- 0020_opex_line_key.sql
-- OPEX Stage 2b-1: make "Save to ORBIT" an accumulate/merge (insert-if-new /
-- skip-if-exists) instead of insert-only, so re-uploading the same workbook does
-- not duplicate rows.
--
-- Identity of a PO-line (amounts are IMMUTABLE, so amount is part of identity):
--   source | po_number | location | order_date | amount | description | occurrence_index
-- occurrence_index is a per-identity-tuple rank (0,1,2…) that preserves
-- legitimately-identical lines (measured: exactly 1 such pair in the real 6,046).
--
-- line_key = SHA-256 hex of that identity string (computed client-side and sent
-- with each row). A UNIQUE index on line_key is the ON CONFLICT target; the
-- client upserts with ignoreDuplicates=true (ON CONFLICT DO NOTHING), which
-- preserves existing rows' original upload_batch_id (provenance).
--
-- ⚠️ Existing rows saved BEFORE this migration have line_key = NULL (multiple
--    NULLs are allowed by the unique index). Those old rows will NOT dedup
--    against re-uploads. Clear the pre-0020 test data once (service-role):
--       delete from public.purchase_orders;
--       delete from public.opex_uploads;
--    then re-save so every row gets a line_key.
--
-- ⚠️ Confirm the project is "DDR-Tracker". Run after 0019. Idempotent + atomic.

begin;

alter table public.purchase_orders
  add column if not exists occurrence_index int not null default 0;
alter table public.purchase_orders
  add column if not exists line_key text;

-- Unique target for ON CONFLICT. NULL line_keys (pre-0020 rows) don't collide
-- (Postgres allows multiple NULLs in a unique btree index).
create unique index if not exists purchase_orders_line_key_uidx
  on public.purchase_orders(line_key);

commit;
