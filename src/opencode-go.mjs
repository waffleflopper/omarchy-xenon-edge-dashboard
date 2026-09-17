import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AUTH_FILE = join(homedir(), '.local/share/opencode/auth.json')
const ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'

// OpenCode Go hands back rolling / weekly / monthly windows as
// { status, percent, resetsAt }. The credential is a long-lived API key, so
// unlike Claude's OAuth token there is nothing to refresh.
export async function readOpenCodeGo() {
  let auth
  try {
    auth = JSON.parse(readFileSync(AUTH_FILE, 'utf8'))
  } catch (err) {
    throw new Error(`Could not read ${AUTH_FILE}: ${err.message}`)
  }

  const key = auth['opencode-go']?.key
  if (!key) throw new Error('No "opencode-go" credential found. Run: opencode auth login')

  const res = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenCode Go usage failed: HTTP ${res.status}${body ? ` (${body.slice(0, 200)})` : ''}`)
  }

  const { usage } = await res.json()
  if (!usage) throw new Error('OpenCode Go usage response had no "usage" field')

  return {
    rolling: usage.rolling ?? null,
    weekly: usage.weekly ?? null,
    monthly: usage.monthly ?? null,
  }
}
