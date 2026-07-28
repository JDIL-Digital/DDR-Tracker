import { createClient } from '@supabase/supabase-js'

// Front-end Supabase client.
// Reads ONLY the browser-safe values. The secret key (SUPABASE_SECRET_KEY) is
// intentionally never referenced here — it must stay server-side only.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

// Only create the client when both values are present, so a missing .env.local
// produces a clear message instead of a cryptic crash at import time.
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey)
  : null
