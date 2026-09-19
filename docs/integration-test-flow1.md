# DDR Pipeline — Flow 1 Integration Test (Email → Dashboard)

**Status: ✅ PASS (all 6 checkpoints)**
**Date completed:** 2026-09-19
**Scope:** End-to-end verification of the Daily Drilling Report (DDR) pipeline — from a rig's email
arriving in Gmail through to the numbers management sees on the dashboards — including the autonomous
scheduled run and the safety/idempotency behaviors.

Flow 1 = **Email → Match → Select attachment → Store → Extract → Save → Dashboard**, plus the
scheduler running it automatically and the guards against double-counting / duplicates / silent
failures.

Verification method: the real production inbox and the live Supabase DB (project `DDR-Tracker`,
`edrmbzcqffatjnommfcc`). Data-layer checks mirror the exact query/aggregation logic the app and
scripts use; header accuracy was spot-checked against the original source spreadsheets (cell-level).

---

## Checkpoint 1.1 — Email → Match

**Verified:** the matcher classifies every xlsx/xls-bearing email in the last 7 days as matched /
flagged / excluded; real DDRs map to the correct canonical rig + date; junk/admin/maintenance is
excluded; nothing is wrongly dropped or mis-assigned.

**Evidence:** 41 scanned → **31 matched, 0 flagged, 10 excluded (41/41 accounted)**. All 5 reporting
rigs matched to canonical names, incl. name-normalization (`VIRTUE I`→Virtue-1, `DISC-1`→Discovery-1,
trailing-space `JINDAL EXPLORER `→Jindal Explorer, 2-digit year parsed). Excludes were 7× HSE DPR,
a warehouse weekly, an internship enquiry, and an FYI forward of a season master workbook — all
correctly non-DDR. 0 flagged (every DDR-shaped email resolved to a rig + date).

**Verdict: PASS.**

## Checkpoint 1.2 — Attachment selection → Download → Store

**Verified:** for emails with multiple attachments (daily + season master), `selectDdrXlsx` picks
the DAILY; the `MAX_CELLS` size guard rejects an oversized master; `.xls` is accepted alongside
`.xlsx`; stored files use the path `<rig>/<report_date>_<filename>`.

**Evidence:** across all 31 matched, the daily (rig+date filename) was selected every time; masters
(`DDR 2026.xlsx`, `DPR JSUP SEP 2026.xlsx`, `DRR Virtue 1 2025-26.xlsx`) never selected. Cell counts:
dailies ~600–700 cells (extract OK); Virtue season master **12,446 cells > 8,000 → flagged/rejected**
(the file that caused the original extraction 400). Virtue's daily is legacy `.xls` — accepted and
parsed. Storage paths match convention (e.g. `virtue1/2026-09-17_VIRTUE_I_17-09-2026.xls`).

**Verdict: PASS.**

## Checkpoint 1.3 — Extract → Save (data accuracy)

**Verified:** header fields extracted correctly (not hallucinated); activities are own-day only
(`activity_date == report_date`, no next-morning rows), times normalized `HH:MM`, each with
`raw_code` + mapped `code`; every code exists in `code_master` and maps to a valid condition
(RODR/NODR/EBDR/MDR); own-day hours reconcile to ~24h; status set correctly.

**Evidence:** 3 reports across 3 formats (Discovery-1 `.xlsx`, Virtue-1 `.xls`, Supreme RDDR `.xlsx`),
all Sep-17. Header values traced to exact source cells (well_no `B4`, depth `J3`, POB `P20`, LTI
`L11`, diesel `J51`, fuel `I51`, days-on-well `F5`). All activities own-day, valid `HH:MM`,
**0 null codes, 0 invalid codes**; each report summed to **exactly 24.0h**; all `status='ok'`. The
**family-11 mapping fix is live** — bare `11` now maps to `11A` automatically (Discovery-1 04:30,
Supreme 18:30/20:00).

**Verdict: PASS.**

## Checkpoint 1.4 — Save → Dashboard

**Verified:** the dashboard data-layer functions produce numbers equal to the DB — Fleet KPIs
(`loadFleetTotals`), per-rig cards (`loadRigCards`), the rig time-distribution chart
(`loadRigTimeDistribution`), and the Daily Activity Summary (`loadDailyActivitySummary`); honest
empty states.

