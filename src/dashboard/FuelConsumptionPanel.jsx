// Fuel / diesel consumption — avg daily burn (KL/day) and avg rate (L/hr) for
// the window, plus a simple per-day trend. From the fuel figures we store.
import { fmt1, fmtKl, prettyDate } from './format'

export default function FuelConsumptionPanel({ avgDailyKl, avgLhr, trend }) {
  const pts = trend || []
  const max = pts.length ? Math.max(...pts.map((p) => p.kl)) : 0
  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Fuel / diesel consumption</h3>
      <div className="psub">Average burn and per-day trend · selected window</div>

      <div className="npt-kpis">
        <div className="npt-kpi">
          <div className="npt-kpi-num mono">{fmtKl(avgDailyKl)}<small> KL/day</small></div>
          <div className="npt-kpi-lbl">Avg daily burn</div>
        </div>
        <div className="npt-kpi">
          <div className="npt-kpi-num mono">{fmt1(avgLhr)}<small> L/hr</small></div>
          <div className="npt-kpi-lbl">Avg consumption rate</div>
        </div>
      </div>

      {pts.length === 0 ? (
        <div className="npt-empty">No fuel figures reported in this window.</div>
      ) : (
        <div className="chart" style={{ height: 120 }}>
          {pts.map((p, i) => (
            <div className="col" key={i}>
              <div className="b" style={{ height: `${max > 0 ? Math.max((p.kl / max) * 100, 3) : 3}%`, background: 'var(--blue)' }} />
              <div className="cv mono">{fmtKl(p.kl)}</div>
              <div className="cl">{prettyDate(p.date).replace(/ \d{4}$/, '')}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
