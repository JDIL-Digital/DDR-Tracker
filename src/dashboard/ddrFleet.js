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

// Section C — RIG TIME DISTRIBUTION: cumulative RODR/NODR/EBDR activity hours per
// rig across ALL its DDRs whose report_date is within [from, to] (both bounds
// inclusive), regardless of well changes (NO per-well reset — a rig that changed
// wells still shows its full hours for the period). Returns per-rig `days` (DDRs
// in range) and `nullCodeHrs` (activity hours whose code has no IADC condition —
// e.g. an unmapped bare code — surfaced so the bar total isn't silently short;
// MDR/rig-move hours are excluded from this RODR/NODR/EBDR view). Only rigs with a
// DDR in the range get a bar.
export async function loadRigTimeDistribution(from, to) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!from || !to) return { rigs: [], hasData: false, from, to }

  const [rigsRes, codesRes, repRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase.from('code_master').select('code, condition'),
    supabase.from('reports').select('id, rig_id, report_date').gte('report_date', from).lte('report_date', to),
  ])
  for (const r of [rigsRes, codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const condByCode = new Map((codesRes.data || []).map((c) => [c.code, c.condition]))
  const reports = repRes.data || []
  const reportRig = new Map(reports.map((r) => [r.id, r.rig_id]))

  // Distinct report_dates per rig within the range (= days that rig reported).
  const daysByRig = new Map()
  for (const r of reports) {
    if (!daysByRig.has(r.rig_id)) daysByRig.set(r.rig_id, new Set())
    daysByRig.get(r.rig_id).add(r.report_date)
  }

  const acts = await fetchActivities(reports.map((r) => r.id))
  const perRig = new Map()
  for (const a of acts) {
    const rigId = reportRig.get(a.report_id)
    if (!rigId) continue
    const e = perRig.get(rigId) || { RODR: 0, NODR: 0, EBDR: 0, nullCodeHrs: 0 }
    const cond = condByCode.get(a.code)
    if (cond === 'RODR' || cond === 'NODR' || cond === 'EBDR') e[cond] += Number(a.hrs) || 0
    else if (cond === 'MDR') { /* rig-move — not part of the RODR/NODR/EBDR distribution */ }
    else e.nullCodeHrs += Number(a.hrs) || 0 // code null / no condition → surfaced, never dropped
    perRig.set(rigId, e)
  }

  const ordered = (rigsRes.data || [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(String(b.name)))

  const rows = ordered
    .filter((rig) => daysByRig.has(rig.id)) // only rigs that filed a DDR in the range
    .map((rig) => {
      const e = perRig.get(rig.id) || { RODR: 0, NODR: 0, EBDR: 0, nullCodeHrs: 0 }
      return {
        rig: rig.name,
        days: daysByRig.get(rig.id).size,
        hours: { RODR: e.RODR, NODR: e.NODR, EBDR: e.EBDR },
        nullCodeHrs: e.nullCodeHrs,
      }
    })
  return { rigs: rows, hasData: rows.length > 0, from, to }
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

// ---------------------------------------------------------------------------
// Analytics tab (SINGLE-RIG) loaders. These are deliberately separate from the
// Fleet loaders above — loadRigTimeDistribution (Fleet, all rigs, range-cumulative)
// is left untouched; the ones below are scoped to ONE rig and are PER DAY.
// ---------------------------------------------------------------------------

// RIG TIME DISTRIBUTION per DAY for ONE rig over [from, to] inclusive. For each of
// the rig's DDR report_dates, sums activities.hrs grouped by code_master.condition:
// RODR / NODR / EBDR. MDR (rig-move) is EXCLUDED; activity hours whose code has no
// condition (unmapped bare code) are surfaced as nullCodeHrs so a day's bar is never
// silently short. A reporting day with zero hours still appears (empty bar).
export async function loadRigTimeDistributionDaily(rigId, from, to) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId || !from || !to) return { days: [], hasData: false, from, to }

  const [codesRes, repRes] = await Promise.all([
    supabase.from('code_master').select('code, condition'),
    supabase.from('reports').select('id, report_date')
      .eq('rig_id', rigId).gte('report_date', from).lte('report_date', to),
  ])
  for (const r of [codesRes, repRes]) if (r.error) throw new Error(r.error.message)

  const condByCode = new Map((codesRes.data || []).map((c) => [c.code, c.condition]))
  const reports = repRes.data || []
  const dateByReport = new Map(reports.map((r) => [r.id, r.report_date]))

  const byDate = new Map()
  const ensure = (d) => {
    if (!byDate.has(d)) byDate.set(d, { date: d, RODR: 0, NODR: 0, EBDR: 0, nullCodeHrs: 0 })
    return byDate.get(d)
  }
  // Seed every reporting day so a day with no classifiable hours still shows.
  for (const r of reports) ensure(r.report_date)

  const acts = await fetchActivities(reports.map((r) => r.id))
  for (const a of acts) {
    const d = dateByReport.get(a.report_id)
    if (!d) continue
    const e = ensure(d)
    const cond = condByCode.get(a.code)
    if (cond === 'RODR' || cond === 'NODR' || cond === 'EBDR') e[cond] += Number(a.hrs) || 0
    else if (cond === 'MDR') { /* rig-move — excluded from the RODR/NODR/EBDR distribution */ }
    else e.nullCodeHrs += Number(a.hrs) || 0 // code null / no condition → surfaced, never dropped
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { days, hasData: days.length > 0, from, to }
}

// Daily diesel/HSD consumption for ONE rig over [from, to]. Returns a per-day trend
// (KL from reports.fuel_consumed_kl), the average daily burn (KL/day over the days
// that reported fuel), and the average rate (L/hr = total fuel / total logged
// activity hours). Shapes match FuelConsumptionPanel's props so that panel is reused
// as-is. Missing fuel figures stay absent (no invented zeros).
export async function loadRigFuelDaily(rigId, from, to) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId || !from || !to) return { avgDailyKl: null, avgLhr: null, trend: [], hasData: false }

  const { data, error } = await supabase
    .from('reports').select('id, report_date, fuel_consumed_kl')
    .eq('rig_id', rigId).gte('report_date', from).lte('report_date', to)
  if (error) throw new Error(error.message)
  const reports = data || []

  const acts = await fetchActivities(reports.map((r) => r.id))
  let fuelHours = 0
  for (const a of acts) fuelHours += Number(a.hrs) || 0

  const fuelByDate = new Map()
  let totalFuel = 0
  let fuelSeen = false
  for (const r of reports) {
    if (r.fuel_consumed_kl != null) {
      const kl = Number(r.fuel_consumed_kl) || 0
      totalFuel += kl
      fuelSeen = true
      fuelByDate.set(r.report_date, (fuelByDate.get(r.report_date) || 0) + kl)
    }
  }
  const trend = [...fuelByDate.entries()].map(([date, kl]) => ({ date, kl })).sort((a, b) => a.date.localeCompare(b.date))
  const avgDailyKl = fuelSeen && fuelByDate.size > 0 ? totalFuel / fuelByDate.size : null
  const avgLhr = fuelSeen && fuelHours > 0 ? (totalFuel * 1000) / fuelHours : null
  return { avgDailyKl, avgLhr, trend, hasData: trend.length > 0 }
}

