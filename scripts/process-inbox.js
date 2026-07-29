// scripts/process-inbox.js
//
// Wires the two proven halves together:
//   Gmail reader -> download Excel attachment(s) -> extractDDR() -> saveReport()
//
// SAFE BY DEFAULT: dry run (extract + print, NO database writes). Pass --save to
// actually persist. Pass --limit N to process only the N most recent emails.
//
//   node scripts/process-inbox.js                 # dry run, all matches
//   node scripts/process-inbox.js --limit 3       # dry run, 3 most recent
//   node scripts/process-inbox.js --save          # write to Supabase
//
// Reuses fetch-gmail.js (auth + matching) and extract-ddr.js (extraction). Does
// NOT modify anything in Gmail; a local git-ignored processed-list is the only
// state it keeps.

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { google } from 'googleapis'
import { authorize, findDDRMessages } from './fetch-gmail.js'
import { extractDDR, validate, excelToLines } from './extract-ddr.js'

const PROCESSED_PATH = '.processed-emails.json' // git-ignored local record (message ids saved)

// A single daily report is small (the sample is ~540 non-empty cells). Season /
// master workbooks are orders of magnitude bigger and blow past the model's
// context window, so skip anything above this cap rather than erroring on it.
const CELL_CAP = 4000

function loadProcessed() {
  if (!existsSync(PROCESSED_PATH)) return new Set()
  try {
    return new Set(JSON.parse(readFileSync(PROCESSED_PATH, 'utf8')))
  } catch {
    return new Set()
  }
}
function saveProcessed(set) {
  writeFileSync(PROCESSED_PATH, JSON.stringify([...set], null, 2))
}

async function downloadAttachment(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId })
  return Buffer.from(res.data.data, 'base64url') // Gmail returns base64url
}

function truncate(s, n) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

