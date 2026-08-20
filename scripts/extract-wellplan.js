// scripts/extract-wellplan.js
//
// SERVER-SIDE ONLY (uses the Supabase SECRET key — never the browser).
//
// Stage 2 of the Well Plan feature: read an uploaded plan file (PDF or DOCX)
// from the 'well-plans' Storage bucket and extract structured data into its
// well_plans row using the Claude API (structured JSON output, like
// scripts/extract-ddr.js).
//
// Usage:
//   node scripts/extract-wellplan.js                 # list well_plans rows + ids
//   node scripts/extract-wellplan.js <well_plan_id>  # DRY RUN — extract + print JSON
//   node scripts/extract-wellplan.js <well_plan_id> --save   # also write back to the row
//
// HONEST EXTRACTION: only what the document actually states. A GTO's planned
// depth-vs-days is a plotted CURVE (graphical) — we extract the phase/step totals
// and target depth from the text, never a fabricated curve. Missing values stay
// null; a thin document is marked needs_review rather than invented.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import mammoth from 'mammoth'
import { getServerClient } from './supabase-server.js'

const MODEL = 'claude-haiku-4-5'
const BUCKET = 'well-plans'
const MAX_DOC_CHARS = 40000

// --- Structured-output JSON schema ------------------------------------------
const num = { type: ['number', 'null'] }
const str = { type: ['string', 'null'] }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    well_name: str,
    well_type: str, // exploratory | workover | sidetrack | null (confirmation from the doc)
    target_depth_m: num,
    total_planned_days: num,
    well_history: str, // concise summary, or null if the doc has no history section
    key_notes: { type: 'array', items: { type: 'string' } }, // [] if none
    planned_milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          step_no: num,
          description: { type: 'string' },
          planned_days: num,
          cumulative_days: num,
        },
        required: ['step_no', 'description', 'planned_days', 'cumulative_days'],
      },
    },
  },
  required: [
    'well_name',
    'well_type',
    'target_depth_m',
    'total_planned_days',
    'well_history',
    'key_notes',
    'planned_milestones',
  ],
}

// --- Read the document to plain text ----------------------------------------
async function docToText(buffer, fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase()
  if (ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer })
    return { text: value || '', kind: 'docx' }
  }
  if (ext === 'pdf') {
    // pdf-parse v2 is class-based: new PDFParse({ data }).getText().
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const res = await parser.getText()
      return { text: res?.text || '', kind: 'pdf' }
    } finally {
      await parser.destroy?.()
    }
  }
  throw new Error(`Unsupported file type ".${ext}" (only .pdf and .docx).`)
}

function buildPrompt(docText, kind, row) {
  return [
    'You are extracting ONE offshore WELL PLAN into standardized JSON.',
    'The plan is either a GTO (exploratory well) or a well-data document (workover/sidetrack).',
    '',
    `Source file type: ${kind.toUpperCase()}. Known metadata (from the upload, may be blank):`,
    `  well_name = ${JSON.stringify(row.well_name)}`,
    `  well_type = ${JSON.stringify(row.well_type)}`,
    '',
    'EXTRACT ONLY WHAT THE DOCUMENT STATES. Never fabricate. Use null for absent values.',
    '',
    'FIELDS:',
    '- well_name / well_type: confirm from the document if stated; else echo the known value or null.',
    '- target_depth_m: the planned/target total depth in METRES if stated (convert ft→m only if the',
    '  doc clearly gives feet: 1 ft = 0.3048 m); else null.',
    '- total_planned_days: the total planned duration in days if stated; else null.',
    '- planned_milestones: the planned operations/phases as an ordered list. For a WORKOVER',
    '  well-data doc, use the operations/programme table rows. For a GTO, use the phase/section',
    '  list. Each item: step_no (sequence), description (SHORT — a few words), planned_days (days',
    '  for that step, or null), cumulative_days (running total to the end of that step, or null).',
    '  The GTO depth-vs-days is a PLOTTED CURVE — do NOT invent per-day depths; take only the',
    '  phase/step day totals that are written as text/tables.',
    '- well_history: a concise summary (a few lines) of the well history / background section,',
    '  if present; else null.',
    '- key_notes: short important notes as a string array — e.g. section pressures, casing sizes,',
    '  SSSV status, H2S, mud weights. [] if none.',
    '',
    `--- BEGIN DOCUMENT TEXT (${kind}) ---`,
    docText.slice(0, MAX_DOC_CHARS),
    docText.length > MAX_DOC_CHARS ? `\n[...truncated ${docText.length - MAX_DOC_CHARS} chars...]` : '',
    '--- END DOCUMENT TEXT ---',
  ].join('\n')
}

