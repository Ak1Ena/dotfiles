#!/bin/bash
# SessionStart hook: tell Claude whether it runs in team mode (via c-team) or solo.
# team lead  = launched by c-team (CLAUDE_MODE=team)
# teammate   = spawned by a lead (claude process has --team-name / --agent-id)
# solo       = anything else

cat >/dev/null # drain hook stdin

# Find the claude process args by walking up the process tree.
args="" pid=$PPID
for _ in 1 2 3 4 5 6; do
  [[ -z "$pid" || "$pid" -le 1 ]] && break
  comm=$(ps -o comm= -p "$pid" 2>/dev/null)
  if [[ "${comm##*/}" == claude ]]; then args=$(ps -o args= -p "$pid"); break; fi
  pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
done

tmux_info="not in tmux"
if [[ -n "$TMUX" ]]; then
  tmux_info="tmux session '$(tmux display -p '#S' 2>/dev/null)', pane $TMUX_PANE"
fi

if [[ "$args" == *--team-name* || "$args" == *--agent-id* ]]; then
  team=$(sed -nE 's/.*--team-name[ =]([^ ]+).*/\1/p' <<<"$args")
  agent=$(sed -nE 's/.*--agent-name[ =]([^ ]+).*/\1/p' <<<"$args")
  mode="TEAMMATE"
  msg="Session mode: TEAMMATE (agent '${agent:-?}' in team '${team:-?}'), $tmux_info. You are a team member, not the lead: do your assigned task and report back to the lead."
elif [[ "$CLAUDE_MODE" == "team" ]]; then
  mode="TEAM"
  msg="Session mode: TEAM LEAD (launched via c-team, teammateMode=tmux), $tmux_info. Agent teams are available: teammates open as tmux split panes. GUARDRAIL PROTOCOL for any code/config change: you are the main thread that talks to the user; do not edit code yourself. Spawn teammates 'builder' (agent builder, does the edits) and 'guardrail' (agent guardrail, read-only verifier) once and reuse them. Flow: brief builder (goal, files, check command) -> when builder reports done, send guardrail the repo path, base ref and goal -> on BLOCK send findings back to builder and repeat -> report to the user only after guardrail PASS, quoting its evidence. Questions, lookups and one-line config edits skip the protocol."
else
  mode="SOLO"
  msg="Session mode: SOLO (plain claude, not c-team), $tmux_info. No agent team configured for this session; prefer subagents over spawning teammates."
fi

# Tag the tmux pane so the status bar can show the mode.
[[ -n "$TMUX_PANE" ]] && tmux set -p -t "$TMUX_PANE" @claude_mode "$mode" 2>/dev/null

jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$m}}'
