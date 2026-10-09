// Analytics tab — SINGLE-RIG view. One rig at a time (dropdown, default = first by
// sort_order) over a chosen time window (24H / 7D / 30D / Custom). Panels show the
// selected rig's trends over the window:
//   • Depth vs Days (current well: depth curve + NPT markers + casing, DepthVsDaysPanel)
//   • NODR trend + EBDR trend (daily downtime lines w/ per-day activity tooltips)
//   • Diesel consumption (FuelConsumptionPanel, reused)
//   • Portable Water (made vs consumed, WaterPanel)
//   • Well & Location (WellLocationPanel, from the latest DDR in the window)
// Every panel is wrapped in <Expandable> (click to enlarge). READ-ONLY; nothing is
// invented — absent data shows honest empty states.
import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadRigsForPicker } from './settings'
import { loadRigTimeDistributionDaily, loadRigFuelDaily, loadRigWellLocation, loadRigWaterDaily, loadRigDepthSeries } from './ddrFleet'
import { todayISO, prettyDate, shiftDate } from './format'
import { LoadError } from './LoadState'
import TimeWindowSelector from './TimeWindowSelector'
import Expandable from './Expandable'
import FuelConsumptionPanel from './FuelConsumptionPanel'
import DowntimeTrendPanel from './DowntimeTrendPanel'
import WellLocationPanel from './WellLocationPanel'
import WaterPanel from './WaterPanel'
import DepthVsDaysPanel from './DepthVsDaysPanel'

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
  const [mode, setMode] = useState('30d') // default 30D so sparse sample data is visible
  const [customStart, setCustomStart] = useState(shiftDate(todayISO(), -30))
  const [customEnd, setCustomEnd] = useState(todayISO())
  const [rigs, setRigs] = useState([])
  const [rigId, setRigId] = useState('')
  const [data, setData] = useState(null) // { fuel, dist, well }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)

  const range = useMemo(() => computeRange(mode, customStart, customEnd), [mode, customStart, customEnd])

  // Load the rig list once; default to the first rig (sort_order).
  useEffect(() => {
    loadRigsForPicker()
      .then((r) => { setRigs(r); setRigId((cur) => cur || (r[0]?.id ?? '')) })
      .catch((e) => setError(e.message))
  }, [])

  // Reload the selected rig's data whenever rig / window changes.
  useEffect(() => {
    if (!rigId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      loadRigFuelDaily(rigId, range.start, range.end),
      loadRigTimeDistributionDaily(rigId, range.start, range.end),
      loadRigWellLocation(rigId, range.start, range.end),
      loadRigWaterDaily(rigId, range.start, range.end),
      loadRigDepthSeries(rigId), // current well's depth curve + NPT + casing — not window-scoped
    ])
      .then(([fuel, dist, well, water, depth]) => { if (!cancelled) setData({ fuel, dist, well, water, depth }) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rigId, range.start, range.end, reloadKey])

  const rigName = rigs.find((r) => r.id === rigId)?.name || 'Selected rig'

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
    <div className="wrap analytics-wrap">
      <div className="sec-h">
        <h2>Analytics — {rigName} · {prettyDate(range.start)} → {prettyDate(range.end)}</h2>
        <span className="hint">{loading ? 'Loading…' : 'Per-rig trends from submitted DDRs'}</span>
      </div>

      <div className="analytics-controls">
        <label className="das-field">
          <span>Rig</span>
          <select value={rigId} onChange={(e) => setRigId(e.target.value)}>
            {rigs.length === 0 && <option value="">—</option>}
            {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <TimeWindowSelector
          mode={mode}
          onMode={setMode}
          customStart={customStart}
          customEnd={customEnd}
          onCustom={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
        />
      </div>

      {error ? (
        <LoadError message={error} onRetry={retry} />
      ) : (
        // 3-per-row grid (collapses to 2 then 1 as the viewport narrows).
        // Order L→R, top→bottom:
        //   Row 1: Depth vs Days | NODR trend | EBDR trend
        //   Row 2: Diesel Consumption | Portable Water | Well & Location
        <div className="analytics-grid">
          <Expandable>
            <DepthVsDaysPanel rigName={rigName} data={data?.depth} loading={loading} />
          </Expandable>

          <Expandable>
            <DowntimeTrendPanel
              title="NODR Trend"
              subtitle="Daily non-operating hours · hover a point for that day's causes"
              seriesKey="NODR"
              itemsKey="nodrItems"
              condLabel="NODR"
              color="var(--amber)"
              days={data?.dist?.days ?? []}
              hasData={data?.dist?.hasData ?? false}
            />
          </Expandable>

          <Expandable>
            <DowntimeTrendPanel
              title="EBDR Trend"
              subtitle="Daily equipment-breakdown hours · hover a point for that day's causes"
              seriesKey="EBDR"
              itemsKey="ebdrItems"
              condLabel="EBDR"
              color="var(--red-solid)"
              days={data?.dist?.days ?? []}
              hasData={data?.dist?.hasData ?? false}
            />
          </Expandable>

          <Expandable>
            <FuelConsumptionPanel
              avgDailyKl={data?.fuel?.avgDailyKl ?? null}
              avgLhr={data?.fuel?.avgLhr ?? null}
              trend={data?.fuel?.trend ?? []}
            />
          </Expandable>

          <Expandable>
            <WaterPanel
              days={data?.water?.days ?? []}
              hasData={data?.water?.hasData ?? false}
              unit={data?.water?.unit ?? null}
            />
          </Expandable>

          <Expandable>
            <WellLocationPanel rigName={rigName} data={data?.well} loading={loading} />
          </Expandable>
        </div>
      )}
    </div>
  )
}
