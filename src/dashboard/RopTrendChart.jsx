// ROP trend line chart (inline SVG). Points: [{date, rop}] sorted ascending.
// Honest empty state when there's no drilling-code activity in the window.
import { prettyDate } from './format'

export default function RopTrendChart({ points }) {
  const pts = (points || []).filter((p) => p.rop != null)

  const body =
    pts.length === 0 ? (
      <div className="npt-empty">No drilling-code activity in this window — ROP not applicable.</div>
    ) : (
      (() => {
        const W = 640
        const H = 190
        const padL = 44
        const padR = 14
        const padT = 12
        const padB = 30
        const iw = W - padL - padR
        const ih = H - padT - padB
        const max = Math.max(...pts.map((p) => p.rop))
        const yMax = max <= 0 ? 1 : max * 1.15
        const n = pts.length
        const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
        const y = (v) => padT + ih - (v / yMax) * ih
        const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rop).toFixed(1)}`).join(' ')
        const yTicks = [0, yMax / 2, yMax]
        return (
          <div className="scatter-wrap">
            <svg className="scatter" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line className="grid" x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} />
                  <text className="tick" x={padL - 6} y={y(t) + 3} textAnchor="end">{t.toFixed(1)}</text>
                </g>
              ))}
              <line className="axis" x1={padL} y1={padT} x2={padL} y2={padT + ih} />
              <line className="axis" x1={padL} y1={padT + ih} x2={W - padR} y2={padT + ih} />
              <path d={line} fill="none" stroke="var(--green)" strokeWidth="2" />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle className="pt" cx={x(i)} cy={y(p.rop)} r="3.5" style={{ fill: 'var(--green)' }} />
                  {(i === 0 || i === n - 1 || n <= 6) && (
                    <text className="tick" x={x(i)} y={padT + ih + 16} textAnchor="middle">
                      {prettyDate(p.date).replace(/ \d{4}$/, '')}
                    </text>
                  )}
                </g>
              ))}
              <text className="axlbl" x={12} y={padT + ih / 2} transform={`rotate(-90 12 ${padT + ih / 2})`} textAnchor="middle">m/hr</text>
            </svg>
          </div>
        )
      })()
    )

  return (
    <div className="panel accent" style={{ '--k': 'var(--green)' }}>
      <h3>ROP trend</h3>
      <div className="psub">Actual rate of penetration · m/hr · per report day · selected window</div>
      {body}
    </div>
  )
}
