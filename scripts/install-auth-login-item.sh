#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.atom.local-auth.plist"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$ROOT/local-auth-server/data"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.atom.local-auth</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd "$ROOT" &amp;&amp; npm run auth:start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StandardOutPath</key>
  <string>$ROOT/local-auth-server/auth.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/local-auth-server/auth.err.log</string>
</dict>
</plist>
PLIST

chmod 600 "$PLIST"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.atom.local-auth"

echo "Installed login item: $PLIST"
echo "This restarts the Node auth gateway after login. Caddy may still need npm run public:start after a full reboot."

