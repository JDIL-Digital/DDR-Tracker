// ActualVsPlannedDays — placeholder panel. Wired to the Well Plan feature later
// (planned depth-vs-days from a GTO / well-data PDF vs actual from the DDRs).
// No data is fabricated until that feature exists.
export default function ActualVsPlannedDays() {
  return (
    <div className="panel">
      <h3>Actual vs Planned Days</h3>
      <div className="psub">Well progress vs plan · days</div>
      <div className="pending-gto">
        Pending Well Plan — upload a GTO / well-data PDF to see planned vs actual days.
      </div>
    </div>
  )
}
