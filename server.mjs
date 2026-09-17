#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readCodex, shutdownCodex } from './src/codex.mjs'
import { readOpenCodeGo } from './src/opencode-go.mjs'
import { readWeather } from './src/weather.mjs'
import { readTheme } from './src/theme.mjs'
import { readVolume, setVolume } from './src/volume.mjs'
import { scanBackgrounds } from './src/backgrounds.mjs'
import { readMic, runAction } from './src/actions.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(ROOT, 'public')
const ASSETS_DIR = join(ROOT, 'assets')
const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
}

// Wrap an async data source with a TTL cache that serves the last good value if
// a refresh fails, so a flaky API never blanks the dashboard.
function source(fn, ttlMs) {
  let last = null
  let lastAt = 0
  let pending = null

  async function load() {
    if (last && Date.now() - lastAt < ttlMs) {
      return { ok: true, data: last.data, fetchedAt: last.fetchedAt, cached: true }
    }
    if (pending) return pending

    pending = (async () => {
      const fetchedAt = Date.now()
      try {
        const data = await fn()
        last = { data, fetchedAt }
        lastAt = Date.now()
        return { ok: true, data, fetchedAt, cached: false }
      } catch (err) {
        const error = String(err?.message ?? err)
        if (last) return { ok: true, data: last.data, fetchedAt: last.fetchedAt, cached: true, stale: true, error }
        return { ok: false, error, fetchedAt }
      } finally {
        pending = null
      }
    })()

    return pending
  }

  // Drop the cached value so the next read refetches straight away (used by the
  // Omarchy theme-set hook).
  load.invalidate = () => {
    last = null
    lastAt = 0
    pending = null
  }

  return load
}

const sources = {
  codex: source(readCodex, 60_000),
  opencode: source(readOpenCodeGo, 60_000),
  weather: source(readWeather, 10 * 60_000),
  theme: source(readTheme, 60_000),
  // Short TTL so dropping a new image in shows up quickly.
  backgrounds: source(() => scanBackgrounds(join(ASSETS_DIR, 'weather')), 30_000),
}

// Server-sent events so the page reacts immediately instead of waiting for its
// next poll (used for instant theme switching).
const sseClients = new Set()

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) {
    try {
      client.write(payload)
    } catch {
      sseClients.delete(client)
    }
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function serveStatic(res, urlPath) {
  // /assets/* is served from the project's assets/ dir (user-supplied images);
  // everything else comes from public/.
  const fromAssets = urlPath.startsWith('/assets/')
  const base = fromAssets ? ASSETS_DIR : PUBLIC_DIR
  const cleaned = (fromAssets ? urlPath.slice('/assets/'.length) : urlPath).replace(/^\/+/, '')

  const rel = cleaned === '' ? 'index.html' : normalize(cleaned)
  if (rel.startsWith('..') || rel === '.') return sendJson(res, 400, { error: 'bad path' })
  const file = join(base, rel)
  try {
    const data = await readFile(file)
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    })
    res.end(data)
  } catch {
    sendJson(res, 404, { error: 'not found' })
  }
}

async function buildState() {
  const [theme, weather, backgrounds, codex, opencode, volume, mic] = await Promise.all([
    sources.theme(),
    sources.weather(),
    sources.backgrounds(),
    sources.codex(),
    sources.opencode(),
    readVolume().then(
      (data) => ({ ok: true, data }),
      (err) => ({ ok: false, error: String(err?.message ?? err) }),
    ),
    readMic().then(
      (data) => ({ ok: true, data }),
      (err) => ({ ok: false, error: String(err?.message ?? err) }),
    ),
  ])

  return {
    now: new Date().toISOString(),
    theme,
    weather,
    backgrounds,
    codex,
    opencode,
    volume,
    mic,
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)

  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true })
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJson(res, 200, await buildState())
    }

    if (req.method === 'GET' && url.pathname === '/api/volume') {
      try {
        return sendJson(res, 200, { ok: true, data: await readVolume() })
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: String(err?.message ?? err) })
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/volume') {
      const body = await readBody(req)
      try {
        const data = await setVolume(body)
        return sendJson(res, 200, { ok: true, data })
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: String(err?.message ?? err) })
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      sseClients.add(res)

      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n')
        } catch {
          clearInterval(ping)
          sseClients.delete(res)
        }
      }, 25000)

      req.on('close', () => {
        clearInterval(ping)
        sseClients.delete(res)
      })
      return
    }

    // Called by the Omarchy theme-set hook (see hooks/theme-set-refresh.sh).
    if (req.method === 'POST' && url.pathname === '/api/theme/refresh') {
      sources.theme.invalidate()
      const theme = await sources.theme()
      broadcast('theme', { name: theme.data?.name ?? null, mode: theme.data?.mode ?? null })
      return sendJson(res, 200, { ok: true, theme: theme.data })
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req)
      try {
        const result = await runAction(body.action)
        // Muting the mic changes state we display, so return it immediately.
        const extra = body.action === 'micmute' ? { mic: await readMic().catch(() => null) } : {}
        return sendJson(res, 200, { ...result, ...extra })
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: String(err?.message ?? err) })
      }
    }

    if (req.method === 'GET') return serveStatic(res, url.pathname)

    sendJson(res, 405, { error: 'method not allowed' })
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message ?? err) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`waffle-dashboard listening on http://${HOST}:${PORT}`)
})

function shutdown() {
  shutdownCodex()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
