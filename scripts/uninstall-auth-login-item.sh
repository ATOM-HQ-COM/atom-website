#!/usr/bin/env bash
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.atom.local-auth.plist"

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
if [ -f "$PLIST" ]; then
  rm "$PLIST"
fi

echo "Removed Atom local auth login item."

