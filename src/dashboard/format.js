// Shared formatting helpers for the dashboard + analytics views.
export const DASH = '—'

export const todayISO = () => new Date().toISOString().slice(0, 10)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function prettyDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// Shift an ISO date (yyyy-mm-dd) by n days, UTC-safe.
export function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// number, 1 dp, or — when null/NaN
export const fmt1 = (n) => (n == null || Number.isNaN(n) ? DASH : Number(n).toFixed(1))
// integer with thousands separators, or —
export const fmtInt = (n) => (n == null || Number.isNaN(n) ? DASH : Math.round(n).toLocaleString('en-US'))
// KL / L etc — up to 1 dp with separators, or —
export const fmtKl = (n) =>
  n == null || Number.isNaN(n) ? DASH : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })
// rounded percent as bare number string, or —
export const pctNum = (n) => (n == null || Number.isNaN(n) ? DASH : String(Math.round(n)))
// rounded percent with % sign, or —
export const pctStr = (n) => (n == null || Number.isNaN(n) ? DASH : `${Math.round(n)}%`)
