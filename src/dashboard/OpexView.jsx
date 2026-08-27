// OpexView — Stage 1 of the OPEX feature.
//
// Embeds the standalone OPEX dashboard (public/opex/index.html) UNCHANGED via an
// iframe. The HTML is treated as a BLACK BOX: all its calculations, KPI logic,
// filtering, search, xlsx upload, and charts run exactly as in the standalone
// file — this component adds no logic and passes nothing in.
//
// It renders only inside ORBIT's authenticated, approved-user shell (routed from
// Dashboard.jsx, which is reached only after the auth gate), so the iframe
// inherits ORBIT's gate — unauthenticated users never reach it. There is no
// separate auth on the iframe.
//
// Kept fully self-contained (this file + the one sidebar nav entry) so a later
// stage can swap the iframe for native React + Supabase without touching any
// other ORBIT code.
export default function OpexView() {
  return (
    <iframe
      className="opex-frame"
      src="/opex/index.html"
      title="OPEX Dashboard"
      // Same-origin (served from ORBIT's own /public), so the CDN scripts
      // (SheetJS, Chart.js, date adapter) and client-side xlsx upload work as-is.
    />
  )
}
