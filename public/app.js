const $ = (id) => document.getElementById(id)

const el = {
  weatherBg: $('wx-bg'),
  clockTime: $('clock-time'),
  clockDate: $('clock-date'),
  weatherGlyph: $('weather-glyph'),
  weatherTemp: $('weather-temp'),
  weatherLabel: $('weather-label'),
  weatherMeta: $('weather-meta'),
  codexPlan: $('codex-plan'),
  codexRemaining: $('codex-remaining'),
  codexWindow: $('codex-window'),
  codexUsed: $('codex-used'),
  codexBar: $('codex-bar'),
  codexFoot: $('codex-foot'),
  codexBackPlan: $('codex-back-plan'),
  codexPace: $('codex-pace'),
  codexSpark: $('codex-spark'),
  codexStats: $('codex-stats'),
  codexResets: $('codex-resets'),
  opencodePlan: $('opencode-plan'),
  opencodeRows: $('opencode-rows'),
  tempsBadge: $('temps-badge'),
  tempsList: $('temps-list'),
  tsState: $('ts-state'),
  tsSelf: $('ts-self'),
  tsPeers: $('ts-peers'),
  volDevice: $('vol-device'),
  volDeviceBadge: $('vol-device-badge'),
  volValue: $('vol-value'),
  volMute: $('vol-mute'),
  volDown: $('vol-down'),
  volUp: $('vol-up'),
  volSlider: $('vol-slider'),
  offline: $('offline'),
  weatherCard: $('weather-card'),
  volumeCard: $('volume-card'),
  wxPlace: $('wx-place'),
  wxHours: $('wx-hours'),
  wxStats: $('wx-stats'),
  wxDays: $('wx-days'),
  qaMic: $('qa-mic'),
  actionGrid: $('action-grid'),
  actionFoot: $('action-foot'),
}

let dragging = false

/* ---------------- formatting helpers ---------------- */

function severity(remaining) {
  if (remaining == null) return 'var(--accent)'
  if (remaining <= 10) return 'var(--red)'
  if (remaining <= 25) return 'var(--orange)'
  if (remaining <= 50) return 'var(--yellow)'
  return 'var(--green)'
}

function humanWindow(mins) {
  if (!mins) return 'window'
  if (mins % 1440 === 0) {
    const d = mins / 1440
    return d === 7 ? 'week' : d === 1 ? 'day' : `${d} days`
  }
  if (mins % 60 === 0) return `${mins / 60}h`
  return `${mins}m`
}

function toMs(ts) {
  if (ts == null) return null
  if (typeof ts === 'number') return ts < 1e12 ? ts * 1000 : ts
  const parsed = Date.parse(ts)
  return Number.isNaN(parsed) ? null : parsed
}

