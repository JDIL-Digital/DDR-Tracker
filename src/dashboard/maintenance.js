// Maintenance (DMR) data layer. READ via the front-end (publishable-key) client;
// writes (upload/delete/status-edit) are admin-only, enforced by RLS (migration
// 0015). Nothing is fabricated — absent data shows as honest empty.
import { supabase } from '../lib/supabaseClient'
import { todayISO } from './format'

const BUCKET = 'maintenance-reports'

// Uploaded DMRs, newest first, with the rig name joined in.
export async function loadMaintenanceReports() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase
    .from('maintenance_reports')
    .select('id, rig_id, report_date, source_file_name, source_file_path, extraction_status, created_at, raw_extract, rigs(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []).map((r) => ({ ...r, rig_name: r.rigs?.name || null }))
}

// Activities for one report (department-wise), stable order.
export async function loadMaintenanceActivities(reportId) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase
    .from('maintenance_activities')
    .select('id, department, chief_in_charge, activity_text, activity_kind, status, created_at')
    .eq('report_id', reportId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// Activities across several reports (for the "Overall" cumulative scope). Carries
// report_id so the caller can attribute each activity to its DMR.
export async function loadMaintenanceActivitiesForReports(reportIds) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!reportIds || !reportIds.length) return []
  const { data, error } = await supabase
    .from('maintenance_activities')
    .select('id, report_id, department, chief_in_charge, activity_text, activity_kind, status, created_at')
    .in('report_id', reportIds)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// Admin: correct a last-day activity's classification.
export async function updateActivityStatus(id, status) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!['completed', 'pending', 'routine'].includes(status)) throw new Error('Invalid status.')
  const { error } = await supabase.from('maintenance_activities').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
}

// Store a DMR .docx in the bucket + insert its row (status 'uploaded'). Admin-only (RLS).
export async function uploadMaintenanceReport({ rigId, reportDate, file, userId }) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!file) throw new Error('No file selected.')
  if (!rigId) throw new Error('Pick a rig.')
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext !== 'docx') throw new Error('Only .docx DMR files are accepted.')

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${crypto.randomUUID()}-${safe}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`)

  const { error } = await supabase.from('maintenance_reports').insert({
    rig_id: rigId,
    report_date: reportDate || todayISO(),
    source_file_path: up.data.path,
    source_file_name: file.name,
    extraction_status: 'uploaded',
    uploaded_by: userId || null,
  })
  if (error) throw new Error(`Saved file but the record insert failed: ${error.message}`)
}

// Delete a report AND its stored file. File first, so a successful row delete
// can't leave an orphan. Activities cascade-delete with the row (FK on delete cascade).
export async function deleteMaintenanceReport(id, sourceFilePath) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (sourceFilePath) {
    const { error: sErr } = await supabase.storage.from(BUCKET).remove([sourceFilePath])
    if (sErr) throw new Error(`Could not delete the stored file: ${sErr.message}`)
  }
  const { error } = await supabase.from('maintenance_reports').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Short-lived signed URL to view/download a DMR file (private bucket).
export async function signedUrlForMaintenance(sourceFilePath, expiresIn = 300) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!sourceFilePath) throw new Error('This report has no stored file.')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(sourceFilePath, expiresIn)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// Monthly rollup: completed vs pending last-day activities this month, per rig
// and per department. Computed from two reads (reports in month → their
// activities) and grouped client-side — robust across PostgREST join quirks.
export async function loadMaintenanceRollup(monthStart, monthEnd) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const repRes = await supabase
    .from('maintenance_reports')
    .select('id, rig_id, report_date, rigs(name)')
    .gte('report_date', monthStart)
    .lte('report_date', monthEnd)
  if (repRes.error) throw new Error(repRes.error.message)
  const reports = repRes.data || []
  if (!reports.length) return { byRig: [], byDept: [], reportCount: 0 }

  const idToRig = new Map(reports.map((r) => [r.id, r.rigs?.name || '—']))
  const ids = reports.map((r) => r.id)

  const actRes = await supabase
    .from('maintenance_activities')
    .select('report_id, department, status, activity_kind')
    .in('report_id', ids)
    .eq('activity_kind', 'last_day')
  if (actRes.error) throw new Error(actRes.error.message)
  const acts = actRes.data || []

  const bump = (map, key) => {
    const cur = map.get(key) || { completed: 0, pending: 0, routine: 0 }
    return cur
  }
  const rigMap = new Map()
  const deptMap = new Map()
  for (const a of acts) {
    const rig = idToRig.get(a.report_id) || '—'
    const dept = a.department || 'other'
    const s = a.status || 'routine'
    const r = bump(rigMap, rig); r[s] = (r[s] || 0) + 1; rigMap.set(rig, r)
    const d = bump(deptMap, dept); d[s] = (d[s] || 0) + 1; deptMap.set(dept, d)
  }
  const toRows = (m) => [...m.entries()].map(([label, c]) => ({ label, ...c, total: c.completed + c.pending + c.routine }))
    .sort((a, b) => b.total - a.total)
  return { byRig: toRows(rigMap), byDept: toRows(deptMap), reportCount: reports.length }
}
