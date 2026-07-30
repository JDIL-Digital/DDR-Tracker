import ExportCsvButton from './ExportCsvButton'
import { DASH, fmt1, fmtInt, pctStr } from './format'

// FleetPerformanceMatrix — one row per selected rig with the key metrics and a
// colour-coded Health Score. Rigs without data in the window show "Awaiting".
export default function FleetPerformanceMatrix({ rows }) {
  return (
    <div className="panel">
      <div className="matrix-head">
        <div>
          <h3>Fleet performance matrix</h3>
          <div className="psub">Aggregated over the selected window · metric units</div>
        </div>
        <ExportCsvButton rows={rows} />
      </div>
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th>Rig</th>
              <th className="num">Depth (m)</th>
              <th className="num">Avg ROP (m/hr)</th>
              <th className="num">Fuel econ (L/hr)</th>
              <th className="num">NPT %</th>
              <th className="num">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="empty-row">No rigs selected.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.name}>
                  <td>
                    {r.name}
                    {!r.hasData ? <span className="await-tag">Awaiting</span> : null}
                  </td>
                  <td className="num mono">{r.hasData ? fmtInt(r.currentDepth) : DASH}</td>
                  <td className="num mono">{r.hasData ? fmt1(r.avgRop) : DASH}</td>
                  <td className="num mono">{r.hasData ? fmt1(r.fuelEconLhr) : DASH}</td>
                  <td className="num mono">{r.hasData ? pctStr(r.nptPct) : DASH}</td>
                  <td className="num">
                    {r.health == null ? (
                      <span className="mono">{DASH}</span>
                    ) : (
                      <span className={`hpill h-${r.healthColor}`}>{r.health}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