**Evidence (Sep-17 / range Sep-10→17):** Fleet KPIs RODR 65 / NODR 55 / EBDR 0, Diesel 892.9 KL,
Reports 5/6 — reconciles (5 rigs × 24 = 120 = 65+55). Rig cards match Checkpoint 1.3 values.
Distribution: continuously-reporting rigs = **192.0h over the 8-day inclusive range** (8×24; 168h is
a 7-day span), **no null-code notes** (family-11 fixed), Jindal Star shows its **full total across 3
wells with no per-well reset**. Daily Activity Summary for Jindal Star: every day = 24h; column sums
(Oper 52 / NonOp 140) **match the distribution cumulative exactly** — the two dashboards reconcile.
Pioneer shows an honest empty card / no bar.

**Verdict: PASS.**

## Checkpoint 1.5 — Scheduler (autonomous run)

**Verified:** the scheduled job runs the FULL pipeline automatically (match → extract → save → mark),
not just manual runs, and the `.env.local`/Secrets fix holds so extraction succeeds unattended.

**Evidence:** report `created_at` timestamps cluster on the cron slots (7:30 / 8:30 / 9:30 AM IST =
02:00 / 03:00 / 03:30 UTC) across **three consecutive days** (Sep-16, 17, 18) — the signature of an
automatic job, not an ad-hoc manual time. Sep-18: all 5 reporting rigs saved with report rows +
activities + markers, all `status='ok'`. **Zero stored-but-unextracted files** in the bucket (not
back to `--save`-only).

**Verdict: PASS.**

## Checkpoint 1.6 — Idempotency & edge cases (safety)

**Verified:** re-runs / the 3 daily cron slots don't double-process; no duplicate (rig_id,
report_date) rows; rigs table stays exactly 6 (no variant rigs); RDDR revisions supersede to one row;
`needs_review` flags are legitimate; the fail-loud scan-health self-check works.

**Evidence:** re-run `--save --extract --days 3` → **0 newly saved, 16 skipped** (already processed),
scan **healthy 21/21, 0 fetch failures**. DB: **44 reports, 0 duplicate rig+date rows**, **exactly 6
canonical rigs**. RDDR supersede confirmed — every rig+date that received two emails (Star Sep-10,
Supreme Sep-12, Star Sep-17 DDR+RDDR) collapsed to **one row**. Deleted-baseline dates (≤ Sep-08)
retain their markers with 0 rows — deleted data cannot resurrect (idempotency working as designed).
**0 `needs_review`** — all reports reconcile.

**Verdict: PASS.**

---

## Rig-side items (NOT pipeline faults)

These are data-quality issues on the rigs' side; the pipeline handles them correctly and honestly.
Raise with the respective rig teams:

- **Jindal Pioneer — sends no DDRs.** Appears only in warehouse/admin emails; correctly absent from
  the dashboards (no bar / empty card). Not a matcher miss.
- **Jindal Explorer — reporting gaps.** Stopped sending daily DDRs Sep-11→15 (only maintenance
  reports), resumed Sep-16. Honest sparse data (e.g. 3 days in the Sep-10→17 window).
- **Jindal Supreme — occasional subject/filename mislabels.** e.g. an RDDR whose subject date and
  attachment filename date disagree; the extractor correctly trusts the sheet date, and matching
  still resolves the rig. Ask the Supreme OIM to align subject/filename/sheet dates.
- **Jindal Star — duplicate IADC report numbers.** Report No `1149` appeared on both Sep-11 and
  Sep-12. Stored verbatim (the pipeline keys on rig+date, not report_no, so no collision); flag to
  the rig for unique daily numbering.

## Overall result

**Flow 1 (Email → Dashboard) PASSED end-to-end integration testing on 2026-09-19**, and the pipeline
is running **autonomously** via the scheduled deployment. It is correct (accurate extraction,
reconciled dashboards), safe (idempotent, no duplicates, fail-loud), and self-sufficient (no manual
step required). Remaining gaps are rig-side reporting behaviors, not pipeline defects.
