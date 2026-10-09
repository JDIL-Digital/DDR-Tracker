// Fuel / diesel consumption — headline avg burn (KL/day) + avg rate (L/hr), then a
// per-day LINE trend of diesel KL. Same interaction pattern as Depth vs Days / the
// NODR-EBDR trends: responsive .scatter SVG, enlarged-only cursor-following tooltip
// (date · day's KL · that day's L/hr). Data from loadRigFuelDaily (trend: [{date, kl, lhr}]).
import { useRef, useState } from 'react'
import { fmt1, fmtKl, prettyDate } from './format'

export default function FuelConsumptionPanel({ avgDailyKl, avgLhr, trend, enlarged }) {
  const pts = trend || []
  const [tip, setTip] = useState(null)
  const wrapRef = useRef(null)
  const posFrom = (e) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 12, y: 12 }
    const TW = 220, TH = 90
    const cx = Number.isFinite(e.clientX) ? e.clientX : r.left + 48
    const cy = Number.isFinite(e.clientY) ? e.clientY : r.top + 48
    let x = cx - r.left + 14
    let y = cy - r.top + 14
    if (x + TW > r.width) x = (cx - r.left) - TW - 14
    if (y + TH > r.height) y = r.height - TH - 6
    return { x: Math.max(4, x), y: Math.max(4, y) }
  }
  const showTip = (p) => (e) => { if (enlarged) setTip({ ...p, ...posFrom(e) }) }
  const moveTip = (e) => { if (enlarged) setTip((t) => (t ? { ...t, ...posFrom(e) } : t)) }
  const hideTip = () => setTip(null)
  const hoverProps = (p) => (enlarged
    ? { onMouseEnter: showTip(p), onMouseMove: moveTip, onMouseLeave: hideTip, onClick: showTip(p), onFocus: showTip(p), onBlur: hideTip, tabIndex: 0, style: { cursor: 'pointer' } }
    : {})

  const n = pts.length
  const denom = Math.max(n - 1, 1)
  const maxKl = n ? Math.max(...pts.map((p) => Number(p.kl) || 0), 0) : 0
  const yMax = Math.max(Math.ceil(maxKl / 5) * 5, 5)
  const W = 720, H = 300, P = { l: 46, r: 16, t: 14, b: 38 }
  const x = (i) => P.l + (i / denom) * (W - P.l - P.r)
  const y = (v) => (H - P.b) - ((Number(v) || 0) / yMax) * (H - P.t - P.b)
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(p.kl).toFixed(1)}`).join(' ')
  const yticks = 4
  const step = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Fuel / diesel consumption</h3>
      <div className="psub">Average burn and per-day trend · selected window</div>

      <div className="npt-kpis">
        <div className="npt-kpi">
          <div className="npt-kpi-num mono">{fmtKl(avgDailyKl)}<small> KL/day</small></div>
          <div className="npt-kpi-lbl">Avg daily burn</div>
        </div>
        <div className="npt-kpi">
          <div className="npt-kpi-num mono">{fmt1(avgLhr)}<small> L/hr</small></div>
          <div className="npt-kpi-lbl">Avg consumption rate</div>
        </div>
      </div>

      {n === 0 ? (
        <div className="npt-empty">No fuel figures reported in this window.</div>
      ) : (
        <>
          <div className="scatter-wrap dvd-chart-wrap" ref={wrapRef}>
            <svg viewBox={`0 0 ${W} ${H}`} className="scatter depth-svg" preserveAspectRatio="xMidYMid meet">
              {Array.from({ length: yticks + 1 }).map((_, i) => {
                const v = (yMax * i) / yticks
                const yy = y(v)
                return (
                  <g key={`y${i}`}>
                    <line x1={P.l} y1={yy} x2={W - P.r} y2={yy} className="grid" />
                    <text x={P.l - 8} y={yy + 3} className="tick" textAnchor="end">{v}</text>
                  </g>
                )
              })}
              <line x1={P.l} y1={P.t} x2={P.l} y2={H - P.b} className="axis" />
              <line x1={P.l} y1={H - P.b} x2={W - P.r} y2={H - P.b} className="axis" />
              {pts.map((p, i) => (i % step === 0 || i === n - 1) ? (
                <text key={`x${i}`} x={x(i)} y={H - P.b + 16} className="tick" textAnchor="middle">{prettyDate(p.date).replace(/ \d{4}$/, '')}</text>
              ) : null)}

              {n > 1 && <path d={linePath} fill="none" stroke="var(--blue)" strokeWidth="2" />}
              {pts.map((p, i) => (
                <circle
                  key={`p${i}`} cx={x(i)} cy={y(p.kl)} r="3.4"
                  fill="var(--blue)" stroke="var(--card)" strokeWidth="1"
                  {...hoverProps({ date: p.date, kl: p.kl, lhr: p.lhr })}
                />
              ))}
              <text x={14} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`} textAnchor="middle">KL</text>
            </svg>

            {enlarged && tip && (
              <div className="dvd-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
                <div className="tip-h">{prettyDate(tip.date)} — {fmtKl(tip.kl)} KL</div>
                <div className="tip-meta">{tip.lhr != null ? `${fmt1(tip.lhr)} L/hr that day` : 'L/hr — no logged hours'}</div>
              </div>
            )}
          </div>

          <div className="ilt-legend depth-legend">
            <span><i className="ldot" style={{ background: 'var(--blue)' }} />Diesel KL / day</span>
          </div>
        </>
      )}
    </div>
  )
}
