import {
  HOUR, MINUTE, acceptSlot, dayAt, freshness, isLive, moonLit, moonName, moonPhase, pace, percentLabel, placeApp, projectedLabel, sceneFor,
} from './domain.mjs'
import { ICONS, appIcon, sceneSVG, wxIcon } from './scene.mjs'

const $ = (id) => document.getElementById(id)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const store = { instance: null, slots: new Map() }
const slot = (id) => store.slots.get(id)?.slot ?? { state: 'pending' }
const policy = (id) => store.slots.get(id)?.policy ?? { staleAfterMs: Infinity, expireAfterMs: Infinity }
const valueOf = (id) => slot(id).value ?? null
const fresh = (id) => freshness(slot(id), policy(id), Date.now())

const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail',
}
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg) => (typeof deg === 'number' ? COMPASS[Math.round(deg / 45) % 8] : '')
const round = (n) => (typeof n === 'number' ? Math.round(n) : '–')

const localTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const localDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
const localDow = new Intl.DateTimeFormat('en-GB', { weekday: 'short' })
const hhmm = (ms) => localTime.format(ms)
const when = (ms, now) => (ms - now < 20 * HOUR ? hhmm(ms) : `${localDow.format(ms)} ${hhmm(ms)}`)
const zoneFormats = new Map()
function inZone(w) {
  if (!zoneFormats.has(w.timezone)) {
    zoneFormats.set(w.timezone, {
      time: new Intl.DateTimeFormat('en-GB', { timeZone: w.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      day: new Intl.DateTimeFormat('en-GB', { timeZone: w.timezone, weekday: 'long' }),
    })
  }
  return zoneFormats.get(w.timezone)
}

async function act(body) {
  const res = await fetch('/api/do', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`)
  return data
}

let toastTimer
function toast(msg) {
  $('toastMsg').textContent = msg
  const t = $('toast')
  if (t.matches(':popover-open')) t.hidePopover()
  t.showPopover()
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.hidePopover(), 3000)
}

async function busy(button, fn) {
  button?.classList.add('busy')
  try {
    return await fn()
  } catch (err) {
    toast(err.message)
  } finally {
    button?.classList.remove('busy')
  }
}

function renderTheme() {
  const t = valueOf('theme')
  if (!t) return
  const c = t.colors
  const root = document.documentElement
  root.dataset.mode = t.mode === 'light' ? 'light' : 'dark'
  const vars = { bg: c.background, surface: c.lighter_background, 'surface-2': c.darker_background, fg: c.foreground, muted: c.muted, accent: c.accent, green: c.green, yellow: c.yellow, orange: c.orange, red: c.red, cyan: c.cyan }
  for (const [k, v] of Object.entries(vars)) if (v) root.style.setProperty(`--${k}`, v)
}

function freshChip(f) {
  if (f.tone === 'live' || f.tone === 'loading') return ''
  if (f.tone === 'aging') return `<span class="fresh-chip aging">updated ${f.label}</span>`
  return `<span class="fresh-chip ${f.tone}">${f.tone === 'failed' ? 'unavailable' : `stale · ${f.label}`}${f.why ? ` · ${esc(f.why)}` : ''}</span>`
}

function auroraInput(now) {
  const a = valueOf('aurora')
  return a ? { reading: a, current: isLive(freshness(slot('aurora'), policy('aurora'), now)) } : null
}

function renderScene() {
  const now = Date.now()
  const w = valueOf('weather')
  const f = fresh('weather')
  const clock = `<div><div class="clock num">${hhmm(now)}</div><div class="date">${localDate.format(now)}</div></div>`
  if (!w) {
    const msg = f.tone === 'loading' ? 'Loading weather…' : `Weather unavailable · ${esc(f.why ?? '')}`
    $('scene').innerHTML = `${sceneSVG(null)}<div class="overlay"><div class="top">${clock}</div><div class="bottom"><div class="wx-missing">${msg}</div></div></div>`
    return
  }
  const sc = sceneFor(w, auroraInput(now), now, isLive(f))
  const fmt = inZone(w)
  const today = dayAt(w, now)
  const hrs = w.hours.filter((h) => h.at > now).slice(0, 3)
    .map((h) => `<div><div>${fmt.time.format(h.at).slice(0, 2)}h</div>${wxIcon(h.code, h.isDay)}<div class="num">${round(h.temp)}°</div><div class="p">${h.precipProb ? `${h.precipProb}%` : ''}</div></div>`).join('')
  const u = w.units
  $('scene').innerHTML = `${sceneSVG(sc)}<div class="overlay">
    <div class="top">${clock}
      <div class="right">
        <div class="place">${esc(w.place.name)}${f.tone === 'live' ? `<small>updated ${f.label}</small>` : ''}</div>
        ${freshChip(f)}
        ${sc.aurora.show ? `<div class="aurora-chip"><b>Aurora possible</b>NOAA forecast ${sc.aurora.probability}% · next 30–90 min · not a sighting</div>` : ''}
      </div>
    </div>
    <div class="bottom">
      <div class="now-temp"><div class="t num">${round(w.current.temp)}°</div><div class="cond">
        <div>${WMO[w.current.code] ?? 'Unknown'}</div>
        <div>Feels ${round(w.current.feelsLike)}° · H ${round(today.high)}° L ${round(today.low)}°</div>
        <div>Wind ${round(w.current.windSpeed)} ${u.wind} ${compass(w.current.windDir)}</div></div></div>
      <div class="hours-mini num">${hrs}</div>
    </div>
  </div>`
}

const BADGE_COLORS = ['var(--cyan)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--red)', 'var(--accent)']
function badgeGlyphs(accounts) {
  const used = new Set()
  return accounts.map(({ label }) => {
    const candidates = [label[0], ...label.slice(1).replace(/[^A-Z]/g, ''), ...label.toUpperCase().replace(/[^A-Z0-9]/g, '')]
    const glyph = (candidates.find((c) => c && !used.has(c.toUpperCase())) ?? label[0] ?? '?').toUpperCase()
    used.add(glyph)
    return glyph
  })
}

const durationLabel = (minutes) => (minutes < 24 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`)
const CHIP = { under: 'Under pace', at: 'At pace', over: 'Over pace', early: 'Early', expired: 'Reset', exhausted: 'Limit hit' }
const CHIP_COLOR = { under: 'var(--green)', at: 'var(--yellow)', over: 'var(--red)', exhausted: 'var(--red)', early: 'var(--accent)' }

function windowCell(w, now, stale) {
  const p = pace(w, now)
  const lbl = `${esc(w.label)} · ${durationLabel(w.durationMinutes)}`
  let val, bar, sub
  if (p.state === 'expired') {
    val = '<span class="dash">—</span><span>no current reading</span>'
    bar = '<div class="bar dim"></div>'
    sub = `Reset ${hhmm(w.resetsAt)} · awaiting new reading`
  } else {
    const remainingPercent = Math.min(100, Math.max(0, 100 - w.usedPercent))
    val = `<b class="num">${percentLabel(remainingPercent)}</b><span>left</span>`
    const tick = p.elapsedPercent != null ? `<div class="tick" style="left:${Math.min(100, Math.max(0, 100 - p.elapsedPercent)).toFixed(1)}%"></div>` : ''
    bar = `<div class="bar"><div class="fill" style="width:${remainingPercent}%;background:${CHIP_COLOR[p.state]}"></div>${tick}</div>`
    sub = p.state === 'over' ? `${p.runsOutAt ? `Runs out ≈${when(p.runsOutAt, now)}` : `Projects ${projectedLabel(p)} used`} · resets ${when(w.resetsAt, now)}`
      : p.state === 'early' ? `Too early to project · resets ${when(w.resetsAt, now)}`
        : p.state === 'exhausted' ? `Limit reached · resets ${when(w.resetsAt, now)}`
          : `${projectedLabel(p)} used at reset · ${when(w.resetsAt, now)}`
  }
  return `<div class="win ${stale ? 'is-stale' : ''}"><div class="top"><span class="lbl">${lbl}</span><span class="chip ${p.state}">${CHIP[p.state]}</span></div><div class="val">${val}</div>${bar}<div class="sub num">${sub}</div></div>`
}

function missingCell(kind, label) {
  return `<div class="win"><div class="top"><span class="lbl">${kind === 'session' ? 'Session' : 'Weekly'}</span><span class="chip missing">Not reported</span></div><div class="val"><span class="dash">—</span></div><div class="bar dim"></div><div class="sub">${esc(label)} did not report this window</div></div>`
}

function renderQuota() {
  const now = Date.now()
  const accounts = valueOf('config')?.accounts ?? []
  const glyphs = badgeGlyphs(accounts)
  const rows = accounts.map((a, i) => {
    const id = `quota:${a.id}`
    const s = slot(id)
    const f = freshness(s, policy(id), now)
    const v = s.value
    const retryAt = s.error?.retryAt
    const why = s.state === 'stale' ? `${s.error.message}${retryAt ? ` · retry after ${hhmm(retryAt)}` : ''}` : v?.sameLoginAs ? `Same sign-in as ${v.sameLoginAs}` : ''
    const freshLine = f.tone === 'failed' ? '<span class="dot failed"></span>no reading'
      : `<span class="dot ${f.tone}"></span>${f.tone === 'stale' || f.tone === 'expired' ? 'stale · ' : ''}${f.label}`
    const head = `<div class="ident"><div class="badge" style="background:${BADGE_COLORS[i % BADGE_COLORS.length]}">${esc(glyphs[i])}</div><div><div class="name">${esc(a.label)}</div><div class="plan">${esc(v?.plan ?? '')}</div></div><div class="fresh">${freshLine}</div>${why ? `<div class="why">${esc(why)}</div>` : ''}</div>`
    if (!v) {
      const msg = s.state === 'pending' ? 'Reading usage…' : `<b>Unavailable.</b> ${esc(s.error.message)}${retryAt ? ` · retry after ${hhmm(retryAt)}` : ''}. Other accounts are unaffected.`
      const retry = s.state === 'failed' ? `<button class="retry" data-refresh="${esc(id)}">Retry</button>` : ''
      return `<div class="acct">${head}<div class="acct-msg"><span>${msg}</span>${retry}</div></div>`
    }
    const stale = s.state === 'stale' || f.tone === 'expired'
    const byKind = Object.fromEntries(v.windows.map((w) => [w.kind, w]))
    const other = v.windows.filter((w) => w.kind === 'other')
    const cells = ['session', 'weekly'].map((k) => (byKind[k] ? windowCell(byKind[k], now, stale) : other.length ? windowCell(other.shift(), now, stale) : missingCell(k, a.label))).join('')
    return `<div class="acct">${head}${cells}</div>`
  }).join('')
  $('quota').innerHTML = `<div class="panel-head">AI quota<span class="grow"></span><span class="legend"><span><b></b>left</span><span><i></i>even pace</span><span>Pace = projected use at reset</span></span></div>${rows}`
}

const heat = (c, [warn, hot]) => (c >= hot ? 'var(--red)' : c >= warn ? 'var(--yellow)' : 'var(--green)')
const gb = (bytes) => `${Math.round(bytes / 1e9)} GB`

function renderHw() {
  const h = valueOf('hardware')
  const f = fresh('hardware')
  const tile = (k, r, lim, sub, sub2) => (r
    ? `<div class="tile"><div class="k">${k}</div><div class="v num" style="color:${heat(r.celsius, lim)}">${Math.round(r.celsius)}<small>°C</small></div><div class="s">${esc(sub)}</div><div class="s">${esc(sub2)}</div></div>`
    : `<div class="tile none"><div class="k">${k}</div><div class="v">—</div><div class="s">not reported</div><div class="s">&nbsp;</div></div>`)
  const head = `<div class="panel-head">System<span class="grow"></span><span class="legend"><span class="dot ${f.tone}"></span>${f.tone === 'failed' ? 'unavailable' : f.label}</span></div>`
  if (!h) {
    $('hw').innerHTML = `${head}<div class="hint">${f.tone === 'loading' ? 'Reading sensors…' : esc(f.why)}</div>`
    return
  }
  const gpu = h.gpu
  const gpuSub2 = gpu ? `${gpu.utilPercent ?? '–'}% busy · ${gpu.vramUsedMiB != null ? (gpu.vramUsedMiB / 1024).toFixed(1) : '–'} of ${gpu.vramTotalMiB != null ? Math.round(gpu.vramTotalMiB / 1024) : '–'} GB` : ''
  const storage = h.storage.map((s) => `<div class="meter"><div class="row"><b>Storage <span>${esc(s.mounts.join(' + '))}</span></b><span class="num">${gb(s.freeBytes)} free of ${gb(s.totalBytes)}</span></div><div class="bar"><div class="fill" style="width:${((s.usedBytes / s.totalBytes) * 100).toFixed(1)}%"></div></div></div>`).join('')
  const m = h.memory
  const memory = m ? `<div class="meter"><div class="row"><b>Memory</b><span class="num">${(m.usedBytes / 1e9).toFixed(1)} of ${(m.totalBytes / 1e9).toFixed(1)} GB</span></div><div class="bar"><div class="fill" style="width:${((m.usedBytes / m.totalBytes) * 100).toFixed(1)}%"></div></div></div>` : ''
  $('hw').innerHTML = `${head}
    <div class="temps">${tile('CPU', h.cpu, [75, 90], h.cpu?.sensor, h.cpu?.chip)}${tile('GPU', gpu, [75, 87], gpu?.name.replace(/^NVIDIA (GeForce )?/, ''), gpuSub2)}${tile('Board', h.board, [55, 70], h.board?.sensor, h.board?.chip)}</div>
    ${storage}${memory}`
}

function renderDock() {
  const launchers = valueOf('config')?.launchers ?? []
  $('launchers').innerHTML = launchers.map((l) => `<button class="tbtn" data-launch="${esc(l.desktopId)}">${appIcon(l.desktopId)}${esc(l.label)}</button>`).join('')
    + `<button class="tbtn edit" id="editLaunchers" aria-label="Edit launchers">${ICONS.pencil}</button>`
}

let volumeHeldUntil = 0
let volumeTimer = null
let pendingVolume = null
let volumeIntents = Promise.resolve()
function queueVolume(action) {
  const operation = volumeIntents.then(() => act(action))
  volumeIntents = operation.catch(() => {})
  return operation
}
async function flushVolume() {
  clearTimeout(volumeTimer)
  if (pendingVolume === null) return
  const value = pendingVolume
  pendingVolume = null
  try {
    await queueVolume({ kind: 'volume.set', value })
  } catch (err) {
    toast(err.message)
    volumeHeldUntil = 0
    renderVolume({ force: true })
  }
}
function renderVolume({ force = false } = {}) {
  const v = valueOf('volume')
  const muted = !!v?.muted
  $('mute').innerHTML = (muted ? ICONS.speakerOff : ICONS.speaker) + (muted ? 'Muted' : 'Mute')
  $('vol').classList.toggle('muted', muted)
  $('voldev').textContent = v?.device ?? (slot('volume').state === 'failed' ? 'Volume unavailable' : 'Volume')
  $('volr').disabled = !v
  if (!v || (!force && Date.now() < volumeHeldUntil)) return
  setSlider(Math.round(v.volume * 100))
}
function setSlider(pct) {
  $('volr').value = String(pct)
  $('volr').style.setProperty('--v', `${pct}%`)
  $('volv').textContent = `${pct}%`
}

$('volr').addEventListener('input', (e) => {
  const pct = Number(e.target.value)
  setSlider(pct)
  volumeHeldUntil = Date.now() + 1500
  clearTimeout(volumeTimer)
  pendingVolume = pct / 100
  volumeTimer = setTimeout(flushVolume, 150)
})
$('mute').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const muted = !valueOf('volume')?.muted
  flushVolume()
  return queueVolume({ kind: 'volume.mute', muted })
}))

