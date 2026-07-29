// scripts/fetch-gmail.js
//
// Reads the Gmail inbox for DDR emails. LISTING ONLY — it does not download,
// extract, or save anything yet.
//
// Auth: Desktop OAuth client in google-credentials.json. First run prints a
// consent URL for YOU to approve in a browser; the resulting token is saved to
// google-token.json so later runs are non-interactive. Both files are
// git-ignored and must never be committed.
//
// Usage:  node scripts/fetch-gmail.js

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { google } from 'googleapis'

const CRED_PATH = 'google-credentials.json'
const TOKEN_PATH = 'google-token.json'
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
const PORT = 4571
const REDIRECT_URI = `http://localhost:${PORT}`
const AUTH_TIMEOUT_MS = 5 * 60 * 1000 // give the human 5 minutes to approve

// A DDR email's subject contains one of these report codes (DDR / DPR / DRR),
// often behind an "FW:"/"Re:" prefix. Dry-run rule agreed until the standardized
// email pipeline starts (~10 Aug 2026); may be tightened once real emails arrive.
const SUBJECT_RE = /\b(DDR|DPR|DRR)\b/i
const EXCEL_RE = /\.(xlsx|xls)$/i

// --- OAuth client ------------------------------------------------------------
export function makeOAuthClient() {
  if (!existsSync(CRED_PATH)) {
    throw new Error(`${CRED_PATH} not found in project root. Place your Google OAuth "Desktop app" credentials there.`)
  }
  const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
  const conf = cred.installed || cred.web
  if (!conf) throw new Error(`${CRED_PATH} is not a recognized OAuth client (no "installed"/"web" section).`)
  return new google.auth.OAuth2(conf.client_id, conf.client_secret, REDIRECT_URI)
}

export function authUrlFor(client) {
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES })
}

function saveToken(tokens) {
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2))
}

// Interactive consent: print the URL, run a one-shot loopback server, capture
// the ?code= redirect, exchange it for a token, and persist it.
function runConsentFlow(client) {
  const authUrl = authUrlFor(client)
  console.log('\n================= GOOGLE AUTHORIZATION NEEDED =================')
  console.log('This is a one-time approval. Open the URL below in your browser,')
  console.log('sign in, and grant read-only Gmail access. The token is then saved')
  console.log(`to ${TOKEN_PATH} so you will not be asked again.\n`)
  console.log('>>> OPEN THIS URL <<<')
  console.log(authUrl)
  console.log('>>> END URL <<<\n')
  console.log(`Waiting up to ${AUTH_TIMEOUT_MS / 60000} min for you to approve (listening on ${REDIRECT_URI}) ...`)

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, REDIRECT_URI)
        const code = url.searchParams.get('code')
        const err = url.searchParams.get('error')
        if (err) {
          res.end('Authorization denied. You can close this tab.')
          cleanup()
          return reject(new Error(`Authorization denied: ${err}`))
        }
        if (!code) {
          res.end('Waiting for authorization code...')
          return
        }
        const { tokens } = await client.getToken(code)
        client.setCredentials(tokens)
        saveToken(tokens)
        res.end('Authorization complete. You can close this tab and return to the terminal.')
        cleanup()
        console.log(`\nToken saved to ${TOKEN_PATH}. Continuing...\n`)
        resolve(client)
      } catch (e) {
        res.end('Error during authorization. Check the terminal.')
        cleanup()
        reject(e)
      }
    })
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for authorization. Re-run the script to try again.'))
    }, AUTH_TIMEOUT_MS)
    function cleanup() {
      clearTimeout(timer)
      server.close()
    }
    server.listen(PORT)
  })
}

export async function authorize() {
  const client = makeOAuthClient()
  if (existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf8')))
    // Persist refreshed access tokens (keep the refresh_token we already have).
    client.on('tokens', (t) => {
      const merged = { ...JSON.parse(readFileSync(TOKEN_PATH, 'utf8')), ...t }
      saveToken(merged)
    })
    return client
  }
  return runConsentFlow(client)
}

// --- Gmail listing -----------------------------------------------------------
function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h ? h.value : ''
}

// Broad Gmail prefilter; the strict subject rule (SUBJECT_RE) is applied in code.
const GMAIL_QUERY = 'has:attachment (subject:DDR OR subject:DPR OR subject:DRR)'

// Walk the MIME tree collecting Excel attachment parts (with their attachmentId
// so callers can download them).
function collectExcelParts(payload) {
  const parts = []
  ;(function walk(part) {
    if (!part) return
    if (part.filename && EXCEL_RE.test(part.filename) && part.body?.attachmentId) {
      parts.push({ filename: part.filename, attachmentId: part.body.attachmentId, mimeType: part.mimeType })
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk)
  })(payload)
  return parts
}

// Rich finder: returns matching messages (most-recent first) with the message id
// and per-attachment {filename, attachmentId} so callers can download them.
export async function findDDRMessages(client) {
  const gmail = google.gmail({ version: 'v1', auth: client })
  const listRes = await gmail.users.messages.list({ userId: 'me', q: GMAIL_QUERY, maxResults: 50 })
  const ids = (listRes.data.messages || []).map((m) => m.id)

  const out = []
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' })
    const headers = msg.data.payload?.headers || []
    const subject = headerValue(headers, 'Subject')
    if (!SUBJECT_RE.test(subject)) continue

    const excelAttachments = collectExcelParts(msg.data.payload)
    if (excelAttachments.length === 0) continue

    out.push({
      id,
      subject: subject.trim(),
      from: headerValue(headers, 'From'),
      date: headerValue(headers, 'Date'),
      internalDate: Number(msg.data.internalDate) || 0,
      excelAttachments,
    })
  }
  out.sort((a, b) => b.internalDate - a.internalDate) // most recent first
  return out
}

// Listing shape used by the fetch-gmail CLI (filenames only).
export async function listDDR(client) {
  const messages = await findDDRMessages(client)
  return messages.map((m) => ({
    subject: m.subject,
    from: m.from,
    date: m.date,
    attachments: m.excelAttachments.map((a) => a.filename),
  }))
}

// --- CLI ---------------------------------------------------------------------
async function main() {
  console.log('DDR Gmail reader — LISTING ONLY (no download, no extraction, no DB writes)')
  const client = await authorize()
  const matches = await listDDR(client)

  console.log(`\n===================== DDR EMAILS FOUND: ${matches.length} =====================`)
  if (matches.length === 0) {
    console.log('(no emails matched: subject contains DDR/DPR/DRR AND has an .xls/.xlsx attachment)')
  }
  matches.forEach((m, i) => {
    console.log(`\n[${i + 1}]`)
    console.log(`  Subject    : ${m.subject}`)
    console.log(`  From       : ${m.from}`)
    console.log(`  Date       : ${m.date}`)
    console.log(`  Attachment : ${m.attachments.join(', ')}`)
  })
  console.log('\nDone (listing only).')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
