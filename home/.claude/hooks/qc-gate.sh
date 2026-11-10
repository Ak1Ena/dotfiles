#!/bin/bash
# QC gate: Claude may not finish a turn with an unreviewed code change.
#   qc-gate.sh baseline  SessionStart: snapshot the cwd repo before Claude works
#   qc-gate.sh track     PreToolUse Edit|Write|MultiEdit|NotebookEdit: snapshot a repo before its first edit
#   qc-gate.sh mark      SubagentStop: reviewer ran / guardrail PASS on the current change
#   qc-gate.sh status    read-only: JSON array per tracked repo {repo,lines,reviewed,passed,blocks,needs_gate}
#   qc-gate.sh gate      Stop: block until reviewer ran and guardrail PASSed on the current change
# "Change" = working tree vs the session-start snapshot, so commits do not hide work and
# pre-existing WIP does not count. Changes under QC_MIN_LINES code lines skip the gate.
# shortcut: Bash-only edits count only in repos with a snapshot (the start repo or one edited
# with Edit/Write); upgrade to a PreToolUse Bash snapshot if that misses real work.
# Test: ~/.claude/hooks/qc-gate.test.sh
command -v jq >/dev/null || exit 0
QC_MIN_LINES=${QC_MIN_LINES:-10}
QC_MAX_BLOCKS=${QC_MAX_BLOCKS:-3}    # blocks per identical change before letting go (loop guard)
QC_MAX_FILE=${QC_MAX_FILE:-1048576}  # untracked files above this size are data, not code
QC_TEAMS_DIR=${QC_TEAMS_DIR:-$HOME/.claude/teams}
EXCL=(':(exclude)*.md' ':(exclude)*.mdx' ':(exclude)*.txt' ':(exclude)*.rst'
      ':(exclude)*.lock' ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock')
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904

input=$(cat)
mode=$1
sid=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
[[ -n $sid ]] || exit 0
state="$HOME/.claude/work/$sid/qc"
[[ $mode == status ]] || mkdir -p "$state"  # status is read-only: no state dir created
export GIT_OPTIONAL_LOCKS=0  # polling must never take .git/index.lock

key() { printf %s "$1" | shasum | cut -c1-12; }
toplevel() { git -C "$1" rev-parse --show-toplevel 2>/dev/null; }

untracked() {  # "<blob> <path>" for untracked small text files (no nested repos, binaries, data)
  git ls-files -o --exclude-standard -z -- . "${EXCL[@]}" | while IFS= read -r -d '' f; do
    [[ -f $f && $(wc -c <"$f") -le $QC_MAX_FILE ]] || continue
    [[ $(git diff --no-index --numstat /dev/null "$f" 2>/dev/null | cut -f1) == - ]] && continue
    echo "$(git hash-object -- "$f") $f"
  done
}

snapshot() {  # baseline: commit holding the working tree now, plus the untracked files
  local r=$1 k; k=$(key "$r")
  [[ -f $state/$k.base ]] && return
  ( cd "$r" || exit
    b=$(git stash create 2>/dev/null); [[ -n $b ]] || b=$(git rev-parse -q --verify HEAD) || b=$EMPTY_TREE
    echo "$b" >"$state/$k.base"
    untracked | sort >"$state/$k.untracked"
  )
  grep -qxF "$r" "$state/repos" 2>/dev/null || echo "$r" >>"$state/repos"
}

measure() {  # prints "<hash> <changed code lines>" for the change since the snapshot
  local r=$1 k; k=$(key "$r")
  ( cd "$r" || { echo "gone 0"; exit; }
    b=$(cat "$state/$k.base")
    new=$(untracked | sort | comm -13 "$state/$k.untracked" -)  # new or edited untracked files
    t=$(git diff "$b" --numstat -- . "${EXCL[@]}" | awk '$1!="-"{n+=$1+$2} END{print n+0}')
    u=0; while read -r _ f; do [[ -n $f ]] && u=$((u + $(wc -l <"$f"))); done <<<"$new"
    # hash path+content, not diff text: committing a new file must not look like a new change
    files=()
    # tracked side uses the same filter as untracked() (EXCL, binary, size) so a commit moves files across unchanged
    while IFS= read -r -d '' f; do [[ -n $f ]] && files+=("$f"); done < <(
      { git diff "$b" --numstat --no-renames -z -- . "${EXCL[@]}" | while IFS= read -r -d '' rec; do
          [[ ${rec%%$'\t'*} == - ]] && continue
          f=${rec#*$'\t'}; f=${f#*$'\t'}
          [[ -f $f && $(wc -c <"$f") -gt $QC_MAX_FILE ]] && continue
          printf '%s\0' "$f"
        done
        [[ -n $new ]] && cut -d' ' -f2- <<<"$new" | tr '\n' '\0'; } | sort -zu)
    h=$( { printf '%s\n' "${files[@]}"
           for f in "${files[@]}"; do [[ -f $f ]] && printf '%s\n' "$f"; done | git hash-object --stdin-paths
         } | shasum | cut -c1-16)
    echo "$h $((t + u))"
  )
}

repos() { cat "$state/repos" 2>/dev/null; }

is_teammate() {  # teammates are verified by their lead's guardrail
  local pid=$PPID a
  for _ in 1 2 3 4 5 6; do
    [[ -z $pid || $pid -le 1 ]] && return 1
    a=$(ps -o args= -p "$pid" 2>/dev/null)
    [[ $a == *--agent-id* ]] && return 0
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
  return 1
}

teammate_busy() {  # lead stops while a teammate still works: its edits are mid-flight, gate later
  # Live teammate processes name their lead via --parent-session-id (survives --continue, unlike the
  # config's leadSessionId); only they count, so a crashed teammate's stale isActive=true cannot disable the gate.
  local team name
  while read -r team name; do
    jq -e --arg n "$name" 'any(.members[]?; .name == $n and .isActive == true)' \
      "$QC_TEAMS_DIR/$team/config.json" >/dev/null 2>&1 && return 0
  done < <(${QC_PS:-ps -ax -o args=} 2>/dev/null | awk -v s="$sid" '
    { t = n = p = ""
      for (i = 1; i < NF; i++) {
        if ($i == "--team-name") t = $(i+1); if ($i == "--agent-name") n = $(i+1); if ($i == "--parent-session-id") p = $(i+1)
      }
      if (p == s && t != "" && n != "") print t, n }')
  return 1
}

case $mode in
baseline)
  r=$(toplevel "$cwd") && snapshot "$r"
  ;;

track)
  p=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
  [[ -n $p ]] || exit 0
  [[ $p == /* ]] || p="$cwd/$p"
  d=$(dirname "$p"); while [[ ! -d $d ]]; do d=$(dirname "$d"); done  # Write may create dirs
  r=$(toplevel "$d") && snapshot "$r"
  ;;

mark)
  agent=$(jq -r '.agent_type // empty' <<<"$input"); agent=${agent##*:}
  [[ $agent == reviewer || $agent == guardrail ]] || exit 0
  msg=$(jq -r '.last_assistant_message // empty' <<<"$input")
  # Agents that end with a SubagentHandback tool call leave no final text: read the report from the transcript.
  tp=$(jq -r '.agent_transcript_path // empty' <<<"$input")
  if [[ -f $tp ]]; then  # the handback is the final word: it wins over earlier text; bad lines are skipped
    hb=$(jq -nr '[inputs | fromjson? | select(type=="object" and .type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="SubagentHandback") | .input.message // empty] | last // empty' -R "$tp" 2>/dev/null)
    [[ -n $hb ]] && msg=$hb
  fi
  dirty=() named=()
  while read -r r; do
    [[ -d $r ]] || continue
    read -r h n < <(measure "$r")
    (( n > 0 )) || continue
    dirty+=("$r|$h|$n")
    [[ $msg == *"$r"* || $msg == *"$(basename "$r")"* ]] && named+=("$r|$h|$n")
  done < <(repos)
  (( ${#named[@]} )) && dirty=("${named[@]}")  # several dirty repos: credit the ones the agent named
  for e in "${dirty[@]}"; do
    IFS='|' read -r r h n <<<"$e"; k=$(key "$r")
    if [[ $agent == reviewer ]]; then
      echo "$n" >"$state/$k.reviewer"
    elif grep -qE '^[[:space:]>#*`]*VERDICT:[*` ]*PASS[*` .]*$' <<<"$msg"; then
      echo "$h" >"$state/$k.pass"
    else
      rm -f "$state/$k.pass"
    fi
  done
  ;;

status)  # read-only: feeds the workflow mod
  while read -r r; do
    [[ -d $r ]] || continue
    k=$(key "$r"); read -r h n < <(measure "$r")
    rv=$(cat "$state/$k.reviewer" 2>/dev/null || echo 0)
    ok=false; [[ $(cat "$state/$k.pass" 2>/dev/null) == "$h" ]] && ok=true
    jq -nc --arg r "$r" --argjson n "${n:-0}" --argjson rv "$rv" --argjson ok "$ok" \
      --argjson b "$(cat "$state/$k.blocks.$h" 2>/dev/null || echo 0)" --argjson min "$QC_MIN_LINES" \
      '{repo:$r,lines:$n,reviewed:$rv,passed:$ok,blocks:$b,needs_gate:($n >= $min and ($rv == 0 or $n > 2*$rv or ($ok|not)))}'
  done < <(repos) | jq -sc .
  ;;

gate)
  is_teammate && exit 0
  teammate_busy && exit 0
  problems="" notes=""
  while read -r r; do
    [[ -d $r ]] || continue
    k=$(key "$r")
    read -r h n < <(measure "$r")
    (( ${n:-0} < QC_MIN_LINES )) && continue
    missing=()
    reviewed=$(cat "$state/$k.reviewer" 2>/dev/null || echo 0)
    (( reviewed > 0 )) || missing+=("reviewer has not run")
    (( reviewed > 0 && n > 2 * reviewed )) && missing+=("change grew from $reviewed to $n lines since reviewer ran")
    [[ $(cat "$state/$k.pass" 2>/dev/null) == "$h" ]] || missing+=("no guardrail PASS on the current change")
    (( ${#missing[@]} )) || continue
    b="$state/$k.blocks.$h"
    c=$(( $(cat "$b" 2>/dev/null || echo 0) + 1 ))
    if (( c > QC_MAX_BLOCKS )); then
      notes+="QC gate gave up on $r after $QC_MAX_BLOCKS blocks: change is NOT verified. "
      continue
    fi
    echo $c >"$b"
    problems+="- $r ($n changed lines): $(IFS=';'; echo "${missing[*]}")"$'\n'
  done < <(repos)
  if [[ -z $problems ]]; then
    [[ -n $notes ]] && jq -n --arg m "$notes" '{systemMessage:$m}'
    exit 0
  fi
  # Short on purpose: the user sees this on every block; one self-contained line.
  reason="QC gate: spawn reviewer (repo path + base ref only) + guardrail in one message, fix bug/risk findings (nits optional), re-run guardrail to VERDICT: PASS, then report (user said skip review: say so, stop).
${problems%$'\n'}"
  jq -n --arg r "$reason" --arg m "$notes" '{decision:"block", reason:$r} + (if $m != "" then {systemMessage:$m} else {} end)'
  ;;
esac
exit 0
