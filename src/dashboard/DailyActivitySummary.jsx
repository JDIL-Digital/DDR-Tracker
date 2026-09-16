// Daily Activity Summary — an ADD-ON report on the Reports tab. One row per day
// (report_date) for a SINGLE selected rig over a date range. Its own controls
// (rig dropdown + date range), independent of the Reports tab's multi-rig chips.
// Columns match the reference format; Break Down + the three Short Deployment
// columns get red headers. Short Deployment figures aren't in the DDR yet, so
// those cells show "—" (see the code comment in the row body).
import { useEffect, useState } from 'react'
import { loadRigsForPicker } from './settings'
import { loadDailyActivitySummary } from './reports'
import { todayISO, shiftDate, prettyDate } from './format'
import { LoadError } from './LoadState'

// One-decimal hours; a true 0 shows "0.0" (reported zero), never blanked.
const fmtH = (h) => (h == null ? '—' : Number(h).toFixed(1))

export default function DailyActivitySummary() {
  const [rigs, setRigs] = useState([])
  const [rigId, setRigId] = useState('')
  const [start, setStart] = useState(shiftDate(todayISO(), -30))
  const [end, setEnd] = useState(todayISO())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const retry = () => setReloadKey((k) => k + 1)

  // Load the rig list once; default to the first rig (sort_order).
  useEffect(() => {
    loadRigsForPicker()
      .then((r) => { setRigs(r); setRigId((cur) => cur || (r[0]?.id ?? '')) })
      .catch((e) => setError(e.message))
  }, [])

  // Reload the summary whenever rig / range changes.
  useEffect(() => {
    if (!rigId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    loadDailyActivitySummary(rigId, start, end)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rigId, start, end, reloadKey])

  const rigName = rigs.find((r) => r.id === rigId)?.name || 'this rig'

  return (
    <div className="panel accent das-panel" style={{ '--k': 'var(--blue)' }}>
      <h3>Daily Activity Summary</h3>
      <div className="psub">One row per day · hours by IADC condition · chronological activity log · single rig</div>

      <div className="das-controls no-print">
        <label className="das-field">
          <span>Rig</span>
          <select value={rigId} onChange={(e) => setRigId(e.target.value)}>
            {rigs.length === 0 && <option value="">—</option>}
            {rigs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="das-field">
          <span>From</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="das-field">
          <span>To</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      {error ? (
        <LoadError message={error} onRetry={retry} />
      ) : loading || !data ? (
        <div className="state">Loading…</div>
      ) : data.rows.length === 0 ? (
        <div className="npt-empty">No reports for {rigName} in the selected range.</div>
      ) : (
        <div className="matrix-scroll">
          <table className="matrix das-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Platform / Well No</th>
                <th>IADC Report No</th>
                <th className="num">Operating Hrs</th>
                <th className="num">Non-Operating Hrs</th>
                <th className="num">Moving Hrs</th>
                <th className="num das-red">Break Down Hrs</th>
                <th className="num das-red">Short Deployment JDIL</th>
                <th className="num das-red">Short Deployment SARAF / SODEXO</th>
                <th className="num das-red">Short Deployment Equipment</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.date}>
                  <td className="nowrap">{prettyDate(row.date)}</td>
                  <td>{row.well ?? '—'}</td>
                  <td>{row.reportNo ?? '—'}</td>
                  <td className="num">{fmtH(row.operating)}</td>
                  <td className="num">{fmtH(row.nonOperating)}</td>
                  <td className="num">{fmtH(row.moving)}</td>
                  <td className="num">{fmtH(row.breakDown)}</td>
                  {/* Short Deployment (JDIL / SARAF-SODEXO / Equipment): pending DDR data —
                      wire the extractor + fill these when rigs start reporting Short Deployment. */}
                  <td className="num das-pending">—</td>
                  <td className="num das-pending">—</td>
                  <td className="num das-pending">—</td>
                  <td className="das-remarks">
                    {row.remarks.length === 0 ? (
                      <span className="das-muted">—</span>
                    ) : (
                      <ul className="das-log">
                        {row.remarks.map((r, i) => (
                          <li key={i}>
                            <span className="das-time">{r.from ?? '??:??'}-{r.to ?? '??:??'}:</span>{' '}
                            {r.text || '(no description)'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="setting-note">
        Hours by IADC condition — Operating = RODR, Non-Operating = NODR, Moving = MDR,
        Break Down = EBDR. Short Deployment columns are pending DDR data (shown as “—”).
      </div>
    </div>
  )
}
