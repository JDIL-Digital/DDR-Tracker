// Analytics data layer. READ-ONLY via the front-end (publishable-key) client.
// Aggregates DDR data over a date window; anything absent stays null so the UI
// shows "—" rather than fabricated numbers.
import { supabase } from '../lib/supabaseClient'
import { FLEET_ROSTER } from './fleet'
import { clamp } from './format'

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

export async function loadAnalytics(start, end) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const [rigsRes, codesRes] = await Promise.all([
    supabase.from('rigs').select('id, name, rig_type'),
    supabase.from('code_master').select('code, description, is_npt'),
  ])
  if (rigsRes.error) throw new Error(rigsRes.error.message)
  if (codesRes.error) throw new Error(codesRes.error.message)

  // reports for the window. planned_rop may not exist yet — fall back gracefully.
  const base = 'id, rig_id, report_date, depth_md_m, day_meterage_m, fuel_consumed_kl'
  let hasPlanned = true
  let repRes = await supabase
    .from('reports')
    .select(`${base}, planned_rop`)
    .gte('report_date', start)
    .lte('report_date', end)
  const missingCol =
    repRes.error &&
    (/planned_rop/i.test(repRes.error.message || '') ||
      /planned_rop/i.test(repRes.error.details || '') ||
      repRes.error.code === '42703' ||
      repRes.error.code === 'PGRST204')
  if (missingCol) {
    hasPlanned = false
    repRes = await supabase.from('reports').select(base).gte('report_date', start).lte('report_date', end)
  }
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

  // Display fleet = roster first, then any DB rigs not in the roster.
  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ]

  const rigViews = displayNames.map((name) => {
    const dbRig = rigByNorm.get(norm(name))
    const reps = dbRig ? reportsByRig.get(dbRig.id) || [] : []
    if (reps.length === 0) {
      return { name, hasData: false, nptCauses: [], scatter: [] }
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
    }
  })

  return { window: { start, end }, hasPlanned, rigs: rigViews }
}
