#!/bin/bash
# Self-check for qc-gate.sh: simulated hook events against throwaway repos.
# Run: bash ~/.claude/hooks/qc-gate.test.sh   (prints PASS/FAIL per case, exits 1 on any FAIL)
H="$HOME/.claude/hooks/qc-gate.sh"
T=$(mktemp -d "${TMPDIR:-/tmp}/qcgate.XXXXXX")
fails=0 n=0
g() { git -c user.email=t@t -c user.name=t "$@"; }
newrepo() { mkdir -p "$1" && (cd "$1" && git init -q && seq 1 5 >a.js && git add . && g commit -qm init); }
ev() {  # ev <sid> <cwd> <mode> [extra-json]
  local x=${4:-"{}"}
  jq -nc --arg s "$1" --arg c "$2" "{session_id:\$s,cwd:\$c} + $x" | "$H" "$3"
}
check() {  # check <name> <expected: block|allow> <gate output>
  n=$((n + 1))
  got=allow; [[ $(jq -r '.decision // empty' <<<"$3" 2>/dev/null) == block ]] && got=block
  if [[ $got == "$2" ]]; then echo "PASS $1"; else echo "FAIL $1: want $2, got $got"; fails=$((fails + 1)); fi
}
track() { ev "$1" "$2" track "{tool_input:{file_path:\"$3\"}}"; }
pass_msg='{agent_type:"guardrail",last_assistant_message:"VERDICT: PASS\ngoal: met"}'

# 1. clean, small, big, reviewer + PASS, edit after PASS
R=$T/r1; newrepo "$R"; S=t1-$$
ev $S "$R" baseline
check "clean repo allows" allow "$(ev $S "$R" gate)"
seq 1 3 >>"$R/a.js"
check "3-line change allows" allow "$(ev $S "$R" gate)"
track $S "$R" "$R/b.js"; seq 1 20 >"$R/b.js"; echo "# doc" >"$R/README.md"
check "20-line change blocks" block "$(ev $S "$R" gate)"
ev $S "$R" mark '{agent_type:"reviewer",last_assistant_message:"No findings."}'
ev $S "$R" mark "$pass_msg"
check "reviewer + PASS allows" allow "$(ev $S "$R" gate)"
echo x >>"$R/b.js"
check "edit after PASS blocks" block "$(ev $S "$R" gate)"

# 2. commit does not bypass
R=$T/r2; newrepo "$R"; S=t2-$$
ev $S "$R" baseline; seq 1 20 >>"$R/a.js"; (cd "$R" && g commit -qam wip)
check "committed unreviewed change blocks" block "$(ev $S "$R" gate)"

# 3. template line is not a PASS
R=$T/r3; newrepo "$R"; S=t3-$$
ev $S "$R" baseline; seq 1 20 >>"$R/a.js"
ev $S "$R" mark '{agent_type:"reviewer"}'
ev $S "$R" mark '{agent_type:"guardrail",last_assistant_message:"VERDICT: PASS | BLOCK\ngoal: not met"}'
check "template VERDICT line is not PASS" block "$(ev $S "$R" gate)"
ev $S "$R" mark '{agent_type:"guardrail",last_assistant_message:"```\n**VERDICT: PASS**\n```"}'
check "bold/fenced PASS counts" allow "$(ev $S "$R" gate)"

# 4. pre-existing WIP does not count, only Claude's delta
R=$T/r4; newrepo "$R"; S=t4-$$
seq 1 40 >>"$R/a.js"; seq 1 30 >"$R/wip.js"
ev $S "$R" baseline; echo one >>"$R/a.js"
check "1-line edit in dirty repo allows" allow "$(ev $S "$R" gate)"

# 5. cwd drift into another dirty repo without edits
R=$T/r5; newrepo "$R"; S=t5-$$; D=$T/r5b; newrepo "$D"; seq 1 40 >>"$D/a.js"
ev $S "$R" baseline
check "Q&A in other dirty repo allows" allow "$(ev $S "$D" gate)"

# 6. nested repo in untracked list does not hide untracked edits
R=$T/r6; newrepo "$R"; S=t6-$$; newrepo "$R/inner"; seq 1 3 >"$R/zzz.py"
ev $S "$R" baseline; seq 1 20 >>"$R/zzz.py"
check "untracked edit next to nested repo blocks" block "$(ev $S "$R" gate)"

# 7. big untracked data file is not code
R=$T/r7; newrepo "$R"; S=t7-$$
ev $S "$R" baseline; head -c 2000000 /dev/urandom >"$R/dump.bin"; seq 1 300000 >"$R/data.csv"
check "untracked binary/large files allow" allow "$(ev $S "$R" gate)"

# 8. PASS on repo A does not pass repo B; give-up on B keeps A's block
A=$T/r8a; B=$T/r8b; newrepo "$A"; newrepo "$B"; S=t8-$$
ev $S "$A" baseline; track $S "$A" "$B/a.js"
seq 1 20 >>"$A/a.js"; seq 1 20 >>"$B/a.js"
ev $S "$A" mark "{agent_type:\"reviewer\",last_assistant_message:\"reviewed $A\"}"
ev $S "$A" mark "{agent_type:\"guardrail\",last_assistant_message:\"repo $A\nVERDICT: PASS\"}"
out=$(ev $S "$A" gate)
check "PASS naming A leaves B blocked" block "$out"
[[ $out == *r8b* && $out != *"$A ("* ]] && echo "PASS only B listed" || { echo "FAIL only B listed: $out"; fails=$((fails+1)); }
for _ in 1 2 3; do ev $S "$A" gate >/dev/null; done
out=$(ev $S "$A" gate)
[[ $(jq -r .systemMessage <<<"$out") == *"gave up"* ]] && echo "PASS give-up warns" || { echo "FAIL give-up warns: $out"; fails=$((fails+1)); }

# 9. reviewer must cover most of the change
R=$T/r9; newrepo "$R"; S=t9-$$
ev $S "$R" baseline; seq 1 20 >>"$R/a.js"
ev $S "$R" mark '{agent_type:"reviewer"}'; seq 1 500 >>"$R/a.js"; ev $S "$R" mark "$pass_msg"
check "reviewer stale after change grows 25x" block "$(ev $S "$R" gate)"

# 10. bad input never writes state
echo "not json" | "$H" gate; [[ ! -d $HOME/.claude/work/qc ]] && echo "PASS bad stdin ignored" || { echo "FAIL bad stdin wrote ~/.claude/work/qc"; fails=$((fails+1)); }

# 11. repo with no commits
R=$T/r11; mkdir -p "$R"; (cd "$R" && git init -q); S=t11-$$
ev $S "$R" baseline; seq 1 30 >"$R/new.js"
check "no-commit repo blocks" block "$(ev $S "$R" gate)"

echo "$fails failed (temp: $T)"
for s in t1 t2 t3 t4 t5 t6 t7 t8 t9 t11; do d="$HOME/.claude/work/$s-$$"; [[ -d $d ]] && mv "$d" "$T/state-$s"; done
exit $((fails > 0))
