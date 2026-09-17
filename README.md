# Waffle Dashboard

An always-on dashboard for a small secondary display, built for
[Omarchy](https://omarchy.org/) (Arch + Hyprland). It runs as a local web page
rendered full-screen in Chromium on a dedicated monitor.

Written against a 2560×720 touchscreen at scale 1.6 (1600×450 logical), but it
is just a web page — any output works.

## What it shows

Four cards, laid out in a row:

- **Clock / weather** — time, date and current conditions, over a photo of the
  matching sky. Tap to flip for an 8-hour strip, sunrise/sunset, UV, humidity,
  wind, moon phase and a 5-day forecast.
- **Codex** — remaining usage on the current window, plus reset countdown. The
  back has a burn-rate projection ("on pace to run out in X"), a 30-day token
  chart, streaks and reset credits.
- **OpenCode Go** — rolling / weekly / monthly remaining.
- **Volume** — output device, level, mute and a slider. The back is a
  quick-actions panel: lock, night light, mic mute, screensaver, screenshot,
  theme switcher.

Cards flip on tap or via the tab on their right edge. The whole UI follows the
active Omarchy theme, live.

## Requirements

- Omarchy / Hyprland on Wayland (the window placement and quick actions are
  Omarchy-specific; the rest is not)
- Node.js 20+ (no dependencies — nothing to `npm install`)
- Chromium
- PipeWire (`wpctl`) for volume
- [Codex CLI](https://github.com/openai/codex) installed and logged in, for the
  Codex card
- [OpenCode](https://opencode.ai) logged in with an OpenCode Go subscription
  (`opencode auth login`), for the OpenCode card
- Internet access for weather (IP geolocation + [Open-Meteo](https://open-meteo.com))

Cards whose data source is unavailable degrade gracefully — they show an error
rather than breaking the page.

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

The dashboard already follows the Omarchy theme, but its cache means a change
can take up to ~90s. To make it immediate, install the hook:

```bash
omarchy hook install theme-set ~/Projects/waffle-dashboard/hooks/theme-set-refresh.sh
```

This calls `POST /api/theme/refresh`, and the server pushes an update to the page
over SSE. Note `omarchy hook install` **copies** the script, so re-run it after
editing.

## Configuration

| Variable | Where | Default |
| --- | --- | --- |
| `PORT` | server | `8787` |
| `HOST` | server | `127.0.0.1` |
| `CODEX_BIN` | server | auto-detected |
| `WAFFLE_DASHBOARD_PORT` | `bin/kiosk`, hook | `8787` |

Weather backgrounds are drop-in images in `assets/weather/`, named after the
condition (`clear-day`, `clear-night`, `partly`, `clouds`, `rain`, `snow`, `fog`,
`storm`) plus an optional `default`. The first match wins across
`webp`, `avif`, `jpg`, `jpeg`, `png`, `svg` — case-insensitive. No restart
needed; the directory is rescanned every 30s.

## Data sources and credentials

The backend binds to **loopback only**.

- **Codex** talks JSON-RPC to `codex app-server` so that Codex owns its own OAuth
  refresh — this project never reads `~/.codex/auth.json`.
- **OpenCode Go** reads its key from `~/.local/share/opencode/auth.json` and
  sends it as a Bearer token. Nothing is cached to disk or logged.
- **Weather** geolocates from your public IP, then queries Open-Meteo. No API
  key, but it does mean your approximate location is used.
- **Weather images** are served from `assets/weather/`.

Quick actions are restricted to a fixed whitelist in `src/actions.mjs`; nothing
caller-supplied is ever executed.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness |
| GET | `/api/state` | everything the page renders |
| GET/POST | `/api/volume` | read / change output volume |
| POST | `/api/action` | run a whitelisted quick action |
| GET | `/api/events` | SSE; currently emits `theme` |
| POST | `/api/theme/refresh` | drop the theme cache and notify clients |

## Weather image credits

See [`assets/weather/CREDITS.md`](assets/weather/CREDITS.md). Most are CC0 or
public domain; two require attribution, so **keep that file** if you keep the
images.

## Licence

No licence file yet — add one before publishing if you want others to reuse it.
