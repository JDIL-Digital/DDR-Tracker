// Analytics data layer. READ-ONLY via the front-end (publishable-key) client.
// Aggregates DDR data over a date window; anything absent stays null so the UI
// shows "—" rather than fabricated numbers.
import { supabase } from '../lib/supabaseClient'
import { FLEET_ROSTER, rigOrderMap, compareRigNames } from './fleet'
import { clamp } from './format'
import { cached, plannedRopSupported } from './dataCache'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function drillMeterageOf(a) {
  if (a.meterage_m != null) return a.meterage_m
  if (a.depth_out_m != null && a.depth_in_m != null) return Math.max(a.depth_out_m - a.depth_in_m, 0)
  return 0
}

export function healthColor(h) {
  if (h == null) return 'dim'
  if (h >= 80) return 'green'
  if (h >= 50) return 'amber'
  return 'red'
}

async function _loadAnalytics(start, end) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  // Detect planned_rop support in parallel (memoized, no failing probe).
  const [rigsRes, codesRes, benchRes, wpRes, hasPlanned] = await Promise.all([
    supabase.from('rigs').select('id, name, rig_type, sort_order'),
    supabase.from('code_master').select('code, description, is_npt'),
    supabase.from('benchmarks').select('iadc_code, norm_value, norm_unit'),
    supabase.from('well_plans')
      .select('rig_id, well_name, extraction_status, depths_verified, planned_depth_points, target_depth_m, raw_extract, created_at')
      .eq('extraction_status', 'extracted'),
    plannedRopSupported(),
  ])
  if (rigsRes.error) throw new Error(rigsRes.error.message)
  if (codesRes.error) throw new Error(codesRes.error.message)
  // Benchmarks + well_plans are optional (features may not be seeded yet) — treat
  // a fetch error as "none" so the honest empty states show instead of breaking
  // the whole Analytics page.
  const benchmarks = benchRes.error ? [] : benchRes.data || []
  const wellPlans = wpRes.error ? [] : wpRes.data || []

  // Only select planned_rop when the column actually exists — no probe, no 400.
  const base = 'id, rig_id, report_date, depth_md_m, day_meterage_m, fuel_consumed_kl'
  const repRes = await supabase
    .from('reports')
    .select(hasPlanned ? `${base}, planned_rop` : base)
    .gte('report_date', start)
    .lte('report_date', end)
  if (repRes.error) throw new Error(repRes.error.message)

  const rigs = rigsRes.data || []
  const codes = codesRes.data || []
  const reports = repRes.data || []
  const reportIds = reports.map((r) => r.id)

  let activities = []
  if (reportIds.length) {
    const actRes = await supabase
      .from('activities')
      .select('report_id, code, hrs, depth_in_m, depth_out_m, meterage_m')
      .in('report_id', reportIds)
    if (actRes.error) throw new Error(actRes.error.message)
    activities = actRes.data || []
  }

  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))
  const codeDesc = new Map(codes.map((c) => [c.code, c.description]))

  // Benchmark norm per IADC code, in HOURS. A code can have several benchmark
  // rows (per operation) — we take the tightest (minimum) hour-norm as a
  // first-pass. 'stand/hr' benchmarks are excluded: their unit isn't hours, so
  // they can't be compared to logged activity hours for ILT. (Refine to
  // per-operation matching when activity granularity supports it.)
  const normByCode = new Map()
  for (const b of benchmarks) {
    if (b.norm_unit !== 'hr' || b.iadc_code == null || b.norm_value == null) continue
    const cur = normByCode.get(b.iadc_code)
    if (cur == null || b.norm_value < cur) normByCode.set(b.iadc_code, b.norm_value)
  }

  const rigByNorm = new Map(rigs.map((r) => [norm(r.name), r]))
  const actsByReport = new Map()
  for (const a of activities) {
    if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
    actsByReport.get(a.report_id).push(a)
  }
  const reportsByRig = new Map()
  for (const rep of reports) {
    if (!reportsByRig.has(rep.rig_id)) reportsByRig.set(rep.rig_id, [])
    reportsByRig.get(rep.rig_id).push(rep)
  }

  // --- Well plans → per-rig verified DEPTH plan (Depth-vs-Days chart) ----------
  // Match a plan to a rig by rig_id, most-recent first. We track two things per
  // rig: whether ANY extracted plan exists (to distinguish "no plan" from "plan
  // but depths not verified"), and the most-recent plan whose depths an admin has
  // VERIFIED (depths_verified=true + non-empty points) — only those drive the chart.
  const anyPlanRigIds = new Set()
  const depthPlanByRigId = new Map()
  const sortedWP = [...wellPlans].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  for (const wp of sortedWP) {
    if (wp.rig_id) anyPlanRigIds.add(wp.rig_id)
    const pts = Array.isArray(wp.planned_depth_points) ? wp.planned_depth_points : []
    if (wp.depths_verified && pts.length && wp.rig_id && !depthPlanByRigId.has(wp.rig_id)) {
      depthPlanByRigId.set(wp.rig_id, {
        wellName: wp.well_name || null,
        targetDepthM: wp.target_depth_m ?? null,
        totalPlannedDays: wp.raw_extract?.total_planned_days ?? null,
        points: pts, // verified {activity, planned_depth_m, phase_days, cumulative_days, depth_confidence}
        milestones: Array.isArray(wp.raw_extract?.planned_milestones) ? wp.raw_extract.planned_milestones : [],
      })
    }
  }

  // Display fleet = roster + any DB rigs not in the roster, in fixed fleet order.
  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ].sort(compareRigNames(rigOrderMap(rigs)))

  const rigViews = displayNames.map((name) => {
    const dbRig = rigByNorm.get(norm(name))
    const reps = dbRig ? reportsByRig.get(dbRig.id) || [] : []
    // Depth plan status is independent of whether the rig has DDRs yet.
    const depthPlan = dbRig ? depthPlanByRigId.get(dbRig.id) || null : null
    const hasAnyPlan = dbRig ? anyPlanRigIds.has(dbRig.id) : false
    if (reps.length === 0) {
      return { name, hasData: false, nptCauses: [], scatter: [], iltSeries: [], depthPlan, hasAnyPlan }
    }

    let totalHours = 0
    let nptHours = 0
    let drillHours = 0
    let drillMeterage = 0
    let fuelConsumed = 0
    let fuelSeen = false
    let target = null
    const nptCauseMap = new Map()
    const scatter = []
    const iltByDate = new Map() // report_date -> ILT hours (over benchmark)

    // latest report (max report_date) for "current depth"
    const latest = reps.reduce((a, b) => (a.report_date >= b.report_date ? a : b))
    const currentDepth = latest.depth_md_m ?? null

    for (const rep of reps) {
      const acts = actsByReport.get(rep.id) || []
      const repHours = acts.reduce((s, a) => s + (a.hrs || 0), 0)
      totalHours += repHours
      for (const a of acts) {
        if (nptCodes.has(a.code)) {
          nptHours += a.hrs || 0
          if (a.hrs) {
            const cause = codeDesc.get(a.code) || `Code ${a.code}`
            nptCauseMap.set(cause, (nptCauseMap.get(cause) || 0) + a.hrs)
          }
        }
        if (drillingCodes.has(a.code)) {
          drillHours += a.hrs || 0
          drillMeterage += drillMeterageOf(a)
        }
        // ILT: only benchmarked (hour-norm) codes contribute; over-run only.
        const bnorm = normByCode.get(a.code)
        if (bnorm != null && a.hrs != null) {
          const ilt = Math.max(0, a.hrs - bnorm)
          if (ilt > 0) iltByDate.set(rep.report_date, (iltByDate.get(rep.report_date) || 0) + ilt)
        }
      }
      if (rep.fuel_consumed_kl != null) { fuelConsumed += rep.fuel_consumed_kl; fuelSeen = true }
      if (hasPlanned && rep.planned_rop != null) target = rep.planned_rop
      // scatter point: L/hr vs depth for this report
      if (rep.depth_md_m != null && rep.fuel_consumed_kl != null && repHours > 0) {
        scatter.push({ depth: rep.depth_md_m, lhr: (rep.fuel_consumed_kl * 1000) / repHours })
      }
    }

    const avgRop = drillHours > 0 && drillMeterage > 0 ? drillMeterage / drillHours : null
    const nptPct = totalHours > 0 ? (nptHours / totalHours) * 100 : null
    const fuelEconLhr = fuelSeen && totalHours > 0 ? (fuelConsumed * 1000) / totalHours : null
    const ropShortfallPct = target && avgRop != null ? Math.max(0, ((target - avgRop) / target) * 100) : 0
    const health =
      nptPct != null ? clamp(Math.round(100 - nptPct * 0.6 - ropShortfallPct * 0.4), 0, 100) : null

    const nptCauses = [...nptCauseMap.entries()].map(([label, hours]) => ({ label, hours }))
    const iltSeries = [...iltByDate.entries()]
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return {
      name,
      hasData: true,
      currentDepth,
      avgRop,
      target,
      nptPct,
      nptHours,
      totalHours,
      fuelEconLhr,
      health,
      healthColor: healthColor(health),
      nptCauses,
      scatter,
      iltSeries,
      depthPlan,
      hasAnyPlan,
    }
  })

  return { window: { start, end }, hasPlanned, rigs: rigViews }
}

// Cached wrapper: repeat tab switches (same window) return instantly and the
// StrictMode double-invoke is deduped. Keyed by the date window.
export function loadAnalytics(start, end) {
  return cached('analytics', [start, end], () => _loadAnalytics(start, end))
}
