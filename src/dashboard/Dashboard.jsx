import { useEffect, useState } from 'react'
import './dashboard.css'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import FleetView from './FleetView'
import AnalyticsView from './AnalyticsView'
import ReportsView from './ReportsView'

// App shell: owns theme + which page is active. The sidebar switches pages;
// TopBar (with the light/dark toggle) and the theme are shared across pages.
export default function Dashboard() {
  const [theme, setTheme] = useState('dark') // default DARK; session-only (no storage)
  const [activeView, setActiveView] = useState('fleet') // 'fleet' | 'analytics' | 'reports'

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <Sidebar active={activeView} onNavigate={setActiveView} />
      <main className="main">
        <TopBar theme={theme} onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
        {activeView === 'analytics' ? <AnalyticsView /> : activeView === 'reports' ? <ReportsView /> : <FleetView />}
      </main>
    </div>
  )
}
