// DowntimeChart — one bar per rig = that rig's total EBDR (equipment breakdown /
// downtime) hours for the current month. Red bars (downtime). Honest empty state
// when no downtime is logged.
export default function DowntimeChart({ data, hasData }) {
  const shortLabel = (name) => name.replace(/^Jindal\s+/i, '').replace(/-1$/, '')
  return (
    <div className="panel">
      <h3>Downtime per rig</h3>
      <div className="psub">Total EBDR (equipment breakdown) hours · this month</div>
      {!hasData ? (
        <div className="npt-empty">No downtime logged this month.</div>
      ) : (
        <div className="chart">
          {data.map((c) => {
            const hasVal = c.value != null && c.value > 0
            const barStyle = hasVal
              ? { height: `${Math.max(c.pct, 3)}%`, background: 'var(--red)' }
              : { height: '2%', background: 'var(--barstub)' }
            return (
              <div className="col" key={c.label}>
                <div className="b" style={barStyle} />
                <div className="cv mono">{c.value != null ? c.value.toFixed(1) : '—'}</div>
                <div className="cl">{shortLabel(c.label)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
