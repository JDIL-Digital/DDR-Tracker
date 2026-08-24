// scripts/ingest-dmr.js
//
// DMR auto-ingest — STAGE 2 (2a + 2b):
//   2a  find DMR emails -> download .docx -> Storage -> maintenance_reports row
//   2b  durable DB processed-marker (processed_emails, Replit-safe) +
//       optional auto-extraction (--extract) chaining scripts/extract-dmr.js.
//
// Idempotency:
//   * PRIMARY correctness backstop: maintenance_reports (rig_id, report_date)
//     uniqueness — an existing row for that rig+date is never duplicated.
//   * DURABLE marker: processed_emails (message_id) in the DB — survives Replit
//     redeploys, so a handled email is never re-downloaded.
//
// SAFE BY DEFAULT: dry run (report only). Flags:
//   node scripts/ingest-dmr.js                       # dry run
//   node scripts/ingest-dmr.js --save                # download + store + row
//   node scripts/ingest-dmr.js --save --extract      # + auto-extract each new/uploaded row
//   node scripts/ingest-dmr.js --save --extract --days 14
//
// Server-side: getGmailClient() (refresh token) + Supabase SECRET key. Never the browser.

import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'
import { getServerClient } from './supabase-server.js'
import { classifyMessage, normRig } from './dmr-match.js'
import { extractDMR, statusFor, saveExtraction } from './extract-dmr.js'

const BUCKET = 'maintenance-reports'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const safeName = (n) => String(n || 'file.docx').replace(/[^a-zA-Z0-9._-]/g, '_')
function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

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

// DB processed-marker (server/service-role only; RLS bypassed by the secret key).
async function loadProcessed(supabase, ids) {
  if (!ids.length) return new Set()
  const { data, error } = await supabase.from('processed_emails').select('message_id').in('message_id', ids)
  if (error) {
    if (/relation .*processed_emails.* does not exist|could not find the table/i.test(error.message)) {
      throw new Error('processed_emails table not found — apply migration 0016_processed_emails.sql first.')
    }
    throw new Error(`load processed_emails failed: ${error.message}`)
  }
  return new Set((data || []).map((r) => r.message_id))
}
async function markProcessed(supabase, id, kind, rigId, reportDate) {
  const { error } = await supabase.from('processed_emails')
    .upsert({ message_id: id, kind, rig_id: rigId, report_date: reportDate }, { onConflict: 'message_id' })
  if (error) throw new Error(`mark processed failed: ${error.message}`)
}

