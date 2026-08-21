import { useState } from 'react'
import { DASH } from './format'

// DepthVsDaysChart — Planned vs Actual depth-vs-days for one well.
//
// SCOPE: DRILLING CONTRACTOR only — the descent to TD (Rig Move + Drilling).
// The chart shows planned progress from surface to TD and STOPS at the TD point.
// Logging / PT / abandonment (3rd-party / testing, out of the drilling
// contractor's scope) are NOT charted — no flat tail out to total_planned_days.
// (The well-plan detail view still keeps the full plan incl. those phases / 181d.)
//
// PLANNED (grey): from the rig's VERIFIED well-plan depth points
// (depths_verified=true). Each verified point carries a per-phase day value (in
// cumulative_days) and a planned depth (m MDKB); we RUNNING-SUM the per-phase
// days to get each point's X (days from spud). The line ends at the last depth
// milestone (TD, ~day 68).
//
// ACTUAL (red): would come from DPRs (daily depth) + a spud/commenced date +
// current phase — fields that DON'T fully exist yet. So the actual line is shown
// as ABSENT, with an honest legend note. Nothing is fabricated.
//
// Y is a normal ascending axis (0 at bottom, deeper = higher), so the curve
// RISES as the well gets deeper (surface at bottom-left, TD near top-right).

const short = (name) => name.replace(/^Jindal\s+/i, '').replace(/-1$/, '')
const round0 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n))

// Build the planned breakpoints [{day, depth}] from verified points:
// prepend the (0,0) origin, running-sum the per-phase days, keep points that
// have a readable depth. The line ENDS at the last depth milestone (TD) — no
// flat tail (drilling-contractor scope: Rig Move + Drilling only).
function buildPlanned(plan) {
  const raw = Array.isArray(plan.points) ? plan.points : []
  let cum = 0
  const pts = raw.map((p) => {
    cum += Number(p.cumulative_days) || 0 // per-phase day value → running cumulative
    return {
      activity: p.activity || '—',
      depth: p.planned_depth_m == null ? null : Number(p.planned_depth_m),
      cumDay: cum,
      confidence: p.depth_confidence || null,
    }
  })
  const plotted = pts.filter((p) => p.depth != null && !Number.isNaN(p.depth))
  if (!plotted.length) return { pts, plotted: [], breakpoints: [], tdDepth: null, tdDay: 0 }

  const td = plotted[plotted.length - 1] // last depth milestone = TD
  const breakpoints = [{ day: 0, depth: 0 }, ...plotted.map((p) => ({ day: p.cumDay, depth: p.depth }))]

  return { pts, plotted, breakpoints, tdDepth: td.depth, tdDay: td.cumDay }
}

// Linear-interpolate planned depth at an arbitrary day from the breakpoints.
function depthAtDay(breakpoints, d) {
  if (!breakpoints.length) return null
  const last = breakpoints[breakpoints.length - 1]
  if (d >= last.day) return last.depth
  for (let i = 1; i < breakpoints.length; i++) {
    const a = breakpoints[i - 1]
    const b = breakpoints[i]
    if (d <= b.day) {
      if (b.day === a.day) return b.depth
      const t = (d - a.day) / (b.day - a.day)
      return a.depth + t * (b.depth - a.depth)
    }
  }
  return last.depth
}

// Ordered phase list for the day-by-day table — drilling-scope only: the
// verified depth-point phases (Rig Move + Drilling to TD). Each entry ends at
// `untilDay`; a day belongs to the first entry whose untilDay >= d. Logging/PT/
// abandonment are out of scope and deliberately excluded.
function buildPhases(plotted) {
  return plotted.map((p) => ({ untilDay: p.cumDay, label: p.activity })).sort((a, b) => a.untilDay - b.untilDay)
}
function phaseForDay(phases, d) {
  for (const ph of phases) if (d <= ph.untilDay) return ph.label
  return phases.length ? phases[phases.length - 1].label : DASH
}

