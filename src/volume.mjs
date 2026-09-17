import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const SINK = '@DEFAULT_AUDIO_SINK@'

// One tap of the +/- buttons.
export const VOLUME_STEP = 0.05

const clamp = (n) => Math.max(0, Math.min(1, n))

export async function readVolume() {
  const { stdout } = await exec('wpctl', ['get-volume', SINK])
  const match = stdout.match(/Volume:\s+([0-9.]+)/)
  if (!match) throw new Error(`Unexpected wpctl output: ${stdout.trim()}`)

  let device = null
  try {
    const { stdout: info } = await exec('wpctl', ['inspect', SINK])
    device = info.match(/node\.description = "([^"]+)"/)?.[1] ?? null
  } catch {
    // The name is cosmetic; a failure here shouldn't blank the widget.
  }

  return {
    volume: Number(match[1]),
    muted: /\[MUTED\]/.test(stdout),
    device,
    step: VOLUME_STEP,
  }
}

export async function setVolume({ action, value }) {
  switch (action) {
    case 'up':
      await exec('wpctl', ['set-volume', '-l', '1.0', SINK, `${VOLUME_STEP * 100}%+`])
      break
    case 'down':
      await exec('wpctl', ['set-volume', SINK, `${VOLUME_STEP * 100}%-`])
      break
    case 'mute':
      await exec('wpctl', ['set-mute', SINK, 'toggle'])
      break
    case 'unmute':
      await exec('wpctl', ['set-mute', SINK, '0'])
      break
    case 'set': {
      if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('set requires a numeric value')
      const target = clamp(value)
      await exec('wpctl', ['set-volume', '-l', '1.0', SINK, String(target)])
      // Sliding up from zero should also un-mute, matching every other mixer.
      if (target > 0) await exec('wpctl', ['set-mute', SINK, '0'])
      break
    }
    default:
      throw new Error(`Unknown volume action: ${action}`)
  }
  return readVolume()
}
