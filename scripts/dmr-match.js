// scripts/dmr-match.js
//
// Shared DMR email matching — the single source of truth used by both the finder
// (find-dmr-emails.js) and the ingester (ingest-dmr.js). Pure functions over a
// Gmail message resource; no I/O.
//
// Rule (subject-based; senders are NOT consistent):
//   * Subject STARTS WITH "Daily Maintenance Report" (case-insensitive; tolerant
//     of the underscore, e.g. "Daily Maintenance Report_ Virtue 1_24-08-2026").
//     Leading RE:/FW:/FWD: prefixes are STRIPPED before this check, so a rig that
//     sends its DMR as a reply still matches.
//   * AND has a .docx attachment — this is what guards against reply chatter:
//     a reply on a DMR thread with no .docx (or a different .docx) is excluded.
//   * EXCLUDE admin/thread mail: subjects containing "Include Mr".

export const ROSTER = ['Discovery-1', 'Virtue-1', 'Jindal Star', 'Jindal Explorer', 'Jindal Pioneer', 'Jindal Supreme']

export const normRig = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function matchRig(raw) {
  const n = normRig(raw)
  if (!n) return null
  for (const r of ROSTER) if (normRig(r) === n) return r            // exact: "Virtue 1" -> "Virtue-1"
  for (const r of ROSTER) if (normRig(r).includes(n) || n.includes(normRig(r))) return r // partial
  return null
}

export function headerValue(payload, name) {
  const h = (payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h ? h.value : ''
}

// Walk the MIME tree; return downloadable attachment parts.
export function collectAttachments(payload) {
  const out = []
  ;(function walk(p) {
    if (!p) return
    if (p.filename && p.body?.attachmentId) out.push({ filename: p.filename, attachmentId: p.body.attachmentId, mimeType: p.mimeType })
    if (Array.isArray(p.parts)) p.parts.forEach(walk)
  })(payload)
  return out
}

// Parse "Daily Maintenance Report_ <Rig>_<DD-MM-YYYY>" (tolerant of spacing).
export function parseSubject(subject) {
  const s = stripReplyPrefix(subject) // drop any RE:/FW: so rig/date parse cleanly
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

export const isReply = (s) => /^(re|fw|fwd)\s*:/i.test(String(s || '').trim())
// Strip one or more leading RE:/FW:/FWD: prefixes — a rig may send its DMR as a reply.
export const stripReplyPrefix = (s) => String(s || '').trim().replace(/^((re|fw|fwd)\s*:\s*)+/i, '')
// starts-with check ignores any reply prefix.
export const startsWithDMR = (s) => stripReplyPrefix(s).toLowerCase().startsWith('daily maintenance report')
export const hasIncludeMr = (s) => /include\s+mr/i.test(String(s || ''))

// Classify one Gmail message resource (the `data` from messages.get, format:full).
// Returns either { status:'matched', ... } or { status:'excluded', reason, ... }.
export function classifyMessage(data) {
  const payload = data.payload
  const subject = headerValue(payload, 'Subject')
  const from = headerValue(payload, 'From')
  const date = headerValue(payload, 'Date')
  const atts = collectAttachments(payload)
  const docx = atts.filter((a) => /\.docx$/i.test(a.filename))
  const base = { id: data.id, subject, from, date }

  if (hasIncludeMr(subject)) return { ...base, status: 'excluded', reason: 'admin thread ("Include Mr")' }
  if (!startsWithDMR(subject)) {
    return { ...base, status: 'excluded', reason: 'subject does not start with "Daily Maintenance Report" (after stripping RE:/FW:)' }
  }
  if (!docx.length) {
    return { ...base, status: 'excluded', reason: 'no .docx attachment' + (atts.length ? ` (has: ${atts.map((a) => a.filename).join(', ')})` : ' (no attachments)') }
  }

  const { rigRaw, dateISO } = parseSubject(subject)
  return { ...base, status: 'matched', docx, rigRaw, rig: matchRig(rigRaw), dateISO }
}
