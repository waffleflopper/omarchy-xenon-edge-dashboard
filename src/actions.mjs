import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const TIMEOUT_MS = 15000

// Whitelist of things the touch panel is allowed to trigger. The backend binds
// to loopback, but still: never execute anything caller-supplied.
const ACTIONS = {
  lock: { label: 'Lock screen', cmd: ['omarchy', 'system', 'lock'] },
  nightlight: { label: 'Night light', cmd: ['omarchy', 'toggle', 'nightlight'] },
  micmute: { label: 'Mute mic', cmd: ['wpctl', 'set-mute', '@DEFAULT_AUDIO_SOURCE@', 'toggle'] },
  screensaver: { label: 'Screensaver', cmd: ['omarchy', 'launch', 'screensaver'] },
  screenshot: { label: 'Screenshot', cmd: ['omarchy', 'capture', 'screenshot', 'fullscreen', 'save'] },
  theme: { label: 'Theme', cmd: ['omarchy', 'theme', 'switcher'] },
}

export const ACTION_IDS = Object.keys(ACTIONS)

export async function runAction(name) {
  const action = ACTIONS[name]
  if (!action) throw new Error(`Unknown action: ${name}`)

  const [cmd, ...args] = action.cmd
  try {
    await exec(cmd, args, { timeout: TIMEOUT_MS, env: { ...process.env } })
    return { action: name, ok: true }
  } catch (err) {
    throw new Error(`${action.label} failed: ${err.message}`)
  }
}

// Microphone state, shown as a live indicator on the quick-actions panel.
export async function readMic() {
  const { stdout } = await exec('wpctl', ['get-volume', '@DEFAULT_AUDIO_SOURCE@'])
  const match = stdout.match(/Volume:\s+([0-9.]+)/)
  return {
    volume: match ? Number(match[1]) : null,
    muted: /\[MUTED\]/.test(stdout),
  }
}
