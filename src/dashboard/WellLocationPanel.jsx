// WellLocationPanel — placeholder. Per selected rig: Current well, Days on well,
// Location, OIM. All shown as "—" for now; these populate from the Well Plan
// feature (well/location/days) and a new OIM field. No invented values.
import { DASH } from './format'

export default function WellLocationPanel({ rigs }) {
  return (
    <div className="panel">
      <h3>Well &amp; Location</h3>
      <div className="psub">Per rig · from the Well Plan feature (coming soon)</div>
      {rigs.length === 0 ? (
        <div className="npt-empty">No rigs selected.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr><th>Rig</th><th>Current well</th><th>Days on well</th><th>Location</th><th>OIM</th></tr>
            </thead>
            <tbody>
              {rigs.map((name) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="mono">{DASH}</td>
                  <td className="mono">{DASH}</td>
                  <td>{DASH}</td>
                  <td>{DASH}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="setting-note">
        Fields populate from the Well Plan feature (well · location · days on well) and a new OIM
        field — pending.
      </div>
    </div>
  )
}
