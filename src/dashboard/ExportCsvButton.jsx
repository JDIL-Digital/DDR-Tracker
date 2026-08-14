// ExportCsvButton — downloads the performance matrix as CSV (client-side).
const HEADERS = ['Rig', 'Depth (m)', 'Avg ROP (m/hr)', 'Fuel econ (L/hr)', 'NPT %', 'Health']

function cell(v, dp) {
  if (v == null || Number.isNaN(v)) return ''
  return dp != null ? Number(v).toFixed(dp) : String(v)
}
function csvEscape(s) {
  let str = String(s)
  // Neutralize spreadsheet formula injection: a leading = + - @ makes Excel/Sheets
  // treat the cell as a formula. Prefix with a single quote so it renders as text.
  if (/^[=+\-@]/.test(str)) str = `'${str}`
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

export default function ExportCsvButton({ rows }) {
  const onExport = () => {
    const lines = [HEADERS.join(',')]
    for (const r of rows) {
      lines.push(
        [
          csvEscape(r.name),
          cell(r.hasData ? r.currentDepth : null, 0),
          cell(r.hasData ? r.avgRop : null, 1),
          cell(r.hasData ? r.fuelEconLhr : null, 1),
          cell(r.hasData && r.nptPct != null ? Math.round(r.nptPct) : null),
          cell(r.health),
        ].join(',')
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fleet-performance.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button type="button" className="btn" onClick={onExport} disabled={rows.length === 0}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
      Export CSV
    </button>
  )
}
