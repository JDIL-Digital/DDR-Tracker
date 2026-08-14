// KpiCard — a single KPI tile with a colored top border. When `onClick` is
// provided the tile becomes a toggle button (used on Fleet to rank rigs by that
// metric); `active` shows the pressed/selected state.
export default function KpiCard({ color, label, value, unit, foot, footClass, onClick, active }) {
  const clickable = typeof onClick === 'function'
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
  }
  return (
    <div
      className={`kpi${clickable ? ' clickable' : ''}${active ? ' active' : ''}`}
      style={{ '--k': `var(--${color})` }}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? handleKey : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? !!active : undefined}
    >
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
