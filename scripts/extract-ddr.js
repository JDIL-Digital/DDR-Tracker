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

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import XLSX from 'xlsx'

const MODEL = 'claude-haiku-4-5'
const HRS_TARGET = 24
const HRS_TOLERANCE = 0.5

// --- Load ANTHROPIC_API_KEY from .env.local (no dependency on dotenv) --------
function loadEnvLocal() {
  let text
  try {
    text = readFileSync('.env.local', 'utf8')
  } catch {
    throw new Error('.env.local not found in the project root.')
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
function resolveInputFile() {
  const arg = process.argv[2]
  if (arg) return arg
  const dir = 'samples'
  const files = readdirSync(dir).filter((f) => /\.(xlsx|xls)$/i.test(f))
  if (files.length === 0) throw new Error(`No .xls/.xlsx file found in ${dir}/`)
  return path.join(dir, files[0])
}

// --- Excel -> lossless "SheetName!A1 = value" text lines ---------------------
// Position-independent: every non-empty cell of every sheet becomes one line,
// so different rig layouts don't need custom parsing.
function excelToLines(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true })
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

// --- Parse the valid activity codes from the seed migration ------------------
function loadCodeMaster() {
  const sql = readFileSync('supabase/migrations/0002_seed_codes.sql', 'utf8')
  const re = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*\)/g
  const codes = []
  let m
  while ((m = re.exec(sql)) !== null) {
    codes.push({ code: m[1], description: m[2], category: m[3], is_npt: m[4] === 'true' })
  }
  return codes
}

// --- Structured-output JSON schema (matches the DB) --------------------------
const num = { type: ['number', 'null'] }
const str = { type: ['string', 'null'] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  // Note: the API caps schemas at 16 union-typed (nullable) params, so the
  // always-present fields (rig_name, report_date, activity hrs/code, inventory
  // item) are non-nullable; the rest are nullable for genuinely-absent values.
  properties: {
    rig_name: { type: 'string' },
    well_no: str,
    report_no: str,
    report_date: { type: 'string', description: 'ISO date, yyyy-mm-dd' },
    depth_md_m: num,
    day_meterage_m: num,
    fuel_consumed_kl: num,
    activities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          time_from: str,
          time_to: str,
          hrs: { type: 'number' },
          code: { type: 'string' },
          depth_in_m: num,
          depth_out_m: num,
          remarks: str,
        },
        required: ['time_from', 'time_to', 'hrs', 'code', 'depth_in_m', 'depth_out_m', 'remarks'],
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
          consumed: num,
          closing: num,
        },
        required: ['item', 'unit', 'opening', 'received', 'consumed', 'closing'],
      },
    },
  },
  required: [
    'rig_name',
    'well_no',
    'report_no',
    'report_date',
    'depth_md_m',
    'day_meterage_m',
    'fuel_consumed_kl',
    'activities',
    'inventory',
  ],
}

function buildPrompt(cellLines, codes) {
  const codeList = codes
    .map((c) => `  ${c.code} = ${c.description} [${c.category}${c.is_npt ? ', NPT' : ''}]`)
    .join('\n')

  return [
    'You are extracting ONE daily drilling report (DDR) into standardized JSON.',
    '',
    'The report is given as a lossless dump of every non-empty spreadsheet cell,',
    'one per line, in the form `SheetName!CellRef = value`. Layouts vary between rigs,',
    'so infer meaning from labels and nearby cells rather than fixed positions.',
    '',
    'Rules:',
    '- report_date MUST be ISO format yyyy-mm-dd.',
    '- Numeric fields must be numbers (not strings); use null when a value is genuinely absent.',
    '- The time-log / operations table becomes activities[]. Each row: time_from, time_to,',
    '  hours (hrs), depth in/out if present, and a remark describing the operation.',
    '- For each activity, map the operation to the CLOSEST matching code from the list below,',
    '  and put that code string in the "code" field. Every activity must have a valid code.',
    '- Activities should together account for the full 24-hour day.',
    '- inventory[] holds materials/consumables rows (item, unit, opening, received, consumed, closing).',
    '',
    'Valid activity codes (code = description [category]):',
    codeList,
    '',
    '--- BEGIN CELL DUMP ---',
    cellLines.join('\n'),
    '--- END CELL DUMP ---',
  ].join('\n')
}