async function main() {
  const args = process.argv.slice(2)
  const doSave = args.includes('--save')
  const limIdx = args.indexOf('--limit')
  const limit = limIdx !== -1 ? parseInt(args[limIdx + 1], 10) || 0 : 0
  const matchIdx = args.indexOf('--match')
  const matchSub = matchIdx !== -1 ? args[matchIdx + 1] || '' : ''

  console.log('DDR inbox processor')
  console.log(`Mode  : ${doSave ? 'SAVE (writing to Supabase)' : 'DRY RUN (extract + print, no DB writes)'}`)
  console.log(`Limit : ${limit > 0 ? `${limit} most recent email(s)` : 'all matching emails'}`)
  if (matchSub) console.log(`Match : only emails whose subject contains "${matchSub}"`)

  const client = await authorize()
  const gmail = google.gmail({ version: 'v1', auth: client })

  let messages = await findDDRMessages(client)
  if (matchSub) messages = messages.filter((m) => m.subject.toLowerCase().includes(matchSub.toLowerCase()))
  if (limit > 0) messages = messages.slice(0, limit)
  console.log(`Found : ${messages.length} matching email(s) to consider\n`)

  const processed = loadProcessed()
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ddr-inbox-'))
  const rows = []
  let skippedProcessed = 0
  let skippedLarge = 0
  let failures = 0
  let saved = 0

  // Load the writer lazily, only when saving.
  let saveReport = null
  if (doSave) ({ saveReport } = await import('./supabase-server.js'))

  try {
    for (const m of messages) {
      if (processed.has(m.id)) {
        skippedProcessed++
        console.log(`SKIP (already processed): "${truncate(m.subject, 60)}"`)
        continue
      }

      let allSavedForEmail = true

      for (const att of m.excelAttachments) {
        const label = `"${truncate(m.subject, 50)}" / ${att.filename}`
        try {
          const buf = await downloadAttachment(gmail, m.id, att.attachmentId)
          const ext = path.extname(att.filename) || '.xls'
          const tmpFile = path.join(tmpDir, `att-${rows.length}${ext}`)
          writeFileSync(tmpFile, buf)

          // Size guard: skip season/master workbooks before they reach the model.
          const cellCount = excelToLines(tmpFile).length
          if (cellCount > CELL_CAP) {
            skippedLarge++
            rows.push({
              subject: m.subject,
              file: att.filename,
              skip: true,
              valid: 'SKIP',
              note: `too large — ${cellCount} cells`,
            })
            console.log(`\n• ${label}`)
            console.log(`    SKIPPED — too large (${cellCount} non-empty cells > ${CELL_CAP} cap; likely a season/master workbook, not a daily report)`)
            continue
          }

          const { result, codes } = await extractDDR(tmpFile)
          const { checks, totalHrs } = validate(result, codes)
          const pass = checks.every((c) => c.pass)

          let saveInfo = null
          if (doSave) {
            try {
              saveInfo = await saveReport(result, { validationPassed: pass })
              saved++
            } catch (e) {
              allSavedForEmail = false
              console.error(`  SAVE FAILED for ${label}: ${e.message}`)
            }
          }

          const row = {
            subject: m.subject,
            file: att.filename,
            rig: result.rig_name,
            date: result.report_date,
            acts: result.activities?.length ?? 0,
            inv: result.inventory?.length ?? 0,
            hrs: totalHrs,
            valid: pass ? 'PASS' : 'FAIL',
            save: saveInfo ? `${saveInfo.reportAction}/${saveInfo.extractionStatus}` : doSave ? 'ERROR' : '-',
            error: null,
          }
          rows.push(row)

          console.log(`\n• ${label}`)
          console.log(`    rig=${result.rig_name}  date=${result.report_date}  activities=${row.acts}  inventory=${row.inv}  hours=${totalHrs.toFixed(2)}  validation=${row.valid}`)
          if (doSave) console.log(`    saved: ${row.save}`)
        } catch (err) {
          failures++
          allSavedForEmail = false
          rows.push({ subject: m.subject, file: att.filename, error: err.message, valid: 'ERROR' })
          console.error(`\n• ${label}\n    EXTRACTION FAILED: ${err.message}  (continuing with next file)`)
        }
      }

      // Only record a message as processed when it fully saved (never in dry run).
      if (doSave && allSavedForEmail && m.excelAttachments.length > 0) {
        processed.add(m.id)
      }
    }

    if (doSave) saveProcessed(processed)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }

  // --- Summary table ---
  console.log('\n===================== PER-FILE SUMMARY =====================')
  const H = ['#', 'RIG', 'DATE', 'ACTS', 'INV', 'VALID', 'ATTACHMENT', 'SUBJECT']
  const data = rows.map((r, i) => {
    const blank = r.error || r.skip
    return [
      String(i + 1),
      blank ? '-' : truncate(r.rig, 12),
      blank ? '-' : truncate(r.date, 10),
      blank ? '-' : String(r.acts),
      blank ? '-' : String(r.inv),
      r.valid,
      truncate(r.file, 26),
      truncate(r.subject, 34),
    ]
  })
  const widths = H.map((h, c) => Math.max(h.length, ...data.map((d) => d[c].length)))
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log(fmt(H))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const d of data) console.log(fmt(d))

  console.log(
    `\nTotals: ${rows.length} file(s) listed | ` +
      `${rows.filter((r) => r.valid === 'PASS').length} PASS, ` +
      `${rows.filter((r) => r.valid === 'FAIL').length} FAIL, ` +
      `${skippedLarge} skipped-too-large, ${failures} extraction error(s) | ` +
      `${skippedProcessed} email(s) skipped as already-processed.`
  )
  if (doSave) console.log(`Saved to Supabase: ${saved} file(s).`)
  else console.log('DRY RUN — nothing written to Supabase. Re-run with --save to persist.')
}

main().catch((err) => {
  console.error('\nFATAL:', err.message)
  process.exitCode = 1
})
