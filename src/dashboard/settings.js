// Settings data layer. READ-ONLY via the front-end (publishable-key) client.
// Only Activity Codes has a real backing table (code_master); everything else in
// Settings is honest placeholder until its feature lands (auth/profiles, GTO,
// email recipients), so there is nothing else to fetch here.
import { supabase } from '../lib/supabaseClient'
import { cached } from './dataCache'

// --- Admin Approvals (profiles) --------------------------------------------
// NOT cached: this list is mutable (approve/reject) and admin-only. RLS lets an
// approved admin read/update every row; a viewer's read returns only their own.

export async function loadProfiles() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, status, created_at, approved_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

// Approve or reject a profile. adminId is the acting admin's user id (stored as
// approved_by for the audit trail). Enforced server-side by the RLS update policy.
export async function setProfileStatus(id, status, adminId) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { error } = await supabase
    .from('profiles')
    .update({ status, approved_at: new Date().toISOString(), approved_by: adminId })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// --- Well Plans (Stage 1: upload + list only) ------------------------------
const WELL_PLANS_BUCKET = 'well-plans'

// Rigs for the upload picker (approved users can read rigs via RLS).
export async function loadRigsForPicker() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase.from('rigs').select('id, name, sort_order')
  if (error) throw new Error(error.message)
  return (data || []).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.name).localeCompare(b.name))
}

// Uploaded well plans, newest first, with the rig name joined in.
export async function loadWellPlans() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const { data, error } = await supabase
    .from('well_plans')
    .select('id, well_name, well_type, source_file_name, source_file_path, extraction_status, created_at, rig_id, target_depth_m, planned_milestones, planned_depth_points, depths_verified, well_history, raw_extract, rigs(name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []).map((r) => ({ ...r, rig_name: r.rigs?.name || null }))
}

// Edit a plan's metadata (admins only — RLS enforces). File replacement is not
// supported here; only rig / well_name / well_type.
export async function updateWellPlan(id, { rigId, wellName, wellType }) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!wellType) throw new Error('Pick a well type.')
  const { error } = await supabase
    .from('well_plans')
    .update({ rig_id: rigId || null, well_name: wellName?.trim() || null, well_type: wellType })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Save admin-verified planned depth points (Depth-vs-Days Part 1). Writes the
// edited points array and flips depths_verified=true — the chart (Part 2) only
// trusts depths once this flag is set. Admins only (RLS "admin update well_plans").
export async function updateWellPlanDepths(id, points) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  const clean = (Array.isArray(points) ? points : []).map((p) => ({
    activity: p.activity?.trim() || null,
    // Blank / non-numeric depth stays null — never coerced to 0.
    planned_depth_m: p.planned_depth_m === '' || p.planned_depth_m == null || Number.isNaN(Number(p.planned_depth_m))
      ? null : Number(p.planned_depth_m),
    phase_days: p.phase_days === '' || p.phase_days == null || Number.isNaN(Number(p.phase_days))
      ? null : Number(p.phase_days),
    cumulative_days: p.cumulative_days === '' || p.cumulative_days == null || Number.isNaN(Number(p.cumulative_days))
      ? null : Number(p.cumulative_days),
    depth_confidence: p.depth_confidence || 'high', // admin-verified defaults to high
  }))
  const { error } = await supabase
    .from('well_plans')
    .update({ planned_depth_points: clean, depths_verified: true })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// Delete a plan AND its stored file. The file is removed FIRST so a successful
// row delete can never leave an orphaned Storage object behind.
export async function deleteWellPlan(id, sourceFilePath) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (sourceFilePath) {
    const { error: sErr } = await supabase.storage.from(WELL_PLANS_BUCKET).remove([sourceFilePath])
    if (sErr) throw new Error(`Could not delete the stored file: ${sErr.message}`)
  }
  const { error } = await supabase.from('well_plans').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Short-lived signed URL to view/download a plan file (bucket is private, so a
// signed URL is required; only an authenticated approved user can create one).
export async function signedUrlForPlan(sourceFilePath, expiresIn = 300) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!sourceFilePath) throw new Error('This plan has no stored file.')
  const { data, error } = await supabase.storage.from(WELL_PLANS_BUCKET).createSignedUrl(sourceFilePath, expiresIn)
  if (error) throw new Error(error.message)
  return data.signedUrl
}

// Store a plan file in the 'well-plans' bucket and insert its row (status
// 'uploaded'). No extraction — Stage 1 just stores. Enforced by RLS (approved).
export async function uploadWellPlan({ rigId, wellName, wellType, file, userId }) {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
  if (!file) throw new Error('No file selected.')
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext !== 'pdf' && ext !== 'docx') throw new Error('Only .pdf and .docx files are accepted.')
  if (!wellType) throw new Error('Pick a well type.')

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${crypto.randomUUID()}-${safe}`

  const up = await supabase.storage.from(WELL_PLANS_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  })
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`)

  const { error } = await supabase.from('well_plans').insert({
    rig_id: rigId || null,
    well_name: wellName?.trim() || null,
    well_type: wellType,
    source_file_path: up.data.path,
    source_file_name: file.name,
    extraction_status: 'uploaded',
    uploaded_by: userId || null,
  })
  if (error) throw new Error(`Saved file but the record insert failed: ${error.message}`)
}

export function loadActivityCodes() {
  return cached('activityCodes', [], async () => {
    if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')
    const { data, error } = await supabase
      .from('code_master')
      .select('code, description, category, is_npt')
    if (error) throw new Error(error.message)

    const rows = data || []
    // Numeric codes (1..26) first in numeric order, then the rest (C1..) alphabetically.
    rows.sort((a, b) => {
      const aNum = /^\d+$/.test(a.code)
      const bNum = /^\d+$/.test(b.code)
      if (aNum && bNum) return Number(a.code) - Number(b.code)
      if (aNum) return -1
      if (bNum) return 1
      return String(a.code).localeCompare(String(b.code))
    })
    return rows
  })
}
