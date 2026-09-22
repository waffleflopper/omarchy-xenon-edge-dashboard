import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CURRENT_DIR = join(homedir(), '.local/state/omarchy/current')
const USER_THEMES = join(homedir(), '.config/omarchy/themes')
const SYSTEM_THEMES = '/usr/share/omarchy/themes'

// Last resort for an unreadable theme. It is deliberately never merged into a
// theme that supplied its own page and text colours.
const FALLBACK = {
  background: '#282a36',
  lighter_background: '#343746',
  darker_background: '#191a21',
  foreground: '#f8f8f2',
  accent: '#bd93f9',
  muted: '#a7adc7',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  orange: '#ffb86c',
  red: '#ff5555',
  cyan: '#8be9fd',
}

// Omarchy 4 shortened the surface/text names. Themes may use either vocabulary
// or both, so the dashboard resolves its fixed roles before deriving gaps.
const ROLES = {
  background: ['background', 'bg'],
  lighter_background: ['lighter_background', 'lighter_bg'],
  darker_background: ['darker_background', 'darker_bg'],
  foreground: ['foreground', 'fg'],
  muted: ['muted'],
  accent: ['accent', 'blue'],
  green: ['green'],
  yellow: ['yellow'],
  orange: ['orange', 'yellow'],
  red: ['red'],
  cyan: ['cyan'],
}

const SURFACES = ['background', 'lighter_background', 'darker_background']
const ACCENTS = ['accent', 'green', 'yellow', 'orange', 'red', 'cyan']

function toRgb(hex) {
  const digits = String(hex).replace('#', '')
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16))
}

function mix(from, to, amount) {
  const a = toRgb(from)
  const b = toRgb(to)
  if (!a || !b) return from
  const channel = (index) =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

function luminance(hex) {
  const rgb = toRgb(hex)
  if (!rgb) return null
  const channels = rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const left = luminance(a)
  const right = luminance(b)
  if (left == null || right == null) return 0
  const [lighter, darker] = [left, right].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

function readableOn(color, colors) {
  return SURFACES.every((surface) => contrast(color, colors[surface]) >= 4.5)
}

function deriveMuted(colors) {
  // Pick the quietest blend of the theme's own anchors that still meets WCAG
  // contrast on every dashboard surface.
  for (let percent = 50; percent >= 0; percent -= 1) {
    const candidate = mix(colors.foreground, colors.background, percent / 100)
    if (readableOn(candidate, colors)) return candidate
  }
  return colors.foreground
}

export function parseColorsToml(text) {
  const colors = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/)
    if (match) colors[match[1]] = match[2]
  }
  return colors
}

export function resolvePalette(raw = {}) {
  const mode = raw.mode === 'light' ? 'light' : 'dark'
  const colors = {}

  for (const [role, names] of Object.entries(ROLES)) {
    const found = names.find((name) => raw[name])
    if (found) colors[role] = raw[found]
  }

  // Without the two palette anchors there is no readable theme to derive from.
  if (!colors.background || !colors.foreground) return { mode: 'dark', colors: { ...FALLBACK } }

  colors.lighter_background ||= mix(colors.background, colors.foreground, 0.06)
  colors.darker_background ||= mix(colors.background, colors.foreground, 0.1)

  // Omarchy's "darker" role is not necessarily a nearby inset surface. For
  // example, Dune Messiah's value is mid-grey and cannot carry its text roles.
  for (const surface of ['lighter_background', 'darker_background']) {
    if (contrast(colors.foreground, colors[surface]) < 4.5) {
      colors[surface] = mix(colors.background, colors.foreground, 0.06)
    }
  }

  if (!colors.muted || !readableOn(colors.muted, colors)) colors.muted = deriveMuted(colors)

  // Missing status colours stay inside this theme. Prefer its accent; when it
  // has none, the readable text blend above is the only honest local colour.
  colors.accent ||= colors.muted
  for (const role of ACCENTS) colors[role] ||= colors.accent

  return { mode, colors }
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function findThemeDir(name) {
  if (!name) return null
  const wanted = name.toLowerCase()
  for (const base of [USER_THEMES, SYSTEM_THEMES]) {
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    const hit = entries.find((entry) => entry.isDirectory() && entry.name.toLowerCase() === wanted)
    if (hit && existsSync(join(base, hit.name, 'colors.toml'))) return join(base, hit.name)
  }
  return null
}

export function readTheme() {
  const name = readText(join(CURRENT_DIR, 'theme.name'))?.trim() ?? ''

  // The live file is canonical and also avoids display-name/slug mismatches.
  let text = readText(join(CURRENT_DIR, 'theme/colors.toml'))
  if (text == null) {
    const dir = findThemeDir(name)
    if (dir) text = readText(join(dir, 'colors.toml'))
  }

  return { name: name || 'unknown', ...resolvePalette(text == null ? {} : parseColorsToml(text)) }
}
