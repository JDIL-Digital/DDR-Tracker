// scripts/lib/run-logger.js
//
// Shared scheduler-monitoring helpers for the ingest pipelines. Two jobs:
//   * logRun()  — write exactly one row to public.run_log (migration 0033) via the
//                 server-side service_role client. NEVER throws (a logging failure
//                 must not break the actual ingest run).
//   * sendAlert() — email a failure alert via Resend (same pattern as
//                 daily-summary.js). NEVER throws.
//   * runWithLogging() — convenience wrapper: times a run, logs one heartbeat row
//                 (success / empty / error), and alerts on a thrown error.
//
// Env (from .env.local / Replit Secrets): SUPABASE_SECRET_KEY + VITE_SUPABASE_URL
// (via getServerClient), and for alerts RESEND_API_KEY / RESEND_FROM / RESEND_TO.
//
// Safe-test switches (used only by dry-run proofs; never set in production):
//   RUNLOG_DRY_RUN=1 → logRun prints the row it WOULD insert, writes nothing.
//   ALERT_DRY_RUN=1  → sendAlert prints the mail it WOULD send, sends nothing.

import { getServerClient } from '../supabase-server.js'

// --- Write one run_log row. Never throws. -----------------------------------
export async function logRun({
  job,
  status,
  startedAt,
  finishedAt,
  emailsFound,
  reportsSaved,
  errorMessage,
  details,
} = {}) {
  const row = {
    job,
    status,
    started_at: startedAt ?? null,
    emails_found: emailsFound ?? null,
    reports_saved: reportsSaved ?? null,
    error_message: errorMessage ?? null,
    details: details ?? null,
  }
  // finished_at defaults to now() in the DB; only set it if a caller supplies one.
  if (finishedAt) row.finished_at = finishedAt

  if (process.env.RUNLOG_DRY_RUN === '1') {
    console.log('[run-logger] DRY — would insert run_log row:', JSON.stringify(row))
    return { dryRun: true, row }
  }

  try {
    const supabase = getServerClient()
    const { error } = await supabase.from('run_log').insert(row)
    if (error) {
      console.error(`[run-logger] run_log insert failed (continuing): ${error.message}`)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (e) {
    console.error(`[run-logger] run_log insert threw (continuing): ${e.message}`)
    return { ok: false, error: e.message }
  }
}

// --- Send a failure alert via Resend. Never throws. -------------------------
export async function sendAlert({ subject, body } = {}) {
  if (process.env.ALERT_DRY_RUN === '1') {
    console.log(`[run-logger] ALERT DRY — would send:\n  subject: ${subject}\n  body:\n${body}`)
    return { dryRun: true }
  }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  const to = process.env.RESEND_TO
  if (!apiKey || !from || !to) {
    const missing = [!apiKey && 'RESEND_API_KEY', !from && 'RESEND_FROM', !to && 'RESEND_TO']
      .filter(Boolean)
      .join(', ')
    console.error(`[run-logger] alert NOT sent — missing ${missing}`)
    return { ok: false, reason: 'missing-resend-env' }
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to: to.split(',').map((s) => s.trim()),
      subject,
      text: body,
    })
    if (error) {
      console.error(`[run-logger] alert send failed: ${JSON.stringify(error)}`)
      return { ok: false }
    }
    console.log(`[run-logger] alert sent id=${data?.id}`)
    return { ok: true }
  } catch (e) {
    console.error(`[run-logger] alert send threw: ${e.message}`)
    return { ok: false }
  }
}

// --- Run a job with heartbeat logging + failure alerting. --------------------
// Runs mainFn(), then writes exactly one run_log row:
//   * mainFn resolves, summary.failedItems has >=1 entry → 'partial' + sendAlert
//     (some items failed to parse/save but the run itself did useful work; EXIT 0)
//   * mainFn resolves, reportsSaved > 0, no item failures  → 'success' (quiet)
//   * mainFn resolves, nothing new saved, no item failures → 'empty'   (quiet)
//   * mainFn throws (whole run crashed)                    → 'error' + sendAlert,
//     then rethrow (caller exits non-zero)
// `log` gates the DB write + alert (pass doSave): a dry run prints what it WOULD
// do and writes/sends nothing, preserving the scripts' "nothing written" contract.
export async function runWithLogging(job, mainFn, { log = true } = {}) {
  const startedAt = new Date().toISOString()
  try {
    const summary = (await mainFn()) || {}
    const reportsSaved = Number(summary.reportsSaved || 0)
    const emailsFound = Number(summary.emailsFound || 0)
    const failedItems = Array.isArray(summary.failedItems) ? summary.failedItems : []
    const baseDetails = summary.details ?? null
    const date = startedAt.slice(0, 10)

    // PARTIAL — the run completed, but one or more items failed to parse/save.
    // Alert (so the failures are seen) but EXIT 0 (the run did useful work).
    if (failedItems.length > 0) {
      const details = { ...(baseDetails || {}), failed_count: failedItems.length, failed_items: failedItems }
      if (log) {
        await logRun({ job, status: 'partial', startedAt, emailsFound, reportsSaved, details })
        const lines = failedItems
          .map((f, i) => {
            const who = [f.rig, f.date].filter(Boolean).join(' ') || '(unknown item)'
            const mid = f.message_id ? ` [${f.message_id}]` : ''
            return `  ${i + 1}. ${who}${mid} — ${f.reason}`
          })
          .join('\n')
        await sendAlert({
          subject: `[JDIL-Orbit] ${job} PARTIAL — ${failedItems.length} item(s) failed ${date}`,
          body: `${job} run at ${startedAt} completed with ${failedItems.length} failed item(s) (${reportsSaved} saved, ${emailsFound} found):\n\n${lines}`,
        })
      } else {
        console.log(
          `[run-logger] (dry) would log 'partial' run_log row + alert for ${job}: ${failedItems.length} item(s) failed, ${reportsSaved} saved, ${emailsFound} found`
        )
      }
      return summary
    }

    const status = reportsSaved > 0 ? 'success' : 'empty'
    if (log) {
      await logRun({ job, status, startedAt, emailsFound, reportsSaved, details: baseDetails })
    } else {
      console.log(
        `[run-logger] (dry) would log '${status}' run_log row for ${job}: emails_found=${emailsFound} reports_saved=${reportsSaved}`
      )
    }
    return summary
  } catch (err) {
    const date = startedAt.slice(0, 10)
    const errorMessage = err?.message || String(err)
    const details = { stack: err?.stack || null, job, started_at: startedAt }
    if (log) {
      await logRun({ job, status: 'error', startedAt, errorMessage, details })
      await sendAlert({
        subject: `[JDIL-Orbit] ${job} FAILED ${date}`,
        body: `${job} run failed at ${startedAt}\n\n${errorMessage}\n\n${err?.stack || '(no stack)'}`,
      })
    } else {
      console.log(
        `[run-logger] (dry) would log 'error' run_log row + send alert for ${job}: ${errorMessage}`
      )
    }
    throw err
  }
}
