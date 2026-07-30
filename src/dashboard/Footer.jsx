// Footer — status legend + provenance disclaimer.
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
  if (counts.awaiting) parts.push({ color: 'dim', text: `${counts.awaiting} awaiting` })

  return (
    <div className="foot-bar">
      {parts.map((p, i) => (
        <span key={i}>
          <span className="dot" style={{ background: `var(--${p.color})` }} />
          {p.text}
        </span>
      ))}
      <span className="disc">Live data from submitted DDRs · rigs without a report shown as Awaiting · no values invented</span>
    </div>
  )
}
