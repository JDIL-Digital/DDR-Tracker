// Fleet data layer for the dashboard. READ-ONLY against Supabase using the
// front-end client (publishable key only — never the secret key). Computes the
// view model from real DDR data; anything absent is left null so the UI can show
// "—" / "Awaiting" instead of inventing numbers.
import { supabase } from '../lib/supabaseClient'
import { cached } from './dataCache'

// Known fleet roster (real Jindal rig names) so the page always shows the full
// fleet. Metrics are NEVER taken from here — only names. A rig with no report
// for the date renders as an "Awaiting" placeholder.
export const FLEET_ROSTER = [
  'Virtue-1',
  'Jindal Supreme',
  'Jindal Explorer',
  'Jindal Star',
  'Discovery-1',
  'Jindal Pioneer',
]

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const DIESEL_RE = /(fuel|diesel)/i

function drillMeterageOf(a) {
  if (a.meterage_m != null) return a.meterage_m
  if (a.depth_out_m != null && a.depth_in_m != null) return Math.max(a.depth_out_m - a.depth_in_m, 0)
  return 0
}

async function _loadFleet(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const [rigsRes, codesRes, reportsRes] = await Promise.all([
    supabase.from('rigs').select('id, name, rig_type'),
    supabase.from('code_master').select('code, description, is_npt'),
    supabase
      .from('reports')
      .select('id, rig_id, well_no, depth_md_m, day_meterage_m, fuel_consumed_kl, extraction_status')
      .eq('report_date', date),
  ])
  for (const r of [rigsRes, codesRes, reportsRes]) if (r.error) throw new Error(r.error.message)

  const rigs = rigsRes.data || []
  const codes = codesRes.data || []
  const reports = reportsRes.data || []
  const reportIds = reports.map((r) => r.id)

  let activities = []
  let inventory = []
  if (reportIds.length) {
    const [actRes, invRes] = await Promise.all([
      supabase.from('activities').select('report_id, code, hrs, depth_in_m, depth_out_m, meterage_m').in('report_id', reportIds),
      supabase.from('inventory').select('report_id, item, closing, consumed').in('report_id', reportIds),
    ])
    if (actRes.error) throw new Error(actRes.error.message)
    if (invRes.error) throw new Error(invRes.error.message)
    activities = actRes.data || []
    inventory = invRes.data || []
  }

  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))
  const codeDesc = new Map(codes.map((c) => [c.code, c.description]))

  const rigByNorm = new Map(rigs.map((r) => [norm(r.name), r]))
  const reportByRig = new Map(reports.map((r) => [r.rig_id, r]))
  const actsByReport = new Map()
  for (const a of activities) {
    if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
    actsByReport.get(a.report_id).push(a)
  }
  const invByReport = new Map()
  for (const inv of inventory) {
    if (!invByReport.has(inv.report_id)) invByReport.set(inv.report_id, [])
    invByReport.get(inv.report_id).push(inv)
  }

  // Build the display fleet: roster first, then any DB rigs not in the roster.
  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ]

  const rigViews = []
  const nptByCauseHours = new Map()
  let fleetDrillMeterage = 0
  let fleetDrillHours = 0
  let fleetNptHours = 0
  let fleetTotalHours = 0
  let dieselRob = 0
  let dieselConsumed = 0
  let dieselHasData = false
  let reportsReceived = 0

  for (const displayName of displayNames) {
    const dbRig = rigByNorm.get(norm(displayName))
    const report = dbRig ? reportByRig.get(dbRig.id) : null

    if (!report) {
      rigViews.push({ name: displayName, hasReport: false, status: 'Awaiting', pill: 'p-aw' })
      continue
    }

    reportsReceived++
    const acts = actsByReport.get(report.id) || []
    const totalHours = acts.reduce((s, a) => s + (a.hrs || 0), 0)
    const nptHours = acts.filter((a) => nptCodes.has(a.code)).reduce((s, a) => s + (a.hrs || 0), 0)
    const drillActs = acts.filter((a) => drillingCodes.has(a.code))
    const drillHours = drillActs.reduce((s, a) => s + (a.hrs || 0), 0)
    const drillMeterage = drillActs.reduce((s, a) => s + drillMeterageOf(a), 0)
    const rop = drillHours > 0 && drillMeterage > 0 ? drillMeterage / drillHours : null
    const nptPct = totalHours > 0 ? (nptHours / totalHours) * 100 : null

    // Status derived from real activity mix (not invented).
    const status = drillHours > 0 ? 'Operating' : 'Standby'
    const pill = status === 'Operating' ? 'p-op' : 'p-sb'

    // Fleet accumulators
    fleetDrillMeterage += drillMeterage
    fleetDrillHours += drillHours
    fleetNptHours += nptHours
    fleetTotalHours += totalHours

    // Diesel ROB / consumed from inventory (closing / consumed of fuel rows).
    for (const inv of invByReport.get(report.id) || []) {
      if (DIESEL_RE.test(inv.item || '')) {
        if (inv.closing != null) { dieselRob += inv.closing; dieselHasData = true }
        if (inv.consumed != null) { dieselConsumed += inv.consumed; dieselHasData = true }
      }
    }
    if (report.fuel_consumed_kl != null) { dieselConsumed += 0 } // consumption already via inventory; keep report as fallback below

    // NPT-by-cause accumulation (real)
    for (const a of acts) {
      if (nptCodes.has(a.code) && a.hrs) {
        const cause = codeDesc.get(a.code) || `Code ${a.code}`
        nptByCauseHours.set(cause, (nptByCauseHours.get(cause) || 0) + a.hrs)
      }
    }

    rigViews.push({
      name: displayName,
      hasReport: true,
      status,
      pill,
      well: report.well_no || null,
      depth: report.depth_md_m,
      rop,
      nptPct,
      nptHigh: nptPct != null && nptPct > 40,
      needsReview: report.extraction_status === 'needs_review',
    })
  }

  // Fallback for diesel consumed if inventory had no consumed values.
  if (!dieselConsumed && reports.length) {
    const c = reports.reduce((s, r) => s + (r.fuel_consumed_kl || 0), 0)
    if (c) { dieselConsumed = c; dieselHasData = true }
  }

  const nptByCause = [...nptByCauseHours.entries()]
    .map(([label, hours]) => ({ label, hours }))
    .sort((a, b) => b.hours - a.hours)
  const nptMax = nptByCause.length ? nptByCause[0].hours : 0
  for (const it of nptByCause) it.pct = nptMax > 0 ? (it.hours / nptMax) * 100 : 0

  const ropValues = rigViews.filter((r) => r.hasReport && r.rop != null).map((r) => r.rop)
  const ropMax = ropValues.length ? Math.max(...ropValues) : 0
  const ropChart = rigViews.map((r) => ({
    label: r.name,
    value: r.hasReport ? r.rop : null,
    pct: r.hasReport && r.rop != null && ropMax > 0 ? (r.rop / ropMax) * 100 : null,
    amber: r.status === 'Standby' || r.status === 'Tripping',
  }))

  const statusCounts = { operating: 0, standby: 0, tripping: 0, maintenance: 0, awaiting: 0 }
  for (const r of rigViews) {
    if (r.status === 'Operating') statusCounts.operating++
    else if (r.status === 'Standby') statusCounts.standby++
    else if (r.status === 'Tripping') statusCounts.tripping++
    else if (r.status === 'Maintenance') statusCounts.maintenance++
    else statusCounts.awaiting++
  }

  const topNpt = nptByCause[0]
  const topNptRig = rigViews.find((r) => r.hasReport && r.nptHigh)

  return {
    date,
    rigs: rigViews,
    ropChart,
    nptByCause,
    statusCounts,
    kpis: {
      avgRop: fleetDrillHours > 0 && fleetDrillMeterage > 0 ? fleetDrillMeterage / fleetDrillHours : null,
      nptPct: fleetTotalHours > 0 ? (fleetNptHours / fleetTotalHours) * 100 : null,
      nptFoot: topNptRig && topNpt ? `${topNptRig.name} — ${topNpt.label.toLowerCase()}` : 'no NPT logged',
      dieselRob: dieselHasData ? dieselRob : null,
      dieselConsumed: dieselHasData ? dieselConsumed : null,
      reportsReceived,
      fleetSize: displayNames.length,
      awaiting: displayNames.length - reportsReceived,
    },
  }
}

// Cached wrapper — keyed by the selected date; dedupes StrictMode double-invoke.
export function loadFleet(date) {
  return cached('fleet', [date], () => _loadFleet(date))
}
