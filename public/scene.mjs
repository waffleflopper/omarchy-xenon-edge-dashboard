import { precipKind } from './domain.mjs'

export function wxIcon(code, isDay) {
  const p = precipKind(code)
  const sun = '<circle cx="12" cy="12" r="4.5" fill="#ffd36e"/><g stroke="#ffd36e" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g>'
  const moon = '<path d="M15.5 4.2A8 8 0 1 0 19.8 15 6.4 6.4 0 0 1 15.5 4.2Z" fill="#e9e4c9"/>'
  const cloud = (c) => `<path d="M7 18.5h10.2a3.8 3.8 0 0 0 .5-7.6 5.3 5.3 0 0 0-10.2 1A3.3 3.3 0 0 0 7 18.5Z" fill="${c}"/>`
  let body
  if (code === 0 || code === 1) body = isDay ? sun : moon
  else if (code === 2) body = `<g transform="translate(-3 -3) scale(.8)">${isDay ? sun : moon}</g>${cloud('#dfe6f0')}`
  else if (code === 45 || code === 48) body = '<g stroke="#c9d1dc" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h13M4 17h15"/></g>'
  else body = cloud(p === 'none' ? '#c9d1dc' : '#aab6c6')
  if (p === 'rain' || p === 'drizzle') body += '<g stroke="#7cc4ff" stroke-width="1.8" stroke-linecap="round"><path d="M9 20.2l-1 2M13 20.2l-1 2M17 20.2l-1 2"/></g>'
  if (p === 'snow') body += '<g fill="#fff"><circle cx="9" cy="21" r="1.1"/><circle cx="13" cy="22" r="1.1"/><circle cx="17" cy="21" r="1.1"/></g>'
  if (p === 'storm') body += '<path d="M12.5 17.5 10.5 21h2.4l-1.4 3 3.6-4.6h-2.4l1.2-1.9Z" fill="#ffd36e"/>'
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
}

export const ICONS = {
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 2.6 15.2 0 18M12 3c-2.6 2.8-2.6 15.2 0 18"/></svg>',
  terminal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17"/></svg>',
  t3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 9h5M9.5 9v7M14 9h3l-2 2.6a2.2 2.2 0 1 1-1.6 3.9"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><circle cx="9" cy="11" r="1" fill="currentColor"/><circle cx="15" cy="11" r="1" fill="currentColor"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15.5 4.2A8 8 0 1 0 19.8 15 6.4 6.4 0 0 1 15.5 4.2Z"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
}

export function appIcon(desktopId) {
  const id = desktopId.toLowerCase()
  if (/helium|chrom|firefox|browser/.test(id)) return ICONS.globe
  if (/foot|terminal|alacritty|kitty|ghostty/.test(id)) return ICONS.terminal
  if (/t3/.test(id)) return ICONS.t3
  if (/discord|signal|slack|chat/.test(id)) return ICONS.chat
  return ICONS.app
}

function rng(seed) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function cloudShape(x, y, s, fill, op) {
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" opacity="${op}"><ellipse cx="0" cy="0" rx="46" ry="22"/><circle cx="-18" cy="-14" r="20"/><circle cx="10" cy="-22" r="26"/><circle cx="34" cy="-8" r="18"/></g>`
}

function moonPath(cx, cy, r, phase) {
  const k = Math.cos(2 * Math.PI * phase)
  const rx = Math.abs(k) * r
  if (phase <= 0.5) return `M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}A${rx} ${r} 0 0 ${k > 0 ? 0 : 1} ${cx} ${cy - r}Z`
  return `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}A${rx} ${r} 0 0 ${k > 0 ? 1 : 0} ${cx} ${cy - r}Z`
}

const SKIES = {
  night: ['#060a1c', '#101943', '#283566'], dawn: ['#27305e', '#8a5a85', '#f1a374'],
  dusk: ['#1d2350', '#6b4a7e', '#e98a5f'], day: ['#2a78d0', '#69abe8', '#cfe6fa'],
}
const GREY = { night: ['#0d1019', '#161b28', '#232a3a'], dawn: ['#3b3d52', '#6d6577', '#a59096'], dusk: ['#2a2a3e', '#4d4559', '#7d6566'], day: ['#66788c', '#8f9fb1', '#c3ccd6'] }
const HILLS = { night: ['#18224a', '#111938', '#090e22'], dawn: ['#4a3d64', '#2e2a4a', '#191630'], dusk: ['#3e3358', '#2a2442', '#17142a'], day: ['#6f9c8a', '#4f7f68', '#2f5543'] }

