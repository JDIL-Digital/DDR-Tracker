// ILTTrendChart — daily Invisible Lost Time (ILT) per selected rig, one colored
// line each. ILT = sum of max(0, actual_hrs - benchmark_norm) over benchmarked
// activities (computed in analytics.js). Honest empty state when there's no
// benchmarked activity yet.
const short = (name) => name.replace(/^Jindal\s+/i, '').replace(/-1$/, '')
const shortDate = (iso) => {
  const [, m, d] = String(iso).split('-').map(Number)
  return `${d}/${m}`
}

export default function ILTTrendChart({ series }) {
  const withPoints = (series || []).filter((s) => s.points && s.points.length > 0)
  const allDates = [...new Set(withPoints.flatMap((s) => s.points.map((p) => p.date)))].sort((a, b) => a.localeCompare(b))
  const hasData = allDates.length > 0

  const W = 620
  const H = 250
  const P = { l: 46, r: 14, t: 14, b: 46 }
  const xIndex = new Map(allDates.map((d, i) => [d, i]))
  const maxY = Math.max(1, ...withPoints.flatMap((s) => s.points.map((p) => p.hours)))

  const px = (date) =>
    allDates.length === 1
      ? (P.l + W - P.r) / 2
      : P.l + (xIndex.get(date) / (allDates.length - 1)) * (W - P.l - P.r)
  const py = (v) => H - P.b - (v / maxY) * (H - P.t - P.b)

  const yticks = 4
  const maxLabels = 6
  const step = Math.max(1, Math.ceil(allDates.length / maxLabels))
  const labelDates = allDates.filter((_, i) => i % step === 0)

  return (
    <div className="panel">
      <h3>Invisible Lost Time (ILT) trend</h3>
      <div className="psub">Invisible Lost Time · hours over/under benchmark · daily</div>
      {!hasData ? (
        <div className="npt-empty">No ILT data yet — appears once DDRs with benchmarked activities are recorded.</div>
      ) : (
        <>
          <div className="scatter-wrap">
            <svg viewBox={`0 0 ${W} ${H}`} className="scatter" preserveAspectRatio="xMidYMid meet">
              {/* y grid + labels */}
              {Array.from({ length: yticks + 1 }).map((_, i) => {
                const v = (maxY * i) / yticks
                const y = py(v)
                return (
                  <g key={`y${i}`}>
                    <line x1={P.l} y1={y} x2={W - P.r} y2={y} className="grid" />
                    <text x={P.l - 8} y={y + 3} className="tick" textAnchor="end">{maxY < 10 ? v.toFixed(1) : Math.round(v)}</text>
                  </g>
                )
              })}
              {/* axes */}
              <line x1={P.l} y1={P.t} x2={P.l} y2={H - P.b} className="axis" />
              <line x1={P.l} y1={H - P.b} x2={W - P.r} y2={H - P.b} className="axis" />
              {/* x labels (dates) */}
              {labelDates.map((d) => (
                <text key={d} x={px(d)} y={H - P.b + 16} className="tick" textAnchor="middle">{shortDate(d)}</text>
              ))}
              {/* one line + dots per rig */}
              {withPoints.map((s) => {
                const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date))
                const dpath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.date).toFixed(1)},${py(p.hours).toFixed(1)}`).join(' ')
                return (
                  <g key={s.name}>
                    <path d={dpath} fill="none" stroke={s.color} strokeWidth="2" />
                    {pts.map((p, i) => (
                      <circle key={i} cx={px(p.date)} cy={py(p.hours)} r="3.2" fill={s.color}>
                        <title>{`${s.name}: ${p.hours.toFixed(1)} h ILT · ${p.date}`}</title>
                      </circle>
                    ))}
                  </g>
                )
              })}
              <text x={14} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 14 ${(P.t + H - P.b) / 2})`} textAnchor="middle">ILT (hrs)</text>
            </svg>
          </div>
          <div className="ilt-legend">
            {withPoints.map((s) => (
              <span key={s.name}><i className="ldot" style={{ background: s.color }} />{short(s.name)}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