// Well & Location from the rig's LATEST DDR within [from, to] (max report_date).
// Returns the as-reported well, days on location, days on well, present operation,
// OIM and POB. hasReport=false when the rig filed no DDR in the window (honest empty
// state — never an invented value).
export async function loadRigWellLocation(rigId, from, to) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId || !from || !to) return { hasReport: false }

  const { data, error } = await supabase
    .from('reports')
    .select('report_date, well_no, days_on_location, days_on_well, present_operation, oim, pob_total')
    .eq('rig_id', rigId).gte('report_date', from).lte('report_date', to)
    .order('report_date', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const r = (data || [])[0]
  if (!r) return { hasReport: false }
  return {
    hasReport: true,
    date: r.report_date,
    well: r.well_no ?? null,
    daysOnLocation: r.days_on_location ?? null,
    daysOnWell: r.days_on_well ?? null,
    presentOperation: r.present_operation ?? null,
    oim: r.oim ?? null,
    pob: r.pob_total ?? null,
  }
}

// PORTABLE (potable) WATER made vs consumed per DAY for ONE rig over [from, to].
// The DDR extractor writes potable water into the `inventory` table under the item
// label "P/Water" (most rigs) or "POTWATER" (Jindal Explorer) — NOT "D/Water", which
// is drill water and is deliberately excluded. made = inventory.generated,
// consumed = inventory.consumed (verified by opening+received+made−consumed=closing).
// inventory has no rig/date of its own, so we map via the rig's reports in range.
// A day with no potable-water row is simply absent (no invented zeros). If a rig
// somehow logs more than one potable row for a date, they are summed.
export async function loadRigWaterDaily(rigId, from, to) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId || !from || !to) return { days: [], hasData: false, unit: null, from, to }

  const { data: reps, error: repErr } = await supabase
    .from('reports').select('id, report_date')
    .eq('rig_id', rigId).gte('report_date', from).lte('report_date', to)
  if (repErr) throw new Error(repErr.message)
  const reports = reps || []
  const dateByReport = new Map(reports.map((r) => [r.id, r.report_date]))
  if (reports.length === 0) return { days: [], hasData: false, unit: null, from, to }

  // Potable water only: P/Water or POTWATER (+ tolerant variants). Excludes D/Water.
  const { data: inv, error: invErr } = await supabase
    .from('inventory')
    .select('report_id, item, unit, generated, consumed')
    .in('report_id', reports.map((r) => r.id))
    .or('item.ilike."%p/water%",item.ilike."%potwater%",item.ilike."%potable%",item.ilike."%p water%"')
  if (invErr) throw new Error(invErr.message)

  const byDate = new Map()
  let unit = null
  for (const row of inv || []) {
    const d = dateByReport.get(row.report_id)
    if (!d) continue
    if (!byDate.has(d)) byDate.set(d, { date: d, made: 0, consumed: 0 })
    const e = byDate.get(d)
    e.made += Number(row.generated) || 0
    e.consumed += Number(row.consumed) || 0
    if (!unit && row.unit) unit = row.unit
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { days, hasData: days.length > 0, unit, from, to }
}

