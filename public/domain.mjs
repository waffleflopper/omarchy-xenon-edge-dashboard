export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const POLICIES = {
  theme: { staleAfterMs: 10 * MINUTE, expireAfterMs: DAY },
  volume: { staleAfterMs: 30_000, expireAfterMs: 5 * MINUTE },
  hardware: { staleAfterMs: 30_000, expireAfterMs: 5 * MINUTE },
  weather: { staleAfterMs: 25 * MINUTE, expireAfterMs: 3 * HOUR },
  aurora: { staleAfterMs: 45 * MINUTE, expireAfterMs: 90 * MINUTE },
  quota: { staleAfterMs: 12 * MINUTE, expireAfterMs: 6 * HOUR },
}

export const PACE_AT_LOW = 95
export const PACE_AT_HIGH = 105
export const PACE_EARLY_MS = 5 * MINUTE

/**
 * A reported quota window: { kind, label, usedPercent, durationMinutes, resetsAt (epoch ms) }.
 * Projects use at reset as usedPercent / elapsedFraction and classifies the raw
 * projection. 95..105 inclusive is "at" pace.
 */
export function pace(w, now) {
  if (now >= w.resetsAt) return { state: 'expired' }
  if (w.usedPercent >= 100) return { state: 'exhausted' }
  const durationMs = w.durationMinutes * MINUTE
  const start = w.resetsAt - durationMs
  const elapsedMs = now - start
  const elapsedPercent = Math.max(0, (elapsedMs / durationMs) * 100)
  if (elapsedMs < PACE_EARLY_MS) return { state: 'early', elapsedPercent }
  const projectedPercent = w.usedPercent / (elapsedMs / durationMs)
  if (projectedPercent > PACE_AT_HIGH) {
    const runsOutAt = w.usedPercent > 0 ? Math.round(start + elapsedMs * (100 / w.usedPercent)) : null
    return { state: 'over', elapsedPercent, projectedPercent, runsOutAt }
  }
  return { state: projectedPercent >= PACE_AT_LOW ? 'at' : 'under', elapsedPercent, projectedPercent }
}

export function projectedLabel(p) {
  const v = p.projectedPercent
  if (v < 90 || v > 110) return `${Math.round(v)}%`
  const shown = Number(v.toFixed(1))
  if (p.state === 'under' && shown >= PACE_AT_LOW) return `<${PACE_AT_LOW}%`
  if (p.state === 'over' && shown <= PACE_AT_HIGH) return `>${PACE_AT_HIGH}%`
  return `${shown.toFixed(1)}%`
}

/**
 * Applies one stream event to the browser's slot store. Revisions are only
 * comparable within one server instance, so a restarted server's events are
 * accepted even though its counter starts again from 1.
 */
export function acceptSlot(store, { instance, id, revision, slot, policy }) {
  if (store.instance !== instance) {
    store.instance = instance
    store.slots = new Map()
  }
  const prev = store.slots.get(id)
  if (prev && prev.revision >= revision) return false
  store.slots.set(id, { revision, slot, policy })
  return true
}

export function ago(ms) {
  const min = Math.floor(ms / MINUTE)
  if (min < 1) return 'now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

/**
 * Slot: { state: 'pending' } | { state: 'ok', value, fetchedAt }
 *     | { state: 'stale', value, fetchedAt, error, failedAt } | { state: 'failed', error, failedAt }
 * Returns the tone the UI shows, derived on every render so it cannot drift.
 */
export function freshness(slot, policy, now) {
  if (!slot || slot.state === 'pending') return { tone: 'loading', label: 'loading' }
  if (slot.state === 'failed') return { tone: 'failed', label: 'unavailable', why: slot.error.message }
  const age = now - slot.fetchedAt
  const label = ago(age)
  if (age > policy.expireAfterMs) return { tone: 'expired', label, why: slot.state === 'stale' ? slot.error.message : 'not refreshed' }
  if (slot.state === 'stale') return { tone: 'stale', label, why: slot.error.message }
  if (age > policy.staleAfterMs) return { tone: 'aging', label }
  return { tone: 'live', label }
}

export const isLive = (f) => f.tone === 'live'

export function percentLabel(v) {
  v = Number(v.toPrecision(12))
  if (v > 0 && v < 0.1) return '<0.1%'
  if ((v > 0 && v < 1) || (v > 99 && v < 100)) return `${Math.floor(v * 10) / 10}%`
  return `${Math.round(v)}%`
}

const SYNODIC_DAYS = 29.530588853
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14)

export function moonPhase(now) {
  const p = ((now - KNOWN_NEW_MOON) / DAY / SYNODIC_DAYS) % 1
  return p < 0 ? p + 1 : p
}