function PlanBody({ plan }) {
  const { plotted, breakpoints, tdDepth, tdDay } = buildPlanned(plan)

  if (!plotted.length) {
    return <div className="npt-empty">The verified plan has no readable planned depths to chart.</div>
  }

  const W = 680
  const H = 340
  const P = { l: 54, r: 16, t: 16, b: 44 }
  // X ends at TD day with a small headroom (drilling scope — NOT total planned days).
  const xMax = Math.max(tdDay + Math.max(3, Math.ceil(tdDay * 0.05)), 1)
  const yMaxRaw = Math.max(...plotted.map((p) => p.depth), plan.targetDepthM || 0, 1)
  const yMax = Math.ceil(yMaxRaw / 500) * 500 // nice round depth axis

  const x = (day) => P.l + (day / xMax) * (W - P.l - P.r)
  const y = (depth) => (H - P.b) - (depth / yMax) * (H - P.t - P.b) // normal axis: 0 at bottom, deeper = higher

  const linePath = breakpoints.map((b, i) => `${i === 0 ? 'M' : 'L'} ${x(b.day).toFixed(1)},${y(b.depth).toFixed(1)}`).join(' ')

  const yticks = 5
  const xticks = 6

  // Day-by-day table rows — drilling scope only (day 1..TD day).
  const phases = buildPhases(plotted)
  const nDays = Math.max(1, Math.round(tdDay))
  const rows = Array.from({ length: nDays }, (_, i) => {
    const d = i + 1
    return {
      day: d,
      activity: phaseForDay(phases, d),
      plannedDepth: round0(depthAtDay(breakpoints, d)),
    }
  })

  return (
    <>
      <div className="depth-caption">
        Well <b>{plan.wellName || '—'}</b> · target depth{' '}
        <b>{plan.targetDepthM != null ? `${round0(plan.targetDepthM)} m` : '—'}</b>{' '}
        · planned drilling to TD <b>{round0(tdDepth)} m MDKB</b> in{' '}
        <b>~{round0(tdDay)} days</b> (Rig Move + Drilling)
      </div>

      <div className="scatter-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="scatter depth-svg" preserveAspectRatio="xMidYMid meet">
          {/* y grid + depth labels */}
          {Array.from({ length: yticks + 1 }).map((_, i) => {
            const v = (yMax * i) / yticks
            const yy = y(v)
            return (
              <g key={`y${i}`}>
                <line x1={P.l} y1={yy} x2={W - P.r} y2={yy} className="grid" />
                <text x={P.l - 8} y={yy + 3} className="tick" textAnchor="end">{round0(v)}</text>
              </g>
            )
          })}
          {/* axes */}
          <line x1={P.l} y1={P.t} x2={P.l} y2={H - P.b} className="axis" />
          <line x1={P.l} y1={H - P.b} x2={W - P.r} y2={H - P.b} className="axis" />
          {/* x labels (days) */}
          {Array.from({ length: xticks + 1 }).map((_, i) => {
            const dv = (xMax * i) / xticks
            return <text key={`x${i}`} x={x(dv)} y={H - P.b + 16} className="tick" textAnchor="middle">{round0(dv)}</text>
          })}
          {/* planned line (grey) */}
          <path d={linePath} fill="none" className="depth-planned-line" />
          {/* planned milestone points with tooltips */}
          {plotted.map((p, i) => (
            <circle key={i} cx={x(p.cumDay)} cy={y(p.depth)} r="3.6" className="depth-planned-dot">
              <title>{`${p.activity}\n${round0(p.depth)} m MDKB · day ${round0(p.cumDay)}${p.confidence ? ` · ${p.confidence} conf` : ''}`}</title>
            </circle>
          ))}
          {/* axis labels */}
          <text x={16} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 16 ${(P.t + H - P.b) / 2})`} textAnchor="middle">Depth (m MDKB)</text>
          <text x={(P.l + W - P.r) / 2} y={H - 6} className="axlbl" textAnchor="middle">Days from spud</text>
        </svg>
      </div>

      <div className="ilt-legend depth-legend">
        <span><i className="ldot" style={{ background: 'var(--dim)' }} />Planned (verified)</span>
        <span><i className="ldot" style={{ background: 'var(--red-solid)' }} />Actual — awaiting DPRs (needs spud date + daily depth)</span>
      </div>

      <div className="eyebrow" style={{ margin: '16px 0 6px' }}>Day-by-day (planned vs actual)</div>
      <div className="depth-table-scroll matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="num">Day</th>
              <th>Planned activity</th>
              <th className="num">Planned depth (m)</th>
              <th>Actual date</th>
              <th className="num">Actual depth (m)</th>
              <th className="num">Daily progress (m)</th>
              <th className="num">Cum NPT (hrs)</th>
              <th className="num">Variance (m)</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.day}>
                <td className="num mono">{r.day}</td>
                <td>{r.activity}</td>
                <td className="num mono">{r.plannedDepth != null ? r.plannedDepth : DASH}</td>
                <td className="mono">{DASH}</td>
                <td className="num mono">{DASH}</td>
                <td className="num mono">{DASH}</td>
                <td className="num mono">{DASH}</td>
                <td className="num mono">{DASH}</td>
                <td>{DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="setting-note">
        Actual columns populate once DPRs carry a <b>spud/commenced date</b> and <b>daily depth</b> for
        this well. Until then they stay <span className="mono">{DASH}</span> — no values are invented.
      </div>
    </>
  )
}

export default function DepthVsDaysChart({ rigs = [] }) {
  const withPlan = rigs.filter((r) => r.depthPlan)
  const [rigName, setRigName] = useState(() => withPlan[0]?.name || rigs[0]?.name || '')
  const rig = rigs.find((r) => r.name === rigName) || rigs[0] || null

  let body
  if (!rig) {
    body = <div className="npt-empty">No rigs available.</div>
  } else if (rig.depthPlan) {
    body = <PlanBody plan={rig.depthPlan} />
  } else if (rig.hasAnyPlan) {
    body = <div className="pending-gto">Depths pending verification — an admin must verify the planned depths in Settings → Well Plans before this chart can use them.</div>
  } else {
    body = <div className="npt-empty">No verified well plan for this rig.</div>
  }

  return (
    <div className="panel">
      <div className="sec-h" style={{ margin: '0 0 4px' }}>
        <h3>Depth vs Days (Planned vs Actual)</h3>
        {rigs.length > 0 && (
          <select className="depth-rig-picker" value={rig?.name || ''} onChange={(e) => setRigName(e.target.value)} aria-label="Select rig">
            {rigs.map((r) => (
              <option key={r.name} value={r.name}>{short(r.name)}{r.depthPlan ? ' ✓' : ''}</option>
            ))}
          </select>
        )}
      </div>
      <div className="psub">Planned drilling to TD (Rig Move + Drilling) · m MDKB vs days · from the verified well plan</div>
      {body}
    </div>
  )
}
