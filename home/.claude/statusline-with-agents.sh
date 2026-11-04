#!/bin/bash
# Status line: the existing usage line, plus the models of subagents active in this session.
input=$(cat)
printf '%s' "$input" | bash /Users/m129/code/KP-POC/scripts/claude-usage/statusline-usage.sh

sid=$(printf '%s' "$input" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')
[ -z "$sid" ] && exit 0
# shortcut: "active" = transcript written in the last 3 min; there is no running flag to read.
models=$(find /private/tmp/claude-$(id -u)/*/"$sid"/tasks -name 'a*.output' -mmin -3 2>/dev/null |
  while read -r f; do grep -o '"model":"claude-[a-z]*' "$f" | tail -1 | sed 's/.*claude-//'; done |
  sort | uniq -c | awk '{printf "%s%s×%s", (NR>1?" ":""), $2, $1}')
[ -n "$models" ] && printf ' | agents: %s' "$models"
exit 0
