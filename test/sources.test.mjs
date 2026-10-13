import assert from 'node:assert/strict'
import { sceneFor } from '../public/domain.mjs'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { listApps, parseDesktopEntry } from '../src/apps.mjs'
import { parseClaudeUsage, readClaudeAccount, sameLoginAs } from '../src/claude.mjs'
import { CodexAppServer, parseCodexRateLimits } from '../src/codex.mjs'
import { groupMounts, parseMeminfo, parseNvidiaSmi, parseSensors } from '../src/hardware.mjs'
import { parseVolume, volumeCommands } from '../src/volume.mjs'
import { parseForecast, parseGeocode, parseOvation } from '../src/weather.mjs'

const dir = mkdtempSync(join(tmpdir(), 'waffle-test-'))
after(() => rmSync(dir, { recursive: true, force: true }))

const NOW = Date.UTC(2026, 9, 12, 12, 0)
const TOKEN = 'sk-ant-oat01-NOT-A-REAL-TOKEN'


test('Claude utilization is a percent, including values under 1', () => {
  const windows = parseClaudeUsage({
    five_hour: { utilization: 0.4, resets_at: '2026-10-12T14:00:00Z' },
    seven_day: { utilization: 23, resets_at: '2026-10-16T09:00:00Z' },
  })
  assert.deepEqual(windows, [
    { kind: 'session', label: 'Session', usedPercent: 0.4, durationMinutes: 300, resetsAt: Date.UTC(2026, 9, 12, 14) },
    { kind: 'weekly', label: 'Weekly', usedPercent: 23, durationMinutes: 10080, resetsAt: Date.UTC(2026, 9, 16, 9) },
  ])
})

test('a Claude window the provider omits stays absent, never zero', () => {
  const windows = parseClaudeUsage({ five_hour: { utilization: 17, resets_at: '2026-10-12T14:00:00Z' }, seven_day: null })
  assert.deepEqual(windows.map((w) => w.kind), ['session'])
})

test('malformed Claude usage is a typed error', () => {
  assert.throws(() => parseClaudeUsage([]), { kind: 'malformed' })
  assert.throws(() => parseClaudeUsage({ five_hour: { utilization: '17', resets_at: '2026-10-12T14:00:00Z' } }), { kind: 'malformed' })
})

function claudeDir(name, oauth) {
  const configDir = join(dir, name)
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }))
  writeFileSync(join(configDir, 'identity.json'), JSON.stringify({ oauthAccount: { accountUuid: `uuid-${name}`, emailAddress: 'someone@example.com' } }))
  return { id: name, provider: 'claude', label: name, configDir, identityFile: join(configDir, 'identity.json') }
}

test('a 429 becomes rate-limited with the provider retry time and no token in the error', async () => {
  const account = claudeDir('limited', { accessToken: TOKEN, expiresAt: NOW + 3600_000, subscriptionType: 'max' })
  let auth
  const fetchImpl = async (url, init) => {
    auth = init.headers.authorization
    return new Response('{"error":{"message":"slow down ' + TOKEN + '"}}', { status: 429, headers: { 'retry-after': '120' } })
  }
  const err = await readClaudeAccount(account, { fetchImpl, now: () => NOW }).catch((e) => e)
  assert.equal(auth, `Bearer ${TOKEN}`)
  assert.deepEqual(err.toJSON(), { kind: 'rate-limited', message: 'rate-limited by the provider', retryAt: NOW + 120_000 })
  assert.equal(JSON.stringify(err.toJSON()).includes(TOKEN), false)
})

test('expired Claude credentials fail before any request and are never refreshed', async () => {
  const account = claudeDir('expired', { accessToken: TOKEN, refreshToken: 'r', expiresAt: NOW - 1, subscriptionType: 'max' })
  let calls = 0
  const err = await readClaudeAccount(account, { fetchImpl: async () => calls++, now: () => NOW }).catch((e) => e)
  assert.equal(err.kind, 'auth-expired')
  assert.equal(calls, 0)
})

