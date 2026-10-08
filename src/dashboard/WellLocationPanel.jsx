// WellLocationPanel — Well & Location for the SELECTED rig, from its latest DDR in
// the window (loadRigWellLocation in ddrFleet.js). Shows real reported values; "—"
// only where a field is genuinely absent. No invented data.
import { DASH } from './format'

export default function WellLocationPanel({ rigName, data, loading }) {
  const rows = [
    ['Current well', data?.well],
    ['Days on location', data?.daysOnLocation],
    ['Days on well', data?.daysOnWell],
    ['Present operation', data?.presentOperation],
    ['OIM', data?.oim],
    ['POB (total)', data?.pob],
  ]
  const val = (v) => (v == null || v === '' ? DASH : String(v))

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Well &amp; Location</h3>
      <div className="psub">
        {data?.hasReport
          ? `${rigName || 'Selected rig'} · latest DDR ${data.date}`
          : (rigName || 'Selected rig')}
      </div>

      {loading ? (
        <div className="state">Loading…</div>
      ) : !data?.hasReport ? (
        <div className="npt-empty">No DDR for this rig in the selected window.</div>
      ) : (
        <dl className="wl-grid">
          {rows.map(([k, v]) => (
            <div className="wl-row" key={k}>
              <dt>{k}</dt>
              <dd>{val(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
