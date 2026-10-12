import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DESKTOP_ID } from './config.mjs'

// Hidden from menus but intended as a launcher: the stable T3 Code entry.
const ALWAYS_LISTED = new Set(['com.t3tools.T3Code.desktop'])

export function applicationDirs(env = process.env) {
  const dataHome = env.XDG_DATA_HOME || join(homedir(), '.local/share')
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)
  return [dataHome, ...dataDirs].map((d) => join(d, 'applications'))
}
export function parseDesktopEntry(text) {
  const entry = {}
  let inMain = false
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t.startsWith('[')) {
      inMain = t === '[Desktop Entry]'
      continue
    }
    if (!inMain) continue
    const m = /^([A-Za-z]+)=(.*)$/.exec(t)
    if (m && !(m[1] in entry)) entry[m[1]] = m[2]
  }
  return entry
}

/**
 * Installed launchable applications by desktop ID. Earlier directories win, so
 * a user's override replaces the system entry of the same ID.
 */
export async function listApps(dirs = applicationDirs()) {
  const seen = new Map()
  for (const dir of dirs) {
    let names
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const id of names) {
      if (seen.has(id) || !DESKTOP_ID.test(id)) continue
      const text = await readFile(join(dir, id), 'utf8').catch(() => null)
      if (text == null) continue
      const e = parseDesktopEntry(text)
      const hidden = e.Hidden === 'true' || (e.NoDisplay === 'true' && !ALWAYS_LISTED.has(id))
      seen.set(id, e.Type === 'Application' && e.Name && e.Exec && !hidden ? { desktopId: id, name: e.Name.slice(0, 40) } : null)
    }
  }
  return [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))
}
