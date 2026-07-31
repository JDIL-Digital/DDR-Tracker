// Settings data layer. READ-ONLY via the front-end (publishable-key) client.
// Only Activity Codes has a real backing table (code_master); everything else in
// Settings is honest placeholder until its feature lands (auth/profiles, GTO,
// email recipients), so there is nothing else to fetch here.
import { supabase } from '../lib/supabaseClient'
import { cached } from './dataCache'

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
