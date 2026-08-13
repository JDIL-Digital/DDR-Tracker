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
