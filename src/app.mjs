import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { POLICIES } from '../public/domain.mjs'
import { ActionError, parseAction, perform } from './actions.mjs'
import { listApps } from './apps.mjs'
import { readClaudeAccount } from './claude.mjs'
import { readCodexAccount } from './codex.mjs'
import { readHardware } from './hardware.mjs'
import { createHub } from './hub.mjs'
import { listThemes, readTheme } from './theme.mjs'
import { readVolume } from './volume.mjs'
import { readAurora, readWeather, searchPlaces } from './weather.mjs'

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const MAX_BODY = 8 * 1024
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
}

const MIN = 60_000
export function liveSources({ config, run, hubRef }) {
  const accounts = config.get().accounts.map((account) => ({
    id: `quota:${account.id}`,
    policy: POLICIES.quota,
    ttlMs: account.provider === 'codex' ? 2 * MIN : 5 * MIN,
    timeoutMs: account.provider === 'codex' ? 60_000 : 15_000,
    read: (signal) => (account.provider === 'codex' ? readCodexAccount(account) : readClaudeAccount(account, { signal })),
  }))
  return [
    { id: 'theme', policy: POLICIES.theme, ttlMs: MIN, timeoutMs: 5000, read: async () => readTheme() },
    { id: 'config', policy: POLICIES.theme, ttlMs: 60 * MIN, timeoutMs: 5000, read: async () => publicConfig(config) },
    { id: 'volume', policy: POLICIES.volume, ttlMs: 5000, timeoutMs: 5000, read: () => readVolume(run) },
    { id: 'hardware', policy: POLICIES.hardware, ttlMs: 10_000, timeoutMs: 10_000, read: () => readHardware(config.get(), run) },
    { id: 'weather', policy: POLICIES.weather, ttlMs: 10 * MIN, timeoutMs: 20_000, read: (signal) => readWeather(config.get(), signal) },
    {
      id: 'aurora',
      policy: POLICIES.aurora,
      ttlMs: 30 * MIN,
      timeoutMs: 30_000,
      read: async (signal) => {
        const hub = hubRef()
        if (!('value' in hub.peek('weather'))) await hub.refresh('weather')
        return readAurora(hub.peek('weather').value?.place, signal)
      },
    },
    ...accounts,
  ]
}

export function publicConfig(config) {
  const c = config.get()
  return {
    launchers: c.launchers,
    location: c.location,
    units: c.units,
    accounts: c.accounts.map(({ id, provider, label }) => ({ id, provider, label })),
    problem: config.problem(),
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS })
  res.end(payload)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new ActionError(413, 'request too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ActionError(400, 'invalid JSON')
  }
}

async function serveStatic(res, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return send(res, 400, { error: 'bad path' })
  }
  const rel = normalize(decoded).replace(/^[/\\]+/, '') || 'index.html'
  const file = join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR) || rel.split(sep).includes('..')) return send(res, 404, { error: 'not found' })
  try {
    const data = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...SECURITY_HEADERS })
    res.end(data)
  } catch {
    send(res, 404, { error: 'not found' })
  }
}

/**
 * deps: { config, run, sources?, listApps?, listThemes?, searchPlaces?, log? }
 * Returns { server, hub }. Call server.listen(port, '127.0.0.1').
 */
export function createDashboard(deps) {
  const log = deps.log ?? ((msg) => console.log(msg))
  let hub
  const defs = deps.sources ?? liveSources({ config: deps.config, run: deps.run, hubRef: () => hub })
  hub = createHub(defs, { log })
  const actionDeps = {
    run: deps.run,
    config: deps.config,
    hub,
    listApps: deps.listApps ?? (() => listApps()),
    listThemes: deps.listThemes ?? listThemes,
    searchPlaces: deps.searchPlaces ?? ((q) => searchPlaces(q, AbortSignal.timeout(10_000))),
  }

  let volumeWrites = Promise.resolve()
  const server = createServer(async (req, res) => {
    const port = server.address()?.port
    const host = req.headers.host
    const loopbackHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`
    let path = '?'

    try {
      path = new URL(req.url, 'http://local').pathname
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true })
      if (!loopbackHost) return send(res, 403, { error: 'forbidden host' })

      if (req.method === 'GET') {
        if (path === '/api/stream') return hub.attach(res)
        if (path === '/api/apps') return send(res, 200, { apps: await actionDeps.listApps() })
        if (path === '/api/themes') return send(res, 200, { themes: actionDeps.listThemes().map(({ name, mode, colors }) => ({ name, mode, colors })) })
        if (path.startsWith('/api/')) return send(res, 404, { error: 'not found' })
        return await serveStatic(res, path)
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })

      const origin = req.headers.origin
      const sameOrigin = origin === `http://${host}`

      // The Omarchy theme-set hook posts with curl: no Origin, no body.
      if (path === '/api/theme/refresh') {
        if (origin !== undefined && !sameOrigin) return send(res, 403, { error: 'forbidden origin' })
        await hub.refresh('theme', { force: true })
        return send(res, 200, { ok: true })
      }

      if (path !== '/api/do') return send(res, 404, { error: 'not found' })
      if (!sameOrigin) return send(res, 403, { error: 'forbidden origin' })
      if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'JSON required' })
      const action = parseAction(await readJsonBody(req))
      if (!action) return send(res, 400, { error: 'invalid action' })
      log(`[action] ${action.kind}`)
      let operation
      if (action.kind === 'volume.set' || action.kind === 'volume.mute') {
        operation = volumeWrites.then(() => perform(action, actionDeps))
        volumeWrites = operation.catch(() => {})
      } else operation = perform(action, actionDeps)
      const result = await operation
      if (action.kind === 'launchers.save' || action.kind === 'location.set') hub.refresh('config', { force: true })
      return send(res, 200, result)
    } catch (err) {
      if (err instanceof ActionError) return send(res, err.status, { error: err.message })
      log(`[http] ${req.method} ${path} failed: ${err?.code ?? err?.name ?? 'error'}`)
      return send(res, 500, { error: 'internal error' })
    }
  })

  server.on('close', () => hub.close())
  return { server, hub }
}
