// Period selector for the Reports page: Last 7 / 30 / 90 days / Custom.
export default function ReportPeriodSelector({ mode, onMode, customStart, customEnd, onCustom }) {
  const opts = [
    ['7d', 'Last 7 days'],
    ['30d', 'Last 30 days'],
    ['90d', 'Last 90 days'],
    ['custom', 'Custom'],
  ]
  return (
    <div className="seg-wrap">
      <div className="seg">
        {opts.map(([v, l]) => (
          <button key={v} type="button" className={mode === v ? 'on' : ''} onClick={() => onMode(v)}>
            {l}
          </button>
        ))}
      </div>
      {mode === 'custom' && (
        <div className="datectl">
          <input type="date" value={customStart} onChange={(e) => onCustom(e.target.value, customEnd)} />
          <span className="hint">to</span>
          <input type="date" value={customEnd} onChange={(e) => onCustom(customStart, e.target.value)} />
        </div>
      )}
    </div>
  )
}
