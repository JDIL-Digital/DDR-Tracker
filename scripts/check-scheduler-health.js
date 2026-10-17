// scripts/check-scheduler-health.js
//
// "Didn't-run" WATCHDOG for the ingest scheduler. The per-run heartbeat
// (scripts/lib/run-logger.js → run_log) can only tell us a run went wrong; it
// can't tell us a run NEVER HAPPENED (a dead/unpublished scheduler writes
// nothing at all). This job closes that gap: it checks whether ANY ingest run
// finished today (IST) and alerts if none did.
//
// WHAT IT DOES (service_role, read + a single heartbeat-check write):
//   * Computes "today" in IST (Asia/Kolkata, UTC+5:30).
//   * Looks for run_log rows with job in ('ingest-ddr','ingest-dmr') and status
//     in ('success','empty','partial') whose finished_at falls in today's IST day.
//   * >=1 found  → the scheduler ran (data or not). QUIET — no email. Writes a
//     job='heartbeat-check' status='success' row for the record.
//   * none found → the scheduler did NOT run. Sends a "SCHEDULER DID NOT RUN"
//     alert and writes job='heartbeat-check' status='error'. Exits non-zero.
//   * if the check itself can't query run_log → that's also alert-worthy: sends a
//     watchdog-error alert, writes status='error', exits non-zero.
//
// NEVER crashes silently: everything is wrapped; logRun/sendAlert never throw.
//
// INTENDED SCHEDULE: a SECOND scheduled command in the "JDIL DMR Scheduler"
// Replit project, run AFTER the last 9:30 IST ingest:
//     cron:  0 10 * * *   (10:00 AM IST, Asia/Kolkata)   ==   30 4 * * *  UTC
//     run:   node scripts/check-scheduler-health.js
//
// Env: SUPABASE_SECRET_KEY + VITE_SUPABASE_URL (getServerClient) and, for the
// alert, RESEND_API_KEY / RESEND_FROM / RESEND_TO (same as the ingest alerts).
// Safe-test switches (dry proofs only): RUNLOG_DRY_RUN=1, ALERT_DRY_RUN=1.

import { pathToFileURL } from 'node:url'
import { getServerClient } from './supabase-server.js'
import { logRun, sendAlert } from './lib/run-logger.js'

const INGEST_JOBS = ['ingest-ddr', 'ingest-dmr']
const OK_STATUSES = ['success', 'empty', 'partial']
const IST_OFFSET_MIN = 330 // Asia/Kolkata = UTC+5:30, no DST

// Today's IST calendar day, expressed as a [startUTC, endUTC) ISO window.
export function istDayWindowUTC(now = new Date()) {
  const istNow = new Date(now.getTime() + IST_OFFSET_MIN * 60000)
  const istDateStr = istNow.toISOString().slice(0, 10) // YYYY-MM-DD in IST
  const istMidnightUTCms = Date.parse(`${istDateStr}T00:00:00.000Z`) - IST_OFFSET_MIN * 60000
  return {
    istDateStr,
    startUTC: new Date(istMidnightUTCms).toISOString(),
    endUTC: new Date(istMidnightUTCms + 86400000).toISOString(),
    istClock: istNow.toISOString().slice(11, 16), // HH:MM IST (approx check time)
  }
}

// Default run_log query (service_role bypasses RLS). Throws on a query error so
// the caller can treat it as a watchdog failure.
async function defaultFetchRuns(startUTC, endUTC) {
  const supabase = getServerClient()
  const { data, error } = await supabase
    .from('run_log')
    .select('id, job, status, finished_at')
    .in('job', INGEST_JOBS)
    .in('status', OK_STATUSES)
    .gte('finished_at', startUTC)
    .lt('finished_at', endUTC)
  if (error) throw new Error(`run_log query failed: ${error.message}`)
  return data || []
}

// Core check. `fetchRuns` is injectable for tests; `log` gates the DB write +
// alert (kept true in production; the env dry-switches make tests side-effect-free).
// Returns { ran: true|false|null } — null means the check itself errored.
export async function checkSchedulerHealth({ now = new Date(), fetchRuns = defaultFetchRuns, log = true } = {}) {
  const { istDateStr, startUTC, endUTC, istClock } = istDayWindowUTC(now)

  let rows
  try {
    rows = await fetchRuns(startUTC, endUTC)
  } catch (e) {
    console.error(`[watchdog] CHECK FAILED — could not query run_log: ${e.message}`)
    if (log) {
      await logRun({
        job: 'heartbeat-check',
        status: 'error',
        errorMessage: `watchdog query failed: ${e.message}`,
        details: { ist_date: istDateStr, stack: e.stack || null },
      })
      await sendAlert({
        subject: `[JDIL-Orbit] SCHEDULER WATCHDOG ERROR — ${istDateStr}`,
        body: `The scheduler health check could not query run_log at ${istClock} IST:\n\n${e.message}\n\nIt could NOT determine whether the ingest runs fired today — investigate the watchdog / DB connection.`,
      })
    } else {
      console.log('[watchdog] (dry) would log heartbeat-check \'error\' + send WATCHDOG ERROR alert')
    }
    return { ran: null, error: e.message }
  }

  if (rows.length > 0) {
    const jobs = [...new Set(rows.map((r) => r.job))].join(', ')
    console.log(`[watchdog] OK — ${rows.length} ingest heartbeat row(s) for IST ${istDateStr} (${jobs}). Scheduler ran; staying quiet.`)
    if (log) {
      await logRun({
        job: 'heartbeat-check',
        status: 'success',
        details: {
          ist_date: istDateStr,
          found: rows.length,
          runs: rows.map((r) => ({ job: r.job, status: r.status, finished_at: r.finished_at })),
        },
      })
    } else {
      console.log('[watchdog] (dry) would log heartbeat-check \'success\' (quiet — no alert)')
    }
    return { ran: true, found: rows.length }
  }

  // No ingest heartbeat today — the scheduler did not run.
  console.error(`[watchdog] ALERT — no ingest heartbeat for IST ${istDateStr} by ${istClock} IST. Scheduler likely did not run.`)
  if (log) {
    await logRun({
      job: 'heartbeat-check',
      status: 'error',
      errorMessage: `no ingest run recorded for ${istDateStr} by ${istClock} IST`,
      details: { ist_date: istDateStr, window: { startUTC, endUTC } },
    })
    await sendAlert({
      subject: `[JDIL-Orbit] SCHEDULER DID NOT RUN — ${istDateStr}`,
      body:
        `No ingest heartbeat (ingest-ddr / ingest-dmr with status success/empty/partial) was recorded in run_log for ${istDateStr} (IST) by ${istClock} IST.\n\n` +
        `The scheduled 7:30 / 8:30 / 9:30 AM IST runs likely did NOT fire. Check the "JDIL DMR Scheduler" Replit deployment:\n` +
        `  • Is it published / enabled?  • Did the cron trigger?  • Any crash in the run logs?\n\n` +
        `(Checked at ${istClock} IST.)`,
    })
  } else {
    console.log('[watchdog] (dry) would log heartbeat-check \'error\' + send "SCHEDULER DID NOT RUN" alert')
  }
  return { ran: false }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  checkSchedulerHealth()
    .then((r) => {
      // Exit non-zero if the scheduler didn't run OR the check itself errored, so
      // the condition is also visible in the Replit scheduled-run logs.
      if (r.ran !== true) process.exitCode = 1
    })
    .catch((err) => {
      // Last-resort guard — checkSchedulerHealth shouldn't throw, but never crash silently.
      console.error('[watchdog] unexpected error:', err?.message || err)
      process.exitCode = 1
    })
}
