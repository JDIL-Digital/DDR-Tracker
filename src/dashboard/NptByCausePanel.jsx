// NptByCausePanel — total non-productive hours + per-cause breakdown bars,
// aggregated over the selected rigs/window.
export default function NptByCausePanel({ total, items }) {
  const max = items.length ? items[0].hours : 0
  return (
    <div className="panel npt">
      <h3>Non-productive time by cause</h3>
      <div className="psub">
        Selected rigs · window total: <strong className="mono">{total.toFixed(1)} h</strong>
      </div>
      {items.length === 0 ? (
        <div className="npt-empty">No non-productive time in this window.</div>
      ) : (
        items.map((it) => (
          <div className="item" key={it.label}>
            <div className="il">
              <span className="h">{it.label}</span>
              <span className="n mono">{it.hours.toFixed(1)} h</span>
            </div>
            <div className="track">
              <div className="tf" style={{ width: `${max > 0 ? (it.hours / max) * 100 : 0}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
