#!/bin/bash
# Undo router setup: headroom -> api.anthropic.com, Claude -> ANTHROPIC_BASE_URL=8787.
cp /Users/m129/.claude/backups/2026-10-31-optimize/headroom-manifest.json ~/.headroom/deploy/init-user/manifest.json
cp /Users/m129/.claude/backups/2026-10-31-optimize/settings.pre-router.json ~/.claude/settings.json
headroom install restart --profile init-user >/dev/null 2>&1
launchctl bootout gui/$(id -u)/com.m129.claude-router 2>/dev/null
rm -f ~/Library/LaunchAgents/com.m129.claude-router.plist
echo "rolled back; open new Claude sessions"
