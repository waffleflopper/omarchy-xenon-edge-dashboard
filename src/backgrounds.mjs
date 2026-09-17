import { readdirSync } from 'node:fs'

// One image per condition, dropped into assets/weather/ by hand.
export const BACKGROUND_KINDS = [
  'clear-day',
  'clear-night',
  'partly',
  'clouds',
  'rain',
  'snow',
  'fog',
  'storm',
]

const EXTENSIONS = ['webp', 'avif', 'jpg', 'jpeg', 'png', 'svg']

// Map every condition to a URL path for the first matching file that exists,
// plus a "default" fallback used when a specific condition has no image.
export function scanBackgrounds(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return { map: {}, missing: BACKGROUND_KINDS }
  }

  // Case-insensitive lookup so Rain.WEBP still resolves.
  const byName = new Map(entries.map((name) => [name.toLowerCase(), name]))
  const map = {}

  for (const kind of [...BACKGROUND_KINDS, 'default']) {
    for (const ext of EXTENSIONS) {
      const actual = byName.get(`${kind}.${ext}`)
      if (actual) {
        map[kind] = `/assets/weather/${encodeURIComponent(actual)}`
        break
      }
    }
  }

  return { map, missing: BACKGROUND_KINDS.filter((kind) => !map[kind]) }
}
