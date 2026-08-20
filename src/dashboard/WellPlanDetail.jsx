import { useState } from 'react'
import { updateWellPlan, signedUrlForPlan } from './settings'
import { prettyDate } from './format'

const WELL_TYPES = ['exploratory', 'workover', 'sidetrack']
function statusClass(s) {
  if (s === 'extracted') return 's-approved'
  if (s === 'failed') return 's-rejected'
  return 's-pending'
}

// Detail / edit view for one well plan. Metadata + a signed-URL file link +
// a placeholder for the (future) extracted details. Admins can edit metadata
// or delete (delete is handled by the parent via onDelete).
export default function WellPlanDetail({ plan, rigs, isAdmin, initialEditing = false, onBack, onDelete, onSaved }) {
  const [editing, setEditing] = useState(initialEditing)
  const [rigId, setRigId] = useState(plan.rig_id || '')
  const [wellName, setWellName] = useState(plan.well_name || '')
  const [wellType, setWellType] = useState(plan.well_type || 'exploratory')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileErr, setFileErr] = useState(null)

  const rigName = rigs.find((r) => r.id === plan.rig_id)?.name || plan.rig_name || '—'

  const startEdit = () => {
    setRigId(plan.rig_id || '')
    setWellName(plan.well_name || '')
    setWellType(plan.well_type || 'exploratory')
    setMsg(null)
    setEditing(true)
  }

  async function openFile() {
    setFileErr(null)
    setFileBusy(true)
    try {
      const url = await signedUrlForPlan(plan.source_file_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setFileErr(e.message)
    } finally {
      setFileBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      await updateWellPlan(plan.id, { rigId, wellName, wellType })
      setEditing(false)
      await onSaved()
    } catch (e2) {
      setMsg({ type: 'err', text: e2.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <div className="sec-h" style={{ margin: '0 0 12px' }}>
        <h3>Well Plan detail</h3>
        <button type="button" className="btn" onClick={onBack}>← Back to list</button>
      </div>

      {editing ? (
        <form className="wellplan-form" onSubmit={save}>
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
              <input type="text" value={wellName} onChange={(e) => setWellName(e.target.value)} placeholder="e.g. HJ#1Z" />
            </label>
          </div>
          <div className="wp-actions">
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            {msg && <span className={`wp-msg ${msg.type}`}>{msg.text}</span>}
          </div>
        </form>
      ) : (
        <>
          <div className="wp-meta">
            <div><span className="k">Rig</span><span className="v">{rigName}</span></div>
            <div><span className="k">Well name</span><span className="v">{plan.well_name || '—'}</span></div>
            <div><span className="k">Type</span><span className="v"><span className="spill r-viewer">{plan.well_type || '—'}</span></span></div>
            <div><span className="k">Status</span><span className="v"><span className={`spill ${statusClass(plan.extraction_status)}`}>{plan.extraction_status}</span></span></div>
            <div><span className="k">Uploaded</span><span className="v">{plan.created_at ? prettyDate(String(plan.created_at).slice(0, 10)) : '—'}</span></div>
            <div><span className="k">File</span><span className="v mono wp-file" title={plan.source_file_name || ''}>{plan.source_file_name || '—'}</span></div>
          </div>

          <div className="wp-actions">
            <button type="button" className="btn primary" onClick={openFile} disabled={!plan.source_file_path || fileBusy}>
              {fileBusy ? 'Opening…' : 'View / Download file'}
            </button>
            {isAdmin && <button type="button" className="btn" onClick={startEdit}>Edit</button>}
            {isAdmin && <button type="button" className="btn danger" onClick={onDelete}>Delete</button>}
            {fileErr && <span className="wp-msg err">{fileErr}</span>}
          </div>

          <div className="eyebrow" style={{ margin: '18px 0 6px' }}>Extracted details</div>
          <ExtractedDetails plan={plan} />
        </>
      )}
    </div>
  )
}

// The extracted plan data — shown when extraction_status = 'extracted'. Honest
// empty / needs-review / failed states otherwise. total_planned_days + key_notes
// live in raw_extract; milestones / history / target are their own columns.
function ExtractedDetails({ plan }) {
  const status = plan.extraction_status
  if (status === 'uploaded') {
    return <div className="pending-gto">Pending extraction — run the well-plan extractor on this row to populate planned days, milestones, well history, and key notes.</div>
  }
  if (status === 'failed') {
    return <div className="state err"><span className="state-err-msg">Extraction failed. Check the file and re-run the extractor.</span></div>
  }

  const raw = plan.raw_extract || {}
  const milestones = Array.isArray(plan.planned_milestones) ? plan.planned_milestones : []
  const notes = Array.isArray(raw.key_notes) ? raw.key_notes : []
  const totalDays = raw.total_planned_days ?? null

  if (status === 'needs_review' && milestones.length === 0 && !plan.well_history) {
    return <div className="npt-empty">Extracted, but thin — needs review. The document didn't yield milestones or a history section.</div>
  }

  return (
    <div className="wp-extracted">
      {status === 'needs_review' && (
        <div className="setting-note" style={{ marginTop: 0 }}>Marked <b>needs review</b> — verify the extracted values against the document.</div>
      )}

      <div className="wp-meta" style={{ marginTop: 4 }}>
        <div><span className="k">Total planned days</span><span className="v mono">{totalDays != null ? totalDays : '—'}</span></div>
        <div><span className="k">Target depth</span><span className="v mono">{plan.target_depth_m != null ? `${plan.target_depth_m} m` : '—'}</span></div>
      </div>

      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Planned milestones</div>
      {milestones.length === 0 ? (
        <div className="npt-empty">No milestones extracted.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr><th className="num">Step</th><th>Description</th><th className="num">Planned days</th><th className="num">Cumulative</th></tr>
            </thead>
            <tbody>
              {milestones.map((m, i) => (
                <tr key={i}>
                  <td className="num mono">{m.step_no ?? i + 1}</td>
                  <td>{m.description || '—'}</td>
                  <td className="num mono">{m.planned_days ?? '—'}</td>
                  <td className="num mono">{m.cumulative_days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Well history</div>
      {plan.well_history ? (
        <div className="wp-history">{plan.well_history}</div>
      ) : (
        <div className="npt-empty">No well history extracted.</div>
      )}

      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>Key notes</div>
      {notes.length === 0 ? (
        <div className="npt-empty">No key notes extracted.</div>
      ) : (
        <ul className="wp-notes">
          {notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}
