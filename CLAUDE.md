# DDR Tracker — Project State / Handoff

_Handoff notes so a future Claude Code session can continue this project. Last updated: 2026-08-21._

## 1. What this project is
**DDR Tracker** is an internal tool for **Jindal Drilling & Industries Ltd.** It standardizes
**daily drilling reports (DDRs)** from **6 offshore rigs**. Reports arrive as Excel attachments by
**Gmail**; the pipeline downloads them, uses the **Claude API** to extract each into standardized
JSON, stores them in **Supabase**, presents a **fleet dashboard** (Fleet / Analytics / Reports /
Assets / Settings), and can send a **daily summary email**.

**Deployment status (2026-08-21):** the **dashboard is LIVE on Replit** at
**https://jdilorbit.replit.app** — a Vite SPA served as a **static build** (`dist/`). **Auth works
live** (Google sign-in restricted to `@jindalmumbai.com` + admin-approval gate; RLS enforced).
⚠️ **The live site may be BEHIND `main`** — several recent features (auth/security, IADC codes,
fleet rework, Well Plans, vision extractor) are merged to `main` but **not yet re-published to
Replit**. To catch up: in Replit, **Git → pull `main`, then Publish** (rebuild `dist/`).
The **background pipeline is NOT deployed yet** — Gmail ingest, DDR extraction, the daily summary
email, and the **well-plan extractor** all still run **manually via the Node scripts**
(`scripts/*.js`) on a local machine.

## 2. Tech stack
- **Front-end:** Vite + React (JavaScript, not TS). Dev server on `http://localhost:5173`.
- **Database:** Supabase (Postgres). New-style API keys: **publishable** (front-end, browser-safe)
  and **secret** (server-side scripts only).
- **Extraction:** Anthropic **Claude API**, **structured outputs** (`output_config.format` JSON
  schema). Two paths: **DDR/DOCX text → `claude-haiku-4-5`** (`temperature: 0`); **GTO PDF → VISION
  `claude-sonnet-5`** (no `temperature` param — deprecated on Claude 5). PDFs are rasterized to a
  page image (pdf-parse@2 `getScreenshot`) because GTO PDFs cipher their digits in the text layer.
  Deps for the well-plan extractor: **`mammoth`** (DOCX text) + **`pdf-parse`** (PDF render).
- **Excel:** SheetJS **`xlsx`** installed from the **CDN tarball** (`cdn.sheetjs.com/xlsx-0.20.3`)
  — the npm build had advisories. Parsing is buffer-based (`XLSX.read`).
- **Email intake:** **Gmail API** via `googleapis` (Desktop OAuth, loopback on port 4571).
- **Email send:** **Resend** (`resend` SDK).
- **Deploy (LIVE):** **Replit** — https://jdilorbit.replit.app. The **front-end only** is deployed
  as a **static Vite build** (`npm run build` → serve `dist/`). The Node **pipeline scripts are NOT
  deployed** (still run manually — see §6.1).
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
- `extract-ddr.js` — Excel → Claude → validate → (`--save`) DB. Core DDR extractor.
- `extract-wellplan.js` — **well-plan extractor** (DOCX→text / PDF→vision; `<id> --save`, no-arg=list).
- `supabase-server.js` — server-side (secret-key) writer, `saveReport()` (calls the 0009 RPC).
  **Never import in front-end.** `getServerClient()` is reused by `extract-wellplan.js`.
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
- **Added since:** `src/auth/` (`AuthProvider.jsx`, `LoginScreen.jsx`, `AccessStatusScreen.jsx`),
  `ErrorBoundary.jsx`, `LoadState.jsx`; Fleet `DowntimeChart.jsx`; Analytics `ILTTrendChart.jsx`,
  `ActualVsPlannedDays.jsx`, `WellLocationPanel.jsx`; Settings `WellPlansPanel.jsx`,
  `WellPlanDetail.jsx`; search `search.js` + `SearchBar.jsx`. (Removed: `RopChart.jsx`,
  `RopByRigChart.jsx`, `DieselVsDepthScatter.jsx`.)
