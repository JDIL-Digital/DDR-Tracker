import { useCallback, useEffect, useState } from 'react'
import { loadMaintenanceActivities, updateActivityStatus, signedUrlForMaintenance } from './maintenance'
import { matchKeywords } from './maintenanceKeywords'
import { prettyDate } from './format'
import { LoadError } from './LoadState'

const STATUSES = ['completed', 'pending', 'routine']
const statusClass = (s) => (s === 'completed' ? 's-approved' : s === 'pending' ? 's-pending' : 'r-viewer')
const statusLabel = (s) => (s === 'completed' ? '✓ Completed' : s === 'pending' ? '⏳ Pending' : '↻ Routine')
const kindLabel = (k) => (k === 'planned' ? 'Planned' : 'Last day')

function reportStatusClass(s) {
  if (s === 'extracted') return 's-approved'
  if (s === 'failed') return 's-rejected'
  return 's-pending'
}

// Render activity text with the matched keyword subtly emphasized (first
// case-insensitive occurrence wrapped in <mark>). Falls back to plain text.
function EmphText({ text, keyword }) {
  if (!keyword) return <>{text}</>
  const i = String(text).toLowerCase().indexOf(String(keyword).toLowerCase())
  if (i < 0) return <>{text}</>
  const before = text.slice(0, i)
  const hit = text.slice(i, i + keyword.length)
  const after = text.slice(i + keyword.length)
  return <>{before}<mark className="kw-hit">{hit}</mark>{after}</>
}

