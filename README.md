# Waffle Dashboard

An always-on dashboard for a small secondary touchscreen, built for
[Omarchy](https://omarchy.org/) (Arch + Hyprland). It is a local web page shown
full-screen in Chromium on a dedicated monitor.

It is laid out for a Corsair Xeneon Edge: 2560×720 at scale 1.6, so 1600×450
CSS pixels, or 1580×404 when the kiosk window is tiled. Ordinary browser
windows narrower than 1450 px get a stacked, scrolling layout.

## What it shows

- **Clock and weather scene.** Time, date and an illustrated sky that follows
  day, dusk, night, cloud, rain, snow, fog and storms at the forecast location,
  with an approximate lunar phase. Tap it for the next 12 hours, five days,
  sunrise and sunset, feels-like, wind and gusts, pressure, humidity, cloud
  cover, UV and the moon. The Location tab searches for a place and saves it,
  or goes back to the approximate location from your internet connection.
- **Aurora.** Drawn only when every check passes: a live NOAA forecast of at
  least 10% near the weather location, a recent model run, darkness, cloud
  under 50% and current weather. It is labelled as a forecast, never a sighting.
- **AI quota.** One row per account: OpenAI (Codex) and two Claude accounts.
  Each reported window shows the share left, an even-pace tick and a pace chip.
  Bars start full and shrink as quota is used, and the tick marks how much would
  be left at an even pace. Pace is the projected use at reset (used ÷ elapsed
  share of the window): under below 95%, at from 95% to 105%, over above 105%.
  The first five minutes of a window are "early", a window past its reset is "reset", and 100% used is
  "limit hit". A window an account does not report shows "Not reported", never 0%.
- **System.** CPU (k10temp Tctl), GPU (nvidia-smi) and board (nct6687 Diode 0)
  temperatures, storage with `/` and `/home` counted once when they share a
  filesystem, and memory.
- **Dock.** Four quick launchers you can edit on the screen, volume and mute,
  theme picker, screenshot, screensaver and power. Sleep and shut down each ask
  for confirmation with Cancel focused.

Every source is read on its own schedule. When one fails the others carry on,
and the failed one keeps its last reading marked as stale with the reason and
its age. The page follows the active Omarchy theme live.

## Requirements

- Omarchy / Hyprland on Wayland, with uwsm (launchers start through `uwsm-app`)
- Node.js 20+ (no dependencies, nothing to `npm install`)
- Chromium
- PipeWire (`wpctl`) for volume
- `lm_sensors`, and `nvidia-smi` for an NVIDIA GPU
- [Codex CLI](https://github.com/openai/codex), signed in, for the OpenAI row
- Claude Code, signed in, for each Claude row
- Internet access for weather ([Open-Meteo](https://open-meteo.com)), the
  aurora forecast ([NOAA SWPC](https://www.swpc.noaa.gov/)) and the approximate
  location ([ipwho.is](https://ipwho.is)) when no place is saved

## Install

### 1. Get the code

```bash
git clone <your-fork> ~/Projects/waffle-dashboard
```

### 2. Backend as a user service

`~/.config/systemd/user/waffle-dashboard.service`:

```ini
[Unit]
Description=Waffle Dashboard backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/Projects/waffle-dashboard
ExecStart=%h/Projects/waffle-dashboard/bin/serve
Environment=PORT=8787
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now waffle-dashboard.service
curl -fsS http://127.0.0.1:8787/healthz
```

`bin/serve` puts `~/.local/share/mise/shims` on `PATH` so `node` and `codex`
resolve; adjust it if you install Node elsewhere.

### 3. Launch the kiosk at login

Add to `~/.config/hypr/autostart.lua`:

```lua
o.launch_on_start("/home/YOU/Projects/waffle-dashboard/bin/kiosk")
```

Or start it by hand with `~/Projects/waffle-dashboard/bin/kiosk`.

### 4. Place it on the right output

Add to `~/.config/hypr/windows.lua` (and `require("hypr.windows")` from
`hyprland.lua` if you don't already):

```lua
local function waffle_dashboard_kiosk(match)
  o.window(match, {
    monitor = "DP-2",      -- change to your output
    fullscreen = true,
    border_size = 0,
    rounding = 0,
    no_blur = true,
    no_shadow = true,
    no_dim = true,
    no_anim = true,
    tag = "-default-opacity",
    opacity = "1 1",
  })
end

-- Chromium ignores --class for --app windows on Wayland and derives the app_id
-- from the URL, so match that; the page title is the fallback.
waffle_dashboard_kiosk({ class = "^chrome-127\\.0\\.0\\.1__-Default$" })
waffle_dashboard_kiosk({ initial_title = "^Waffle Dashboard$" })
```

Two things that are easy to get wrong:

- **Keep `fullscreen = true` in the rule.** Chromium's `--kiosk` handles first
  paint, but a config reload (which Omarchy does when it restyles) re-evaluates
  window rules and will drop the window back to tiled without it.
- **Don't add a `workspace` effect to this rule.** Combining `workspace` with
  `fullscreen` is order-dependent and the fullscreen silently stops sticking.

If you serve on a different port, update the class to match
(`chrome-127.0.0.1__<port>-Default`).

### 5. Instant theme following (optional)

The dashboard checks the Omarchy theme every minute. To restyle immediately,
install the hook:

```bash
omarchy hook install theme-set ~/Projects/waffle-dashboard/hooks/theme-set-refresh.sh
```

It posts to `/api/theme/refresh` and the server pushes the new palette to the
page. `omarchy hook install` copies the script, so re-run it after editing.

## Configuration

Settings live in `~/.config/waffle-dashboard/config.json`. The file is
optional; missing keys use the defaults below. The dashboard writes it only
when you save launchers or a location, atomically, and keeps keys it does not
know. If the file is not valid JSON or a field is invalid, the dashboard
reports it, uses defaults for the affected setting and refuses to save until
you fix or remove the file.

```json
{
  "launchers": [
    { "label": "Helium", "desktopId": "helium.desktop" },
    { "label": "Terminal", "desktopId": "foot.desktop" },
    { "label": "T3 Code", "desktopId": "com.t3tools.T3Code.desktop" },
    { "label": "Discord", "desktopId": "Discord.desktop" }
  ],
  "location": null,
  "units": "imperial",
  "mounts": ["/", "/home"],
  "edgeMonitor": "DP-2",
  "launchMonitor": null,
  "accounts": [
    { "id": "openai", "provider": "codex", "label": "OpenAI" },
    { "id": "claude", "provider": "claude", "label": "Claude", "configDir": "~/.claude", "identityFile": "~/.claude.json" },
    { "id": "claude-waffle", "provider": "claude", "label": "ClaudeWaffle", "configDir": "~/.claude_waffle", "identityFile": "~/.claude_waffle/.claude.json" }
  ]
}
```

- `launchers`: up to four installed desktop entries. The stable T3 Code entry
  is listed in the editor even though it is hidden from menus.
- `location`: `{ "name", "lat", "lon" }`, or `null` to use the approximate
  location from your public IP.
- `edgeMonitor` / `launchMonitor`: apps never open on the Edge. They go to
  `launchMonitor` if set, otherwise the focused other monitor, otherwise the
  largest one. If focus cannot be moved off the Edge, the launch is cancelled
  with a message.

| Variable | Used by | Default |
| --- | --- | --- |
| `PORT` | server | `8787` |
| `WAFFLE_CONFIG_PATH` | server | `~/.config/waffle-dashboard/config.json` |
| `WAFFLE_DRY_RUN` | server | empty |
| `CODEX_BIN` | server | auto-detected |
| `WAFFLE_DASHBOARD_PORT` | `bin/kiosk`, hook | `8787` |

`WAFFLE_DRY_RUN` is a comma-separated list of command groups to record in the
log instead of running: `power`, `launch`, `theme`, `screenshot`,
`screensaver`, `volume`. It is never turned on implicitly. For a development
copy that cannot sleep or shut the machine down:

```bash
PORT=8788 WAFFLE_CONFIG_PATH=/tmp/waffle-dev.json WAFFLE_DRY_RUN=power,theme,launch node server.mjs
```

## Data sources and credentials

The backend listens on loopback only. Credentials stay on the server and never
appear in responses or logs; errors reach the page as short fixed messages.

- **Codex** talks JSON-RPC to `codex app-server --stdio`, which owns its own
  OAuth refresh. `~/.codex/auth.json` is never read.
- **Claude** reads each account's `<configDir>/.credentials.json` afresh on
  every refresh and calls the Claude usage endpoint with that token. It never
  refreshes or writes credentials: an expired sign-in is shown as expired until
  Claude Code renews it. A provider `Retry-After` is honoured, including by the
  Retry button. If two configured accounts turn out to be the same sign-in, the
  row says so by label; account IDs and emails never leave the server.
- **Weather** comes from Open-Meteo with epoch times and the location's time
  zone, so hours and sunrise are shown in the forecast location's local time.
  If it goes stale, open the weather sheet and press Refresh weather; reloading
  the page does not re-read it.
- **Aurora** is the NOAA SWPC OVATION 30-minute forecast. The server keeps only
  the grid cell nearest the weather location.
- **Hardware** runs `sensors -j` and `nvidia-smi` and reads `/proc`.

Commands are fixed argument lists run without a shell (`src/actions.mjs`). The
only values that come from a request are a launcher already in your config, a
theme name from the installed list, a power choice of sleep or shut down, and a
volume number clamped to 0..1.

## HTTP API

Every route except `/healthz` requires the exact `Host` `127.0.0.1:<port>` or
`localhost:<port>`. No CORS headers are sent.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness |
| GET | `/api/stream` | SSE. Replays every source on connect, then sends each change as `event: slot` |
| GET | `/api/apps` | installed launchable applications |
| GET | `/api/themes` | installed Omarchy themes with palettes |
| POST | `/api/do` | one action as JSON; same Origin and `content-type: application/json` required |
| POST | `/api/theme/refresh` | re-read the theme now; for the hook, which sends no Origin |

## Development

```bash
npm test
```

Tests use literal expected values at the boundaries: pace thresholds, provider
payload parsing, config handling, the source hub and the HTTP guards. HTTP tests
use a recording command runner, so nothing is ever launched, suspended or shut
down.

## Licence

[MIT](LICENSE). The weather art is drawn in code (`public/scene.mjs`) and is
covered by the same licence.
