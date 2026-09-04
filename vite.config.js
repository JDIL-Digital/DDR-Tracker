import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build-time provenance so the deployed site can prove WHICH commit is serving.
// Priority: explicit env override (VITE_COMMIT_SHA, e.g. set in Replit Secrets)
// -> `git rev-parse` (normal build in a checkout) -> 'unknown' (git unavailable).
// Computed once at config load; the values are inlined via `define` (dev + build).
function gitSha() {
  const env = (process.env.VITE_COMMIT_SHA || '').trim()
  if (env) return env
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const COMMIT_SHA = gitSha()
const COMMIT_SHORT = COMMIT_SHA === 'unknown' ? 'unknown' : COMMIT_SHA.slice(0, 7)
const BUILD_TIME = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_SHA__: JSON.stringify(COMMIT_SHA),
    __COMMIT_SHORT__: JSON.stringify(COMMIT_SHORT),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
