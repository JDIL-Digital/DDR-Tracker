import { useEffect, useState } from 'react'
import './dashboard/dashboard.css'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import LoginScreen from './auth/LoginScreen'
import Dashboard from './dashboard/Dashboard'

// Loading state shown while the session is being checked, so already-logged-in
// users don't see a flash of the login screen on refresh.
function AuthSplash() {
  return (
    <div className="auth-splash">
      <div className="spinner" />
      <div className="msg">Checking your session…</div>
    </div>
  )
}

// Decides what to render based on auth state:
//   loading            -> splash
//   no valid session   -> login
//   Jindal session     -> dashboard
function Gate({ theme, onSetTheme, onToggleTheme }) {
  const { loading, user } = useAuth()
  if (loading) return <AuthSplash />
  if (!user) return <LoginScreen theme={theme} onToggleTheme={onToggleTheme} />
  return <Dashboard theme={theme} onSetTheme={onSetTheme} onToggleTheme={onToggleTheme} />
}

// App owns the theme now (was Dashboard), so the login screen and splash are
// themed too. Default DARK; session-only (no storage).
function App() {
  const [theme, setTheme] = useState('dark')

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
