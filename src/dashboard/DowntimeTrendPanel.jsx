// DowntimeTrendPanel — a per-day LINE trend of one downtime series (NODR or EBDR) for the
// selected rig over the window. Reuses the Depth-vs-Days interaction pattern exactly:
// responsive .scatter SVG, and an ENLARGED-ONLY tooltip (compact tile = plain points) that
// follows the cursor, clamps to the chart, and shows WHY — that day's activities by
// [code] remark — Xh. Data from loadRigTimeDistributionDaily (days[] with NODR/EBDR hours +
// nodrItems/ebdrItems). Honest empty state when the rig filed no DDRs in the window.
import { useMemo, useRef, useState } from 'react'
import { prettyDate } from './format'

const f1 = (n) => (n == null || Number.isNaN(n) ? '0' : Number(n).toFixed(1).replace(/\.0$/, ''))

export default function DowntimeTrendPanel({ title, subtitle, seriesKey, itemsKey, days, hasData, color, condLabel, enlarged }) {
  const pts = days || []
  const [tip, setTip] = useState(null)
  const wrapRef = useRef(null)

  const posFrom = (e) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 12, y: 12 }
    const TW = 260, TH = 150
    const cx = Number.isFinite(e.clientX) ? e.clientX : r.left + 48
    const cy = Number.isFinite(e.clientY) ? e.clientY : r.top + 48
    let x = cx - r.left + 14
    let y = cy - r.top + 14
    if (x + TW > r.width) x = (cx - r.left) - TW - 14
    if (y + TH > r.height) y = r.height - TH - 6
    return { x: Math.max(4, x), y: Math.max(4, y) }
  }
  const showTip = (payload) => (e) => { if (enlarged) setTip({ ...payload, ...posFrom(e) }) }
  const moveTip = (e) => { if (enlarged) setTip((t) => (t ? { ...t, ...posFrom(e) } : t)) }
  const hideTip = () => setTip(null)
  const hoverProps = (payload) => (enlarged
    ? { onMouseEnter: showTip(payload), onMouseMove: moveTip, onMouseLeave: hideTip, onClick: showTip(payload), onFocus: showTip(payload), onBlur: hideTip, tabIndex: 0, style: { cursor: 'pointer' } }
    : {})

  const chart = useMemo(() => {
    const vals = pts.map((d) => Number(d[seriesKey]) || 0)
    const max = vals.length ? Math.max(...vals, 0) : 0
    const yMax = Math.max(Math.ceil(max / 4) * 4, 4) // nice 4-hr steps, min 4
    const total = vals.reduce((s, v) => s + v, 0)
    return { yMax, total }
  }, [pts, seriesKey])

  const W = 720
  const H = 340
  const P = { l: 46, r: 16, t: 16, b: 40 }
  const n = pts.length
  const denom = Math.max(n - 1, 1)
  const x = (i) => P.l + (i / denom) * (W - P.l - P.r)
  const y = (h) => (H - P.b) - (h / chart.yMax) * (H - P.t - P.b) // ascending: 0 at bottom
  const linePath = pts.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)},${y(Number(d[seriesKey]) || 0).toFixed(1)}`).join(' ')

  const yticks = 4
  // thin x labels to ~6
  const step = Math.max(1, Math.ceil(n / 6))

  return (
    <div className="panel accent" style={{ '--k': color }}>
      <div className="sec-h" style={{ margin: '0 0 2px' }}>
        <h3>{title}</h3>
      </div>
      <div className="psub">{subtitle}</div>

      {!hasData || n === 0 ? (
        <div className="npt-empty">No DDRs for this rig in the selected window.</div>
      ) : (
        <>
          <div className="scatter-wrap dvd-chart-wrap" ref={wrapRef}>
            <svg viewBox={`0 0 ${W} ${H}`} className="scatter depth-svg" preserveAspectRatio="xMidYMid meet">
              {/* y grid + hour labels */}
              {Array.from({ length: yticks + 1 }).map((_, i) => {
                const v = (chart.yMax * i) / yticks
                const yy = y(v)
                return (
                  <g key={`y${i}`}>
                    <line x1={P.l} y1={yy} x2={W - P.r} y2={yy} className="grid" />
                    <text x={P.l - 8} y={yy + 3} className="tick" textAnchor="end">{v}</text>
                  </g>
                )
              })}
              {/* axes */}
              <line x1={P.l} y1={P.t} x2={P.l} y2={H - P.b} className="axis" />
              <line x1={P.l} y1={H - P.b} x2={W - P.r} y2={H - P.b} className="axis" />
              {/* x labels (dates, thinned) */}
              {pts.map((d, i) => (i % step === 0 || i === n - 1) ? (
                <text key={`x${i}`} x={x(i)} y={H - P.b + 16} className="tick" textAnchor="middle">{prettyDate(d.date).replace(/ \d{4}$/, '')}</text>
              ) : null)}

              {/* trend line */}
              {n > 1 && <path d={linePath} fill="none" stroke={color} strokeWidth="2" />}
              {/* points */}
              {pts.map((d, i) => {
                const hrs = Number(d[seriesKey]) || 0
                return (
                  <circle
                    key={`p${i}`} cx={x(i)} cy={y(hrs)} r="3.4"
                    fill={color} stroke="var(--card)" strokeWidth="1"
                    {...hoverProps({ date: d.date, hrs, items: d[itemsKey] || [] })}
                  />
                )
              })}

              <text x={14} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`} textAnchor="middle">Hours</text>
            </svg>

            {/* Enlarged-only tooltip: date + hours + the day's activities (why). */}
            {enlarged && tip && (
              <div className="dvd-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
                <div className="tip-h">{prettyDate(tip.date)} — {f1(tip.hrs)} h {condLabel}</div>
                {tip.items.length === 0 ? (
                  <div className="tip-reason">No {condLabel} activities this day.</div>
                ) : (
                  <ul className="dt-tip-list">
                    {tip.items.map((it, j) => (
                      <li key={j}>
                        <b>[{it.code ?? '—'}]</b> {it.remark || it.description || '(no remark)'} — {f1(it.hrs)}h
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="ilt-legend depth-legend">
            <span><i className="ldot" style={{ background: color }} />{condLabel} hours/day · {f1(chart.total)} h total</span>
          </div>
        </>
      )}
    </div>
  )
}
