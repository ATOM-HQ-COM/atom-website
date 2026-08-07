#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Repo: $ROOT"
echo

echo "Auth gateway port 8789:"
if lsof -nP -iTCP:8789 -sTCP:LISTEN; then
  curl -fsS http://127.0.0.1:8789/health || true
  echo
else
  echo "not running"
fi
echo

echo "Static test server port 8000:"
lsof -nP -iTCP:8000 -sTCP:LISTEN || echo "not running"
echo

echo "Public HTTPS check:"
curl -fsS https://auth.atom-hq.com/health || echo "public check failed"

