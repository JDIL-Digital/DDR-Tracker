// scripts/gmail-auth.js
//
// HEADLESS Gmail auth for the background pipeline. Builds an OAuth2 client from a
// PRE-GENERATED refresh token + the app's client_id/client_secret and lets
// googleapis auto-refresh access tokens on demand — NO browser, NO loopback
// server, NO google-token.json.
//
// Config resolution (env / Replit Secrets first, local files as dev fallback):
//   refresh token : GMAIL_REFRESH_TOKEN  ->  gmail-refresh-token.json (git-ignored)
//   client id/sec : GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET  ->  google-credentials.json
//
// On Replit (headless), set GMAIL_REFRESH_TOKEN (already done) and, if
// google-credentials.json isn't present there, also GMAIL_CLIENT_ID +
// GMAIL_CLIENT_SECRET. Locally, the git-ignored files cover both.
//
// Scope is gmail.readonly (the refresh token was minted read-only). This module
// does not itself request scopes — it reuses whatever the refresh token carries.

import { readFileSync, existsSync } from 'node:fs'
import { google } from 'googleapis'

const CRED_PATH = 'google-credentials.json'
const TOKEN_FILE = 'gmail-refresh-token.json'

// Minimal .env.local loader so local dev can also supply GMAIL_* via .env.local.
// Only fills vars that aren't already set (Replit Secrets / real env win).
function loadEnvLocal() {
  if (process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) return
  try {
    const text = readFileSync('.env.local', 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* no .env.local — fine */ }
}

// client_id / client_secret: env first, then the Desktop-client JSON (dev).
function resolveClientCreds() {
  let id = process.env.GMAIL_CLIENT_ID
  let secret = process.env.GMAIL_CLIENT_SECRET
  if ((!id || !secret) && existsSync(CRED_PATH)) {
    const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
    const conf = cred.installed || cred.web || {}
    id = id || conf.client_id
    secret = secret || conf.client_secret
  }
  if (!id || !secret) {
    throw new Error('Missing OAuth client id/secret. Set GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET (Replit Secrets) or provide google-credentials.json.')
  }
  return { id, secret }
}

// refresh token: env first, then the git-ignored local file (dev).
function resolveRefreshToken() {
  let rt = process.env.GMAIL_REFRESH_TOKEN
  if (!rt && existsSync(TOKEN_FILE)) {
    try { rt = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')).refresh_token } catch { /* ignore */ }
  }
  if (!rt) {
    throw new Error(`Missing GMAIL_REFRESH_TOKEN (env / Replit Secrets) and no ${TOKEN_FILE} for dev. Run: node scripts/gmail-generate-refresh-token.js`)
  }
  return rt
}

// An authenticated OAuth2 client. googleapis auto-exchanges the refresh token for
// fresh access tokens as requests are made — no interactive step.
export function getGmailAuth() {
  loadEnvLocal()
  const { id, secret } = resolveClientCreds()
  const refresh_token = resolveRefreshToken()
  const client = new google.auth.OAuth2(id, secret) // no redirect_uri needed for refresh-token grants
  client.setCredentials({ refresh_token })
  return client
}

// A ready-to-use Gmail API client (headless).
export function getGmailClient() {
  return google.gmail({ version: 'v1', auth: getGmailAuth() })
}
