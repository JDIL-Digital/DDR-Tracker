// scripts/extract-server.js
//
// JDIL EXTRACT WORKER — a tiny HTTP server that runs the well-plan extractor
// server-side (where the ANTHROPIC + Supabase SECRET keys live; they must never
// reach the browser). The ORBIT web app is a static SPA with no backend, so this
// is deployed as its OWN Replit Autoscale service, imported from the same repo.
//
//   POST /extract   { well_plan_id }        Authorization: Bearer <supabase jwt>
//     1. verify the caller's Supabase access token (auth.getUser)
//     2. authorize: the caller's profiles row must be status='approved'
//        (ANY approved user — not admin-only)
//     3. reuse extractWellPlan() + saveExtraction() (NO duplicated extraction logic)
//     4. return JSON { status, method, detail, fields }  (or { status:'failed', error })
//   GET  /  |  /health                        liveness probe (no auth)
//
// CORS: only the configured ORBIT origins may call from a browser.
// Secrets (env / Replit Secrets): ANTHROPIC_API_KEY, VITE_SUPABASE_URL,
// SUPABASE_SECRET_KEY. Optional: PORT, ALLOWED_ORIGINS (comma-separated).

import http from 'node:http'
import { getServerClient } from './supabase-server.js'
import { extractWellPlan, statusFor, saveExtraction, markFailed } from './extract-wellplan.js'

const PORT = Number(process.env.PORT) || 8080

// Origins allowed to call from a browser. Defaults cover the custom domain and
// the Replit URL; override with ALLOWED_ORIGINS (comma-separated) if either moves.
const DEFAULT_ORIGINS = [
  'https://jdilorbit.com',
  'https://www.jdilorbit.com',
  'https://jdilorbit.replit.app',
]
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_ORIGINS)
)

function corsHeaders(origin) {
  const h = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
  }
  if (origin && ALLOWED_ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function send(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(origin) })
  res.end(JSON.stringify(body))
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > limit) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try { resolve(JSON.parse(data)) } catch { reject(new Error('invalid JSON body')) }
    })
    req.on('error', reject)
  })
}

// AuthN + AuthZ: valid Supabase token AND an approved profile. Returns { user }
// on success or { error } (string) on any failure — never throws.
async function requireApprovedUser(authHeader) {
  const token = /^Bearer\s+(.+)$/i.exec(authHeader || '')?.[1]
  if (!token) return { error: 'missing bearer token' }
  const sb = getServerClient()
  const { data: userRes, error: uErr } = await sb.auth.getUser(token)
  if (uErr || !userRes?.user) return { error: 'invalid or expired token' }
  const { data: profile, error: pErr } = await sb
    .from('profiles')
    .select('status, role')
    .eq('id', userRes.user.id)
    .maybeSingle()
  if (pErr) return { error: `profile lookup failed: ${pErr.message}` }
  if (!profile || profile.status !== 'approved') return { error: 'not an approved user' }
  return { user: userRes.user }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin
  const urlPath = (req.url || '').split('?')[0]

  // CORS preflight.
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders(origin)); res.end(); return }

  // Liveness probe (no auth) so the platform can health-check the service.
  if (req.method === 'GET' && (urlPath === '/' || urlPath === '/health')) {
    send(res, 200, { ok: true, service: 'jdil-extract-worker' }, origin); return
  }

  if (req.method !== 'POST' || urlPath !== '/extract') {
    send(res, 404, { error: 'not found' }, origin); return
  }

  // If a browser Origin is present, it MUST be allow-listed.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    send(res, 403, { error: 'origin not allowed' }, origin); return
  }

  try {
    const auth = await requireApprovedUser(req.headers.authorization)
    if (auth.error) { send(res, 401, { error: auth.error }, origin); return }

    const body = await readJson(req)
    const id = body?.well_plan_id
    if (!id || typeof id !== 'string') {
      send(res, 400, { error: 'well_plan_id (string) required' }, origin); return
    }

    try {
      const { result, method, detail } = await extractWellPlan(id)
      const status = statusFor(result)
      await saveExtraction(id, result, status)
      send(res, 200, {
        status,
        method,
        detail,
        fields: {
          well_name: result.well_name ?? null,
          well_type: result.well_type ?? null,
          target_depth_m: result.target_depth_m ?? null,
          total_planned_days: result.total_planned_days ?? null,
          milestones: Array.isArray(result.planned_milestones) ? result.planned_milestones.length : 0,
          depth_points: Array.isArray(result.planned_depth_points) ? result.planned_depth_points.length : 0,
          well_history_chars: result.well_history ? String(result.well_history).length : 0,
          key_notes: Array.isArray(result.key_notes) ? result.key_notes.length : 0,
        },
      }, origin)
    } catch (e) {
      // Non-destructive: mark failed (never wipes prior good data), report the error.
      try { await markFailed(id, e.message) } catch { /* best-effort */ }
      send(res, 500, { status: 'failed', error: String(e?.message || e).slice(0, 500) }, origin)
    }
  } catch (e) {
    send(res, 500, { error: String(e?.message || e).slice(0, 300) }, origin)
  }
})

server.listen(PORT, () => {
  console.log(`JDIL Extract Worker listening on :${PORT}`)
  console.log(`Allowed origins: ${[...ALLOWED_ORIGINS].join(', ')}`)
})
