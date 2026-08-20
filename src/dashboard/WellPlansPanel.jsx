import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { loadRigsForPicker, loadWellPlans, uploadWellPlan, deleteWellPlan } from './settings'
import { prettyDate } from './format'
import { LoadError } from './LoadState'
import WellPlanDetail from './WellPlanDetail'

const WELL_TYPES = ['exploratory', 'workover', 'sidetrack']

// Status pill class — 'uploaded'/'needs_review' amber, 'extracted' green, 'failed' red.
function statusClass(s) {
  if (s === 'extracted') return 's-approved'
  if (s === 'failed') return 's-rejected'
  return 's-pending'
}

// Settings → Well Plans (Stage 1). Upload a plan file (PDF/DOCX) + metadata into
// the 'well-plans' bucket and the well_plans table with status 'uploaded'. No
// extraction yet — just store and list.
export default function WellPlansPanel() {
  const { user, isAdmin } = useAuth()
  const [rigs, setRigs] = useState([])
  const [plans, setPlans] = useState(null)
  const [err, setErr] = useState(null)

  const [rigId, setRigId] = useState('')
  const [wellType, setWellType] = useState('exploratory')
  const [wellName, setWellName] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { type: 'ok' | 'err', text }
  const fileRef = useRef(null)

  // Detail/edit routing + row-level delete state.
  const [selectedId, setSelectedId] = useState(null)
  const [startEdit, setStartEdit] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setErr(null)
    Promise.all([loadRigsForPicker(), loadWellPlans()])
      .then(([r, p]) => { setRigs(r); setPlans(p) })
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => { load() }, [load])

  const selected = plans?.find((p) => p.id === selectedId) || null

  const openDetail = (id, edit = false) => { setStartEdit(edit); setSelectedId(id) }
  const backToList = () => { setSelectedId(null); setStartEdit(false) }

  async function onDelete(plan) {
    const label = plan.well_name || plan.source_file_name || 'this plan'
    if (!window.confirm(`Delete “${label}” and its stored file? This cannot be undone.`)) return
    setBusyId(plan.id)
    setErr(null)
    try {
      await deleteWellPlan(plan.id, plan.source_file_path)
      if (selectedId === plan.id) backToList()
      setPlans(await loadWellPlans())
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  async function onUpload(e) {
    e.preventDefault()
    setMsg(null)
    if (!file) { setMsg({ type: 'err', text: 'Choose a .pdf or .docx file.' }); return }
    setBusy(true)
    try {
      await uploadWellPlan({ rigId, wellName, wellType, file, userId: user?.id })
      setMsg({ type: 'ok', text: `Uploaded “${file.name}”.` })
      setWellName('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setPlans(await loadWellPlans())
    } catch (e2) {
      setMsg({ type: 'err', text: e2.message })
    } finally {
      setBusy(false)
    }
  }

  // Detail / edit view for a selected plan.
  if (selected) {
    return (
      <WellPlanDetail
        plan={selected}
        rigs={rigs}
        isAdmin={isAdmin}
        initialEditing={startEdit}
        onBack={backToList}
        onDelete={() => onDelete(selected)}
        onSaved={async () => setPlans(await loadWellPlans())}
      />
    )
  }

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Well Plans</h3>
      <div className="psub">Upload a GTO / well-data PDF or Word doc · stored only (extraction comes later)</div>

      {err && <LoadError message={err} onRetry={load} />}

      {!isAdmin ? (
        <div className="setting-note">Uploading well plans is admin-only. You can view the uploaded plans below.</div>
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
            <span>Well type</span>
            <select value={wellType} onChange={(e) => setWellType(e.target.value)}>
              {WELL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="wp-field">
            <span>Well name</span>
            <input type="text" placeholder="e.g. HJ#1Z" value={wellName} onChange={(e) => setWellName(e.target.value)} />
          </label>
          <label className="wp-field">
            <span>Plan file (.pdf / .docx)</span>
            <input ref={fileRef} type="file" accept=".pdf,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="wp-actions">
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload plan'}</button>
          {msg && <span className={`wp-msg ${msg.type}`}>{msg.text}</span>}
        </div>
      </form>
      )}

      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>Uploaded plans</div>
      {!plans ? (
        <div className="state">Loading…</div>
      ) : plans.length === 0 ? (
        <div className="npt-empty">No well plans uploaded yet.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr><th>Rig</th><th>Well</th><th>Type</th><th>File</th><th>Status</th><th>Uploaded</th><th className="ta-r">Actions</th></tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => openDetail(p.id)}>
                  <td>{p.rig_name || '—'}</td>
                  <td>{p.well_name || '—'}</td>
                  <td><span className="spill r-viewer">{p.well_type || '—'}</span></td>
                  <td className="mono wp-file" title={p.source_file_name || ''}>{p.source_file_name || '—'}</td>
                  <td><span className={`spill ${statusClass(p.extraction_status)}`}>{p.extraction_status}</span></td>
                  <td>{p.created_at ? prettyDate(String(p.created_at).slice(0, 10)) : '—'}</td>
                  <td className="ta-r" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="mini-btn" onClick={() => openDetail(p.id)}>View</button>
                    {isAdmin && <button type="button" className="mini-btn" onClick={() => openDetail(p.id, true)}>Edit</button>}
                    {isAdmin && <button type="button" className="mini-btn reject" disabled={busyId === p.id} onClick={() => onDelete(p)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="setting-note">
        Stage 1: files are stored in the <code>well-plans</code> bucket with status <b>uploaded</b>.
        Extraction (planned days, milestones, well history) comes in the next stage.
      </div>
    </div>
  )
}
