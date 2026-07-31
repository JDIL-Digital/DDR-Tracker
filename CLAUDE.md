# DDR Tracker — Project State / Handoff

_Handoff notes so a future Claude Code session can continue this project. Last updated: 2026-07-30._

## 1. What this project is
**DDR Tracker** is an internal tool for **Jindal Drilling & Industries Ltd.** It standardizes
**daily drilling reports (DDRs)** from **6 offshore rigs**. Reports arrive as Excel attachments by
**Gmail**; the pipeline downloads them, uses the **Claude API** to extract each into standardized
JSON, stores them in **Supabase**, presents a **fleet dashboard** (Fleet / Analytics / Reports /
Assets / Settings), and can send a **daily summary email**. Everything is currently **local-only**
(no deploy, no auth yet).

## 2. Tech stack
- **Front-end:** Vite + React (JavaScript, not TS). Dev server on `http://localhost:5173`.
- **Database:** Supabase (Postgres). New-style API keys: **publishable** (front-end, browser-safe)
  and **secret** (server-side scripts only).
- **Extraction:** Anthropic **Claude API** — model `claude-haiku-4-5`, **structured outputs**
  (`output_config.format` JSON schema), `temperature: 0`.
- **Excel:** SheetJS **`xlsx`** installed from the **CDN tarball** (`cdn.sheetjs.com/xlsx-0.20.3`)
  — the npm build had advisories. Parsing is buffer-based (`XLSX.read`).
- **Email intake:** **Gmail API** via `googleapis` (Desktop OAuth, loopback on port 4571).
- **Email send:** **Resend** (`resend` SDK).
- **Deploy target (future):** **Replit**.
- ⚠️ **npm registry note:** this dev environment blocks `registry.npmjs.org`. `.npmrc` points npm
  at the **yarnpkg mirror** (`https://registry.yarnpkg.com`). Keep `.npmrc` for installs here; it
  can be removed on a normal network.

## 3. What is DONE
- **Repo + git hygiene:** GitHub `https://github.com/JDIL-Digital/DDR-Tracker.git`, `.gitignore`
  (node_modules, dist, **all env/secret files**, `samples/`, `google-*.json`,
  `daily-summary-preview.html`, `.processed-emails.json`), `README.md`.
- **Vite + React scaffold** + Supabase front-end client (`src/lib/supabaseClient.js`, publishable
  key only; secret key never touches the front-end).
- **DB schema (migrations run manually in Supabase SQL editor):**
  - `0001_init.sql` — tables `rigs`, `code_master`, `reports`, `activities`
    (`meterage_m` is a GENERATED column), `inventory`. No RLS at first.
  - `0002_seed_codes.sql` — DRAFT activity codes `1..26` + `C1..C6` (Productive / Non-Productive /
    Completion, `is_npt` flag). **To be confirmed with ops team** (see R-2 below).
  - `0003_public_read_policies.sql` — enables RLS + **read-only anon SELECT** policies so the
    front-end (publishable key) can read. Writes stay on the secret key.
- **Extractor** `scripts/extract-ddr.js` — Excel → lossless `Sheet!A1 = value` cell dump → Claude
  (structured JSON) → **validation** (activity hours ≈ 24 ±0.5, every code in `code_master`,
  required fields) → prints. `--save` writes to Supabase. Hardened: deterministic (temp 0), explicit
  inventory rules (one row per bulk item incl. Fuel Oil, unit split from name, `generated`/MADE
  column), and code mapping (e.g. "WOW"/waiting-on-weather → code **18**, not generic 21).
  Exports `extractDDR()`, `validate()`, `excelToLines()` for reuse.
- **DB writer** `scripts/supabase-server.js` — **server-side only** (secret key). `saveReport()`:
  find-or-create rig → **upsert report on (rig_id, report_date)** (idempotent, no duplicates) →
  clean-replace children (delete then insert activities + inventory) → sets `extraction_status`
  `ok` / `needs_review`. Note: not atomic (no client-side transaction) — see hardening.
