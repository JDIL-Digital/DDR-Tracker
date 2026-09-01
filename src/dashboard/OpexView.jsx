// OpexView — OPEX Stage 2a/2b-1.
//
// Embeds the standalone OPEX dashboard (public/opex/index.html) via an iframe
// (black box — parse/calc/KPI untouched) AND adds a save-through-parent path:
// the iframe posts its already-parsed rows via postMessage; this parent maps
// them to the purchase_orders schema and UPSERTS them with the app's existing
// authenticated Supabase client (RLS is_approved() gates it).
//
// Stage 2b-1: accumulate/merge model. Each row gets a stable line_key
// (SHA-256 of source|po_number|location|order_date|amount|description|occurrence_index);
// upsert with ignoreDuplicates (ON CONFLICT DO NOTHING) => insert-if-new /
// skip-if-exists. Amounts are immutable (part of identity). occurrence_index is
// a per-identity-tuple rank so legitimately-identical lines are preserved.
// Existing rows keep their original upload_batch_id (provenance) because DO
// NOTHING never touches them.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../auth/AuthProvider'

const CHUNK = 500
const SEP = '' // field delimiter that cannot occur in the data

// Legacy row_fingerprint (exact-dup signal, kept for continuity). The UNIQUE
// upsert key is line_key (SHA-256) below.
function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0 }
  return ('00000000' + h.toString(16)).slice(-8)
}

// SHA-256 hex via Web Crypto (secure context: localhost + https both qualify).
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Date (or null) -> 'YYYY-MM-DD' using local parts (no TZ shift).
function toISODate(d) {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v))
const str = (v) => { const s = (v ?? '').toString().trim(); return s === '' ? null : s }

// Immutable line identity (WITHOUT occurrence_index).
const idOf = (rec) => [
  rec.source, rec.po_number ?? '', rec.location ?? '', rec.order_date ?? '',
  rec.amount == null ? '' : rec.amount, rec.description ?? '',
].join(SEP)

// Map one parsed dashboard row -> a purchase_orders record. Mapping confirmed:
// department=null; local usd_equivalent=null; local amount=BaseAmt (pre-GST),
// amount_to_vendor=AmountOriginal (incl GST); import amount=AmountOriginal,
// usd_equivalent=AmountUSD. (occurrence_index + line_key added after mapping.)
function mapRow(r, batchId) {
  const source = r.Source === 'Local' ? 'local' : 'import'
  const location = str(r.Location)
  const po_number = str(r.PONumber)
  const order_date = toISODate(r.Date)
  const description = str(r.Description)
  const amount = source === 'local' ? num(r.BaseAmt) : num(r.AmountOriginal)
  return {
    upload_batch_id: batchId,
    source,
    location,
    po_number,
    order_date,
    status: str(r.Status),
    vendor: str(r.Vendor),
    description,
    department: null,
    currency: str(r.Currency),
    amount,
    gst_amount: source === 'local' ? num(r.GST) : null,
    amount_to_vendor: source === 'local' ? num(r.AmountOriginal) : null,
    usd_equivalent: source === 'import' ? num(r.AmountUSD) : null,
    row_fingerprint: fnv1a([source, po_number || '', location || '', amount == null ? '' : amount, order_date || '', description || ''].join('|')),
    raw: r,
  }
}

export default function OpexView() {
  const { user } = useAuth()
  const iframeRef = useRef(null)
  const savingRef = useRef(false)
  const [save, setSave] = useState({ state: 'idle', msg: '' }) // idle | saving | success | error

  const handleSave = useCallback(async (payload) => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const localRows = Array.isArray(payload.local) ? payload.local : []
      const importRows = Array.isArray(payload.import) ? payload.import : []
      const total = localRows.length + importRows.length
      if (!total) { setSave({ state: 'error', msg: 'No rows received from the dashboard — nothing saved.' }); return }
      setSave({ state: 'saving', msg: `Preparing ${total} rows…` })

      // 1. Create the upload batch (uploaded_by = auth.uid() so owner-cleanup works).
      const batchRes = await supabase.from('opex_uploads').insert({
        uploaded_by: user?.id ?? null,
        local_filename: payload.meta?.localFilename || null,
        import_filename: payload.meta?.importFilename || null,
        local_row_count: localRows.length,
        import_row_count: importRows.length,
        total_row_count: total,
      }).select('id').single()
      if (batchRes.error) { setSave({ state: 'error', msg: `Could not create upload batch: ${batchRes.error.message}` }); return }
      const batchId = batchRes.data.id

      // 2. Map, assign per-identity occurrence_index (stable rank over the full set), build line_key.
      const rows = [...localRows, ...importRows].map((r) => mapRow(r, batchId))
      const seen = new Map()
      for (const rec of rows) {
        const id = idOf(rec)
        const n = seen.get(id) || 0
        rec.occurrence_index = n
        seen.set(id, n + 1)
      }
      const keys = await Promise.all(rows.map((rec) => sha256hex(idOf(rec) + SEP + rec.occurrence_index)))
      rows.forEach((rec, i) => { rec.line_key = keys[i] })

      // 3. Chunked UPSERT — insert-if-new / skip-if-exists (ON CONFLICT DO NOTHING).
      //    .select() returns only actually-inserted rows, so newRows = real inserts.
      let newRows = 0
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK)
          const { data, error } = await supabase.from('purchase_orders')
            .upsert(chunk, { onConflict: 'line_key', ignoreDuplicates: true })
            .select('id')
          if (error) throw new Error(error.message)
          newRows += data ? data.length : 0
          setSave({ state: 'saving', msg: `Saving… ${Math.min(i + CHUNK, rows.length)}/${rows.length} processed` })
        }
      } catch (e) {
        const del = await supabase.from('opex_uploads').delete().eq('id', batchId)
        const cleanup = del.error
          ? ` ⚠️ Batch ${batchId} could NOT be auto-removed (${del.error.message}) — run migration 0019, then delete via service-role.`
          : ` Partial batch rolled back (removed) — database left clean.`
        setSave({ state: 'error', msg: `Save FAILED: ${e.message}.${cleanup}` })
        return
      }

      const skipped = rows.length - newRows
      // If nothing new was added, the batch contributed nothing — remove the empty batch row.
      if (newRows === 0) { await supabase.from('opex_uploads').delete().eq('id', batchId) }

      const totalRes = await supabase.from('purchase_orders').select('id', { count: 'exact', head: true })
      const dbTotal = totalRes.error ? null : totalRes.count
      setSave({
        state: 'success',
        msg: `Added ${newRows} new row${newRows === 1 ? '' : 's'} · ${skipped} already existed (skipped) · database total: ${dbTotal ?? '?'}.`,
      })
    } finally {
      savingRef.current = false
    }
  }, [user])

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      const d = e.data
      if (!d || d.type !== 'opex:save') return
      handleSave(d)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [handleSave])

  return (
    <div className="opex-wrap">
      {save.state !== 'idle' && (
        <div className={`opex-savebar ${save.state}`} role="status">
          <span>{save.msg}</span>
          {save.state !== 'saving' && (
            <button type="button" className="btn" onClick={() => setSave({ state: 'idle', msg: '' })}>Dismiss</button>
          )}
        </div>
      )}
      <iframe ref={iframeRef} className="opex-frame" src="/opex/index.html" title="OPEX Dashboard" />
    </div>
  )
}
