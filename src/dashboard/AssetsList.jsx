import { useState } from 'react'
import { ASSET_CATEGORIES } from './assets'
import { prettyDate, DASH } from './format'

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function AssetsList({ data, onOpen }) {
  const [cat, setCat] = useState('rigs')
  const [query, setQuery] = useState('')
  const [showRegister, setShowRegister] = useState(false)

  const inCat = data.assets.filter((a) => a.category === cat)
  const rows = inCat.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))

  const exportInventory = () => {
    const head = ['Asset', 'Type', 'Status', 'Current well', 'Last inspection', 'Registered']
    const lines = [head.join(',')]
    for (const a of data.assets) {
      lines.push([a.name, a.type || '', a.status, a.currentWell || '', a.lastInspection || '', a.registered ? 'yes' : 'no'].map(csvCell).join(','))
    }
    downloadCsv('fleet-inventory.csv', lines.join('\n'))
  }

  return (
    <div className="wrap">
      <div className="asset-toolbar">
        <h2 style={{ fontSize: 16, marginRight: 4 }}>Fleet Inventory</h2>
        <div className="asset-search">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input placeholder="Search assets by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={exportInventory}>Export inventory</button>
        <button type="button" className="btn primary" onClick={() => setShowRegister((s) => !s)}>+ Register new asset</button>
      </div>

      <div className="assets-layout">
        <div>
          <div className="panel">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Asset categories</div>
            <div className="cat-list">
              {ASSET_CATEGORIES.map((c) => (
                <div key={c.key} className={`cat-item ${cat === c.key ? 'on' : ''}`} onClick={() => setCat(c.key)}>
                  <span>{c.label}</span>
                  <span className="cnt">{data.counts[c.key] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel health-card">
            <div className="eyebrow">Maintenance health</div>
            <div className="pending-note" style={{ marginTop: 6, marginBottom: 0 }}>
              Not tracked yet — reference data, configured later.
            </div>
            <div className="health-buckets">
              <div className="health-b"><div className="bv" style={{ color: 'var(--green)' }}>{DASH}</div><div className="bl">Healthy</div></div>
              <div className="health-b"><div className="bv" style={{ color: 'var(--amber)' }}>{DASH}</div><div className="bl">Warning</div></div>
              <div className="health-b"><div className="bv" style={{ color: 'var(--red)' }}>{DASH}</div><div className="bl">Critical</div></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="sec-h" style={{ margin: '0 0 12px' }}>
            <h2>{ASSET_CATEGORIES.find((c) => c.key === cat)?.label}</h2>
            <span className="hint">{rows.length} asset{rows.length === 1 ? '' : 's'}</span>
          </div>

          {showRegister && (
            <div className="pending-gto" style={{ marginBottom: 14 }}>
              <strong>Register new asset</strong> — reference-data entry form is not built yet.
              Rigs are seeded from submitted DDRs; equipment (pumps, top drives, BOPs) will be registered here later.
            </div>
          )}

          {cat !== 'rigs' ? (
            <div className="npt-empty">
              No {ASSET_CATEGORIES.find((c) => c.key === cat)?.label.toLowerCase()} registered yet.
              Use “+ Register new asset” to add reference equipment (not built yet).
            </div>
          ) : rows.length === 0 ? (
            <div className="npt-empty">No assets match “{query}”.</div>
          ) : (
            <div className="matrix-scroll">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Asset name &amp; ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Current well</th>
                    <th>Last inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.name} className="clickable" onClick={() => onOpen(a)}>
                      <td>
                        <div className="asset-row-name">
                          <div className="asset-avatar">{a.name.charAt(0)}</div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{a.name}</div>
                            <div className="asset-id">ID: {a.dbId ? a.dbId.slice(0, 8) : 'not registered'}</div>
                          </div>
                        </div>
                      </td>
                      <td>{a.type || DASH}</td>
                      <td><span className={`pill ${a.pill}`}>{a.status}</span></td>
                      <td className="mono">{a.currentWell || DASH}</td>
                      <td className="mono">{a.lastInspection ? prettyDate(a.lastInspection) : DASH}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
