// scripts/find-dmr-emails.js
//
// DMR auto-ingest — STAGE 1: FINDER ONLY. Uses the headless getGmailClient() to
// scan the inbox and identify Daily Maintenance Report (DMR) emails. It does NOT
// download, extract, or save anything — it only FINDS and reports, so we can
// verify the matching rule against reality.
//
// Matching rule lives in scripts/dmr-match.js (shared with ingest-dmr.js):
//   subject starts with "Daily Maintenance Report" + a .docx attachment,
//   excluding "Include Mr" admin threads and RE:/FW: replies.
//
// Usage:  node scripts/find-dmr-emails.js

import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'
import { classifyMessage } from './dmr-match.js'

// Prefilter: every real DMR subject contains "maintenance"; so do the admin
// threads we want to prove we EXCLUDE. Matching itself is done in code.
const GMAIL_QUERY = 'subject:maintenance'
const MAX_RESULTS = 50

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

async function main() {
  const gmail = getGmailClient()
  const list = await gmail.users.messages.list({ userId: 'me', q: GMAIL_QUERY, maxResults: MAX_RESULTS })
  const ids = (list.data.messages || []).map((m) => m.id)

  const matched = []
  const excluded = []
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const c = classifyMessage(msg.data)
    if (c.status === 'matched') matched.push(c)
    else excluded.push(c)
  }

  console.log(`\n===================== MATCHED DMR EMAILS: ${matched.length} =====================`)
  if (!matched.length) console.log('(none matched — subject starts with "Daily Maintenance Report" AND has a .docx)')
  matched.forEach((m, i) => {
    console.log(`\n[${i + 1}] ${m.subject}`)
    console.log(`     Rig    : ${m.rig ? m.rig : `⚠ UNMATCHED (raw: "${m.rigRaw}")`}`)
    console.log(`     Date   : ${m.dateISO || '⚠ not parsed'}`)
    console.log(`     File   : ${m.docx.map((d) => d.filename).join(', ')}`)
    console.log(`     From   : ${m.from}`)
    console.log(`     Msg id : ${m.id}`)
  })

  console.log(`\n===================== EXCLUDED / NEAR-MISSES: ${excluded.length} =====================`)
  console.log('(subjects containing "maintenance" that did NOT match, and why — sanity check)')
  for (const e of excluded) {
    console.log(`  • "${truncate(e.subject, 60)}"`)
    console.log(`      from: ${truncate(e.from, 50)}`)
    console.log(`      excluded: ${e.reason}`)
  }

  console.log(`\nScanned ${ids.length} email(s) matching Gmail prefilter "${GMAIL_QUERY}". Stage 1 — FIND only, nothing downloaded/saved.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
