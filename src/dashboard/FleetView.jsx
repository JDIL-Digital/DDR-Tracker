// Fleet tab — REDESIGN reading from the stored DDR data. Section A only:
// a date picker (populated from the real DDR report_dates) + five fleet-total
// KPI cards for the selected date. Per-rig cards (B), downtime chart (C), and
// NPT-by-cause (D) are built in later sections.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadDdrDates, loadFleetTotals } from './ddrFleet'
import { fmt1, prettyDate, DASH } from './format'
import { LoadError } from './LoadState'

const KPIS = [
  { key: 'odr', label: 'Total ODR', cls: 'kpi-completed', sub: 'RODR hrs' },
  { key: 'nodr', label: 'Total NODR', cls: 'kpi-routine', sub: 'NODR hrs' },
  { key: 'ebdr', label: 'Total EBDR', cls: 'kpi-pending', sub: 'EBDR hrs (NPT)' },
  { key: 'diesel', label: 'Total Diesel ROB', cls: 'kpi-planned', sub: 'KL, rigs reporting' },
  { key: 'reports', label: 'Reports Received', cls: 'kpi-planned', sub: 'rigs with a DDR' },
]

export default function FleetView() {
  const [dates, setDates] = useState(null)   // available report_dates (desc) | null while loading
  const [date, setDate] = useState('')        // selected date
  const [totals, setTotals] = useState(null)  // fleet totals for the date
  const [err, setErr] = useState(null)
  const [loadingTotals, setLoadingTotals] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)

  // Load the available DDR dates once; default to the most recent.
  useEffect(() => {
    let cancelled = false
    setErr(null); setDates(null)
    loadDdrDates()
      .then((ds) => { if (cancelled) return; setDates(ds); setDate((d) => d || ds[0] || '') })
      .catch((e) => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [reloadKey])

  // Load fleet totals whenever the selected date changes.
  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoadingTotals(true); setErr(null)
    loadFleetTotals(date)
      .then((t) => { if (!cancelled) setTotals(t) })
      .catch((e) => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoadingTotals(false) })
    return () => { cancelled = true }
  }, [date])

  const values = useMemo(() => {
    if (!totals) return null
    return {
      odr: fmt1(totals.hours.RODR),
      nodr: fmt1(totals.hours.NODR),
      ebdr: fmt1(totals.hours.EBDR),
      diesel: totals.dieselRob == null ? DASH : fmt1(totals.dieselRob),
      reports: `${totals.reportsReceived} / ${totals.fleetSize}`,
    }
  }, [totals])

  if (!isSupabaseConfigured) {
    return <div className="wrap"><div className="state err">Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local and restart.</div></div>
  }
  if (err) return <div className="wrap"><LoadError message={err} onRetry={retry} /></div>
  if (dates === null) return <div className="wrap"><div className="state">Loading fleet…</div></div>
  if (dates.length === 0) {
    return <div className="wrap"><div className="npt-empty">No drilling reports yet. Fleet KPIs appear here once DDRs are ingested.</div></div>
  }

  return (
    <div className="wrap maint-dash">
      {/* Toolbar: DDR date picker (real report dates) */}
      <div className="maint-toolbar">
        <label className="maint-pick">
          <span>Report date</span>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => <option key={d} value={d}>{prettyDate(d)}</option>)}
          </select>
        </label>
        <div className="maint-header" style={{ margin: 0 }}>
          <div>
            <div className="maint-sub">
              <span className="spill s-approved">Fleet</span>
              <span className="maint-date">Drilling totals · {prettyDate(date)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section A — five fleet-total KPI cards for the selected date */}
      {loadingTotals || !values ? (
        <div className="state">Loading totals…</div>
      ) : (
        <div className="kpi-row">
          {KPIS.map((kpi) => (
            <div key={kpi.key} className={`kpi ${kpi.cls}`}>
              <div className="kpi-num">{values[kpi.key]}</div>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-sub">{kpi.sub}</div>
            </div>
          ))}
        </div>
      )}

      {totals && totals.reportsReceived === 0 && !loadingTotals && (
        <div className="panel"><div className="npt-empty">No rig filed a DDR for <b>{prettyDate(date)}</b>. Totals are zero for this date.</div></div>
      )}
    </div>
  )
}