function renderWeatherDialog() {
  if (!$('wxDlg').open) return
  const now = Date.now()
  const w = valueOf('weather')
  const f = fresh('weather')
  if (!w) {
    $('wxTitle').textContent = 'Weather'
    $('wxFresh').innerHTML = freshChip(f)
    for (const id of ['pHours', 'pDays', 'pDetails']) $(id).innerHTML = `<p class="hint">${f.tone === 'loading' ? 'Loading weather…' : `Weather unavailable · ${esc(f.why)}`}</p>`
    renderLocationPane()
    return
  }
  const fmt = inZone(w)
  const u = w.units
  $('wxTitle').textContent = `${w.place.name} · ${w.place.lat.toFixed(2)}°, ${w.place.lon.toFixed(2)}°`
  $('wxFresh').innerHTML = f.tone === 'live' ? `<span class="hint">Open-Meteo · updated ${f.label}</span>` : freshChip(f)
  const hours = w.hours.filter((h) => h.at > now).slice(0, 12)
  $('pHours').innerHTML = `<div class="hourly num">${hours.map((h) => `<div><div class="h">${fmt.time.format(h.at)}</div>${wxIcon(h.code, h.isDay)}<div class="t">${round(h.temp)}°</div><div class="p">${h.precipProb ? `${h.precipProb}% precip` : ''}</div></div>`).join('')}</div>
    <div class="attrib">Times are local to ${esc(w.place.name)}. Weather data by Open-Meteo.com.</div>`

  const today = dayAt(w, now)
  const days = w.days.filter((d) => d.date >= today.date).slice(0, 5)
  const lows = days.map((d) => d.low).filter((n) => n != null)
  const highs = days.map((d) => d.high).filter((n) => n != null)
  const lo = Math.min(...lows), hi = Math.max(...highs), span = Math.max(1, hi - lo)
  $('pDays').innerHTML = `<div class="days num">${days.map((d) => `<div class="day"><b>${d === today ? 'Today' : fmt.day.format(d.date)}</b>${wxIcon(d.code, true)}<span class="cond">${WMO[d.code] ?? ''}</span><span class="lo">${round(d.low)}°</span><div class="rng"><i style="left:${(((d.low - lo) / span) * 100).toFixed(1)}%;right:${(100 - ((d.high - lo) / span) * 100).toFixed(1)}%"></i></div><b>${round(d.high)}°</b><span class="pp">${d.precipProb != null ? `${d.precipProb}%` : ''}</span></div>`).join('')}</div>
    <div class="attrib">Bars place each day's low to high on the shared ${round(lo)}–${round(hi)}${u.temp} range. The right column is the chance of precipitation.</div>`

  const sc = sceneFor(w, auroraInput(now), now, isLive(f))
  const g = sc.aurora.gates
  const a = valueOf('aurora')
  const af = fresh('aurora')
  const phase = moonPhase(now)
  const gate = (ok, text) => `<span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✗'} ${text}</span>`
  const auroraText = !a
    ? `No aurora forecast available${af.why ? ` (${esc(af.why)})` : ''}.`
    : !g.location ? 'The aurora forecast is for the previous location. Waiting for a forecast here.'
      : `NOAA SWPC OVATION gives a ${a.probability}% chance of aurora near ${esc(w.place.name)} around ${fmt.time.format(a.forecastAt)} (model observation ${fmt.time.format(a.observedAt)}). This is a 30–90 minute forecast, not a sighting. The scene shows aurora only when every check passes.`
  $('pDetails').innerHTML = `<div class="details num">
    <div><div class="k">Feels like</div><div class="v">${round(w.current.feelsLike)}${u.temp}</div><div class="s">Actual ${round(w.current.temp)}${u.temp}</div></div>
    <div><div class="k">Sunrise</div><div class="v">${today.sunrise ? fmt.time.format(today.sunrise) : '–'}</div><div class="s">Sunset ${today.sunset ? fmt.time.format(today.sunset) : '–'}</div></div>
    <div><div class="k">Wind</div><div class="v">${round(w.current.windSpeed)} ${u.wind} ${compass(w.current.windDir)}</div><div class="s">Gusts ${round(w.current.windGust)} ${u.wind}</div></div>
    <div><div class="k">Pressure</div><div class="v">${round(w.current.pressure)} hPa</div><div class="s">Sea level</div></div>
    <div><div class="k">Humidity</div><div class="v">${round(w.current.humidity)}%</div><div class="s">Cloud cover ${round(w.current.cloudCover)}%</div></div>
    <div><div class="k">UV index</div><div class="v">${today.uvMax != null ? today.uvMax.toFixed(1) : '–'}</div><div class="s">Today's maximum</div></div>
    <div><div class="k">Moon</div><div class="v">${moonName(phase)}</div><div class="s">${Math.round(moonLit(phase) * 100)}% lit${moonLit(phase) < 0.05 ? ' · not drawn' : ''}</div></div>
    <div><div class="k">Precipitation</div><div class="v">${today.precipProb != null ? `${today.precipProb}%` : '–'}</div><div class="s">Chance today</div></div>
    <div class="wide"><b>Aurora.</b> ${auroraText}
      <div class="gates">${gate(g.dark, 'dark (45 min past sunset)')}${gate(g.clear, `cloud ${round(w.current.cloudCover)}% under 50%`)}${gate(g.forecast, `forecast ${a ? a.probability : '–'}% of at least 10%`)}${gate(g.fresh, a ? `forecast ${af.label}` : 'no forecast')}${gate(g.location, 'forecast at this location')}${gate(g.weather, 'weather current')}</div>
      <div class="attrib">Aurora data: NOAA SWPC, spaceweather.gov/products/aurora-30-minute-forecast.</div></div>
  </div>`
  renderLocationPane()
}

