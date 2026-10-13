import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, test } from 'node:test'

import { createDashboard } from '../src/app.mjs'
import { DEFAULT_CONFIG } from '../src/config.mjs'

const POLICY = { staleAfterMs: 60_000, expireAfterMs: 600_000 }
const commands = []
let themeReads = 0
let monitors = []
let blockVolume = null
let actionLogged = () => {}
const run = async (argv, opts = {}) => {
  commands.push({ argv, group: opts.group })
  if (argv[0] === 'wpctl' && blockVolume) await blockVolume(argv)
  if (argv[0] === 'hyprctl' && argv[1] === 'monitors') return { stdout: JSON.stringify(monitors) }
  return { stdout: '' }
}
const config = { get: () => structuredClone(DEFAULT_CONFIG), problem: () => null, update: async () => {} }
const { server, hub } = createDashboard({
  config,
  run,
  log: (msg) => actionLogged(msg),
  sources: [
    { id: 'theme', policy: POLICY, ttlMs: 60_000, timeoutMs: 1000, read: async () => ({ name: 'dracula', read: ++themeReads }) },
    { id: 'volume', policy: POLICY, ttlMs: 60_000, timeoutMs: 1000, read: async () => ({ volume: 0.5, muted: false }) },
  ],
  listApps: async () => [],
  listThemes: () => [],
})
let port

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  hub.start()
})
after(() => server.close())

function call(method, path, { headers = {}, body, stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        text += chunk
        if (stream && text.split('\n\n').filter((b) => b.startsWith('event: slot')).length >= 2) {
          req.destroy()
          resolve({ status: res.statusCode, text })
        }
      })
      res.on('end', () => resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
const origin = () => ({ origin: `http://127.0.0.1:${port}` })
const doAction = (action, headers = { ...origin(), 'content-type': 'application/json' }) => call('POST', '/api/do', { headers, body: JSON.stringify(action) })

test('a foreign Host is refused, which blocks DNS rebinding', async () => {
  const res = await call('GET', '/', { headers: { host: `evil.example:${port}` } })
  assert.equal(res.status, 403)
  assert.equal((await call('GET', '/healthz', { headers: { host: 'evil.example' } })).status, 200)
})

test('a mutation from another origin is refused and runs nothing', async () => {
  commands.length = 0
  const res = await doAction({ kind: 'power', power: 'shutdown' }, { origin: 'http://evil.example', 'content-type': 'application/json' })
  assert.equal(res.status, 403)
  assert.deepEqual(commands, [])
})

test('a mutation must be JSON, so a plain form post cannot trigger it', async () => {
  commands.length = 0
  const res = await call('POST', '/api/do', { headers: { ...origin(), 'content-type': 'text/plain' }, body: '{"kind":"power","power":"sleep"}' })
  assert.equal(res.status, 415)
  assert.deepEqual(commands, [])
})

test('confirmed sleep runs the fixed suspend argv in the power group', async () => {
  commands.length = 0
  const res = await doAction({ kind: 'power', power: 'sleep' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, { ok: true, dryRun: false })
  assert.deepEqual(commands, [{ argv: ['systemctl', 'suspend'], group: 'power' }])
  assert.equal((await doAction({ kind: 'power', power: 'sleep', argv: ['sh'] })).status, 400)
})

test('the theme hook may post without an Origin but not from a foreign one', async () => {
  const before = themeReads
  assert.equal((await call('POST', '/api/theme/refresh')).status, 200)
  assert.equal(themeReads, before + 1)
  assert.equal((await call('POST', '/api/theme/refresh', { headers: { origin: 'http://evil.example' } })).status, 403)
})

test('the stream replays every slot at once with the server instance', async () => {
  const res = await call('GET', '/api/stream', { stream: true })
  const events = res.text.split('\n\n').filter((b) => b.startsWith('event: slot')).map((b) => JSON.parse(b.split('data: ')[1]))
  assert.deepEqual(events.map((e) => e.id), ['theme', 'volume'])
  assert.ok(events.every((e) => e.instance === hub.instance))
})

test('a malformed URL is answered and the server keeps serving', async () => {
  assert.equal((await call('GET', '/%E0%A4%A')).status, 400)
  assert.equal((await call('GET', '/healthz')).status, 200)
})

test('a launch is cancelled when focus cannot leave the Edge', async () => {
  monitors = [{ name: 'DP-2', focused: true, width: 2560, height: 720 }, { name: 'DP-1', focused: false, width: 3440, height: 1440 }]
  commands.length = 0
  const res = await doAction({ kind: 'launch', desktopId: 'foot.desktop' })
  assert.equal(res.status, 409)
  assert.equal(res.json.error, 'Could not move focus to DP-1; launch cancelled so the app does not open on the Edge')
  assert.equal(commands.some((c) => c.argv[0] === 'uwsm-app'), false)
})

test('a launch runs as its own systemd service once another monitor has focus', async () => {
  monitors = [{ name: 'DP-2', focused: false, width: 2560, height: 720 }, { name: 'DP-1', focused: true, width: 3440, height: 1440 }]
  commands.length = 0
  const res = await doAction({ kind: 'launch', desktopId: 'foot.desktop' })
  assert.deepEqual(res.json, { ok: true, dryRun: false, monitor: 'DP-1' })
  assert.deepEqual(commands.at(-1), { argv: ['uwsm-app', '-t', 'service', '--', 'foot.desktop'], group: 'launch' })
  assert.equal((await doAction({ kind: 'launch', desktopId: 'evil.desktop' })).status, 400)
})

test('a delayed volume write cannot overwrite a newer volume or mute request', async () => {
  commands.length = 0
  let release
  const blocked = new Promise((r) => { release = r })
  let started
  const firstStarted = new Promise((r) => { started = r })
  let secondAccepted
  const accepted = new Promise((r) => { secondAccepted = r })
  let volumeCalls = 0
  actionLogged = (msg) => { if (msg === '[action] volume.set' && ++volumeCalls === 2) secondAccepted() }
  blockVolume = async (argv) => {
    if (argv[1] === 'set-volume' && argv.at(-1) === '0.2') { started(); await blocked }
  }
  try {
    const first = doAction({ kind: 'volume.set', value: 0.2 })
    await firstStarted
    const second = doAction({ kind: 'volume.set', value: 0.8 })
    await accepted
    const mute = doAction({ kind: 'volume.mute', muted: true })
    assert.deepEqual(commands.map((c) => c.argv.at(-1)), ['0.2'])
    release()
    const responses = await Promise.all([first, second, mute])
    assert.deepEqual(responses.map((r) => r.status), [200, 200, 200])
    assert.deepEqual(commands.map((c) => [c.argv[1], c.argv.at(-1)]), [
      ['set-volume', '0.2'], ['set-mute', '0'], ['set-volume', '0.8'], ['set-mute', '0'], ['set-mute', '1'],
    ])
  } finally {
    release()
    blockVolume = null
    actionLogged = () => {}
  }
})
