// scripts/daily-summary.js
//
// Builds the daily DDR fleet summary email. READ-ONLY against Supabase (only
// SELECTs — never writes) and DRY RUN by default (prints numbers + writes an
// HTML preview file). Only with --send does it email via Resend.
//
//   node scripts/daily-summary.js                 # today, dry run
//   node scripts/daily-summary.js 2026-07-23      # specific date, dry run
//   node scripts/daily-summary.js 2026-07-23 --send   # actually email it
//
// Env (from .env.local): RESEND_API_KEY (for --send), RESEND_FROM, RESEND_TO.

import { writeFileSync } from 'node:fs'
import { getServerClient } from './supabase-server.js'

const PREVIEW_PATH = 'daily-summary-preview.html'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
const fmt = (n, dp = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(dp))
const pct = (n) => (n == null || Number.isNaN(n) ? '—' : `${Number(n).toFixed(1)}%`)
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// --- Read everything needed for the date (READ-ONLY) ------------------------
async function loadData(supabase, date) {
  const { data: rigs, error: e1 } = await supabase.from('rigs').select('id, name').order('name')
  if (e1) throw new Error(`read rigs: ${e1.message}`)

  const { data: codes, error: e2 } = await supabase.from('code_master').select('code, description, is_npt')
  if (e2) throw new Error(`read code_master: ${e2.message}`)
  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))

  const { data: reports, error: e3 } = await supabase
    .from('reports')
    .select('id, rig_id, well_no, depth_md_m, day_meterage_m, extraction_status')
    .eq('report_date', date)
  if (e3) throw new Error(`read reports: ${e3.message}`)

  let activities = []
  if (reports.length) {
    const { data: acts, error: e4 } = await supabase
      .from('activities')
      .select('report_id, code, hrs, depth_in_m, depth_out_m, meterage_m')
      .in('report_id', reports.map((r) => r.id))
    if (e4) throw new Error(`read activities: ${e4.message}`)
    activities = acts
  }
  return { rigs, nptCodes, drillingCodes, reports, activities }
}

// --- Compute per-rig + fleet metrics ----------------------------------------
function computeMetrics({ rigs, nptCodes, drillingCodes, reports, activities }) {
  const rigById = new Map(rigs.map((r) => [r.id, r]))
  const actsByReport = new Map()
  for (const a of activities) {
    if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
    actsByReport.get(a.report_id).push(a)
  }

  const perRig = []
  let fleetDrillMeterage = 0
  let fleetDrillHours = 0
  let fleetNptHours = 0
  let fleetTotalHours = 0

  for (const rep of reports) {
    const acts = actsByReport.get(rep.id) || []
    const totalHours = acts.reduce((s, a) => s + (a.hrs || 0), 0)
    const nptHours = acts.filter((a) => nptCodes.has(a.code)).reduce((s, a) => s + (a.hrs || 0), 0)

    const drillActs = acts.filter((a) => drillingCodes.has(a.code))
    const drillHours = drillActs.reduce((s, a) => s + (a.hrs || 0), 0)
    const drillMeterage = drillActs.reduce((s, a) => {
      const m = a.meterage_m != null ? a.meterage_m
        : a.depth_out_m != null && a.depth_in_m != null ? Math.max(a.depth_out_m - a.depth_in_m, 0)
        : 0
      return s + m
    }, 0)
    const rop = drillHours > 0 && drillMeterage > 0 ? drillMeterage / drillHours : null

    fleetDrillMeterage += drillMeterage
    fleetDrillHours += drillHours
    fleetNptHours += nptHours
    fleetTotalHours += totalHours

    perRig.push({
      rig: rigById.get(rep.rig_id)?.name || '(unknown rig)',
      well: rep.well_no,
      depth: rep.depth_md_m,
      meterage: rep.day_meterage_m,
      rop,
      nptPct: totalHours > 0 ? (nptHours / totalHours) * 100 : null,
      totalHours,
      status: rep.extraction_status,
    })
  }
  perRig.sort((a, b) => a.rig.localeCompare(b.rig))

  const reportedRigIds = new Set(reports.map((r) => r.rig_id))
  const missing = rigs.filter((r) => !reportedRigIds.has(r.id)).map((r) => r.name)
  const needsReview = perRig.filter((r) => r.status === 'needs_review').map((r) => r.rig)

  return {
    perRig,
    missing,
    needsReview,
    fleet: {
      reported: reports.length,
      total: rigs.length,
      avgRop: fleetDrillHours > 0 && fleetDrillMeterage > 0 ? fleetDrillMeterage / fleetDrillHours : null,
      nptPct: fleetTotalHours > 0 ? (fleetNptHours / fleetTotalHours) * 100 : null,
    },
  }
}

// --- HTML email (email-safe: inline styles, tables, explicit #ffffff bg) -----
function fleetHeaderLine(fleet) {
  return `${fleet.reported} of ${fleet.total} rigs reported · fleet avg ROP ${fmt(fleet.avgRop, 1)} m/hr · fleet NPT ${pct(fleet.nptPct)}`
}

