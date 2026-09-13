// scripts/extract-ddr.js
//
// Standalone DDR extraction test. Converts ONE daily drilling report Excel file
// (.xls or .xlsx) into standardized JSON matching our Supabase schema, using
// Claude for the extraction. Local only: it does NOT touch Supabase or email.
//
// Usage:
//   node scripts/extract-ddr.js [path/to/file.xls]
// If no path is given, the first Excel file in samples/ is used.
//
// ANTHROPIC_API_KEY is read from .env.local (never hardcoded).
//
// The core extraction is exported as extractDDR() so other scripts (e.g. a
// multi-run consistency harness) can reuse the exact same inputs.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import XLSX from 'xlsx'
import { getServerClient } from './supabase-server.js'

const MODEL = 'claude-haiku-4-5'
const HRS_TARGET = 24
const HRS_TOLERANCE = 0.5

// --- Load ANTHROPIC_API_KEY from .env.local (no dependency on dotenv) --------
// process.env wins: if the key is already in the environment (Replit Secrets /
// real env), return early and DON'T require a .env.local file. A missing
// .env.local is optional (local dev convenience only), never fatal — mirrors
// supabase-server.js's ensureEnvLoaded() so the deployed pipeline can run purely
// on Secrets. (The final ANTHROPIC_API_KEY presence check lives at use-time in
// extractDDR(), which throws a clear error if it's still unset.)
export function loadEnvLocal() {
  if (process.env.ANTHROPIC_API_KEY) return // already provided by the environment
  let text
  try {
    text = readFileSync('.env.local', 'utf8')
  } catch {
    return // no .env.local — fine; env may supply the key directly
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim() // tolerate a stray leading space after '='
    if (!(key in process.env)) process.env[key] = val
  }
}

// --- Locate the Excel file ---------------------------------------------------
export function resolveInputFile(explicitPath) {
  if (explicitPath) return explicitPath
  const dir = 'samples'
  const files = readdirSync(dir).filter((f) => /\.(xlsx|xls)$/i.test(f))
  if (files.length === 0) throw new Error(`No .xls/.xlsx file found in ${dir}/`)
  return path.join(dir, files[0])
}

// --- Excel -> lossless "SheetName!A1 = value" text lines ---------------------
// Position-independent: every non-empty cell of every sheet becomes one line,
// so different rig layouts don't need custom parsing.
export function excelToLines(filePath) {
  // Read bytes with Node's fs and parse from the buffer. The maintained SheetJS
  // ESM build does not auto-wire fs, so XLSX.readFile(path) fails; XLSX.read on
  // a buffer is the portable, filename-quirk-proof path (and fine for the
  // untrusted email attachments this will soon handle).
  const buf = readFileSync(filePath)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const lines = []
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    if (!ws) continue
    const addrs = Object.keys(ws)
      .filter((a) => a[0] !== '!')
      .sort((a, b) => {
        const ca = XLSX.utils.decode_cell(a)
        const cb = XLSX.utils.decode_cell(b)
        return ca.r - cb.r || ca.c - cb.c
      })
    for (const addr of addrs) {
      const cell = ws[addr]
      // Prefer the formatted text (.w) so dates/numbers read as shown; fall back to raw value.
      const value = cell.w != null ? cell.w : cell.v
      if (value == null) continue
      const text = String(value).trim()
      if (text === '') continue
      lines.push(`${sheetName}!${addr} = ${text}`)
    }
  }
  return lines
}

// --- Load the AUTHORITATIVE activity codes from the LIVE code_master table ----
// (migration 0022: 75 IADC codes with condition RODR/NODR/EBDR/MDR + is_npt).
// NOT from 0002_seed_codes.sql (stale draft) — the live table is the source of
// truth the FK enforces and that drives billing/KPI classification.
export async function loadCodeMaster() {
  const sb = getServerClient()
  const { data, error } = await sb
    .from('code_master')
    .select('code, description, condition, is_npt')
    .order('code')
  if (error) throw new Error(`load code_master failed: ${error.message}`)
  return data || []
}

