import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'

import { SourceError } from '../src/errors.mjs'
import { createHub } from '../src/hub.mjs'

const POLICY = { staleAfterMs: 60_000, expireAfterMs: 600_000 }
const source = (id, read, extra = {}) => ({ id, policy: POLICY, ttlMs: 60_000, timeoutMs: 5000, read, ...extra })
const deferred = () => {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

test('a slow source does not hold back the others', async () => {
  const slow = deferred()
  const hub = createHub([source('quota:slow', () => slow.promise), source('theme', async () => ({ name: 'dracula' }))])
  hub.start()
  await hub.refresh('theme')
  assert.equal(hub.peek('theme').state, 'ok')
  assert.equal(hub.peek('quota:slow').state, 'pending')
  hub.close()
  slow.resolve(1)
})

test('a failure after a good reading keeps the value as stale with a typed error', async () => {
  let fail = false
  const hub = createHub([source('weather', async () => {
    if (fail) throw new Error('socket hang up with secret details')
    return { temp: 40 }
  })], { now: () => 1000 })
  await hub.refresh('weather')
  fail = true
  await hub.refresh('weather', { force: true })
  assert.deepEqual(hub.peek('weather'), {
    state: 'stale', value: { temp: 40 }, fetchedAt: 1000, error: { kind: 'unavailable', message: 'unavailable' }, failedAt: 1000,
  })
  hub.close()
})

test('concurrent refreshes share one read', async () => {
  let reads = 0
  const gate = deferred()
  const hub = createHub([source('hardware', async () => {
    reads++
    await gate.promise
    return reads
  })])
  const a = hub.refresh('hardware')
  const b = hub.refresh('hardware')
  gate.resolve()
  await Promise.all([a, b])
  assert.equal(reads, 1)
  hub.close()
})

test('an invalidated read cannot overwrite the newer one', async () => {
  const first = deferred()
  let call = 0
  const hub = createHub([source('weather', () => (++call === 1 ? first.promise : Promise.resolve('Fairbanks')))])
  const old = hub.refresh('weather')
  await hub.invalidate('weather')
  first.resolve('Seattle')
  await old
  assert.equal(hub.peek('weather').value, 'Fairbanks')
  hub.close()
})

test('a read that throws synchronously becomes a failed slot', async () => {
  const hub = createHub([source('volume', () => {
    throw new Error('boom')
  })])
  await hub.refresh('volume')
  assert.equal(hub.peek('volume').state, 'failed')
  assert.equal(hub.peek('volume').error.kind, 'unavailable')
  hub.close()
})

test('Retry-After holds back scheduled and manual refreshes', async () => {
  let reads = 0
  const hub = createHub([source('quota:claude', async () => {
    reads++
    throw new SourceError('rate-limited', null, 1000 + 120_000)
  })], { now: () => 1000 })
  await hub.refresh('quota:claude')
  await hub.refresh('quota:claude')
  assert.equal(reads, 1)
  assert.equal(hub.retryAt('quota:claude'), 121_000)
  assert.equal(hub.peek('quota:claude').error.retryAt, 121_000)
  hub.close()
})

test('a closed hub schedules nothing more', async () => {
  let reads = 0
  const gate = deferred()
  const hub = createHub([source('volume', async () => {
    reads++
    await gate.promise
    return reads
  }, { ttlMs: 1000 })])
  const pending = hub.refresh('volume')
  hub.close()
  gate.resolve()
  await pending
  await sleep(1200)
  assert.equal(reads, 1)
  assert.equal(hub.peek('volume').state, 'pending')
})
