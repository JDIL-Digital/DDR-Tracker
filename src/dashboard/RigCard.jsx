// RigCard — one rig. Real metrics when a report exists; honest "—" for fields
// we don't store (Operator, WOB, RPM, well progress) and an "Awaiting" empty
// state when there's no report for the date.
const DASH = '—'
const fmtDepth = (n) => (n == null ? DASH : `${Number(n).toLocaleString('en-US')} m`)
const fmtRop = (n) => (n == null ? DASH : Number(n).toFixed(1))
const fmtNpt = (n) => (n == null ? DASH : `${Math.round(n)}%`)

export default function RigCard({ rig }) {
  if (!rig.hasReport) {
    return (
      <div className="rig">
        <div className="hd">
          <div className="top">
            <div className="name">{rig.name}</div>
            <span className="pill p-aw">Awaiting</span>
          </div>
        </div>
        <div className="bd">
          <div className="await">No report received yet today</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rig">
      <div className="hd">
        <div className="top">
          <div className="name">{rig.name}</div>
          <span className={`pill ${rig.pill}`}>{rig.status}</span>
        </div>
        <div className="loc">{rig.well ? `well ${rig.well}` : DASH}</div>
      </div>
      <div className="bd">
        <div className="row"><span className="k">Operator</span><span className="v">{DASH}</span></div>
        <div className="row"><span className="k">Current depth</span><span className="v mono">{fmtDepth(rig.depth)}</span></div>
        <div className="prog">
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="k">Well progress</span>
            <span className="v mono">{DASH}</span>
          </div>
          <div className="bar"><div className="fill" style={{ width: '0%' }} /></div>
        </div>
        {rig.needsReview ? (
          <div className="issue">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z" />
            </svg>
            Extraction needs review
          </div>
        ) : null}
        <div className="metrics">
          <div className="m"><div className="mv mono">{fmtRop(rig.rop)}</div><div className="ml">ROP</div></div>
          <div className="m"><div className="mv mono" style={rig.nptHigh ? { color: 'var(--red)' } : undefined}>{fmtNpt(rig.nptPct)}</div><div className="ml">NPT</div></div>
          <div className="m"><div className="mv mono">{DASH}</div><div className="ml">WOB</div></div>
          <div className="m"><div className="mv mono">{DASH}</div><div className="ml">RPM</div></div>
        </div>
      </div>
    </div>
  )
}
