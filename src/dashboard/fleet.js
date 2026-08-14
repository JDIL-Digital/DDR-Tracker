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

// ---- Fixed fleet display order (DB-driven via rigs.sort_order) --------------
// Shared by every screen so the fleet lists identically everywhere. Build a
// case-insensitive name -> sort_order map from the DB rig rows, then order names
// by (sort_order asc, name asc). Rigs missing a sort_order fall back to 999.
export function rigOrderMap(rigRows) {
  const m = new Map()
  for (const r of rigRows || []) m.set(norm(r.name), r.sort_order == null ? 999 : r.sort_order)
  return m
}
export function compareRigNames(orderMap) {
  return (a, b) => {
    const sa = orderMap.get(norm(a)) ?? 999
    const sb = orderMap.get(norm(b)) ?? 999
    if (sa !== sb) return sa - sb
    return String(a).localeCompare(String(b))
  }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function drillMeterageOf(a) {
  if (a.meterage_m != null) return a.meterage_m
  if (a.depth_out_m != null && a.depth_in_m != null) return Math.max(a.depth_out_m - a.depth_in_m, 0)
  return 0
}

// Calendar-month range (start/end ISO + label) for the month containing `date`.
function monthRange(dateISO) {
  const [y, m] = String(dateISO).split('-').map(Number)
  const mm = String(m).padStart(2, '0')
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate() // day 0 of next month = last day
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(lastDay).padStart(2, '0')}`,
    label: `${MONTHS[m - 1]} ${y}`,
  }
}

async function _loadFleet(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const mr = monthRange(date)

  // Daily (selected date) + monthly (whole calendar month) report sets in one round.
  const [rigsRes, codesRes, reportsRes, monthReportsRes] = await Promise.all([
    supabase.from('rigs').select('id, name, rig_type, sort_order'),
    supabase.from('code_master').select('code, description, is_npt, condition'),
    supabase
      .from('reports')
      .select('id, rig_id, well_no, depth_md_m, day_meterage_m, fuel_consumed_kl, extraction_status')
      .eq('report_date', date),
    supabase
      .from('reports')
      .select('id, rig_id, report_date')
      .gte('report_date', mr.start)
      .lte('report_date', mr.end),
  ])
  for (const r of [rigsRes, codesRes, reportsRes, monthReportsRes]) if (r.error) throw new Error(r.error.message)

  const rigs = rigsRes.data || []
  const codes = codesRes.data || []
  const reports = reportsRes.data || []
  const monthReports = monthReportsRes.data || []
  const reportIds = reports.map((r) => r.id)
  const monthReportIds = monthReports.map((r) => r.id)

  // Daily activities + inventory (for the selected date).
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

  // Monthly activities (for the ODR/NODR/EBDR condition roll-up + downtime chart).
  let monthActs = []
  if (monthReportIds.length) {
    const monthActRes = await supabase.from('activities').select('report_id, code, hrs').in('report_id', monthReportIds)
    if (monthActRes.error) throw new Error(monthActRes.error.message)
    monthActs = monthActRes.data || []
  }

  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))
  const codeDesc = new Map(codes.map((c) => [c.code, c.description]))
  const condByCode = new Map(codes.map((c) => [c.code, c.condition]))

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

  // Monthly condition hours per rig: rig_id -> { odr, nodr, ebdr }.
  const monthRigByReport = new Map(monthReports.map((r) => [r.id, r.rig_id]))
  const monthlyByRig = new Map()
  for (const a of monthActs) {
    const rigId = monthRigByReport.get(a.report_id)
    if (!rigId) continue
    const cond = condByCode.get(a.code)
    if (!cond) continue
    const hrs = a.hrs || 0
    const e = monthlyByRig.get(rigId) || { odr: 0, nodr: 0, ebdr: 0 }
    if (cond === 'RODR') e.odr += hrs
    else if (cond === 'NODR') e.nodr += hrs
    else if (cond === 'EBDR') e.ebdr += hrs
    monthlyByRig.set(rigId, e)
  }
  const monthHasData = monthReports.length > 0

  // Build the display fleet: known roster + any DB rigs not in the roster, then
  // apply the fixed fleet order (rigs.sort_order, name tiebreak).
  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ].sort(compareRigNames(rigOrderMap(rigs)))

  const rigViews = []
  const nptByCauseHours = new Map()
  let dieselRob = 0
  let dieselConsumed = 0
  let dieselHasData = false
  let reportsReceived = 0
  let totalOdr = 0
  let totalNodr = 0
  let totalEbdr = 0

  for (const displayName of displayNames) {
    const dbRig = rigByNorm.get(norm(displayName))
    const report = dbRig ? reportByRig.get(dbRig.id) : null
    const mon = dbRig ? monthlyByRig.get(dbRig.id) : null
    const odrHrs = mon?.odr || 0
    const nodrHrs = mon?.nodr || 0
    const ebdrHrs = mon?.ebdr || 0
    totalOdr += odrHrs
    totalNodr += nodrHrs
    totalEbdr += ebdrHrs

    if (!report) {
      // Awaiting for the selected DATE, but may still have monthly totals.
      rigViews.push({
        name: displayName, hasReport: false, status: 'Awaiting', pill: 'p-aw',
        odrHrs, nodrHrs, ebdrHrs, dieselRob: null,
      })
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

    const status = drillHours > 0 ? 'Operating' : 'Standby'
    const pill = status === 'Operating' ? 'p-op' : 'p-sb'

    // Diesel ROB / consumed from inventory (closing / consumed of fuel rows).
    let rigDiesel = 0
    let rigDieselHas = false
    for (const inv of invByReport.get(report.id) || []) {
      if (DIESEL_RE.test(inv.item || '')) {
        if (inv.closing != null) { rigDiesel += inv.closing; dieselRob += inv.closing; rigDieselHas = true; dieselHasData = true }
        if (inv.consumed != null) { dieselConsumed += inv.consumed; dieselHasData = true }
      }
    }

    // NPT-by-cause accumulation (real; is_npt = EBDR under the IADC codes).
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
      odrHrs, nodrHrs, ebdrHrs,
      dieselRob: rigDieselHas ? rigDiesel : null,
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

  // Downtime-per-rig chart (this month) — one bar per rig = its EBDR hours.
  const ebdrVals = rigViews.map((r) => r.ebdrHrs).filter((v) => v > 0)
  const ebdrMax = ebdrVals.length ? Math.max(...ebdrVals) : 0
  const downtimeChart = rigViews.map((r) => ({
    label: r.name,
    value: monthHasData ? r.ebdrHrs : null,
    pct: ebdrMax > 0 && r.ebdrHrs > 0 ? (r.ebdrHrs / ebdrMax) * 100 : null,
  }))
  const downtimeHasData = ebdrVals.length > 0

  const statusCounts = { operating: 0, standby: 0, tripping: 0, maintenance: 0, awaiting: 0 }
  for (const r of rigViews) {
    if (r.status === 'Operating') statusCounts.operating++
    else if (r.status === 'Standby') statusCounts.standby++
    else if (r.status === 'Tripping') statusCounts.tripping++
    else if (r.status === 'Maintenance') statusCounts.maintenance++
    else statusCounts.awaiting++
  }

  return {
    date,
    rigs: rigViews,
    downtimeChart,
    downtimeHasData,
    nptByCause,
    statusCounts,
    kpis: {
      monthLabel: mr.label,
      monthHasData,
      totalOdr,
      totalNodr,
      totalEbdr,
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
