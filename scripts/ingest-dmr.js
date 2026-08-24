// scripts/ingest-dmr.js
//
// DMR auto-ingest — STAGE 2a: DOWNLOAD + STORE + ROW. NO extraction yet.
//
// Finds DMR emails (shared rule in dmr-match.js), and for each one not already
// processed: downloads the .docx, uploads it to the 'maintenance-reports'
// Storage bucket, and inserts a maintenance_reports row (status 'uploaded').
// Idempotent on (rig_id, report_date) — an existing row for that rig+date is
// skipped, never duplicated. Processed Gmail message ids are tracked in a local
// marker so the same email isn't re-downloaded across runs.
//
// SAFE BY DEFAULT: dry run (report only). Pass --save to actually write.
//   node scripts/ingest-dmr.js                 # dry run (no downloads/writes)
//   node scripts/ingest-dmr.js --save          # download + store + insert rows
//   node scripts/ingest-dmr.js --save --days 14
//
// Server-side: uses getGmailClient() (refresh token) + the Supabase SECRET key
// (getServerClient) for Storage + DB writes. Never the browser.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'
import { getServerClient } from './supabase-server.js'
import { classifyMessage, normRig } from './dmr-match.js'

const BUCKET = 'maintenance-reports'
const PROCESSED_PATH = '.processed-dmr-emails.json' // git-ignored local marker
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function loadProcessed() {
  if (!existsSync(PROCESSED_PATH)) return new Set()
  try { return new Set(JSON.parse(readFileSync(PROCESSED_PATH, 'utf8'))) } catch { return new Set() }
}
function saveProcessed(set) { writeFileSync(PROCESSED_PATH, JSON.stringify([...set], null, 2)) }

const safeName = (n) => String(n || 'file.docx').replace(/[^a-zA-Z0-9._-]/g, '_')
function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

// Paginated Gmail list — don't rely on one capped batch.
async function listAll(gmail, q) {
  const ids = []
  let pageToken
  let pages = 0
  do {
    const r = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken })
    for (const m of r.data.messages || []) ids.push(m.id)
    pageToken = r.data.nextPageToken
    pages++
  } while (pageToken && pages < 20)
  return ids
}

async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const daysIdx = args.indexOf('--days')
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) || 7 : 7
  const query = `newer_than:${days}d subject:maintenance`

  console.log('DMR auto-ingest (Stage 2a — download + store + row; NO extraction)')
  console.log(`Mode  : ${doSave ? 'SAVE (download + upload + insert)' : 'DRY RUN (report only, no downloads/writes)'}`)
  console.log(`Query : ${query}`)

  const gmail = getGmailClient()
  const supabase = getServerClient()

  // rig name -> rig_id
  const rigsRes = await supabase.from('rigs').select('id, name')
  if (rigsRes.error) throw new Error(`load rigs failed: ${rigsRes.error.message}`)
  const rigIdByNorm = new Map((rigsRes.data || []).map((r) => [normRig(r.name), r.id]))

  const ids = await listAll(gmail, query)
  console.log(`Found : ${ids.length} candidate email(s) in the window\n`)

  const processed = loadProcessed()
  const ingested = []
  const skippedDuplicate = []
  const skippedProcessed = []
  const flagged = []
  let excludedCount = 0

  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const c = classifyMessage(msg.data)
    if (c.status !== 'matched') { excludedCount++; continue }

    const label = truncate(c.subject, 55)

    if (processed.has(id)) { skippedProcessed.push({ label, id }); continue }

    // Confident rig + date required — never guess.
    if (!c.rig) { flagged.push({ label, reason: `rig unmatched (raw: "${c.rigRaw}")` }); continue }
    if (!c.dateISO) { flagged.push({ label, reason: 'report date not parsed from subject' }); continue }
    const rigId = rigIdByNorm.get(normRig(c.rig))
    if (!rigId) { flagged.push({ label, reason: `rig "${c.rig}" not found in rigs table` }); continue }

    // Idempotency: existing row for this rig+date -> skip (never duplicate).
    const exist = await supabase.from('maintenance_reports').select('id, extraction_status').eq('rig_id', rigId).eq('report_date', c.dateISO).maybeSingle()
    if (exist.error) { flagged.push({ label, reason: `existence check failed: ${exist.error.message}` }); continue }
    if (exist.data) {
      skippedDuplicate.push({ rig: c.rig, date: c.dateISO, status: exist.data.extraction_status })
      processed.add(id) // handled — don't re-check this email next run
      continue
    }

    const att = c.docx[0]
    const path = `${normRig(c.rig)}/${c.dateISO}_${safeName(att.filename)}`

    if (!doSave) {
      ingested.push({ rig: c.rig, date: c.dateISO, file: att.filename, path, dryRun: true })
      continue
    }

    // Download → upload → insert.
    try {
      const dl = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att.attachmentId })
      const buf = Buffer.from(dl.data.data, 'base64url')

      const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: att.mimeType || DOCX_MIME, upsert: true })
      if (up.error) throw new Error(`storage upload failed: ${up.error.message}`)

      const ins = await supabase.from('maintenance_reports').insert({
        rig_id: rigId,
        report_date: c.dateISO,
        source_file_path: up.data.path,
        source_file_name: att.filename,
        extraction_status: 'uploaded',
      })
      if (ins.error) {
        // Unique (rig_id, report_date) race → treat as duplicate.
        if (/duplicate key|unique/i.test(ins.error.message)) {
          skippedDuplicate.push({ rig: c.rig, date: c.dateISO, status: '(race)' })
          processed.add(id)
          continue
        }
        throw new Error(`row insert failed: ${ins.error.message}`)
      }

      ingested.push({ rig: c.rig, date: c.dateISO, file: att.filename, path, bytes: buf.length })
      processed.add(id)
    } catch (e) {
      flagged.push({ label, reason: e.message })
    }
  }

  if (doSave) saveProcessed(processed)

  // --- Summary ---
  console.log(`===== INGESTED ${doSave ? '' : '(would ingest) '}: ${ingested.length} =====`)
  for (const r of ingested) console.log(`  ✓ ${r.rig}  ${r.date}  ${r.file}${r.bytes ? `  (${r.bytes} bytes)` : ''}\n      -> ${BUCKET}/${r.path}`)
  if (!ingested.length) console.log('  (none)')

  console.log(`\n===== SKIPPED — duplicate (row already exists for rig+date): ${skippedDuplicate.length} =====`)
  for (const r of skippedDuplicate) console.log(`  = ${r.rig}  ${r.date}  (existing status: ${r.status})`)
  if (!skippedDuplicate.length) console.log('  (none)')

  console.log(`\n===== SKIPPED — already processed (marker): ${skippedProcessed.length} =====`)
  for (const r of skippedProcessed) console.log(`  - "${r.label}"  (${r.id})`)
  if (!skippedProcessed.length) console.log('  (none)')

  if (flagged.length) {
    console.log(`\n===== FLAGGED — needs attention (NOT ingested): ${flagged.length} =====`)
    for (const r of flagged) console.log(`  ! "${r.label}"  — ${r.reason}`)
  }

  console.log(`\nExcluded non-DMR near-misses: ${excludedCount}. Candidates scanned: ${ids.length}.`)
  if (!doSave) console.log('DRY RUN — nothing downloaded or written. Re-run with --save to ingest.')
  else console.log(`Processed marker updated (${PROCESSED_PATH}). Stage 2a — NO extraction performed.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
