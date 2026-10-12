import { randomUUID } from 'node:crypto'

import { SourceError, toSourceError } from './errors.mjs'

const IDLE_AFTER_MS = 2 * 60_000

/**
 * Each source owns one slot and is its only writer. A source definition is
 * { id, policy, ttlMs, timeoutMs, read(signal) }. Reads never wait on each
 * other, concurrent refreshes of one source share a read, and an invalidated
 * read (for example after a location change) cannot overwrite the newer one.
 */
export function createHub(defs, { now = Date.now, log = () => {} } = {}) {
  const instance = randomUUID()
  const sources = new Map()
  const clients = new Set()
  let revision = 0
  let lastClientAt = now()
  let closed = false

  for (const def of defs) {
    sources.set(def.id, { def, slot: { state: 'pending' }, revision: 0, inflight: null, epoch: 0, timer: null, idle: false, retryAt: 0 })
  }

  function event(id) {
    const s = sources.get(id)
    return `event: slot\ndata: ${JSON.stringify({ instance, id, revision: s.revision, slot: s.slot, policy: s.def.policy })}\n\n`
  }

  function publish(id, slot) {
    const s = sources.get(id)
    if (JSON.stringify(slot) === JSON.stringify(s.slot)) return
    s.slot = slot
    s.revision = ++revision
    const payload = event(id)
    for (const res of clients) res.write(payload)
  }

  function schedule(s, delay) {
    clearTimeout(s.timer)
    if (closed) return
    s.timer = setTimeout(() => {
      if (!clients.size && now() - lastClientAt > IDLE_AFTER_MS) {
        s.idle = true
        return
      }
      refresh(s.def.id)
    }, Math.max(1000, delay))
    s.timer.unref?.()
  }

  async function readInto(s, epoch, signal) {
    try {
      const value = await s.def.read(signal)
      if (epoch !== s.epoch || closed) return
      s.retryAt = 0
      publish(s.def.id, { state: 'ok', value, fetchedAt: now() })
    } catch (err) {
      if (epoch !== s.epoch || closed) return
      const error = signal.aborted && !(err instanceof SourceError) ? new SourceError('timeout') : toSourceError(err)
      log(`[${s.def.id}] ${error.kind}: ${error.message}`)
      s.retryAt = error.retryAt ?? 0
      const prev = s.slot
      const at = now()
      publish(s.def.id, 'value' in prev
        ? { state: 'stale', value: prev.value, fetchedAt: prev.fetchedAt, error: error.toJSON(), failedAt: at }
        : { state: 'failed', error: error.toJSON(), failedAt: at })
    }
  }

  function refresh(id, { force = false } = {}) {
    const s = sources.get(id)
    if (!s || closed) return Promise.resolve()
    if (s.inflight && !force) return s.inflight
    if (!force && now() < s.retryAt) return Promise.resolve()
    const epoch = force ? ++s.epoch : s.epoch
    const run = readInto(s, epoch, AbortSignal.timeout(s.def.timeoutMs)).finally(() => {
      if (s.inflight === run) s.inflight = null
      if (epoch === s.epoch) schedule(s, Math.max(s.def.ttlMs, s.retryAt - now()))
    })
    s.inflight = run
    return run
  }

  return {
    instance,
    start() {
      for (const id of sources.keys()) refresh(id)
    },
    refresh,
    invalidate(id) {
      return refresh(id, { force: true })
    },
    peek(id) {
      return sources.get(id)?.slot
    },
    has(id) {
      return sources.has(id)
    },
    retryAt(id) {
      return sources.get(id)?.retryAt ?? 0
    },
    attach(res) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 3000\n\n')
      for (const id of sources.keys()) res.write(event(id))
      clients.add(res)
      lastClientAt = now()
      for (const s of sources.values()) {
        if (!s.idle) continue
        s.idle = false
        if (now() >= s.retryAt) refresh(s.def.id)
        else schedule(s, s.retryAt - now())
      }
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
      res.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
        lastClientAt = now()
      })
    },
    close() {
      closed = true
      for (const s of sources.values()) clearTimeout(s.timer)
      for (const res of clients) res.end()
      clients.clear()
    },
  }
}
