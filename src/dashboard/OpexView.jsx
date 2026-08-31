// OpexView — OPEX Stage 2a Step 2.
//
// Embeds the standalone OPEX dashboard (public/opex/index.html) via an iframe
// (black box — parse/calc/KPI logic untouched) AND adds a save-through-parent
// path: the iframe posts its already-parsed rows via postMessage; THIS parent
// component maps them to the purchase_orders schema and inserts them with the
// app's existing authenticated Supabase client (so RLS is_approved() gates it).
// The iframe never touches Supabase, keys, or the session.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../auth/AuthProvider'

const CHUNK = 500 // rows per insert call — keeps payload well under limits for 6k+ uploads

// FNV-1a 32-bit → 8-char hex. Stable row fingerprint for future dedup.
function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return ('00000000' + h.toString(16)).slice(-8)
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

// Map one parsed dashboard row -> a purchase_orders record (mapping confirmed:
// department=null; local usd_equivalent=null; local amount=BaseAmt (pre-GST),
// amount_to_vendor=AmountOriginal (total incl GST); import amount=AmountOriginal,
// usd_equivalent=AmountUSD).
function mapRow(r, batchId) {
  const source = r.Source === 'Local' ? 'local' : 'import'
  const location = str(r.Location)
  const po_number = str(r.PONumber)
  const order_date = toISODate(r.Date)
  const description = str(r.Description)
  const amount = source === 'local' ? num(r.BaseAmt) : num(r.AmountOriginal)
  const fingerprint = fnv1a([source, po_number || '', location || '', amount == null ? '' : amount, order_date || '', description || ''].join('|'))
  return {
    upload_batch_id: batchId,
    source,
    location,
    po_number,
    order_date,
    status: str(r.Status),
    vendor: str(r.Vendor),
    description,
    department: null,                                            // not parsed by the dashboard
    currency: str(r.Currency),
    amount,
    gst_amount: source === 'local' ? num(r.GST) : null,
    amount_to_vendor: source === 'local' ? num(r.AmountOriginal) : null,
    usd_equivalent: source === 'import' ? num(r.AmountUSD) : null, // local = null (file has none)
    row_fingerprint: fingerprint,
    raw: r,
  }
}

export default function OpexView() {
  const { user } = useAuth()
  const iframeRef = useRef(null)
  const savingRef = useRef(false) // guard against double-fire
  const [save, setSave] = useState({ state: 'idle', msg: '' }) // idle | saving | success | error

  const handleSave = useCallback(async (payload) => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      const localRows = Array.isArray(payload.local) ? payload.local : []
      const importRows = Array.isArray(payload.import) ? payload.import : []
      const total = localRows.length + importRows.length
      if (!total) { setSave({ state: 'error', msg: 'No rows received from the dashboard — nothing saved.' }); return }
      setSave({ state: 'saving', msg: `Saving ${total} rows to database…` })

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

      // 2. Map + chunked insert of purchase_orders.
      const rows = [...localRows, ...importRows].map((r) => mapRow(r, batchId))
      let inserted = 0
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const chunk = rows.slice(i, i + CHUNK)
          const { error } = await supabase.from('purchase_orders').insert(chunk)
          if (error) throw new Error(error.message)
          inserted += chunk.length
          setSave({ state: 'saving', msg: `Saving… ${inserted}/${rows.length} rows` })
        }
      } catch (e) {
        // Roll back: delete the batch (cascade removes any partial purchase_orders).
        const del = await supabase.from('opex_uploads').delete().eq('id', batchId)
        const cleanup = del.error
          ? ` ⚠️ Batch ${batchId} could NOT be auto-removed (${del.error.message}) — run migration 0019, then delete it via service-role.`
          : ` Partial batch rolled back (removed) — database left clean.`
        setSave({ state: 'error', msg: `Save FAILED after ${inserted}/${rows.length} rows: ${e.message}.${cleanup}` })
        return
      }

      // 3. Verify ACTUAL stored counts from the DB (not just what we sent).
      const countBy = async (src) => {
        const { count, error } = await supabase.from('purchase_orders')
          .select('id', { count: 'exact', head: true }).eq('upload_batch_id', batchId).eq('source', src)
        return error ? null : count
      }
      const localStored = await countBy('local')
      const importStored = await countBy('import')
      const totalStored = (localStored ?? 0) + (importStored ?? 0)
      setSave({
        state: 'success',
        msg: `Saved ${localStored ?? '?'} local rows + ${importStored ?? '?'} import rows = ${totalStored} total to database.`,
      })
    } finally {
      savingRef.current = false
    }
  }, [user])

  useEffect(() => {
    function onMessage(e) {
      // Same-origin guard: only accept messages from our own iframe.
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
