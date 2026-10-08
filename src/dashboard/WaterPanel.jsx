// WaterPanel — potable water MADE vs CONSUMED per day for the SELECTED rig, from the
// inventory table (loadRigWaterDaily in ddrFleet.js). Two grouped bars per day:
// Made (blue) and Consumed (amber). Same sizing approach as the other daily charts:
// shrink-to-fit with in-chart scroll only, ~8 labels in-card, and every label +
// comfortable bars when enlarged. Honest empty state when a rig has no water data.
import { fmt1, prettyDate } from './format'

export default function WaterPanel({ days, hasData, unit, enlarged }) {
  const pts = days || []
  const max = pts.length ? Math.max(...pts.flatMap((d) => [d.made, d.consumed]), 0) : 0
  const n = pts.length
  const step = enlarged ? 1 : Math.max(1, Math.ceil(n / 8))
  const show = (i) => enlarged || i % step === 0 || i === n - 1
  const NB = ' '
  const u = unit ? ` ${unit}` : ''
  // A bar gets a 3% floor only when its value is > 0, so a true zero stays flat.
  const h = (v) => `${max > 0 ? (v > 0 ? Math.max((v / max) * 100, 3) : 0) : 0}%`

  return (
    <div className="panel accent" style={{ '--k': 'var(--blue)' }}>
      <h3>Portable water</h3>
      <div className="psub">Made vs consumed per day · single rig{unit ? ` · ${unit}` : ''}</div>

      <div className="rtd-legend">
        <span className="rtd-key"><i style={{ background: 'var(--blue)' }} />Made</span>
        <span className="rtd-key"><i style={{ background: 'var(--amber)' }} />Consumed</span>
      </div>

      {!hasData || pts.length === 0 ? (
        <div className="npt-empty">No potable-water data for this rig in the selected window.</div>
      ) : (
        <div className="chart-fit">
          <div className="chart water-chart">
            {pts.map((d, i) => (
              <div className="col" key={d.date}>
                <div className="water-pair">
                  <div className="water-b" style={{ height: h(d.made), background: 'var(--blue)' }} title={`${prettyDate(d.date)} — Made: ${fmt1(d.made)}${u}`} />
                  <div className="water-b" style={{ height: h(d.consumed), background: 'var(--amber)' }} title={`${prettyDate(d.date)} — Consumed: ${fmt1(d.consumed)}${u}`} />
                </div>
                <div className="cv mono">{show(i) ? `${fmt1(d.made)}/${fmt1(d.consumed)}` : NB}</div>
                <div className="cl">{show(i) ? prettyDate(d.date).replace(/ \d{4}$/, '') : NB}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
