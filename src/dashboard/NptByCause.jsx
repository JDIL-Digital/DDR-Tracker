// NptByCause — non-productive hours grouped by cause (from activities joined to
// code_master). Empty state when no NPT was logged for the date.
export default function NptByCause({ data }) {
  return (
    <div className="panel npt">
      <h3>Non-productive time by cause</h3>
      <div className="psub">Fleet total today · hours</div>
      {data.length === 0 ? (
        <div className="empty">No non-productive time logged for this date.</div>
      ) : (
        data.map((it) => (
          <div className="item" key={it.label}>
            <div className="il">
              <span className="h">{it.label}</span>
              <span className="n mono">{it.hours.toFixed(1)} h</span>
            </div>
            <div className="track">
              <div className="tf" style={{ width: `${it.pct}%` }} />
            </div>
          </div>
        ))
      )}
    </div>
  )
}
