// PlannedVsActualPanel — single-rig depth-vs-days (Analytics tab). When the rig's
// current well has BOTH a verified plan and overlapping drilling-day DDRs, it renders
// the reused DepthVsDaysChart (grey planned + red actual). Otherwise it shows a calm,
// specific empty state explaining exactly what's missing — never an error. Data comes
// from loadRigDepthVsDays(rigId). No well satisfies both conditions today, so the
// empty state is the expected view for now.
import DepthVsDaysChart from './DepthVsDaysChart'

export default function PlannedVsActualPanel({ rigName, data, loading }) {
  const d = data || {}
  const well = d.wellName || rigName || 'this well'
  const canChart = d.planVerified && d.hasActual

  let body
  if (loading || !data) {
    body = <div className="state">Loading…</div>
  } else if (canChart) {
    body = (
      <DepthVsDaysChart
        plan={{ points: d.planned, wellName: d.wellName, targetDepthM: d.targetDepthM }}
        actual={d.actual}
      />
    )
  } else if (d.planVerified && !d.hasActual) {
    // Verified plan, but the stored DDRs don't overlap the well's drilling phase.
    body = (
      <div className="npt-empty">
        Waiting for drilling-day reports — <b>{well}</b>’s plan is verified, but the stored DDRs
        don’t cover its drilling phase yet.
      </div>
    )
  } else if (d.hasPlan) {
    // A plan exists for the well but its depths aren't verified.
    body = <div className="npt-empty">No verified well plan for <b>{well}</b>.</div>
  } else {
    // Neither a verified plan nor DDRs to compare.
    body = (
      <div className="npt-empty">
        Planned vs Actual will populate once this well has a verified plan and drilling-day reports.
      </div>
    )
  }

  return (
    <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
      <h3>Planned vs Actual</h3>
      <div className="psub">Depth vs days — planned curve vs DPR actuals</div>
      {body}
    </div>
  )
}