function renderLocationPane() {
  const w = valueOf('weather')
  const loc = valueOf('config')?.location
  $('locNow').innerHTML = loc ? `${esc(loc.name)}<span>Saved override · ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°</span>`
    : `${esc(w?.place.name ?? 'Unknown')}<span>Approximate, from this computer's internet connection</span>`
  $('locIp').hidden = !loc
}

let searchResults = []
let searchGeneration = 0
$('locForm').addEventListener('submit', async (e) => {
  e.preventDefault()
  const query = $('locQuery').value.trim()
  if (query.length < 2) return
  const generation = ++searchGeneration
  searchResults = []
  $('locResults').innerHTML = '<p class="hint">Searching…</p>'
  let html
  try {
    const results = (await act({ kind: 'location.search', query })).results
    if (generation !== searchGeneration) return
    searchResults = results
    html = results.length
      ? results.map((r, i) => `<button class="opt" data-place="${i}">${esc(r.name)}<span>${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}°</span></button>`).join('')
      : `<p class="hint">No places match “${esc(query)}”</p>`
  } catch (err) {
    if (generation !== searchGeneration) return
    html = `<p class="hint">Search failed · ${esc(err.message)}</p>`
  }
  $('locResults').innerHTML = html
})

async function setLocation(location) {
  await busy(null, async () => {
    await act({ kind: 'location.set', location })
    toast(location ? `Weather now follows ${location.name}` : 'Weather now follows your approximate location')
  })
}

