// scripts/find-ddr-emails.js
//
// DDR auto-ingest — STAGE 1: FINDER ONLY. Uses the headless getGmailClient() to
// scan the inbox and identify Daily Drilling Report (DDR) emails. It does NOT
// download, extract, or save anything — it only FINDS and reports, so we can
// verify the matching rule against reality.
//
// Matching rule lives in scripts/ddr-match.js (shared with ingest-ddr.js):
//   subject names a rig (short or full) + a DDR/RDDR token + a DD-MM-YYYY date,
//   AND the email has a .xlsx attachment.
//
// Usage:  node scripts/find-ddr-emails.js  [--days N]

import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'
import { classifyMessage } from './ddr-match.js'

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

async function listAll(gmail, q, cap = 200) {
  const ids = []
  let pageToken
  let pages = 0
  do {
    const r = await gmail.users.messages.list({ userId: 'me', q, maxResults: 100, pageToken })
    for (const m of r.data.messages || []) ids.push(m.id)
    pageToken = r.data.nextPageToken
    pages++
  } while (pageToken && pages < 20 && ids.length < cap)
  return ids
}

async function main() {
  const args = process.argv.slice(2)
  const di = args.indexOf('--days')
  const days = di !== -1 ? parseInt(args[di + 1], 10) || 7 : 7
  // Prefilter: DDRs carry an .xlsx attachment; narrow to those, classify in code.
  const query = `newer_than:${days}d has:attachment filename:xlsx`

  const gmail = getGmailClient()
  const ids = await listAll(gmail, query)

  const matched = []
  const flagged = []
  const excluded = []
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const c = classifyMessage(msg.data)
    if (c.status === 'matched') matched.push(c)
    else if (c.status === 'flagged') flagged.push(c)
    else excluded.push(c)
  }

  console.log(`\n===================== MATCHED DDR EMAILS: ${matched.length} =====================`)
  if (!matched.length) console.log('(none matched — needs rig + DDR token + date + .xlsx)')
  matched.forEach((m, i) => {
    console.log(`\n[${i + 1}] ${m.subject}`)
    console.log(`     Rig      : ${m.rig}${m.is_revised ? '  (REVISED / RDDR)' : ''}`)
    console.log(`     Date     : ${m.report_date}`)
    console.log(`     File(s)  : ${m.xlsx.map((d) => d.filename).join(', ')}`)
    console.log(`     From     : ${m.from}`)
    console.log(`     Msg id   : ${m.id}`)
  })

  if (flagged.length) {
    console.log(`\n===================== FLAGGED (looks like DDR, needs review): ${flagged.length} =====================`)
    for (const f of flagged) {
      console.log(`  • "${truncate(f.subject, 60)}"  — ${f.reason}`)
      console.log(`      from: ${truncate(f.from, 50)}  id: ${f.id}`)
    }
  }

  console.log(`\n===================== EXCLUDED / NON-DDR: ${excluded.length} =====================`)
  console.log('(xlsx-bearing emails that are NOT DDRs — sanity check)')
  for (const e of excluded) {
    console.log(`  • "${truncate(e.subject, 60)}" — ${e.reason}`)
  }

  console.log(`\nScanned ${ids.length} xlsx-bearing email(s) in the last ${days}d. Stage 1 — FIND only, nothing downloaded/saved.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
