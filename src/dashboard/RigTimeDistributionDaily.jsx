// RigTimeDistributionDaily — per-day stacked bars of the SELECTED rig's activity
// hours by IADC condition: RODR (green) / NODR (amber) / EBDR (red), plus any
// unmapped null-code hours (grey) surfaced so a bar is never silently short.
// MDR (rig-move) is excluded upstream. Data from loadRigTimeDistributionDaily.
import { fmt1, prettyDate } from './format'

const SERIES = [
  { key: 'EBDR', label: 'EBDR (breakdown)', color: 'var(--red)' },
  { key: 'NODR', label: 'NODR (non-operating)', color: 'var(--amber)' },
  { key: 'RODR', label: 'RODR (operating)', color: 'var(--green)' },
  { key: 'nullCodeHrs', label: 'Unmapped code', color: 'var(--dim)' },
]

export default function RigTimeDistributionDaily({ days, hasData, enlarged }) {
  const pts = days || []
  const totals = pts.map((d) => d.RODR + d.NODR + d.EBDR + d.nullCodeHrs)
  const max = totals.length ? Math.max(...totals, 0) : 0
  const anyNull = pts.some((d) => d.nullCodeHrs > 0)
  // Legend order reads RODR → NODR → EBDR → (unmapped); the stack draws bottom-up.
  const legend = [...SERIES].reverse().filter((s) => s.key !== 'nullCodeHrs' || anyNull)
  // Thin labels/values so a 30-day chart fits a narrow card; the modal shows all.
  const n = pts.length
  const step = enlarged ? 1 : Math.max(1, Math.ceil(n / 8))
  const show = (i) => enlarged || i % step === 0 || i === n - 1
  const NB = ' '

  return (
    <div className="panel accent" style={{ '--k': 'var(--green)' }}>
      <h3>Rig time distribution</h3>
      <div className="psub">Daily RODR / NODR / EBDR hours · selected window · MDR (rig-move) excluded</div>

      <div className="rtd-legend">
        {legend.map((s) => (
          <span className="rtd-key" key={s.key}><i style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>

      {!hasData || pts.length === 0 ? (
        <div className="npt-empty">No DDRs for this rig in the selected window.</div>
      ) : (
        <div className="chart-fit">
          <div className="chart rtd-chart">
            {pts.map((d, i) => {
              const total = d.RODR + d.NODR + d.EBDR + d.nullCodeHrs
              return (
                <div className="col" key={d.date}>
                  <div className="rtd-stack" title={`${prettyDate(d.date)} — ${fmt1(total)} h total`}>
                    {SERIES.map((s) => {
                      const v = d[s.key] || 0
                      if (v <= 0) return null
                      const h = max > 0 ? (v / max) * 100 : 0
                      return (
                        <div
                          className="rtd-seg"
                          key={s.key}
                          style={{ height: `${h}%`, background: s.color }}
                          title={`${s.label}: ${fmt1(v)} h`}
                        />
                      )
                    })}
                  </div>
                  <div className="cv mono">{show(i) ? fmt1(total) : NB}</div>
                  <div className="cl">{show(i) ? prettyDate(d.date).replace(/ \d{4}$/, '') : NB}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
