import { useCallback, useEffect, useState } from 'react'
import { loadMaintenanceActivities, updateActivityStatus, signedUrlForMaintenance } from './maintenance'
import { prettyDate } from './format'
import { LoadError } from './LoadState'

const STATUSES = ['completed', 'pending', 'routine']
const statusClass = (s) => (s === 'completed' ? 's-approved' : s === 'pending' ? 's-pending' : 'r-viewer')
const statusLabel = (s) => (s === 'completed' ? '✓ Completed' : s === 'pending' ? '⏳ Pending' : '↻ Routine')

function reportStatusClass(s) {
  if (s === 'extracted') return 's-approved'
  if (s === 'failed') return 's-rejected'
  return 's-pending'
}

// Detail view for one DMR — department cards with Chief in Charge, an editable
// (admin) last-day activity list with completed/pending/routine badges, and a
// today's-planned list. Honest empty states; nothing invented.
export default function MaintenanceReportDetail({ report, isAdmin, onBack, onDelete, onDeleting }) {
  const [acts, setActs] = useState(null)
  const [err, setErr] = useState(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileErr, setFileErr] = useState(null)

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
    // Optimistic; reload on failure to stay honest about the stored value.
    setActs((cur) => cur.map((a) => (a.id === id ? { ...a, status } : a)))
    try { await updateActivityStatus(id, status) } catch (e) { setErr(e.message); load() }
  }

  // Group activities by department, preserving first-seen order.
  const byDept = []
  const idx = new Map()
  for (const a of acts || []) {
    const key = a.department || 'other'
    if (!idx.has(key)) { idx.set(key, byDept.length); byDept.push({ department: key, chief: a.chief_in_charge, last: [], planned: [] }) }
    const g = byDept[idx.get(key)]
    if (!g.chief && a.chief_in_charge) g.chief = a.chief_in_charge
    if (a.activity_kind === 'planned') g.planned.push(a)
    else g.last.push(a)
  }

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

      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Departments</div>
      {report.extraction_status === 'uploaded' ? (
        <div className="pending-gto">Pending extraction — run the DMR extractor on this report to populate department activities.</div>
      ) : report.extraction_status === 'failed' ? (
        <div className="state err"><span className="state-err-msg">Extraction failed. Check the file and re-run the extractor.</span></div>
      ) : !acts ? (
        <div className="state">Loading activities…</div>
      ) : byDept.length === 0 ? (
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
                    <li key={a.id}>
                      <span className="dmr-text">{a.activity_text}</span>
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
                  {g.planned.map((a) => <li key={a.id}><span className="dmr-text">{a.activity_text}</span></li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {isAdmin && byDept.length > 0 && (
        <div className="setting-note">Tip: correct any mis-classified last-day item with its status dropdown — changes save immediately.</div>
      )}
    </div>
  )
}
