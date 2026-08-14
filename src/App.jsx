import { useEffect, useState } from 'react'
import './dashboard/dashboard.css'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import LoginScreen from './auth/LoginScreen'
import AccessStatusScreen from './auth/AccessStatusScreen'
import Dashboard from './dashboard/Dashboard'

// Loading state shown while the session/profile is being checked, so
// already-logged-in users don't see a flash of the login or pending screen.
function AuthSplash({ label = 'Checking your session…' }) {
  return (
    <div className="auth-splash">
      <div className="spinner" />
      <div className="msg">{label}</div>
    </div>
  )
}

// Decides what to render based on auth + approval state:
//   session loading        -> splash
//   no valid session       -> login
//   Jindal session, profile loading -> splash
//   profile status:
//     approved             -> dashboard
//     pending              -> "awaiting approval" screen
//     rejected             -> "access denied" screen
function Gate({ theme, onSetTheme, onToggleTheme }) {
  const { loading, user, profileReady, profileStatus } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <LoginScreen theme={theme} onToggleTheme={onToggleTheme} />
  if (!profileReady) return <AuthSplash label="Checking access…" />
  if (profileStatus === 'approved') {
    return <Dashboard theme={theme} onSetTheme={onSetTheme} onToggleTheme={onToggleTheme} />
  }
  return (
    <AccessStatusScreen
      variant={profileStatus === 'rejected' ? 'rejected' : 'pending'}
      theme={theme}
      onToggleTheme={onToggleTheme}
    />
  )
}

// App owns the theme now (was Dashboard), so the login screen and splash are
// themed too. Default LIGHT for every user/session; the top-bar toggle still
// lets a user switch to dark during their session (session-only, no storage).
function App() {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <AuthProvider>
      <Gate theme={theme} onSetTheme={setTheme} onToggleTheme={toggleTheme} />
    </AuthProvider>
  )
}

export default App