function buildHtml(date, m) {
  const cell = 'padding:8px 10px;border-bottom:1px solid #eeeeee;color:#222222;font-size:14px'
  const numCell = `${cell};text-align:right`
  const nptHighCell =
    'padding:8px 10px;border-bottom:1px solid #eeeeee;text-align:right;font-size:14px;background-color:#fdecea;color:#b00020;font-weight:bold'
  const th = 'padding:8px 10px;font-size:13px;color:#333333;text-align:left;border-bottom:2px solid #dddddd'
  const thNum = `${th};text-align:right`

  const rowsHtml = m.perRig
    .map(
      (r) => `      <tr>
        <td style="${cell}">${esc(r.rig)}</td>
        <td style="${cell}">${esc(r.well) || '—'}</td>
        <td align="right" style="${numCell}">${fmt(r.depth, 0)}</td>
        <td align="right" style="${numCell}">${fmt(r.meterage, 0)}</td>
        <td align="right" style="${numCell}">${fmt(r.rop, 1)}</td>
        <td align="right" style="${r.nptPct != null && r.nptPct > 40 ? nptHighCell : numCell}">${pct(r.nptPct)}</td>
        <td style="${cell}">${esc(r.status)}</td>
      </tr>`
    )
    .join('\n')

  const emptyRow = `<tr><td colspan="7" style="${cell};color:#888888">No reports for this date.</td></tr>`

  const missingBlock = m.missing.length
    ? `<div style="padding:10px 12px;background-color:#fdecec;border-left:4px solid #c0392b">
         <strong style="color:#a11">Missing — no report received (${m.missing.length}):</strong>
         <span style="color:#b00020">${m.missing.map(esc).join(', ')}</span></div>`
    : `<div style="padding:10px 12px;background-color:#e6f7ed;border-left:4px solid #0a6b34">
         <strong style="color:#0a6b34">Missing — no report received:</strong>
         <span style="color:#0a6b34">None, all rigs reported.</span></div>`

  const reviewBlock = m.needsReview.length
    ? `<div style="padding:10px 12px;background-color:#fff6e5;border-left:4px solid #d38b00">
         <strong style="color:#8a5a00">Needs review (${m.needsReview.length}):</strong>
         <span style="color:#8a5a00">${m.needsReview.map(esc).join(', ')}</span></div>`
    : `<div style="padding:10px 12px;background-color:#f4f4f4;border-left:4px solid #bbbbbb">
         <strong style="color:#555555">Needs review:</strong>
         <span style="color:#666666">None.</span></div>`

  return `<!-- daily DDR summary for ${esc(date)} -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background-color:#ffffff;margin:0;padding:0">
  <tr>
    <td align="center" style="padding:24px 12px;background-color:#ffffff">
      <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif">
        <tr><td style="padding:0 0 4px 0;font-size:20px;font-weight:bold;color:#111111">DDR Daily Summary — ${esc(date)}</td></tr>
        <tr><td style="padding:0 0 16px 0;font-size:14px;color:#555555">${fleetHeaderLine(m.fleet)}</td></tr>
        <tr><td style="padding:0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background-color:#ffffff">
            <tr bgcolor="#f4f4f4">
              <th style="${th}">Rig</th>
              <th style="${th}">Well</th>
              <th style="${thNum}">Depth (m)</th>
              <th style="${thNum}">Day mtg (m)</th>
              <th style="${thNum}">Avg ROP</th>
              <th style="${thNum}">NPT %</th>
              <th style="${th}">Status</th>
            </tr>
${rowsHtml || emptyRow}
          </table>
        </td></tr>
        <tr><td style="padding:16px 0 0 0">${missingBlock}</td></tr>
        <tr><td style="padding:12px 0 0 0">${reviewBlock}</td></tr>
        <tr><td style="padding:18px 0 0 0;font-size:12px;color:#999999">Generated automatically from rig DDRs.</td></tr>
      </table>
    </td>
  </tr>
</table>`
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const doSend = args.includes('--send')
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || todayISO()

  console.log('DDR daily summary')
  console.log(`Date : ${date}`)
  console.log(`Mode : ${doSend ? 'SEND (email via Resend)' : 'DRY RUN (print + write preview, no email, no DB writes)'}`)

  const supabase = getServerClient()
  const raw = await loadData(supabase, date)
  const m = computeMetrics(raw)

  console.log(`\n===================== FLEET (${date}) =====================`)
  console.log(`Header line : ${fleetHeaderLine(m.fleet)}`)
  console.log(`Rigs reported     : ${m.fleet.reported} of ${m.fleet.total}`)
  console.log(`Fleet avg ROP     : ${fmt(m.fleet.avgRop, 1)} m/hr`)
  console.log(`Fleet NPT %       : ${pct(m.fleet.nptPct)}`)

  console.log('\n--- Per rig ---')
  for (const r of m.perRig) {
    console.log(
      `${r.rig.padEnd(16)} depth=${fmt(r.depth, 0)}  meterage=${fmt(r.meterage, 0)}  ROP=${fmt(r.rop, 1)} m/hr  NPT=${pct(r.nptPct)}  totalHrs=${fmt(r.totalHours, 1)}  status=${r.status}`
    )
  }
  console.log(`\nMissing (no report) : ${m.missing.length ? m.missing.join(', ') : '(none)'}`)
  console.log(`Needs review        : ${m.needsReview.length ? m.needsReview.join(', ') : '(none)'}`)

  const html = buildHtml(date, m)

  if (!doSend) {
    writeFileSync(PREVIEW_PATH, html)
    console.log(`\nDRY RUN — no email sent, no data changed. Preview written to: ${PREVIEW_PATH}`)
    console.log('Open that file in a browser to see the formatted email.')
    return
  }

  // --- SEND via Resend ---
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  const to = process.env.RESEND_TO
  if (!apiKey) throw new Error('RESEND_API_KEY missing from .env.local')
  if (!from || !to) throw new Error('RESEND_FROM and RESEND_TO must be set in .env.local to --send')

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to: to.split(',').map((s) => s.trim()),
    subject: `DDR Daily Summary — ${date} (${m.fleet.reported}/${m.fleet.total} rigs)`,
    html,
  })
  if (error) throw new Error(`Resend send failed: ${JSON.stringify(error)}`)
  console.log(`\nSENT via Resend. id=${data?.id}`)
}

main().catch((err) => {
  console.error('\nERROR:', err.message)
  process.exitCode = 1
})