// --- Canonical rig roster (the 6 known rigs) --------------------------------
// Loaded from the LIVE rigs table (authoritative, sort_order); falls back to the
// known 6 if the query is unavailable. Claude maps the (possibly typo'd) sheet
// rig name to EXACTLY one of these — never a new variant.
const FALLBACK_ROSTER = [
  'Discovery-1', 'Virtue-1', 'Jindal Star', 'Jindal Explorer', 'Jindal Pioneer', 'Jindal Supreme',
]
export async function loadRigRoster() {
  try {
    const sb = getServerClient()
    const { data, error } = await sb.from('rigs').select('name, sort_order').order('sort_order')
    if (error) throw error
    const names = (data || []).map((r) => r.name).filter(Boolean)
    return names.length ? names : FALLBACK_ROSTER
  } catch {
    return FALLBACK_ROSTER
  }
}

// --- Structured-output JSON schema (matches the DB) --------------------------
const num = { type: ['number', 'null'] }
const str = { type: ['string', 'null'] }

// The API caps schemas at 16 union-typed (nullable) params. The activity +
// inventory nullables already sit near that cap, so the ~23 DDR HEADER fields are
// modelled as a nested `header` object of NON-nullable strings ("" = absent) —
// which add ZERO unions — and coerced to typed values (numbers/ISO dates/null) in
// extractDDR via coerceHeader(). rig_name/report_date stay top-level (the RPC
// needs them to resolve the rig + upsert key).
const hs = { type: 'string' } // header field: non-nullable string, "" means absent
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rig_name: { type: 'string' },
    report_date: { type: 'string', description: 'ISO date, yyyy-mm-dd' },
    header: {
      type: 'object',
      additionalProperties: false,
      properties: {
        well_no: hs, report_no: hs,
        days_on_location: hs, days_on_well: hs,
        depth_md_m: hs, depth_tvd_m: hs, day_meterage_m: hs,
        present_operation: hs, next_operation: hs,
        spud_date: hs, move_in_date: hs, oim: hs,
        pob_total: hs, lti_days: hs,
        fuel_open_kl: hs, fuel_recv_kl: hs, fuel_consumed_kl: hs, fuel_close_kl: hs, diesel_rob_kl: hs,
        downtime_daily_hrs: hs, downtime_cum_hrs: hs,
        daily_cost: hs, cumulative_cost: hs,
      },
      required: [
        'well_no', 'report_no', 'days_on_location', 'days_on_well',
        'depth_md_m', 'depth_tvd_m', 'day_meterage_m', 'present_operation', 'next_operation',
        'spud_date', 'move_in_date', 'oim', 'pob_total', 'lti_days',
        'fuel_open_kl', 'fuel_recv_kl', 'fuel_consumed_kl', 'fuel_close_kl', 'diesel_rob_kl',
        'downtime_daily_hrs', 'downtime_cum_hrs', 'daily_cost', 'cumulative_cost',
      ],
    },
    activities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          block: { type: 'string', description: '"own_day" (00:00-24:00) or "next_morning" (00:00-06:00)' },
          time_from: str,
          time_to: str,
          hrs: { type: 'number' },
          raw_code: { type: 'string', description: 'the bare family code as written on the sheet' },
          code: { type: ['string', 'null'], description: 'mapped code_master code; null if not confident' },
          depth_in_m: num,
          depth_out_m: num,
          remarks: { type: 'string' },
        },
        required: ['block', 'time_from', 'time_to', 'hrs', 'raw_code', 'code', 'depth_in_m', 'depth_out_m', 'remarks'],
      },
    },
    inventory: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item: { type: 'string' },
          unit: str,
          opening: num,
          received: num,
          generated: num,
          consumed: num,
          closing: num,
        },
        required: ['item', 'unit', 'opening', 'received', 'generated', 'consumed', 'closing'],
      },
    },
  },
  required: [
    'rig_name',
    'report_date',
    'header',
    'activities',
    'inventory',
  ],
}

