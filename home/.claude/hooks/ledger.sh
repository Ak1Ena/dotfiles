#!/bin/bash
# Shared findings ledger: one file per session, so subagents reuse each other's reads.
# SessionStart: tells main thread the path. SubagentStart: injects protocol + ledger tail.
input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input")
sid=$(jq -r '.session_id // "nosession"' <<<"$input")

# Teammates (claude --team-name X) and their subagents share the team lead's ledger.
args="" pid=$PPID
for _ in 1 2 3 4 5 6; do
  [[ -z "$pid" || "$pid" -le 1 ]] && break
  comm=$(ps -o comm= -p "$pid" 2>/dev/null)
  if [[ "${comm##*/}" == claude ]]; then args=$(ps -o args= -p "$pid"); break; fi
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
done
team=$(sed -nE 's/.*--team-name[ =]([^ ]+).*/\1/p' <<<"$args")
if [[ -n "$team" ]]; then
  lead=$(jq -r '.leadSessionId // empty' "$HOME/.claude/teams/$team/config.json" 2>/dev/null)
  [[ -n "$lead" ]] && sid=$lead
fi

dir="$HOME/.claude/work/$sid"; ledger="$dir/ledger.md"
mkdir -p "$dir"; touch "$ledger"
# drop ledgers older than 7 days
find "$HOME/.claude/work" -mindepth 1 -maxdepth 1 -type d -mtime +7 -exec rm -rf {} + 2>/dev/null

proto="Shared ledger: $ledger
- Before reading a file, check the ledger below. If a fact you need is there, use it; re-read only if you will edit that file or the entry says the file changed.
- Before you finish, append what you learned that another agent would otherwise re-read (max 10 lines, one fact per line):
  cat >> $ledger <<'L'
  [<agent-type>] path:line — fact
  L
- Do not copy file contents into the ledger; facts and locations only."

if [[ "$event" == "SubagentStart" || -n "$team" ]]; then
  body=$(tail -c 7000 "$ledger")
  ctx="$proto"$'\n\nLedger so far:\n'"${body:-(empty)}"
else
  ctx="Shared ledger for this session: $ledger. Subagents and teammates get it injected automatically and append findings. Read it (cat) before re-investigating something a subagent already covered; append decisions subagents need as '[main] fact' lines."
fi
jq -n --arg e "$event" --arg c "$ctx" '{hookSpecificOutput:{hookEventName:$e,additionalContext:$c}}'
