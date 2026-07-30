// RopByRigChart — grouped actual vs target ROP bars per selected rig.
// Target comes from planned_rop; when absent it renders as "—" (never faked).
const short = (name) => name.replace(/^Jindal\s+/i, '').replace(/-1$/, '')

export default function RopByRigChart({ data, hasTarget }) {
  const vals = data.flatMap((d) => [d.actual, d.target]).filter((v) => v != null)
  const max = vals.length ? Math.max(...vals) : 0

  return (
    <div className="panel">
      <h3>ROP by rig — actual vs target</h3>
      <div className="psub">Rate of penetration · m/hr · selected window</div>
      <div className="rop-legend">
        <span><i className="ldot" style={{ background: 'var(--green)' }} />Actual</span>
        <span><i className="ldot" style={{ background: 'var(--blue)' }} />Target</span>
      </div>
      {data.length === 0 ? (
        <div className="npt-empty">No rigs selected.</div>
      ) : (
        <div className="ropbars">
          {data.map((d) => {
            const aH = d.actual != null && max > 0 ? Math.max((d.actual / max) * 100, 3) : null
            const tH = d.target != null && max > 0 ? Math.max((d.target / max) * 100, 3) : null
            return (
              <div className="rop-col" key={d.label}>
                <div className="rop-pair">
                  <div
                    className="rop-bar act"
                    style={aH != null ? { height: `${aH}%` } : { height: '2%', background: 'var(--barstub)' }}
                  />
                  <div
                    className="rop-bar tgt"
                    style={tH != null ? { height: `${tH}%` } : { height: '2%', background: 'var(--barstub)' }}
                  />
                </div>
                <div className="rop-vals mono">
                  <span className="av">{d.actual != null ? d.actual.toFixed(1) : '—'}</span>
                  <span className="tv">{d.target != null ? d.target.toFixed(1) : '—'}</span>
                </div>
                <div className="rop-lbl">{short(d.label)}</div>
              </div>
            )
          })}
        </div>
      )}
      {!hasTarget && (
        <div className="chart-note">Target ROP: no <code>planned_rop</code> field in the database yet — shown as “—”.</div>
      )}
    </div>
  )
}
