// TimeWindowSelector — 24H / 7D / 30D / Custom segmented control.
const OPTS = [
  ['24h', '24H'],
  ['7d', '7D'],
  ['30d', '30D'],
  ['custom', 'Custom'],
]

export default function TimeWindowSelector({ mode, onMode, customStart, customEnd, onCustom }) {
  return (
    <div className="seg-wrap">
      <div className="seg" role="tablist" aria-label="Time window">
        {OPTS.map(([v, label]) => (
          <button key={v} type="button" className={mode === v ? 'on' : ''} onClick={() => onMode(v)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customStart} max={customEnd} onChange={(e) => onCustom(e.target.value, customEnd)} />
          <span className="arrow">→</span>
          <input type="date" value={customEnd} min={customStart} onChange={(e) => onCustom(customStart, e.target.value)} />
        </div>
      )}
    </div>
  )
}
