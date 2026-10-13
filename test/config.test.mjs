import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { launchMonitor, parseAction } from '../src/actions.mjs'
import { DEFAULT_CONFIG, openConfig, parseConfig } from '../src/config.mjs'

const dir = mkdtempSync(join(tmpdir(), 'waffle-config-'))
after(() => rmSync(dir, { recursive: true, force: true }))
const quiet = (fn) => async () => {
  const warn = console.warn
  console.warn = () => {}
  try {
    await fn()
  } finally {
    console.warn = warn
  }
}

test('a missing config file means defaults and saving is allowed', async () => {
  const config = await openConfig(join(dir, 'missing', 'config.json'))
  assert.equal(config.problem(), null)
  assert.deepEqual(config.get(), structuredClone(DEFAULT_CONFIG))
})

test('a malformed config is reported and never overwritten', quiet(async () => {
  const path = join(dir, 'broken.json')
  writeFileSync(path, '{ "launchers": [')
  const config = await openConfig(path)
  assert.equal(config.problem(), 'config.json is not valid JSON')
  await assert.rejects(config.update({ location: null }), /fix or remove it before saving/)
  assert.equal(readFileSync(path, 'utf8'), '{ "launchers": [')
}))

test('an invalid field falls back to its default and blocks saving', quiet(async () => {
  const path = join(dir, 'bad-launcher.json')
  writeFileSync(path, JSON.stringify({ launchers: [{ label: 'Bad', desktopId: '../../evil.desktop' }] }))
  const config = await openConfig(path)
  assert.equal(config.problem(), 'launchers is invalid; using the default')
  assert.equal(config.get().launchers[0].desktopId, 'helium.desktop')
}))

test('a save is atomic, reloads the same and keeps keys it does not own', async () => {
  const path = join(dir, 'good.json')
  writeFileSync(path, JSON.stringify({ units: 'metric', futureSetting: 7 }))
  const config = await openConfig(path)
  const location = { name: 'Fairbanks, Alaska, United States', lat: 64.8378, lon: -147.7164 }
  await config.update({ location })
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.tmp-')), [])
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { units: 'metric', futureSetting: 7, location })
  const reloaded = await openConfig(path)
  assert.deepEqual(reloaded.get().location, location)
  assert.equal(reloaded.get().units, 'metric')
})

test('config parsing rejects duplicate launchers and out of range places', () => {
  const dup = parseConfig({ launchers: [{ label: 'A', desktopId: 'foot.desktop' }, { label: 'B', desktopId: 'foot.desktop' }] })
  assert.deepEqual(dup.warnings, ['launchers is invalid; using the default'])
  assert.deepEqual(parseConfig({ location: { name: 'Nowhere', lat: 91, lon: 0 } }).warnings, ['location is invalid; using the default'])
  assert.deepEqual(parseConfig({ location: null }).warnings, [])
})

test('actions are a closed set with exact keys', () => {
  assert.deepEqual(parseAction({ kind: 'power', power: 'sleep' }), { kind: 'power', power: 'sleep' })
  assert.equal(parseAction({ kind: 'power', power: 'reboot' }), null)
  assert.equal(parseAction({ kind: 'power', power: 'sleep', argv: ['rm'] }), null)
  assert.equal(parseAction({ kind: 'constructor' }), null)
  assert.equal(parseAction({ kind: 'toString' }), null)
  assert.equal(parseAction({ kind: 'launch', desktopId: 'foot.desktop; rm -rf ~' }), null)
  assert.equal(parseAction({ kind: 'volume.set', value: 1.5 }), null)
  assert.equal(parseAction({ kind: 'theme.set', name: 'x'.repeat(65) }), null)
  assert.equal(parseAction([]), null)
})

test('launched apps target a monitor other than the Edge', () => {
  const monitors = [
    { name: 'DP-2', focused: true, width: 2560, height: 720 },
    { name: 'DP-1', focused: false, width: 3440, height: 1440 },
    { name: 'HDMI-A-1', focused: false, width: 2560, height: 1440 },
  ]
  assert.equal(launchMonitor(monitors, { edgeMonitor: 'DP-2', launchMonitor: null }), 'DP-1')
  assert.equal(launchMonitor(monitors, { edgeMonitor: 'DP-2', launchMonitor: 'HDMI-A-1' }), 'HDMI-A-1')
  assert.equal(launchMonitor([{ ...monitors[1], focused: true }, monitors[2]], { edgeMonitor: 'DP-2', launchMonitor: null }), 'DP-1')
  assert.equal(launchMonitor([monitors[0]], { edgeMonitor: 'DP-2', launchMonitor: null }), null)
})
