// scripts/ingest-ddr.js
//
// DDR auto-ingest — mirrors ingest-dmr.js:
//   find DDR emails -> select the real .xlsx -> download -> Storage
//   (bucket "drilling-reports") -> (with --extract) extract-ddr.js + save via the
//   save_ddr_report RPC (which upserts on (rig_id, report_date), so an RDDR
//   supersedes the DDR for that rig+date).
//
// Idempotency:
//   * DURABLE marker: processed_emails (message_id, kind='ddr') in the DB —
//     checked BEFORE any download / API call, so already-processed emails cost $0.
//   * PRIMARY correctness backstop: reports (rig_id, report_date) uniqueness — an
//     RDDR (new message_id) re-extracts and the RPC upsert replaces in place.
//
// SAFE BY DEFAULT: dry run (report only). Flags:
//   node scripts/ingest-ddr.js                    # dry run
//   node scripts/ingest-ddr.js --save             # download + store the .xlsx
//   node scripts/ingest-ddr.js --save --extract   # + extract + save the report (deploy mode)
//   node scripts/ingest-ddr.js --save --extract --days 14
//
// Server-side: getGmailClient() (refresh token) + Supabase SECRET key. Never the browser.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { getGmailClient, getMessageFull } from './gmail-auth.js'
import { getServerClient } from './supabase-server.js'
import { classifyMessage, selectDdrXlsx, normRig } from './ddr-match.js'
import { extractDDR, validate } from './extract-ddr.js'

const BUCKET = 'drilling-reports'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const safeName = (n) => String(n || 'file.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_')
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
async function markProcessed(supabase, id, rigId, reportDate) {
  const { error } = await supabase.from('processed_emails')
    .upsert({ message_id: id, kind: 'ddr', rig_id: rigId, report_date: reportDate }, { onConflict: 'message_id' })
  if (error) throw new Error(`mark processed failed: ${error.message}`)
}

