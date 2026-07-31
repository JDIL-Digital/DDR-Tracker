// Lightweight in-memory cache for the read-only dashboard loaders.
// - ~60s TTL, keyed by loaderName + JSON(args).
// - Stores the in-flight PROMISE, so React StrictMode's dev double-invoke (two
//   mounts) shares ONE network round-trip instead of firing twice.
// - Module-level → naturally cleared on a full page reload.
//
// Cache-busting on window change is automatic: the date window is part of the
// args, so a new window produces a different key and a fresh fetch — a stale
// window's entry is simply never read. Rig selection is applied client-side in
// the views (loaders fetch all rigs), so it never needs a bust. bustCache() is
// exported for explicit invalidation if ever needed.
import { supabase } from '../lib/supabaseClient'

const DEFAULT_TTL = 60_000
const store = new Map() // key -> { at, promise }

export function cached(name, args, fn, ttl = DEFAULT_TTL) {
  const key = `${name}:${JSON.stringify(args ?? [])}`
  const hit = store.get(key)
  const now = Date.now()
  if (hit && now - hit.at < ttl) return hit.promise
  const promise = Promise.resolve()
    .then(fn)
    .catch((err) => {
      store.delete(key) // never cache a failure — allow retry
      throw err
    })
  store.set(key, { at: now, promise })
  return promise
}

export function bustCache(prefix) {
  if (!prefix) {
    store.clear()
    return
  }
  for (const k of [...store.keys()]) if (k.startsWith(`${prefix}:`)) store.delete(k)
}

// One-time, error-free detection of whether reports.planned_rop exists yet.
// select('*') on a single row and check for the key — we never request a
// column that doesn't exist, so there is no 400 / console error. Memoized for
// the session; when the column is added later, a fresh session picks it up
// automatically.
let plannedRopPromise = null
export function plannedRopSupported() {
  if (!plannedRopPromise) {
    plannedRopPromise = supabase
      .from('reports')
      .select('*')
      .limit(1)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return false
        return Object.prototype.hasOwnProperty.call(data[0], 'planned_rop')
      })
      .catch(() => false)
  }
  return plannedRopPromise
}