let draft = []
let selected = 0
let installed = []
function renderEditor() {
  $('slots').innerHTML = [0, 1, 2, 3].map((i) => {
    const l = draft[i]
    const sel = i === selected ? 'sel' : ''
    const pick = (body) => `<button class="pick" data-slot="${i}" aria-pressed="${i === selected}">${body}</button>`
    if (!l) return `<div class="slot ${sel}">${pick('<span class="hd" style="color:var(--muted)">Empty slot</span><span class="id">then choose an app below</span>')}<div class="acts"><button disabled>◀</button><button disabled>▶</button><button disabled>Remove</button></div></div>`
    return `<div class="slot ${sel}">${pick(`<span class="hd">${appIcon(l.desktopId)}${esc(l.label)}</span><span class="id">Slot ${i + 1}</span>`)}<div class="acts"><button data-mv="${i}:-1" aria-label="Move left" ${i === 0 ? 'disabled' : ''}>◀</button><button data-mv="${i}:1" aria-label="Move right" ${i >= draft.length - 1 ? 'disabled' : ''}>▶</button><button data-rm="${i}">Remove</button></div></div>`
  }).join('')
  const inUse = new Set(draft.map((l) => l.desktopId))
  $('apps').innerHTML = installed.map((a, i) => `<button data-app="${i}" class="${inUse.has(a.desktopId) ? 'in' : ''}">${esc(a.name)}</button>`).join('') || '<p class="hint">Loading applications…</p>'
}

