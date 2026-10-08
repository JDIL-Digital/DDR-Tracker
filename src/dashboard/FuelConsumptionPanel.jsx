// Fuel / diesel consumption — avg daily burn (KL/day) and avg rate (L/hr) for
// the window, plus a simple per-day trend. From the fuel figures we store.
import { fmt1, fmtKl, prettyDate } from './format'

export default function FuelConsumptionPanel({ avgDailyKl, avgLhr, trend, enlarged }) {
  const pts = trend || []
  const max = pts.length ? Math.max(...pts.map((p) => p.kl)) : 0
  // Thin labels/values so many days don't overlap in a narrow card. The modal
  // (enlarged) shows every label. NBSP keeps hidden rows at constant height so bar
  // baselines stay aligned.
  const n = pts.length
  const step = enlarged ? 1 : Math.max(1, Math.ceil(n / 8))
  const show = (i) => enlarged || i % step === 0 || i === n - 1
  const NB = ' '
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
        <div className="chart-fit">
          <div className="chart" style={{ height: 120 }}>
            {pts.map((p, i) => (
              <div className="col" key={i}>
                <div
                  className="b"
                  style={{ height: `${max > 0 ? Math.max((p.kl / max) * 100, 3) : 3}%`, background: 'var(--blue)' }}
                  title={`${prettyDate(p.date)}: ${fmtKl(p.kl)} KL`}
                />
                <div className="cv mono">{show(i) ? fmtKl(p.kl) : NB}</div>
                <div className="cl">{show(i) ? prettyDate(p.date).replace(/ \d{4}$/, '') : NB}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
