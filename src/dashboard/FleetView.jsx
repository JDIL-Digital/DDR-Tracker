import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadFleet } from './fleet'
import { todayISO, fmt1, fmtKl, DASH } from './format'
import { LoadError } from './LoadState'
import KpiCard from './KpiCard'
import RigCard from './RigCard'
import DowntimeChart from './DowntimeChart'
import NptByCause from './NptByCause'
import Footer from './Footer'

// Which monthly metric the rig cards are ranked by (click a KPI to toggle).
const RANK = {
  odr: { key: 'odrHrs', label: 'Total ODR' },
  nodr: { key: 'nodrHrs', label: 'Total NODR' },
  ebdr: { key: 'ebdrHrs', label: 'Total EBDR' },
  diesel: { key: 'dieselRob', label: 'Total Diesel ROB' },
}

export default function FleetView() {
  const [date, setDate] = useState(todayISO())
  const [view, setView] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)

  // Active ranking metric: null | 'odr' | 'nodr' | 'ebdr' | 'diesel'.
  const [rankBy, setRankBy] = useState(null)
  const toggleRank = (m) => setRankBy((cur) => (cur === m ? null : m))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadFleet(date)
      .then((v) => { if (!cancelled) setView(v) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date, reloadKey])

  const k = view?.kpis

  // Rig cards, optionally ranked by the active metric (highest first; missing → last).
  const rigsToShow = useMemo(() => {
    const base = view?.rigs || []
    if (!rankBy) return base
    const key = RANK[rankBy].key
    return [...base].sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))
  }, [view, rankBy])

  if (!isSupabaseConfigured) {
    return (
      <div className="wrap">
        <div className="state err">
          Supabase is not configured. Fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
          .env.local and restart the dev server.
        </div>
      </div>
    )
  }

  const hrsVal = (n) => (k?.monthHasData ? fmt1(n) : DASH)

  return (
    <>
      <div className="wrap">
        <div className="kpis kpis-5">
          <KpiCard
            color="green"
            label="Total ODR"
            value={hrsVal(k?.totalOdr)}
            unit="hrs"
            foot={k ? `${k.monthLabel} · on day rate` : ''}
            onClick={() => toggleRank('odr')}
            active={rankBy === 'odr'}
          />
          <KpiCard
            color="amber"
            label="Total NODR"
            value={hrsVal(k?.totalNodr)}
            unit="hrs"
            foot={k ? `${k.monthLabel} · non-operating` : ''}
            onClick={() => toggleRank('nodr')}
            active={rankBy === 'nodr'}
          />
          <KpiCard
            color="red"
            label="Total EBDR"
            value={hrsVal(k?.totalEbdr)}
            unit="hrs"
            foot={k ? `${k.monthLabel} · downtime (NPT)` : ''}
            footClass="down"
            onClick={() => toggleRank('ebdr')}
            active={rankBy === 'ebdr'}
          />
          <KpiCard
            color="amber"
            label="Total Diesel ROB"
            value={fmtKl(k?.dieselRob)}
            unit="KL"
            foot={
              k?.dieselConsumed != null ? (
                <><span className="down">▼ {fmtKl(k.dieselConsumed)} KL</span> consumed</>
              ) : (
                'latest fuel figure'
              )
            }
            onClick={() => toggleRank('diesel')}
            active={rankBy === 'diesel'}
          />
          <KpiCard
            color="green"
            label="Reports received"
            value={k ? String(k.reportsReceived).padStart(2, '0') : '—'}
            unit={k ? `/ ${String(k.fleetSize).padStart(2, '0')}` : ''}
            foot={k ? 'selected date' : ''}
          />
        </div>

        <div className="sec-h">
          <span className="rank-note">
            {rankBy && k ? `Ranked by ${RANK[rankBy].label} · ${k.monthLabel} (highest first)` : ''}
          </span>
          <div className="datectl">
            <label htmlFor="datepick">Date</label>
            <input id="datepick" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <span className="hint">{loading ? 'Loading…' : 'Metrics from submitted DDRs only'}</span>
          </div>
        </div>

        {error ? (
          <LoadError message={error} onRetry={retry} />
        ) : !view ? (
          <div className="state">Loading fleet…</div>
        ) : (
          <>
            <div className="rigs">
              {rigsToShow.map((r) => (
                <RigCard key={r.name} rig={r} />
              ))}
            </div>
            <div className="bottom">
              <DowntimeChart data={view.downtimeChart} hasData={view.downtimeHasData} />
              <NptByCause data={view.nptByCause} />
            </div>
          </>
        )}
      </div>

      {view && !error ? <Footer counts={view.statusCounts} /> : null}
    </>
  )
}