// Detail view for one DMR — a two-tier Key Highlights box at the top, then the
// (collapsible) full department detail with editable status badges. Matched
// activities are accented (red = critical, amber = notable) in both places.
export default function MaintenanceReportDetail({ report, isAdmin, onBack, onDelete, onDeleting }) {
  const [acts, setActs] = useState(null)
  const [err, setErr] = useState(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileErr, setFileErr] = useState(null)
  const [showDetail, setShowDetail] = useState(false) // full detail collapsed by default

  const load = useCallback(() => {
    setErr(null)
    loadMaintenanceActivities(report.id).then(setActs).catch((e) => setErr(e.message))
  }, [report.id])
  useEffect(() => { load() }, [load])

  async function openFile() {
    setFileErr(null); setFileBusy(true)
    try {
      const url = await signedUrlForMaintenance(report.source_file_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) { setFileErr(e.message) } finally { setFileBusy(false) }
  }

  async function setStatus(id, status) {
    setActs((cur) => cur.map((a) => (a.id === id ? { ...a, status } : a)))
    try { await updateActivityStatus(id, status) } catch (e) { setErr(e.message); load() }
  }

  // Annotate every activity with its keyword tier, then group by department.
  const annotated = (acts || []).map((a) => ({ ...a, ...matchKeywords(a.activity_text) }))
  const highlights = annotated.filter((a) => a.tier)
  const critical = highlights.filter((a) => a.tier === 'critical')
  const notable = highlights.filter((a) => a.tier === 'notable')

  const byDept = []
  const idx = new Map()
  for (const a of annotated) {
    const key = a.department || 'other'
    if (!idx.has(key)) { idx.set(key, byDept.length); byDept.push({ department: key, chief: a.chief_in_charge, last: [], planned: [] }) }
    const g = byDept[idx.get(key)]
    if (!g.chief && a.chief_in_charge) g.chief = a.chief_in_charge
    if (a.activity_kind === 'planned') g.planned.push(a)
    else g.last.push(a)
  }

  const extracted = report.extraction_status === 'extracted' || report.extraction_status === 'needs_review'

  return (
    <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
      <div className="sec-h" style={{ margin: '0 0 12px' }}>
        <h3>Maintenance report</h3>
        <button type="button" className="btn" onClick={onBack}>← Back to list</button>
      </div>

      <div className="wp-meta">
        <div><span className="k">Rig</span><span className="v">{report.rig_name || '—'}</span></div>
        <div><span className="k">Date</span><span className="v">{report.report_date ? prettyDate(report.report_date) : '—'}</span></div>
        <div><span className="k">Status</span><span className="v"><span className={`spill ${reportStatusClass(report.extraction_status)}`}>{report.extraction_status}</span></span></div>
        <div><span className="k">File</span><span className="v mono wp-file" title={report.source_file_name || ''}>{report.source_file_name || '—'}</span></div>
      </div>

      <div className="wp-actions">
        <button type="button" className="btn primary" onClick={openFile} disabled={!report.source_file_path || fileBusy}>
          {fileBusy ? 'Opening…' : 'View / Download file'}
        </button>
        {isAdmin && <button type="button" className="btn danger" onClick={onDelete} disabled={onDeleting}>{onDeleting ? 'Deleting…' : 'Delete'}</button>}
        {fileErr && <span className="wp-msg err">{fileErr}</span>}
      </div>

      {err && <div style={{ marginTop: 12 }}><LoadError message={err} onRetry={load} /></div>}

      {report.extraction_status === 'uploaded' ? (
        <div className="pending-gto" style={{ marginTop: 16 }}>Pending extraction — run the DMR extractor on this report to populate department activities.</div>
      ) : report.extraction_status === 'failed' ? (
        <div className="state err" style={{ marginTop: 16 }}><span className="state-err-msg">Extraction failed. Check the file and re-run the extractor.</span></div>
      ) : !acts ? (
        <div className="state" style={{ marginTop: 16 }}>Loading activities…</div>
      ) : (
        <>
          {/* Key Highlights */}
          <div className="highlights-box">
            <div className="hi-head">⚠️ Key Highlights</div>
            {highlights.length === 0 ? (
              <div className="npt-empty sm">No flagged items in this report.</div>
            ) : (
              <>
                {critical.length > 0 && (
                  <ul className="hi-list">
                    {critical.map((a) => <HighlightItem key={a.id} a={a} />)}
                  </ul>
                )}
                {notable.length > 0 && (
                  <ul className="hi-list">
                    {notable.map((a) => <HighlightItem key={a.id} a={a} />)}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Collapsible full department detail */}
          <div className="sec-h" style={{ margin: '18px 0 8px' }}>
            <div className="eyebrow" style={{ margin: 0 }}>Full department detail</div>
            <button type="button" className="btn" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? 'Hide full detail' : 'Show full detail'}
            </button>
          </div>

          {showDetail && (
            byDept.length === 0 ? (
              <div className="npt-empty">No department activities extracted.</div>
            ) : (
              <div className="dept-grid">
                {byDept.map((g) => (
                  <div key={g.department} className="dept-card">
                    <div className="dept-head">
                      <span className="dept-name">{g.department}</span>
                      <span className="dept-chief">Chief: <b>{g.chief || '—'}</b></span>
                    </div>

                    <div className="dept-sub">Last day</div>
                    {g.last.length === 0 ? (
                      <div className="npt-empty sm">No last-day activities.</div>
                    ) : (
                      <ul className="dmr-list">
                        {g.last.map((a) => (
                          <li key={a.id} className={a.tier ? `mk-${a.tier}` : ''}>
                            <span className="dmr-text"><EmphText text={a.activity_text} keyword={a.keyword} /></span>
                            {isAdmin ? (
                              <select className={`dmr-status-sel ${statusClass(a.status)}`} value={a.status || 'routine'} onChange={(e) => setStatus(a.id, e.target.value)}>
                                {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                              </select>
                            ) : (
                              <span className={`spill ${statusClass(a.status)}`}>{statusLabel(a.status)}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="dept-sub">Today’s planned</div>
                    {g.planned.length === 0 ? (
                      <div className="npt-empty sm">No planned activities.</div>
                    ) : (
                      <ul className="dmr-list planned">
                        {g.planned.map((a) => (
                          <li key={a.id} className={a.tier ? `mk-${a.tier}` : ''}>
                            <span className="dmr-text"><EmphText text={a.activity_text} keyword={a.keyword} /></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {isAdmin && extracted && showDetail && byDept.length > 0 && (
            <div className="setting-note">Tip: correct any mis-classified last-day item with its status dropdown — changes save immediately.</div>
          )}
        </>
      )}
    </div>
  )
}

// One row in the Key Highlights box.
function HighlightItem({ a }) {
  return (
    <li className={`hi-item hi-${a.tier}`}>
      <span className={`hi-tier hi-tier-${a.tier}`}>{a.tier === 'critical' ? 'Critical' : 'Notable'}</span>
      <span className="hi-text"><EmphText text={a.activity_text} keyword={a.keyword} /></span>
      <span className="hi-meta">{a.department || 'other'} · {kindLabel(a.activity_kind)}</span>
    </li>
  )
}
