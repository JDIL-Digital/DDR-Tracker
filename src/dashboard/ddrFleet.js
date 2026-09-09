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
