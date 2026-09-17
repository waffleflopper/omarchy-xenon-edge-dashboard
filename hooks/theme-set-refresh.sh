#!/usr/bin/env bash
# Omarchy theme-set hook: restyle the dashboard the moment the theme changes,
# instead of waiting for its next poll.
#
# Install (the copy under ~/.config/omarchy/hooks/ is what actually runs):
#   omarchy hook install theme-set \
#     ~/Projects/waffle-dashboard/hooks/theme-set-refresh.sh
#
# $1 is the snake-cased name of the theme that was just set.
set -euo pipefail

PORT="${WAFFLE_DASHBOARD_PORT:-8787}"

# Nothing to do if the dashboard isn't running.
curl -fsS -m 5 -X POST "http://127.0.0.1:${PORT}/api/theme/refresh" >/dev/null 2>&1 || true
