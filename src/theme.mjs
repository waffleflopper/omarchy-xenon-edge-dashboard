import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const USER_THEMES = join(homedir(), '.config/omarchy/themes')
const SYSTEM_THEMES = '/usr/share/omarchy/themes'

// Dracula-ish fallback so the dashboard still looks intentional if Omarchy
// can't tell us its colours.
const FALLBACK = {
  background: '#282a36',
  darker_background: '#191a21',
  foreground: '#f8f8f2',
  accent: '#bd93f9',
  muted: '#6272a4',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  orange: '#ffb86c',
  red: '#ff5555',
  cyan: '#8be9fd',
}

function parseColorsToml(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function findThemeDir(name) {
  const wanted = name.toLowerCase()
  for (const base of [USER_THEMES, SYSTEM_THEMES]) {
    let entries
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    const hit = entries.find((e) => e.isDirectory() && e.name.toLowerCase() === wanted)
    if (hit) {
      const dir = join(base, hit.name)
      if (existsSync(join(dir, 'colors.toml'))) return dir
    }
  }
  return null
}

export function readTheme() {
  try {
    const name = execFileSync('omarchy', ['theme', 'current'], { encoding: 'utf8' }).trim()
    const dir = findThemeDir(name)
    if (dir) {
      const colors = { ...FALLBACK, ...parseColorsToml(readFileSync(join(dir, 'colors.toml'), 'utf8')) }
      return {
        name,
        // Themes declare `mode = "dark" | "light"`; the UI uses it to pick
        // between light-on-dark and dark-on-light hairlines.
        mode: colors.mode === 'light' ? 'light' : 'dark',
        // `blue` is sometimes used as the accent name; normalise the few fields
        // the dashboard cares about.
        colors: { ...colors, accent: colors.accent || colors.blue || FALLBACK.accent },
      }
    }
    return { name: name || 'unknown', mode: 'dark', colors: FALLBACK }
  } catch {
    return { name: 'unknown', mode: 'dark', colors: FALLBACK }
  }
}
