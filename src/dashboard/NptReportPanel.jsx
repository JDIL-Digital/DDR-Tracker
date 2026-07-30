// NPT report — total non-productive hours + NPT %, broken down by cause and by rig.
import { fmt1, pctStr } from './format'

function Bars({ items, unitTotal }) {
  const max = items.length ? Math.max(...items.map((i) => i.hours)) : 0
  return (
    <div className="npt">
      {items.length === 0 ? (
        <div className="npt-empty">None in this window.</div>
      ) : (
        items.map((it) => (
          <div className="item" key={it.label}>
            <div className="il">
              <span className="h">{it.label}</span>
              <span className="n mono">
                {fmt1(it.hours)} h{unitTotal ? ` · ${pctStr((it.hours / unitTotal) * 100)}` : ''}
              </span>
            </div>
            <div className="track"><div className="tf" style={{ width: `${max > 0 ? (it.hours / max) * 100 : 0}%` }} /></div>
          </div>
        ))
      )}
    </div>
  )
}

export default function NptReportPanel({ nptHours, totalHours, nptPct, byCause, byRig }) {
  return (
    <div className="panel accent" style={{ '--k': 'var(--red)' }}>
      <h3>NPT report</h3>
      <div className="psub">Non-productive time in the selected window</div>

      <div className="npt-kpis">
        <div className="npt-kpi">
          <div className="npt-kpi-num mono" style={{ color: 'var(--red)' }}>{fmt1(nptHours)}<small> h</small></div>
          <div className="npt-kpi-lbl">Total NPT</div>
        </div>
        <div className="npt-kpi">
          <div className="npt-kpi-num mono" style={{ color: 'var(--red)' }}>{pctStr(nptPct)}</div>
          <div className="npt-kpi-lbl">NPT % of {fmt1(totalHours)} h</div>
        </div>
      </div>

      <div className="npt-split">
        <div>
          <div className="subhd">By cause</div>
          <Bars items={byCause} unitTotal={nptHours} />
        </div>
        <div>
          <div className="subhd">By rig</div>
          <Bars items={byRig} unitTotal={nptHours} />
        </div>
      </div>
    </div>
  )
}
