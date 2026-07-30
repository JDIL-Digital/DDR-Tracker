// RopChart — one bar per rig; height ∝ ROP, "—" (dim stub) when not applicable.
export default function RopChart({ data }) {
  const shortLabel = (name) => name.replace(/^Jindal\s+/i, '').replace(/-1$/, '')
  return (
    <div className="panel">
      <h3>Fleet ROP comparison</h3>
      <div className="psub">Rate of penetration by rig · m/hr · today</div>
      <div className="chart">
        {data.map((c) => {
          const hasVal = c.value != null
          const barStyle = hasVal
            ? { height: `${Math.max(c.pct, 3)}%`, ...(c.amber ? { background: 'var(--amber)' } : null) }
            : { height: '2%', background: '#2b333d' }
          return (
            <div className="col" key={c.label}>
              <div className="b" style={barStyle} />
              <div className="cv mono">{hasVal ? c.value.toFixed(1) : '—'}</div>
              <div className="cl">{shortLabel(c.label)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
