import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const TIMEOUT_MS = 8000

// Map a chip id (e.g. "k10temp-pci-00c3") to a friendly label. First match wins.
const CHIP_LABELS = [
  [/^k10temp/, 'CPU'],
  [/^coretemp/, 'CPU'],
  [/^zenpower/, 'CPU'],
  [/^cpu_thermal/, 'CPU'],
  [/^amdgpu/, 'GPU'],
  [/^nouveau/, 'GPU'],
  [/^nvidia/, 'GPU'],
  [/^nct6/, 'Mobo'],
  [/^it87/, 'Mobo'],
  [/^f71/, 'Mobo'],
  [/^nvme/, 'NVMe'],
  [/^spd5118/, 'RAM'],
  [/^mt79/, 'WiFi'],
  [/^iwl/, 'WiFi'],
  [/^ath/, 'WiFi'],
  [/^rtw/, 'WiFi'],
  [/^r8169/, 'Ethernet'],
  [/^igb/, 'Ethernet'],
  [/^e1000/, 'Ethernet'],
  [/^atlantic/, 'Ethernet'],
]

// Preferred sub-sensor per chip family, so we show Tctl rather than a random
// board thermistor. Falls back to the first temperature on the chip.
const PREFERRED = [
  [/^k10temp/, ['Tctl', 'Tdie', 'Tccd1']],
  [/^amdgpu/, ['edge', 'junction', 'mem']],
  [/^nvme/, ['Composite']],
  [/^spd5118/, ['temp1']],
  [/^nct6/, ['AMD TSI Addr 98h', 'SYSTIN', 'CPUTIN']],
]

const RANK = { CPU: 0, GPU: 1, Mobo: 2, NVMe: 3, RAM: 4, WiFi: 5, Ethernet: 6 }
const MAX = 8

function baseLabel(chip) {
  return CHIP_LABELS.find(([re]) => re.test(chip))?.[1] ?? null
}

function pick(chip, features) {
  const prefs = PREFERRED.find(([re]) => re.test(chip))
  if (prefs) {
    for (const want of prefs[1]) {
      const hit = features.find((f) => f.key === want)
      if (hit) return hit
    }
  }
  return features[0]
}

function featuresOf(block) {
  const out = []
  for (const [key, sub] of Object.entries(block)) {
    if (!sub || typeof sub !== 'object') continue
    const inputKey = Object.keys(sub).find((k) => /^temp\d+_input$/.test(k))
    if (!inputKey) continue
    const value = Number(sub[inputKey])
    if (Number.isFinite(value)) out.push({ key, value })
  }
  return out
}

// Read every temperature `sensors` knows about, then keep one reading per
// chip and give the common ones friendly names.
export async function readTemps() {
  let stdout
  try {
    ;({ stdout } = await exec('sensors', ['-j'], { timeout: TIMEOUT_MS }))
  } catch (err) {
    if (err.stdout) stdout = err.stdout
    else throw new Error(`sensors failed: ${err.message}`)
  }

  let json
  try {
    json = JSON.parse(stdout)
  } catch {
    throw new Error('sensors did not return JSON')
  }

  const picks = []
  for (const [chip, block] of Object.entries(json)) {
    if (!block || typeof block !== 'object') continue
    const base = baseLabel(chip)
    if (!base) continue
    const features = featuresOf(block)
    if (!features.length) continue
    picks.push({ base, chosen: pick(chip, features) })
  }

  const totals = {}
  for (const p of picks) totals[p.base] = (totals[p.base] ?? 0) + 1

  const seen = {}
  const sensors = picks
    .map((p) => {
      seen[p.base] = (seen[p.base] ?? 0) + 1
      const label = totals[p.base] > 1 ? `${p.base} ${seen[p.base]}` : p.base
      return { base: p.base, label, value: Number(p.chosen.value.toFixed(1)) }
    })
    .sort((a, b) => (RANK[a.base] ?? 9) - (RANK[b.base] ?? 9) || a.label.localeCompare(b.label))
    .slice(0, MAX)
    .map(({ label, value }) => ({ label, value }))

  return { sensors }
}
