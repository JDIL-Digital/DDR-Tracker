// Equipment downtime — built from real repair/equipment/breakdown/maintenance
// activity codes. Per-rig downtime hours + the actual downtime events. NO
// invented MTBF/reliability numbers.
import { fmt1, prettyDate } from './format'

export default function EquipmentDowntimePanel({ byRig, events, codeLabels }) {
  const max = byRig.length ? Math.max(...byRig.map((r) => r.hours)) : 0
  return (
    <div className="panel accent" style={{ '--k': 'var(--amber)' }}>
      <h3>Equipment downtime</h3>
      <div className="psub">
        From repair/equipment codes{codeLabels?.length ? ` (${codeLabels.join('; ')})` : ''} · selected window
      </div>

      {events.length === 0 ? (
        <div className="npt-empty">
          No equipment-downtime activities logged in this window.
          {!codeLabels?.length ? ' (No repair/equipment codes found in code_master.)' : ''}
        </div>
      ) : (
        <>
          <div className="npt" style={{ marginBottom: 14 }}>
            {byRig.map((r) => (
              <div className="item" key={r.rig}>
                <div className="il">
                  <span className="h">{r.rig}</span>
                  <span className="n mono">{fmt1(r.hours)} h</span>
                </div>
                <div className="track"><div className="tf" style={{ width: `${max > 0 ? (r.hours / max) * 100 : 0}%`, background: 'var(--amber)' }} /></div>
              </div>
            ))}
          </div>
          <div className="matrix-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rig</th>
                  <th className="num">Hours</th>
                  <th>Code</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{prettyDate(e.date)}</td>
                    <td>{e.rig}</td>
                    <td className="num mono">{fmt1(e.hrs)}</td>
                    <td className="mono">{e.code}</td>
                    <td className="remark-cell">{e.remark || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