- **Gmail reader** `scripts/fetch-gmail.js` — Desktop OAuth (first run prints a consent URL, saves
  token to `google-token.json`), lists DDR emails: subject contains **DDR/DPR/DRR** AND has an
  `.xls`/`.xlsx` attachment. Exports `findDDRMessages()`, `listDDR()`.
- **Pipeline** `scripts/process-inbox.js` — Gmail → download each Excel attachment → `extractDDR()`
  → validate → (opt) `saveReport()`. **Dry-run by default**; `--save`, `--limit N`, `--match <substr>`.
  **Size guard** skips season/master workbooks (> 4000 non-empty cells) instead of erroring.
  Per-file error isolation. Tracks processed message IDs in `.processed-emails.json` (git-ignored;
  only marked on successful save). Does NOT modify Gmail.
- **Daily summary email** `scripts/daily-summary.js` — READ-ONLY, dry-run by default. Computes fleet
  avg ROP, fleet NPT %, diesel ROB, reports received X/Y, per-rig rows, NPT-by-cause. Email-safe HTML
  (inline styles, **white background**, **high-NPT (>40%) highlight**). Dry run writes
  `daily-summary-preview.html` (git-ignored); `--send` emails via Resend (needs `RESEND_FROM` /
  `RESEND_TO`).
- **Dashboard** (`src/dashboard/`) — 5 screens, dark "mission-control" theme + **light/dark toggle**
  (`data-theme` on `<html>` + CSS variables), Jindal logo (`public/Jindal Logo.jpg`) on a white plate:
  1. **Fleet** — KPI cards, per-rig cards (status pills, progress, metrics), ROP chart, NPT-by-cause.
  2. **Analytics** — time window (24H/7D/30D/Custom), rig-compare chips, ROP actual-vs-target,
     NPT-by-cause, diesel-vs-depth scatter, fleet performance matrix with a **Health Score**, CSV export.
  3. **Reports** — period (7/30/90/Custom), ROP trend, **time-by-activity-code** table, NPT report,
     **equipment downtime** (from repair codes), fuel consumption, **Export PDF** (print stylesheet).
  4. **Assets** — inventory list (categories, maintenance-health placeholder) + asset detail
     (identity, **pending-GTO** well/project panel, certifications placeholder, **live** equipment downtime).
  5. **Settings** — General, User Management (placeholder), Admin Approvals (placeholder), **Activity
     Codes (live from `code_master`)**, GTO Uploads (placeholder), Notifications.
- **Performance/caching** — `src/dashboard/dataCache.js`: 60s in-memory cache keyed by
  `loaderName + JSON(args)`, storing the in-flight promise (dedupes React StrictMode's dev
  double-invoke; repeat tab switches are instant). `planned_rop` is detected once (no failing probe /
  no console 400; auto-enables when the column is added). `loadAssets` bounded to the last 365 days.

## 4. Key files
### `scripts/` (Node, run locally)
- `extract-ddr.js` — Excel → Claude → validate → (`--save`) DB. Core extractor.
- `supabase-server.js` — server-side (secret-key) writer, `saveReport()`. **Never import in front-end.**
- `fetch-gmail.js` — Gmail OAuth + list DDR emails.
- `process-inbox.js` — full ingest pipeline (dry-run default).
- `daily-summary.js` — daily summary email (read-only, dry-run default).
### `src/dashboard/`
- `Dashboard.jsx` — app shell: owns theme + active view; routes Fleet/Analytics/Reports/Assets/Settings.
- `Sidebar.jsx`, `TopBar.jsx` — nav + theme toggle. `dashboard.css` — the whole theme + all page styles.
- `fleet.js` / `FleetView.jsx` (+ `KpiCard`, `RigCard`, `RopChart`, `NptByCause`, `Footer`) — Fleet.
  `fleet.js` also exports **`FLEET_ROSTER`** (the 6 real rig names).
- `analytics.js` / `AnalyticsView.jsx` (+ `TimeWindowSelector`, `RigCompareChips`, `RopByRigChart`,
  `NptByCausePanel`, `DieselVsDepthScatter`, `FleetPerformanceMatrix`, `ExportCsvButton`) — Analytics.
