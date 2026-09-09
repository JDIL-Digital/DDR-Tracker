// Fleet tab — REDESIGN reading from the stored DDR data. Section A only:
// a date picker (populated from the real DDR report_dates) + five fleet-total
// KPI cards for the selected date. Per-rig cards (B), downtime chart (C), and
// NPT-by-cause (D) are built in later sections.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadDdrDates, loadFleetTotals, loadRigCards } from './ddrFleet'
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
  const [cards, setCards] = useState(null)    // per-rig cards for the date
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

  // Load fleet totals + per-rig cards whenever the selected date changes.
  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoadingTotals(true); setErr(null); setCards(null)
    Promise.all([loadFleetTotals(date), loadRigCards(date)])
      .then(([t, c]) => { if (!cancelled) { setTotals(t); setCards(c) } })
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

      {/* Section B — one card per rig for the selected date */}
      {cards && (
        <div className="rig-grid">
          {cards.map((c) => <RigCardB key={c.rig} c={c} />)}
        </div>
      )}
    </div>
  )
}

// Per-rig card (Section B). Reporting rig shows the DDR fields; a rig with no DDR
// for the date shows an honest "no report" state. needs_review -> visible marker.
function RigCardB({ c }) {
  if (!c.hasReport) {
    return (
      <div className="dept-card rig-cardb rig-cardb-empty">
        <div className="dept-head"><span className="dept-name">{c.rig}</span></div>
        <div className="npt-empty sm">No report for this date.</div>
      </div>
    )
  }
  const val = (v, suffix = '') => (v == null ? DASH : `${v}${suffix}`)
  const num = (v, suffix = '') => (v == null ? DASH : `${fmt1(v)}${suffix}`)
  const downtime = c.downtimeDaily == null && c.downtimeCum == null
    ? DASH
    : `${c.downtimeDaily == null ? DASH : fmt1(c.downtimeDaily)} hrs${c.downtimeCum == null ? '' : ` · cum ${fmt1(c.downtimeCum)} hrs`}`
  const rows = [
    ['Report No', val(c.reportNo)],
    ['POB', val(c.pob)],
    ['Well', val(c.well)],
    ['Days Without LTI', val(c.ltiDays)],
    ['Daily Diesel Consumption', num(c.dailyDiesel, ' KL')],
    ['Monthly Rig Downtime', downtime],
  ]
  return (
    <div className={`dept-card rig-cardb${c.needsReview ? ' rig-cardb-review' : ''}`}>
      <div className="dept-head">
        <span className="dept-name">{c.rig}</span>
        {c.needsReview && <span className="review-badge" title="Extraction flagged for review (e.g. hours discrepancy)">⚠ review</span>}
      </div>
      <div className="rig-metrics">
        {rows.map(([label, v]) => (
          <div className="rig-metric" key={label}>
            <span className="rm-label">{label}</span>
            <span className="rm-val">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
