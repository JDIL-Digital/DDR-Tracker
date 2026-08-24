// scripts/gmail-generate-refresh-token.js
//
// ONE-TIME setup for the HEADLESS background pipeline (Plan B: pre-generated
// refresh token). MANUAL copy-paste flow — NO localhost server of any kind.
//
// Flow:
//   1. Script prints a consent URL and WAITS at a stdin prompt.
//   2. You approve in the browser (sign in as the pipeline's Gmail account).
//   3. The browser lands on "localhost refused to connect" — EXPECTED; nothing
//      is listening. The auth code is in the ADDRESS BAR
//      (e.g. http://localhost:4571/?code=4/0AS...&scope=...).
//   4. You copy that FULL address-bar URL (or just the code) and paste it in.
//   5. The script extracts code= and exchanges it for a long-lived refresh token.
//
// access_type=offline + prompt=consent => a fresh refresh_token every run.
// Scope: gmail.readonly ONLY (read-only; the pipeline tracks "already processed"
// in our own DB by message id and never modifies the mailbox).
//
// Output (both): git-ignored gmail-refresh-token.json for local dev AND the token
// printed once for Replit Secrets (GMAIL_REFRESH_TOKEN).
//
// Usage:  node scripts/gmail-generate-refresh-token.js

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'
import { google } from 'googleapis'

const CRED_PATH = 'google-credentials.json'
const OUT_PATH = 'gmail-refresh-token.json'
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
// Loopback redirect used ONLY so Google has somewhere to put ?code=. NOTHING
// listens here — we read the code out of the address bar. Desktop clients accept
// any localhost port for the loopback redirect.
const REDIRECT_URI = 'http://localhost:4571'
const EXPECTED_ACCOUNT = 'akshay.manjramkar@jindalmumbai.com'

function makeOAuthClient() {
  if (!existsSync(CRED_PATH)) {
    throw new Error(`${CRED_PATH} not found in project root. It holds the Desktop-app OAuth client (client_id/client_secret).`)
  }
  const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'))
  const conf = cred.installed || cred.web
  if (!conf) throw new Error(`${CRED_PATH} is not a recognized OAuth client (no "installed"/"web" section).`)
  return new google.auth.OAuth2(conf.client_id, conf.client_secret, REDIRECT_URI)
}

// Accept the full pasted redirect URL (http://localhost:4571/?code=...&scope=...)
// or just the raw code. Handles URL-encoding (the code often contains %2F).
function extractCode(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (s.startsWith('http') || /[?&]code=/.test(s)) {
    try { const u = new URL(s); const c = u.searchParams.get('code'); if (c) return c } catch { /* fall through */ }
    const m = s.match(/[?&]code=([^&\s]+)/)
    if (m) { try { return decodeURIComponent(m[1]) } catch { return m[1] } }
  }
  // raw code paste — decode only if it looks percent-encoded
  try { return s.includes('%') ? decodeURIComponent(s) : s } catch { return s }
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a) }))
}

async function whoAmI(client) {
  try {
    const gmail = google.gmail({ version: 'v1', auth: client })
    const res = await gmail.users.getProfile({ userId: 'me' })
    return res.data.emailAddress || null
  } catch { return null }
}

const VERSION = 'manual-paste v3 · NO localhost server'

async function main() {
  console.log(`[gmail-generate-refresh-token] ${VERSION}`)
  const client = makeOAuthClient()
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a fresh refresh_token
    scope: SCOPES,
    login_hint: EXPECTED_ACCOUNT,
    redirect_uri: REDIRECT_URI,
  })

  console.log('\n============ GENERATE GMAIL REFRESH TOKEN (manual, no server) ============')
  console.log(`Sign in as: ${EXPECTED_ACCOUNT}`)
  console.log('Scope requested: gmail.readonly (read-only)\n')
  console.log('STEP 1 — open this URL in a browser and click Allow:\n')
  console.log(authUrl)
  console.log('\nSTEP 2 — the browser will then show "localhost refused to connect"')
  console.log('         (or ERR_CONNECTION_REFUSED). THAT IS EXPECTED — nothing is listening.')
  console.log('         The auth code is in the ADDRESS BAR, e.g.:')
  console.log('           http://localhost:4571/?code=4/0AS...&scope=...')
  console.log('         Copy the ENTIRE address-bar URL (or just the code= value).\n')

  const pasted = await ask('STEP 3 — paste the address-bar URL (or the code) here, then Enter: ')
  const code = extractCode(pasted)
  if (!code) { console.error('\nERROR: could not read an authorization code from that input.'); process.exitCode = 1; return }

  let tokens
  try {
    ;({ tokens } = await client.getToken({ code, redirect_uri: REDIRECT_URI }))
  } catch (e) {
    console.error('\nERROR exchanging the code:', e.message)
    console.error('If it says "invalid_grant", the code was already used or expired — re-run and paste a fresh one.')
    process.exitCode = 1
    return
  }
  client.setCredentials(tokens)

  if (!tokens.refresh_token) {
    console.error('\n⚠️  No refresh_token returned. A prior grant is likely still active.')
    console.error('   Revoke at https://myaccount.google.com/permissions (as the signed-in account), then re-run.')
    process.exitCode = 1
    return
  }

  const account = await whoAmI(client)
  const scopeOk = String(tokens.scope || '').includes('gmail.readonly')

  writeFileSync(OUT_PATH, JSON.stringify({
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    account,
    generated_note: 'One-time generated for the headless DDR pipeline. Git-ignored. Do not commit.',
  }, null, 2))

  console.log('\n===================== RESULT =====================')
  console.log(`Account authorized : ${account || '(could not read profile)'}` + (account && account !== EXPECTED_ACCOUNT ? `  ⚠️ EXPECTED ${EXPECTED_ACCOUNT}` : ''))
  console.log(`Scope              : ${tokens.scope || '(none)'}${scopeOk ? '  ✓' : '  ⚠️ missing gmail.readonly'}`)
  console.log(`Saved local file   : ${OUT_PATH}  (git-ignored)`)
  console.log('\n----- COPY THIS INTO REPLIT SECRETS as GMAIL_REFRESH_TOKEN -----')
  console.log(tokens.refresh_token)
  console.log('----- END (shown once; also saved in ' + OUT_PATH + ') -----')
  console.log('\nThe headless server uses GMAIL_REFRESH_TOKEN + the client_id/client_secret to mint')
  console.log('fresh access tokens on demand — no browser needed again.')

  if (account && account !== EXPECTED_ACCOUNT) {
    console.error(`\n⚠️  You signed in as ${account}, not ${EXPECTED_ACCOUNT}. Re-run and pick the right account if this is wrong.`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nERROR:', err.message)
    process.exitCode = 1
  })
}
