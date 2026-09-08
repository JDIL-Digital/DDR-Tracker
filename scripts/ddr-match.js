// scripts/ddr-match.js
//
// Shared DDR (Daily Drilling Report) email matching — the single source of truth
// used by both the finder (find-ddr-emails.js) and the ingester (ingest-ddr.js).
// Pure functions over a Gmail message resource; no I/O.
//
// A DDR email matches when, on the subject (after stripping RE:/FW:):
//   * it names one of the 6 rigs (SHORT form e.g. "JSUP" OR full name e.g.
//     "JINDAL SUPREME"), matched case/punctuation-insensitively, AND
//   * it contains a "DDR" token ("RDDR" = revised), AND
//   * it contains a DD-MM-YYYY date, AND
//   * the email has a .xlsx attachment (DDRs are Excel; guards reply chatter).
// Returns { rig (canonical), report_date (ISO), is_revised, xlsx:[...] }.
// If it looks like a DDR (has DDR token + date + .xlsx) but the rig can't be
// matched, it is FLAGGED (not guessed) so a human can look.

// Canonical rig <- accepted subject forms (short + full + tolerated variants).
// Canonical names mirror the rigs table exactly.
export const RIG_ALIASES = [
  { canonical: 'Jindal Supreme',  aliases: ['JSUP', 'JINDAL SUPREME'] },
  { canonical: 'Jindal Pioneer',  aliases: ['JPION', 'JINDAL PIONEER'] },
  { canonical: 'Jindal Star',     aliases: ['JSTAR', 'JINDAL STAR'] },
  { canonical: 'Virtue-1',        aliases: ['VIR1', 'VIRTUE 1', 'VIRTUE-1'] },
  { canonical: 'Jindal Explorer', aliases: ['JEXP', 'JINDAL EXPLORER'] },
  { canonical: 'Discovery-1',     aliases: ['DISC1', 'DISCOVERY 1', 'DISC-1', 'DISCOVERY-1'] },
]

// Normalize: lowercase + strip everything except a-z0-9 (so "DISC-1","DISC 1",
// "DISC1" all collapse to "disc1"; "JINDAL STAR"/"jindalstar" to "jindalstar").
export const normRig = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

// Strip one or more leading RE:/FW:/FWD: prefixes.
export const stripReplyPrefix = (s) =>
  String(s || '').trim().replace(/^((re|fw|fwd)\s*:\s*)+/i, '')

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

// Match a rig by any alias appearing in the normalized subject. Returns the
// canonical name, or null if none match.
export function matchRig(subject) {
  const nsub = normRig(subject)
  if (!nsub) return null
  for (const { canonical, aliases } of RIG_ALIASES) {
    for (const a of aliases) if (nsub.includes(normRig(a))) return canonical
  }
  return null
}

// DDR token detection on the reply-stripped subject. Returns { hasDDR, isRevised }.
// Boundary-safe (won't match "ddrilling" or "for ddr"->rddr): the token must be
// preceded by start/non-letter and NOT followed by another letter.
export function ddrToken(subject) {
  const m = String(subject || '').toLowerCase().match(/(?:^|[^a-z])(r?ddr)(?![a-z])/)
  return { hasDDR: !!m, isRevised: !!m && m[1] === 'rddr' }
}

// Parse a DD-MM-YYYY (tolerant of . / -) date -> ISO yyyy-mm-dd (or null).
export function parseDate(subject) {
  const m = String(subject || '').match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (!m) return null
  let [, dd, mm, yyyy] = m
  if (yyyy.length === 2) yyyy = '20' + yyyy
  if (+dd < 1 || +dd > 31 || +mm < 1 || +mm > 12) return null
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Pick the REAL DDR .xlsx from a (possibly multi-attachment) email. The real
// DDR file is named Rigname_DD-MM-YYYY, so choose the .xlsx whose filename
// contains the report date (DD-MM-YYYY, any separator) and/or a rig token;
// ignore generic templates like "DDR 2026.xlsx". A lone .xlsx is used as-is.
// Returns the chosen attachment, or null (-> needs_review; never guess).
export function selectDdrXlsx(xlsxList, rig, reportDateISO) {
  if (!xlsxList || !xlsxList.length) return null
  if (xlsxList.length === 1) return xlsxList[0]
  const [y, m, d] = String(reportDateISO || '').split('-')
  const ddmmyyyy = y && m && d ? `${d}${m}${y}` : null // filename uses DD-MM-YYYY
  const rigTokens = (RIG_ALIASES.find((r) => r.canonical === rig)?.aliases || []).map(normRig)
  const scored = xlsxList.map((a) => {
    const nf = normRig(a.filename)
    const hasDate = ddmmyyyy ? nf.includes(ddmmyyyy) : false
    const hasRig = rigTokens.some((t) => t && nf.includes(t))
    return { a, score: (hasDate ? 2 : 0) + (hasRig ? 1 : 0) }
  }).sort((x, z) => z.score - x.score)
  return scored[0].score > 0 ? scored[0].a : null // must match date and/or rig
}

// Classify one Gmail message resource (data from messages.get, format:full).
// -> { status:'matched'|'flagged'|'excluded', ... }
export function classifyMessage(data) {
  const payload = data.payload
  const subject = headerValue(payload, 'Subject')
  const from = headerValue(payload, 'From')
  const date = headerValue(payload, 'Date')
  const s = stripReplyPrefix(subject)
  const atts = collectAttachments(payload)
  const xlsx = atts.filter((a) => /\.xlsx$/i.test(a.filename))
  const base = { id: data.id, subject, from, date }

  const { hasDDR, isRevised } = ddrToken(s)
  const rig = matchRig(s)
  const dateISO = parseDate(s)

  if (!hasDDR) return { ...base, status: 'excluded', reason: 'no DDR/RDDR token in subject' }
  if (!xlsx.length) {
    return { ...base, status: 'excluded', reason: 'DDR subject but no .xlsx attachment' + (atts.length ? ` (has: ${atts.map((a) => a.filename).join(', ')})` : ' (no attachments)') }
  }
  // Looks like a DDR (token + xlsx) — now it MUST resolve a rig + date, else flag.
  if (!rig) return { ...base, status: 'flagged', reason: 'looks like a DDR but rig not matched', dateISO, is_revised: isRevised, xlsx }
  if (!dateISO) return { ...base, status: 'flagged', reason: 'looks like a DDR but date not parsed', rig, is_revised: isRevised, xlsx }

  return { ...base, status: 'matched', rig, report_date: dateISO, is_revised: isRevised, xlsx }
}