function buildPrompt(cellLines, codes, roster) {
  const codeList = codes
    .map((c) => `  ${c.code} = ${c.description} [${c.condition || '—'}${c.is_npt ? ', NPT' : ''}]`)
    .join('\n')
  const rigList = (roster || []).map((r) => `  - ${r}`).join('\n')

  return [
    'You are extracting ONE daily drilling report (DDR) into standardized JSON.',
    '',
    'The report is given as a lossless dump of every non-empty spreadsheet cell,',
    'one per line, in the form `SheetName!CellRef = value`. Layouts vary between rigs,',
    'so infer meaning from labels and nearby cells rather than fixed positions.',
    '',
    'GENERAL RULES:',
    '- report_date MUST be ISO format yyyy-mm-dd.',
    '',
    'RIG NAME (constrained to the known fleet):',
    '- The report belongs to EXACTLY ONE of these canonical rigs:',
    rigList,
    '- Set `rig_name` to the EXACT canonical name it matches, resolving typos, case, spacing',
    '  and punctuation. Example: a sheet saying "JINADAL STAR" -> "Jindal Star";',
    '  "JINDAL SUPREME" -> "Jindal Supreme". Return the name spelled EXACTLY as in the list',
    '  above — never a new spelling or variant.',
    '- Set `raw_rig_name` to the rig name EXACTLY as written on the sheet (for audit).',
    '- If you genuinely cannot confidently match the sheet to one of the canonical rigs, set',
    '  `rig_name` to "UNKNOWN" (do NOT guess a rig).',
    '',
    'HEADER FIELDS (-> header{}): locate each by its LABEL and read the adjacent value.',
    'Match on the label text, NOT cell position (layouts differ between rigs). Return EVERY',
    'header field as a STRING. If a field is genuinely absent, return "" (empty string) —',
    'NEVER guess or invent. Keep dates roughly as written (they are normalized downstream);',
    'strip obvious unit suffixes from numbers where easy. Label hints:',
    '  well_no <- "Well No"',
    '  report_no <- the value in the cell directly next to the "Report No." label ONLY.',
    '     Do NOT use the "GTO No", "WO ...", or well/contract number. If the "Report No."',
    '     cell has no value, return "" (do not substitute a nearby number).',
    '  days_on_location <- "Days on Loc"     days_on_well <- "Days on Well"',
    '  depth_md_m <- "Depth MD (m)"',
    '  depth_tvd_m <- a top-level "Depth TVD (m)" field ONLY. Ignore "TVD" column headers',
    '     inside the casing / BHA tables. If there is no top-level TVD field, return "".',
    '  day_meterage_m <- today\'s drilled meterage ("Days met / Monthly meterage"); "" if blank',
    '  present_operation <- "Present Operation"   next_operation <- planned/next ops (if present)',
    '  spud_date <- "OPERATION START/SPUD DATE"   move_in_date <- "Move in date"',
    '  oim <- "OIM / Tool Pushers"           pob_total <- Personnel Onboard "TOTAL"',
    '  lti_days <- "No LTI Days"',
    '  fuel_open_kl / fuel_recv_kl / fuel_consumed_kl / fuel_close_kl / diesel_rob_kl',
    '     <- the "Fuel Oil (KL)" bulk row (opening / received / consumed / closing;',
    '        diesel_rob_kl = the remaining-on-board / closing figure for fuel oil)',
    '  downtime_daily_hrs <- "Monthly Rig Downtime" -> "Daily"',
    '  downtime_cum_hrs   <- "Monthly Rig Downtime" -> cumulative',
    '  daily_cost <- "Daily Cost"            cumulative_cost <- "Cum Cost"',
    '',
    'ACTIVITIES (the operations time-log -> activities[]):',
    'The time-log appears in TWO blocks, each under "FROM"/"TO" column headers:',
    '  * an OWN-DAY block headed "00:00 TO 24:00"  (the report\'s own calendar day), and',
    '  * a NEXT-MORNING block headed "00:00 to 06:00" (the following day\'s early hours;',
    '    its header may even show the next date).',
    'Parse EVERY row of BOTH blocks. Tag each row with `block`: "own_day" for rows in the',
    '00:00-24:00 block, "next_morning" for rows in the 00:00-06:00 block. If the block',
    'structure is genuinely unclear, tag rows "own_day" (never drop a row).',
    'DO NOT extract the fluid/mud-properties table (headed "Time" with columns like M/Wt-PPG,',
    'VIS, PV/YP, R6/R3, GEL) — that is NOT the operations log; skip it entirely.',
    '',
    'For each activity row output: block, time_from, time_to (clock times as written — they',
    'are normalized to HH:MM downstream), hrs (the duration from the hours column, a decimal),',
    'depth_in_m / depth_out_m if present, remarks (the full operation description), and the',
    'codes as follows:',
    '- raw_code = the BARE code exactly as written in the code column (e.g. "6", "23", "16").',
    '- code = the specific code_master code it maps to. The sheet writes a bare FAMILY number,',
    '  not the full IADC sub-code, so map using the family number + the remark description:',
    '    * single-member families (e.g. 6 -> 6A) are unambiguous;',
    '    * multi-member families (e.g. 21, 22, 23, 24) -> pick the sub-code whose code_master',
    '      description best matches the remark;',
    '    * if a row already shows a full sub-code (a letter suffix, e.g. "6A"), use it directly.',
    '  Use the on-sheet code legend only as a hint to what a number means; ALWAYS choose the',
    '  final code from the code_master list below, by description.',
    '- If you CANNOT confidently choose a specific sub-code, set code to null (keep raw_code).',
    '  NEVER guess or store a wrong code.',
    '',
    'INVENTORY (the bulk / mud & materials table, often headed "BULK" -> inventory[]):',
    '- Output ONE row for EVERY row of the inventory table — e.g. P/Water, D/Water,',
    '  Fuel Oil, B. Cement / Neat Cement, Barite, Base Oil, Premix, and any others present.',
    '  Do NOT skip a row even if all of its numbers are zero.',
    '- ALWAYS include the Fuel Oil / diesel row whenever it appears in the table.',
    '- The columns, in order, are: Opening balance -> Received -> Made/Generated -> Consumed',
    '  -> Closing. The made/generated column may be labelled "MADE"; map it to `generated`.',
    '  Be careful not to shift Consumed/Closing when a Made/Generated column is present.',
    '- Separate the unit from the item name: put the clean name in `item` and the unit of',
    '  measure in `unit`. Examples: "Fuel Oil (KL)" -> item "Fuel Oil", unit "KL";',
    '  "D/Water(MT)" -> item "D/Water", unit "MT". If a row has no unit, set unit null but',
    '  still output the item.',
    '',
    'Valid activity codes (code = description [condition]):',
    codeList,
    '',
    '--- BEGIN CELL DUMP ---',
    cellLines.join('\n'),
    '--- END CELL DUMP ---',
  ].join('\n')
}

