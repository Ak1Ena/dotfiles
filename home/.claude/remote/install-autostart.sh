#!/bin/bash
# Start Claude Remote at login (Tailscale IP only). Undo: launchctl bootout gui/$(id -u)/com.m129.claude-remote
P=~/Library/LaunchAgents/com.m129.claude-remote.plist
cat > $P <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>com.m129.claude-remote</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/python3</string><string>$HOME/.claude/remote/server.py</string></array>
<key>EnvironmentVariables</key><dict><key>RC_HOST</key><string>TAILSCALE_IP</string><key>RC_PORT</key><string>8800</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME/.claude/remote/server.log</string><key>StandardErrorPath</key><string>$HOME/.claude/remote/server.log</string>
</dict></plist>
PL
kill $(lsof -t -nP -iTCP:8800 -sTCP:LISTEN) 2>/dev/null; sleep 1
launchctl bootout gui/$(id -u)/com.m129.claude-remote 2>/dev/null; launchctl bootstrap gui/$(id -u) $P && sleep 2 && lsof -nP -iTCP:8800 -sTCP:LISTEN >/dev/null && echo "autostart OK"
