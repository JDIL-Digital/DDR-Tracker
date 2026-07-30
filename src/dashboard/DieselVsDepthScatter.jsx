// DieselVsDepthScatter — fuel burn (L/hr) vs depth (m), one dot per report.
export default function DieselVsDepthScatter({ points }) {
  const W = 620
  const H = 240
  const P = { l: 52, r: 16, t: 14, b: 40 }

  const has = points.length > 0
  const xs = points.map((p) => p.depth)
  const ys = points.map((p) => p.lhr)
  let minX = has ? Math.min(...xs) : 0
  let maxX = has ? Math.max(...xs) : 1
  let minY = 0
  let maxY = has ? Math.max(...ys) : 1
  // pad domains so single points aren't on the edge
  if (minX === maxX) { minX -= 100; maxX += 100 }
  if (maxY === minY) maxY += 1
  maxX = maxX + (maxX - minX) * 0.08
  maxY = maxY * 1.15

  const px = (x) => P.l + ((x - minX) / (maxX - minX)) * (W - P.l - P.r)
  const py = (y) => H - P.b - ((y - minY) / (maxY - minY)) * (H - P.t - P.b)

  const xticks = 4
  const yticks = 4

  return (
    <div className="panel">
      <h3>Diesel burn vs depth</h3>
      <div className="psub">Fuel consumption rate (L/hr) against measured depth (m) · one point per report</div>
      {!has ? (
        <div className="npt-empty">No fuel/depth data in this window for the selected rigs.</div>
      ) : (
        <div className="scatter-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="scatter" preserveAspectRatio="xMidYMid meet">
            {/* axes */}
            <line x1={P.l} y1={P.t} x2={P.l} y2={H - P.b} className="axis" />
            <line x1={P.l} y1={H - P.b} x2={W - P.r} y2={H - P.b} className="axis" />
            {/* y grid + labels */}
            {Array.from({ length: yticks + 1 }).map((_, i) => {
              const v = minY + ((maxY - minY) * i) / yticks
              const y = py(v)
              return (
                <g key={`y${i}`}>
                  <line x1={P.l} y1={y} x2={W - P.r} y2={y} className="grid" />
                  <text x={P.l - 8} y={y + 3} className="tick" textAnchor="end">{Math.round(v)}</text>
                </g>
              )
            })}
            {/* x labels */}
            {Array.from({ length: xticks + 1 }).map((_, i) => {
              const v = minX + ((maxX - minX) * i) / xticks
              const x = px(v)
              return (
                <text key={`x${i}`} x={x} y={H - P.b + 16} className="tick" textAnchor="middle">{Math.round(v)}</text>
              )
            })}
            {/* points */}
            {points.map((p, i) => (
              <circle key={i} cx={px(p.depth)} cy={py(p.lhr)} r="5" className="pt">
                <title>{`${p.rig}: ${Math.round(p.lhr)} L/hr @ ${Math.round(p.depth)} m`}</title>
              </circle>
            ))}
            <text x={(P.l + W - P.r) / 2} y={H - 6} className="axlbl" textAnchor="middle">Depth (m)</text>
            <text x={14} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`} textAnchor="middle">L/hr</text>
          </svg>
        </div>
      )}
    </div>
  )
}