// --- Header coercion: model returns strings ("" = absent); convert to typed ---
// Never invents: unparseable / blank / "nil"/"na" => null.
const BLANK = /^(nil|na|n\/?a|-|--|none)$/i
function coerceText(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' || BLANK.test(s) ? null : s
}
function coerceNum(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || BLANK.test(s)) return null
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/) // first number; strips units (KL, hrs, m, Kips)
  return m ? Number(m[0]) : null
}
function coerceInt(v) {
  const n = coerceNum(v)
  return n == null ? null : Math.round(n)
}
// dd.mm.yyyy | dd/mm/yyyy | dd-mm-yyyy | ISO, tolerant of "@ 1730 HRS" suffixes and
// typo'd years ("02.05.02026" -> 2026). Unparseable => null (never guess).
export function coerceDate(v) {
  if (v == null) return null
  let s = String(v).trim()
  if (s === '' || BLANK.test(s)) return null
  s = s.replace(/@.*$/, '').replace(/\b\d{3,4}\s*hrs?\b.*$/i, '').trim() // drop time suffixes
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) // ISO
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,6})/) // dd mm yyyy (any separator)
  if (m) {
    let [, dd, mm, yy] = m
    if (yy.length > 4) yy = yy.slice(-4)        // "02026" typo -> "2026"
    else if (yy.length === 2) yy = '20' + yy
    if (+dd >= 1 && +dd <= 31 && +mm >= 1 && +mm <= 12) {
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    }
  }
  return null
}

