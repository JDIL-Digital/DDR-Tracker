// Login screen — shown whenever there is no valid Jindal session. Branded to
// match the dashboard (logo plate, app name, CSS variables) and works in both
// dark and light via the small toggle in the corner.
import { useAuth } from './AuthProvider'

// Official Google "G" mark for the sign-in button (standard sign-in affordance).
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0024 46z" />
      <path fill="#FBBC05" d="M11.69 28.18A13.2 13.2 0 0111 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 002 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.95 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  )
}

export default function LoginScreen({ theme = 'dark', onToggleTheme = () => {} }) {
  const { signInWithGoogle, accessDenied, configured, allowedDomain } = useAuth()
  const isDark = theme === 'dark'

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
        <div className="login-sub">Offshore Ops · Fleet Mission Control</div>

        {accessDenied && (
          <div className="login-error" role="alert">
            Access is restricted to {allowedDomain} accounts.
          </div>
        )}

        <button
          type="button"
          className="google-btn"
          onClick={signInWithGoogle}
          disabled={!configured}
        >
          <GoogleG />
          Sign in with Google
        </button>

        {!configured && (
          <div className="login-note">
            Supabase is not configured — check <code>.env.local</code> (VITE_ vars).
          </div>
        )}

        <div className="login-foot">
          Restricted to <b>@{allowedDomain}</b> accounts
        </div>
      </div>
    </div>
  )
}