/** s: the result of sceneFor(), or null for a neutral backdrop with no weather. */
export function sceneSVG(s) {
  const W = 520, Hh = 426, R = rng(7)
  const neutral = !s
  s ??= { sky: 'night', sun: null, moon: null, clouds: 0, precip: 'none', fog: false, stars: false, aurora: { show: false } }
  const grey = neutral || s.clouds === 3 || s.precip !== 'none' || s.fog
  const sky = (grey ? GREY : SKIES)[s.sky]
  let hills = HILLS[s.sky]
  if (s.precip === 'snow') hills = s.sky === 'day' || s.sky === 'dawn' ? ['#dbe3ec', '#c4cfdb', '#aebccb'] : ['#5d6577', '#4a5163', '#363c4c']
  const out = []
  out.push(`<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>
    <linearGradient id="aur" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b06cff" stop-opacity="0"/><stop offset=".45" stop-color="#6cffb8" stop-opacity=".55"/><stop offset=".85" stop-color="#3dffa0" stop-opacity=".9"/><stop offset="1" stop-color="#3dffa0" stop-opacity="0"/></linearGradient>
    <radialGradient id="sunglow"><stop offset="0" stop-color="#fff3c4" stop-opacity=".9"/><stop offset="1" stop-color="#ffd36e" stop-opacity="0"/></radialGradient>
    <radialGradient id="moonglow"><stop offset="0" stop-color="#e9edff" stop-opacity=".35"/><stop offset="1" stop-color="#e9edff" stop-opacity="0"/></radialGradient>
    <filter id="blur6"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="blur3"><feGaussianBlur stdDeviation="3"/></filter>
    <linearGradient id="scrimTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <linearGradient id="scrimBot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
  </defs>`)
  out.push(`<rect width="${W}" height="${Hh}" fill="url(#sky)"/>`)
  if (s.stars) for (let i = 0; i < 90; i++) out.push(`<circle cx="${(R() * W).toFixed(1)}" cy="${(R() * 250).toFixed(1)}" r="${(0.5 + R() * 1.1).toFixed(2)}" fill="#fff" opacity="${(0.35 + R() * 0.6).toFixed(2)}"/>`)
  if (s.aurora.show) {
    const o = 0.45 + 0.55 * s.aurora.intensity
    out.push(`<g opacity="${o.toFixed(2)}" filter="url(#blur6)">
      <path d="M-30 250 C 70 190, 150 250, 250 205 S 430 160, 560 215 L 560 95 C 430 50, 300 130, 220 95 S 60 70, -30 120 Z" fill="url(#aur)"/>
      <path d="M40 235 C 140 200, 230 235, 330 200 S 470 180, 560 200 L 560 150 C 470 120, 380 160, 300 140 S 120 140, 40 170 Z" fill="url(#aur)" opacity=".7"/>
    </g>`)
    let rays = ''
    for (let i = 0; i < 40; i++) {
      const x = 20 + i * 13 + R() * 6
      rays += `<rect x="${x.toFixed(1)}" y="${(110 + Math.sin(i / 4) * 30).toFixed(0)}" width="2" height="${(70 + R() * 70).toFixed(0)}" fill="#7dffc4" opacity="${(0.05 + R() * 0.12).toFixed(2)}"/>`
    }
    out.push(`<g filter="url(#blur3)" opacity="${o.toFixed(2)}">${rays}</g>`)
  }
  if (s.sun) {
    const x = 300 + s.sun.x * 190, y = 270 - s.sun.y * 135
    out.push(`<circle cx="${x}" cy="${y}" r="70" fill="url(#sunglow)" opacity="${grey ? 0.35 : 1}"/><circle cx="${x}" cy="${y}" r="26" fill="#fff1bf" opacity="${grey ? 0.35 : 1}"/>`)
  }
  if (s.moon) {
    const cx = 452, cy = 150, r = 20
    out.push(`<circle cx="${cx}" cy="${cy}" r="60" fill="url(#moonglow)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#2b3150" opacity=".55"/><path d="${moonPath(cx, cy, r, s.moon.phase)}" fill="#f2efdc"/>`)
  }
  const cloudFill = s.sky === 'night' ? '#3a4466' : s.sky === 'day' ? (grey ? '#d4dae2' : '#ffffff') : grey ? '#6f6177' : '#9b7f9a'
  const spots = [[90, 215, 0.8], [430, 190, 0.9], [250, 215, 0.7], [470, 110, 0.8], [340, 245, 1], [160, 240, 0.9], [30, 190, 0.9]]
  spots.slice(0, [0, 2, 4, 7][s.clouds]).forEach(([x, y, sc]) => out.push(cloudShape(x, y, sc, cloudFill, s.sky === 'night' ? 0.85 : 0.9)))
  if (s.clouds === 3) out.push(`<rect y="0" width="${W}" height="200" fill="${cloudFill}" opacity=".25" filter="url(#blur6)"/>`)
  out.push(`<path d="M0 300 C 90 262, 170 280, 260 258 S 420 240, 520 270 V 426 H 0 Z" fill="${hills[0]}"/>`)
  out.push(`<path d="M0 340 C 120 300, 210 330, 320 305 S 470 300, 520 318 V 426 H 0 Z" fill="${hills[1]}"/>`)
  let trees = ''
  for (const [x, y, k] of [[300, 312, 1], [318, 318, 0.8], [338, 309, 1.15], [470, 316, 0.9], [488, 322, 0.75], [36, 330, 0.9]]) {
    trees += `<path d="M${x} ${y - 46 * k} L${x - 14 * k} ${y} H${x + 14 * k} Z" fill="${hills[2]}"/>`
  }
  out.push(trees)
  out.push(`<path d="M0 380 C 140 352, 260 372, 380 352 S 500 350, 520 356 V 426 H 0 Z" fill="${hills[2]}"/>`)
  const lit = !neutral && (s.sky === 'night' || s.sky === 'dusk')
  out.push(`<g transform="translate(205 300)"><rect x="0" y="12" width="38" height="24" fill="${hills[2]}"/><path d="M-4 14 L19 -4 L42 14 Z" fill="${hills[2]}"/><rect x="8" y="19" width="9" height="8" fill="${lit ? '#ffcf70' : '#3b4a52'}"/>${lit ? '<circle cx="12" cy="23" r="16" fill="#ffcf70" opacity=".12"/>' : ''}</g>`)
  if (s.precip === 'rain' || s.precip === 'drizzle' || s.precip === 'storm') {
    let r = ''
    const count = s.precip === 'drizzle' ? 60 : 150
    for (let i = 0; i < count; i++) {
      const x = R() * 560 - 20, y = R() * 380
      r += `<path d="M${x.toFixed(0)} ${y.toFixed(0)} l-5 15"/>`
    }
    out.push(`<g stroke="#b9d3f2" stroke-width="1.3" stroke-linecap="round" opacity=".5">${r}</g>`)
  }
  if (s.precip === 'storm') out.push('<path d="M300 90 L270 170 H292 L268 240 L330 150 H306 L326 90 Z" fill="#fff3b0" opacity=".85"/>')
  if (s.precip === 'snow') {
    let r = ''
    for (let i = 0; i < 160; i++) r += `<circle cx="${(R() * W).toFixed(0)}" cy="${(R() * 400).toFixed(0)}" r="${(1 + R() * 2.2).toFixed(1)}"/>`
    out.push(`<g fill="#fff" opacity=".85">${r}</g>`)
  }
  if (s.fog) for (let i = 0; i < 5; i++) out.push(`<rect x="-40" y="${180 + i * 42}" width="600" height="34" rx="17" fill="#e8edf2" opacity="${0.16 + i * 0.04}" filter="url(#blur6)"/>`)
  out.push(`<rect width="${W}" height="190" fill="url(#scrimTop)"/><rect y="250" width="${W}" height="176" fill="url(#scrimBot)"/>`)
  return `<svg class="sky" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out.join('')}</svg>`
}