// Coerce the raw header object (all strings) into typed values.
export function coerceHeader(h) {
  h = h || {}
  return {
    well_no: coerceText(h.well_no),
    report_no: coerceText(h.report_no),
    days_on_location: coerceNum(h.days_on_location),
    days_on_well: coerceNum(h.days_on_well),
    depth_md_m: coerceNum(h.depth_md_m),
    depth_tvd_m: coerceNum(h.depth_tvd_m),
    day_meterage_m: coerceNum(h.day_meterage_m),
    present_operation: coerceText(h.present_operation),
    next_operation: coerceText(h.next_operation),
    spud_date: coerceDate(h.spud_date),
    move_in_date: coerceDate(h.move_in_date),
    oim: coerceText(h.oim),
    pob_total: coerceInt(h.pob_total),
    lti_days: coerceInt(h.lti_days),
    fuel_open_kl: coerceNum(h.fuel_open_kl),
    fuel_recv_kl: coerceNum(h.fuel_recv_kl),
    fuel_consumed_kl: coerceNum(h.fuel_consumed_kl),
    fuel_close_kl: coerceNum(h.fuel_close_kl),
    diesel_rob_kl: coerceNum(h.diesel_rob_kl),
    downtime_daily_hrs: coerceNum(h.downtime_daily_hrs),
    downtime_cum_hrs: coerceNum(h.downtime_cum_hrs),
    daily_cost: coerceNum(h.daily_cost),
    cumulative_cost: coerceNum(h.cumulative_cost),
  }
}

// Clock time -> canonical HH:MM. Accepts "10.30", "10:30", "6.00", "0.30", "24.00", "3".
export function coerceTime(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '' || BLANK.test(s)) return null
  const m = s.match(/^(\d{1,2})\s*[.:h]\s*(\d{1,2})/) || s.match(/^(\d{1,2})$/)
  if (!m) return null
  const hh = String(Math.min(24, parseInt(m[1], 10))).padStart(2, '0')
  const mm = String(parseInt(m[2] ?? '0', 10) || 0).padStart(2, '0')
  return `${hh}:${mm}`
}