function countdown(ts) {
  const ms = toMs(ts)
  if (!ms) return null
  let s = Math.max(0, Math.round((ms - Date.now()) / 1000))
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function humanTokens(n) {
  if (n == null) return null
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

function fmtClock(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtHours(hours) {
  if (hours == null) return '—'
  if (hours >= 48) return `${Math.round(hours / 24)}d`
  if (hours >= 1) return `${Math.floor(hours)}h ${Math.round((hours % 1) * 60)}m`
  return `${Math.round(hours * 60)}m`
}

function fmtDate(ts) {
  const ms = toMs(ts)
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function setBar(node, remaining) {
  const value = remaining == null ? 0 : Math.max(0, Math.min(100, remaining))
  node.style.width = `${value}%`
  node.style.setProperty('--bar-color', severity(remaining))
}

/* ---------------- renderers ---------------- */

function renderClock() {
  const now = new Date()
  el.clockTime.textContent = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  el.clockDate.textContent = now.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function renderTheme(theme) {
  const c = theme?.data?.colors
  if (!c) return
  document.documentElement.dataset.mode = theme.data.mode === 'light' ? 'light' : 'dark'
  const root = document.documentElement.style
  const set = (key, value) => value && root.setProperty(key, value)
  set('--bg', c.background)
  set('--panel', c.lighter_background || c.background)
  set('--panel-2', c.darker_background || c.background)
  set('--fg', c.foreground)
  set('--muted', c.muted)
  set('--accent', c.accent)
  set('--green', c.green)
  set('--yellow', c.yellow)
  set('--orange', c.orange)
  set('--red', c.red)
  set('--cyan', c.cyan)
}

function renderWeather(weather, backgrounds) {
  const w = weather?.data
  const map = backgrounds?.data?.map ?? {}
  const image = w?.kind ? map[w.kind] ?? map.default : null

  if (image) el.weatherBg.style.backgroundImage = `url("${image}")`
  el.weatherBg.classList.toggle('on', Boolean(image))

  if (!w) {
    el.weatherGlyph.textContent = '🌡️'
    el.weatherTemp.textContent = '--'
    el.weatherLabel.textContent = weather?.error ? 'unavailable' : '…'
    el.weatherMeta.textContent = ''
    return
  }
  el.weatherGlyph.textContent = w.glyph
  el.weatherTemp.textContent = w.temperature
  el.weatherLabel.textContent = w.label
  el.weatherMeta.textContent = `${w.place} · H${w.high}° L${w.low}° · ${w.windSpeed} mph`
}

function renderCodex(codex) {
  const d = codex?.data
  if (!d) {
    el.codexPlan.textContent = ''
    el.codexRemaining.textContent = '--'
    el.codexWindow.textContent = codex?.error ? 'unavailable' : 'left'
    el.codexUsed.textContent = codex?.error ?? ''
    setBar(el.codexBar, 0)
    el.codexFoot.textContent = ''
    return
  }

  el.codexPlan.textContent = d.planType ? d.planType.toUpperCase() : ''

  const win = d.primary ?? d.secondary
  const remaining = win?.remainingPercent ?? null
  el.codexRemaining.textContent = remaining == null ? '--' : Math.round(remaining)
  el.codexWindow.textContent = win ? `left this ${humanWindow(win.windowMinutes)}` : 'left'

  const bits = []
  if (win?.usedPercent != null) bits.push(`${Math.round(win.usedPercent)}% used`)
  const reset = countdown(win?.resetsAt)
  if (reset) bits.push(`resets in ${reset}`)
  el.codexUsed.textContent = bits.join(' · ')
  setBar(el.codexBar, remaining)

  const foot = []
  if (d.resetCredits > 0) {
    foot.push(`<span class="foot-strong">${d.resetCredits} full reset${d.resetCredits === 1 ? '' : 's'}</span> available`)
  }
  if (d.stats?.currentStreakDays) {
    const today = humanTokens(d.stats.todayTokens)
    foot.push(`🔥 ${d.stats.currentStreakDays}-day streak${today ? ` · ${today} tokens today` : ''}`)
  }
  el.codexFoot.innerHTML = foot.join('<br>')
}

/* ---------------- codex detail (usage card back) ---------------- */

function renderCodexBack(codex) {
  const d = codex?.data
  if (!d) {
    el.codexBackPlan.textContent = ''
    el.codexPace.innerHTML = ''
    el.codexSpark.innerHTML = ''
    el.codexStats.innerHTML = ''
    el.codexResets.innerHTML = ''
    return
  }

  el.codexBackPlan.textContent = d.planType ? d.planType.toUpperCase() : ''

  const p = d.pace
  if (p) {
    el.codexPace.style.setProperty('--pace-color', p.onPace ? 'var(--green)' : 'var(--red)')
    el.codexPace.innerHTML = `
      <div class="pace-head">${
        p.onPace ? 'On pace to last until reset' : `On pace to run out in ${fmtHours(p.hoursLeft)}`
      }</div>
      <div class="pace-sub">Averaging ${p.perDay}%/day · resets in ${fmtHours(p.hoursToReset)}</div>`
  } else {
    el.codexPace.innerHTML = ''
  }

  const hist = d.dailyHistory ?? []
  const max = Math.max(1, ...hist.map((h) => h.tokens))
  el.codexSpark.innerHTML = hist.length
    ? `<span class="spark-cap">Daily tokens · last ${hist.length} days</span>
       <div class="spark">${hist
         .map((h, i) => {
           const height = Math.max(2, Math.round((h.tokens / max) * 100))
           const today = i === hist.length - 1
           return `<div class="spark-bar${today ? ' is-today' : ''}" style="height:${height}%" title="${
             h.date
           }: ${humanTokens(h.tokens)}"></div>`
         })
         .join('')}</div>`
    : ''

  const s = d.stats ?? {}
  const stats = [
    ['Current streak', s.currentStreakDays != null ? `${s.currentStreakDays} days` : '—'],
    ['Longest streak', s.longestStreakDays != null ? `${s.longestStreakDays} days` : '—'],
    ['Today', humanTokens(s.todayTokens) ?? '—'],
    ['Lifetime', humanTokens(s.lifetimeTokens) ?? '—'],
  ]
  el.codexStats.innerHTML = stats
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join('')

  const expiries = d.resetCreditExpiries ?? []
  el.codexResets.innerHTML =
    d.resetCredits > 0
      ? `<div class="reset">
           <span><strong>${d.resetCredits}</strong> full reset${d.resetCredits === 1 ? '' : 's'} available</span>
           ${expiries.length ? `<span>next expires ${fmtDate(Math.min(...expiries))}</span>` : ''}
         </div>`
      : ''
}

const OPENCODE_WINDOWS = [
  ['rolling', 'Rolling'],
  ['weekly', 'Weekly'],
]

function renderOpenCode(opencode) {
  const d = opencode?.data
  el.opencodeRows.innerHTML = ''

  if (!d) {
    el.opencodeRows.innerHTML = `<div class="row-reset">${
      opencode?.error ? 'unavailable' : 'Loading…'
    }</div>`
    el.opencodePlan.textContent = ''
    return
  }

  el.opencodePlan.textContent = 'SUBSCRIPTION'

  for (const [key, label] of OPENCODE_WINDOWS) {
    const win = d[key]
    const row = document.createElement('div')
    row.className = 'row'

    const remaining = win?.percent == null ? null : Math.max(0, 100 - win.percent)
    const reset = countdown(win?.resetsAt)

    const head = document.createElement('div')
    head.className = 'row-head'
    head.innerHTML = `
      <span class="row-name">${label}</span>
      <span class="row-remain">${remaining == null ? '--' : Math.round(remaining)}<span class="pct">% left</span></span>
    `
    row.appendChild(head)

    const bar = document.createElement('div')
    bar.className = 'bar'
    const fill = document.createElement('div')
    fill.className = 'bar-fill'
    bar.appendChild(fill)
    row.appendChild(bar)
    setBar(fill, remaining)

    const resetLine = document.createElement('div')
    resetLine.className = 'row-reset'
    resetLine.textContent = win
      ? `${win.status === 'rate-limited' ? 'limit reached · ' : ''}resets in ${reset ?? '—'}`
      : 'not available'
    row.appendChild(resetLine)

    el.opencodeRows.appendChild(row)
  }
}

function renderVolume(volume) {
  const v = volume?.data
  if (!v) {
    el.volDevice.textContent = volume?.error ?? '—'
    el.volValue.textContent = '--'
    return
  }

  const pct = Math.round(v.volume * 100)
  el.volValue.textContent = `${pct}%`
  el.volValue.classList.toggle('muted', v.muted)
  el.volMute.textContent = v.muted ? '🔇' : '🔊'
  el.volMute.classList.toggle('is-muted', v.muted)
  el.volDevice.textContent = v.device ?? 'Default output'
  el.volDeviceBadge.textContent = v.muted ? 'MUTED' : ''

  if (!dragging) el.volSlider.value = String(pct)
}

/* ---------------- weather back face ---------------- */

function renderWeatherBack(weather) {
  const w = weather?.data
  if (!w) {
    el.wxPlace.textContent = ''
    el.wxHours.innerHTML = ''
    el.wxStats.innerHTML = ''
    el.wxDays.innerHTML = ''
    return
  }

  el.wxPlace.textContent = w.place ?? ''

  el.wxHours.innerHTML = (w.hours ?? [])
    .slice(0, 8)
    .map(
      (h, i) => `<div class="hour${i === 0 ? ' is-now' : ''}">
        <span class="hour-time">${i === 0 ? 'now' : String(h.hour).padStart(2, '0')}</span>
        <span class="hour-glyph">${h.glyph}</span>
        <span class="hour-temp">${h.temperature}°</span>
      </div>`,
    )
    .join('')

  const stats = [
    ['Sunrise', `🌅 ${fmtClock(w.sunrise)}`],
    ['Sunset', `🌇 ${fmtClock(w.sunset)}`],
    ['UV index', w.uvIndex ?? '—'],
    ['Humidity', w.humidity != null ? `${w.humidity}%` : '—'],
    ['Moon', w.moon ? `${w.moon.glyph} ${w.moon.name}` : '—', true],
    ['Wind', `${w.windSpeed} mph${w.windDirection ? ` ${w.windDirection}` : ''}`],
  ]
  el.wxStats.innerHTML = stats
    .map(
      ([label, value, wide]) =>
        `<div class="stat${wide ? ' stat-wide' : ''}"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`,
    )
    .join('')

  el.wxDays.innerHTML = (w.days ?? [])
    .map((d, i) => {
      const name = i === 0 ? 'Today' : new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' })
      return `<div class="day">
        <span class="day-name">${name}</span>
        <span class="day-glyph">${d.glyph}</span>
        <span class="day-low">${d.low}°</span>
        <span class="day-high">${d.high}°</span>
      </div>`
    })
    .join('')
}

/* ---------------- temps ---------------- */

function tempColor(value) {
  if (value == null) return 'var(--accent)'
  if (value >= 85) return 'var(--red)'
  if (value >= 70) return 'var(--orange)'
  if (value >= 55) return 'var(--yellow)'
  return 'var(--green)'
}

function renderTemps(temps) {
  const d = temps?.data
  el.tempsList.innerHTML = ''

  if (!d?.sensors?.length) {
    el.tempsBadge.textContent = ''
    el.tempsList.innerHTML = `<div class="row-reset">${temps?.error ? 'unavailable' : 'Loading…'}</div>`
    return
  }

  el.tempsBadge.textContent = `${d.sensors.length} sensors`

  for (const s of d.sensors) {
    const row = document.createElement('div')
    row.className = 'temp'
    row.innerHTML = `
      <div class="temp-head">
        <span class="temp-name">${s.label}</span>
        <span class="temp-value">${Math.round(s.value)}<span class="unit">°C</span></span>
      </div>
      <div class="bar"><div class="bar-fill"></div></div>
    `
    const fill = row.querySelector('.bar-fill')
    const pct = Math.max(0, Math.min(100, s.value))
    fill.style.width = `${pct}%`
    fill.style.setProperty('--bar-color', tempColor(s.value))
    el.tempsList.appendChild(row)
  }
}

/* ---------------- tailscale ---------------- */

function renderTailscale(tailscale) {
  const d = tailscale?.data
  el.tsSelf.innerHTML = ''
  el.tsPeers.innerHTML = ''

  if (!d) {
    el.tsState.textContent = ''
    el.tsSelf.innerHTML = `<div class="row-reset">${tailscale?.error ? 'unavailable' : 'Loading…'}</div>`
    return
  }

  el.tsState.textContent = d.backendState ? d.backendState.toUpperCase() : ''

  const self = d.self ?? {}
  const ips = (self.tailscaleIps ?? []).filter((ip) => !ip.includes(':'))
  el.tsSelf.innerHTML = `
    <div class="ts-name">${self.hostName ?? 'this device'}</div>
    <div class="ts-meta">${[ips.join(', '), self.dnsName].filter(Boolean).join(' · ')}</div>
  `

  const peers = d.peers ?? []
  el.tsPeers.innerHTML = peers.length
    ? peers
        .map((p) => {
          const state = p.online
            ? p.curAddr
              ? 'direct'
              : p.relay
                ? `relay ${p.relay}`
                : 'online'
            : 'offline'
          return `<div class="ts-peer">
            <span class="ts-dot ${p.online ? 'on' : 'off'}"></span>
            <div class="ts-peer-body">
              <div class="ts-name">${p.hostName}</div>
              <div class="ts-meta">${[p.os, state].filter(Boolean).join(' · ')}</div>
            </div>
          </div>`
        })
        .join('')
    : '<div class="row-reset">No peers</div>'
}

/* ---------------- quick actions back face ---------------- */

const ACTIONS = [
  { id: 'lock', icon: '🔒', label: 'Lock' },
  { id: 'nightlight', icon: '🌙', label: 'Night light' },
  { id: 'micmute', icon: '🎙️', label: 'Mute mic' },
  { id: 'screensaver', icon: '💤', label: 'Screensaver' },
  { id: 'screenshot', icon: '📸', label: 'Screenshot' },
  { id: 'theme', icon: '🎨', label: 'Theme' },
]

let footTimer = null

function setActionFoot(message, ok = true) {
  el.actionFoot.textContent = message
  el.actionFoot.style.color = ok ? 'var(--muted)' : 'var(--red)'
  clearTimeout(footTimer)
  footTimer = setTimeout(() => {
    el.actionFoot.textContent = ''
  }, 4000)
}

function buildActions() {
  el.actionGrid.innerHTML = ACTIONS.map(
    (a) => `<button class="action" type="button" data-action="${a.id}">
      <span class="action-icon">${a.icon}</span><span>${a.label}</span>
    </button>`,
  ).join('')

  el.actionGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('.action')
    if (!btn) return
    event.stopPropagation()
    runQuickAction(btn.dataset.action, btn)
  })
}

function renderMic(mic) {
  const muted = mic?.data?.muted
  el.qaMic.textContent = muted ? 'MIC MUTED' : ''
  el.actionGrid.querySelector('[data-action="micmute"]')?.classList.toggle('is-on', Boolean(muted))
}

async function runQuickAction(id, btn) {
  const label = ACTIONS.find((a) => a.id === id)?.label ?? id
  btn.classList.add('is-busy')
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: id }),
    })
    const body = await res.json()
    if (body.mic) renderMic({ data: body.mic })
    setActionFoot(body.ok ? `${label} ✓` : body.error, Boolean(body.ok))
  } catch {
    setActionFoot(`${label} failed`, false)
  } finally {
    btn.classList.remove('is-busy')
  }
}

/* ---------------- flip interaction ---------------- */

function flipCard(card) {
  card.classList.toggle('flipped')
  syncFaces(card)
}

// The face pointing away stays in the DOM but must not be reachable by
// keyboard/AT or receive taps.
function syncFaces(card) {
  const flipped = card.classList.contains('flipped')
  for (const face of card.querySelectorAll('.face')) {
    const isFront = face.classList.contains('front')
    const hidden = isFront === flipped
    face.setAttribute('aria-expanded', String(flipped))
    face.toggleAttribute('inert', hidden)
    // backface-visibility hides the far face visually but it still hit-tests,
    // so it would swallow taps meant for the visible face.
    face.classList.toggle('is-hidden', hidden)
  }
}

function initFlips() {
  for (const card of document.querySelectorAll('.card.flip')) {
    syncFaces(card)

    card.addEventListener('click', (event) => {
      // Controls on the front (volume) and back (quick actions) handle their own taps.
      if (event.target.closest('button, input, a')) return
      flipCard(card)
    })

    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (!event.target.classList?.contains('face')) return
      event.preventDefault()
      flipCard(card)
    })

    for (const btn of card.querySelectorAll('.flip-btn')) {
      btn.addEventListener('click', (event) => {
        event.stopPropagation()
        flipCard(card)
      })
    }
  }
}

/* ---------------- live updates ---------------- */

// The server pushes an event when the theme changes, so the dashboard restyles
// immediately instead of waiting for the next 30s poll. EventSource reconnects
// on its own, and polling stays as the fallback.
function subscribeToEvents() {
  try {
    const events = new EventSource('/api/events')
    events.addEventListener('theme', () => refreshState())
  } catch {
    /* polling covers it */
  }
}

/* ---------------- data plumbing ---------------- */

async function refreshState() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const state = await res.json()
    renderTheme(state.theme)
    renderWeather(state.weather, state.backgrounds)
    renderWeatherBack(state.weather)
    renderCodex(state.codex)
    renderCodexBack(state.codex)
    renderOpenCode(state.opencode)
    renderTemps(state.temps)
    renderTailscale(state.tailscale)
    renderVolume(state.volume)
    renderMic(state.mic)
    el.offline.classList.remove('show')
  } catch {
    el.offline.classList.add('show')
  }
}

async function refreshVolume() {
  if (dragging) return
  try {
    const res = await fetch('/api/volume', { cache: 'no-store' })
    renderVolume(await res.json())
  } catch {
    /* the offline banner already covers this */
  }
}

async function act(action, value) {
  try {
    const res = await fetch('/api/volume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, value }),
    })
    const body = await res.json()
    if (body.ok) {
      dragging = false
      renderVolume(body)
    }
  } catch {
    el.offline.classList.add('show')
  }
}

/* ---------------- volume interactions ---------------- */

el.volUp.addEventListener('click', () => act('up'))
el.volDown.addEventListener('click', () => act('down'))
el.volMute.addEventListener('click', () => act('mute'))

let sliderTimer = null
el.volSlider.addEventListener('pointerdown', () => {
  dragging = true
})
el.volSlider.addEventListener('input', () => {
  dragging = true
  el.volValue.textContent = `${el.volSlider.value}%`
  clearTimeout(sliderTimer)
  sliderTimer = setTimeout(() => act('set', Number(el.volSlider.value) / 100), 180)
})
el.volSlider.addEventListener('change', () => {
  clearTimeout(sliderTimer)
  act('set', Number(el.volSlider.value) / 100)
})

/* ---------------- boot ---------------- */

renderClock()
setInterval(renderClock, 1000)
setInterval(refreshVolume, 2500)

buildActions()
initFlips()
subscribeToEvents()

refreshState()
setInterval(refreshState, 30000)
