// Search index for the top-bar search. READ-ONLY via the front-end client.
// Small, client-side-filterable index of the three things we can search today:
// rig names, well numbers, and activity codes (code + description). Report-content
// search can be added later. Cached like the other loaders.
import { supabase } from '../lib/supabaseClient'
import { cached } from './dataCache'
import { FLEET_ROSTER, rigOrderMap, compareRigNames } from './fleet'

async function _loadSearchIndex() {
  if (!supabase) throw new Error('Supabase is not configured (check .env.local VITE_ vars).')

  const [rigsRes, codesRes, repsRes] = await Promise.all([
    supabase.from('rigs').select('id, name, sort_order'),
    supabase.from('code_master').select('code, description, condition, is_npt'),
    supabase.from('reports').select('well_no, rig_id, report_date'),
  ])
  for (const r of [rigsRes, codesRes, repsRes]) if (r.error) throw new Error(r.error.message)

  const rigs = rigsRes.data || []
  const codes = codesRes.data || []
  const reports = repsRes.data || []

  const orderMap = rigOrderMap(rigs)
  const rigNameById = new Map(rigs.map((r) => [r.id, r.name]))

  // Rigs — full roster + any DB rigs, in fixed fleet order.
  const rigNames = [...new Set([...FLEET_ROSTER, ...rigs.map((r) => r.name)])].sort(compareRigNames(orderMap))
  const rigItems = rigNames.map((name) => ({ name }))

  // Wells — distinct well_no, tagged with the rig on it most recently.
  const wellMap = new Map()
  for (const rep of reports) {
    const w = rep.well_no
    if (!w) continue
    const rig = rigNameById.get(rep.rig_id) || null
    const prev = wellMap.get(w)
    if (!prev || (rep.report_date || '') > (prev.date || '')) wellMap.set(w, { well: w, rig, date: rep.report_date || null })
  }
  const wellItems = [...wellMap.values()]

  // Activity codes — code + description (+ condition for the tag).
  const codeItems = codes.map((c) => ({ code: c.code, description: c.description, condition: c.condition, is_npt: c.is_npt }))

  return { rigs: rigItems, wells: wellItems, codes: codeItems }
}

export function loadSearchIndex() {
  return cached('searchIndex', [], () => _loadSearchIndex())
}
