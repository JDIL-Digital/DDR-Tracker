// DepthVsDaysPanel — single-well depth-vs-days for the selected rig's CURRENT well.
// Three layers (data from loadRigDepthSeries):
//   1. DEPTH CURVE (green): depth_md_m (Y, m MDKB, descending) vs days_on_well (X).
//      The line gaps across null-depth days (no invented points).
//   2. NPT MARKERS (red): NODR+EBDR activities at (day, that day's depth), hoverable.
//      A show/hide toggle + an "All NPTs" filter (by condition or code).
//   3. CASING POINTS (circled): BEST-EFFORT / heuristic (see loader). Behind its own
//      toggle. A hollow/dashed ring marks an approximate point (shoe depth not parsed →
//      fell back to the day's depth).
// Reuses the responsive .scatter SVG (scales to the card; larger in the enlarge modal).
// Hover tooltips are ENLARGED-ONLY: the compact tile keeps plain markers (no tooltips).
import { useMemo, useRef, useState } from 'react'

const round0 = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n))

export default function DepthVsDaysPanel({ rigName, data, loading, enlarged }) {
  const d = data || {}
  const well = d.wellName || 'current well'
  const [showNpt, setShowNpt] = useState(true)
  const [showCasing, setShowCasing] = useState(true)
  const [nptFilter, setNptFilter] = useState('all')

  // Enlarged-only custom tooltip (cursor-following, clamped to the chart bounds).
  const [tip, setTip] = useState(null) // { kind, x, y, ...fields } | null
  const wrapRef = useRef(null)
  const posFrom = (e) => {
    const r = wrapRef.current?.getBoundingClientRect()
    if (!r) return { x: 12, y: 12 }
    const TW = 250, TH = 140 // approx tooltip box for clamping
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
  // Interaction props applied to markers only in the enlarged view.
  const hoverProps = (payload) => (enlarged
    ? { onMouseEnter: showTip(payload), onMouseMove: moveTip, onMouseLeave: hideTip, onClick: showTip(payload), onFocus: showTip(payload), onBlur: hideTip, tabIndex: 0, style: { cursor: 'pointer' } }
    : {})

  const nptShown = useMemo(() => {
    const list = d.npt || []
    if (!showNpt) return []
    if (nptFilter === 'all') return list
    if (nptFilter === 'NODR' || nptFilter === 'EBDR') return list.filter((n) => n.condition === nptFilter)
    if (nptFilter.startsWith('code:')) return list.filter((n) => n.code === nptFilter.slice(5))
    return list
  }, [d.npt, showNpt, nptFilter])

  // ----- empty states (honest, specific) -----
  let empty = null
  if (loading || !data) empty = 'Loading…'
  else if (!d.hasReports) empty = 'No reports for this rig.'
  else if (!d.hasDepth) empty = `No depth reported for ${well} yet.`

  // ----- chart geometry -----
  const rows = d.depthRows || []
  const chart = useMemo(() => {
    const pts = rows.filter((r) => r.depth != null)
    const days = rows.map((r) => r.day)
    const depths = pts.map((r) => r.depth)
    const casingDepths = (d.casing || []).map((c) => c.depth)
    const xMax = Math.max(days.length ? Math.max(...days) : 1, 1)
    const yMaxRaw = Math.max(depths.length ? Math.max(...depths) : 1, casingDepths.length ? Math.max(...casingDepths) : 0, 1)
    const yMax = Math.ceil(yMaxRaw / 500) * 500 || 500
    return { xMax, yMax }
  }, [rows, d.casing])

  const W = 720
  const H = 360
  const P = { l: 56, r: 18, t: 16, b: 42 }
  const x = (day) => P.l + (day / chart.xMax) * (W - P.l - P.r)
  // DESCENDING depth axis: 0 (surface) at TOP, deepest at BOTTOM.
  const y = (depth) => P.t + (depth / chart.yMax) * (H - P.t - P.b)

  // Depth line path, broken at null-depth days (gaps).
  const linePath = useMemo(() => {
    let dstr = ''
    let pen = false
    for (const r of rows) {
      if (r.depth == null) { pen = false; continue }
      dstr += `${pen ? 'L' : 'M'} ${x(r.day).toFixed(1)},${y(r.depth).toFixed(1)} `
      pen = true
    }
    return dstr.trim()
  }, [rows, chart])

  const xticks = 6
  const yticks = 5

  return (
    <div className="panel accent dvd-panel" style={{ '--k': 'var(--green)' }}>
      <div className="sec-h" style={{ margin: '0 0 2px' }}>
        <h3>Depth vs Days</h3>
      </div>
      <div className="psub">{well} · depth (m MDKB) vs days on well · green = depth, red = NPT, ◦ = casing</div>

      {/* controls: layer toggles + NPT filter */}
      {!empty && (
        <div className="dvd-controls no-print">
          <label className="dvd-switch">
            <input type="checkbox" checked={showNpt} onChange={(e) => setShowNpt(e.target.checked)} /> NPT
          </label>
          <label className="dvd-switch">
            <input type="checkbox" checked={showCasing} onChange={(e) => setShowCasing(e.target.checked)} /> Casing
          </label>
          <select className="depth-rig-picker" value={nptFilter} onChange={(e) => setNptFilter(e.target.value)} aria-label="Filter NPT markers" disabled={!showNpt}>
            <option value="all">All NPTs ({(d.npt || []).length})</option>
            <option value="NODR">NODR (non-operating)</option>
            <option value="EBDR">EBDR (breakdown)</option>
            {(d.nptCodes || []).map((c) => (
              <option key={c.code} value={`code:${c.code}`}>[{c.code}] {c.description?.slice(0, 28)}</option>
            ))}
          </select>
        </div>
      )}

      {empty ? (
        <div className={loading ? 'state' : 'npt-empty'}>{empty}</div>
      ) : (
        <>
          <div className="scatter-wrap dvd-chart-wrap" ref={wrapRef}>
            <svg viewBox={`0 0 ${W} ${H}`} className="scatter depth-svg" preserveAspectRatio="xMidYMid meet">
              {/* y grid + depth labels (descending) */}
              {Array.from({ length: yticks + 1 }).map((_, i) => {
                const v = (chart.yMax * i) / yticks
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
                const dv = (chart.xMax * i) / xticks
                return <text key={`x${i}`} x={x(dv)} y={H - P.b + 16} className="tick" textAnchor="middle">{round0(dv)}</text>
              })}

              {/* depth curve (green) — plain markers, no tooltips */}
              {linePath && <path d={linePath} fill="none" stroke="var(--green)" strokeWidth="2" />}
              {rows.filter((r) => r.depth != null).map((r, i) => (
                <circle key={`dp${i}`} cx={x(r.day)} cy={y(r.depth)} r="2.6" fill="var(--green)" />
              ))}

              {/* casing points (circled; dashed/hollow when approximate) */}
              {showCasing && (d.casing || []).map((c, i) => (
                <g key={`cs${i}`}>
                  <circle
                    cx={x(c.day)} cy={y(c.depth)} r="6.5"
                    fill="none" stroke="var(--blue)" strokeWidth="1.8"
                    strokeDasharray={c.approx ? '3 2' : undefined}
                    {...hoverProps({ kind: 'casing', size: c.size, depth: c.depth, day: c.day, approx: c.approx, remark: c.remark })}
                  />
                  <text x={x(c.day)} y={y(c.depth) - 10} className="tick dvd-casing-lbl" textAnchor="middle">{c.size}</text>
                </g>
              ))}

              {/* NPT markers (red) */}
              {nptShown.map((n, i) => (
                <circle
                  key={`npt${i}`} cx={x(n.day)} cy={y(n.depth)} r="3.4"
                  fill="var(--red-solid)" stroke="var(--card)" strokeWidth="1"
                  {...hoverProps({ kind: 'npt', day: n.day, depth: n.depth, hrs: n.hrs, code: n.code, condition: n.condition, remark: n.remark })}
                />
              ))}

              {/* axis labels */}
              <text x={16} y={(P.t + H - P.b) / 2} className="axlbl" transform={`rotate(-90 16 ${(P.t + H - P.b) / 2})`} textAnchor="middle">Depth (m MDKB)</text>
              <text x={(P.l + W - P.r) / 2} y={H - 6} className="axlbl" textAnchor="middle">Days on well</text>
            </svg>

            {/* Enlarged-only hover tooltip (follows the cursor, clamped to the chart). */}
            {enlarged && tip && (
              <div className="dvd-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
                {tip.kind === 'npt' ? (
                  <>
                    <div className="tip-h">{tip.day} days — {round0(tip.depth)} m</div>
                    <div className="tip-meta">[{tip.code}] {tip.condition} · {tip.hrs} h NPT</div>
                    <div className="tip-reason">{tip.remark || '(no reason recorded)'}</div>
                  </>
                ) : (
                  <>
                    <div className="tip-h">{tip.size} casing</div>
                    <div className="tip-meta">Shoe depth {round0(tip.depth)} m · day {tip.day}</div>
                    {tip.approx && <div className="tip-approx">depth approximate — shoe not parsed</div>}
                    {tip.remark && <div className="tip-reason">{tip.remark}</div>}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="ilt-legend depth-legend">
            <span><i className="ldot" style={{ background: 'var(--green)' }} />Depth (m MDKB)</span>
            {showNpt && <span><i className="ldot" style={{ background: 'var(--red-solid)' }} />NPT ({nptShown.length} shown)</span>}
            {showCasing && <span><i className="ldot dvd-ring" />Casing set{(d.casing || []).some((c) => c.approx) ? ' (dashed = approx)' : ''}</span>}
          </div>
          <div className="setting-note">
            Casing points are <b>best-effort</b> (parsed from activity remarks — medium reliability).
            A dashed ring means the shoe depth wasn’t parseable and the day’s depth was used instead.
          </div>
        </>
      )}
    </div>
  )
}