// ---------------------------------------------------------------------------
// DEPTH vs DAYS (single well) — the rig's CURRENT well (latest report's well_no).
// Three layers: (1) depth curve [reliable], (2) NPT markers [reliable],
// (3) casing-set points [BEST-EFFORT / heuristic — see parsers below]. No plan,
// no drilling-window guard (that was the Planned-vs-Actual feature).
// ---------------------------------------------------------------------------

// Unicode vulgar-fraction → decimal, for casing sizes like 13 ⅜" / 9 ⅝".
const UNICODE_FRAC = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅓': 1 / 3, '⅔': 2 / 3 }

// Parse a casing SIZE from a remark. Handles unicode fractions ("13 ⅜\""), ascii
// fractions ("13 3/8", "9-5/8", "11 3/4") and whole inches ("20\"", "30\" conductor").
// The size MUST be followed (within a quote + up to 2 spaces) by a casing keyword
// (CSG/CASING/LINER/CONDUCTOR) — this ties the number to a casing string and REJECTS
// same-remark BOP/bit sizes (e.g. "21 ¼\" BOP", "8 ½\" SLICK"), which were false
// positives. Trade-off: it UNDER-detects a size separated from its keyword by a long
// parenthetical (e.g. `9-5/8" (L-80, 47PPF) CSG`). Returns { label, inches } or null.
// HEURISTIC: best-effort / medium reliability — remark wording varies between rigs.
const CASING_TAIL = '\\s*["”]?\\s{0,2}(?:csg|casing|liner|conductor|cond)\\b'
function parseCasingSize(remark) {
  const s = String(remark || '')
  // whole + unicode fraction, e.g. "13 ⅜\" CSG", "11 ¾\" LINER"
  let m = s.match(new RegExp(`(\\d{1,2})\\s*([¼½¾⅛⅜⅝⅞⅓⅔])${CASING_TAIL}`, 'i'))
  if (m) return { label: `${m[1]}-${fracToAscii(m[2])}"`, inches: Number(m[1]) + (UNICODE_FRAC[m[2]] || 0) }
  // whole + ascii fraction, e.g. "13 3/8 CSG", "9-5/8\" CSG"
  m = s.match(new RegExp(`(\\d{1,2})\\s*[-\\s]\\s*(\\d)\\/(\\d)${CASING_TAIL}`, 'i'))
  if (m) return { label: `${m[1]}-${m[2]}/${m[3]}"`, inches: Number(m[1]) + Number(m[2]) / Number(m[3]) }
  // whole inches, e.g. "20\" CSG", "30\" CONDUCTOR"
  m = s.match(new RegExp(`(\\d{1,2})${CASING_TAIL}`, 'i'))
  if (m) return { label: `${m[1]}"`, inches: Number(m[1]) }
  return null
}
function fracToAscii(u) {
  return { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8', '⅓': '1/3', '⅔': '2/3' }[u] || ''
}

// Parse a shoe/landing depth in metres from a remark, ONLY when the number is tied to
// the word "shoe": "SHOE @ 2333M", "L/SHOE @2333M", "CSG SHOE AT 2079M". A bare "@<n>m"
// is deliberately NOT trusted — it also matches cement-top / spacer depths ("CMT TOP
// @1321M"), which are not the shoe. When this returns null the caller falls back to the
// day's depth and flags the point approximate (dashed). HEURISTIC / conservative.
function parseShoeDepth(remark) {
  const s = String(remark || '')
  const m = s.match(/shoe[^0-9]{0,14}?(\d{2,5}(?:\.\d+)?)\s*m\b/i)
  return m ? Number(m[1]) : null
}

export async function loadRigDepthSeries(rigId) {
  const EMPTY = { wellName: null, hasReports: false, depthRows: [], hasDepth: false, npt: [], casing: [], nptCodes: [] }
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!rigId) return EMPTY

  // Current well = the well_no of the rig's most-recent report.
  const { data: latest, error: latestErr } = await supabase
    .from('reports').select('well_no').eq('rig_id', rigId)
    .order('report_date', { ascending: false }).limit(1)
  if (latestErr) throw new Error(latestErr.message)
  const wellName = latest?.[0]?.well_no || null
  if (!wellName) return EMPTY

  const { data: reps, error: repErr } = await supabase
    .from('reports').select('id, report_date, well_no, depth_md_m, days_on_well')
    .eq('rig_id', rigId).eq('well_no', wellName)
  if (repErr) throw new Error(repErr.message)
  const allReps = (reps || []).filter((r) => r.days_on_well != null)
  if (allReps.length === 0) return { ...EMPTY, wellName, hasReports: true }

  // Dedupe by days_on_well → keep the LATEST report for that day (by report_date, then id).
  const byDay = new Map()
  for (const r of allReps) {
    const day = Number(r.days_on_well)
    const prev = byDay.get(day)
    if (!prev || String(r.report_date) > String(prev.report_date) || (r.report_date === prev.report_date && r.id > prev.id)) {
      byDay.set(day, r)
    }
  }
  const dayReports = [...byDay.values()].sort((a, b) => Number(a.days_on_well) - Number(b.days_on_well))
  const repById = new Map(allReps.map((r) => [r.id, r]))

  // (1) DEPTH ROWS — every day (null depth preserved so the chart can gap the line).
  const depthRows = dayReports.map((r) => ({
    day: Number(r.days_on_well),
    depth: r.depth_md_m == null ? null : Number(r.depth_md_m),
    date: r.report_date,
  }))
  const hasDepth = depthRows.some((d) => d.depth != null)

  // depth for a given report_id's day (for placing NPT/casing on the curve).
  const depthForReport = (rid) => {
    const r = repById.get(rid)
    return r && r.depth_md_m != null ? Number(r.depth_md_m) : null
  }
  const dayForReport = (rid) => {
    const r = repById.get(rid)
    return r ? Number(r.days_on_well) : null
  }

  // Load code_master conditions + all activities for this well's reports.
  const [codesRes] = await Promise.all([supabase.from('code_master').select('code, condition, description')])
  if (codesRes.error) throw new Error(codesRes.error.message)
  const codeInfo = new Map((codesRes.data || []).map((c) => [c.code, { condition: c.condition, description: c.description }]))

  const reportIds = allReps.map((r) => r.id)
  const acts = await fetchCasingActivities(reportIds)

  // (2) NPT MARKERS — NODR + EBDR, hrs>0. Depth = that day's depth_md_m; markers on a
  // null-depth day are SKIPPED (consistent with the gapped curve — no invented Y).
  const npt = []
  const nptCodeSet = new Map()
  for (const a of acts) {
    const info = codeInfo.get(a.code)
    if (!info || (info.condition !== 'NODR' && info.condition !== 'EBDR')) continue
    if ((Number(a.hrs) || 0) <= 0) continue
    nptCodeSet.set(a.code, { code: a.code, condition: info.condition, description: info.description })
    const depth = depthForReport(a.report_id)
    const day = dayForReport(a.report_id)
    if (depth == null || day == null) continue // skip null-depth days
    npt.push({ day, depth, hrs: Number(a.hrs) || 0, code: a.code, condition: info.condition, description: info.description, remark: a.remarks || '' })
  }
  npt.sort((a, b) => a.day - b.day)
  const nptCodes = [...nptCodeSet.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)))

  // (3) CASING-SET POINTS — BEST-EFFORT / HEURISTIC (medium reliability). From 12A/12B/
  // 12C activities whose remark names a casing size, collapse the many rows per string to
  // ONE event per size: prefer a row that names a shoe depth, else a 12B (cementing) row,
  // else the latest row. Y = parsed shoe depth; if none, fall back to the day's depth and
  // flag the point approximate so it reads honestly.
  const bySize = new Map()
  for (const a of acts) {
    const isCasingCode = /^12/.test(String(a.code || '')) || String(a.raw_code) === '12'
    if (!isCasingCode) continue
    if (!/csg|casing|liner|conductor/i.test(String(a.remarks || ''))) continue
    const size = parseCasingSize(a.remarks)
    if (!size) continue
    const day = dayForReport(a.report_id)
    if (day == null) continue
    const shoe = parseShoeDepth(a.remarks)
    const is12B = /^12B/.test(String(a.code || ''))
    const cand = { size, day, shoe, is12B, remark: a.remarks || '', code: a.code }
    const key = size.inches.toFixed(3)
    if (!bySize.has(key)) bySize.set(key, [])
    bySize.get(key).push(cand)
  }
  const casing = []
  for (const [, cands] of bySize) {
    // priority: names a shoe depth > is a 12B cementing row > anything; tie-break latest day
    const score = (c) => (c.shoe != null ? 2 : 0) + (c.is12B ? 1 : 0)
    cands.sort((a, b) => score(b) - score(a) || b.day - a.day)
    const chosen = cands[0]
    const dayDepth = (() => {
      const row = dayReports.find((d) => d.day === chosen.day)
      return row ? row.depth : null
    })()
    const shoe = chosen.shoe
    const depth = shoe != null ? shoe : dayDepth
    if (depth == null) continue // can't place it at all → drop (honest)
    casing.push({
      size: chosen.size.label,
      inches: chosen.size.inches,
      day: chosen.day,
      depth,
      approx: shoe == null, // fell back to the day's depth — not the real shoe depth
      remark: chosen.remark,
    })
  }
  casing.sort((a, b) => a.day - b.day || b.inches - a.inches)

  return { wellName, hasReports: true, depthRows, hasDepth, npt, casing, nptCodes }
}

// Paginated activities fetch for a set of reports (incl. raw_code + remarks).
async function fetchCasingActivities(reportIds) {
  if (!reportIds.length) return []
  const PAGE = 1000
  const all = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('activities')
      .select('report_id, code, raw_code, hrs, remarks')
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
