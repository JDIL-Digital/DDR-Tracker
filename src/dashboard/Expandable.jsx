// Expandable — a reusable "click to enlarge" wrapper. Renders its children inline
// with a corner enlarge button; clicking the button (or the panel body) opens the
// same content in a larger centered modal. Closable via the ✕ button, a backdrop
// click, or Escape. Purely presentational panels can be wrapped safely (the content
// is rendered twice — once inline, once in the modal — so children must be prop-driven,
// with no internal un-shared state).
import { Children, cloneElement, isValidElement, useEffect, useState } from 'react'

// In the modal copy, pass `enlarged` to COMPONENT children only (function/class
// components). Host elements (e.g. a plain <div> placeholder) are left untouched so
// we never leak an unknown `enlarged` attribute onto the DOM.
function withEnlarged(children) {
  return Children.map(children, (c) =>
    isValidElement(c) && typeof c.type !== 'string' ? cloneElement(c, { enlarged: true }) : c
  )
}

export default function Expandable({ children }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    // Prevent background scroll while the modal is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <div className="xpand">
        <button
          type="button"
          className="xpand-btn no-print"
          title="Enlarge"
          aria-label="Enlarge panel"
          onClick={() => setOpen(true)}
        >
          ⤢
        </button>
        {children}
      </div>

      {open && (
        <div className="xpand-overlay no-print" role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="xpand-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="xpand-close" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
            <div className="xpand-body">{withEnlarged(children)}</div>
          </div>
        </div>
      )}
    </>
  )
}
