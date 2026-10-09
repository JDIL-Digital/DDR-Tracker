// WaterPanel — potable water MADE vs CONSUMED per day as a TWO-LINE trend (Made = blue,
// Consumed = amber) vs date. Same interaction pattern as the other time-series charts:
// responsive .scatter SVG, enlarged-only cursor-following tooltip (date · made · consumed ·
// net). Data from loadRigWaterDaily (days: [{date, made, consumed}]). Honest empty state
// when a rig has no potable-water data (e.g. a rig that receives but never "makes" water
// shows a flat Made=0 line — real, not hidden).
import { useRef, useState } from 'react'
import { fmt1, prettyDate } from './format'

export default function WaterPanel({ days, hasData, unit, enlarged }) {
  const pts = days || []
  const u = unit ? ` ${unit}` : ''
  const [tip, setTip] = useState(null)
  const wrapRef = useRef(null)
  const posFrom = (e) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 12, y: 12 }
    const TW = 220, TH = 100
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
  const maxV = n ? Math.max(...pts.flatMap((d) => [Number(d.made) || 0, Number(d.consumed) || 0]), 0) : 0
  const yMax = Math.max(Math.ceil(maxV / 10) * 10, 10)
  const W = 720, H = 320, P = { l: 46, r: 16, t: 14, b: 38 }
  const x = (i) => P.l + (i / denom) * (W - P.l - P.r)
  const y = (v) => (H - P.b) - ((Number(v) || 0) / yMax) * (H - P.t - P.b)
  const path = (key) => pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ')
  const yticks = 4
  const step = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Portable water</h3>
      <div className="psub">Made vs consumed per day · single rig{unit ? ` · ${unit}` : ''}</div>

      <div className="rtd-legend">
        <span className="rtd-key"><i style={{ background: 'var(--blue)' }} />Made</span>
        <span className="rtd-key"><i style={{ background: 'var(--amber)' }} />Consumed</span>
      </div>

      {!hasData || n === 0 ? (
        <div className="npt-empty">No potable-water data for this rig in the selected window.</div>
      ) : (
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
            {pts.map((d, i) => (i % step === 0 || i === n - 1) ? (
              <text key={`x${i}`} x={x(i)} y={H - P.b + 16} className="tick" textAnchor="middle">{prettyDate(d.date).replace(/ \d{4}$/, '')}</text>
            ) : null)}

            {/* consumed line (amber) under, made line (blue) over */}
            {n > 1 && <path d={path('consumed')} fill="none" stroke="var(--amber)" strokeWidth="2" />}
            {n > 1 && <path d={path('made')} fill="none" stroke="var(--blue)" strokeWidth="2" />}
            {/* points — both series carry the full day payload so hovering either shows the day */}
            {pts.map((d, i) => (
              <g key={`g${i}`}>
                <circle cx={x(i)} cy={y(d.consumed)} r="3.2" fill="var(--amber)" stroke="var(--card)" strokeWidth="1"
                  {...hoverProps({ date: d.date, made: d.made, consumed: d.consumed })} />
                <circle cx={x(i)} cy={y(d.made)} r="3.2" fill="var(--blue)" stroke="var(--card)" strokeWidth="1"
                  {...hoverProps({ date: d.date, made: d.made, consumed: d.consumed })} />
              </g>
            ))}
            <text x={14} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`} textAnchor="middle">{unit || 'vol'}</text>
          </svg>

          {enlarged && tip && (
            <div className="dvd-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
              <div className="tip-h">{prettyDate(tip.date)}</div>
              <div className="tip-meta">Made {fmt1(tip.made)}{u} · Consumed {fmt1(tip.consumed)}{u}</div>
              <div className="tip-reason">Net {fmt1((Number(tip.made) || 0) - (Number(tip.consumed) || 0))}{u}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
