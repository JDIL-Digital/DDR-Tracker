// scripts/gmail-verify.js
//
// Proves HEADLESS Gmail reading works end to end using ONLY the pre-generated
// refresh token (via getGmailClient()) — no browser, no google-token.json.
//
//   (a) confirms the authenticated account, and
//   (b) lists the subject lines of the 5 most recent INBOX emails.
//
// Read-only. Prints NO tokens. Does not touch the pipeline.
//
// Usage:  node scripts/gmail-verify.js

import { pathToFileURL } from 'node:url'
import { getGmailClient } from './gmail-auth.js'

const EXPECTED_ACCOUNT = 'akshay.manjramkar@jindalmumbai.com'

function subjectOf(msg) {
  const h = (msg.data.payload?.headers || []).find((x) => x.name.toLowerCase() === 'subject')
  return h ? h.value : '(no subject)'
}

async function main() {
  const gmail = getGmailClient()

  // (a) account — a request the client auto-authorizes via the refresh token.
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const account = profile.data.emailAddress || '(unknown)'
  console.log('===== HEADLESS GMAIL VERIFICATION =====')
  console.log(`Authenticated account : ${account}` + (account === EXPECTED_ACCOUNT ? '  ✓' : `  ⚠️ EXPECTED ${EXPECTED_ACCOUNT}`))
  console.log(`Total messages (est.) : ${profile.data.messagesTotal ?? '—'}`)

  // (b) 5 most recent inbox subjects
  const list = await gmail.users.messages.list({ userId: 'me', labelIds: ['INBOX'], maxResults: 5 })
  const ids = (list.data.messages || []).map((m) => m.id)
  console.log(`\n5 most recent INBOX subjects (${ids.length} found):`)
  let i = 1
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['Subject'] })
    console.log(`  [${i++}] ${subjectOf(msg)}`)
  }
  console.log('\nHeadless read works — refresh token only, no browser. (No tokens printed.)')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('\nVERIFICATION FAILED:', err.message)
    process.exitCode = 1
  })
}
