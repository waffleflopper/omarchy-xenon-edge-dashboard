import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { SourceError } from './errors.mjs'

const CLIENT_INFO = { name: 'waffle-dashboard', title: 'Waffle Dashboard', version: '2.0.0' }
const REQUEST_TIMEOUT_MS = 20_000
const INIT_TIMEOUT_MS = 30_000

// Codex owns its OAuth refresh through the app server, so ~/.codex/auth.json is
// never read here.
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

export class CodexAppServer {
  constructor({ bin = resolveCodexBin(), args = ['app-server', '--stdio'], requestTimeoutMs = REQUEST_TIMEOUT_MS, initTimeoutMs = INIT_TIMEOUT_MS } = {}) {
    this.bin = bin
    this.args = args
    this.requestTimeoutMs = requestTimeoutMs
    this.initTimeoutMs = initTimeoutMs
    this.conn = null
    this.nextId = 1
  }

  connect() {
    const child = spawn(this.bin, this.args, { stdio: ['pipe', 'pipe', 'ignore'] })
    const conn = { child, pending: new Map(), buffer: '', ready: null }
    this.conn = conn
    const lost = () => this.teardown(conn, new SourceError('unavailable', 'codex app-server exited'))
    child.on('exit', lost)
    child.on('error', lost)
    child.stdin.on('error', lost)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => this.onData(conn, chunk))
    conn.ready = this.send(conn, 'initialize', { clientInfo: CLIENT_INFO }, this.initTimeoutMs).then(() => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`)
    })
    conn.ready.catch(() => this.teardown(conn, new SourceError('unavailable', 'codex app-server did not start')))
    return conn
  }

  teardown(conn, error) {
    if (this.conn === conn) this.conn = null
    for (const { reject, timer } of conn.pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    conn.pending.clear()
    if (conn.child.exitCode === null && conn.child.signalCode === null) conn.child.kill()
  }

  onData(conn, chunk) {
    conn.buffer += chunk
    let idx
    while ((idx = conn.buffer.indexOf('\n')) >= 0) {
      const line = conn.buffer.slice(0, idx).trim()
      conn.buffer = conn.buffer.slice(idx + 1)
      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const entry = msg.id !== undefined && conn.pending.get(msg.id)
      if (!entry) continue
      conn.pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.error) entry.reject(new SourceError('unavailable', 'codex request failed'))
      else entry.resolve(msg.result)
    }
  }

  send(conn, method, params, timeoutMs) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id)
        reject(new SourceError('timeout', 'codex app-server'))
        this.teardown(conn, new SourceError('timeout', 'codex app-server'))
      }, timeoutMs)
      conn.pending.set(id, { resolve, reject, timer })
      conn.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async request(method, params) {
    const conn = this.conn ?? this.connect()
    await conn.ready
    return this.send(conn, method, params, this.requestTimeoutMs)
  }

  stop() {
    if (this.conn) this.teardown(this.conn, new SourceError('unavailable', 'stopped'))
  }
}

const client = new CodexAppServer()

function codexWindow(raw) {
  if (raw == null) return null
  const { usedPercent, windowDurationMins, resetsAt } = raw
  if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 0) throw new SourceError('malformed', 'usedPercent')
  if (!Number.isFinite(windowDurationMins) || windowDurationMins <= 0) throw new SourceError('malformed', 'window length')
  if (!Number.isFinite(resetsAt)) throw new SourceError('malformed', 'reset time')
  const kind = windowDurationMins <= 6 * 60 ? 'session' : windowDurationMins === 7 * 24 * 60 ? 'weekly' : 'other'
  const label = kind === 'session' ? 'Session' : kind === 'weekly' ? 'Weekly' : 'Window'
  return { kind, label, usedPercent, durationMinutes: windowDurationMins, resetsAt: resetsAt * 1000 }
}

export function parseCodexRateLimits(result) {
  const rl = result?.rateLimits
  if (!rl || typeof rl !== 'object') throw new SourceError('malformed')
  const windows = [codexWindow(rl.primary), codexWindow(rl.secondary)].filter(Boolean)
  windows.sort((a, b) => a.durationMinutes - b.durationMinutes)
  const plan = typeof rl.planType === 'string' && rl.planType ? rl.planType.charAt(0).toUpperCase() + rl.planType.slice(1) : null
  return { plan, windows }
}

export async function readCodexAccount(account) {
  const { plan, windows } = parseCodexRateLimits(await client.request('account/rateLimits/read', {}))
  return { accountId: account.id, provider: 'codex', label: account.label, plan, sameLoginAs: null, windows }
}

export function shutdownCodex() {
  client.stop()
}
