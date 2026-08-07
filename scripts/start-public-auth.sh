#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Starting Atom public auth from: $ROOT"

npm run auth:init
npm run auth:mode:prod
mkdir -p local-auth-server/data
chmod 700 local-auth-server/data
chmod 600 local-auth-server/.env
if ls local-auth-server/data/atom-auth.sqlite* >/dev/null 2>&1; then
  chmod 600 local-auth-server/data/atom-auth.sqlite*
fi

if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy is not installed. Installing with Homebrew..."
  brew install caddy
fi

if lsof -nP -iTCP:8789 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Auth gateway is already listening on port 8789."
else
  echo "Starting auth gateway on port 8789..."
  nohup npm run auth:start > local-auth-server/auth.log 2>&1 &
  sleep 2
fi

curl -fsS http://127.0.0.1:8789/health >/dev/null
echo "Local auth health check passed."

if sudo caddy reload --config "$ROOT/local-auth-server/Caddyfile.example" >/dev/null 2>&1; then
  echo "Caddy reloaded."
else
  echo "Starting Caddy for https://auth.atom-hq.com ..."
  sudo caddy start --config "$ROOT/local-auth-server/Caddyfile.example"
fi

echo "Public auth launch attempted."
echo "Test locally: curl http://127.0.0.1:8789/health"
echo "Test publicly after DNS and port forwarding: curl https://auth.atom-hq.com/health"