- `reports.js` / `ReportsView.jsx` (+ `ReportPeriodSelector`, `RopTrendChart`, `TimeByCodePanel`,
  `NptReportPanel`, `EquipmentDowntimePanel`, `FuelConsumptionPanel`) — Reports.
- `assets.js` / `AssetsView.jsx` (+ `AssetsList.jsx`, `AssetDetail.jsx`) — Assets.
- `settings.js` / `SettingsView.jsx` — Settings.
- `dataCache.js` — shared loader cache + `plannedRopSupported()`.
- `format.js` — shared formatters (`fmt1`, `pctStr`, `prettyDate`, `shiftDate`, `todayISO`, `clamp`, `DASH`).
### `supabase/migrations/`
- `0001_init.sql`, `0002_seed_codes.sql`, `0003_public_read_policies.sql` (run in order in the SQL editor).
### Root / config
- `.env.local` — secrets (git-ignored). `.npmrc` — yarnpkg mirror. `.gitignore`, `index.html`,
  `vite.config.js`, `package.json`.

## 5. Key decisions & rules (follow these)
- **Brand:** Jindal green **`#019639`** (wordmark) and red **`#E21C1C`** (sub-line) — EXACT, both
  themes, never restyle the logo. Amber `#e7a53c` (dark) / `#b9791f` (light, for contrast).
- **Metric units everywhere** (m, m/hr, L/hr, KL, hrs).
- **Never invent data.** Show `—` / honest empty / "Awaiting" / "pending GTO" / "coming soon" where
  data is absent. Real rig names only. This rule has been enforced on every screen.
- **Secrets live in `.env.local` only** (and Google OAuth JSONs) — **never committed**. Front-end
  uses the **publishable** key; scripts use the **secret** key. RLS is **ON** with read-only anon
  SELECT policies (`0003`).
- **Commit discipline:** commit only after the user approves. Before every commit run
  `git check-ignore .env.local google-credentials.json google-token.json` and confirm secrets +
  `samples/` + `daily-summary-preview.html` + `.processed-emails.json` are NOT staged.
- **Branch workflow (current):** feature branch **`feat/assets-settings-perf`** holds the perf +
  Assets + Settings commits; **do not push to `main`** — the user opens the PR themselves.
- **Windows gotchas seen repeatedly:** files saved with hidden double extensions
  (`.env.local`, `google-credentials.json.json`), Notepad appending `.txt`, and spaces in filenames
  (logo referenced as `/Jindal%20Logo.jpg`; sample is `23-07-2026-HJ#1Z .xls` with a `#` and a
  trailing space). `.env.local` values may have a leading space after `=` (loaders trim it).

## 6. NOT done / next steps (in order)
1. **Authentication + RLS enforcement** — `jindalmumbai.com` login, **admin approval** of first-time
   users (see the Settings → Admin Approvals placeholder), **OTP**. Then tighten RLS from
   blanket-read to per-role/per-user, and wire Settings → User Management / Approvals to real data
   (a `profiles` table).
2. **Hardening pass** — React error boundaries, graceful failure states, and an **atomic-write RPC**
   (a `plpgsql` `save_ddr_report()` called via `supabase.rpc`) to replace the non-atomic multi-step
   `saveReport()`.
3. **Deploy to Replit.**
4. **Well Plan feature (formerly "GTO feature")** — upload a planning doc, an extractor for it, an
   **Actual-vs-Planned Depth-vs-Days** chart, and it fills the Assets **well/project** data
   (currently "pending GTO") and likely **`planned_rop`** (Analytics target ROP auto-enables once
   that column exists). Design notes:
   - The 6 rigs run **two operation types**: **EXPLORATORY** (receives a **GTO**) and **WORKOVER**
     (receives a **well-data PDF**, ~50% similar to the GTO). Workover wells have **no GTO**.
   - Both docs provide a **PLANNED depth-vs-days progression**; **actual** is measured from the DDRs
     by date + depth.
   - Build a **unified "Well Plan" feature**: one PDF upload accepting either a GTO or a well-data
     PDF; each well tagged **Exploratory / Workover**; **one extractor** (tune on the GTO first, then
     adjust for the well-data PDF); **one** Actual-vs-Planned Depth-vs-Days chart serving both; the
     extracted well/project data fills the **Assets detail panel**.
   - **OPEN QUESTIONS for next session:** obtain a **workover well-data PDF sample**; confirm whether
     planned depth-vs-days is a **numeric table** (easy to extract) or **only a plotted curve** (hard);
     confirm **how exploratory vs workover is identified** per well.