// --- Validation --------------------------------------------------------------
function validate(result, codes) {
  const validCodes = new Set(codes.map((c) => c.code))
  const checks = []

  // 1) Required top-level fields present
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

  // 1b) report_date is ISO yyyy-mm-dd
  const isoOk = typeof result.report_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(result.report_date)
  checks.push({
    name: 'report_date is ISO yyyy-mm-dd',
    pass: isoOk,
    detail: isoOk ? '' : `got ${JSON.stringify(result.report_date)}`,
  })

  // 2) Sum of activity hours ~ 24 (+/- 0.5)
  const activities = Array.isArray(result.activities) ? result.activities : []
  const totalHrs = activities.reduce((sum, a) => sum + (typeof a.hrs === 'number' ? a.hrs : 0), 0)
  const hrsOk = Math.abs(totalHrs - HRS_TARGET) <= HRS_TOLERANCE
  checks.push({
    name: `Total activity hours ~= ${HRS_TARGET} (+/-${HRS_TOLERANCE})`,
    pass: hrsOk,
    detail: `total = ${totalHrs.toFixed(2)} h`,
  })

  // 3) Every activity code exists in code_master
  const unknown = []
  activities.forEach((a, i) => {
    if (!validCodes.has(a.code)) unknown.push(`row ${i + 1}: ${JSON.stringify(a.code)}`)
  })
  checks.push({
    name: 'Every activity code exists in code_master',
    pass: unknown.length === 0,
    detail: unknown.length === 0 ? `${activities.length} activities, all codes valid` : unknown.join('; '),
  })

  return { checks, totalHrs }
}

// --- Main --------------------------------------------------------------------
async function main() {
  loadEnvLocal()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in .env.local')

  const inputFile = resolveInputFile()
  console.log(`Input file : ${inputFile}`)

  const cellLines = excelToLines(inputFile)
  console.log(`Cells read : ${cellLines.length} non-empty cells`)

  const codes = loadCodeMaster()
  console.log(`Code master: ${codes.length} valid activity codes loaded`)

  const client = new Anthropic({ apiKey })

  console.log(`\nCalling ${MODEL} (structured output)...`)
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system:
      'You are a meticulous data-extraction engine for oil & gas daily drilling reports. ' +
      'Return only what the source supports; never fabricate values.',
    messages: [{ role: 'user', content: buildPrompt(cellLines, codes) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('No text block in model response.')

  let result
  try {
    result = JSON.parse(textBlock.text)
  } catch (err) {
    console.error('Failed to parse model output as JSON:\n', textBlock.text)
    throw err
  }

  // --- Output ---
  console.log('\n===================== EXTRACTED JSON =====================')
  console.log(JSON.stringify(result, null, 2))

  const { checks, totalHrs } = validate(result, codes)

  console.log('\n===================== VALIDATION REPORT ==================')
  let allPass = true
  for (const c of checks) {
    const status = c.pass ? 'PASS' : 'FAIL'
    if (!c.pass) allPass = false
    console.log(`[${status}] ${c.name}${c.detail ? `  — ${c.detail}` : ''}`)
  }
  console.log(`\nOverall: ${allPass ? 'PASS' : 'FAIL'}`)

  console.log('\n===================== TOTALS =============================')
  console.log(`Total activity hours: ${totalHrs.toFixed(2)} h (target ${HRS_TARGET} +/-${HRS_TOLERANCE})`)
  console.log(`Activities: ${result.activities?.length ?? 0} | Inventory rows: ${result.inventory?.length ?? 0}`)

  console.log('\nNote: nothing was written to Supabase or emailed (extraction test only).')
}

main().catch((err) => {
  console.error('\nERROR:', err.message)
  process.exitCode = 1
})
