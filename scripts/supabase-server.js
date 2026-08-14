// scripts/supabase-server.js
//
// SERVER-SIDE ONLY. This module uses the Supabase SECRET key and must NEVER be
// imported into any front-end / browser bundle (nothing under src/). It is only
// used by Node scripts (e.g. scripts/extract-ddr.js --save).
//
// Responsible for writing an extracted DDR record into Supabase. It does not do
// any extraction — it only persists the JSON that extractDDR() produces.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// --- Minimal .env.local loader (self-contained; server key never hardcoded) --
function ensureEnvLoaded() {
  if (process.env.SUPABASE_SECRET_KEY && process.env.VITE_SUPABASE_URL) return
  let text
  try {
    text = readFileSync('.env.local', 'utf8')
  } catch {
    return // fall through to the explicit check below
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const val = line.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = val
  }
}

// --- Server-side client (SECRET key + project URL) --------------------------
export function getServerClient() {
  ensureEnvLoaded()
  const url = process.env.VITE_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!url) throw new Error('VITE_SUPABASE_URL missing from .env.local')
  if (!secret) throw new Error('SUPABASE_SECRET_KEY missing from .env.local')
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Await a Supabase call and throw a clear, labelled error on failure.
async function must(builder, label) {
  const { data, error } = await builder
  if (error) throw new Error(`${label} failed: ${error.message}`)
  return data
}

/**
 * Persist an extracted DDR into Supabase — ATOMICALLY.
 *
 * The rig/report/activities/inventory write happens inside ONE database
 * transaction via the save_ddr_report(payload jsonb) RPC (migration 0009). If
 * any step fails, the whole write rolls back — there is no partial report. This
 * module only builds a clean payload (code validation, extraction_status,
 * nulling unknown codes); the RPC does all the DB work.
 *
 * @param {object} data              the JSON returned by extractDDR()
 * @param {object} opts
 * @param {boolean} opts.validationPassed  result of the extractor's validate()
 * @returns {Promise<object>} summary of what was written
 */
export async function saveReport(data, { validationPassed }) {
  const supabase = getServerClient()

  if (!data.rig_name || String(data.rig_name).trim() === '') {
    throw new Error('rig_name is empty; cannot resolve a rig.')
  }

  // Source-of-truth code list is the DB code_master (also what the FK enforces).
  const codeRows = await must(supabase.from('code_master').select('code'), 'load code_master')
  const validCodes = new Set(codeRows.map((r) => r.code))

  const activities = Array.isArray(data.activities) ? data.activities : []
  const inventory = Array.isArray(data.inventory) ? data.inventory : []

  // Any activity code not in code_master is a review trigger (and gets nulled).
  const unknownCodes = [...new Set(activities.map((a) => a.code).filter((c) => !validCodes.has(c)))]

  // extraction_status: 'ok' only if validation passed AND every code is known.
  const extractionStatus = validationPassed && unknownCodes.length === 0 ? 'ok' : 'needs_review'

  // Build child rows (no report_id — the RPC assigns it). Unknown codes are
  // nulled here so the RPC's insert is FK-safe.
  const activityRows = activities.map((a, i) => ({
    seq: i + 1,
    time_from: a.time_from ?? null,
    time_to: a.time_to ?? null,
    hrs: a.hrs ?? null,
    code: validCodes.has(a.code) ? a.code : null,
    depth_in_m: a.depth_in_m ?? null,
    depth_out_m: a.depth_out_m ?? null,
    remarks: a.remarks ?? null,
  }))
  const inventoryRows = inventory.map((r) => ({
    item: r.item ?? null,
    unit: r.unit ?? null,
    opening: r.opening ?? null,
    received: r.received ?? null,
    generated: r.generated ?? null,
    consumed: r.consumed ?? null,
    closing: r.closing ?? null,
  }))

  const payload = {
    rig_name: data.rig_name,
    well_no: data.well_no ?? null,
    report_no: data.report_no ?? null,
    report_date: data.report_date,
    depth_md_m: data.depth_md_m ?? null,
    day_meterage_m: data.day_meterage_m ?? null,
    fuel_consumed_kl: data.fuel_consumed_kl ?? null,
    extraction_status: extractionStatus,
    raw_extract: data,
    activities: activityRows,
    inventory: inventoryRows,
  }

  try {
    // One atomic call — all-or-nothing inside the DB.
    const summary = await must(supabase.rpc('save_ddr_report', { payload }), 'save_ddr_report RPC')

    return {
      rigName: data.rig_name,
      rigId: summary.rig_id,
      rigCreated: summary.rig_created,
      reportId: summary.report_id,
      reportAction: summary.report_action,
      activitiesWritten: summary.activities_written,
      inventoryWritten: summary.inventory_written,
      nulledCodeCount: activityRows.filter((r) => r.code === null).length,
      unknownCodes,
      extractionStatus,
    }
  } catch (err) {
    // The RPC is atomic: on failure the transaction rolled back, so the DB is
    // unchanged (no partial write). Fix the cause and re-run --save.
    throw new Error(`saveReport failed (atomic RPC rolled back — no partial write; fix and re-run --save): ${err.message}`)
  }
}
