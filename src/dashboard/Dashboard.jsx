import { useEffect, useState } from 'react'
import './dashboard.css'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadFleet } from './fleet'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import KpiCard from './KpiCard'
import RigCard from './RigCard'
import RopChart from './RopChart'
import NptByCause from './NptByCause'
import Footer from './Footer'

const todayISO = () => new Date().toISOString().slice(0, 10)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}
const fmtKl = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))
const fmtRop = (n) => (n == null ? '—' : Number(n).toFixed(1))
const fmtPct = (n) => (n == null ? '—' : String(Math.round(n)))

export default function Dashboard() {
  const [date, setDate] = useState(todayISO())
  const [view, setView] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadFleet(date)
      .then((v) => { if (!cancelled) setView(v) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const k = view?.kpis

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <TopBar />
        <div className="wrap">
          {!isSupabaseConfigured ? (
            <div className="state err">
              Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
              .env.local and restart the dev server.
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div className="kpis">
                <KpiCard
                  color="green"
                  label="Fleet avg ROP"
                  value={fmtRop(k?.avgRop)}
                  unit="m/hr"
                  foot={k && k.avgRop == null ? 'no drilling logged today' : 'across reporting rigs'}
                />
                <KpiCard
                  color="red"
                  label="Fleet non-productive time"
                  value={fmtPct(k?.nptPct)}
                  unit="%"
                  foot={k?.nptFoot}
                  footClass="down"
                />
                <KpiCard
                  color="amber"
                  label="Total diesel ROB"
                  value={fmtKl(k?.dieselRob)}
                  unit="KL"
                  foot={
                    k?.dieselConsumed != null ? (
                      <>
                        <span className="down">▼ {fmtKl(k.dieselConsumed)} KL</span> consumed today
                      </>
                    ) : (
                      'no fuel data'
                    )
                  }
                />
                <KpiCard
                  color="green"
                  label="Reports received"
                  value={k ? String(k.reportsReceived).padStart(2, '0') : '—'}
                  unit={k ? `/ ${String(k.fleetSize).padStart(2, '0')}` : ''}
                  foot={k ? `${k.awaiting} rig${k.awaiting === 1 ? '' : 's'} awaiting report` : ''}
                />
              </div>

              {/* Section header with date control */}
              <div className="sec-h">
                <h2>Fleet status — {prettyDate(date)}</h2>
                <div className="datectl">
                  <label htmlFor="datepick">Date</label>
                  <input id="datepick" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  <span className="hint">{loading ? 'Loading…' : 'Metrics from submitted DDRs only'}</span>
                </div>
              </div>

              {error ? (
                <div className="state err">Failed to load: {error}</div>
              ) : !view ? (
                <div className="state">Loading fleet…</div>
              ) : (
                <>
                  <div className="rigs">
                    {view.rigs.map((r) => (
                      <RigCard key={r.name} rig={r} />
                    ))}
                  </div>

                  <div className="bottom">
                    <RopChart data={view.ropChart} />
                    <NptByCause data={view.nptByCause} />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {view && !error ? <Footer counts={view.statusCounts} /> : null}
      </main>
    </div>
  )
}
