#!/usr/bin/env node
import { dryRunner, execRunner } from './src/actions.mjs'
import { createDashboard } from './src/app.mjs'
import { defaultConfigPath, openConfig } from './src/config.mjs'
import { shutdownCodex } from './src/codex.mjs'

const PORT = Number(process.env.PORT || 8787)
const HOST = '127.0.0.1'
const DRY_RUN = new Set((process.env.WAFFLE_DRY_RUN ?? '').split(',').map((s) => s.trim()).filter(Boolean))

const config = await openConfig(defaultConfigPath())
const { server, hub } = createDashboard({ config, run: dryRunner(execRunner, DRY_RUN) })

server.listen(PORT, HOST, () => {
  console.log(`waffle-dashboard listening on http://${HOST}:${PORT} (config ${config.path}${DRY_RUN.size ? `, dry run: ${[...DRY_RUN].join(',')}` : ''})`)
  hub.start()
})

function shutdown() {
  shutdownCodex()
  server.closeAllConnections?.()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
