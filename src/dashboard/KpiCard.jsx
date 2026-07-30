// KpiCard — a single KPI tile with a colored top border.
export default function KpiCard({ color, label, value, unit, foot, footClass }) {
  return (
    <div className="kpi" style={{ '--k': `var(--${color})` }}>
      <div className="lbl">
        <span className="eyebrow">{label}</span>
      </div>
      <div className="num mono">
        {value}
        {unit ? <small> {unit}</small> : null}
      </div>
      {foot ? <div className={`foot ${footClass || ''}`}>{foot}</div> : null}
    </div>
  )
}
