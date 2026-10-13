import { readFile, statfs } from 'node:fs/promises'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function inputs(block) {
  const out = []
  for (const [label, sub] of Object.entries(block ?? {})) {
    if (!sub || typeof sub !== 'object') continue
    const key = Object.keys(sub).find((k) => /^temp\d+_input$/.test(k))
    const value = key ? num(sub[key]) : null
    if (value !== null) out.push({ label, value })
  }
  return out
}

const chip = (json, prefix) => Object.entries(json).find(([name]) => name.startsWith(prefix))

export function parseSensors(json) {
  if (!json || typeof json !== 'object') return { cpu: null, board: null }
  const k10 = chip(json, 'k10temp-')
  const cpuInputs = k10 ? inputs(k10[1]) : []
  const cpu = cpuInputs.find((f) => f.label === 'Tctl') ?? cpuInputs.find((f) => f.label === 'Tdie') ?? null
  const nct = chip(json, 'nct6687-') ?? chip(json, 'nct67')
  const boardInputs = nct ? inputs(nct[1]) : []
  const board = boardInputs.find((f) => /^Diode 0/.test(f.label)) ?? null
  return {
    cpu: cpu ? { celsius: cpu.value, sensor: cpu.label, chip: 'k10temp' } : null,
    board: board ? { celsius: board.value, sensor: board.label, chip: nct[0].split('-')[0] } : null,
  }
}
export function parseNvidiaSmi(stdout) {
  const line = String(stdout).split('\n').find((l) => l.trim())
  if (!line) return null
  const [name, temp, util, used, total] = line.split(',').map((s) => s.trim())
  const n = (s) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : null)
  if (!name || n(temp) === null) return null
  return { name, celsius: n(temp), utilPercent: n(util), vramUsedMiB: n(used), vramTotalMiB: n(total) }
}

/**
 * Pure. Groups configured mount points by the filesystem device in
 * /proc/self/mountinfo, so btrfs subvolumes of one filesystem count once.
 */
export function groupMounts(mountinfo, mounts) {
  const deviceOf = new Map()
  for (const line of mountinfo.split('\n')) {
    const f = line.split(' ')
    if (f.length > 4) deviceOf.set(f[4].replace(/\\040/g, ' '), f[2])
  }
  const groups = new Map()
  for (const m of mounts) {
    const dev = deviceOf.get(m)
    if (!dev) continue
    if (!groups.has(dev)) groups.set(dev, [])
    groups.get(dev).push(m)
  }
  return [...groups.values()]
}
export function parseMeminfo(text) {
  const kb = (key) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)?.[1])
  const total = kb('MemTotal')
  const available = kb('MemAvailable')
  if (!Number.isFinite(total) || !Number.isFinite(available)) return null
  return { usedBytes: (total - available) * 1024, totalBytes: total * 1024 }
}

const settle = (p) => p.then((v) => v, () => null)

export async function readHardware({ mounts }, run) {
  const [sensors, gpu, mountinfo, meminfo] = await Promise.all([
    settle(run(['sensors', '-j']).catch((err) => (err?.stdout ? { stdout: err.stdout } : Promise.reject(err))).then(({ stdout }) => parseSensors(JSON.parse(stdout)))),
    settle(run(['nvidia-smi', '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']).then(({ stdout }) => parseNvidiaSmi(stdout))),
    settle(readFile('/proc/self/mountinfo', 'utf8')),
    settle(readFile('/proc/meminfo', 'utf8')),
  ])
  const storage = []
  for (const group of mountinfo ? groupMounts(mountinfo, mounts) : []) {
    const s = await settle(statfs(group[0]))
    if (s) storage.push({ mounts: group, usedBytes: (s.blocks - s.bfree) * s.bsize, totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize })
  }
  return {
    cpu: sensors?.cpu ?? null,
    gpu,
    board: sensors?.board ?? null,
    storage,
    memory: meminfo ? parseMeminfo(meminfo) : null,
  }
}
