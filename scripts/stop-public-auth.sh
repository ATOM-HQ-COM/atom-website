#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Stopping Caddy..."
sudo caddy stop >/dev/null 2>&1 || true

echo "Stopping Atom auth gateway..."
PIDS="$(pgrep -f "local-auth-server/server.js" || true)"
if [ -n "$PIDS" ]; then
  kill $PIDS
  echo "Stopped auth gateway process(es): $PIDS"
else
  echo "Auth gateway was not running."
fi

echo "Public signup/login is now offline."

