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
 * Persist an extracted DDR into Supabase.
 *
 * Order of operations:
 *  a. find-or-create the rig by name
 *  b. upsert the report on (rig_id, report_date) so a re-run UPDATES in place
 *  c. clean-replace the child rows (delete then insert activities + inventory)
 *
 * @param {object} data              the JSON returned by extractDDR()
 * @param {object} opts
 * @param {boolean} opts.validationPassed  result of the extractor's validate()
 * @returns {Promise<object>} summary of what was written
 */
export async function saveReport(data, { validationPassed }) {
  const supabase = getServerClient()

  // Source-of-truth code list is the DB code_master (also what the FK enforces).
  const codeRows = await must(supabase.from('code_master').select('code'), 'load code_master')
  const validCodes = new Set(codeRows.map((r) => r.code))

  const activities = Array.isArray(data.activities) ? data.activities : []
  const inventory = Array.isArray(data.inventory) ? data.inventory : []

  // Any activity code not in code_master is a review trigger (and gets nulled).
  const unknownCodes = [...new Set(activities.map((a) => a.code).filter((c) => !validCodes.has(c)))]

  // extraction_status: 'ok' only if validation passed AND every code is known.
  const extractionStatus = validationPassed && unknownCodes.length === 0 ? 'ok' : 'needs_review'

  try {
    // --- (a) rig: find or create --------------------------------------------
    if (!data.rig_name || String(data.rig_name).trim() === '') {
      throw new Error('rig_name is empty; cannot resolve a rig.')
    }
    let rigId
    let rigCreated = false
    const existingRig = await must(
      supabase.from('rigs').select('id').eq('name', data.rig_name).maybeSingle(),
      'look up rig'
    )
    if (existingRig) {
      rigId = existingRig.id
    } else {
      const newRig = await must(
        supabase.from('rigs').insert({ name: data.rig_name, rig_type: null }).select('id').single(),
        'insert rig'
      )
      rigId = newRig.id
      rigCreated = true
    }

    // --- (b) report: upsert on (rig_id, report_date) ------------------------
    // Pre-check to report insert vs update (upsert alone doesn't tell us which).
    const priorReport = await must(
      supabase
        .from('reports')
        .select('id')
        .eq('rig_id', rigId)
        .eq('report_date', data.report_date)
        .maybeSingle(),
      'look up existing report'
    )
    const reportAction = priorReport ? 'updated' : 'inserted'

    const reportRow = {
      rig_id: rigId,
      well_no: data.well_no ?? null,
      report_no: data.report_no ?? null,
      report_date: data.report_date,
      depth_md_m: data.depth_md_m ?? null,
      day_meterage_m: data.day_meterage_m ?? null,
      fuel_consumed_kl: data.fuel_consumed_kl ?? null,
      extraction_status: extractionStatus,
      raw_extract: data,
    }
    const report = await must(
      supabase
        .from('reports')
        .upsert(reportRow, { onConflict: 'rig_id,report_date' })
        .select('id')
        .single(),
      'upsert report'
    )
    const reportId = report.id

    // --- (c) children: clean replace ----------------------------------------
    // Build the payloads BEFORE deleting, so a bad payload fails before we
    // remove the old rows.
    const activityRows = activities.map((a, i) => ({
      report_id: reportId,
      seq: i + 1,
      time_from: a.time_from ?? null,
      time_to: a.time_to ?? null,
      hrs: a.hrs ?? null,
      code: validCodes.has(a.code) ? a.code : null, // null unknown codes (keeps the row, FK-safe)
      depth_in_m: a.depth_in_m ?? null,
      depth_out_m: a.depth_out_m ?? null,
      remarks: a.remarks ?? null,
      // meterage_m is a GENERATED column — never inserted.
    }))
    const inventoryRows = inventory.map((r) => ({
      report_id: reportId,
      item: r.item ?? null,
      unit: r.unit ?? null,
      opening: r.opening ?? null,
      received: r.received ?? null,
      generated: r.generated ?? null,
      consumed: r.consumed ?? null,
      closing: r.closing ?? null,
    }))

    await must(supabase.from('activities').delete().eq('report_id', reportId), 'delete old activities')
    await must(supabase.from('inventory').delete().eq('report_id', reportId), 'delete old inventory')

    if (activityRows.length) {
      await must(supabase.from('activities').insert(activityRows), 'insert activities')
    }
    if (inventoryRows.length) {
      await must(supabase.from('inventory').insert(inventoryRows), 'insert inventory')
    }

    return {
      rigName: data.rig_name,
      rigId,
      rigCreated,
      reportId,
      reportAction,
      activitiesWritten: activityRows.length,
      inventoryWritten: inventoryRows.length,
      nulledCodeCount: activityRows.filter((r) => r.code === null).length,
      unknownCodes,
      extractionStatus,
    }
  } catch (err) {
    // Note: supabase-js has no client-side multi-table transaction. Every step
    // here is idempotent (find-or-create rig, upsert report, delete+insert
    // children), so re-running --save heals a partially-applied write. We still
    // surface the failure loudly rather than pretending it succeeded.
    throw new Error(`saveReport aborted (DB may be partially updated; re-run --save to heal): ${err.message}`)
  }
}