export const moonLit = (phase) => (1 - Math.cos(2 * Math.PI * phase)) / 2

const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent']

export function moonName(phase) {
  if (moonLit(phase) < 0.05) return 'New moon'
  const i = Math.round(phase * 8) % 8
  return i === 0 ? (phase < 0.5 ? 'Waxing crescent' : 'Waning crescent') : MOON_NAMES[i]
}

export function precipKind(code) {
  if (code >= 95) return 'storm'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if (code >= 51 && code <= 57) return 'drizzle'
  return 'none'
}

export const TWILIGHT_MS = 45 * MINUTE
export const AURORA_MIN_PROBABILITY = 10
export const AURORA_MAX_CLOUD = 50

export const WEATHER_MAX_OBSERVATION_AGE_MS = HOUR

// OVATION runs describe roughly the next 30 to 90 minutes from their observation.
export const AURORA_MAX_OBSERVATION_AGE_MS = 90 * MINUTE

export function dayAt(weather, now) {
  const days = weather.days
  for (let i = days.length - 1; i >= 0; i--) if (days[i].date <= now) return days[i]
  return days[0]
}

/**
 * Aurora is a NOAA OVATION possibility forecast, never an observation. Every
 * gate must pass before the scene draws it.
 * aurora: { reading: { probability, forecastAt, observedAt, lat, lon }, current: boolean } | null
 * weatherCurrent and aurora.current are true only for live slots.
 */
export function auroraGates(weather, aurora, now, sky, weatherCurrent) {
  const reading = aurora?.reading
  const cloud = weather.current.cloudCover
  return {
    dark: sky === 'night',
    weather: weatherCurrent && now - weather.current.at <= WEATHER_MAX_OBSERVATION_AGE_MS,
    clear: typeof cloud === 'number' && cloud < AURORA_MAX_CLOUD,
    forecast: !!reading && reading.probability >= AURORA_MIN_PROBABILITY,
    fresh: !!reading && aurora.current
      && now - reading.observedAt <= AURORA_MAX_OBSERVATION_AGE_MS && reading.observedAt <= now + 5 * MINUTE
      && reading.forecastAt >= now - 30 * MINUTE && reading.forecastAt <= now + 2 * HOUR,
    location: !!reading && Math.abs(reading.lat - weather.place.lat) <= 1 && lonDistance(reading.lon, weather.place.lon) <= 1,
  }
}

const lonDistance = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)
export function sceneFor(weather, aurora, now, weatherCurrent = true) {
  const today = dayAt(weather, now)
  const { sunrise, sunset } = today
  const sky = sunrise == null || sunset == null
    ? (weather.current.isDay ? 'day' : 'night')
    : now < sunrise - TWILIGHT_MS || now > sunset + TWILIGHT_MS ? 'night'
      : now < sunrise + TWILIGHT_MS ? 'dawn'
        : now > sunset - TWILIGHT_MS ? 'dusk' : 'day'
  const cc = weather.current.cloudCover ?? 50
  const clouds = cc < 20 ? 0 : cc < 50 ? 1 : cc < 85 ? 2 : 3
  const code = weather.current.code
  const precip = precipKind(code)
  const fog = code === 45 || code === 48
  const f = sunrise == null ? 0.5 : Math.max(0, Math.min(1, (now - sunrise) / (sunset - sunrise)))
  const sun = sky === 'night' ? null : { x: f, y: Math.sin(Math.PI * f) }
  const phase = moonPhase(now)
  const moon = (sky === 'night' || sky === 'dusk') && moonLit(phase) >= 0.05 && clouds < 3 && precip === 'none' ? { phase } : null
  const stars = sky === 'night' && clouds < 3 && precip === 'none' && !fog
  const gates = auroraGates(weather, aurora, now, sky, weatherCurrent)
  const show = Object.values(gates).every(Boolean)
  return {
    sky, sun, moon, clouds, precip, fog, stars,
    aurora: { show, gates, probability: aurora?.reading?.probability ?? null, intensity: show ? Math.min(1, aurora.reading.probability / 35) : 0 },
  }
}

export function placeApp(list, slotIndex, item) {
  const next = [...list]
  const existing = next.findIndex((l) => l.desktopId === item.desktopId)
  if (existing === slotIndex) return next
  if (existing >= 0 && slotIndex < next.length) {
    next[existing] = next[slotIndex]
    next[slotIndex] = item
  } else if (existing >= 0) {
    next.splice(existing, 1)
    next.push(item)
  } else if (slotIndex < next.length) next[slotIndex] = item
  else next.push(item)
  return next
}