### `supabase/migrations/` (all applied; run in order in the SQL editor)
- `0001_init` · `0002_seed_codes` (draft, replaced by 0005) · `0003_public_read` (superseded by 0008)
  · `0005_iadc_codes` · `0006_profiles` · `0007_bootstrap_admin` · `0008_rls_lockdown`
  · `0009_save_ddr_report` (atomic RPC) · `0010_rig_order` · `0011_security_hardening`
  · `0012_well_plans` · `0013_well_plans_manage`. **Next: `0014` adds `planned_depth_points jsonb`.**
### Root / config
- `.env.local` — secrets (git-ignored). `.npmrc` — yarnpkg mirror. `.gitignore`, `index.html`,
  `vite.config.js`, `package.json`.

## 5. Key decisions & rules (follow these)
- **Brand:** Jindal green **`#019639`** (wordmark) and red **`#E21C1C`** (sub-line) — EXACT, both
  themes, never restyle the logo. Amber `#E7A53C` (dark) / `#b9791f` (light, darkened for contrast
  on white). The **JDIL ORBIT** wordmark is a full-spectrum rainbow gradient (background-clip:text),
  centered under the logo, in the sidebar and on the (dark-forced) login.
- **Metric units everywhere** (m, m/hr, L/hr, KL, hrs, days).
- **Never invent / mock data — verify against the source.** Show `—` / honest empty / "Awaiting" /
  "pending" where data is absent. Real rig names only. **Two real scares this session:** (1) a
  temporary front-end **mock-data stub** left in a demo made a rig look like it had data it didn't;
  (2) the PDF extractor **hallucinated 131** planned days when the real GTO said **181** (ciphered
  text layer). Lessons now baked in: planned data must trace to the actual document; **always
  hard-refresh (Ctrl+Shift+R) and re-verify before trusting** a rendered result; and any demo stub
  must be reverted + the app reloaded to confirm the honest state before saying "done".
- **Secrets live in `.env.local` only** (and Google OAuth JSONs) — **never committed**. Front-end
  uses the **publishable** key; scripts use the **secret/service** key. **RLS is locked down** (0008):
  data readable only by **approved** authenticated users (anon = permission denied). **Writes are
  admin-only** for management actions (well_plans insert/update/delete, Storage upload/delete) and
  service-role-only for the DDR pipeline. The secret key is NEVER in the browser bundle (only
  `VITE_`-prefixed vars are bundled).
- **Commit discipline:** commit only after the user approves. Before every commit run
  `git check-ignore .env.local google-credentials.json google-token.json` and confirm secrets +
  `samples/` + `daily-summary-preview.html` + `.processed-emails.json` are NOT staged.
- **Branch workflow:** each feature on its own `feat/…` (or `fix/…`) branch → commit (with the
  check-ignore checks) → **push → the USER opens/merges the PR** (do not push to `main` directly,
  except the user has approved direct `docs:` commits to `main` for this handoff file). ⚠️ **GitHub
  ref-propagation lag:** after a merge, `git pull` on `main` sometimes says "Already up to date" for
  a minute — **only the PURPLE "successfully merged" message on GitHub counts**; re-pull shortly
  after. Verify a merge landed with `git ls-remote origin refs/heads/main` (live ref) + confirm the
  fast-forward.
- ⚠️ **WRONG-PROJECT trap (recurring):** the user has repeatedly run SQL against the wrong Supabase
  project (**"JDIL-Navigation"** instead of **"DDR-Tracker"**). **ALWAYS confirm the project name
  (top-left in the Supabase dashboard) before running any migration/SQL.** Bookmark the DDR-Tracker
  project URL. If a table/RLS "doesn't exist" unexpectedly, suspect the wrong project first.
- **Windows gotchas seen repeatedly:** files saved with hidden double extensions
  (`.env.local`, `google-credentials.json.json`), Notepad appending `.txt`, and spaces in filenames
  (logo referenced as `/Jindal%20Logo.jpg`; sample is `23-07-2026-HJ#1Z .xls` with a `#` and a
  trailing space). `.env.local` values may have a leading space after `=` (loaders trim it).

## 6. Status of the roadmap

### 6.0 DONE (was "next steps" — now shipped)
- ✅ **Authentication + admin approval + RLS enforcement** — Google sign-in restricted to
  `@jindalmumbai.com`; first-time users land on an **admin-approval gate** (pending/approved/rejected);
  a bootstrap admin is idempotently guaranteed. RLS is **locked down**: data readable only by
  authenticated **approved** users (anon/public read is closed). Migrations `0006` (profiles + trigger),
  `0007` (idempotent bootstrap admin), `0008` (RLS lockdown). Settings → Admin Approvals is live.
