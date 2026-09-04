import { useCallback, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadRigsForPicker } from './settings'
import { loadMaintenanceReports, loadMaintenanceActivitiesForReports } from './maintenance'
import { matchKeywords } from './maintenanceKeywords'
import { prettyDate } from './format'
import { LoadError } from './LoadState'

// Department names vary in CASE across rigs — match case-insensitively, display original.
const DEPT_ORDER = ['barge', 'electrical', 'mechanical', 'hse']
const DEPT_ICON = { barge: '⚓', electrical: '⚡', mechanical: '⚙️', hse: '🦺', other: '🛠️' }
const lc = (d) => String(d || '').toLowerCase().trim()
const deptIcon = (d) => DEPT_ICON[lc(d)] || DEPT_ICON.other
const statusDot = (s) => (s === 'completed' ? 'dot-done' : s === 'pending' ? 'dot-pending' : 'dot-routine')

function orderDepts(names) {
  const head = DEPT_ORDER.map((o) => names.find((p) => lc(p) === o)).filter(Boolean)
  const extra = names.filter((p) => !DEPT_ORDER.includes(lc(p))).sort()
  return [...head, ...extra]
}
// Group a flat activity list by department, canonical order.
function groupByDept(list) {
  const g = new Map()
  for (const a of list) {
    const k = a.department || 'other'
    if (!g.has(k)) g.set(k, { department: k, chief: a.chief_in_charge, last: [], planned: [], critical: [], notable: [] })
    const grp = g.get(k)
    if (!grp.chief && a.chief_in_charge) grp.chief = a.chief_in_charge
    if (a.activity_kind === 'planned') grp.planned.push(a); else grp.last.push(a)
    if (a.tier === 'critical') grp.critical.push(a)
    else if (a.tier === 'notable') grp.notable.push(a)
  }
  return orderDepts([...g.keys()]).map((d) => g.get(d))
}

const KPI_DEFS = [
  { key: 'planned', label: 'Planned', cls: 'kpi-planned' },
  { key: 'completed', label: 'Completed', cls: 'kpi-completed' },
  { key: 'pending', label: 'Pending', cls: 'kpi-pending' },
  { key: 'routine', label: 'Routine', cls: 'kpi-routine' },
]
// Which activities belong to a KPI bucket.
const inBucket = (a, key) => (key === 'planned' ? a.activity_kind === 'planned' : a.activity_kind !== 'planned' && a.status === key)

