import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MAX_LAUNCHERS = 4
export const DESKTOP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.desktop$/
export const MONITOR = /^[A-Za-z0-9_-]{1,32}$/

export const defaultConfigPath = () =>
  process.env.WAFFLE_CONFIG_PATH || join(homedir(), '.config/waffle-dashboard/config.json')

export const DEFAULT_CONFIG = Object.freeze({
  launchers: [
    { label: 'Helium', desktopId: 'helium.desktop' },
    { label: 'Terminal', desktopId: 'foot.desktop' },
    { label: 'T3 Code', desktopId: 'com.t3tools.T3Code.desktop' },
    { label: 'Discord', desktopId: 'Discord.desktop' },
  ],
  location: null,
  units: 'imperial',
  mounts: ['/', '/home'],
  edgeMonitor: 'DP-2',
  launchMonitor: null,
  accounts: [
    { id: 'openai', provider: 'codex', label: 'OpenAI' },
    { id: 'claude', provider: 'claude', label: 'Claude', configDir: '~/.claude', identityFile: '~/.claude.json' },
    { id: 'claude-waffle', provider: 'claude', label: 'ClaudeWaffle', configDir: '~/.claude_waffle', identityFile: '~/.claude_waffle/.claude.json' },
  ],
})

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max

export function parseLauncher(raw) {
  if (!isObject(raw) || !text(raw.label, 24) || typeof raw.desktopId !== 'string' || !DESKTOP_ID.test(raw.desktopId)) return null
  return { label: raw.label.trim(), desktopId: raw.desktopId }
}

export function parseLaunchers(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_LAUNCHERS) return null
  const out = raw.map(parseLauncher)
  if (out.some((l) => !l)) return null
  if (new Set(out.map((l) => l.desktopId)).size !== out.length) return null
  return out
}

export function parseLocation(raw) {
  if (raw === null) return null
  if (!isObject(raw) || !text(raw.name, 80)) return undefined
  const { lat, lon } = raw
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
  return { name: raw.name.trim(), lat, lon }
}

function parseAccount(raw) {
  if (!isObject(raw) || !/^[a-z0-9-]{1,32}$/.test(raw.id ?? '') || !text(raw.label, 24)) return null
  if (raw.provider === 'codex') return { id: raw.id, provider: 'codex', label: raw.label }
  if (raw.provider === 'claude' && text(raw.configDir, 256) && text(raw.identityFile, 256)) {
    return { id: raw.id, provider: 'claude', label: raw.label, configDir: raw.configDir, identityFile: raw.identityFile }
  }
  return null
}

const FIELDS = {
  launchers: (v) => parseLaunchers(v) ?? undefined,
  location: parseLocation,
  units: (v) => (v === 'imperial' || v === 'metric' ? v : undefined),
  mounts: (v) => (Array.isArray(v) && v.length && v.length <= 6 && v.every((m) => text(m, 256) && m.startsWith('/')) ? v : undefined),
  edgeMonitor: (v) => (typeof v === 'string' && MONITOR.test(v) ? v : undefined),
  launchMonitor: (v) => (v === null || (typeof v === 'string' && MONITOR.test(v)) ? v : undefined),
  accounts: (v) => {
    if (!Array.isArray(v) || v.length > 6) return undefined
    const out = v.map(parseAccount)
    return out.every(Boolean) && new Set(out.map((a) => a.id)).size === out.length ? out : undefined
  },
}
export function parseConfig(raw) {
  const warnings = []
  const config = structuredClone(DEFAULT_CONFIG)
  if (!isObject(raw)) return { config, warnings: ['config root is not an object'] }
  for (const [key, parse] of Object.entries(FIELDS)) {
    if (!(key in raw)) continue
    const value = parse(raw[key])
    if (value === undefined) warnings.push(`${key} is invalid; using the default`)
    else config[key] = value
  }
  return { config, warnings }
}

export async function openConfig(path = defaultConfigPath()) {
  let raw = {}
  let problem = null
  let config
  try {
    raw = JSON.parse(await readFile(path, 'utf8'))
    const parsed = parseConfig(raw)
    config = parsed.config
    if (parsed.warnings.length) problem = parsed.warnings.join('; ')
  } catch (err) {
    config = structuredClone(DEFAULT_CONFIG)
    if (err.code !== 'ENOENT') problem = err instanceof SyntaxError ? 'config.json is not valid JSON' : `config.json unreadable (${err.code ?? 'error'})`
    raw = {}
  }
  if (problem) console.warn(`[config] ${path}: ${problem}; using defaults for the affected settings`)

  let writing = Promise.resolve()

  return {
    path,
    get: () => config,
    problem: () => problem,
    /** Applies a patch of already-validated fields and writes atomically. */
    update(patch) {
      const next = writing.then(async () => {
        if (problem) throw new Error(`${path} has problems (${problem}); fix or remove it before saving`)
        const nextRaw = { ...raw, ...patch }
        await writeAtomic(path, `${JSON.stringify(nextRaw, null, 2)}\n`)
        raw = nextRaw
        config = { ...config, ...patch }
        return config
      })
      writing = next.catch(() => {})
      return next
    },
  }
}

export async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const handle = await open(tmp, 'w', 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmp, path)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

export const expandHome = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
