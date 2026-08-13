// Shown to a logged-in Jindal user whose profile is NOT approved yet.
//   variant="pending"  -> awaiting admin approval (offers a "Check again")
//   variant="rejected" -> access denied
// Same branded shell as the login screen (photo bg + frosted card). No dashboard
// and no data are rendered behind it.
import { useState } from 'react'
import { useAuth } from './AuthProvider'

export default function AccessStatusScreen({ variant = 'pending', theme = 'dark', onToggleTheme = () => {} }) {
  const { signOut, refreshProfile, user } = useAuth()
  const [checking, setChecking] = useState(false)
  const isDark = theme === 'dark'
  const rejected = variant === 'rejected'

  const email = user?.email || ''

  async function checkAgain() {
    setChecking(true)
    try {
      await refreshProfile() // if now approved, the gate re-renders into the dashboard
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="login-wrap">
      <button
        type="button"
        className="login-theme-toggle"
        onClick={onToggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? (
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24">
            <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
          </svg>
        )}
      </button>

      <div className="login-card">
        <div className="logo-plate login-logo">
          <img className="logo-img" src="/Jindal%20Logo.jpg" alt="Jindal Drilling &amp; Industries Ltd." />
        </div>
        <div className="login-title">DDR Tracker</div>

        {rejected ? (
          <>
            <div className="login-sub">Access denied</div>
            <div className="login-error" role="alert" style={{ marginTop: 18 }}>
              Your access request was declined. If you believe this is a mistake, contact your
              administrator.
            </div>
          </>
        ) : (
          <>
            <div className="login-sub">Access pending approval</div>
            <div className="status-msg">
              Your account is awaiting admin approval. You'll get access once an administrator
              approves your request.
            </div>
            <button type="button" className="btn wide" onClick={checkAgain} disabled={checking}>
              {checking ? 'Checking…' : 'Check again'}
            </button>
          </>
        )}

        {email && <div className="login-foot">Signed in as <b>{email}</b></div>}

        <button type="button" className="linkbtn" onClick={signOut} style={{ marginTop: 12 }}>
          Sign out
        </button>
      </div>
    </div>
  )
}
