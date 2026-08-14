import { useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { loadReports } from './reports'
import { todayISO, prettyDate, shiftDate } from './format'
import { LoadError } from './LoadState'
import ReportPeriodSelector from './ReportPeriodSelector'
import RigCompareChips from './RigCompareChips'
import RopTrendChart from './RopTrendChart'
import TimeByCodePanel from './TimeByCodePanel'
import NptReportPanel from './NptReportPanel'
import EquipmentDowntimePanel from './EquipmentDowntimePanel'
import FuelConsumptionPanel from './FuelConsumptionPanel'

function computeRange(mode, cs, ce) {
  const end = mode === 'custom' ? ce : todayISO()
  let start
  if (mode === '7d') start = shiftDate(end, -7)
  else if (mode === '90d') start = shiftDate(end, -90)
  else if (mode === 'custom') start = cs
  else start = shiftDate(end, -30) // 30d default
  return { start, end }
}

export default function ReportsView() {
  const [mode, setMode] = useState('30d')
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
    loadReports(range.start, range.end)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range.start, range.end, reloadKey])

  useEffect(() => {
    if (data && selected === null) setSelected(new Set(data.rigList.map((r) => r.name)))
  }, [data, selected])

  const allNames = data ? data.rigList.map((r) => r.name) : []
  const sel = selected ?? new Set(allNames)
  const toggle = (name) =>
    setSelected((prev) => {
      const base = prev ?? new Set(allNames)
      const next = new Set(base)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  // Aggregate over the selected rigs
  const view = useMemo(() => {
    if (!data) return null
    const acts = data.acts.filter((a) => sel.has(a.rig))
    const reps = data.reps.filter((r) => sel.has(r.rig))

    // ROP trend — per date: drilling meterage / drilling hours
    const byDate = new Map()
    for (const a of acts) {
      if (!a.isDrilling || !a.date) continue
      const e = byDate.get(a.date) || { m: 0, h: 0 }
      e.m += a.meterage; e.h += a.hrs
      byDate.set(a.date, e)
    }
    const ropTrend = [...byDate.entries()]
      .map(([date, e]) => ({ date, rop: e.h > 0 && e.m > 0 ? e.m / e.h : null }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Time by code
    const codeMap = new Map()
    let totalHours = 0
    for (const a of acts) {
      totalHours += a.hrs
      const e = codeMap.get(a.code) || { code: a.code, description: a.description, category: a.category, hours: 0 }
      e.hours += a.hrs
      codeMap.set(a.code, e)
    }
    const timeByCode = [...codeMap.values()]
      .map((e) => ({ ...e, pct: totalHours > 0 ? (e.hours / totalHours) * 100 : 0 }))
      .sort((a, b) => b.hours - a.hours)

    // NPT
    const nptHours = acts.filter((a) => a.isNpt).reduce((s, a) => s + a.hrs, 0)
    const nptPct = totalHours > 0 ? (nptHours / totalHours) * 100 : null
    const causeMap = new Map()
    for (const a of acts) if (a.isNpt) causeMap.set(a.description, (causeMap.get(a.description) || 0) + a.hrs)
    const byCause = [...causeMap.entries()].map(([label, hours]) => ({ label, hours })).sort((a, b) => b.hours - a.hours)
    const rigNptMap = new Map()
    for (const a of acts) if (a.isNpt) rigNptMap.set(a.rig, (rigNptMap.get(a.rig) || 0) + a.hrs)
    const byRigNpt = [...rigNptMap.entries()].map(([label, hours]) => ({ label, hours })).sort((a, b) => b.hours - a.hours)

    // Equipment downtime
    const dtEvents = acts
      .filter((a) => a.isEquipment)
      .map((a) => ({ date: a.date, rig: a.rig, hrs: a.hrs, code: a.code, remark: a.remark }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const dtRigMap = new Map()
    for (const e of dtEvents) dtRigMap.set(e.rig, (dtRigMap.get(e.rig) || 0) + e.hrs)
    const dtByRig = [...dtRigMap.entries()].map(([rig, hours]) => ({ rig, hours })).sort((a, b) => b.hours - a.hours)

    // Fuel
    const fuelByDate = new Map()
    let totalFuel = 0
    let fuelHours = 0
    let fuelSeen = false
    for (const r of reps) {
      if (r.fuelKl != null) {
        totalFuel += r.fuelKl
        fuelSeen = true
        fuelByDate.set(r.date, (fuelByDate.get(r.date) || 0) + r.fuelKl)
      }
      fuelHours += r.hours
    }
    const fuelTrend = [...fuelByDate.entries()].map(([date, kl]) => ({ date, kl })).sort((a, b) => a.date.localeCompare(b.date))
    const avgDailyKl = fuelSeen && fuelByDate.size > 0 ? totalFuel / fuelByDate.size : null
    const avgLhr = fuelSeen && fuelHours > 0 ? (totalFuel * 1000) / fuelHours : null

    return { ropTrend, timeByCode, totalHours, nptHours, nptPct, byCause, byRigNpt, dtEvents, dtByRig, fuelTrend, avgDailyKl, avgLhr }
  }, [data, sel])

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
    <div className="wrap report">
      <div className="sec-h">
        <h2>Performance Report — {prettyDate(range.start)} → {prettyDate(range.end)}</h2>
        <span className="hint">{loading ? 'Loading…' : 'Compiled from submitted DDRs · per activity coding'}</span>
      </div>

      <div className="analytics-controls report-controls no-print">
        <ReportPeriodSelector
          mode={mode}
          onMode={setMode}
          customStart={customStart}
          customEnd={customEnd}
          onCustom={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
        />
        <RigCompareChips all={allNames} selected={sel} onToggle={toggle} />
        <button type="button" className="export-pdf" onClick={() => window.print()}>
          Export PDF
        </button>
      </div>

      {error ? (
        <LoadError message={error} onRetry={retry} />
      ) : !data || !view ? (
        <div className="state">Loading report…</div>
      ) : (
        <div className="stack report-stack">
          <RopTrendChart points={view.ropTrend} />
          <TimeByCodePanel rows={view.timeByCode} total={view.totalHours} />
          <NptReportPanel
            nptHours={view.nptHours}
            totalHours={view.totalHours}
            nptPct={view.nptPct}
            byCause={view.byCause}
            byRig={view.byRigNpt}
          />
          <EquipmentDowntimePanel byRig={view.dtByRig} events={view.dtEvents} codeLabels={data.equipCodeLabels} />
          <FuelConsumptionPanel avgDailyKl={view.avgDailyKl} avgLhr={view.avgLhr} trend={view.fuelTrend} />
        </div>
      )}
    </div>
  )
}
