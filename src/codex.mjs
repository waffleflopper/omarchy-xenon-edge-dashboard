import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CLIENT_INFO = { name: 'waffle-dashboard', title: 'Waffle Dashboard', version: '1.0.0' }
const REQUEST_TIMEOUT_MS = 25000
const INIT_TIMEOUT_MS = 30000

// Codex owns its own OAuth refresh through the app server, so we never touch
// ~/.codex/auth.json ourselves. That is the whole reason we talk JSON-RPC to
// `codex app-server` instead of calling the internal wham/usage endpoint.
function resolveCodexBin() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN
  const candidates = [
    join(homedir(), '.local/share/mise/shims/codex'),
    join(homedir(), '.local/bin/codex'),
    '/usr/local/bin/codex',
    '/usr/bin/codex',
  ]
  return candidates.find((p) => existsSync(p)) ?? 'codex'
}

class CodexAppServer {
  constructor() {
    this.bin = resolveCodexBin()
    this.child = null
    this.buffer = ''
    this.nextId = 1
    this.pending = new Map()
    this.ready = null
    this.stderrTail = []
  }

  log(...args) {
    console.log('[codex]', ...args)
  }

  reset() {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('codex app-server connection reset'))
    }
    this.pending.clear()
    this.buffer = ''
    this.child = null
    this.ready = null
  }

  onData(chunk) {
    this.buffer += chunk
    let idx
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue

      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else entry.resolve(msg.result)
      }
      // Server notifications (account/rateLimits/updated, remoteControl/...) are
      // deliberately ignored: we poll on our own schedule.
    }
  }

  rawRequest(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const child = this.child
    if (!child || !child.stdin.writable) return Promise.reject(new Error('codex app-server is not running'))

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`codex ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  notify(method, params) {
    const child = this.child
    if (child?.stdin.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  ensure() {
    if (!this.ready) {
      this.ready = this.spawnAndInit().catch((err) => {
        this.ready = null
        throw err
      })
    }
    return this.ready
  }

  spawnAndInit() {
    return new Promise((resolve, reject) => {
      this.log(`spawning ${this.bin} app-server --stdio`)
      const child = spawn(this.bin, ['app-server', '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })
      this.child = child
      this.buffer = ''
      let settled = false

      const fail = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.reset()
        reject(err)
      }

      const timer = setTimeout(() => fail(new Error('codex app-server init timed out')), INIT_TIMEOUT_MS)

      child.on('error', (err) => fail(err))
      child.on('exit', (code, signal) => {
        this.log(`exited (code=${code} signal=${signal})`)
        fail(new Error(`codex app-server exited (${code ?? signal})`))
      })

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => this.onData(chunk))
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        this.stderrTail.push(chunk)
        if (this.stderrTail.length > 20) this.stderrTail.shift()
      })

      this.rawRequest('initialize', { clientInfo: CLIENT_INFO }, INIT_TIMEOUT_MS)
        .then(() => {
          this.notify('initialized', {})
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(this)
        })
        .catch(fail)
    })
  }

  async request(method, params) {
    await this.ensure()
    try {
      return await this.rawRequest(method, params)
    } catch (err) {
      // Any failure may mean the pipe is wedged; force a fresh process next time.
      this.reset()
      throw err
    }
  }

  stop() {
    try {
      this.child?.kill()
    } catch {
      // ignore
    }
    this.reset()
  }
}

const client = new CodexAppServer()

function normalizeWindow(w) {
  if (!w) return null
  return {
    usedPercent: w.usedPercent ?? null,
    remainingPercent: typeof w.usedPercent === 'number' ? Math.max(0, 100 - w.usedPercent) : null,
    windowMinutes: w.windowDurationMins ?? null,
    resetsAt: w.resetsAt ?? null,
  }
}

function todayKey() {
  return new Date().toLocaleDateString('en-CA')
}

// Average pace across the current window (used% spread over the time elapsed
// since the window opened), then project when it would hit 100%.
function paceFor(win) {
  if (!win || typeof win.usedPercent !== 'number' || !win.windowMinutes || !win.resetsAt) return null

  const resetMs = win.resetsAt * 1000
  const startMs = resetMs - win.windowMinutes * 60000
  const now = Date.now()

  const elapsedHours = (now - startMs) / 3600000
  const hoursToReset = (resetMs - now) / 3600000
  if (elapsedHours <= 0) return null

  const perHour = win.usedPercent / elapsedHours
  const hoursLeft = perHour > 0 ? (100 - win.usedPercent) / perHour : null

  return {
    perHour: Number(perHour.toFixed(3)),
    perDay: Number((perHour * 24).toFixed(1)),
    hoursLeft: hoursLeft == null ? null : Number(hoursLeft.toFixed(1)),
    hoursToReset: Number(hoursToReset.toFixed(1)),
    onPace: hoursLeft == null ? null : hoursLeft >= hoursToReset,
  }
}

export async function readCodex() {
  const result = await client.request('account/rateLimits/read', {})
  const rl = result?.rateLimits
  if (!rl) throw new Error('Codex rate limit response was empty')

  const byLimitId = {}
  for (const [id, entry] of Object.entries(result.rateLimitsByLimitId ?? {})) {
    byLimitId[id] = {
      limitName: entry.limitName ?? null,
      primary: normalizeWindow(entry.primary),
      secondary: normalizeWindow(entry.secondary),
    }
  }

  const codex = {
    planType: rl.planType ?? null,
    ordinaryUsageAllowed: result.ordinaryUsageAllowed ?? null,
    primary: normalizeWindow(rl.primary),
    secondary: normalizeWindow(rl.secondary),
    credits: rl.credits ?? null,
    resetCredits: result.rateLimitResetCredits?.availableCount ?? 0,
    resetCreditExpiries: (result.rateLimitResetCredits?.credits ?? [])
      .map((c) => c.expiresAt)
      .filter((x) => typeof x === 'number'),
    byLimitId,
  }

  codex.pace = paceFor(codex.primary)

  // Lifetime totals / streaks / daily history; never let them break the page.
  try {
    const usage = await client.request('account/usage/read', {})
    const summary = usage?.summary
    if (summary) {
      const buckets = usage.dailyUsageBuckets ?? []
      const today = buckets.find((b) => b.startDate === todayKey())
      codex.dailyHistory = buckets
        .slice(-30)
        .map((b) => ({ date: b.startDate, tokens: b.tokens ?? 0 }))
      codex.stats = {
        lifetimeTokens: summary.lifetimeTokens ?? null,
        peakDailyTokens: summary.peakDailyTokens ?? null,
        currentStreakDays: summary.currentStreakDays ?? null,
        longestStreakDays: summary.longestStreakDays ?? null,
        todayTokens: today?.tokens ?? null,
      }
    }
  } catch {
    // ignore
  }

  return codex
}

export function shutdownCodex() {
  client.stop()
}
