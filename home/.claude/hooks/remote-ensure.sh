#!/bin/zsh
# SessionStart: make sure the remote UI (launchd server.py) and nginx :80 proxy are up. Silent, never blocks.
curl -sf -m 1 -o /dev/null http://TAILSCALE_IP:8800/ || launchctl kickstart -k gui/$(id -u)/com.m129.claude-remote >/dev/null 2>&1 \
  || launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.m129.claude-remote.plist >/dev/null 2>&1
curl -sf -m 1 -o /dev/null http://TAILSCALE_IP/ || /opt/homebrew/bin/brew services start nginx >/dev/null 2>&1
exit 0
