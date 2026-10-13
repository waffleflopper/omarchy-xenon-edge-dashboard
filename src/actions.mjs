import { execFile } from 'node:child_process'

import { DESKTOP_ID, MONITOR, parseLaunchers, parseLocation } from './config.mjs'
import { muteCommand, volumeCommands } from './volume.mjs'

export const COMMANDS = {
  screenshot: ['omarchy', 'capture', 'screenshot', 'fullscreen', 'save'],
  screensaver: ['omarchy', 'launch', 'screensaver', 'force'],
  sleep: ['systemctl', 'suspend'],
  shutdown: ['omarchy', 'system', 'shutdown'],
  themeSet: (name) => ['omarchy', 'theme', 'set', name],
  monitors: ['hyprctl', 'monitors', '-j'],
  focusMonitorLua: (name) => ['hyprctl', 'dispatch', `hl.dsp.focus({ monitor = "${name}" })`],
  focusMonitorLegacy: (name) => ['hyprctl', 'dispatch', 'focusmonitor', name],
  // uwsm starts the app in its own systemd unit, outside the dashboard service.
  launch: (desktopId) => ['uwsm-app', '--', desktopId],
}

export class ActionError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export function execRunner(argv, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout
        reject(err)
      } else resolve({ stdout, stderr })
    })
  })
}

/**
 * WAFFLE_DRY_RUN names command groups to record instead of run, for example
 * "power" while exercising the UI. It is only ever set explicitly.
 */
export function dryRunner(run, groups, log = console.log) {
  if (!groups.size) return run
  return (argv, opts = {}) => {
    if (!groups.has(opts.group)) return run(argv, opts)
    log(`[dry-run] ${opts.group}: ${argv.join(' ')}`)
    return Promise.resolve({ stdout: '', stderr: '', dryRun: true })
  }
}

