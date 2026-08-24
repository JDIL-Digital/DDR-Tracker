import { useAuth } from '../auth/AuthProvider'

// Two-letter initials from a display name (falls back to the email local-part).
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Sidebar — brand, nav, user. The nav items switch the active page; the user
// block shows the signed-in Google account and a sign-out action.
export default function Sidebar({ active = 'fleet', onNavigate = () => {} }) {
  const { user, signOut } = useAuth()
  const meta = user?.user_metadata || {}
  const email = user?.email || ''
  const fullName = meta.full_name || meta.name || email.split('@')[0] || 'Signed in'
  const initials = initialsOf(meta.full_name || meta.name || email)

  const nav = (view) => (e) => {
    e.preventDefault()
    onNavigate(view)
  }
  return (
    <aside className="side">
      <div className="brand">
        {/* Logo plate: fixed white backing so the official Jindal logo (an
            opaque JPG on white) renders cleanly in both dark and light modes.
            The logo image itself is unaltered. */}
        <div className="logo-plate">
          <img className="logo-img" src="/Jindal%20Logo.jpg" alt="Jindal Drilling &amp; Industries Ltd." />
        </div>
        <div className="app-name wordmark">JDIL ORBIT</div>
      </div>
      <nav className="nav">
        <a className={active === 'fleet' ? 'on' : ''} href="#" onClick={nav('fleet')}>
          <svg viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Fleet
        </a>
        <a className={active === 'analytics' ? 'on' : ''} href="#" onClick={nav('analytics')}>
          <svg viewBox="0 0 24 24"><path d="M3 3v18h18M18.7 8l-5.1 5.2-2.8-2.8L7 14.3" /></svg>
          Analytics
        </a>
        <a className={active === 'reports' ? 'on' : ''} href="#" onClick={nav('reports')}>
          <svg viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6L19 8.4V19a2 2 0 01-2 2z" /></svg>
          Reports
        </a>
        <a className={active === 'maintenance' ? 'on' : ''} href="#" onClick={nav('maintenance')}>
          <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z" /></svg>
          Maintenance
        </a>
        <a className={active === 'settings' ? 'on' : ''} href="#" onClick={nav('settings')}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 007 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15H4.5a2 2 0 110-4h.09A1.65 1.65 0 006 8.6l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 0011 4.6V4.5a2 2 0 114 0v.09a1.65 1.65 0 001.17 2.82l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9H21a2 2 0 110 4h-.09z" /></svg>
          Settings
        </a>
      </nav>
      <div className="user">
        <div className="av">{initials}</div>
        <div className="u-info">
          <div className="nm" title={fullName}>{fullName}</div>
          <div className="rl" title={email}>{email}</div>
        </div>
        <button
          type="button"
          className="signout"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
        </button>
      </div>
    </aside>
  )
}