async function openEditor() {
  draft = (valueOf('config')?.launchers ?? []).map((l) => ({ ...l }))
  selected = Math.min(draft.length, 3)
  installed = []
  const problem = valueOf('config')?.problem
  $('launchHint').textContent = problem ? `Saving disabled: ${problem}` : 'Tap a slot, then an app'
  $('saveLaunchers').disabled = !!problem
  renderEditor()
  $('launchDlg').showModal()
  try {
    installed = (await (await fetch('/api/apps')).json()).apps ?? []
  } catch {
    toast('Could not list installed applications')
  }
  renderEditor()
}

const shortLabel = (name) => name.replace(/\s+(Browser|\(.*\))$/i, '').slice(0, 24)

async function openThemes() {
  $('themes').innerHTML = '<p class="hint">Loading themes…</p>'
  $('themeDlg').showModal()
  try {
    const { themes } = await (await fetch('/api/themes')).json()
    const current = (valueOf('theme')?.name ?? '').toLowerCase()
    $('themes').innerHTML = themes.map((t) => {
      const c = t.colors
      const sel = t.name.toLowerCase().replace(/\s+/g, '-') === current ? 'sel' : ''
      return `<button class="theme ${sel}" data-theme="${esc(t.name)}" style="background:${esc(c.background)};color:${esc(c.foreground)}"><div class="sw">${[c.accent, c.green, c.yellow, c.orange, c.red, c.cyan].map((x) => `<i style="background:${esc(x)}"></i>`).join('')}</div><b>${esc(t.name)}</b></button>`
    }).join('')
  } catch {
    $('themes').innerHTML = '<p class="hint">Could not list themes</p>'
  }
}