// ISO date + N days -> ISO (used to LOG the next-morning block's date; not stored).
function addDaysISO(iso, n) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// --- Core extraction (reusable) ---------------------------------------------
export async function extractDDR(inputFile) {
  loadEnvLocal()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in .env.local')

  const cellLines = excelToLines(inputFile)
  const codes = await loadCodeMaster()
  const roster = await loadRigRoster()
  const client = new Anthropic({ apiKey })

  // Constrain rig_name to the canonical roster (+ "UNKNOWN") via a schema enum so
  // Claude can never invent a variant; add raw_rig_name for audit. Built per run
  // so the roster stays authoritative (from the live rigs table).
  const schema = structuredClone(SCHEMA)
  schema.properties.rig_name = { type: 'string', enum: [...roster, 'UNKNOWN'] }
  schema.properties.raw_rig_name = { type: 'string' }
  if (!schema.required.includes('raw_rig_name')) schema.required = [...schema.required, 'raw_rig_name']

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    temperature: 0, // near-deterministic output (allowed on Haiku 4.5)
    system:
      'You are a meticulous data-extraction engine for oil & gas daily drilling reports. ' +
      'Return only what the source supports; never fabricate values.',
    messages: [{ role: 'user', content: buildPrompt(cellLines, codes, roster) }],
    output_config: { format: { type: 'json_schema', schema } },
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('No text block in model response.')
  const result = JSON.parse(textBlock.text)

  // Coerce the header strings -> typed values (dates ISO, numbers plain, ""->null)
  // so the dry-run print and the DB payload both see clean, honest data.
  result.header = coerceHeader(result.header)
  // Normalize report_date too (keep the raw value if unparseable so validate flags it).
  result.report_date = coerceDate(result.report_date) ?? result.report_date

  // --- Stage B: normalize activity times + own-day / next-morning split -------
  const rawActs = Array.isArray(result.activities) ? result.activities : []
  for (const a of rawActs) {
    a.time_from = coerceTime(a.time_from)
    a.time_to = coerceTime(a.time_to)
  }
  // Anything not explicitly tagged next_morning is treated as own_day (never drop data).
  const nextMorning = rawActs.filter((a) => a.block === 'next_morning')
  const ownDay = rawActs.filter((a) => a.block !== 'next_morning')
  const nextMorningDate = addDaysISO(result.report_date, 1)
  // Own-day rows carry activity_date = report_date; drop the transient block tag.
  for (const a of ownDay) { a.activity_date = result.report_date; delete a.block }
  for (const a of nextMorning) delete a.block

  const sumHrs = (list) => list.reduce((s, a) => s + (typeof a.hrs === 'number' ? a.hrs : 0), 0)
  result._verify = {
    ownDayHrs: sumHrs(ownDay),
    nextMorningHrs: sumHrs(nextMorning),
    totalHrs: sumHrs(rawActs),
    ownDayCount: ownDay.length,
    nextMorningCount: nextMorning.length,
    nextMorningDate,                 // computed for cross-checking; NOT stored
    nextMorning,                     // kept for the dry-run log only; NOT saved
  }
  // STORE ONLY the own-day block — the next report persists the next morning as its own day.
  result.activities = ownDay

  return { result, codes, roster, cellCount: cellLines.length }
}

