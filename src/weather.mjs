import { SourceError } from './errors.mjs'

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const secondsToMs = (seconds) => (Number.isFinite(seconds) ? seconds * 1000 : null)

async function getJson(url, signal, fetchImpl = fetch) {
  let res
  try {
    res = await fetchImpl(url, { signal, headers: { accept: 'application/json' } })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new SourceError('timeout')
    throw new SourceError('network')
  }
  if (!res.ok) throw new SourceError('unavailable', `HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new SourceError('malformed')
  }
}

export function forecastUrl({ lat, lon }, units) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day,cloud_cover',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
    timeformat: 'unixtime',
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: units === 'metric' ? 'celsius' : 'fahrenheit',
    wind_speed_unit: units === 'metric' ? 'kmh' : 'mph',
  })
  return `${FORECAST_URL}?${params}`
}
export function parseForecast(body, place, units = 'imperial') {
  const c = body?.current
  const d = body?.daily
  const h = body?.hourly
  if (!c || !d || !h || !Array.isArray(d.time) || !Array.isArray(h.time)) throw new SourceError('malformed', 'forecast shape')
  if ((c.is_day !== 0 && c.is_day !== 1) || num(c.temperature_2m) === null || !Number.isInteger(c.weather_code) || !Number.isFinite(c.time)) throw new SourceError('malformed', 'current conditions')
  if (typeof body.timezone !== 'string' || !Number.isFinite(body.utc_offset_seconds)) throw new SourceError('malformed', 'timezone')
  try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }) } catch { throw new SourceError('malformed', 'timezone') }

  const days = d.time.map((t, i) => ({
    date: secondsToMs(t),
    code: num(d.weather_code?.[i]),
    high: num(d.temperature_2m_max?.[i]),
    low: num(d.temperature_2m_min?.[i]),
    sunrise: d.sunrise?.[i] > 0 ? secondsToMs(d.sunrise[i]) : null,
    sunset: d.sunset?.[i] > 0 ? secondsToMs(d.sunset[i]) : null,
    uvMax: num(d.uv_index_max?.[i]),
    precipProb: num(d.precipitation_probability_max?.[i]),
  })).filter((day) => day.date !== null)
  if (!days.length) throw new SourceError('malformed', 'daily forecast')

  const hours = h.time.map((t, i) => ({
    at: secondsToMs(t),
    temp: num(h.temperature_2m?.[i]),
    code: num(h.weather_code?.[i]),
    isDay: h.is_day?.[i] === 1,
    precipProb: num(h.precipitation_probability?.[i]),
    cloudCover: num(h.cloud_cover?.[i]),
  })).filter((hour) => hour.at !== null && hour.at >= secondsToMs(c.time) - 3600_000).slice(0, 30)

  return {
    place,
    timezone: body.timezone,
    utcOffsetSeconds: body.utc_offset_seconds,
    units: units === 'metric' ? { temp: '°C', wind: 'km/h' } : { temp: '°F', wind: 'mph' },
    current: {
      at: secondsToMs(c.time),
      temp: c.temperature_2m,
      feelsLike: num(c.apparent_temperature),
      code: c.weather_code,
      isDay: c.is_day === 1,
      cloudCover: num(c.cloud_cover),
      humidity: num(c.relative_humidity_2m),
      pressure: num(c.pressure_msl),
      windSpeed: num(c.wind_speed_10m),
      windDir: num(c.wind_direction_10m),
      windGust: num(c.wind_gusts_10m),
    },
    days,
    hours,
  }
}

let ipPlace = null

async function placeFromIp(signal, fetchImpl) {
  if (ipPlace) return ipPlace
  const body = await getJson('https://ipwho.is/', signal, fetchImpl)
  if (!body?.success || num(body.latitude) === null || num(body.longitude) === null) throw new SourceError('unavailable', 'IP location lookup failed')
  ipPlace = { name: body.city || body.region || body.country || 'Unknown', region: body.region || null, lat: body.latitude, lon: body.longitude, source: 'ip' }
  return ipPlace
}

export async function readWeather({ location, units }, signal, fetchImpl = fetch) {
  const place = location ? { ...location, source: 'override' } : await placeFromIp(signal, fetchImpl)
  return parseForecast(await getJson(forecastUrl(place, units), signal, fetchImpl), place, units)
}

export function parseGeocode(body) {
  if (body == null || typeof body !== 'object') throw new SourceError('malformed')
  const results = Array.isArray(body.results) ? body.results : []
  return results
    .filter((r) => typeof r?.name === 'string' && num(r.latitude) !== null && num(r.longitude) !== null)
    .slice(0, 8)
    .map((r) => ({
      name: [r.name, r.admin1, r.country].filter((x) => typeof x === 'string' && x).join(', ').slice(0, 80),
      lat: Math.round(r.latitude * 1e4) / 1e4,
      lon: Math.round(r.longitude * 1e4) / 1e4,
    }))
}

export async function searchPlaces(query, signal, fetchImpl = fetch) {
  const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' })
  return parseGeocode(await getJson(`${GEOCODE_URL}?${params}`, signal, fetchImpl))
}

/**
 * Pure. Keeps only the OVATION cell nearest the location; the global grid
 * never leaves the server. Coordinates are [lon 0..359, lat -90..90, percent].
 */
export function parseOvation(body, { lat, lon }) {
  const observedAt = Date.parse(body?.['Observation Time'])
  const forecastAt = Date.parse(body?.['Forecast Time'])
  const coords = body?.coordinates
  if (!Number.isFinite(observedAt) || !Number.isFinite(forecastAt) || !Array.isArray(coords)) throw new SourceError('malformed', 'OVATION shape')
  const wantLon = ((Math.round(lon) % 360) + 360) % 360
  const wantLat = Math.round(lat)
  const cell = coords.find((p) => Array.isArray(p) && p[0] === wantLon && p[1] === wantLat)
  if (!cell || num(cell[2]) === null) throw new SourceError('malformed', 'no OVATION cell for location')
  return { probability: cell[2], observedAt, forecastAt, lat: wantLat, lon: wantLon > 180 ? wantLon - 360 : wantLon }
}

export async function readAurora(place, signal, fetchImpl = fetch) {
  if (!place) throw new SourceError('unavailable', 'waiting for the weather location')
  return parseOvation(await getJson(OVATION_URL, signal, fetchImpl), place)
}
