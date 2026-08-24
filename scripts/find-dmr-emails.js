// scripts/find-dmr-emails.js
//
// DMR auto-ingest — STAGE 1: FINDER ONLY. Uses the headless getGmailClient() to
// scan the inbox and identify Daily Maintenance Report (DMR) emails. It does NOT
// download, extract, or save anything — it only FINDS and reports, so we can
// verify the matching rule against reality before building the rest.
//
// Matching rule (subject-based — senders are NOT consistent):
//   * Subject STARTS WITH "Daily Maintenance Report" (case-insensitive; tolerant
//     of the underscore, e.g. "Daily Maintenance Report_ Virtue 1_24-08-2026").
//   * AND the email has a .docx attachment.
//   * EXCLUDE admin/thread mail: subjects containing "Include Mr", and RE:/FW:
//     replies that have no .docx attachment.
//
// Parses rig + date from the subject "Daily Maintenance Report_ <Rig>_<DD-MM-YYYY>"
// and normalizes the rig to our roster; unconfident rig matches are flagged, not
// guessed.
//
// Usage:  node scripts/find-dmr-emails.js

import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'

// Prefilter: every real DMR subject contains "maintenance"; so does the admin
// thread mail we want to prove we EXCLUDE. This keeps the scan tight but still
// surfaces the near-misses. (Matching itself is done in code, not by this query.)
const GMAIL_QUERY = 'subject:maintenance'
const MAX_RESULTS = 50

const ROSTER = ['Discovery-1', 'Virtue-1', 'Jindal Star', 'Jindal Explorer', 'Jindal Pioneer', 'Jindal Supreme']
const normRig = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function matchRig(raw) {
  const n = normRig(raw)
  if (!n) return null
  for (const r of ROSTER) if (normRig(r) === n) return r          // exact (Virtue 1 -> Virtue-1)
  for (const r of ROSTER) if (normRig(r).includes(n) || n.includes(normRig(r))) return r // partial
  return null
}

const hv = (msg, name) => {
  const h = (msg.data.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h ? h.value : ''
}

// Walk the MIME tree collecting attachment filenames.
function attachmentsOf(payload) {
  const out = []
  ;(function walk(p) {
    if (!p) return
    if (p.filename && p.body?.attachmentId) out.push(p.filename)
    if (Array.isArray(p.parts)) p.parts.forEach(walk)
  })(payload)
  return out
}

// Parse "Daily Maintenance Report_ <Rig>_<DD-MM-YYYY>" (tolerant of spacing).
function parseSubject(subject) {
  const s = String(subject || '').trim()
  const rest = s.replace(/^daily maintenance report/i, '').replace(/^[\s_:-]+/, '')
  const dm = rest.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  let dateISO = null
  let rigRaw = rest
  if (dm) {
    let [, dd, mm, yyyy] = dm
    if (yyyy.length === 2) yyyy = '20' + yyyy
    dateISO = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
    rigRaw = rest.slice(0, dm.index)
  }
  rigRaw = rigRaw.replace(/^[\s_:-]+/, '').replace(/[\s_:-]+$/, '').trim()
  return { rigRaw, dateISO }
}

const isReply = (s) => /^(re|fw|fwd)\s*:/i.test(String(s || '').trim())
const startsWithDMR = (s) => String(s || '').trim().toLowerCase().startsWith('daily maintenance report')
const hasIncludeMr = (s) => /include\s+mr/i.test(String(s || ''))

function truncate(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

async function main() {
  const gmail = getGmailClient()
  const list = await gmail.users.messages.list({ userId: 'me', q: GMAIL_QUERY, maxResults: MAX_RESULTS })
  const ids = (list.data.messages || []).map((m) => m.id)

  const matched = []
  const excluded = []

  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const subject = hv(msg, 'Subject')
    const from = hv(msg, 'From')
    const date = hv(msg, 'Date')
    const atts = attachmentsOf(msg.data.payload)
    const docx = atts.filter((f) => /\.docx$/i.test(f))
    const hasDocx = docx.length > 0

    // Exclusions (checked in order, with a reason for the report).
    if (hasIncludeMr(subject)) { excluded.push({ subject, from, reason: 'admin thread ("Include Mr")' }); continue }
    if (!startsWithDMR(subject)) {
      // near-miss: mentions maintenance but isn't a DMR title (e.g. RE:/FW: threads)
      excluded.push({ subject, from, reason: isReply(subject) ? 'reply/thread, not a DMR title' : 'subject does not start with "Daily Maintenance Report"' })
      continue
    }
    if (!hasDocx) { excluded.push({ subject, from, reason: 'no .docx attachment' + (atts.length ? ` (has: ${atts.join(', ')})` : ' (no attachments)') }); continue }

    const { rigRaw, dateISO } = parseSubject(subject)
    const rig = matchRig(rigRaw)
    matched.push({ id, subject, from, date, docx: docx.join(', '), rigRaw, rig, dateISO })
  }

  // --- MATCHED ---
  console.log(`\n===================== MATCHED DMR EMAILS: ${matched.length} =====================`)
  if (!matched.length) {
    console.log('(none matched — subject starts with "Daily Maintenance Report" AND has a .docx)')
  }
  for (let i = 0; i < matched.length; i++) {
    const m = matched[i]
    console.log(`\n[${i + 1}] ${m.subject}`)
    console.log(`     Rig    : ${m.rig ? m.rig : `⚠ UNMATCHED (raw: "${m.rigRaw}")`}`)
    console.log(`     Date   : ${m.dateISO || '⚠ not parsed'}`)
    console.log(`     File   : ${m.docx}`)
    console.log(`     From   : ${m.from}`)
    console.log(`     Msg id : ${m.id}`)
  }

  // --- EXCLUDED / near-misses ---
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
