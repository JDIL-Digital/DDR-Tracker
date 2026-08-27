import { useState } from 'react'
import './dashboard.css'
import ErrorBoundary from '../ErrorBoundary'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import FleetView from './FleetView'
import AnalyticsView from './AnalyticsView'
import ReportsView from './ReportsView'
import MaintenanceView from './MaintenanceView'
import OpexView from './OpexView'
import SettingsView from './SettingsView'

// App shell: owns which page is active. Theme is now owned by App (so the login
// screen is themed too) and passed in; the sidebar switches pages while TopBar
// and the theme are shared across pages.
export default function Dashboard({ theme, onSetTheme, onToggleTheme }) {
  const [activeView, setActiveView] = useState('fleet') // 'fleet' | 'analytics' | 'reports' | 'maintenance' | 'opex' | 'settings'
  const [highlightRig, setHighlightRig] = useState(null) // rig to highlight on Fleet (from search)
  const [codeFilter, setCodeFilter] = useState(null)     // activity code to filter in Settings (from search)

  // Sidebar / manual nav clears any search-driven highlight/filter.
  const navigate = (view) => {
    setHighlightRig(null)
    setCodeFilter(null)
    setActiveView(view)
  }

  // Top-bar search selections.
  const onSearchNavigate = (item) => {
    if (item.type === 'rig') { setCodeFilter(null); setHighlightRig(item.name); setActiveView('fleet') }
    else if (item.type === 'well') { setCodeFilter(null); setHighlightRig(item.rig); setActiveView('fleet') }
    else if (item.type === 'code') { setHighlightRig(null); setCodeFilter(item.code); setActiveView('settings') }
  }

  return (
    <div className="app">
      <Sidebar active={activeView} onNavigate={navigate} />
      <main className="main">
        <TopBar theme={theme} onToggleTheme={onToggleTheme} onSearchNavigate={onSearchNavigate} />
        {/* Per-view boundary: if one screen throws, the sidebar/topbar survive
            and switching views (resetKey) auto-clears the error. */}
        <ErrorBoundary level="panel" resetKey={activeView}>
          {activeView === 'analytics' ? (
            <AnalyticsView />
          ) : activeView === 'reports' ? (
            <ReportsView />
          ) : activeView === 'maintenance' ? (
            <MaintenanceView />
          ) : activeView === 'opex' ? (
            <OpexView />
          ) : activeView === 'settings' ? (
            <SettingsView theme={theme} onSetTheme={onSetTheme} codeFilter={codeFilter} onClearCodeFilter={() => setCodeFilter(null)} />
          ) : (
            <FleetView highlightRig={highlightRig} />
          )}
        </ErrorBoundary>
      </main>
    </div>
  )
}
