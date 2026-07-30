import { useState } from 'react'

// RigCompareChips — selected rigs as removable chips + an "Add asset" menu to
// bring back deselected rigs. Filters which rigs appear in the charts/matrix.
export default function RigCompareChips({ all, selected, onToggle }) {
  const [open, setOpen] = useState(false)
  const chosen = all.filter((n) => selected.has(n))
  const available = all.filter((n) => !selected.has(n))

  return (
    <div className="chips">
      {chosen.map((n) => (
        <span className="chip on" key={n}>
          {n}
          <button type="button" className="x" onClick={() => onToggle(n)} aria-label={`Remove ${n}`}>
            ×
          </button>
        </span>
      ))}
      <div className="add-wrap">
        <button
          type="button"
          className="chip add"
          onClick={() => setOpen((o) => !o)}
          disabled={available.length === 0}
        >
          + Add asset
        </button>
        {open && available.length > 0 && (
          <div className="add-menu">
            {available.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  onToggle(n)
                  setOpen(false)
                }}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