export default function MaintenanceView() {
  const [rigs, setRigs] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [rigId, setRigId] = useState(null)
  const [reportId, setReportId] = useState(null)
  const [inner, setInner] = useState('overview') // 'overview' | <dept> | 'analytics'
  const [scope, setScope] = useState('this')     // 'this' | 'overall'
  const [openKpi, setOpenKpi] = useState(null)    // null | 'planned' | 'completed' | 'pending' | 'routine'

  const [acts, setActs] = useState(null)          // activities for reports up to & incl. selected
  const [actErr, setActErr] = useState(null)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    Promise.all([loadRigsForPicker(), loadMaintenanceReports()])
      .then(([r, reps]) => { setRigs(r); setReports(reps) })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  const reportsByRig = useMemo(() => {
    const m = new Map()
    for (const r of reports) { if (!m.has(r.rig_id)) m.set(r.rig_id, []); m.get(r.rig_id).push(r) }
    for (const list of m.values()) list.sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')))
    return m
  }, [reports])

  useEffect(() => {
    if (rigId || !rigs.length) return
    const withData = rigs.find((r) => (reportsByRig.get(r.id) || []).length > 0)
    setRigId((withData || rigs[0]).id)
  }, [rigs, reportsByRig, rigId])

  const rigReports = rigId ? (reportsByRig.get(rigId) || []) : []
  const selectedReport = useMemo(() => {
    if (!rigReports.length) return null
    return rigReports.find((r) => r.id === reportId) || rigReports[0]
  }, [rigReports, reportId])

  // reports up to & including the selected date (for Overall)
  const reportsUpTo = useMemo(() => {
    if (!selectedReport) return []
    return rigReports.filter((r) => String(r.report_date || '') <= String(selectedReport.report_date || ''))
  }, [rigReports, selectedReport])
  const dateById = useMemo(() => new Map(rigReports.map((r) => [r.id, r.report_date])), [rigReports])

  // Load activities for the active scope only:
  //  • "this"    -> ONLY the selected report (small + fast; the default view)
  //  • "overall" -> every report up to the selected date (paginated, uncapped)
  // Loading just the selected report for "this" also avoids re-fetching a rig's
  // whole (growing) history on every visit.
  useEffect(() => {
    setActs(null); setActErr(null)
    const ids = scope === 'this'
      ? (selectedReport ? [selectedReport.id] : [])
      : reportsUpTo.map((r) => r.id)
    if (!ids.length) return
    let cancelled = false
    loadMaintenanceActivitiesForReports(ids)
      .then((a) => { if (!cancelled) setActs(a) })
      .catch((e) => { if (!cancelled) setActErr(e.message) })
    return () => { cancelled = true }
  }, [scope, selectedReport, reportsUpTo])

  const allActs = useMemo(() => (acts || []).map((a) => ({ ...a, ...matchKeywords(a.activity_text) })), [acts])
  const thisActs = useMemo(() => (selectedReport ? allActs.filter((a) => a.report_id === selectedReport.id) : []), [allActs, selectedReport])
  const scopeActs = scope === 'this' ? thisActs : allActs

  const byDeptThis = useMemo(() => groupByDept(thisActs), [thisActs])
  const counts = useMemo(() => ({
    planned: scopeActs.filter((a) => inBucket(a, 'planned')).length,
    completed: scopeActs.filter((a) => inBucket(a, 'completed')).length,
    pending: scopeActs.filter((a) => inBucket(a, 'pending')).length,
    routine: scopeActs.filter((a) => inBucket(a, 'routine')).length,
  }), [scopeActs])

  const rigName = rigs.find((r) => r.id === rigId)?.name || '—'

  if (!isSupabaseConfigured) return <div className="wrap"><div className="state err">Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local and restart.</div></div>
  if (loading) return <div className="wrap"><div className="state">Loading maintenance…</div></div>
  if (err) return <div className="wrap"><LoadError message={err} onRetry={() => setReloadKey((k) => k + 1)} /></div>

  const thisExtracted = selectedReport && (selectedReport.extraction_status === 'extracted' || selectedReport.extraction_status === 'needs_review')

  // expandable KPI list (respects scope), grouped by dept
  const expandItems = openKpi ? scopeActs.filter((a) => inBucket(a, openKpi)) : []
  const expandByDept = openKpi ? groupByDept(expandItems) : []

  return (
    <div className="wrap maint-dash">
      {/* Toolbar: rig + report-date */}
      <div className="maint-toolbar">
        <label className="maint-pick">
          <span>Rig</span>
          <select value={rigId || ''} onChange={(e) => { setRigId(e.target.value); setReportId(null); setInner('overview'); setOpenKpi(null) }}>
            {rigs.map((r) => {
              const has = (reportsByRig.get(r.id) || []).length
              return <option key={r.id} value={r.id}>{r.name}{has ? '' : ' — no DMR'}</option>
            })}
          </select>
        </label>
        {rigReports.length > 0 && (
          <label className="maint-pick">
            <span>Report date</span>
            <select value={selectedReport?.id || ''} onChange={(e) => { setReportId(e.target.value); setOpenKpi(null) }}>
              {rigReports.map((r) => <option key={r.id} value={r.id}>{prettyDate(r.report_date)}</option>)}
            </select>
          </label>
        )}
      </div>

      {/* Header */}
      <div className="maint-header">
        <div>
          <h2>{rigName}</h2>
          <div className="maint-sub">
            <span className="spill s-approved">Active Operations</span>
            {selectedReport ? <span className="maint-date">Latest DMR · {prettyDate(selectedReport.report_date)}</span> : <span className="maint-date">No DMR on record</span>}
          </div>
        </div>
      </div>

      {!selectedReport ? (
        <div className="panel"><div className="npt-empty">No maintenance report yet for <b>{rigName}</b>. DMRs appear here once the rig sends one and the pipeline ingests it.</div></div>
      ) : (
        <>
          {/* KPI scope toggle */}
          <div className="kpi-scopebar">
            <div className="scope-toggle">
              <button type="button" className={scope === 'this' ? 'on' : ''} onClick={() => { setScope('this'); setOpenKpi(null) }}>This report</button>
              <button type="button" className={scope === 'overall' ? 'on' : ''} onClick={() => { setScope('overall'); setOpenKpi(null) }}>Overall</button>
            </div>
            <span className="scope-note">
              {scope === 'this'
                ? `${prettyDate(selectedReport.report_date)} DMR`
                : `cumulative across ${reportsUpTo.length} report${reportsUpTo.length === 1 ? '' : 's'} up to ${prettyDate(selectedReport.report_date)}`}
            </span>
          </div>

          {/* KPI cards (clickable) */}
          {!acts ? (
            <div className="state">Loading activities…</div>
          ) : actErr ? (
            <LoadError message={actErr} onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <>
              <div className="kpi-row">
                {KPI_DEFS.map((k) => {
                  const overallPending = scope === 'overall' && k.key === 'pending'
                  return (
                    <button
                      type="button"
                      key={k.key}
                      className={`kpi ${k.cls} clickable ${openKpi === k.key ? 'open' : ''}`}
                      aria-expanded={openKpi === k.key}
                      onClick={() => setOpenKpi((cur) => (cur === k.key ? null : k.key))}
                      title={overallPending ? 'Count of activities ever marked pending across reports — not a live backlog (DMRs do not link a pending item to its later completion).' : undefined}
                    >
                      <div className="kpi-num">{counts[k.key]}</div>
                      <div className="kpi-label">{k.label}{overallPending ? ' *' : ''}</div>
                      {overallPending && <div className="kpi-sub">mentions across reports</div>}
                      <div className="kpi-hint">{openKpi === k.key ? 'Hide ▲' : 'View ▼'}</div>
                    </button>
                  )
                })}
              </div>

              {/* Expandable list for the open KPI */}
              {openKpi && (
                <div className="kpi-expand panel">
                  <div className="sec-h" style={{ margin: '0 0 8px' }}>
                    <h3 style={{ textTransform: 'capitalize' }}>{openKpi} activities <span className="hint">· {scope === 'this' ? 'this report' : `overall (${reportsUpTo.length} report${reportsUpTo.length === 1 ? '' : 's'})`}</span></h3>
                    <button type="button" className="btn" onClick={() => setOpenKpi(null)}>Close</button>
                  </div>
                  {expandItems.length === 0 ? (
                    <div className="npt-empty">No {openKpi} activities in this scope.</div>
                  ) : (
                    <div className="dept-grid-2">
                      {expandByDept.map((g) => {
                        const items = g[openKpi === 'planned' ? 'planned' : 'last'].filter((a) => inBucket(a, openKpi))
                        if (!items.length) return null
                        return (
                          <div key={g.department} className="expand-dept">
                            <div className="dept-sub"><span className="dept-ico">{deptIcon(g.department)}</span>{g.department}</div>
                            <ul className="dmr-list">
                              {items.map((a) => (
                                <li key={a.id}>
                                  {openKpi !== 'planned' && <span className={`dot ${statusDot(a.status)}`} />}
                                  <span className="dmr-text">{a.activity_text}</span>
                                  {scope === 'overall' && <span className="it-date">{prettyDate(dateById.get(a.report_id))}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Sub-nav + content */}
              <div className="maint-body">
                <nav className="maint-subnav">
                  <button type="button" className={inner === 'overview' ? 'on' : ''} onClick={() => setInner('overview')}>Rig Overview</button>
                  {byDeptThis.map((g) => (
                    <button key={g.department} type="button" className={inner === g.department ? 'on' : ''} onClick={() => setInner(g.department)}>
                      <span className="sn-ico">{deptIcon(g.department)}</span>{g.department}
                    </button>
                  ))}
                  <button type="button" className={inner === 'analytics' ? 'on' : ''} onClick={() => setInner('analytics')}>Analytics</button>
                </nav>

                <div className="maint-content">
                  {!thisExtracted ? (
                    <div className="pending-gto">This DMR ({prettyDate(selectedReport.report_date)}) is <b>{selectedReport.extraction_status}</b> — department detail appears once it's extracted. (KPIs above can still total older reports via “Overall”.)</div>
                  ) : inner === 'analytics' ? (
                    <AnalyticsPanel rigName={rigName} byDept={byDeptThis} />
                  ) : byDeptThis.length === 0 ? (
                    <div className="npt-empty">No department activities in this DMR.</div>
                  ) : inner === 'overview' ? (
                    // CHANGE 1: Rig Overview = highlights only
                    <div className="dept-grid-2">
                      {byDeptThis.map((g) => <OverviewCard key={g.department} g={g} />)}
                    </div>
                  ) : (
                    // Department tab = full detail for that one department
                    <div className="dept-grid-1">
                      {byDeptThis.filter((g) => g.department === inner).map((g) => <DeptDetailCard key={g.department} g={g} />)}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// Rig Overview card — highlights ONLY (no lists).
function OverviewCard({ g }) {
  const hasHi = g.critical.length > 0 || g.notable.length > 0
  return (
    <div className="dept-card maint-deptcard">
      <div className="dept-head">
        <span className="dept-name"><span className="dept-ico">{deptIcon(g.department)}</span>{g.department}</span>
        <span className="dept-chief">Chief: <b>{g.chief || '—'}</b></span>
      </div>
      {g.critical.length > 0 && (
        <div className="dept-banner crit"><span className="db-tag">⚠ Critical</span><ul>{g.critical.map((a) => <li key={a.id}>{a.activity_text}</li>)}</ul></div>
      )}
      {g.notable.length > 0 && (
        <div className="dept-banner notable"><span className="db-tag">Notable</span><ul>{g.notable.map((a) => <li key={a.id}>{a.activity_text}</li>)}</ul></div>
      )}
      {!hasHi && <div className="npt-empty sm">No flagged items — nothing critical or notable.</div>}
    </div>
  )
}

// Department tab — FULL detail (last day with dots + today's plan).
function DeptDetailCard({ g }) {
  return (
    <div className="dept-card maint-deptcard">
      <div className="dept-head">
        <span className="dept-name"><span className="dept-ico">{deptIcon(g.department)}</span>{g.department}</span>
        <span className="dept-chief">Chief: <b>{g.chief || '—'}</b></span>
      </div>
      {g.critical.length > 0 && (
        <div className="dept-banner crit"><span className="db-tag">⚠ Critical</span><ul>{g.critical.map((a) => <li key={a.id}>{a.activity_text}</li>)}</ul></div>
      )}
      {g.notable.length > 0 && (
        <div className="dept-banner notable"><span className="db-tag">Notable</span><ul>{g.notable.map((a) => <li key={a.id}>{a.activity_text}</li>)}</ul></div>
      )}
      <div className="dept-sub">Last day</div>
      {g.last.length === 0 ? <div className="npt-empty sm">No last-day activities.</div> : (
        <ul className="dmr-list">
          {g.last.map((a) => (
            <li key={a.id}><span className={`dot ${statusDot(a.status)}`} /><span className="dmr-text">{a.activity_text}</span></li>
          ))}
        </ul>
      )}
      <div className="dept-sub">Today’s plan</div>
      {g.planned.length === 0 ? <div className="npt-empty sm">No planned activities.</div> : (
        <ul className="dmr-list planned">{g.planned.map((a) => <li key={a.id}><span className="dmr-text">{a.activity_text}</span></li>)}</ul>
      )}
    </div>
  )
}

function AnalyticsPanel({ rigName, byDept }) {
  return (
    <div className="panel">
      <h3>{rigName} — maintenance summary (latest DMR)</h3>
      <div className="psub">From this report’s real activities · no fabricated metrics</div>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead><tr><th>Department</th><th className="num">✓ Done</th><th className="num">⏳ Pending</th><th className="num">↻ Routine</th><th className="num">Planned</th><th className="num">Critical</th><th className="num">Notable</th></tr></thead>
          <tbody>
            {byDept.map((g) => {
              const done = g.last.filter((a) => a.status === 'completed').length
              const pend = g.last.filter((a) => a.status === 'pending').length
              const rout = g.last.filter((a) => a.status === 'routine').length
              return (
                <tr key={g.department}>
                  <td>{deptIcon(g.department)} {g.department}</td>
                  <td className="num mono">{done}</td><td className="num mono">{pend}</td><td className="num mono">{rout}</td>
                  <td className="num mono">{g.planned.length}</td><td className="num mono">{g.critical.length}</td><td className="num mono">{g.notable.length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
