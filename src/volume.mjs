const SINK = '@DEFAULT_AUDIO_SINK@'
export function parseVolume(stdout) {
  const match = /Volume:\s+([0-9.]+)/.exec(stdout)
  if (!match || !Number.isFinite(Number(match[1]))) return null
  return { volume: Number(match[1]), muted: /\[MUTED\]/.test(stdout) }
}

export async function readVolume(run) {
  const parsed = parseVolume((await run(['wpctl', 'get-volume', SINK])).stdout)
  if (!parsed) throw new Error('unexpected wpctl output')
  const info = await run(['wpctl', 'inspect', SINK]).then(({ stdout }) => stdout, () => '')
  return { ...parsed, device: /node\.description = "([^"]+)"/.exec(info)?.[1] ?? null }
}

export const volumeCommands = (value) => {
  const target = Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
  const argv = [['wpctl', 'set-volume', '-l', '1.0', SINK, String(target)]]
  if (target > 0) argv.push(['wpctl', 'set-mute', SINK, '0'])
  return argv
}

export const muteCommand = (muted) => ['wpctl', 'set-mute', SINK, muted ? '1' : '0']
