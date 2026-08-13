// Auth layer for the dashboard. Tracks the Supabase Auth session and enforces
// the company domain rule. Front-end only — uses the existing publishable-key
// client (src/lib/supabaseClient.js). No secret key here.
//
// Domain restriction: only @jindalmumbai.com accounts are allowed. If any other
// account signs in, we sign it out immediately and surface `accessDenied` so the
// login screen can explain why. The `hd` hint on the Google call is UX only —
// the real gate is the client-side check below (and, later, RLS/server rules).
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

const ALLOWED_DOMAIN = 'jindalmumbai.com'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

function emailAllowed(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  // Admin-approval gate: every allowed user has a `profiles` row carrying
  // status (pending/approved/rejected) and role (admin/viewer). We fetch it once
  // per signed-in user. `profileFor` tracks WHICH user id the current profile
  // result belongs to, so the gate can tell "still loading" from "loaded, null".
  const [profile, setProfile] = useState(null)
  const [profileFor, setProfileFor] = useState(null)

  useEffect(() => {
    // If env isn't configured, don't hang on a spinner — fall through to the
    // login screen, which shows a clear "not configured" note.
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let active = true

    // Apply a session against the domain rule.
    // - Allowed Jindal session  -> store it, clear any denial.
    // - Disallowed session       -> reject: mark denied, sign out immediately.
    // - Null session             -> clear user, but LEAVE `accessDenied` as-is so
    //   the rejection sign-out (which fires a SIGNED_OUT event) keeps its message.
    async function apply(sess) {
      const email = sess?.user?.email
      if (sess && !emailAllowed(email)) {
        setAccessDenied(true)
        setSession(null)
        setUser(null)
        await supabase.auth.signOut()
        return
      }
      if (sess) setAccessDenied(false)
      setSession(sess ?? null)
      setUser(sess?.user ?? null)
    }

    // Initial check (resolves the loading gate; avoids a login-screen flash for
    // users who already have a valid session in storage).
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      apply(data.session)
      setLoading(false)
    })

    // Ongoing updates: sign-in redirect return, sign-out, token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!active) return
      apply(sess)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Fetch (or clear) the profile whenever the signed-in user changes.
  useEffect(() => {
    let active = true
    if (!user) {
      setProfile(null)
      setProfileFor(null)
      return
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setProfile(data ?? null) // null if the row isn't there yet -> treated as pending
        setProfileFor(user.id)
      })
    return () => {
      active = false
    }
  }, [user])

  // Re-fetch on demand (e.g. a pending user pressing "Check again", or an admin
  // acting on the approvals list and wanting their own view refreshed).
  async function refreshProfile() {
    if (!user) return null
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setProfile(data ?? null)
    setProfileFor(user.id)
    return data ?? null
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) return
    setAccessDenied(false) // fresh attempt clears any prior rejection message
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        // `hd` nudges Google's account chooser toward the company domain; the
        // authoritative check still happens in apply() after sign-in.
        queryParams: { hd: ALLOWED_DOMAIN, prompt: 'select_account' },
      },
    })
  }

  async function signOut() {
    setAccessDenied(false)
    if (isSupabaseConfigured) await supabase.auth.signOut()
  }

  // profileReady = we have a definitive profile result for the current user
  // (loaded, even if null). Used by the gate to avoid flashing the pending
  // screen during the fetch.
  const profileReady = !user || profileFor === user.id
  const profileStatus = profile?.status ?? 'pending' // no row yet -> pending
  const isAdmin = profile?.role === 'admin' && profile?.status === 'approved'

  const value = {
    session,
    user,
    loading,
    accessDenied,
    configured: isSupabaseConfigured,
    allowedDomain: ALLOWED_DOMAIN,
    profile,
    profileReady,
    profileStatus,
    isAdmin,
    refreshProfile,
    signInWithGoogle,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
