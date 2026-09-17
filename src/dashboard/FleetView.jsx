// Fleet tab — REDESIGN reading from the stored DDR data. Section A only:
// a date picker (populated from the real DDR report_dates) + five fleet-total
// KPI cards for the selected date. Per-rig cards (B), downtime chart (C), and
// NPT-by-cause (D) are built in later sections.
import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadDdrDates, loadFleetTotals, loadRigCards, loadRigTimeDistribution, loadNptByCause } from './ddrFleet'
import { fmt1, prettyDate, todayISO, shiftDate, DASH } from './format'
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
  const [npt, setNpt] = useState(null)         // NPT-by-cause per rig for the date
  // Section C — rig time distribution has its OWN date range (independent of the
  // tab's single-date picker, which still drives KPIs/cards/NPT). Default: last 7 days.
  const [distFrom, setDistFrom] = useState(shiftDate(todayISO(), -7))
  const [distTo, setDistTo] = useState(todayISO())
  const [dist, setDist] = useState(null)       // rig time distribution over [distFrom, distTo]
  const [distLoading, setDistLoading] = useState(false)
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
    setLoadingTotals(true); setErr(null); setCards(null); setNpt(null)
    Promise.all([loadFleetTotals(date), loadRigCards(date), loadNptByCause(date)])
      .then(([t, c, n]) => { if (!cancelled) { setTotals(t); setCards(c); setNpt(n) } })
      .catch((e) => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setLoadingTotals(false) })
    return () => { cancelled = true }
  }, [date])

  // Section C loads INDEPENDENTLY on its own From/To range (not the tab's date).
  useEffect(() => {
    if (!distFrom || !distTo) return
    let cancelled = false
    setDistLoading(true)
    loadRigTimeDistribution(distFrom, distTo)
      .then((d) => { if (!cancelled) setDist(d) })
      .catch((e) => { if (!cancelled) setErr(e.message) })
      .finally(() => { if (!cancelled) setDistLoading(false) })
    return () => { cancelled = true }
  }, [distFrom, distTo, reloadKey])

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

      {/* Section C — rig time distribution (RODR/NODR/EBDR) over its own date range */}
      <RigTimeDistribution
        data={dist}
        from={distFrom}
        to={distTo}
        onFrom={setDistFrom}
        onTo={setDistTo}
        loading={distLoading}
      />

      {/* Section D — NPT by cause per rig (selected date) */}
      {npt && <NptByCauseD data={npt} date={date} />}
    </div>
  )
}

// NPT (non-productive time) by cause, per rig, for the selected date.
// NPT = NODR + EBDR; RODR excluded (productive); MDR excluded (rig-move) but noted.
function NptByCauseD({ data, date }) {
  const rows = data.rigs || []
  return (
    <div className="panel">
      <h3>NPT by cause — per rig</h3>
      <div className="psub">Non-productive time (NODR + EBDR) grouped by cause · {prettyDate(date)}</div>
      {!data.hasData ? (
        <div className="npt-empty">No rig filed a DDR for this date.</div>
      ) : (
        <div className="rig-grid">
          {rows.map((r) => (
            <div className="dept-card npt-card" key={r.rig}>
              <div className="dept-head">
                <span className="dept-name">{r.rig}</span>
                <span className="npt-total mono">{r.nptTotal > 0 ? `${fmt1(r.nptTotal)} h NPT` : '0 h'}</span>
              </div>
              <div className="npt-sub">OIM: <b>{r.oim || DASH}</b> · {prettyDate(r.date)}</div>
              {r.causes.length === 0 ? (
                <div className="npt-empty sm">No non-productive time.</div>
              ) : (
                <ul className="npt-causes">
                  {r.causes.map((c) => (
                    <li key={c.code ?? c.description}>
                      <span className={`cond-badge cond-${c.condition}`}>{c.condition}</span>
                      <span className="npt-cause-txt"><b>{c.code || '—'}</b> {c.description || ''}</span>
                      <span className="npt-cause-hrs mono">{fmt1(c.hrs)} h</span>
                    </li>
                  ))}
                </ul>
              )}
              {r.mdrHrs > 0 && <div className="npt-mdr">MDR (rig move, excluded from NPT): {fmt1(r.mdrHrs)} h</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const CONDS = [
  { key: 'RODR', label: 'RODR', color: 'var(--green)' },
  { key: 'NODR', label: 'NODR', color: 'var(--amber)' },
  { key: 'EBDR', label: 'EBDR', color: 'var(--red)' },
]
const shortRig = (name) => String(name).replace(/^Jindal\s+/i, '').replace(/-1$/, '')

// Grouped bar chart: per rig with a DDR in the range, three bars = cumulative
// RODR/NODR/EBDR hours over the selected From/To range (all wells, no reset).
// Own date-range controls (independent of the tab's single-date picker). A rig
// with unmapped-code hours in the range shows a small "pending code mapping" note
// so its total isn't silently short.
function RigTimeDistribution({ data, from, to, onFrom, onTo, loading }) {
  const rows = data?.rigs || []
  const max = Math.max(1, ...rows.flatMap((r) => [r.hours.RODR, r.hours.NODR, r.hours.EBDR]))
  return (
    <div className="panel">
      <div className="sec-h" style={{ margin: '0 0 4px' }}>
        <h3>Rig time distribution (RODR / NODR / EBDR) · {prettyDate(from)} → {prettyDate(to)}</h3>
        <div className="dt-legend">
          {CONDS.map((c) => <span key={c.key} className="dt-leg"><span className="dt-swatch" style={{ background: c.color }} />{c.label}</span>)}
        </div>
      </div>
      <div className="psub">Cumulative operating (RODR) / non-operating (NODR) / break-down (EBDR) hours per rig over the selected range · all wells</div>

      <div className="dt-range no-print">
        <label className="dt-field"><span>From</span><input type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)} /></label>
        <label className="dt-field"><span>To</span><input type="date" value={to} min={from} onChange={(e) => onTo(e.target.value)} /></label>
      </div>

      {loading ? (
        <div className="state">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="npt-empty">No rig filed a DDR in this range.</div>
      ) : (
        <div className="dt-chart">
          {rows.map((r) => (
            <div className="dt-group" key={r.rig}>
              <div className="dt-bars">
                {CONDS.map((c) => {
                  const v = r.hours[c.key] || 0
                  return (
                    <div className="dt-barwrap" key={c.key} title={`${r.rig} · ${c.label}: ${fmt1(v)} h`}>
                      <div className="dt-barval mono">{v > 0 ? fmt1(v) : ''}</div>
                      <div className="dt-bar" style={v > 0 ? { height: `${Math.max((v / max) * 100, 2)}%`, background: c.color } : { height: '2%', background: 'var(--barstub)' }} />
                    </div>
                  )
                })}
              </div>
              <div className="dt-label">{shortRig(r.rig)}</div>
              <div className="dt-well">{r.days} {r.days === 1 ? 'day' : 'days'}</div>
              {r.nullCodeHrs > 0 && (
                <div className="dt-nullnote" title="Activity hours whose code has no IADC condition (unmapped) — not counted in RODR/NODR/EBDR">
                  +{fmt1(r.nullCodeHrs)}h pending code mapping
                </div>
              )}
            </div>
          ))}
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
