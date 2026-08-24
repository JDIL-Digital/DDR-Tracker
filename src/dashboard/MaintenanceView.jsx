import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { useAuth } from '../auth/AuthProvider'
import { loadRigsForPicker } from './settings'
import {
  loadMaintenanceReports, uploadMaintenanceReport, deleteMaintenanceReport, loadMaintenanceRollup,
} from './maintenance'
import { prettyDate, todayISO } from './format'
import { LoadError } from './LoadState'
import MaintenanceReportDetail from './MaintenanceReportDetail'
import AssetsView from './AssetsView'

function statusClass(s) {
  if (s === 'extracted') return 's-approved'
  if (s === 'failed') return 's-rejected'
  return 's-pending'
}
function monthStartISO() {
  const t = todayISO() // yyyy-mm-dd
  return `${t.slice(0, 7)}-01`
}

export default function MaintenanceView() {
  const { user, isAdmin } = useAuth()
  const [rigs, setRigs] = useState([])
  const [reports, setReports] = useState(null)
  const [rollup, setRollup] = useState(null)
  const [err, setErr] = useState(null)

  // upload form
  const [rigId, setRigId] = useState('')
  const [reportDate, setReportDate] = useState(todayISO())
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [showAssets, setShowAssets] = useState(false)

  const load = useCallback(() => {
    setErr(null)
    Promise.all([loadRigsForPicker(), loadMaintenanceReports(), loadMaintenanceRollup(monthStartISO(), todayISO())])
      .then(([r, reps, roll]) => { setRigs(r); setReports(reps); setRollup(roll) })
      .catch((e) => setErr(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  const selected = reports?.find((r) => r.id === selectedId) || null

  async function onUpload(e) {
    e.preventDefault()
    setMsg(null)
    if (!file) { setMsg({ type: 'err', text: 'Choose a .docx DMR file.' }); return }
    if (!rigId) { setMsg({ type: 'err', text: 'Pick a rig.' }); return }
    setBusy(true)
    try {
      await uploadMaintenanceReport({ rigId, reportDate, file, userId: user?.id })
      setMsg({ type: 'ok', text: `Uploaded “${file.name}”.` })
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      load()
    } catch (e2) {
      setMsg({ type: 'err', text: e2.message })
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(rep) {
    const label = `${rep.rig_name || 'report'} · ${rep.report_date || ''}`
    if (!window.confirm(`Delete DMR “${label}” and its stored file? This cannot be undone.`)) return
    setBusyId(rep.id)
    setErr(null)
    try {
      await deleteMaintenanceReport(rep.id, rep.source_file_path)
      if (selectedId === rep.id) setSelectedId(null)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="wrap">
        <div className="state err">
          Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
          .env.local and restart the dev server.
        </div>
      </div>
    )
  }

  // Detail view
  if (selected) {
    return (
      <div className="wrap">
        <MaintenanceReportDetail
          report={selected}
          isAdmin={isAdmin}
          onBack={() => setSelectedId(null)}
          onDelete={() => onDelete(selected)}
          onDeleting={busyId === selected.id}
        />
      </div>
    )
  }

  return (
    <div className="wrap">
      <div className="sec-h">
        <h2>Maintenance — Daily Maintenance Reports</h2>
        <span className="hint">Department-wise activities from uploaded DMRs</span>
      </div>

      {err && <LoadError message={err} onRetry={load} />}

      {/* Upload (admin) */}
      <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
        <h3>Upload DMR</h3>
        <div className="psub">Upload a rig’s Daily Maintenance Report (.docx) · stored, then extracted by the DMR extractor</div>
        {!isAdmin ? (
          <div className="setting-note">Uploading DMRs is admin-only. You can view the reports below.</div>
        ) : (
          <form className="wellplan-form" onSubmit={onUpload}>
            <div className="wp-fields">
              <label className="wp-field">
                <span>Rig</span>
                <select value={rigId} onChange={(e) => setRigId(e.target.value)}>
                  <option value="">— select rig —</option>
                  {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="wp-field">
                <span>Report date</span>
                <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
              </label>
              <label className="wp-field">
                <span>DMR file (.docx)</span>
                <input ref={fileRef} type="file" accept=".docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
            </div>
            <div className="wp-actions">
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload DMR'}</button>
              {msg && <span className={`wp-msg ${msg.type}`}>{msg.text}</span>}
            </div>
          </form>
        )}
      </div>

      {/* Monthly rollup */}
      <div className="panel">
        <h3>This month — activity rollup</h3>
        <div className="psub">Last-day activities since {prettyDate(monthStartISO())} · completed vs pending vs routine</div>
        {!rollup ? (
          <div className="state">Loading…</div>
        ) : rollup.reportCount === 0 ? (
          <div className="npt-empty">No DMRs recorded this month yet.</div>
        ) : (
          <div className="rollup-grid">
            <RollupTable title="By rig" rows={rollup.byRig} />
            <RollupTable title="By department" rows={rollup.byDept} />
          </div>
        )}
      </div>

      {/* Reports list */}
      <div className="panel">
        <h3>Maintenance reports</h3>
        {!reports ? (
          <div className="state">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="npt-empty">No DMRs uploaded yet.</div>
        ) : (
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr><th>Rig</th><th>Date</th><th>File</th><th>Status</th><th>Uploaded</th><th className="ta-r">Actions</th></tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setSelectedId(r.id)}>
                    <td>{r.rig_name || '—'}</td>
                    <td>{r.report_date ? prettyDate(r.report_date) : '—'}</td>
                    <td className="mono wp-file" title={r.source_file_name || ''}>{r.source_file_name || '—'}</td>
                    <td><span className={`spill ${statusClass(r.extraction_status)}`}>{r.extraction_status}</span></td>
                    <td>{r.created_at ? prettyDate(String(r.created_at).slice(0, 10)) : '—'}</td>
                    <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="mini-btn" onClick={() => setSelectedId(r.id)}>View</button>
                      {isAdmin && <button type="button" className="mini-btn reject" disabled={busyId === r.id} onClick={() => onDelete(r)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="setting-note">
          Stage 1: DMRs are stored in the <code>maintenance-reports</code> bucket and extracted
          department-wise via <code>scripts/extract-dmr.js</code> (manual for now).
        </div>
      </div>

      {/* Secondary: existing assets/equipment content */}
      <div className="panel">
        <div className="sec-h" style={{ margin: 0 }}>
          <h3>Assets &amp; inventory <span className="hint">(reference)</span></h3>
          <button type="button" className="btn" onClick={() => setShowAssets((v) => !v)}>
            {showAssets ? 'Hide' : 'Show'}
          </button>
        </div>
        {showAssets && <div className="embedded-assets" style={{ marginTop: 12 }}><AssetsView /></div>}
      </div>
    </div>
  )
}

function RollupTable({ title, rows }) {
  return (
    <div className="rollup-col">
      <div className="eyebrow" style={{ margin: '0 0 6px' }}>{title}</div>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr><th>{title.replace('By ', '')}</th><th className="num">✓ Done</th><th className="num">⏳ Pending</th><th className="num">↻ Routine</th><th className="num">Total</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className="num mono">{r.completed}</td>
                <td className="num mono">{r.pending}</td>
                <td className="num mono">{r.routine}</td>
                <td className="num mono">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
