import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadAnalytics } from './analytics'
import { todayISO, prettyDate, shiftDate } from './format'
import { LoadError } from './LoadState'
import TimeWindowSelector from './TimeWindowSelector'
import RigCompareChips from './RigCompareChips'
import RopByRigChart from './RopByRigChart'
import NptByCausePanel from './NptByCausePanel'
import DieselVsDepthScatter from './DieselVsDepthScatter'
import FleetPerformanceMatrix from './FleetPerformanceMatrix'

function computeRange(mode, cs, ce) {
  const end = mode === 'custom' ? ce : todayISO()
  let start
  if (mode === '24h') start = shiftDate(end, -1)
  else if (mode === '7d') start = shiftDate(end, -7)
  else if (mode === 'custom') start = cs
  else start = shiftDate(end, -30) // 30d default
  return { start, end }
}

export default function AnalyticsView() {
  const [mode, setMode] = useState('30d') // default 30D so the sparse sample data is visible
  const [customStart, setCustomStart] = useState(shiftDate(todayISO(), -30))
  const [customEnd, setCustomEnd] = useState(todayISO())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)
  const [selected, setSelected] = useState(null) // Set<name> | null (null → all)

  const range = useMemo(() => computeRange(mode, customStart, customEnd), [mode, customStart, customEnd])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loadAnalytics(range.start, range.end)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range.start, range.end, reloadKey])

  // Initialize the compare selection to all rigs once, on first data load.
  useEffect(() => {
    if (data && selected === null) setSelected(new Set(data.rigs.map((r) => r.name)))
  }, [data, selected])

  const allNames = data ? data.rigs.map((r) => r.name) : []
  const sel = selected ?? new Set(allNames)
  const shown = data ? data.rigs.filter((r) => sel.has(r.name)) : []

  const toggle = (name) =>
    setSelected((prev) => {
      const base = prev ?? new Set(allNames)
      const next = new Set(base)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  // Derived views over the selected rigs
  const ropChart = shown.map((r) => ({ label: r.name, actual: r.avgRop, target: r.target }))
  const hasTarget = !!data?.hasPlanned && shown.some((r) => r.target != null)

  const nptMap = new Map()
  for (const r of shown) for (const c of r.nptCauses || []) nptMap.set(c.label, (nptMap.get(c.label) || 0) + c.hours)
  const nptItems = [...nptMap.entries()].map(([label, hours]) => ({ label, hours })).sort((a, b) => b.hours - a.hours)
  const nptTotal = nptItems.reduce((s, i) => s + i.hours, 0)

  const scatter = shown.flatMap((r) => (r.scatter || []).map((p) => ({ ...p, rig: r.name })))

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

  return (
    <div className="wrap">
      <div className="sec-h">
        <h2>Analytics — {prettyDate(range.start)} → {prettyDate(range.end)}</h2>
        <span className="hint">{loading ? 'Loading…' : 'Aggregated from submitted DDRs'}</span>
      </div>

      <div className="analytics-controls">
        <TimeWindowSelector
          mode={mode}
          onMode={setMode}
          customStart={customStart}
          customEnd={customEnd}
          onCustom={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
        />
        <RigCompareChips all={allNames} selected={sel} onToggle={toggle} />
      </div>

      {error ? (
        <LoadError message={error} onRetry={retry} />
      ) : !data ? (
        <div className="state">Loading analytics…</div>
      ) : (
        <>
          <div className="bottom">
            <RopByRigChart data={ropChart} hasTarget={hasTarget} />
            <NptByCausePanel total={nptTotal} items={nptItems} />
          </div>
          <div className="stack">
            <DieselVsDepthScatter points={scatter} />
            <FleetPerformanceMatrix rows={shown} />
          </div>
        </>
      )}
    </div>
  )
}