async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const doExtract = args.includes('--extract')
  const daysIdx = args.indexOf('--days')
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) || 7 : 7
  const query = `newer_than:${days}d subject:maintenance`

  console.log('DMR auto-ingest (Stage 2a+2b)')
  console.log(`Mode    : ${doSave ? 'SAVE' : 'DRY RUN (report only)'}${doExtract ? ' + EXTRACT' : ''}`)
  console.log(`Query   : ${query}`)
  console.log(`Marker  : DB table processed_emails (durable)\n`)

  const gmail = getGmailClient()
  const supabase = getServerClient()

  const rigsRes = await supabase.from('rigs').select('id, name')
  if (rigsRes.error) throw new Error(`load rigs failed: ${rigsRes.error.message}`)
  const rigIdByNorm = new Map((rigsRes.data || []).map((r) => [normRig(r.name), r.id]))

  const candidateIds = await listAll(gmail, query)

  // Classify all candidates first.
  const matched = []
  let excludedCount = 0
  for (const id of candidateIds) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const c = classifyMessage(msg.data)
    if (c.status === 'matched') matched.push(c)
    else excludedCount++
  }

  const processed = await loadProcessed(supabase, matched.map((m) => m.id))
  console.log(`Found   : ${matched.length} matched DMR(s), ${excludedCount} excluded, ${candidateIds.length} scanned\n`)

  const results = []       // { rig, date, action }
  const skippedProcessed = []
  const flagged = []

  for (const c of matched) {
    const label = truncate(c.subject, 55)

    if (processed.has(c.id)) { skippedProcessed.push(label); continue }
    if (!c.rig) { flagged.push({ label, reason: `rig unmatched (raw: "${c.rigRaw}")` }); continue }
    if (!c.dateISO) { flagged.push({ label, reason: 'report date not parsed' }); continue }
    const rigId = rigIdByNorm.get(normRig(c.rig))
    if (!rigId) { flagged.push({ label, reason: `rig "${c.rig}" not in rigs table` }); continue }

    const exist = await supabase.from('maintenance_reports').select('id, extraction_status').eq('rig_id', rigId).eq('report_date', c.dateISO).maybeSingle()
    if (exist.error) { flagged.push({ label, reason: `existence check failed: ${exist.error.message}` }); continue }

    let reportId = exist.data?.id || null
    let status = exist.data?.extraction_status || null
    let action = ''

    // --- Ingest (create row) if none exists ---
    if (!reportId) {
      if (!doSave) {
        results.push({ rig: c.rig, date: c.dateISO, action: 'would INGEST (download+store+insert)' + (doExtract ? ' + would extract' : '') })
        continue
      }
      const att = c.docx[0]
      const path = `${normRig(c.rig)}/${c.dateISO}_${safeName(att.filename)}`
      try {
        const dl = await gmail.users.messages.attachments.get({ userId: 'me', messageId: c.id, id: att.attachmentId })
        const buf = Buffer.from(dl.data.data, 'base64url')
        const up = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: att.mimeType || DOCX_MIME, upsert: true })
        if (up.error) throw new Error(`storage upload failed: ${up.error.message}`)
        const ins = await supabase.from('maintenance_reports')
          .insert({ rig_id: rigId, report_date: c.dateISO, source_file_path: up.data.path, source_file_name: att.filename, extraction_status: 'uploaded' })
          .select('id').single()
        if (ins.error) {
          if (/duplicate key|unique/i.test(ins.error.message)) { // race
            const re = await supabase.from('maintenance_reports').select('id, extraction_status').eq('rig_id', rigId).eq('report_date', c.dateISO).maybeSingle()
            reportId = re.data?.id; status = re.data?.extraction_status; action = 'found existing (race)'
          } else throw new Error(`row insert failed: ${ins.error.message}`)
        } else {
          reportId = ins.data.id; status = 'uploaded'; action = `INGESTED (${buf.length} bytes)`
        }
      } catch (e) {
        flagged.push({ label, reason: e.message })
        continue
      }
    } else {
      action = `found existing [${status}]`
    }

    // --- Extraction (optional) — only rows still 'uploaded' ---
    if (doExtract) {
      if (status === 'uploaded') {
        if (!doSave) {
          action += ' -> would extract'
        } else {
          try {
            const { result } = await extractDMR(reportId)
            const st = statusFor(result)
            await saveExtraction(reportId, result, st)
            action += ` -> extracted (${st})`
          } catch (e) {
            // Non-destructive: mark needs_review, keep going. Never wipe good data.
            await supabase.from('maintenance_reports').update({ extraction_status: 'needs_review' }).eq('id', reportId)
            action += ` -> extraction FAILED, set needs_review (${truncate(e.message, 60)})`
          }
        }
      } else {
        action += ` -> extraction skipped (status '${status}')`
      }
    }

    // Record the durable marker (only on real runs, only once we have a row).
    if (doSave && reportId) {
      try { await markProcessed(supabase, c.id, 'dmr', rigId, c.dateISO) } catch (e) { action += ` [marker warn: ${e.message}]` }
    }

    results.push({ rig: c.rig, date: c.dateISO, action })
  }

  // --- Summary ---
  console.log(`===== RESULTS: ${results.length} =====`)
  for (const r of results) console.log(`  • ${r.rig}  ${r.date}  — ${r.action}`)
  if (!results.length) console.log('  (none)')

  console.log(`\n===== SKIPPED — already processed (DB marker): ${skippedProcessed.length} =====`)
  for (const s of skippedProcessed) console.log(`  = "${s}"`)
  if (!skippedProcessed.length) console.log('  (none)')

  if (flagged.length) {
    console.log(`\n===== FLAGGED — NOT ingested: ${flagged.length} =====`)
    for (const f of flagged) console.log(`  ! "${f.label}" — ${f.reason}`)
  }

  console.log(`\nExcluded non-DMR near-misses: ${excludedCount}. Candidates scanned: ${candidateIds.length}.`)
  console.log(doSave ? 'SAVE run complete.' : 'DRY RUN — nothing downloaded/written. Add --save (and --extract) to act.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
