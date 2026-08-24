// scripts/extract-dmr.js
//
// SERVER-SIDE ONLY (uses the Supabase SECRET key — never the browser).
//
// DMR (Daily Maintenance Report) extractor — Stage 1. Reads an uploaded DMR
// (.docx) from the 'maintenance-reports' Storage bucket and extracts, BY
// DEPARTMENT, the maintenance activities into maintenance_activities rows using
// the Claude API (structured JSON output), like scripts/extract-wellplan.js.
//
// Usage:
//   node scripts/extract-dmr.js                 # list maintenance_reports rows + ids
//   node scripts/extract-dmr.js <report_id>     # DRY RUN — extract + print JSON
//   node scripts/extract-dmr.js <report_id> --save   # also write activities back
//
// HONEST EXTRACTION: only what the document states. Ambiguous completion status
// is marked 'routine' (never guessed as completed/pending). Non-activity tables
// (material requisition, deep-water status, cylinder/engine/pump parameter
// tables) are excluded entirely. Failure is non-destructive (markFailed).

import { pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { getServerClient } from './supabase-server.js'

// DMRs are Word docs with a real text layer → text extraction (Haiku).
const MODEL_TEXT = 'claude-haiku-4-5'
const BUCKET = 'maintenance-reports'
const MAX_DOC_CHARS = 60000
const MAX_OUT = 16000
const API_RETRIES = 2

const str = { type: ['string', 'null'] }

// --- Structured-output JSON schema ------------------------------------------
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    report_date: str, // ISO yyyy-mm-dd if the doc states it, else null
    departments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          department: { type: 'string' }, // Barge | Electrical | Mechanical | HSE | other
          chief_in_charge: str,
          last_day_activities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                text: { type: 'string' },
                status: { type: 'string' }, // completed | pending | routine
              },
              required: ['text', 'status'],
            },
          },
          planned_activities: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        },
        required: ['department', 'chief_in_charge', 'last_day_activities', 'planned_activities'],
      },
    },
  },
  required: ['report_date', 'departments'],
}

async function docxToText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer })
  return value || ''
}

function buildPrompt(docText, row) {
  return [
    'You are extracting ONE offshore rig DAILY MAINTENANCE REPORT (DMR) into standardized JSON.',
    'The DMR is organized BY DEPARTMENT (typically Barge, Electrical, Mechanical, HSE — there may',
    'be others). Extract the maintenance activities each department reports.',
    '',
    `Known metadata (from upload): report_date=${JSON.stringify(row.report_date)}.`,
    '',
    'EXTRACT ONLY WHAT THE DOCUMENT STATES. Never fabricate. Use null for absent values.',
    '',
    'FOR EACH DEPARTMENT capture:',
    '- department: the department name (Barge | Electrical | Mechanical | HSE | other exact name).',
    '- chief_in_charge: the named person in charge of that department, if stated; else null.',
    '- last_day_activities: what was DONE / worked on over the last day — each { text, status }.',
    '- planned_activities: what is PLANNED for today/next — each { text }. (no status)',
    '',
    'STATUS CLASSIFICATION for each last_day activity — be honest:',
    '- "completed": wording clearly indicates it is DONE — e.g. "Completed…", "Replaced…",',
    '  "Repaired…", "Done", "Rectified", "working fine/normal", "restored".',
    '- "pending": clearly in-progress / not finished — e.g. "in progress", "continuing",',
    '  "to be…", "yet to", "awaiting", "under observation", "not yet".',
    '- "routine": a daily / recurring task with no clear completion — e.g. "Daily checks",',
    '  "Routine round", "Housekeeping", "Monitoring", "Watchkeeping".',
    'When it is UNCLEAR whether something completed, mark "routine" — do NOT guess completed/pending.',
    '',
    'EXCLUDE ENTIRELY (do NOT put these anywhere in the output):',
    '- Material Requisition / material indent / spares-required lists.',
    '- Deep-well / Deep-water status sections.',
    '- Cylinder / gas inventory tables (O2, acetylene, etc.).',
    '- Engine parameter tables (RPM, lube-oil pressure/temp, running hours).',
    '- Pump running-hours tables and similar numeric parameter logs.',
    'These are logs/inventories, not maintenance activities. Skip them.',
    '',
    'report_date: the report date as yyyy-mm-dd if the document states it; else null.',
    '',
    `--- BEGIN DMR TEXT (docx) ---`,
    docText.slice(0, MAX_DOC_CHARS),
    docText.length > MAX_DOC_CHARS ? `\n[...truncated ${docText.length - MAX_DOC_CHARS} chars...]` : '',
    '--- END DMR TEXT ---',
  ].join('\n')
}

