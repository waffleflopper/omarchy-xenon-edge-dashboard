// WMO weather interpretation codes -> [label, day glyph, night glyph].
const WMO = {
  0: ['Clear sky', '☀️', '🌙'],
  1: ['Mainly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Overcast', '☁️', '☁️'],
  45: ['Fog', '🌫️', '🌫️'],
  48: ['Rime fog', '🌫️', '🌫️'],
  51: ['Light drizzle', '🌦️', '🌧️'],
  53: ['Drizzle', '🌦️', '🌧️'],
  55: ['Dense drizzle', '🌧️', '🌧️'],
  56: ['Freezing drizzle', '🌧️', '🌧️'],
  57: ['Freezing drizzle', '🌧️', '🌧️'],
  61: ['Light rain', '🌦️', '🌧️'],
  63: ['Rain', '🌧️', '🌧️'],
  65: ['Heavy rain', '🌧️', '🌧️'],
  66: ['Freezing rain', '🌧️', '🌧️'],
  67: ['Freezing rain', '🌧️', '🌧️'],
  71: ['Light snow', '🌨️', '🌨️'],
  73: ['Snow', '🌨️', '🌨️'],
  75: ['Heavy snow', '❄️', '❄️'],
  77: ['Snow grains', '🌨️', '🌨️'],
  80: ['Rain showers', '🌦️', '🌧️'],
  81: ['Rain showers', '🌧️', '🌧️'],
  82: ['Violent showers', '⛈️', '⛈️'],
  85: ['Snow showers', '🌨️', '🌨️'],
  86: ['Snow showers', '❄️', '❄️'],
  95: ['Thunderstorm', '⛈️', '⛈️'],
  96: ['Thunderstorm, hail', '⛈️', '⛈️'],
  99: ['Thunderstorm, hail', '⛈️', '⛈️'],
}

// WMO weather code + day/night -> the condition key used to pick a background
// image (see src/backgrounds.mjs).
export function weatherKind(code, isDay) {
  if (code == null) return 'clouds'
  if (code >= 95) return 'storm'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  if (code === 45 || code === 48) return 'fog'
  if (code === 3) return 'clouds'
  if (code === 2) return 'partly'
  if (code === 0 || code === 1) return isDay ? 'clear-day' : 'clear-night'
  return 'clouds'
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass = (deg) => (typeof deg === 'number' ? COMPASS[Math.round(deg / 45) % 8] : null)

// Synodic month, anchored to a known new moon (2000-01-06 18:14 UTC).
function moonInfo(date = new Date()) {
  const SYNODIC = 29.530588853
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14)
  let phase = ((date.getTime() - knownNewMoon) / 86400000 / SYNODIC) % 1
  if (phase < 0) phase += 1

  const names = [
    'New moon',
    'Waxing crescent',
    'First quarter',
    'Waxing gibbous',
    'Full moon',
    'Waning gibbous',
    'Last quarter',
    'Waning crescent',
  ]
  const glyphs = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
  const index = Math.round(phase * 8) % 8
  return { phase: Number(phase.toFixed(3)), name: names[index], glyph: glyphs[index] }
}

let geo = null

async function geolocate() {
  if (geo) return geo

  const first = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(10000) })
  if (first.ok) {
    const body = await first.json()
    if (body?.success && typeof body.latitude === 'number') {
      geo = {
        latitude: body.latitude,
        longitude: body.longitude,
        city: body.city,
        region: body.region,
        country: body.country,
        timezone: body.timezone?.id ?? 'auto',
      }
      return geo
    }
  }

  throw new Error('Could not determine location from IP')
}

export async function readWeather() {
  const place = await geolocate()

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    timezone: place.timezone || 'auto',
    forecast_days: '5',
  })

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Open-Meteo failed: HTTP ${res.status}`)

  const body = await res.json()
  const current = body.current
  const [label, dayGlyph, nightGlyph] = WMO[current.weather_code] ?? ['Unknown', '🌡️', '🌡️']
  const isDay = current.is_day === 1

  // Hourly: start at the current hour and take the next 12.
  const hourly = body.hourly ?? { time: [] }
  let startIndex = hourly.time.findIndex((t) => Date.parse(t) >= Date.now() - 3600000)
  if (startIndex < 0) startIndex = 0
  const hours = hourly.time.slice(startIndex, startIndex + 12).map((t, i) => {
    const idx = startIndex + i
    const code = hourly.weather_code?.[idx]
    const [, dayIcon, nightIcon] = WMO[code] ?? ['', '🌡️', '🌡️']
    const hour = new Date(t).getHours()
    return {
      time: t,
      hour,
      temperature: Math.round(hourly.temperature_2m?.[idx]),
      code,
      glyph: hour >= 6 && hour < 20 ? dayIcon : nightIcon,
      precip: hourly.precipitation_probability?.[idx] ?? null,
    }
  })

  const daily = body.daily ?? { time: [] }
  const days = daily.time.map((date, i) => {
    const code = daily.weather_code?.[i]
    return {
      date,
      code,
      glyph: (WMO[code] ?? ['', '🌡️'])[1],
      high: Math.round(daily.temperature_2m_max?.[i]),
      low: Math.round(daily.temperature_2m_min?.[i]),
      precip: daily.precipitation_probability_max?.[i] ?? null,
    }
  })

  return {
    // Front face
    temperature: Math.round(current.temperature_2m),
    feelsLike: Math.round(current.apparent_temperature),
    high: Math.round(daily.temperature_2m_max?.[0]),
    low: Math.round(daily.temperature_2m_min?.[0]),
    windSpeed: Math.round(current.wind_speed_10m),
    isDay,
    code: current.weather_code,
    kind: weatherKind(current.weather_code, isDay),
    label,
    glyph: isDay ? dayGlyph : nightGlyph,
    place: place.city || place.region || place.country || 'Unknown',
    region: place.region ?? null,
    units: '°F',

    // Back face
    humidity: current.relative_humidity_2m ?? null,
    pressure: current.surface_pressure != null ? Math.round(current.surface_pressure) : null,
    windDirection: compass(current.wind_direction_10m),
    dewPoint: null,
    uvIndex: daily.uv_index_max?.[0] != null ? Math.round(daily.uv_index_max[0]) : null,
    precipProbability: hourly.precipitation_probability?.[startIndex] ?? null,
    sunrise: daily.sunrise?.[0] ?? null,
    sunset: daily.sunset?.[0] ?? null,
    hours,
    days,
    moon: moonInfo(),
  }
}