- ✅ **IADC code list** — official 75 codes + 13 benchmarks loaded (migration `0005`), with a
  `condition` (RODR/NODR/EBDR) column; `is_npt = (condition = 'EBDR')`. Marked `review_status='draft'`
  pending Jindal team confirmation.
- ✅ **Hardening pass** — React **error boundaries** (`src/ErrorBoundary.jsx`, app-level + per-view),
  **graceful fetch/retry** states on every screen (`src/dashboard/LoadState.jsx`), safe auth fallback,
  and an **atomic-write RPC** `save_ddr_report(payload jsonb)` (migration `0009`) replacing the
  non-atomic multi-step `saveReport()` (now calls `supabase.rpc`).
- ✅ **Deploy (front-end)** — LIVE on Replit at **https://jdilorbit.replit.app** (static Vite build).
- ✅ **Security hardening (migration `0011`)** — the `@jindalmumbai.com` rule is enforced **server-side**
  in `handle_new_user` (non-Jindal signups auto-`rejected`), the `SECURITY DEFINER` bootstrap helpers
  are locked down (`revoke execute` from public/anon/authenticated), `is_admin()` no longer granted to
  anon. Plus: CSV export formula-injection fix, and `npm audit` clean.
- ✅ **Well Plan feature — upload + management + document extractor** (migrations `0012`/`0013`).
  Admin uploads a GTO / well-data **PDF or DOCX** in **Settings → Well Plans** → stored in the private
  **`well-plans`** Storage bucket + a `well_plans` row. Admin **edit/delete** (deletes the row AND the
  Storage file — no orphans) and a **detail view** with a signed-URL file link + the extracted
  milestones table / history / notes. **Extractor** `scripts/extract-wellplan.js` (server-side,
  SERVICE + Anthropic keys) **routes by file type**: **DOCX → text** (`mammoth` + `claude-haiku-4-5`,
  real text layer) and **PDF → VISION** (rasterize the page with pdf-parse@2 `getScreenshot` →
  `claude-sonnet-5` reads the rendered image). Extracts **target depth, total planned days,
  planned_milestones[], well_history, key_notes** → writes back (`extraction_status` =
  extracted/needs_review/failed). **Runs manually via CLI** (`node scripts/extract-wellplan.js
  <well_plan_id> --save`; no arg = list rows+ids) — not deployed. RLS: reads = any approved user,
  writes = **admins only**; bucket private.
  - ⚠️ **WHY vision for PDFs:** GTO PDFs use custom-subset fonts with **no ToUnicode map**, so the
    text layer **ciphers the digits** (181 → "AXA"). Text extraction **hallucinated 131** planned
    days; the vision path read the real **181** off the rendered page. Never trust the PDF text layer
    for GTO numbers.
  - **Verified:** **IN#2** workover DOCX = **32** planned days, 14 ops milestones. **B-157N** GTO
    (Jindal Supreme) = **181** planned days (Rig Move 12 / Drilling 56 / Logging 23 / PT 04-objs 83 /
    Abandonment 7), **target depth 3800 m MSL = 3835 m MDKB** (KB = 35 m). Both saved to the DB as
    `extraction_status='extracted'`.
- ✅ **Analytics rework** — replaced the ROP-vs-target chart with an **ILT (Invisible Lost Time) trend**
  (per-rig daily `sum(max(0, actual_hrs − benchmark_norm))`, honest empty state until benchmarked DDR
  activities exist), and added the **"Actual vs Planned Days"** + **"Well & Location"** placeholders.
- ✅ **Fleet rework + branding/search** — **JDIL ORBIT** rainbow wordmark (sidebar + login), **light**
  default theme, **functional top-bar search** (rigs/wells/activity codes → navigate/highlight),
  premium glass login over the rig photo (dark-forced), ODR/NODR/EBDR clickable KPI cards, monthly
  downtime-per-rig chart, and a **fixed fleet display order** (migration `0010`, `rigs.sort_order`):
  **Discovery-1, Virtue-1, Jindal Star, Jindal Explorer, Jindal Pioneer, Jindal Supreme** — used
  everywhere.