const POWER = {
  sleep: { title: 'Sleep now?', text: 'The computer goes to sleep. Open work stays where it is.', button: 'Sleep' },
  shutdown: { title: 'Shut down now?', text: 'Every window closes and the computer turns off. Save open work first.', button: 'Shut down' },
}
function renderPower(step) {
  const body = $('powerBody')
  if (!step) {
    body.innerHTML = `<div class="sheet-head"><h2>Power</h2><span class="grow"></span><button class="close" data-close aria-label="Close" autofocus>×</button></div>
      <div class="power-choices"><button data-power="sleep">${ICONS.moon}Sleep</button><button data-power="shutdown" style="color:var(--red)">${ICONS.power}Shut down</button></div>`
    body.querySelector('[data-close]').focus()
    return
  }
  const p = POWER[step]
  body.innerHTML = `<div class="sheet-head"><h2>${p.title}</h2></div>
    <div class="confirm-msg">${p.text}</div>
    <div class="foot"><button class="big" data-power-back autofocus>Cancel</button><button class="big danger" data-power-go="${step}">${p.button}</button></div>`
  body.querySelector('[data-power-back]').focus()
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('button')
  if (!t) return
  const d = t.dataset
  if (t.id === 'scene') {
    $('wxDlg').showModal()
    renderWeatherDialog()
  } else if (d.close !== undefined) t.closest('dialog').close()
  else if (d.pane) {
    for (const b of document.querySelectorAll('#wxDlg .tab')) b.setAttribute('aria-selected', String(b === t))
    for (const p of document.querySelectorAll('#wxDlg .pane')) p.classList.toggle('on', p.id === d.pane)
  } else if (d.place) setLocation(searchResults[Number(d.place)])
  else if (t.id === 'locIp') setLocation(null)
  else if (d.refresh) {
    busy(t, async () => {
      const r = await act({ kind: 'refresh', id: d.refresh })
      if (r.retryAt) toast(`The provider asked us to wait · retry after ${hhmm(r.retryAt)}`)
      else if (d.refresh === 'weather') toast('Refreshing weather…')
    })
  }
  else if (d.launch) {
    const label = t.textContent
    busy(t, async () => {
      const r = await act({ kind: 'launch', desktopId: d.launch })
      toast(r.dryRun ? `Dry run · ${label} not launched` : `Opening ${label}${r.monitor ? ` on ${r.monitor}` : ''}`)
    })
  } else if (t.id === 'editLaunchers') openEditor()
  else if (d.app) {
    const app = installed[Number(d.app)]
    const item = { label: shortLabel(app.name), desktopId: app.desktopId }
    draft = placeApp(draft, selected, item)
    selected = Math.min(3, draft.length)
    renderEditor()
  } else if (d.slot !== undefined) {
    selected = Math.min(Number(d.slot), draft.length)
    renderEditor()
  } else if (d.mv) {
    const [i, dir] = d.mv.split(':').map(Number)
    const j = i + dir
    if (draft[j]) {
      ;[draft[i], draft[j]] = [draft[j], draft[i]]
      selected = j
      renderEditor()
    }
  } else if (d.rm) {
    draft.splice(Number(d.rm), 1)
    selected = Math.min(selected, draft.length)
    renderEditor()
  } else if (t.id === 'saveLaunchers') {
    busy(t, async () => {
      await act({ kind: 'launchers.save', launchers: draft })
      $('launchDlg').close()
      toast('Launchers saved')
    })
  } else if (t.id === 'themeBtn') openThemes()
  else if (d.theme) {
    busy(t, async () => {
      toast(`Applying ${d.theme}…`)
      const r = await act({ kind: 'theme.set', name: d.theme })
      if (r.dryRun) toast(`Dry run · ${d.theme} not applied`)
      $('themeDlg').close()
    })
  } else if (d.simple) {
    busy(t, async () => {
      const r = await act({ kind: d.simple })
      toast(r.dryRun ? `Dry run · ${d.simple} not started` : d.simple === 'screenshot' ? 'Screenshot saved' : 'Screensaver started')
    })
  } else if (t.id === 'powerBtn') {
    renderPower(null)
    $('powerDlg').showModal()
  } else if (d.power) renderPower(d.power)
  else if (d.powerBack !== undefined) renderPower(null)
  else if (d.powerGo) {
    $('powerDlg').close()
    busy(null, async () => {
      const r = await act({ kind: 'power', power: d.powerGo })
      toast(r.dryRun ? `Dry run · ${POWER[d.powerGo].button.toLowerCase()} not started` : `${POWER[d.powerGo].button} requested`)
    })
  }
})

const RENDER = {
  theme: renderTheme,
  config: () => {
    renderDock()
    renderQuota()
    if ($('wxDlg').open) renderLocationPane()
  },
  volume: () => renderVolume(),
  hardware: renderHw,
  weather: () => {
    renderScene()
    renderWeatherDialog()
  },
  aurora: () => {
    renderScene()
    renderWeatherDialog()
  },
}

function connect() {
  const es = new EventSource('/api/stream')
  es.addEventListener('open', () => {
    $('offline').hidden = true
  })
  es.addEventListener('error', () => {
    $('offline').hidden = false
  })
  es.addEventListener('slot', (e) => {
    const event = JSON.parse(e.data)
    if (!acceptSlot(store, event)) return
    ;(RENDER[event.id] ?? (event.id.startsWith('quota:') ? renderQuota : () => {}))()
  })
}

function tick() {
  renderScene()
  renderQuota()
  renderHw()
  renderWeatherDialog()
  setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 50)
}

renderDock()
renderVolume()
renderHw()
tick()
connect()
