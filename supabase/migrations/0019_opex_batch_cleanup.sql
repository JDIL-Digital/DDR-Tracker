-- 0019_opex_batch_cleanup.sql
-- OPEX Stage 2a — Step 2 support: let an approved uploader DELETE a batch they
-- created, so the client can roll back a FAILED/partial save (no orphaned batch
-- or partial purchase_orders). Deleting the opex_uploads row CASCADES to its
-- purchase_orders (FK on delete cascade) — cascade is enforced by the FK and is
-- NOT subject to the child table's RLS, so no delete policy is needed on
-- purchase_orders.
--
-- Scope is deliberately narrow: an approved user may delete ONLY batches whose
-- uploaded_by = their own auth.uid(). No general delete. Run after 0018.
-- Idempotent + atomic. ⚠️ Confirm the project is "DDR-Tracker".

begin;

grant delete on public.opex_uploads to authenticated;

drop policy if exists "owner delete opex_uploads" on public.opex_uploads;
create policy "owner delete opex_uploads" on public.opex_uploads
  for delete to authenticated
  using (public.is_approved() and uploaded_by = auth.uid());

commit;