- ✅ **Migrations 0005–0013 applied** (all run in Supabase): 0005 IADC codes+benchmarks, 0006/0007
  profiles+bootstrap admin, 0008 RLS lockdown, 0009 atomic save RPC, 0010 rig sort_order, 0011
  security hardening, 0012/0013 well_plans + Storage. **Bootstrap admin =
  `Akshay.Manjramkar@jindalmumbai.com`** (idempotently admin+approved).

### 6.1 IN PROGRESS — Depth-vs-Days (Actual vs Planned) chart  ← a fresh session PICKS UP HERE

Direction **DECIDED this session** (supersedes the earlier "days-based Actual-vs-Planned" panel):
build a **DEPTH-vs-DAYS** chart. Findings that set the design:
- **Days** come RELIABLY from the GTO **summary box** via vision (B-157N: 12/56/23/83/7 = 181 ✓).
- **Planned DEPTHS** come from the GTO's **plotted curve**. Vision CAN read the labelled milestone
  points (≈ 150 / 500 / 1665 / 3230 / 3835 m — matched the user's hints) but only at **LOW
  confidence** (DRAFT watermark + overlapping labels; the full page is downscaled to ~1568px, and a
  scale-3 render was too large for the API and returned no content). Per-phase days read *off the
  curve* were inconsistent — take days from the **summary box**, NOT the curve.
- ⇒ **Plan: extract depth milestones as a DRAFT, an admin VERIFIES/edits them against the GTO, then
  the chart uses the verified depths. NEVER trust auto-extracted depths unchecked.**

**PART 1 (build next):** add **`planned_depth_points jsonb`** to `well_plans` (new migration `0014`).
The extractor stores draft depth milestones (`{activity, planned_depth_m, cumulative_days,
confidence}`). The **Well Plan detail view** renders them **editable (admin-only)** with a "⚠️ verify
depths against the GTO" banner (they're low-confidence auto-reads). Then populate **B-157N** draft
depths and have the user verify. (A cropped high-res read of just the curve region may raise depth
confidence — worth trying.)

**PART 2 (after Part 1 verified):** the **Depth-vs-Days chart** on Analytics (replaces the current
"Actual vs Planned Days" panel). **Grey PLANNED line** from the verified depth points; **red ACTUAL
line** from DPRs (X = days since spud/commenced, Y = depth m MDKB). Plus a **day-by-day table**:
Planned Depth / Actual Depth / Daily Progress / Cumulative NPT / Variance / Remarks. The **ACTUAL
side is EMPTY until real DPRs exist** for the well. Reference: the user's own Depth-vs-Days AVP curve
screenshot (grey planned vs red actual; flat spots = NPT).

### 6.2 NEXT STEPS (after the chart)
1. **Re-publish to Replit** so the live site catches up with `main` (in Replit: Git pull `main` →
   Publish; rebuilds `dist/`).
2. **Deploy the background pipeline on a schedule** (Replit scheduled deployment / cron / Edge
   Function): Gmail ingest → DDR extraction → save, the **daily summary email**, AND
   **auto-run the well-plan extractor on upload** (this is where "auto-extract on upload" gets built —
   today it's a manual CLI). Needs Anthropic + Gmail OAuth + Resend + Supabase **service** keys
   server-side (never in the browser bundle).
3. **Wire condition / ILT display** into Reports + Analytics (surface RODR/NODR/EBDR groupings; ILT as
   a report metric). NPT semantics are now **`is_npt = EBDR` only** — reconcile the NPT views.
4. **Aug-10 items** — standardized DPR emails started ~**10 Aug 2026**. (a) Tighten the **Gmail match
   rule** + multi-attachment selection, fix the **rig-name extraction** (Jindal Explorer mis-reads
   operator "ONGC OIM" as the rig). (b) **Jindal team review of the RODR/NODR/EBDR draft**
   (`review_status='draft'`) → flip confirmed codes. (c) **NEW DPR FIELDS to request from the rig
   team** (currently shown as `—`): **WOB, RPM, planned/target ROP, well progress %, rig location,
   OIM name, current well, platform**, and — **critically for the chart's ACTUAL line —
   COMMENCED/SPUD DATE and CURRENT PHASE** (without these two the actual Depth-vs-Days line stays
   empty; the loader currently falls back to the earliest DPR date for "commenced").

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
node scripts/extract-ddr.js [file] [--save] # single-file DDR extraction
node scripts/daily-summary.js 2026-07-23    # dry run → daily-summary-preview.html
node scripts/daily-summary.js 2026-07-23 --send   # email (needs RESEND_FROM / RESEND_TO)

# well-plan extractor (DOCX→text / PDF→vision) — SERVICE + ANTHROPIC keys
node scripts/extract-wellplan.js                  # list well_plans rows + ids
node scripts/extract-wellplan.js <id>             # dry-run (print JSON, no write)
node scripts/extract-wellplan.js <id> --save      # extract + write back to the row
```
Migrations: paste `supabase/migrations/0001..0013` into the Supabase **SQL Editor** in order (all
applied already — see §4). ⚠️ **Confirm the Supabase project is "DDR-Tracker", not "JDIL-Navigation",
before running any SQL** (see §5).

**Required env vars in `.env.local`** (names only — never commit values):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`,
`RESEND_API_KEY`, and (to enable `--send`) `RESEND_FROM`, `RESEND_TO`.

**Commit safely:** create a branch, run the `git check-ignore` checks above, stage explicitly,
verify no secrets/samples are staged, then commit with an approved message and push the feature
branch (not `main`).

## 8. Extra session context worth knowing
- **Current data state:** **VIRTUE-1** has one DDR for **2026-07-23** (well `HJ#1Z`, 1048 m; mostly
  Waiting-on-weather → its activity codes were **nulled** by the IADC swap, so ROP/NPT show `—`).
  **Two extracted well plans exist:** **B-157N** (exploratory GTO, Jindal Supreme, 181 days) and
  **IN#2** (workover DOCX, Discovery-1, 32 days) — both `extraction_status='extracted'`. **No DPRs
  exist yet for B-157N or IN#2**, so the Actual-vs-Planned actual side is honestly empty. `FLEET_ROSTER`
  (raw list in `fleet.js`) = Virtue-1, Jindal Supreme, Jindal Explorer, Jindal Star, Discovery-1,
  Jindal Pioneer — but the **display order everywhere is `rigs.sort_order`** (0010): Discovery-1,
  Virtue-1, Jindal Star, Jindal Explorer, Jindal Pioneer, Jindal Supreme.
- **Real DDR emails today** are ad-hoc forwards from Nidhish Kumar with varied subjects (DDR/DPR/DRR)
  and sometimes **multiple** Excel attachments (a daily file + a season "master" workbook — the
  master is skipped by the size guard). Standardized emails begin ~10 Aug 2026.
- **Health Score** (Analytics matrix): `round(100 − npt_pct*0.6 − rop_shortfall_pct*0.4)`, clamped
  0–100; green ≥80, amber 50–79, red <50; `—` when inputs are missing.
- **Equipment downtime** is derived from `code_master` descriptions matching
  `repair|equipment|breakdown|maintenance` (currently code **22**), NOT invented MTBF.
- **git / branch state at handoff (2026-08-21):** `main` has everything in §6.0 (through the
  **vision extractor**) merged + this handoff commit. Open branches:
  - **`feat/actual-vs-planned`** — has **UNCOMMITTED** working-tree changes: the **days-based
    Actual-vs-Planned table/chart** (loader well-plan matching in `analytics.js`, `ActualVsPlannedDays.jsx`
    rewrite, CSS). It was **stashed** during this handoff and restored after. ⚠️ **A new session should
    `git status` / `git stash list` and DECIDE:** this days-based work may be **superseded** by the
    **Depth-vs-Days** direction (§6.1) — keep the loader's well-plan matching, but the panel will be
    reworked into the depth chart. Do NOT assume it's final.
  - **`fix/wellplan-pdf-parser`** — the standalone pdf-parse-v2 text fix; **now REDUNDANT** (superseded
    by the vision merge, which routes PDFs away from the text path). **Close that PR** if still open.
  - Everything else is merged to `main`.
- **Deferred UI decision:** the amber status color in light mode uses a darkened `#b9791f` for
  readability (vs exact brand `#e7a53c`).
- **Persistent memory** for this project also lives in the Claude Code memory directory
  (`~/.claude/projects/.../memory/`) — check `MEMORY.md` there for any additional notes.