const SHAPES = {
  'volume.set': { value: (v) => typeof v === 'number' && v >= 0 && v <= 1 },
  'volume.mute': { muted: (v) => typeof v === 'boolean' },
  'theme.set': { name: (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 },
  screenshot: {},
  screensaver: {},
  launch: { desktopId: (v) => typeof v === 'string' && DESKTOP_ID.test(v) },
  'launchers.save': { launchers: (v) => parseLaunchers(v) !== null },
  'location.search': { query: (v) => typeof v === 'string' && v.trim().length >= 2 && v.length <= 80 },
  'location.set': { location: (v) => parseLocation(v) !== undefined },
  refresh: { id: (v) => typeof v === 'string' && v.length <= 64 },
  power: { power: (v) => v === 'sleep' || v === 'shutdown' },
}
export function parseAction(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
  if (typeof body.kind !== 'string' || !Object.hasOwn(SHAPES, body.kind)) return null
  const shape = SHAPES[body.kind]
  const keys = Object.keys(body).filter((k) => k !== 'kind')
  if (keys.length !== Object.keys(shape).length) return null
  for (const key of keys) if (!Object.hasOwn(shape, key) || !shape[key](body[key])) return null
  if (body.kind === 'launchers.save') return { kind: body.kind, launchers: parseLaunchers(body.launchers) }
  if (body.kind === 'location.set') return { kind: body.kind, location: parseLocation(body.location) }
  return body
}
export function launchMonitor(monitors, { edgeMonitor, launchMonitor: preferred }) {
  const others = monitors.filter((m) => m.name !== edgeMonitor && MONITOR.test(m.name))
  if (preferred && others.some((m) => m.name === preferred)) return preferred
  const focused = others.find((m) => m.focused)
  if (focused) return focused.name
  return others.sort((a, b) => b.width * b.height - a.width * a.height)[0]?.name ?? null
}

async function readMonitors(deps) {
  const monitors = JSON.parse((await deps.run(COMMANDS.monitors, { group: 'query' })).stdout)
  return Array.isArray(monitors) ? monitors : []
}

async function focusLaunchMonitor(deps) {
  const fail = (message) => {
    throw new ActionError(409, message)
  }
  let monitors
  try {
    monitors = await readMonitors(deps)
  } catch {
    fail('Could not read monitors from Hyprland; launch cancelled')
  }
  const target = launchMonitor(monitors, deps.config.get())
  if (!target) fail('No monitor other than the Edge; set launchMonitor in config.json')
  if (monitors.find((m) => m.name === target)?.focused) return target
  for (const argv of [COMMANDS.focusMonitorLua(target), COMMANDS.focusMonitorLegacy(target)]) {
    const moved = await deps.run(argv, { group: 'launch' }).catch(() => null)
    if (moved?.dryRun) return target
    const after = await readMonitors(deps).catch(() => [])
    if (after.find((m) => m.focused)?.name === target) return target
  }
  fail(`Could not move focus to ${target}; launch cancelled so the app does not open on the Edge`)
  return target
}

/**
 * deps: { run(argv, {group}), config, hub, listApps(), listThemes(), searchPlaces(query) }
 * Returns a JSON-able result or throws ActionError.
 */
export async function perform(action, deps) {
  const { run, config, hub } = deps
  const fail = (status, message) => {
    throw new ActionError(status, message)
  }
  const exec = async (argv, group, label) => {
    try {
      const r = await run(argv, { group })
      return { ok: true, dryRun: !!r?.dryRun }
    } catch {
      fail(502, `${label} failed`)
    }
  }

  switch (action.kind) {
    case 'volume.set':
    case 'volume.mute': {
      const argvs = action.kind === 'volume.set' ? volumeCommands(action.value) : [muteCommand(action.muted)]
      try {
        for (const argv of argvs) await run(argv, { group: 'volume' })
      } catch {
        fail(502, 'Volume change failed')
      } finally {
        await hub.refresh('volume', { force: true })
      }
      return { ok: true }
    }
    case 'theme.set': {
      const theme = deps.listThemes().find((t) => t.name === action.name)
      if (!theme) fail(400, 'unknown theme')
      const result = await exec(COMMANDS.themeSet(theme.name), 'theme', 'Theme change')
      await hub.refresh('theme', { force: true })
      return result
    }
    case 'screenshot':
      return exec(COMMANDS.screenshot, 'screenshot', 'Screenshot')
    case 'screensaver':
      return exec(COMMANDS.screensaver, 'screensaver', 'Screensaver')
    case 'launch': {
      if (!config.get().launchers.some((l) => l.desktopId === action.desktopId)) fail(400, 'not a configured launcher')
      const monitor = await focusLaunchMonitor(deps)
      return { ...(await exec(COMMANDS.launch(action.desktopId), 'launch', 'Launch')), monitor }
    }
    case 'launchers.save': {
      const installed = new Set((await deps.listApps()).map((a) => a.desktopId))
      const missing = action.launchers.find((l) => !installed.has(l.desktopId))
      if (missing) fail(400, `${missing.desktopId} is not installed`)
      try {
        await config.update({ launchers: action.launchers })
      } catch (err) {
        fail(409, err.message)
      }
      return { ok: true, launchers: config.get().launchers }
    }
    case 'location.search':
      try {
        return { ok: true, results: await deps.searchPlaces(action.query.trim()) }
      } catch {
        fail(502, 'place search unavailable')
      }
      break
    case 'location.set':
      try {
        await config.update({ location: action.location })
      } catch (err) {
        fail(409, err.message)
      }
      hub.invalidate('weather').then(() => hub.invalidate('aurora'))
      return { ok: true, location: config.get().location }
    case 'refresh':
      if (!hub.has(action.id)) fail(400, 'unknown source')
      hub.refresh(action.id)
      return { ok: true, retryAt: hub.retryAt(action.id) || null }
    case 'power':
      return exec(COMMANDS[action.power], 'power', action.power === 'sleep' ? 'Sleep' : 'Shut down')
  }
  fail(400, 'unsupported action')
}
