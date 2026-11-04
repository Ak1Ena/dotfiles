#!/usr/bin/env bash
# SessionStart hook: warn when any of my open PRs has "changes requested".
# Silent when none found or gh is offline/unauthenticated.

prs=$(gh search prs --author=@me --state=open --review=changes_requested \
  --json repository,number,title,url --limit 50 2>/dev/null) || exit 0

count=$(jq 'length' <<<"$prs" 2>/dev/null)
[ -z "$count" ] || [ "$count" -eq 0 ] && exit 0

list=$(jq -r '.[] | "- \(.repository.nameWithOwner)#\(.number): \(.title) — \(.url)"' <<<"$prs")
msg="⚠️ $count open PR(s) with changes requested:
$list"

jq -n --arg msg "$msg" '{
  systemMessage: $msg,
  hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: $msg }
}'