// --- Validation --------------------------------------------------------------
export function validate(result, codes, roster = FALLBACK_ROSTER) {
  const validCodes = new Set(codes.map((c) => c.code))
  const rigSet = new Set(roster)
  const checks = []

  const rigOk = rigSet.has(result.rig_name)
  checks.push({
    name: 'rig_name is one of the canonical rigs (typo/case resolved)',
    pass: rigOk,
    detail: rigOk
      ? `${JSON.stringify(result.rig_name)} (raw: ${JSON.stringify(result.raw_rig_name)})`
      : `unresolved rig_name=${JSON.stringify(result.rig_name)} (raw: ${JSON.stringify(result.raw_rig_name)}) — not one of the 6`,
  })

  const requiredPresent =
    result.rig_name != null &&
    String(result.rig_name).trim() !== '' &&
    result.report_date != null &&
    String(result.report_date).trim() !== '' &&
    Array.isArray(result.activities) &&
    result.activities.length > 0
  checks.push({
    name: 'Required fields present (rig_name, report_date, >=1 activity)',
    pass: requiredPresent,
    detail: requiredPresent
      ? ''
      : `rig_name=${JSON.stringify(result.rig_name)}, report_date=${JSON.stringify(
          result.report_date
        )}, activities=${Array.isArray(result.activities) ? result.activities.length : 'n/a'}`,
  })

  const isoOk =
    typeof result.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.report_date)
  checks.push({
    name: 'report_date is ISO yyyy-mm-dd',
    pass: isoOk,
    detail: isoOk ? '' : `got ${JSON.stringify(result.report_date)}`,
  })

  const unknown = []
  const activities = Array.isArray(result.activities) ? result.activities : []
  activities.forEach((a, i) => {
    if (!validCodes.has(a.code)) unknown.push(`row ${i + 1}: ${JSON.stringify(a.code)}`)
  })
  checks.push({
    name: 'Every activity code exists in code_master',
    pass: unknown.length === 0,
    detail: unknown.length === 0 ? `${activities.length} activities, all codes valid` : unknown.join('; '),
  })

  // Stage B: OWN-DAY hours must total ~24h. FATAL (-> needs_review) but the report
  // is still SAVED (saveReport always writes; status just reflects validation).
  const v = result._verify || {}
  const ownDayHrs = typeof v.ownDayHrs === 'number'
    ? v.ownDayHrs
    : activities.reduce((s, a) => s + (typeof a.hrs === 'number' ? a.hrs : 0), 0)
  // Exclusive tolerance: exactly 0.5h off (e.g. 24.5) FLAGS needs_review, as intended.
  const ownDayOk = Math.abs(ownDayHrs - HRS_TARGET) < HRS_TOLERANCE
  checks.push({
    name: `Own-day activity hours ~= ${HRS_TARGET} (within <${HRS_TOLERANCE}h)`,
    pass: ownDayOk,
    detail: `own-day total = ${ownDayHrs.toFixed(2)} h across ${activities.length} stored activities`,
  })

  // --- WARNINGS / INFO (non-fatal) ---------------------------------------------
  const warnings = []
  // Overlap reconciliation (next-morning is parsed for check, discarded from storage).
  warnings.push(
    `overlap: own-day ${Number(ownDayHrs).toFixed(2)}h (stored) + next-morning ` +
    `${Number(v.nextMorningHrs || 0).toFixed(2)}h (${v.nextMorningCount || 0} rows, date ` +
    `${v.nextMorningDate || 'n/a'}, DISCARDED) = total ${Number(v.totalHrs || 0).toFixed(2)}h`
  )
  const nullCodes = activities
    .map((a, i) => (a.code == null ? `row ${i + 1} raw_code=${JSON.stringify(a.raw_code)} (${String(a.remarks).slice(0, 40)})` : null))
    .filter(Boolean)
  if (nullCodes.length) warnings.push(`UNMAPPED codes (code=null -> needs_review): ${nullCodes.join(' | ')}`)

  // Header sanity — informational; an ABSENT (null) field is legitimate, never a fail.
  const h = result.header || {}
  const isISO = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  for (const f of ['spud_date', 'move_in_date']) {
    if (h[f] != null && !isISO(h[f])) warnings.push(`header.${f} not ISO after coercion: ${JSON.stringify(h[f])}`)
  }
  const missing = Object.keys(h).filter((k) => h[k] == null)
  if (missing.length) warnings.push(`header fields absent (null): ${missing.join(', ')}`)

  return { checks, warnings, totalHrs: ownDayHrs }
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const fileArg = args.find((a) => !a.startsWith('-')) // first non-flag arg = file path
  const inputFile = resolveInputFile(fileArg)
  console.log(`Input file : ${inputFile}`)
  console.log(`Mode       : ${doSave ? 'SAVE (writing to Supabase)' : 'DRY RUN (print only) — pass --save to write'}`)

  const { result, codes, roster, cellCount } = await extractDDR(inputFile)
  console.log(`Cells read : ${cellCount} non-empty cells`)
  console.log(`Code master: ${codes.length} valid activity codes loaded`)
  console.log(`Rig roster : ${roster.join(', ')}`)

  console.log('\n===================== EXTRACTED HEADER ====================')
  console.log(`rig_name     : ${JSON.stringify(result.rig_name)}   (raw_rig_name: ${JSON.stringify(result.raw_rig_name)})`)
  console.log(`report_date  : ${JSON.stringify(result.report_date)}`)
  console.log(JSON.stringify(result.header, null, 2))

  const v = result._verify || {}
  console.log('\n===================== OWN-DAY ACTIVITIES (STORED) ========')
  console.log(`activity_date = ${result.report_date}`)
  console.log('  #  | from  - to    | hrs  | raw -> code | remarks')
  result.activities.forEach((a, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)} | ${a.time_from ?? '??:??'} - ${a.time_to ?? '??:??'} | ` +
      `${String(a.hrs).padStart(4)} | ${String(a.raw_code).padStart(3)} -> ${a.code ?? 'NULL'} | ${String(a.remarks).slice(0, 52)}`
    )
  })

  console.log('\n----------------- NEXT-MORNING (PARSED, DISCARDED) -------')
  console.log(`date ${v.nextMorningDate || 'n/a'} — ${v.nextMorningCount || 0} rows, ${Number(v.nextMorningHrs || 0).toFixed(2)}h (NOT stored)`)
  ;(v.nextMorning || []).forEach((a) => {
    console.log(`     ${a.time_from ?? '??:??'} - ${a.time_to ?? '??:??'} | ${String(a.hrs).padStart(4)} | ${String(a.raw_code).padStart(3)} -> ${a.code ?? 'NULL'} | ${String(a.remarks).slice(0, 44)}`)
  })

  console.log('\n----------------- OVERLAP RECONCILIATION -----------------')
  console.log(`own-day ${Number(v.ownDayHrs || 0).toFixed(2)}h + next-morning ${Number(v.nextMorningHrs || 0).toFixed(2)}h = total ${Number(v.totalHrs || 0).toFixed(2)}h`)

  const { checks, warnings, totalHrs } = validate(result, codes, roster)

  console.log('\n===================== VALIDATION REPORT ==================')
  let allPass = true
  for (const c of checks) {
    const status = c.pass ? 'PASS' : 'FAIL'
    if (!c.pass) allPass = false
    console.log(`[${status}] ${c.name}${c.detail ? `  — ${c.detail}` : ''}`)
  }
  console.log(`\nOverall (fatal checks): ${allPass ? 'PASS' : 'FAIL'}`)
  if (warnings.length) {
    console.log('\n--------------------- WARNINGS (non-fatal) ---------------')
    for (const w of warnings) console.log(`[WARN] ${w}`)
  }

  console.log('\n===================== TOTALS =============================')
  console.log(`Total activity hours: ${totalHrs.toFixed(2)} h (target ${HRS_TARGET} +/-${HRS_TOLERANCE})`)
  console.log(`Activities: ${result.activities?.length ?? 0} | Inventory rows: ${result.inventory?.length ?? 0}`)

  if (!doSave) {
    console.log('\nNote: DRY RUN — nothing was written to Supabase or emailed. Re-run with --save to persist.')
    return
  }

  // --- SAVE: hand off to the server-side writer (secret key; not front-end) ---
  console.log('\n===================== SUPABASE WRITE ======================')
  const { saveReport } = await import('./supabase-server.js')
  const summary = await saveReport(result, { validationPassed: allPass })
  console.log(`Rig        : "${summary.rigName}" (${summary.rigCreated ? 'CREATED' : 'existing'}, id=${summary.rigId})`)
  console.log(`Report     : ${summary.reportAction.toUpperCase()} (id=${summary.reportId})`)
  console.log(`Activities : ${summary.activitiesWritten} written${summary.nulledCodeCount ? ` (${summary.nulledCodeCount} with code nulled)` : ''}`)
  console.log(`Inventory  : ${summary.inventoryWritten} written`)
  if (summary.unknownCodes.length) {
    console.log(`Unknown codes (not in code_master): ${summary.unknownCodes.join(', ')}`)
  }
  console.log(`extraction_status: ${summary.extractionStatus}`)
  console.log('\nDone. Emailing is still out of scope (not implemented yet).')
}

// Run the CLI only when executed directly (not when imported).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
