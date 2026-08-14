import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { loadSearchIndex } from './search'

const lc = (s) => String(s || '').toLowerCase()
const TYPE_LABEL = { rig: 'Rigs', well: 'Wells', code: 'Activity codes' }
const PER_GROUP = { rig: 6, well: 6, code: 8 }

// Functional top-bar search over rigs / wells / activity codes. Client-side
// filter over a small cached index; results grouped by type in a dropdown.
// onNavigate(item) is called on select:
//   { type:'rig', name }               -> Fleet, highlight rig
//   { type:'well', well, rig }          -> Fleet, highlight the well's rig
//   { type:'code', code, description }  -> Settings › Activity Codes, filtered
export default function SearchBar({ onNavigate }) {
  const [index, setIndex] = useState(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadSearchIndex().then((d) => { if (!cancelled) setIndex(d) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Close when clicking outside.
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = query.trim()

  // Flat, grouped-in-order result list (rigs, then wells, then codes).
  const flat = useMemo(() => {
    const needle = lc(q)
    if (!needle || !index) return []
    const rigs = index.rigs.filter((r) => lc(r.name).includes(needle)).slice(0, PER_GROUP.rig)
      .map((r) => ({ type: 'rig', name: r.name }))
    const wells = index.wells.filter((w) => lc(w.well).includes(needle)).slice(0, PER_GROUP.well)
      .map((w) => ({ type: 'well', well: w.well, rig: w.rig }))
    const codes = index.codes
      .filter((c) => lc(c.code).includes(needle) || lc(c.description).includes(needle))
      .slice(0, PER_GROUP.code)
      .map((c) => ({ type: 'code', code: c.code, description: c.description, condition: c.condition }))
    return [...rigs, ...wells, ...codes]
  }, [q, index])

  const choose = (item) => {
    onNavigate(item)
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const onKeyDown = (e) => {
    if (!open || !flat.length) {
      if (e.key === 'Escape') setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) choose(flat[active]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const showMenu = open && q.length > 0

  const rowContent = (item) => {
    if (item.type === 'rig') return <><span className="sr-name">{item.name}</span></>
    if (item.type === 'well') return (
      <><span className="sr-name mono">{item.well}</span><span className="sr-sub">{item.rig ? `on ${item.rig}` : 'well'}</span></>
    )
    return (
      <><span className="sr-code mono">{item.code}</span><span className="sr-name">{item.description}</span>{item.condition ? <span className="sr-tag">{item.condition}</span> : null}</>
    )
  }

  let lastType = null
  return (
    <div className="search-wrap" ref={wrapRef}>
      <div className="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input
          className="search-input"
          type="text"
          placeholder="Search rigs, wells, or activity codes…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search rigs, wells, or activity codes"
        />
      </div>
      {showMenu && (
        <div className="search-menu">
          {flat.length === 0 ? (
            <div className="search-empty">No matches for “{q}”.</div>
          ) : (
            flat.map((item, i) => {
              const header = item.type !== lastType
                ? <div className="search-group-h" key={`h-${item.type}`}>{TYPE_LABEL[item.type]}</div>
                : null
              lastType = item.type
              return (
                <Fragment key={`${item.type}-${item.name || item.well || item.code}-${i}`}>
                  {header}
                  <button
                    type="button"
                    className={`search-row${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item)}
                  >
                    {rowContent(item)}
                  </button>
                </Fragment>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