5. **Aug-10 email-format tightening** — the standardized DDR emails start ~**10 Aug 2026**. Tighten
   the Gmail match rule + multi-attachment selection (which file is the daily report), and fix the
   **rig-name extraction** (Jindal Explorer file currently mis-extracts operator "ONGC OIM" as the
   rig name). Adopt the **ONGC activity code list (R-2)** to finalize `code_master` (replacing the
   draft `0002` codes).
6. **Fields to request from the rig team** (currently missing → shown as `—`): **WOB, RPM, planned
   ROP, well progress %, rig location**, and the **GTO** for authoritative well data.

## 7. How to run locally
```bash
# install (uses the yarnpkg mirror via .npmrc)
npm install

# run the dashboard
npm run dev          # http://localhost:5173

# pipeline scripts (run from project root)
node scripts/fetch-gmail.js                 # first run: opens a consent URL, saves google-token.json
node scripts/process-inbox.js               # dry run (no DB writes)
node scripts/process-inbox.js --save        # write matched reports to Supabase
node scripts/extract-ddr.js [file] [--save] # single-file extraction
node scripts/daily-summary.js 2026-07-23    # dry run → daily-summary-preview.html
node scripts/daily-summary.js 2026-07-23 --send   # email (needs RESEND_FROM / RESEND_TO)
```
Migrations: paste `supabase/migrations/0001..0003` into the Supabase **SQL Editor** in order.

**Required env vars in `.env.local`** (names only — never commit values):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, and (to enable `--send`) `RESEND_FROM`, `RESEND_TO`.

**Commit safely:** create a branch, run the `git check-ignore` checks above, stage explicitly,
verify no secrets/samples are staged, then commit with an approved message and push the feature
branch (not `main`).

## 8. Extra session context worth knowing
- **Current data state:** only **VIRTUE-1** exists in the `rigs` table, with one report for
  **2026-07-23** (well `HJ#1Z`, depth 1048 m). That day was mostly **Waiting on weather** → NPT ≈
  88%, no drilling (so ROP shows `—`). The other 5 roster rigs render as **Awaiting** until they
  report. `FLEET_ROSTER` = Virtue-1, Jindal Supreme, Jindal Explorer, Jindal Star, Discovery-1,
  Jindal Pioneer.
- **Real DDR emails today** are ad-hoc forwards from Nidhish Kumar with varied subjects (DDR/DPR/DRR)
  and sometimes **multiple** Excel attachments (a daily file + a season "master" workbook — the
  master is skipped by the size guard). Standardized emails begin ~10 Aug 2026.
- **Health Score** (Analytics matrix): `round(100 − npt_pct*0.6 − rop_shortfall_pct*0.4)`, clamped
  0–100; green ≥80, amber 50–79, red <50; `—` when inputs are missing.
- **Equipment downtime** is derived from `code_master` descriptions matching
  `repair|equipment|breakdown|maintenance` (currently code **22**), NOT invented MTBF.
- **git state at handoff:** `main` is at the Reports-page commit (last pushed). Branch
  `feat/assets-settings-perf` adds three commits — `perf: cache dashboard loaders + fix planned_rop`,
  `feat: assets page`, `feat: settings page` — plus this handoff doc. The branch is awaiting the
  user's PR. **Do not merge/push `main` without the user.**
- **Deferred UI decision:** the amber status color in light mode uses a darkened `#b9791f` for
  readability (vs exact brand `#e7a53c`).
- **Persistent memory** for this project also lives in the Claude Code memory directory
  (`~/.claude/projects/.../memory/`) — check `MEMORY.md` there for any additional notes.
