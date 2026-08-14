// Assets data layer. READ-ONLY via the front-end (publishable-key) client.
// The rigs are the real seed assets. Equipment (pumps, top drives, BOPs) is
// reference data the user will register later — we never invent it. Equipment
// downtime is LIVE from the repair/breakdown activity codes (same source as the
// Reports downtime panel).
import { supabase } from '../lib/supabaseClient'
import { FLEET_ROSTER, rigOrderMap, compareRigNames } from './fleet'
import { cached } from './dataCache'
import { todayISO, shiftDate } from './format'

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const EQUIP_RE = /repair|equipment|breakdown|maintenance/i
// Bound the reports scan so Assets stays fast as history grows (recent well +
// recent downtime). Widen later if very old assets need to appear.
const ASSET_WINDOW_DAYS = 365

export const ASSET_CATEGORIES = [
  { key: 'rigs', label: 'Drilling Rigs' },
  { key: 'pumps', label: 'Mud Pumps' },
  { key: 'topdrives', label: 'Top Drives' },
  { key: 'bop', label: 'Blowout Preventers' },
]

async function _loadAssets() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const since = shiftDate(todayISO(), -ASSET_WINDOW_DAYS)
  const [rigsRes, codesRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id, name, rig_type, created_at, sort_order'),
    supabase.from('code_master').select('code, description, is_npt'),
    supabase.from('reports').select('id, rig_id, report_date, well_no, depth_md_m').gte('report_date', since),
  ])
  for (const r of [rigsRes, codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const rigs = rigsRes.data || []
  const codes = codesRes.data || []
  const reports = repRes.data || []
  const reportIds = reports.map((r) => r.id)

  let activities = []
  if (reportIds.length) {
    const a = await supabase
      .from('activities')
      .select('report_id, code, hrs, remarks, depth_in_m, depth_out_m, meterage_m')
      .in('report_id', reportIds)
    if (a.error) throw new Error(a.error.message)
    activities = a.data || []
  }

  const drillingCodes = new Set(codes.filter((c) => /drilling/i.test(c.description)).map((c) => c.code))
  const equipCodes = new Set(codes.filter((c) => EQUIP_RE.test(c.description || '')).map((c) => c.code))
  const codeDesc = new Map(codes.map((c) => [c.code, c.description]))

  const actsByReport = new Map()
  for (const a of activities) {
    if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
    actsByReport.get(a.report_id).push(a)
  }
  const repsByRig = new Map()
  for (const rep of reports) {
    if (!repsByRig.has(rep.rig_id)) repsByRig.set(rep.rig_id, [])
    repsByRig.get(rep.rig_id).push(rep)
  }

  const rigByNorm = new Map(rigs.map((r) => [norm(r.name), r]))
  const rosterNorms = new Set(FLEET_ROSTER.map(norm))
  const displayNames = [
    ...FLEET_ROSTER,
    ...rigs.filter((r) => !rosterNorms.has(norm(r.name))).map((r) => r.name),
  ].sort(compareRigNames(rigOrderMap(rigs)))

  const assets = displayNames.map((name) => {
    const dbRig = rigByNorm.get(norm(name))
    const reps = dbRig ? repsByRig.get(dbRig.id) || [] : []

    let status = 'No data'
    let pill = 'p-aw'
    let currentWell = null
    let lastReportDate = null
    const downtime = []

    if (reps.length) {
      const latest = reps.reduce((a, b) => (a.report_date >= b.report_date ? a : b))
      currentWell = latest.well_no || null
      lastReportDate = latest.report_date
      const latestActs = actsByReport.get(latest.id) || []
      const drilling = latestActs.some((a) => drillingCodes.has(a.code) && (a.hrs || 0) > 0)
      status = drilling ? 'Operating' : 'Standby'
      pill = drilling ? 'p-op' : 'p-sb'

      for (const rep of reps) {
        for (const a of actsByReport.get(rep.id) || []) {
          if (equipCodes.has(a.code)) {
            downtime.push({
              date: rep.report_date,
              hrs: a.hrs || 0,
              code: a.code,
              description: codeDesc.get(a.code) || `Code ${a.code}`,
              remark: a.remarks || null,
            })
          }
        }
      }
      downtime.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    }

    return {
      name,
      category: 'rigs',
      dbId: dbRig ? dbRig.id : null,
      registered: !!dbRig,
      type: dbRig?.rig_type || null, // reference; null → "—"
      commissioned: null, // reference field, editable later
      parentRig: null, // rigs have no parent; equipment would reference its rig
      status,
      pill,
      currentWell,
      lastInspection: null, // reference field, editable later
      lastReportDate,
      downtime,
    }
  })

  const counts = { rigs: assets.length, pumps: 0, topdrives: 0, bop: 0 }
  const equipCodeLabels = [...equipCodes].map((c) => `${c} ${codeDesc.get(c) || ''}`.trim())

  return { assets, counts, equipCodeLabels }
}

// Cached wrapper — dedupes StrictMode double-invoke and makes re-opening Assets instant.
export function loadAssets() {
  return cached('assets', [], () => _loadAssets())
}
