import { useState } from 'react'
import './dashboard.css'
import ErrorBoundary from '../ErrorBoundary'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import FleetView from './FleetView'
import AnalyticsView from './AnalyticsView'
import ReportsView from './ReportsView'
import AssetsView from './AssetsView'
import SettingsView from './SettingsView'

// App shell: owns which page is active. Theme is now owned by App (so the login
// screen is themed too) and passed in; the sidebar switches pages while TopBar
// and the theme are shared across pages.
export default function Dashboard({ theme, onSetTheme, onToggleTheme }) {
  const [activeView, setActiveView] = useState('fleet') // 'fleet' | 'analytics' | 'reports' | 'assets' | 'settings'

  return (
    <div className="app">
      <Sidebar active={activeView} onNavigate={setActiveView} />
      <main className="main">
        <TopBar theme={theme} onToggleTheme={onToggleTheme} />
        {/* Per-view boundary: if one screen throws, the sidebar/topbar survive
            and switching views (resetKey) auto-clears the error. */}
        <ErrorBoundary level="panel" resetKey={activeView}>
          {activeView === 'analytics' ? (
            <AnalyticsView />
          ) : activeView === 'reports' ? (
            <ReportsView />
          ) : activeView === 'assets' ? (
            <AssetsView />
          ) : activeView === 'settings' ? (
            <SettingsView theme={theme} onSetTheme={onSetTheme} />
          ) : (
            <FleetView />
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
