// Time by activity code — the core "as per the coding" report. Groups all
// activities in the window by code (joined to code_master). Sorted hrs desc.
import { fmt1, pctStr } from './format'

function catClass(category) {
  if (category === 'Productive') return 'cat-prod'
  if (category === 'Non-Productive') return 'cat-npt'
  if (category === 'Completion') return 'cat-comp'
  return 'cat-unk'
}

export default function TimeByCodePanel({ rows, total }) {
  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <div className="matrix-head">
        <div>
          <h3>Time by activity code</h3>
          <div className="psub">All logged hours grouped by code · window total {fmt1(total)} h</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="npt-empty">No activities logged in this window.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Total hrs</th>
                <th className="num">% of total</th>
                <th style={{ width: '22%' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code}>
                  <td className="mono">{r.code}</td>
                  <td>{r.description}</td>
                  <td><span className={`catpill ${catClass(r.category)}`}>{r.category || '—'}</span></td>
                  <td className="num mono">{fmt1(r.hours)}</td>
                  <td className="num mono">{pctStr(r.pct)}</td>
                  <td>
                    <div className="minibar"><div className="minibar-fill" style={{ width: `${Math.min(r.pct, 100)}%` }} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
