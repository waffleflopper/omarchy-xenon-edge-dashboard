import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { expandHome } from './config.mjs'
import { SourceError } from './errors.mjs'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const DEFAULT_BACKOFF_MS = 10 * 60_000

// Claude reports `utilization` as a percent, including fractional values under
// 1. It is never rescaled based on its magnitude.
const BUCKETS = [
  ['five_hour', 'session', 'Session', 300],
  ['seven_day', 'weekly', 'Weekly', 10080],
]
export function parseClaudeUsage(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) throw new SourceError('malformed')
  const windows = []
  for (const [key, kind, label, durationMinutes] of BUCKETS) {
    const bucket = payload[key]
    if (bucket == null) continue
    const usedPercent = bucket.utilization
    const resetsAt = typeof bucket.resets_at === 'string' ? Date.parse(bucket.resets_at) : NaN
    if (usedPercent == null && bucket.resets_at == null) continue
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0 || !Number.isFinite(resetsAt)) {
      throw new SourceError('malformed', `${key} window`)
    }
    windows.push({ kind, label, usedPercent, durationMinutes, resetsAt })
  }
  return windows
}

export function planLabel(oauth) {
  const tier = /max_(\d+x)/.exec(oauth?.rateLimitTier ?? '')?.[1]
  const sub = typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null
  if (!sub) return null
  const name = sub.charAt(0).toUpperCase() + sub.slice(1)
  return tier ? `${name} ${tier}` : name
}

export function retryAtFrom(header, now) {
  if (!header) return now + DEFAULT_BACKOFF_MS
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return now + Math.max(seconds * 1000, 60_000)
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(at, now + 60_000) : now + DEFAULT_BACKOFF_MS
}

const identities = new Map()
const digest = (uuid) => createHash('sha256').update(uuid).digest('hex')

export function sameLoginAs(account, uuid, accounts = identities) {
  if (typeof uuid !== 'string' || !uuid) {
    accounts.delete(account.id)
    return null
  }
  const mine = digest(uuid)
  accounts.set(account.id, { label: account.label, digest: mine })
  for (const [id, other] of accounts) if (id !== account.id && other.digest === mine) return other.label
  return null
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw new SourceError('auth-missing', 'credentials unreadable')
  }
}

/**
 * Reads this account's own credential file afresh on every refresh and never
 * refreshes the token, so Claude Code keeps sole ownership of rotation.
 */
export async function readClaudeAccount(account, { signal, fetchImpl = fetch, now = Date.now } = {}) {
  const creds = await readJson(join(expandHome(account.configDir), '.credentials.json'))
  const oauth = creds?.claudeAiOauth
  if (!oauth || typeof oauth.accessToken !== 'string' || !oauth.accessToken) throw new SourceError('auth-missing')
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= now()) throw new SourceError('auth-expired')

  const identity = await readJson(expandHome(account.identityFile)).catch(() => null)
  const uuid = identity?.oauthAccount?.accountUuid

  let res
  try {
    res = await fetchImpl(USAGE_URL, {
      headers: {
        authorization: `Bearer ${oauth.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        accept: 'application/json',
      },
      signal,
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new SourceError('timeout')
    throw new SourceError('network')
  }
  if (res.status === 429) throw new SourceError('rate-limited', null, retryAtFrom(res.headers.get('retry-after'), now()))
  if (res.status === 401 || res.status === 403) throw new SourceError('auth-rejected')
  if (!res.ok) throw new SourceError('unavailable', `HTTP ${res.status}`)

  let payload
  try {
    payload = await res.json()
  } catch {
    throw new SourceError('malformed')
  }
  return {
    accountId: account.id,
    provider: 'claude',
    label: account.label,
    plan: planLabel(oauth),
    sameLoginAs: sameLoginAs(account, uuid),
    windows: parseClaudeUsage(payload),
  }
}
