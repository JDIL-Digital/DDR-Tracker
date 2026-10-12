// Fleet tab — REDESIGN reading from the stored DDR data. Section A only:
// a date picker (populated from the real DDR report_dates) + five fleet-total
// KPI cards for the selected date. Per-rig cards (B), downtime chart (C), and
// NPT-by-cause (D) are built in later sections.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadDdrDates, loadFleetTotals, loadRigCards, loadRigTimeDistribution, loadNptByCause, loadRigReportByName, loadRigDayActivities } from './ddrFleet'
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
  const [cards, setCards] = useState(null)    // per-rig data for the date (drives the header strip)
  const [rig, setRig] = useState('')           // selected rig for the single-rig header strip
  const [stripSlot, setStripSlot] = useState(null) // top-bar portal target for the A strip
  const [detail, setDetail] = useState(null)   // selected rig's report + extra (drives KPI tiles)
  const [dayLog, setDayLog] = useState(null)   // selected rig's activity log (drives Zone E)
  const [npt, setNpt] = useState(null)         // NPT-by-cause per rig for the date
  // Section C — rig time distribution has its OWN date range (independent of the
  // tab's single-date picker, which still drives KPIs/cards/NPT). Default: last 7 days.
  const [distFrom, setDistFrom] = useState(shiftDate(todayISO(), -7))
  const [distTo, setDistTo] = useState(todayISO())
  const [dist, setDist] = useState(null)       // rig time distribution over [distFrom, distTo]
  const [distLoading, setDistLoading] = useState(false)
  const [err, setErr] = useState(null)
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
    setErr(null); setCards(null); setNpt(null)
    Promise.all([loadFleetTotals(date), loadRigCards(date), loadNptByCause(date)])
      .then(([t, c, n]) => { if (!cancelled) { setTotals(t); setCards(c); setNpt(n) } })
      .catch((e) => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [date])

  // Resolve the top-bar slot after mount (the TopBar DOM is committed by then), so the
  // A strip can be portaled up beside the search bar instead of sitting in the body.
  useEffect(() => { setStripSlot(document.getElementById('topbar-slot')) }, [])

  // Default the rig selection to the first rig (sort_order) once cards load; keep the
  // current rig if it still exists in the new date's card set.
  useEffect(() => {
    if (!cards || cards.length === 0) return
    setRig((cur) => (cur && cards.some((c) => c.rig === cur) ? cur : cards[0].rig))
  }, [cards])

  // Load the selected rig's report + extra (depth / casing / pob_split / bop) for the KPI
  // tiles whenever the rig or date changes.
  useEffect(() => {
    if (!rig || !date) { setDetail(null); return }
    let cancelled = false
    setDetail(null)
    setDayLog(null)
    Promise.all([loadRigReportByName(rig, date), loadRigDayActivities(rig, date)])
      .then(([d, log]) => { if (!cancelled) { setDetail(d); setDayLog(log) } })
      .catch((e) => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [rig, date])

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
      {/* Toolbar: rig dropdown + DDR date picker (real report dates) */}
      <div className="maint-toolbar">
        <label className="maint-pick">
          <span>Rig</span>
          <select value={rig} onChange={(e) => setRig(e.target.value)} disabled={!cards || cards.length === 0}>
            {(!cards || cards.length === 0) && <option value="">—</option>}
            {(cards || []).map((c) => <option key={c.rig} value={c.rig}>{c.rig}</option>)}
          </select>
        </label>
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

      {/* Top cards — one unified 4×2 grid: five fleet-total KPIs (row 1 + first of row 2)
          followed by the three single-rig tiles (rest of row 2). Equal width/height. */}
      <div className="fleet-top-grid">
        {KPIS.map((kpi) => (
          <div key={kpi.key} className={`kpi ${kpi.cls}`}>
            <div className="kpi-num">{values ? values[kpi.key] : '…'}</div>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-sub">{kpi.sub}</div>
          </div>
        ))}
        <FleetKpiTiles detail={detail} />
      </div>

      {/* Section A header strip — portaled UP into the top bar beside the search bar.
          Single selected rig: WELL · REPORT NO · POB · LTI. Dark accent bar. Honest
          empty state when the selected rig filed no DDR for the date. */}
      {cards && stripSlot && createPortal(
        <RigHeaderStrip card={cards.find((c) => c.rig === rig) || null} rig={rig} date={date} />,
        stripSlot,
      )}

      {/* Zone E — 24-hour time distribution & IADC codes for the selected rig + date. */}
      <FleetDayTimeline rig={rig} date={date} data={dayLog} />

      {/* Rig Time Distribution chart (all rigs, own date range) + Zone F ops-sequence
          table (selected rig+date) side by side; stacks on narrow screens. */}
      <div className="fleet-split">
        <RigTimeDistribution
          data={dist}
          from={distFrom}
          to={distTo}
          onFrom={setDistFrom}
          onTo={setDistTo}
          loading={distLoading}
        />
        <FleetOpsSequence rig={rig} date={date} data={dayLog} reportNo={detail?.report_no} />
      </div>

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

// Section A header strip — a single dark horizontal bar for the SELECTED rig, mono /
// uppercase, fields separated by " · ": WELL · REPORT NO · POB · LTI (green). Honest
// empty state when the rig has no DDR for the selected date.
function RigHeaderStrip({ card, rig, date }) {
  const dash = (v) => (v == null || v === '' ? DASH : v)
  if (!card || !card.hasReport) {
    return (
      <div className="fleet-strip">
        <span className="fleet-strip-empty">NO REPORT FOR {String(rig || 'RIG').toUpperCase()} ON {prettyDate(date)}</span>
      </div>
    )
  }
  const lti = card.ltiDays != null ? Number(card.ltiDays).toLocaleString('en-US') : DASH
  return (
    <div className="fleet-strip">
      <span className="fs-item">WELL <b>{dash(card.well)}</b></span>
      <span className="fs-sep">·</span>
      <span className="fs-item">REPORT NO <b>{dash(card.reportNo)}</b></span>
      <span className="fs-sep">·</span>
      <span className="fs-item">POB: <b>{dash(card.pob)}</b></span>
      <span className="fs-sep">·</span>
      <span className="fs-item">LTI: <b className="fs-lti">{lti}</b> DAYS</span>
    </div>
  )
}

// Subtle muted placeholder for a genuinely-absent value — never a fabricated number.
const NR = <span className="fkpi-nr">— not reported</span>
const has = (v) => v != null && String(v).trim() !== ''
// Pick the current casing shoe (deepest set casing) + the liner string, from extra.casing[].
function casingPoints(extra) {
  const rows = Array.isArray(extra?.casing) ? extra.casing : []
  const md = (c) => (has(c.setting_md) && !Number.isNaN(Number(c.setting_md)) ? Number(c.setting_md) : null)
  const set = rows.filter((c) => md(c) != null)
  const shoe = set.length ? set.reduce((a, b) => (md(b) > md(a) ? b : a)) : null
  const liner = set.find((c) => /liner/i.test(String(c.section || '')))
  const label = (c) => (c ? `${has(c.od) ? `${c.od} · ` : ''}${Math.round(md(c))} m` : null)
  return { shoe: label(shoe), liner: label(liner) }
}

// Zone C — the three single-rig tiles (BIT-MD/DEPTH, POB, HSE/BOP). Returned as a
// FRAGMENT so they sit as direct children of the shared 4×2 top grid alongside the KPI
// cards. Null-safe: when the rig has no report (detail null / hasReport false) the fields
// are absent and render the subtle "— not reported" placeholder (never a fake number).
function FleetKpiTiles({ detail }) {
  const ex = detail?.extra || {}
  const pob = ex.pob_split || {}
  const bop = ex.bop || {}
  const { shoe, liner } = casingPoints(ex)
  const mini = (v) => (v == null ? NR : <b>{v}</b>) // pob_split: 0 is valid, null = absent

  return (
    <>
      {/* TILE 1 — BIT-MD // DEPTH */}
      <div className="fkpi">
        <div className="fkpi-label">BIT-MD // DEPTH</div>
        <div className="fkpi-num">{has(detail?.depth_md_m) ? <>{fmt1(detail.depth_md_m)}<span className="fkpi-unit"> m MD</span></> : NR}</div>
        <div className="fkpi-line">TVD: {NR} · INC: {NR}</div>
        <div className="fkpi-line">CSG SHOE: {shoe ? <b>{shoe}</b> : NR} · LINER: {liner ? <b>{liner}</b> : NR}</div>
      </div>

      {/* TILE 2 — RIG COMPLEMENT // POB */}
      <div className="fkpi">
        <div className="fkpi-label">RIG COMPLEMENT // POB</div>
        <div className="fkpi-num">{has(detail?.pob_total) ? <>{detail.pob_total}<span className="fkpi-unit"> SOULS</span></> : NR}</div>
        <div className="fkpi-line">LIFEBOATS {NR}</div>
        <div className="fkpi-mini">
          <span>ONGC {mini(pob.ongc)}</span>
          <span>SRVCS {mini(pob.ongc_services)}</span>
          <span>JDIL {mini(pob.jdil)}</span>
          <span>CATR {mini(pob.catering)}</span>
        </div>
      </div>

      {/* TILE 3 — HSE INTEGRITY // BOP */}
      <div className="fkpi">
        <div className="fkpi-label">HSE INTEGRITY // BOP</div>
        <div className="fkpi-num green">{has(detail?.lti_days) ? <>{Number(detail.lti_days).toLocaleString('en-US')}<span className="fkpi-unit"> LTI FREE</span></> : NR}</div>
        <div className="fkpi-line">LAST FN TEST: {has(bop.function_test_date) ? <b>{bop.function_test_date}</b> : NR}</div>
        <div className="fkpi-mini">
          <span>ACCUM: {has(bop.accumulator_psi) ? <b>{bop.accumulator_psi}</b> : NR}</span>
          <span>MANIF: {has(bop.manifold_psi) ? <b>{bop.manifold_psi}</b> : NR}</span>
        </div>
      </div>
    </>
  )
}

// Zone E — 24-hour time distribution & IADC operation codes for the selected rig + date.
// Distinct per-code colors (stable within the day), a legend sorted by hours, and a single
// 00:00→24:00 timeline of proportional activity segments. All from the activities log.
// Color the timeline by IADC condition — the SAME semantic scheme the F table + Analytics
// trends use (via the --green/--amber/--red/--blue/--dim theme tokens), so a breakdown code
// (EBDR) always reads RED, never a rank-based color. operating=green · non-operating=amber ·
// equipment breakdown/NPT=red · rig move=blue · unmapped/null=grey.
const COND_COLOR = { RODR: 'var(--green)', NODR: 'var(--amber)', EBDR: 'var(--red)', MDR: 'var(--blue)' }
const colorForCond = (cond) => COND_COLOR[cond] || 'var(--dim)'
const toMin = (t) => {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const mins = (+m[1]) * 60 + (+m[2])
  return mins > 1440 ? 1440 : mins
}
const pad2 = (n) => String(n).padStart(2, '0')
const shortOp = (a) => {
  const r = String(a.remarks || '').replace(/^(HELD\s+PJSM|HPJSM|CONT'?D?\.?|CONTD\.?)[,.\s]*/i, '').trim()
  const words = r.split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  return words || a.code || '—'
}

function FleetDayTimeline({ rig, date, data }) {
  if (!rig) return null
  const title = '24-HOUR TIME DISTRIBUTION & IADC OPERATION CODES'
  if (data === null) {
    return <div className="fday"><div className="fday-h">{title}</div><div className="fday-msg">// LOADING…</div></div>
  }
  if (!data.hasActivities) {
    return <div className="fday"><div className="fday-h">{title}</div><div className="fday-msg">NO ACTIVITY LOG FOR {String(rig).toUpperCase()} ON {prettyDate(date)}</div></div>
  }

  const acts = data.activities
  const total = data.total || acts.reduce((s, a) => s + (a.hrs || 0), 0)
  // Group by code for the legend; each code carries its IADC condition (drives color).
  const byCode = new Map()
  for (const a of acts) {
    const k = a.code ?? '(unmapped)'
    const e = byCode.get(k) || { code: a.code, description: a.description, condition: a.condition ?? null, hrs: 0 }
    e.hrs += a.hrs || 0
    byCode.set(k, e)
  }
  const legend = [...byCode.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.hrs - a.hrs)

  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24]

  return (
    <div className="fday">
      <div className="fday-h">{title}</div>
      <div className="fday-sub">{prettyDate(date)} · {fmt1(total)} h logged{Math.abs(total - 24) > 0.5 ? ' (not 24 h — bar scaled to the real clock)' : ''}</div>

      {/* 1. CODE LEGEND */}
      <div className="fday-legend">
        {legend.map((l) => (
          <span className="fday-leg" key={l.key}>
            <i className="fday-dot" style={{ background: colorForCond(l.condition) }} />
            Code {l.code ?? '—'}: {l.description || '(unmapped)'} ({fmt1(l.hrs)} Hrs / {total > 0 ? Math.round((l.hrs / total) * 100) : 0}%)
          </span>
        ))}
      </div>

      {/* 2. 24-HOUR TIMELINE BAR (00:00 → 24:00, fixed axis) */}
      <div className="fday-track">
        {acts.map((a, i) => {
          const start = toMin(a.time_from)
          const dur = (a.hrs || 0) * 60
          if (start == null || dur <= 0) return null
          const left = Math.max(0, Math.min(100, (start / 1440) * 100))
          const width = Math.max(0.3, Math.min(100 - left, (dur / 1440) * 100))
          const sH = Math.floor(start / 60)
          const eH = Math.round((start + dur) / 60)
          const wide = width > 8
          return (
            <div
              key={i} className="fday-seg"
              style={{ left: `${left}%`, width: `${width}%`, background: colorForCond(a.condition) }}
              title={`${pad2(sH)}:${pad2(start % 60)}–${pad2(eH)}:00 · [${a.code ?? '—'}] ${a.remarks || a.description || ''} · ${fmt1(a.hrs)} h`}
            >
              {wide && <span className="fday-seg-lbl">{pad2(sH)}-{pad2(eH)} {shortOp(a)}</span>}
            </div>
          )
        })}
      </div>
      <div className="fday-axis">
        {ticks.map((h) => (
          <span className="fday-tick" key={h} style={{ left: `${(h / 24) * 100}%` }}>{pad2(h)}:00</span>
        ))}
      </div>
    </div>
  )
}

// Map code_master.condition → a derived status badge (used until an AI-written per-activity
// status is stored at extraction time; the table reads a.status first and falls back here).
const STATUS_BY_COND = {
  RODR: { label: 'OPERATING', cls: 'st-op' },
  NODR: { label: 'NON-OP', cls: 'st-nonop' },
  EBDR: { label: 'BREAKDOWN', cls: 'st-bd' },
  MDR: { label: 'MOVE', cls: 'st-move' },
}

// Zone F — 24-hour chronological operations sequence (the parsed DDR, NOT a live feed).
// One row per activity for the selected rig + date, ordered by time_from.
function FleetOpsSequence({ rig, date, data, reportNo }) {
  if (!rig) return null
  const title = '24-HOUR CHRONOLOGICAL OPERATIONS SEQUENCE'
  const sub = `DAILY DRILLING REPORT · DDR #${has(reportNo) ? reportNo : '—'}`
  if (data === null) {
    return <div className="fseq"><div className="fseq-h">{title}</div><div className="fseq-sub">{sub}</div><div className="fseq-msg">// LOADING…</div></div>
  }
  if (!data.hasActivities) {
    return <div className="fseq"><div className="fseq-h">{title}</div><div className="fseq-sub">{sub}</div><div className="fseq-msg">NO ACTIVITY LOG FOR {String(rig).toUpperCase()} ON {prettyDate(date)}</div></div>
  }
  const rows = data.activities
  const condCls = (c) => (c ? `cond-${c}` : 'cond-none')
  return (
    <div className="fseq">
      <div className="fseq-h">{title}</div>
      <div className="fseq-sub">{sub}</div>
      <div className="fseq-scroll">
        <table className="fseq-table">
          <thead>
            <tr>
              <th>Time Slot</th>
              <th className="num">Dur (hrs)</th>
              <th>Code</th>
              <th>Operational Activity &amp; Well Dynamics</th>
              <th>Status (auto)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, i) => {
              // Easy future swap: prefer a stored per-activity status; else derive from condition.
              const st = has(a.status)
                ? { label: String(a.status).toUpperCase(), cls: 'st-ai' }
                : (STATUS_BY_COND[a.condition] || { label: '—', cls: 'st-none' })
              return (
                <tr key={i}>
                  <td className="fseq-time mono">{a.time_from || '—'} – {a.time_to || '—'}</td>
                  <td className="num mono">{fmt1(a.hrs)}</td>
                  <td><span className={`fseq-code ${condCls(a.condition)}`}>CODE {a.code ?? '—'}</span></td>
                  <td className="fseq-act">{a.remarks || <span className="fkpi-nr">— not reported</span>}</td>
                  <td><span className={`fseq-status ${st.cls}`}>{st.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
