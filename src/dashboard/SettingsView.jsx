import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { useAuth } from '../auth/AuthProvider'
import { loadActivityCodes, loadProfiles, setProfileStatus } from './settings'
import { prettyDate } from './format'

const SECTIONS = [
  { key: 'general', label: 'General' },
  { key: 'users', label: 'User Management' },
  { key: 'approvals', label: 'Admin Approvals' },
  { key: 'codes', label: 'Activity Codes' },
  { key: 'gto', label: 'GTO Uploads' },
  { key: 'notifications', label: 'Notifications' },
]

function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label}>
      <span className="knob" />
    </button>
  )
}

function catClass(category) {
  if (category === 'Productive') return 'cat-prod'
  if (category === 'Non-Productive') return 'cat-npt'
  if (category === 'Completion') return 'cat-comp'
  return 'cat-unk'
}

function StatusPill({ status }) {
  return <span className={`spill s-${status}`}>{status}</span>
}
function RolePill({ role }) {
  return <span className={`spill r-${role}`}>{role}</span>
}

// Admin Approvals — real approve/reject wired to the profiles table. Only an
// approved admin can see or use this; RLS enforces the same on the server.
function AdminApprovals() {
  const { isAdmin, user, refreshProfile } = useAuth()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    setErr(null)
    loadProfiles()
      .then(setRows)
      .catch((e) => setErr(e.message))
  }, [])

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  if (!isAdmin) {
    return (
      <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
        <h3>Admin Approvals</h3>
        <div className="npt-empty">Admin only — your account can't manage approvals.</div>
      </div>
    )
  }

  async function act(id, status) {
    setBusyId(id)
    setErr(null)
    try {
      await setProfileStatus(id, status, user.id)
      load()
      if (id === user.id) refreshProfile() // acted on self -> refresh own gate
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const pending = (rows || []).filter((r) => r.status === 'pending')

  return (
    <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
      <h3>Admin Approvals</h3>
      <div className="psub">Approve first-time logins · live from the profiles table</div>

      {err && <div className="state err">Failed: {err}</div>}

      {/* Pending queue */}
      <div className="eyebrow" style={{ margin: '4px 0 8px' }}>Pending requests</div>
      {!rows ? (
        <div className="state">Loading…</div>
      ) : pending.length === 0 ? (
        <div className="npt-empty">No pending approvals.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr><th>Email</th><th>Name</th><th>Requested</th><th className="ta-r">Actions</th></tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.email}</td>
                  <td>{r.full_name || '—'}</td>
                  <td>{r.created_at ? prettyDate(String(r.created_at).slice(0, 10)) : '—'}</td>
                  <td className="ta-r">
                    <button type="button" className="mini-btn approve" disabled={busyId === r.id} onClick={() => act(r.id, 'approved')}>Approve</button>
                    <button type="button" className="mini-btn reject" disabled={busyId === r.id} onClick={() => act(r.id, 'rejected')}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All users */}
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>All users</div>
      {!rows ? (
        <div className="state">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="npt-empty">No users yet.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Status</th><th className="ta-r">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.email}{r.id === user.id ? <span className="you-tag">you</span> : null}</td>
                  <td><RolePill role={r.role} /></td>
                  <td><StatusPill status={r.status} /></td>
                  <td className="ta-r">
                    {r.status !== 'approved' && (
                      <button type="button" className="mini-btn approve" disabled={busyId === r.id} onClick={() => act(r.id, 'approved')}>Approve</button>
                    )}
                    {r.status !== 'rejected' && (
                      <button type="button" className="mini-btn reject" disabled={busyId === r.id} onClick={() => act(r.id, 'rejected')}>Reject</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="setting-note">
        Approve grants dashboard access; Reject blocks it. Actions are recorded with your id and
        timestamp, and enforced by row-level security (only admins can change status).
      </div>
    </div>
  )
}

export default function SettingsView({ theme = 'dark', onSetTheme = () => {} }) {
  const [section, setSection] = useState('general')

  // General (session-only preferences for now — not persisted)
  const [defaultWindow, setDefaultWindow] = useState('30d')

  // Notifications (UI-only for now)
  const [recipients, setRecipients] = useState([])
  const [newRecipient, setNewRecipient] = useState('')
  const [dailyAlert, setDailyAlert] = useState(false)

  // Activity codes (real, from code_master)
  const [codes, setCodes] = useState(null)
  const [codesErr, setCodesErr] = useState(null)

  useEffect(() => {
    if (section !== 'codes' || codes || codesErr) return
    let cancelled = false
    loadActivityCodes()
      .then((d) => { if (!cancelled) setCodes(d) })
      .catch((e) => { if (!cancelled) setCodesErr(e.message) })
    return () => { cancelled = true }
  }, [section, codes, codesErr])

  const addRecipient = () => {
    const e = newRecipient.trim()
    if (e && !recipients.includes(e)) setRecipients((r) => [...r, e])
    setNewRecipient('')
  }

  return (
    <div className="wrap">
      <div className="sec-h">
        <h2>Settings</h2>
        <span className="hint">Local configuration · some sections activate with later features</span>
      </div>

      <div className="settings-layout">
        {/* Left sub-nav */}
        <div className="panel">
          <div className="eyebrow" style={{ marginBottom: 10 }}>Sections</div>
          <div className="cat-list">
            {SECTIONS.map((s) => (
              <div key={s.key} className={`cat-item ${section === s.key ? 'on' : ''}`} onClick={() => setSection(s.key)}>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right content */}
        <div>
          {section === 'general' && (
            <div className="panel">
              <h3>General</h3>
              <div className="psub">Display and default preferences</div>
              <div className="setting-row">
                <div>
                  <div className="s-lbl">Default time window</div>
                  <div className="s-desc">Default period for Analytics/Reports. Applies this session — persistence comes later.</div>
                </div>
                <div className="seg">
                  {[['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days']].map(([v, l]) => (
                    <button key={v} type="button" className={defaultWindow === v ? 'on' : ''} onClick={() => setDefaultWindow(v)}>{l}</button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div>
                  <div className="s-lbl">Units</div>
                  <div className="s-desc">Metric throughout — m, m/hr, L/hr, KL, hrs.</div>
                </div>
                <span className="catpill cat-comp">Metric (fixed)</span>
              </div>
              <div className="setting-row">
                <div>
                  <div className="s-lbl">Default theme</div>
                  <div className="s-desc">Switches the live theme (shared with the top-bar toggle). Session-only.</div>
                </div>
                <div className="seg">
                  {[['dark', 'Dark'], ['light', 'Light']].map(([v, l]) => (
                    <button key={v} type="button" className={theme === v ? 'on' : ''} onClick={() => onSetTheme(v)}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {section === 'users' && (
            <div className="panel">
              <h3>User Management</h3>
              <div className="psub">App users and their roles</div>
              <div className="matrix-scroll">
                <table className="matrix">
                  <thead>
                    <tr><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    <tr><td colSpan="4" className="empty-row">No user accounts yet — this table populates from the profiles table once authentication is added.</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="setting-note">Roles: <strong>Admin</strong> (manage users, approvals, settings) and <strong>Viewer</strong> (read dashboards). Remove/role actions activate with the auth step.</div>
            </div>
          )}

          {section === 'approvals' && <AdminApprovals />}

          {section === 'codes' && (
            <div className="panel accent" style={{ '--k': 'var(--green)' }}>
              <h3>Activity Codes</h3>
              <div className="psub">Live from code_master · view only (editing can come later)</div>
              {codesErr ? (
                <div className="state err">Failed to load: {codesErr}</div>
              ) : !codes ? (
                <div className="state">Loading codes…</div>
              ) : (
                <div className="matrix-scroll">
                  <table className="matrix">
                    <thead>
                      <tr><th>Code</th><th>Description</th><th>Category</th><th>NPT flag</th></tr>
                    </thead>
                    <tbody>
                      {codes.map((c) => (
                        <tr key={c.code}>
                          <td className="mono">{c.code}</td>
                          <td>{c.description}</td>
                          <td><span className={`catpill ${catClass(c.category)}`}>{c.category || '—'}</span></td>
                          <td><span className={`npt-flag ${c.is_npt ? 'yes' : 'no'}`}>{c.is_npt ? 'NPT' : 'no'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {codes ? <div className="setting-note">{codes.length} codes · {codes.filter((c) => c.is_npt).length} flagged non-productive.</div> : null}
            </div>
          )}

          {section === 'gto' && (
            <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
              <h3>GTO Uploads</h3>
              <div className="pending-gto">GTO upload — coming soon. Well/project data (block, well type, target/water depth) will be uploaded here in the GTO feature.</div>
            </div>
          )}

          {section === 'notifications' && (
            <div className="panel">
              <h3>Notifications</h3>
              <div className="psub">Daily summary email</div>

              <div className="setting-row">
                <div>
                  <div className="s-lbl">Daily summary email</div>
                  <div className="s-desc">Send the daily fleet summary automatically. UI only for now — sending is enabled with the email feature.</div>
                </div>
                <Switch on={dailyAlert} onChange={setDailyAlert} label="Toggle daily summary email" />
              </div>

              <div className="setting-row" style={{ borderBottom: 0, display: 'block' }}>
                <div className="s-lbl">Recipients</div>
                <div className="s-desc">Not persisted yet — wired to RESEND_TO when the daily email send is enabled.</div>
                <div className="chips" style={{ marginTop: 10 }}>
                  {recipients.length === 0 ? (
                    <span className="npt-empty" style={{ padding: 0 }}>No recipients configured.</span>
                  ) : (
                    recipients.map((e) => (
                      <span key={e} className="chip on">
                        {e}
                        <button type="button" className="x" onClick={() => setRecipients((r) => r.filter((x) => x !== e))}>×</button>
                      </span>
                    ))
                  )}
                </div>
                <div className="add-inline">
                  <input
                    type="email"
                    placeholder="add.recipient@jindalmumbai.com"
                    value={newRecipient}
                    onChange={(e) => setNewRecipient(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addRecipient() }}
                  />
                  <button type="button" className="btn" onClick={addRecipient}>Add recipient</button>
                </div>
              </div>
            </div>
          )}

          {!isSupabaseConfigured && section === 'codes' && (
            <div className="setting-note">Supabase not configured — Activity Codes needs .env.local VITE_ vars.</div>
          )}
        </div>
      </div>
    </div>
  )
}
