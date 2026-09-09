// DDR Fleet data layer (redesigned Fleet tab) — READ-ONLY via the front-end
// (publishable-key) client. Everything is scoped to a SELECTED report_date and
// summed across the rigs that actually filed a DDR that day. Nothing is invented:
// a rig with no DDR for the date contributes nothing.
import { supabase } from '../lib/supabaseClient'

// Distinct DDR report_dates that exist in the reports table, newest first.
// Drives the date picker; the caller defaults to the most recent available date.
export async function loadDdrDates() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase
    .from('reports')
    .select('report_date')
    .not('report_date', 'is', null)
    .order('report_date', { ascending: false })
  if (error) throw new Error(error.message)
  return [...new Set((data || []).map((r) => r.report_date))]
}

// Section A — fleet-total KPIs for ONE date:
//   { date, reportsReceived, fleetSize, dieselRob, hours:{RODR,NODR,EBDR,MDR} }
// ODR/NODR/EBDR/MDR hours = sum of activities.hrs grouped by the activity's
// code_master.condition (own-day activities of that date's reports). Diesel ROB =
// sum of reports.diesel_rob_kl across the rigs reporting that date.
export async function loadFleetTotals(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!date) return { date: null, reportsReceived: 0, fleetSize: 0, dieselRob: null, hours: { RODR: 0, NODR: 0, EBDR: 0, MDR: 0 } }

  const [rigsRes, codesRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id'),
    supabase.from('code_master').select('code, condition'),
    supabase.from('reports').select('id, rig_id, diesel_rob_kl').eq('report_date', date),
  ])
  for (const r of [rigsRes, codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const fleetSize = (rigsRes.data || []).length
  const reports = repRes.data || []
  const reportIds = reports.map((r) => r.id)
  const reportsReceived = new Set(reports.map((r) => r.rig_id)).size

  let dieselRob = 0
  let dieselHas = false
  for (const r of reports) {
    if (r.diesel_rob_kl != null) { dieselRob += Number(r.diesel_rob_kl) || 0; dieselHas = true }
  }

  const condByCode = new Map((codesRes.data || []).map((c) => [c.code, c.condition]))
  const hours = { RODR: 0, NODR: 0, EBDR: 0, MDR: 0 }
  if (reportIds.length) {
    // Small per-date volume (a few rigs x ~10-20 rows) — well under the 1000-row cap.
    const actRes = await supabase.from('activities').select('code, hrs').in('report_id', reportIds)
    if (actRes.error) throw new Error(actRes.error.message)
    for (const a of actRes.data || []) {
      const cond = condByCode.get(a.code)
      if (cond && cond in hours) hours[cond] += Number(a.hrs) || 0
    }
  }

  return { date, reportsReceived, fleetSize, dieselRob: dieselHas ? dieselRob : null, hours }
}

// Paginated activities fetch (avoids the 1000-row PostgREST cap on long wells).
async function fetchActivities(reportIds) {
  if (!reportIds.length) return []
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('activities')
      .select('report_id, code, hrs')
      .in('report_id', reportIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || !data.length) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

const normWell = (s) => String(s ?? '').trim().toLowerCase()

// Section C — cumulative RODR/NODR/EBDR hours PER RIG for the rig's CURRENT well,
// accumulated up to the selected date (resets on a new well). The "current well"
// is the well_no on the rig's DDR for the selected date; only rigs that filed a
// DDR that date get a bar. Hours = sum of that rig's activity hours (by
// code_master.condition) across ALL its DDRs for that well with report_date <= date.
export async function loadDowntimeByRig(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!date) return { rigs: [], hasData: false }

  const [rigsRes, codesRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase.from('code_master').select('code, condition'),
    supabase.from('reports').select('id, rig_id, report_date, well_no').lte('report_date', date),
  ])
  for (const r of [rigsRes, codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const condByCode = new Map((codesRes.data || []).map((c) => [c.code, c.condition]))
  const reports = repRes.data || []

  // Current well per rig = well_no on the selected date's report.
  const currentWell = new Map()
  for (const r of reports) if (r.report_date === date) currentWell.set(r.rig_id, r.well_no ?? null)

  // Reports for each rig's current well, up to the date.
  const reportRig = new Map()
  const relevantIds = []
  for (const r of reports) {
    if (!currentWell.has(r.rig_id)) continue
    if (normWell(r.well_no) === normWell(currentWell.get(r.rig_id))) {
      relevantIds.push(r.id)
      reportRig.set(r.id, r.rig_id)
    }
  }

  const acts = await fetchActivities(relevantIds)
  const perRig = new Map()
  for (const a of acts) {
    const rigId = reportRig.get(a.report_id)
    if (!rigId) continue
    const cond = condByCode.get(a.code)
    if (!cond) continue
    const e = perRig.get(rigId) || { RODR: 0, NODR: 0, EBDR: 0 }
    if (cond in e) e[cond] += Number(a.hrs) || 0
    perRig.set(rigId, e)
  }

  const ordered = (rigsRes.data || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(String(b.name)))

  const rows = ordered.map((rig) => {
    if (!currentWell.has(rig.id)) return { rig: rig.name, hasData: false }
    return { rig: rig.name, well: currentWell.get(rig.id), hasData: true, hours: perRig.get(rig.id) || { RODR: 0, NODR: 0, EBDR: 0 } }
  })
  return { rigs: rows, hasData: rows.some((r) => r.hasData) }
}

// Section D — NPT (non-productive time) by cause, per rig, for the selected date.
// NPT = NODR + EBDR condition hours (RODR = productive, excluded). MDR (rig-move /
// tow, contract-specific) is EXCLUDED from NPT but reported separately as mdrHrs
// so it's visible, not silently dropped. Causes = the rig's NPT activities grouped
// by code + description. Only rigs with a DDR on the date; a reporting rig with
// zero NPT gets an honest "no non-productive time" state (causes: []).
export async function loadNptByCause(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!date) return { rigs: [], hasData: false }

  const [rigsRes, codesRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase.from('code_master').select('code, description, condition'),
    supabase.from('reports').select('id, rig_id, oim').eq('report_date', date),
  ])
  for (const r of [rigsRes, codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const codeInfo = new Map((codesRes.data || []).map((c) => [c.code, { description: c.description, condition: c.condition }]))
  const reports = repRes.data || []
  const reportIds = reports.map((r) => r.id)

  const actsByReport = new Map()
  if (reportIds.length) {
    const acts = await fetchActivities(reportIds)
    for (const a of acts) {
      if (!actsByReport.has(a.report_id)) actsByReport.set(a.report_id, [])
      actsByReport.get(a.report_id).push(a)
    }
  }

  const byRig = new Map(reports.map((r) => [r.rig_id, r]))
  const ordered = (rigsRes.data || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(String(b.name)))

  const rows = ordered
    .filter((rig) => byRig.has(rig.id))
    .map((rig) => {
      const rep = byRig.get(rig.id)
      const acts = actsByReport.get(rep.id) || []
      const causeMap = new Map()
      let mdrHrs = 0
      for (const a of acts) {
        const info = codeInfo.get(a.code)
        const cond = info?.condition
        if (cond === 'MDR') { mdrHrs += Number(a.hrs) || 0; continue }
        if (cond !== 'NODR' && cond !== 'EBDR') continue // NPT only
        const key = a.code ?? '(unmapped)'
        const e = causeMap.get(key) || { code: a.code ?? null, description: info?.description ?? null, condition: cond, hrs: 0 }
        e.hrs += Number(a.hrs) || 0
        causeMap.set(key, e)
      }
      const causes = [...causeMap.values()].filter((c) => c.hrs > 0).sort((a, b) => b.hrs - a.hrs)
      return { rig: rig.name, oim: rep.oim ?? null, date, causes, nptTotal: causes.reduce((s, c) => s + c.hrs, 0), mdrHrs }
    })

  return { rigs: rows, hasData: rows.length > 0 }
}

// Section B — one card per rig for the selected date. Returns the full fleet in
// sort_order; a rig with no DDR that date has hasReport=false (honest empty card).
// Fields per reporting rig: report_no, pob_total, well_no, lti_days (days since
// last LTI — "Days Without LTI"), fuel_consumed_kl (daily diesel consumption),
// downtime_daily_hrs / downtime_cum_hrs, and needs_review (from extraction_status).
export async function loadRigCards(date) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!date) return []
  const [rigsRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase
      .from('reports')
      .select('rig_id, report_no, well_no, pob_total, lti_days, fuel_consumed_kl, downtime_daily_hrs, downtime_cum_hrs, extraction_status')
      .eq('report_date', date),
  ])
  for (const r of [rigsRes, repRes]) if (r.error) throw new Error(r.error.message)

  const reportByRig = new Map((repRes.data || []).map((r) => [r.rig_id, r]))
  const rigs = (rigsRes.data || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(String(b.name)))

  return rigs.map((rig) => {
    const r = reportByRig.get(rig.id)
    if (!r) return { rig: rig.name, hasReport: false }
    return {
      rig: rig.name,
      hasReport: true,
      reportNo: r.report_no,
      pob: r.pob_total,
      well: r.well_no,
      ltiDays: r.lti_days,
      dailyDiesel: r.fuel_consumed_kl,
      downtimeDaily: r.downtime_daily_hrs,
      downtimeCum: r.downtime_cum_hrs,
      needsReview: r.extraction_status === 'needs_review',
    }
  })
}
