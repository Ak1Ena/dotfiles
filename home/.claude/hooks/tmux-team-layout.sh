#!/bin/bash
# Team-mode tmux view: keep the lead (pane tagged @claude_mode=TEAM) full screen.
# Usage: tmux-team-layout.sh <window_id> [zoom|lead|menu]
#   zoom (default) - called by tmux hooks after a split/kill: wait for Claude Code's
#                    own rebalance, then size the lead to 50% and zoom it.
#   lead           - prefix 0: jump back to the lead, full screen.
#   menu           - prefix a: pick an agent by name, full screen.
win=$1 action=${2:-zoom}
[[ -n "$win" ]] || exit 0

lead_pane() { tmux list-panes -t "$win" -F '#{pane_id} #{@claude_mode}' 2>/dev/null | awk '$2=="TEAM"{print $1; exit}'; }
focus() { tmux select-pane -Z -t "$1" \; if -F -t "$1" '#{window_zoomed_flag}' '' "resize-pane -Z -t $1"; }

case $action in
  zoom)
    # Claude Code runs select-layout + resize-pane right after its split; those unzoom.
    sleep 1
    lead=$(lead_pane); [[ -n "$lead" ]] || exit 0
    tmux set -p -t "$lead" pane-border-format '#[fg=green,bold] ● LEAD #[default]'
    [[ $(tmux display -p -t "$win" '#{window_panes}') -gt 1 ]] || exit 0
    tmux resize-pane -t "$lead" -x 50%
    focus "$lead"
    ;;
  lead)
    lead=$(lead_pane); [[ -n "$lead" ]] && focus "$lead"
    ;;
  menu)
    args=() i=0
    while read -r id mode name; do
      [[ $mode == TEAM ]] && name=lead
      [[ -n "$name" ]] || continue
      args+=("$name" "$i" "select-pane -Z -t $id ; if -F '#{window_zoomed_flag}' '' 'resize-pane -Z -t $id'")
      ((i++))
    done < <(tmux list-panes -t "$win" -F '#{pane_id} #{@claude_mode} #{@agent_name}')
    [[ ${#args[@]} -gt 0 ]] && tmux display-menu -T 'Switch to agent' -x R -y S "${args[@]}" '' 'all side by side' z 'resize-pane -Z'
    ;;
esac