test('a Claude reading carries plan and windows but no identity or token', async () => {
  const account = claudeDir('good', { accessToken: TOKEN, expiresAt: NOW + 3600_000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' })
  const body = { five_hour: { utilization: 11, resets_at: '2026-10-12T14:00:00Z' }, seven_day: { utilization: 42, resets_at: '2026-10-16T09:00:00Z' } }
  const value = await readClaudeAccount(account, { fetchImpl: async () => Response.json(body), now: () => NOW })
  assert.equal(value.plan, 'Max 20x')
  assert.deepEqual(value.windows.map((w) => w.usedPercent), [11, 42])
  const json = JSON.stringify(value)
  for (const secret of [TOKEN, 'uuid-good', 'someone@example.com']) assert.equal(json.includes(secret), false, secret)
})

test('two accounts signed in as the same user are reported by label only', () => {
  const seen = new Map()
  assert.equal(sameLoginAs({ id: 'a', label: 'Claude' }, 'uuid-1', seen), null)
  assert.equal(sameLoginAs({ id: 'b', label: 'ClaudeWaffle' }, 'uuid-2', seen), null)
  assert.equal(sameLoginAs({ id: 'b', label: 'ClaudeWaffle' }, 'uuid-1', seen), 'Claude')
  assert.equal(JSON.stringify([...seen.values()]).includes('uuid-1'), false)
})


test('a Codex Pro account reports only its weekly window', () => {
  const parsed = parseCodexRateLimits({ rateLimits: { planType: 'pro', primary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1791900000 }, secondary: null } })
  assert.deepEqual(parsed, { plan: 'Pro', windows: [{ kind: 'weekly', label: 'Weekly', usedPercent: 8, durationMinutes: 10080, resetsAt: 1791900000000 }] })
  assert.throws(() => parseCodexRateLimits({}), { kind: 'malformed' })
  assert.throws(() => parseCodexRateLimits({ rateLimits: { primary: { usedPercent: 8, windowDurationMins: 0, resetsAt: 1 } } }), { kind: 'malformed' })
})

const FAKE_CODEX = join(dir, 'fake-codex.mjs')
const HUNG = join(dir, 'hung-once')
writeFileSync(FAKE_CODEX, `
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const flag = process.argv[2]
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') return console.log(JSON.stringify({ id: msg.id, result: {} }))
  if (msg.method !== 'account/rateLimits/read') return
  if (!existsSync(flag)) return writeFileSync(flag, String(process.pid))
  console.log(JSON.stringify({ id: msg.id, result: { pid: process.pid } }))
})
`)

test('a wedged Codex child is killed and replaced, and its late exit cannot reset the new one', async () => {
  const codex = new CodexAppServer({ bin: process.execPath, args: [FAKE_CODEX, HUNG], requestTimeoutMs: 300, initTimeoutMs: 2000 })
  try {
    const first = codex.connect()
    await assert.rejects(codex.request('account/rateLimits/read', {}), { kind: 'timeout' })
    assert.equal(codex.conn, null)
    const result = await codex.request('account/rateLimits/read', {})
    const second = codex.conn
    assert.notEqual(second, first)
    assert.equal(result.pid, second.child.pid)
    if (first.child.exitCode === null && first.child.signalCode === null) await once(first.child, 'exit')
    assert.equal(first.child.signalCode, 'SIGTERM')
    assert.equal(codex.conn, second)
  } finally {
    codex.stop()
  }
})

test('a Codex child that exits is replaced on the next request', async () => {
  rmSync(HUNG, { force: true })
  writeFileSync(HUNG, '')
  const codex = new CodexAppServer({ bin: process.execPath, args: [FAKE_CODEX, HUNG], requestTimeoutMs: 2000 })
  try {
    const before = await codex.request('account/rateLimits/read', {})
    const { child } = codex.conn
    child.kill()
    await once(child, 'exit')
    assert.equal(codex.conn, null)
    const afterExit = await codex.request('account/rateLimits/read', {})
    assert.notEqual(afterExit.pid, before.pid)
  } finally {
    codex.stop()
  }
})


const FORECAST = {
  timezone: 'America/Anchorage',
  utc_offset_seconds: -28800,
  current: { time: 1791849600, temperature_2m: 40.7, apparent_temperature: 35.2, is_day: 0, weather_code: 2, cloud_cover: 67, relative_humidity_2m: 81, pressure_msl: 1012.4, wind_speed_10m: 5.1, wind_direction_10m: 230, wind_gusts_10m: 11 },
  hourly: { time: [1791846000, 1791849600, 1791853200], temperature_2m: [41, 40.7, 39], weather_code: [3, 2, 1], precipitation_probability: [10, 5, 0], is_day: [0, 0, 0], cloud_cover: [90, 67, 30] },
  daily: { time: [1791792000], weather_code: [3], temperature_2m_max: [45], temperature_2m_min: [33], sunrise: [1791821000], sunset: [1791858000], uv_index_max: [1.2], precipitation_probability_max: [20] },
}

test('the forecast keeps epoch times and the location time zone', () => {
  const w = parseForecast(FORECAST, { name: 'Fairbanks', lat: 64.84, lon: -147.72 }, 'imperial')
  assert.equal(w.timezone, 'America/Anchorage')
  assert.equal(w.current.at, 1791849600000)
  assert.equal(w.current.feelsLike, 35.2)
  assert.equal(w.current.pressure, 1012.4)
  assert.deepEqual(w.units, { temp: '°F', wind: 'mph' })
  assert.deepEqual(w.days[0], { date: 1791792000000, code: 3, high: 45, low: 33, sunrise: 1791821000000, sunset: 1791858000000, uvMax: 1.2, precipProb: 20 })
  assert.deepEqual(w.hours.map((h) => h.temp), [41, 40.7, 39])
  assert.throws(() => parseForecast({ ...FORECAST, timezone: undefined }, {}), { kind: 'malformed' })
})

test('place search results are trimmed to name and coordinates', () => {
  const results = parseGeocode({ results: [{ id: 1, name: 'Fairbanks', admin1: 'Alaska', country: 'United States', latitude: 64.83778, longitude: -147.71639, population: 32000 }] })
  assert.deepEqual(results, [{ name: 'Fairbanks, Alaska, United States', lat: 64.8378, lon: -147.7164 }])
  assert.deepEqual(parseGeocode({}), [])
})

test('the OVATION cell wraps western longitudes onto the 0..359 grid', () => {
  const body = { 'Observation Time': '2026-10-12T11:40:00Z', 'Forecast Time': '2026-10-12T12:38:00Z', coordinates: [[148, 65, 99], [212, 65, 7], [212, 64, 3]] }
  assert.deepEqual(parseOvation(body, { lat: 64.84, lon: -147.7 }), {
    probability: 7, observedAt: Date.UTC(2026, 9, 12, 11, 40), forecastAt: Date.UTC(2026, 9, 12, 12, 38), lat: 65, lon: -148,
  })
  assert.throws(() => parseOvation({ ...body, coordinates: [] }, { lat: 64.84, lon: -147.7 }), { kind: 'malformed' })
})


test('CPU is k10temp Tctl and the board is the nct6687 diode, never AMD TSI', () => {
  const parsed = parseSensors({
    'k10temp-pci-00c3': { Adapter: 'PCI adapter', Tctl: { temp1_input: 65.375 }, Tccd1: { temp3_input: 58 } },
    'nct6687-isa-0a20': { Adapter: 'ISA adapter', 'AMD TSI Addr 98h': { temp1_input: 65 }, 'Diode 0 (curr)': { temp2_input: 46.5 } },
  })
  assert.deepEqual(parsed, {
    cpu: { celsius: 65.375, sensor: 'Tctl', chip: 'k10temp' },
    board: { celsius: 46.5, sensor: 'Diode 0 (curr)', chip: 'nct6687' },
  })
  assert.deepEqual(parseSensors({ 'nct6687-isa-0a20': { 'AMD TSI Addr 98h': { temp1_input: 65 } } }), { cpu: null, board: null })
})

test('nvidia-smi and meminfo parse to plain numbers', () => {
  assert.deepEqual(parseNvidiaSmi('NVIDIA GeForce RTX 4070 SUPER, 45, 3, 1234, 12282\n'), { name: 'NVIDIA GeForce RTX 4070 SUPER', celsius: 45, utilPercent: 3, vramUsedMiB: 1234, vramTotalMiB: 12282 })
  assert.equal(parseNvidiaSmi(''), null)
  assert.deepEqual(parseMeminfo('MemTotal:       32000000 kB\nMemFree:  1000 kB\nMemAvailable:   20000000 kB\n'), { usedBytes: 12000000 * 1024, totalBytes: 32000000 * 1024 })
})

test('mount points on one filesystem are counted once', () => {
  const mountinfo = [
    '26 1 0:29 /@ / rw,relatime shared:1 - btrfs /dev/nvme0n1p2 rw',
    '30 26 0:29 /@home /home rw,relatime shared:2 - btrfs /dev/nvme0n1p2 rw',
    '31 26 259:1 / /boot rw,relatime shared:3 - vfat /dev/nvme0n1p1 rw',
  ].join('\n')
  assert.deepEqual(groupMounts(mountinfo, ['/', '/home', '/boot', '/missing']), [['/', '/home'], ['/boot']])
})

test('volume is an absolute clamped target that unmutes above zero', () => {
  assert.deepEqual(parseVolume('Volume: 0.42 [MUTED]\n'), { volume: 0.42, muted: true })
  assert.equal(parseVolume('nope'), null)
  assert.equal(parseVolume('Volume: .'), null)
  assert.deepEqual(volumeCommands(0.333), [
    ['wpctl', 'set-volume', '-l', '1.0', '@DEFAULT_AUDIO_SINK@', '0.33'],
    ['wpctl', 'set-mute', '@DEFAULT_AUDIO_SINK@', '0'],
  ])
  assert.deepEqual(volumeCommands(0), [['wpctl', 'set-volume', '-l', '1.0', '@DEFAULT_AUDIO_SINK@', '0']])
})

test('installed apps include the stable T3 entry and honour directory order', async () => {
  const user = join(dir, 'apps-user')
  const system = join(dir, 'apps-system')
  mkdirSync(user, { recursive: true })
  mkdirSync(system, { recursive: true })
  const entry = (name, extra = '') => `[Desktop Entry]\nType=Application\nName=${name}\nExec=x\n${extra}\n[Desktop Action new]\nName=Ignored\n`
  writeFileSync(join(user, 'foot.desktop'), entry('Foot (user)'))
  writeFileSync(join(system, 'foot.desktop'), entry('Foot'))
  writeFileSync(join(system, 'com.t3tools.T3Code.desktop'), entry('T3 Code', 'NoDisplay=true'))
  writeFileSync(join(system, 'hidden.desktop'), entry('Hidden', 'NoDisplay=true'))
  writeFileSync(join(system, 'bad name.desktop'), entry('Bad'))
  assert.equal(parseDesktopEntry(entry('Foot')).Name, 'Foot')
  assert.deepEqual(await listApps([user, system]), [
    { desktopId: 'foot.desktop', name: 'Foot (user)' },
    { desktopId: 'com.t3tools.T3Code.desktop', name: 'T3 Code' },
  ])
})

test('polar conditions fall back to the reported day flag when the sun does not rise or set', () => {
  const w = parseForecast({ ...FORECAST, current: { ...FORECAST.current, is_day: 1 }, daily: { ...FORECAST.daily, sunrise: [0], sunset: [0] } }, { lat: 80, lon: 0 })
  assert.equal(w.days[0].sunrise, null)
  assert.equal(w.days[0].sunset, null)
  assert.equal(sceneFor(w, null, w.current.at).sky, 'day')
  assert.throws(() => parseForecast({ ...FORECAST, timezone: 'bad-zone' }, {}), { kind: 'malformed' })
})

test('unknown current daylight is rejected rather than treated as polar night', () => {
  for (const is_day of [undefined, null, 2, '1']) {
    assert.throws(() => parseForecast({ ...FORECAST, current: { ...FORECAST.current, is_day }, daily: { ...FORECAST.daily, sunrise: [0], sunset: [0] } }, { lat: 80, lon: 0 }), { kind: 'malformed' })
  }
})