// --- Core extraction ---------------------------------------------------------
export async function extractWellPlan(id) {
  const supabase = getServerClient()

  const { data: row, error } = await supabase
    .from('well_plans')
    .select('id, rig_id, well_name, well_type, target_depth_m, source_file_path, source_file_name, extraction_status')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`load well_plans row failed: ${error.message}`)
  if (!row) throw new Error(`No well_plans row with id ${id}`)
  if (!row.source_file_path) throw new Error('This plan has no source_file_path (no stored file).')

  const dl = await supabase.storage.from(BUCKET).download(row.source_file_path)
  if (dl.error) throw new Error(`download from ${BUCKET} failed: ${dl.error.message}`)
  const buffer = Buffer.from(await dl.data.arrayBuffer())

  const { text, kind } = await docToText(buffer, row.source_file_name)
  if (!text.trim()) throw new Error('Document produced no extractable text (scanned image PDF?).')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not found in .env.local')
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    temperature: 0,
    system:
      'You are a meticulous data-extraction engine for offshore well plans (GTO / well-data docs). ' +
      'Return only what the source supports; never fabricate values or curves.',
    messages: [{ role: 'user', content: buildPrompt(text, kind, row) }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock) throw new Error('No text block in model response.')
  const result = JSON.parse(textBlock.text)

  return { row, result, docKind: kind, docChars: text.length }
}

// Decide the status honestly from what came back.
export function statusFor(result) {
  const hasMilestones = Array.isArray(result.planned_milestones) && result.planned_milestones.length > 0
  const hasHistory = result.well_history && String(result.well_history).trim() !== ''
  const hasAny = hasMilestones || hasHistory || result.target_depth_m != null || result.total_planned_days != null
  if (!hasAny) return 'needs_review'
  if (!hasMilestones && !hasHistory) return 'needs_review'
  return 'extracted'
}

// --- Write back --------------------------------------------------------------
export async function saveExtraction(id, result, status) {
  const supabase = getServerClient()
  const { error } = await supabase
    .from('well_plans')
    .update({
      planned_milestones: result.planned_milestones ?? [],
      well_history: result.well_history ?? null,
      target_depth_m: result.target_depth_m ?? null,
      raw_extract: result,
      extraction_status: status,
    })
    .eq('id', id)
  if (error) throw new Error(`write-back failed: ${error.message}`)
}

async function listPlans() {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('well_plans')
    .select('id, well_name, well_type, source_file_name, extraction_status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  console.log(`\n${data.length} well_plans row(s):\n`)
  for (const r of data) {
    console.log(`  ${r.id}  [${r.extraction_status}]  ${r.well_type || '—'}  "${r.well_name || '—'}"  ${r.source_file_name || '—'}`)
  }
  console.log('\nRun:  node scripts/extract-wellplan.js <id> [--save]')
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const id = args.find((a) => !a.startsWith('-'))

  if (!id) { await listPlans(); return }

  console.log(`Well plan  : ${id}`)
  console.log(`Mode       : ${doSave ? 'SAVE (writing to well_plans)' : 'DRY RUN (print only) — pass --save to write'}`)

  let result, row, docKind, docChars
  try {
    ({ result, row, docKind, docChars } = await extractWellPlan(id))
  } catch (err) {
    console.error('\nEXTRACTION FAILED:', err.message)
    if (doSave) {
      try { await saveExtraction(id, { error: err.message }, 'failed') ; console.error("Marked extraction_status='failed'.") } catch {}
    }
    process.exitCode = 1
    return
  }

  const status = statusFor(result)

  console.log(`File       : ${row.source_file_name} (${docKind}, ${docChars} chars of text)`)
  console.log('\n===================== EXTRACTED JSON =====================')
  console.log(JSON.stringify(result, null, 2))

  console.log('\n===================== SUMMARY ============================')
  console.log(`well_name         : ${result.well_name ?? '—'}`)
  console.log(`well_type         : ${result.well_type ?? '—'}`)
  console.log(`target_depth_m    : ${result.target_depth_m ?? '—'}`)
  console.log(`total_planned_days: ${result.total_planned_days ?? '—'}`)
  console.log(`milestones        : ${result.planned_milestones?.length ?? 0}`)
  console.log(`well_history      : ${result.well_history ? `${String(result.well_history).length} chars` : '—'}`)
  console.log(`key_notes         : ${result.key_notes?.length ?? 0}`)
  console.log(`-> extraction_status would be: ${status}`)

  if (!doSave) {
    console.log('\nNote: DRY RUN — nothing written. Re-run with --save to persist to the well_plans row.')
    return
  }

  await saveExtraction(id, result, status)
  console.log(`\nWritten to well_plans ${id}. extraction_status = '${status}'.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
