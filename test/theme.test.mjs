import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { parseColorsToml, resolvePalette } from '../src/theme.mjs'

const DUNE_MESSIAH = {
  mode: 'light',
  background: '#dcd8d6',
  foreground: '#47362b',
  accent: '#8c4f2a',
  bg: '#dcd8d6',
  lighter_bg: '#dcd8d6',
  darker_bg: '#6e6c6b',
  fg: '#47362b',
  muted: '#675b53',
  green: '#6f5a36',
  yellow: '#7f531d',
  orange: '#7f531d',
  red: '#7a3827',
  cyan: '#355f68',
}

const NORD = {
  mode: 'dark',
  background: '#2e3440',
  darker_background: '#191c23',
  lighter_background: '#3b4252',
  foreground: '#d8dee9',
  muted: '#4c566a',
  accent: '#81a1c1',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  orange: '#d5967a',
  red: '#bf616a',
  cyan: '#88c0d0',
}

const REQUIRED_ROLES = [
  'background',
  'lighter_background',
  'darker_background',
  'foreground',
  'muted',
  'accent',
  'green',
  'yellow',
  'orange',
  'red',
  'cyan',
]

function rgb(hex) {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

function luminance(hex) {
  const channels = rgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (lighter + 0.05) / (darker + 0.05)
}

function assertReadable(colors) {
  for (const text of ['foreground', 'muted']) {
    for (const surface of ['background', 'lighter_background', 'darker_background']) {
      assert.ok(
        contrast(colors[text], colors[surface]) >= 4.5,
        `${text} ${colors[text]} should be readable on ${surface} ${colors[surface]}`,
      )
    }
  }
}

test('resolves the mixed Omarchy 4 vocabulary without importing another palette', () => {
  const { mode, colors } = resolvePalette(DUNE_MESSIAH)

  assert.equal(mode, 'light')
  assert.equal(colors.background, '#dcd8d6')
  assert.equal(colors.foreground, '#47362b')
  assert.equal(colors.lighter_background, '#dcd8d6')
  assert.notEqual(colors.darker_background, '#6e6c6b', 'unsafe darker_bg is replaced within the theme')
  for (const role of REQUIRED_ROLES) assert.ok(colors[role], `${role} should resolve`)
  for (const fallback of ['#282a36', '#191a21', '#f8f8f2', '#bd93f9', '#6272a4']) {
    assert.ok(!Object.values(colors).includes(fallback), `must not borrow fallback ${fallback}`)
  }
  assertReadable(colors)
})

test('keeps Omarchy 3 surfaces while making Nord muted text readable', () => {
  const { mode, colors } = resolvePalette(NORD)

  assert.equal(mode, 'dark')
  assert.equal(colors.background, '#2e3440')
  assert.equal(colors.lighter_background, '#3b4252')
  assert.equal(colors.darker_background, '#191c23')
  assert.notEqual(colors.muted, '#4c566a', 'the packaged muted colour is too faint for dashboard text')
  assertReadable(colors)
})

test('derives every omitted dashboard role from readable theme anchors', () => {
  const { colors } = resolvePalette({ mode: 'light', bg: '#f4f0ec', fg: '#302820' })

  for (const role of REQUIRED_ROLES) assert.ok(colors[role], `${role} should be derived`)
  assert.equal(colors.background, '#f4f0ec')
  assert.equal(colors.foreground, '#302820')
  assert.notEqual(colors.accent, '#bd93f9')
  assertReadable(colors)
})

test('uses a theme-local yellow when an older palette omits orange', () => {
  const { colors } = resolvePalette({
    mode: 'dark',
    background: '#20242b',
    foreground: '#e2e6ed',
    yellow: '#d9bd78',
  })

  assert.equal(colors.orange, '#d9bd78')
})

test('uses the fallback wholesale only without readable page and text anchors', () => {
  const missing = resolvePalette({})
  const incomplete = resolvePalette({ mode: 'light', bg: '#ffffff' })

  assert.equal(missing.mode, 'dark')
  assert.equal(missing.colors.background, '#282a36')
  assert.equal(missing.colors.foreground, '#f8f8f2')
  assert.equal(incomplete.mode, 'dark')
  assert.deepEqual(incomplete.colors, missing.colors)
})

test('parses semantic colours from TOML with comments and art', () => {
  const parsed = parseColorsToml(
    ['# a comment', '# ,gggg,', '  bg = "#dcd8d6"', '  color0 = "#dcd8d6" # base', ''].join('\n'),
  )

  assert.deepEqual(parsed, { bg: '#dcd8d6', color0: '#dcd8d6' })
})

test('reads the live theme without depending on its display name', () => {
  const home = mkdtempSync(join(tmpdir(), 'waffle-theme-'))
  const current = join(home, '.local/state/omarchy/current')
  const liveTheme = join(current, 'theme')

  try {
    mkdirSync(liveTheme, { recursive: true })
    writeFileSync(join(current, 'theme.name'), 'dune-messiah\n')
    writeFileSync(
      join(liveTheme, 'colors.toml'),
      ['mode = "light"', 'bg = "#dcd8d6"', 'fg = "#47362b"', 'accent = "#8c4f2a"'].join('\n'),
    )

    const moduleUrl = new URL('../src/theme.mjs', import.meta.url).href
    const script = `import { readTheme } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(readTheme()))`
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })

    assert.equal(child.status, 0, child.stderr)
    const theme = JSON.parse(child.stdout)
    assert.equal(theme.name, 'dune-messiah')
    assert.equal(theme.mode, 'light')
    assert.equal(theme.colors.background, '#dcd8d6')
    assert.equal(theme.colors.foreground, '#47362b')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
