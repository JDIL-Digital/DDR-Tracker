// Footer — status legend (operating / standby / tripping / maintenance).
// The "awaiting" indicator and the provenance disclaimer were removed per the
// Fleet rework. Renders nothing when there's no active status to show.
export default function Footer({ counts }) {
  const parts = []
  if (counts.operating) parts.push({ color: 'green', text: `${counts.operating} operating` })
  const amber = counts.standby + counts.tripping
  if (amber) {
    const bits = []
    if (counts.standby) bits.push(`${counts.standby} standby`)
    if (counts.tripping) bits.push(`${counts.tripping} tripping`)
    parts.push({ color: 'amber', text: bits.join(' · ') })
  }
  if (counts.maintenance) parts.push({ color: 'red', text: `${counts.maintenance} maintenance` })

  if (!parts.length) return null

  return (
    <div className="foot-bar">
      {parts.map((p, i) => (
        <span key={i}>
          <span className="dot" style={{ background: `var(--${p.color})` }} />
          {p.text}
        </span>
      ))}
    </div>
  )
}
