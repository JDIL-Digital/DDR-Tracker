// Reports data layer. READ-ONLY via the front-end (publishable-key) client.
// Fetches everything for the window once (all rigs); the view filters by the
// selected rigs and aggregates per panel. Nothing is fabricated — absent data
// stays absent so the UI can show honest "—"/empty states.
import { supabase } from '../lib/supabaseClient'
import { FLEET_ROSTER, rigOrderMap, compareRigNames } from './fleet'
import { cached } from './dataCache'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function drillMeterageOf(a) {
  if (a.meterage_m != null) return a.meterage_m
  if (a.depth_out_m != null && a.depth_in_m != null) return Math.max(a.depth_out_m - a.depth_in_m, 0)
  return 0
}

// Equipment-downtime codes are detected from the real code_master descriptions
// (repair / equipment / breakdown / maintenance) — not hardcoded.
const EQUIP_RE = /repair|equipment|breakdown|maintenance/i

async function _loadReports(start, end) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const [rigsRes, codesRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase.from('code_master').select('code, description, category, is_npt'),
  ])
  if (rigsRes.error) throw new Error(rigsRes.error.message)
  if (codesRes.error) throw new Error(codesRes.error.message)

  const repRes = await supabase
    .from('reports')
    .select('id, rig_id, report_date, depth_md_m, day_meterage_m, fuel_consumed_kl')
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
      .select('report_id, code, hrs, depth_in_m, depth_out_m, meterage_m, remarks, seq')
      .in('report_id', reportIds)
    if (actRes.error) throw new Error(actRes.error.message)
    activities = actRes.data || []
  }

  const codeMap = new Map(codes.map((c) => [c.code, c]))
  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))
  const equipCodes = new Set(codes.filter((c) => EQUIP_RE.test(c.description || '')).map((c) => c.code))

  const rigById = new Map(rigs.map((r) => [r.id, r]))
  const repById = new Map(reports.map((r) => [r.id, r]))
  const rosterByNorm = new Map(FLEET_ROSTER.map((n) => [norm(n), n]))
  const displayRig = (dbName) => rosterByNorm.get(norm(dbName)) || dbName || '(unknown)'

  const hoursByReport = new Map()
  for (const a of activities) hoursByReport.set(a.report_id, (hoursByReport.get(a.report_id) || 0) + (a.hrs || 0))

  const acts = activities.map((a) => {
    const rep = repById.get(a.report_id)
    const cm = codeMap.get(a.code)
    const isDrilling = drillingCodes.has(a.code)
    return {
      rig: rep ? displayRig(rigById.get(rep.rig_id)?.name) : '(unknown)',
      date: rep?.report_date || null,
      code: a.code,
      description: cm?.description || `Code ${a.code}`,
      category: cm?.category || null,
      isNpt: nptCodes.has(a.code),
      isDrilling,
      isEquipment: equipCodes.has(a.code),
      hrs: a.hrs || 0,
      meterage: isDrilling ? drillMeterageOf(a) : 0,
      remark: a.remarks || null,
    }
  })

  const reps = reports.map((r) => ({
    rig: displayRig(rigById.get(r.rig_id)?.name),
    date: r.report_date,
    depth: r.depth_md_m,
    fuelKl: r.fuel_consumed_kl,
    hours: hoursByReport.get(r.id) || 0,
  }))

  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ].sort(compareRigNames(rigOrderMap(rigs)))
  const withData = new Set(reps.map((r) => r.rig))
  const rigList = displayNames.map((name) => ({ name, hasData: withData.has(name) }))

  const equipCodeLabels = [...equipCodes].map((c) => `${c} ${codeMap.get(c)?.description || ''}`.trim())

  return { window: { start, end }, rigList, acts, reps, equipCodeLabels }
}

// Cached wrapper — keyed by the date window; dedupes StrictMode double-invoke.
export function loadReports(start, end) {
  return cached('reports', [start, end], () => _loadReports(start, end))
}
