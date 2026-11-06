#!/bin/bash
# PreToolUse(Bash): AI reaches kubectl/argocd/tenant-config only through ~/.claude/bin/ro (read-only allowlist).
# Blocks raw calls, wrapped calls (env/xargs/sh -c/python -c), and writes to the guardrail files. Fails closed.
cmd=$(jq -r '.tool_input.command // empty')
block() { echo "BLOCKED by readonly-infra hook: $1. Use ~/.claude/bin/ro (read-only)." >&2; exit 2; }
tools='kubectl|argocd|tenant-config'
guard='readonly-infra|\.claude/bin/ro([^[:alnum:]_-]|$)'

# command substitution can hide a second command inside an allowed one
if grep -Eq "$tools|$guard" <<<"$cmd" && grep -Eq '\$\(|`|<\(' <<<"$cmd"; then
  block "command substitution next to kubectl/argocd/tenant-config"
fi
# interpreters/eval can run a quoted string the segment splitter cannot see into
if grep -Eq "$tools" <<<"$cmd" && grep -Eq '(^|[^[:alnum:]_.-])(python[0-9.]*|node|perl|ruby|osascript|eval|sh|bash|zsh|dash|fish)([[:space:]]|$)' <<<"$cmd"; then
  block "interpreter/eval next to kubectl/argocd/tenant-config"
fi

while IFS= read -r seg; do
  seg=$(sed -E 's/^[[:space:]({!]+//' <<<"$seg")
  [ -z "$seg" ] && continue
  first=${seg%%[[:space:]]*}; first=${first//[\"\'\\]/}
  if [[ "$first" == "/Users/m129/.claude/bin/ro" || "$first" == "~/.claude/bin/ro" || "$first" == '$HOME/.claude/bin/ro' ]]; then
    grep -Eq '>' <<<"$seg" && grep -Eq "$guard" <<<"$seg" && block "redirect onto guardrail file"
    continue
  fi
  base=${first##*/}
  [[ "$base" =~ ^(kubectl|argocd)$ ]] && block "raw $base"
  if grep -Eq "$tools" <<<"$seg"; then
    [[ "$base" =~ ^(env|xargs|sudo|exec|command|builtin|nohup|time|watch|eval|nice|timeout|gtimeout|sh|bash|zsh|dash|fish|source|\.|python|python3|node|perl|ruby|osascript)$ ]] && block "kubectl/argocd/tenant-config via $base"
    [[ "$base" =~ ^(curl|wget|http|https|xh|httpie|nc)$ ]] && grep -q 'tenant-config' <<<"$seg" && block "direct HTTP to tenant-config"
  fi
  if grep -Eq "$guard" <<<"$seg" && grep -Eq '>|(^|[[:space:]])(rm|mv|cp|ln|chmod|chown|tee|truncate|install|dd)([[:space:]]|$)|sed[[:space:]].*-i|perl[[:space:]].*-i' <<<"$seg"; then
    block "write to guardrail file"
  fi
done < <(sed -E 's/(\|\||&&|[;|&])/\n/g' <<<"$cmd")
exit 0
