#!/bin/bash
# QC gate: Claude may not finish a turn with an unreviewed code change.
#   qc-gate.sh baseline  SessionStart: snapshot the cwd repo before Claude works
#   qc-gate.sh track     PreToolUse Edit|Write|MultiEdit|NotebookEdit: snapshot a repo before its first edit
#   qc-gate.sh mark      SubagentStop: reviewer ran / guardrail PASS on the current change
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
EXCL=(':(exclude)*.md' ':(exclude)*.mdx' ':(exclude)*.txt' ':(exclude)*.rst'
      ':(exclude)*.lock' ':(exclude)package-lock.json' ':(exclude)pnpm-lock.yaml' ':(exclude)yarn.lock')
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904

input=$(cat)
mode=$1
sid=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null)
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null)
[[ -n $sid ]] || exit 0
state="$HOME/.claude/work/$sid/qc"
mkdir -p "$state"

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
    h=$( { git diff "$b" --binary; echo "$new"; } | shasum | cut -c1-16)
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

gate)
  is_teammate && exit 0
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
  reason="QC gate: code changed but quality check is not done.
$problems
Do this before finishing:
1. Spawn \`reviewer\` (repo path + base ref only, not your conclusions) and \`guardrail\` (repo path, base ref, the goal) in ONE message so they run in parallel.
2. Fix every confirmed bug/risk finding. Nits are optional.
3. If you changed code after guardrail ran, run \`guardrail\` again until it returns VERDICT: PASS.
4. Then report: what changed, how it was verified, what was skipped.
If the user explicitly said to skip review, tell them the gate fired and stop."
  jq -n --arg r "$reason" --arg m "$notes" '{decision:"block", reason:$r} + (if $m != "" then {systemMessage:$m} else {} end)'
  ;;
esac
exit 0
