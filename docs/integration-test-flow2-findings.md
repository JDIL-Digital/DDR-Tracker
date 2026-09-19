# DDR Pipeline — Flow 2 Integration Test: Findings & Decisions

Companion to `docs/integration-test-flow1.md`. Flow 2 = the dashboards (Fleet + Reports tabs) reading
the saved DDR data. This file logs findings that need a follow-up decision or change; checkpoint
PASS/FAIL verdicts live in the running test record.

---

## Finding F2-1 — NPT defined inconsistently across tabs

**Checkpoint:** 2.2 (Reports panels) · **Logged:** 2026-09-19 · **Severity:** medium (no wrong data;
a definition inconsistency that confuses readers) · **Status:** DECIDED, implementation deferred to
after the integration test.

### What was found
For the **same data** (Sep-12→18, all rigs) the two tabs report different NPT:

| Tab | NPT definition | NPT (Sep-12→18) | NPT % |
|---|---|--:|--:|
| **Reports** (`reports.js` → `is_npt` flag) | EBDR-only (`code_master.is_npt` = `condition='EBDR'`, per migration 0022) | 1.0 h | 0.1% |
| **Fleet** (`ddrFleet.js` → `loadNptByCause`) | NODR + EBDR | 238 h | 32% |

Condition split for the range: RODR 506 / NODR 237 / EBDR 1 / MDR 0. Both figures are internally
correct for their own definition — but "NPT" means two different things depending on the tab, so
management sees 0.1% on Reports and 32% on Fleet.

Every other Reports-panel number reconciled to the DB and internally (Time-by-Code Σ = 744.0h = 100%;
Fuel total 275.7 KL = raw `sum(fuel_consumed_kl)`; Time-by-Code total = NPT total = Σ report hours).
This was the only cross-tab inconsistency.

### Decision
- **NPT = NODR + EBDR everywhere** (industry-standard "non-productive time": rig not making hole
  for any reason — non-productive operations *plus* equipment breakdown).
- The **EBDR-only** figure is a legitimate sub-metric but must be **relabeled "Equipment Breakdown"**
  (or "Equipment Breakdown NPT") — it must NOT be labeled just "NPT".
- **MDR-as-NPT (still open):** does mobilization / rig-move count as NPT? Current assumption:
  **NPT = NODR + EBDR, MDR excluded.** To be settled with the Jindal team at the same time.

### To implement (SEPARATE change, AFTER the integration test — do not do mid-test)
1. Align the **Reports NPT panel** to **NODR + EBDR** — either change how the panel computes NPT
   (use `condition in ('NODR','EBDR')` instead of the `is_npt` flag) or redefine `is_npt`. If
   `is_npt` is redefined, re-check every consumer (Reports NPT panel, Analytics ILT, any KPI) so the
   change is consistent.
2. **Relabel** any EBDR-only display as "Equipment Breakdown" (Reports panel, Fleet EBDR KPI wording
   if needed) so the two NPT-related numbers are clearly distinct metrics.
3. Resolve **MDR-as-NPT** with the team; if MDR should count, extend the definition to
   `NODR + EBDR + MDR` everywhere and update this note.
4. Re-verify against the DB after the change (a mini Checkpoint 2.2 re-run) and confirm Reports NPT %
   equals the Fleet NPT % for the same range.

### Cross-references
- CLAUDE.md → NEXT STEPS item 0 (NPT DEFINITION RECONCILIATION).
- CLAUDE.md → STANDING TODO "MDR-as-NPT (OPEN QUESTION)" and §6.2 NEXT STEPS ("reconcile the NPT views").

---

## Finding F2-2 — Maintenance tab has no aggregate "Critical Alerts" summary card

**Checkpoint:** 2.3 (Maintenance dashboard — DMR data) · **Logged:** 2026-09-19 · **Severity:** low
(UI presentation, not a data bug) · **Status:** DECIDED (enhancement), implementation deferred to
after the integration test.

### What was found
The Maintenance tab has **no aggregate "Critical Alerts" summary card**. Criticals currently surface
as **per-department red banners** (`⚠ Critical`) on the Overview/Department cards, plus critical /
notable **count columns in the Analytics table**. These work correctly and are accurate — the
critical/notable keyword detection (`maintenanceKeywords.js`) matched the real activity text
correctly (e.g. Virtue-1 Sep-19: 0 critical → calm, 4 notable → amber banners). This is a
**presentation observation, not a data bug.** (Confirmed by code search: no `Critical Alerts` card /
aggregate critical-count component exists.)

### Decision
- The **per-department banners are sufficient for now** — they show *which* department has the
  critical, which is the actionable detail.
- **Enhancement (separate change, after the integration test):** add an aggregate **rig-level
  "Critical Alerts" summary card** — a top-of-tab indicator showing the total critical count for the
  selected rig/DMR: **red when > 0, calm/green when 0**. It **complements, not replaces**, the
  per-department banners.

### To implement (deferred)
1. Add a top-of-tab summary card in `MaintenanceView.jsx` that counts `tier === 'critical'` across
   the selected scope (respecting the This report / Overall toggle), red when > 0 else calm/green.
2. Optionally make it clickable to drill into the critical items (like the KPI cards).
3. Keep the per-department `⚠ Critical` banners as-is.

### Cross-references
- CLAUDE.md → NEXT STEPS item 0b (Maintenance Critical Alerts summary card).
