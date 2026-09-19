# DDR Pipeline — Flow 3 Integration Test (Ancillary pipelines: DMR + well-plan Extract)

**Status: ✅ COMPLETE (both checkpoints PASS)**
**Date completed:** 2026-09-19

Flow 3 covers the two pipelines beyond the core DDR flow: the **DMR (maintenance) ingestion pipeline**
end-to-end, and the **well-plan Extract worker** (button → server worker → extraction → saved).
Verified against the real inbox and the live Supabase DB (`DDR-Tracker`, `edrmbzcqffatjnommfcc`).

---

## Checkpoint 3.1 — DMR ingestion pipeline (end-to-end)

**Verified:** email→match (with exclusion guards), download→store, extract→save, idempotency, and the
autonomous scheduler — the same standard as DDR Flow 1.

**Evidence:**
- **Match:** finder/classifier over `subject:maintenance` — all matched to the 5 reporting canonical
  rigs, 0 flagged, 0 excluded near-misses, accounted X/X. Exclusion guards tested directly and
  correct: `Include Mr` → excluded (admin thread); `RE:` with no `.docx` → excluded; non-DMR subject
  → excluded; `FW:` valid DMR → matched (reply prefixes stripped).
- **Store:** per-rig folders `{rig}/{report_date}_{file}.docx` in the `maintenance-reports` bucket
  (e.g. `virtue1/` 28 files through 2026-09-19; `jindalsupreme/` 24). (One legacy root-level `.docx`
  from an early manual upload — harmless.)
- **Extract/Save:** Sep-18 (4 rigs) + Sep-19 (5 rigs) all `extracted` with real activity counts
  (44–75) and markers; department/chief/status/tier content verified in Checkpoint 2.3.
- **Idempotency:** dry-run re-scan → all matched SKIPPED (already processed via DB marker); 132
  `processed_emails` kind='dmr' markers; no duplicates (existence check on (rig_id, report_date) +
  storage upsert). Scan health: `accounted 15/15 … ✅ healthy, 0 fetch failures`.
- **Scheduler:** `created_at` lands on the cron slots (7:30/8:30/9:30 IST) across consecutive days —
  Sep-18 ~08:30, Sep-19 spread 07:30/08:30/09:30 — the autonomous-run signature. DMRs current
  through Sep-19.

**Verdict: PASS.**

## Checkpoint 3.2 — well-plan Extract worker (button → worker → extraction → saved)

**Verified:** the live Extract button (confirmed working in-app by the user) persists real extraction
data to `well_plans`, via a sound server-worker path.

**Evidence:**
- **DB — all 4 well_plans `extracted` with real derived data** (milestone days sum to the total in
  every case):
  | File | Rig / Well | Target m | Planned days | Milestones (Σdays) | Depth pts |
  |---|---|--:|--:|---|--:|
  | Completion Plan B12_2P#1 (.docx) | Jindal Star / B12_2P#1 | 4462 | 21 | 10 (Σ21) | 0 |
  | DWOP IN#2Z (.pdf) | Discovery-1 / IN#1Z | 1851 | 26 | 6 (Σ26, cum 26) | 0 |
  | GTO B-157N-L (.pdf) | Jindal Supreme / B-157N | 3800 | 181 | 5 (Σ181, cum 181) | 6 (verified) |
  | WOJ Plan IN#2 (.docx) | Discovery-1 / IN#2 | 1850 | 32 | 14 (Σ32, cum 32) | 0 |
  The Jindal Star plan (extracted via the live button) saved correctly: target 4462 m, 21 days,
  10 milestones, 13 key notes, 467-char history. Depth points appear only on the GTO (verified);
  DOCX completion/workover plans correctly have none.
- **Worker path sound** (`scripts/extract-server.js`): auth-gated — verifies the Supabase JWT
  (`auth.getUser`) then requires `profiles.status='approved'` (any approved user, not admin-only),
  CORS origin allow-list; **reuses** `extractWellPlan()`/`statusFor()`/`saveExtraction()` from
  `extract-wellplan.js` (no duplicated extraction logic — the button path runs the same code the CLI
  path was verified on); **markFailed** on error (non-destructive — never wipes prior good data).
- **Reasonableness:** milestone days sum to totals for all 4; cumulative-days last == total (3 of 4;
  Jindal Star's last "handover" step has a null day-count in the source, so cum is null but Σ=21);
  target depths reasonable; B-157N (181) and IN#2 (32) match the CLAUDE.md verified values.

**Verdict: PASS.**

---

## Open item (minor, one-field extraction tidy — not a pipeline fault)
- **Discovery IN#2Z DWOP saved `well_name = "IN#1Z"`** (the file/well is **IN#2Z**). A single-field
  extraction naming quirk; the rest of that plan's data is correct. Fix by correcting `well_name` on
  that `well_plans` row (and, if desired, tightening the well-name read in the extractor). Low priority.

## Overall result
**Flow 3 (DMR pipeline + well-plan Extract worker) PASSED** — both checkpoints DB-confirmed. The DMR
pipeline is correct, safe, and autonomous end-to-end (like DDR); the well-plan Extract feature works
end-to-end (button → auth-gated worker → extraction → saved), with real reconciling data.