// --- Core extraction ---------------------------------------------------------
export async function extractDMR(id) {
  const supabase = getServerClient()

  const { data: row, error } = await supabase
    .from('maintenance_reports')
    .select('id, rig_id, report_date, source_file_path, source_file_name, extraction_status')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`load maintenance_reports row failed: ${error.message}`)
  if (!row) throw new Error(`No maintenance_reports row with id ${id}`)
  if (!row.source_file_path) throw new Error('This report has no source_file_path (no stored file).')

  const ext = String(row.source_file_name || '').split('.').pop().toLowerCase()
  if (ext !== 'docx') throw new Error(`Unsupported file type ".${ext}" (DMR extractor accepts .docx only).`)

  const dl = await supabase.storage.from(BUCKET).download(row.source_file_path)
  if (dl.error) throw new Error(`download from ${BUCKET} failed: ${dl.error.message}`)
  const buffer = Buffer.from(await dl.data.arrayBuffer())

  const text = await docxToText(buffer)
  if (!text.trim()) throw new Error('DOCX produced no extractable text.')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in .env.local')
  const client = new Anthropic({ apiKey })

  const params = {
    model: MODEL_TEXT,
    max_tokens: MAX_OUT,
    temperature: 0,
    system: 'You are a meticulous data-extraction engine for offshore rig daily maintenance reports. Return only what the source supports; never fabricate activities, people, or statuses.',
    messages: [{ role: 'user', content: buildPrompt(text, row) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  }

  let result
  let lastReason = ''
  for (let attempt = 0; attempt <= API_RETRIES; attempt++) {
    const response = await client.messages.create(params)
    const textBlock = response.content.find((b) => b.type === 'text')
    if (textBlock) { result = JSON.parse(textBlock.text); break }
    lastReason = `stop_reason=${response.stop_reason}, blocks=[${response.content.map((b) => b.type).join(',')}]`
    if (attempt < API_RETRIES) console.warn(`  (no text block — ${lastReason}; retrying ${attempt + 1}/${API_RETRIES})`)
  }
  if (result === undefined) throw new Error(`No text block in model response after ${API_RETRIES + 1} attempts (${lastReason}).`)

  return { row, result, detail: `${text.length} chars` }
}

// Normalize a status to the allowed set (defensive; unknown → 'routine').
function normStatus(s) {
  const v = String(s || '').toLowerCase()
  if (v === 'completed' || v === 'pending' || v === 'routine') return v
  return 'routine'
}

// Flatten the department result into maintenance_activities rows.
export function toActivityRows(result) {
  const rows = []
  for (const d of result.departments || []) {
    const dept = d.department || null
    const chief = d.chief_in_charge || null
    for (const a of d.last_day_activities || []) {
      if (!a?.text) continue
      rows.push({ department: dept, chief_in_charge: chief, activity_text: a.text, activity_kind: 'last_day', status: normStatus(a.status) })
    }
    for (const a of d.planned_activities || []) {
      if (!a?.text) continue
      rows.push({ department: dept, chief_in_charge: chief, activity_text: a.text, activity_kind: 'planned', status: null })
    }
  }
  return rows
}

export function statusFor(result) {
  const depts = Array.isArray(result.departments) ? result.departments : []
  const anyActivity = depts.some((d) => (d.last_day_activities?.length || 0) + (d.planned_activities?.length || 0) > 0)
  if (!depts.length || !anyActivity) return 'needs_review'
  return 'extracted'
}

// --- Write back (clean-replace activities, then update report) ---------------
export async function saveExtraction(id, result, status) {
  const supabase = getServerClient()
  const rows = toActivityRows(result).map((r) => ({ ...r, report_id: id }))

  // Clean-replace: delete existing activities for this report, then insert.
  const del = await supabase.from('maintenance_activities').delete().eq('report_id', id)
  if (del.error) throw new Error(`clear old activities failed: ${del.error.message}`)
  if (rows.length) {
    const ins = await supabase.from('maintenance_activities').insert(rows)
    if (ins.error) throw new Error(`insert activities failed: ${ins.error.message}`)
  }

  const upd = await supabase
    .from('maintenance_reports')
    .update({ raw_extract: result, extraction_status: status, report_date: result.report_date ?? undefined })
    .eq('id', id)
  if (upd.error) throw new Error(`update report failed: ${upd.error.message}`)
}

// Mark failed WITHOUT wiping any prior good data (only the status changes).
export async function markFailed(id) {
  const supabase = getServerClient()
  const { error } = await supabase.from('maintenance_reports').update({ extraction_status: 'failed' }).eq('id', id)
  if (error) throw new Error(`mark-failed failed: ${error.message}`)
}

async function listReports() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('maintenance_reports')
    .select('id, rig_id, report_date, source_file_name, extraction_status, created_at, rigs(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  console.log(`\n${data.length} maintenance_reports row(s):\n`)
  for (const r of data) {
    console.log(`  ${r.id}  [${r.extraction_status}]  ${r.rigs?.name || '—'}  ${r.report_date || '—'}  ${r.source_file_name || '—'}`)
  }
  console.log('\nRun:  node scripts/extract-dmr.js <id> [--save]')
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const id = args.find((a) => !a.startsWith('-'))

  if (!id) { await listReports(); return }

  console.log(`Maintenance report : ${id}`)
  console.log(`Mode               : ${doSave ? 'SAVE (writing activities)' : 'DRY RUN (print only) — pass --save to write'}`)

  let result, row, detail
  try {
    ({ result, row, detail } = await extractDMR(id))
  } catch (err) {
    console.error('\nEXTRACTION FAILED:', err.message)
    if (doSave) {
      try { await markFailed(id); console.error("Marked extraction_status='failed' (prior data preserved).") } catch {}
    }
    process.exitCode = 1
    return
  }

  const status = statusFor(result)
  const rows = toActivityRows(result)

  console.log(`File               : ${row.source_file_name}  ·  ${detail}`)
  console.log('\n===================== EXTRACTED JSON =====================')
  console.log(JSON.stringify(result, null, 2))

  console.log('\n===================== SUMMARY ============================')
  console.log(`report_date        : ${result.report_date ?? '—'}`)
  console.log(`departments        : ${result.departments?.length ?? 0}`)
  for (const d of result.departments || []) {
    const done = (d.last_day_activities || []).filter((a) => normStatus(a.status) === 'completed').length
    const pend = (d.last_day_activities || []).filter((a) => normStatus(a.status) === 'pending').length
    const rout = (d.last_day_activities || []).filter((a) => normStatus(a.status) === 'routine').length
    console.log(`  • ${String(d.department || '—').padEnd(12)} chief=${d.chief_in_charge || '—'}  last-day=${d.last_day_activities?.length || 0} (✓${done}/⏳${pend}/↻${rout})  planned=${d.planned_activities?.length || 0}`)
  }
  console.log(`activity rows      : ${rows.length}`)
  console.log(`-> extraction_status would be: ${status}`)

  if (!doSave) {
    console.log('\nNote: DRY RUN — nothing written. Re-run with --save to persist activities.')
    return
  }

  await saveExtraction(id, result, status)
  console.log(`\nWritten ${rows.length} activities to maintenance_activities for report ${id}. extraction_status = '${status}'.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
