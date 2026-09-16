// Reports data layer. READ-ONLY via the front-end (publishable-key) client.
// Fetches everything for the window once (all rigs); the view filters by the
// selected rigs and aggregates per panel. Nothing is fabricated — absent data
// stays absent so the UI can show honest "—"/empty states.
import { supabase } from '../lib/supabaseClient'
import { FLEET_ROSTER, rigOrderMap, compareRigNames } from './fleet'
import { cached } from './dataCache'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

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
      .select('report_id, code, hrs, remarks, seq')
      .in('report_id', reportIds)
    if (actRes.error) throw new Error(actRes.error.message)
    activities = actRes.data || []
  }

  const codeMap = new Map(codes.map((c) => [c.code, c]))
  const nptCodes = new Set(codes.filter((c) => c.is_npt).map((c) => c.code))
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
    return {
      rig: rep ? displayRig(rigById.get(rep.rig_id)?.name) : '(unknown)',
      date: rep?.report_date || null,
      code: a.code,
      description: cm?.description || `Code ${a.code}`,
      category: cm?.category || null,
      isNpt: nptCodes.has(a.code),
      isEquipment: equipCodes.has(a.code),
      hrs: a.hrs || 0,
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

// --- Daily Activity Summary (single rig) ------------------------------------
// One row per own-day report_date for ONE rig in [start,end]. Hours are split by
// the authoritative IADC code_master.condition:
//   Operating = RODR · Non-Operating = NODR · Moving = MDR · Break Down = EBDR.
// Remarks = each activity as a time-stamped VERBATIM line (rig's exact wording),
// in chronological order — a professional daily drilling log. Nothing invented:
// a rig with no reports returns rows:[]; a day with no activities has empty
// remarks. (Short Deployment figures are NOT in the DDR yet — the UI shows "—".)
export async function loadDailyActivitySummary(rigId, start, end) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId) return { rows: [], hasRig: false }

  const [codesRes, repRes] = await Promise.all([
    supabase.from('code_master').select('code, condition'),
    supabase
      .from('reports')
      .select('id, report_date, well_no, report_no')
      .eq('rig_id', rigId)
      .gte('report_date', start)
      .lte('report_date', end)
      .order('report_date', { ascending: true }),
  ])
  if (codesRes.error) throw new Error(codesRes.error.message)
  if (repRes.error) throw new Error(repRes.error.message)

  const condByCode = new Map((codesRes.data || []).map((c) => [c.code, c.condition]))
  const reports = repRes.data || []
  const reportIds = reports.map((r) => r.id)

  // Paginate activities to dodge the 1000-row PostgREST cap over a long range.
  const activities = []
  if (reportIds.length) {
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('activities')
        .select('report_id, time_from, time_to, hrs, code, remarks')
        .in('report_id', reportIds)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data || !data.length) break
      activities.push(...data)
      if (data.length < PAGE) break
    }
  }

  const actsByReport = new Map()
  for (const a of activities) {
    if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
    actsByReport.get(a.report_id).push(a)
  }

  const rows = reports.map((rep) => {
    const acts = actsByReport.get(rep.id) || []
    const sums = { RODR: 0, NODR: 0, MDR: 0, EBDR: 0 }
    for (const a of acts) {
      const cond = condByCode.get(a.code)
      if (cond && cond in sums) sums[cond] += Number(a.hrs) || 0
    }
    const remarks = acts
      .slice()
      .sort((a, b) => String(a.time_from ?? '').localeCompare(String(b.time_from ?? '')))
      .map((a) => ({ from: a.time_from ?? null, to: a.time_to ?? null, text: a.remarks ?? '' }))
    return {
      date: rep.report_date,
      well: rep.well_no ?? null,
      reportNo: rep.report_no ?? null,
      operating: sums.RODR,
      nonOperating: sums.NODR,
      moving: sums.MDR,
      breakDown: sums.EBDR,
      total: sums.RODR + sums.NODR + sums.MDR + sums.EBDR,
      remarks,
    }
  })

  return { rows, hasRig: true }
}