async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const doExtract = args.includes('--extract')
  const daysIdx = args.indexOf('--days')
  const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) || 7 : 7
  const matchIdx = args.indexOf('--match')
  const matchStr = matchIdx !== -1 ? String(args[matchIdx + 1] || '').toLowerCase() : null
  const query = `newer_than:${days}d has:attachment filename:xlsx`

  console.log('DDR auto-ingest')
  console.log(`Mode    : ${doSave ? 'SAVE' : 'DRY RUN (report only)'}${doExtract ? ' + EXTRACT' : ''}`)
  console.log(`Query   : ${query}`)
  console.log(`Bucket  : ${BUCKET} | Marker: processed_emails (kind='ddr')\n`)

  const gmail = getGmailClient()
  const supabase = getServerClient()

  const candidateIds = await listAll(gmail, query)

  // Classify all candidates first. Each fetch is retried (getMessageFull); a
  // message that still can't be fetched is COUNTED as a failure, never silently
  // dropped.
  const matched = []
  const flagged = []
  let excludedCount = 0
  let fetchFailed = 0
  const fetchFailures = []
  for (const id of candidateIds) {
    let msg
    try { msg = await getMessageFull(gmail, id) }
    catch (e) { fetchFailed++; fetchFailures.push(`${id}: ${e.message}`); continue }
    const c = classifyMessage(msg.data)
    if (c.status === 'matched') matched.push(c)
    else if (c.status === 'flagged') flagged.push(c)
    else excludedCount++
  }
  // SELF-CHECK: every scanned message must be accounted for. A mismatch (or any
  // fetch failure) means the scan under-fetched — fail loud so a degraded
  // scheduled run is visible, not a silent "0 matched".
  const accounted = matched.length + flagged.length + excludedCount + fetchFailed
  const scanHealthy = accounted === candidateIds.length && fetchFailed === 0

  // Optional --match filter (subject/rig/date substring) for controlled single-report runs.
  // NOTE: build a SEPARATE list — never mutate `matched` (a prior version aliased
  // `matched` and emptied it when no --match was given, silently yielding 0 matched).
  // RDDR-WINS: order so REVISED (is_revised) reports are processed LAST, so within a
  // rig+date the revision's save_ddr_report upsert lands OVER the original DDR.
  const toIngest = (matchStr
    ? matched.filter((c) => `${c.subject} ${c.rig} ${c.report_date}`.toLowerCase().includes(matchStr))
    : matched.slice())
    .sort((a, b) => Number(!!a.is_revised) - Number(!!b.is_revised))

  const processed = await loadProcessed(supabase, toIngest.map((m) => m.id))
  console.log(`Found   : ${toIngest.length} matched DDR(s)${matchStr ? ` (filtered from ${matched.length} by --match "${matchStr}")` : ''}, ${flagged.length} flagged, ${excludedCount} excluded, ${candidateIds.length} scanned\n`)

  const results = []
  const skippedProcessed = []
  const needsReview = [...flagged.map((f) => ({ label: truncate(f.subject, 55), reason: f.reason }))]

  for (const c of toIngest) {
    const label = `${c.rig} ${c.report_date}${c.is_revised ? ' (RDDR)' : ''}`

    // Skip already-processed BEFORE any download / API call (zero cost).
    if (processed.has(c.id)) { skippedProcessed.push(`${label} — "${truncate(c.subject, 40)}"`); continue }

    // Select the real DDR .xlsx (Rigname_DD-MM-YYYY); flag if none matches.
    const att = selectDdrXlsx(c.xlsx, c.rig, c.report_date)
    if (!att) {
      needsReview.push({ label, reason: `no .xlsx matched rig/date among: ${c.xlsx.map((a) => a.filename).join(', ')}` })
      continue
    }

    if (!doSave) {
      results.push({ label, action: `would INGEST — pick "${att.filename}"` + (doExtract ? ' + would extract+save' : ' (store only)') })
      continue
    }

    // --- Download the selected attachment ---
    let tmpDir
    try {
      const dl = await gmail.users.messages.attachments.get({ userId: 'me', messageId: c.id, id: att.attachmentId })
      const buf = Buffer.from(dl.data.data, 'base64url')

      // Upload to Storage (idempotent path per rig/date; upsert overwrites on RDDR re-run).
      const storagePath = `${normRig(c.rig)}/${c.report_date}_${safeName(att.filename)}`
      const up = await supabase.storage.from(BUCKET).upload(storagePath, buf, { contentType: att.mimeType || XLSX_MIME, upsert: true })
      if (up.error) throw new Error(`storage upload failed: ${up.error.message}`)

      let action = `STORED ${buf.length} bytes -> ${storagePath}`

      if (doExtract) {
        // Write to a temp file for the extractor, extract + save via the RPC.
        tmpDir = mkdtempSync(path.join(tmpdir(), 'ddr-'))
        const tmpFile = path.join(tmpDir, safeName(att.filename))
        writeFileSync(tmpFile, buf)
        try {
          const { result, codes, roster } = await extractDDR(tmpFile)
          const { checks } = validate(result, codes, roster)
          const allPass = checks.every((ch) => ch.pass)
          const { saveReport } = await import('./supabase-server.js')
          const summary = await saveReport(result, { validationPassed: allPass })
          action += ` -> ${summary.reportAction} report (${summary.extractionStatus}), ${summary.activitiesWritten} activities, rig "${summary.rigName}"`
          await markProcessed(supabase, c.id, summary.rigId, c.report_date)
        } catch (e) {
          // Non-destructive: leave the file stored, flag, keep going. Not marked
          // processed, so a later run retries.
          action += ` -> extract/save FAILED (${truncate(e.message, 80)}) — needs_review`
          needsReview.push({ label, reason: `extract/save failed: ${truncate(e.message, 80)}` })
        }
      } else {
        action += ' (run with --extract to save the report)'
      }
      results.push({ label, action })
    } catch (e) {
      needsReview.push({ label, reason: e.message })
    } finally {
      if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ } }
    }
  }

  // --- Summary ---
  console.log(`===== RESULTS: ${results.length} =====`)
  for (const r of results) console.log(`  • ${r.label} — ${r.action}`)
  if (!results.length) console.log('  (none)')

  console.log(`\n===== SKIPPED — already processed (kind='ddr'): ${skippedProcessed.length} =====`)
  for (const s of skippedProcessed) console.log(`  = ${s}`)
  if (!skippedProcessed.length) console.log('  (none)')

  if (needsReview.length) {
    console.log(`\n===== FLAGGED / needs_review — NOT ingested: ${needsReview.length} =====`)
    for (const f of needsReview) console.log(`  ! ${f.label} — ${f.reason}`)
  }

  console.log(`\nExcluded non-DDR xlsx mail: ${excludedCount}. Candidates scanned: ${candidateIds.length}.`)

  // Scan-health self-check (fail loud on a degraded scan).
  console.log(`\n===== SCAN HEALTH =====`)
  console.log(`  accounted ${accounted}/${candidateIds.length} (matched ${matched.length} + flagged ${flagged.length} + excluded ${excludedCount} + fetch-failed ${fetchFailed})`)
  if (!scanHealthy) {
    console.error(`  ❌ DEGRADED SCAN: ${fetchFailed} message(s) could not be fetched after retries; results may be INCOMPLETE.`)
    for (const f of fetchFailures.slice(0, 20)) console.error(`     - ${f}`)
    console.error('  Exiting non-zero so this run is flagged (not a silent under-match).')
    process.exitCode = 1
  } else {
    console.log('  ✅ healthy — every scanned message accounted for, no fetch failures.')
  }

  console.log(doSave ? '\nSAVE run complete.' : '\nDRY RUN — nothing downloaded/written. Add --save (and --extract) to act.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
