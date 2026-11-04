#!/bin/bash
# UserPromptSubmit hook: classify prompt via decision model, inject routing advice.
# Fails open: any error/timeout => no output, prompt goes to main unchanged.
URL="${DECISION_ROUTER_URL:-https://archlinux.tail0703dd.ts.net/decision/d1-2b/v1/systemone}"
[ "${DECISION_ROUTER_OFF:-}" = 1 ] && exit 0

input=$(cat)
prompt=$(jq -r '.prompt // empty' <<<"$input")
transcript=$(jq -r '.transcript_path // empty' <<<"$input")
[ -n "${DECISION_ROUTER_DEBUG:-}" ] && jq -c '{keys:keys, prompt:(.prompt|.[0:100])}' <<<"$input" >> /tmp/decision-router-debug.log
# skip empty, slash commands, and tiny replies ("yes", "ok")
[ ${#prompt} -lt 12 ] && exit 0
case "$prompt" in /*) exit 0;; esac

# Opt-in (DECISION_ROUTER_IMAGES=1): pasted images ("[Image #N]") live as base64 blocks in the transcript's latest user entry.
# Full-size screenshots hang the model (>300s); downscaled to 512px JPEG 5 questions take ~56s.
# shortcut: max 2 images from transcript tail; raise if multi-image prompts matter.
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
echo '[]' > "$tmp/imgs.json"
timeout_s=${DECISION_ROUTER_TIMEOUT:-15}
if [[ "${DECISION_ROUTER_IMAGES:-0}" = 1 && "$prompt" == *"[Image #"* && -f "$transcript" ]]; then
  for _ in 1 2 3; do  # entry may land a moment after the hook starts
    tail -n 20 "$transcript" | jq -r -s '[.[] | select(.type=="user" and (.message.content|type)=="array")
      | .message.content | map(select(.type=="image" and .source.type=="base64") | .source.data)
      | select(length>0)] | last // [] | .[0:2] | .[]' > "$tmp/raw.txt" 2>/dev/null
    [ -s "$tmp/raw.txt" ] && break
    sleep 0.5
  done
  n=0
  while IFS= read -r b64; do
    n=$((n+1))
    printf '%s' "$b64" | base64 -d > "$tmp/in$n" 2>/dev/null &&
      sips -s format jpeg -s formatOptions 70 -Z "${DECISION_ROUTER_IMAGE_PX:-512}" "$tmp/in$n" --out "$tmp/out$n.jpg" >/dev/null 2>&1 &&
      printf 'data:image/jpeg;base64,%s\n' "$(base64 -i "$tmp/out$n.jpg")" >> "$tmp/urls.txt"
  done < "$tmp/raw.txt"
  if [ -s "$tmp/urls.txt" ]; then
    jq -R -s 'split("\n") | map(select(length>0))' "$tmp/urls.txt" > "$tmp/imgs.json"
    timeout_s=${DECISION_ROUTER_IMAGE_TIMEOUT:-90}
  fi
fi

body=$(jq -n --arg s "${prompt:0:4000}" --slurpfile imgs "$tmp/imgs.json" '{
  state: $s,
  images: $imgs[0],
  questions: {
    route: {type:"choice", instructions:"Should the main assistant handle this itself, or hand it to a subagent?",
      criteria:{main:"needs conversation context, design decisions, hard debugging, or is a quick question",
                subagent:"self-contained task: lookup, search, research, mechanical edit, test run, review"}},
    subagent: {type:"choice", instructions:"Which subagent fits best?",
      criteria:{scout:"find files, where is X, what calls Y, grep",
                researcher:"web or library docs research",
                builder:"normal code edit or tests across a few files",
                reviewer:"review a diff or PR",
                "gpt-terra":"second-opinion edit or review",
                "gemini-flash":"large read-only codebase summary"}},
    model: {type:"choice", instructions:"Which model is needed?",
      criteria:{haiku:"trivial lookup", sonnet:"normal work", opus:"hard reasoning or design"}},
    provider: {type:"choice", instructions:"Which provider?",
      criteria:{anthropic:"default", openai:"second opinion from GPT", google:"large context summary with Gemini"}},
    effort: {type:"choice", instructions:"How much reasoning effort?",
      criteria:{low:"simple", medium:"moderate", high:"complex multi-step"}}
  }}')

resp=$(curl -s -m "$timeout_s" -X POST "$URL" -H 'Content-Type: application/json' --data-binary @- <<<"$body") || exit 0
echo "$resp" | jq -e '.answers.route.choice' >/dev/null 2>&1 || exit 0

echo "$resp" | jq -c '.answers as $a |
  ($a.route.choice) as $r |
  "[decision-router] route=\($r) (conf \($a.route.confidence*100|floor)%)" +
  (if $r == "subagent" then " subagent=\($a.subagent.choice)" else "" end) +
  " model=\($a.model.choice) provider=\($a.provider.choice) effort=\($a.effort.choice)." +
  (if $r == "subagent"
   then " Advice: delegate via Agent tool (subagent_type=\($a.subagent.choice), model=\($a.model.choice)) unless the task clearly needs this conversation context; low confidence = use own judgment."
   else " Advice: handle in main thread." end) |
  {hookSpecificOutput:{hookEventName:"UserPromptSubmit", additionalContext:.}, systemMessage:.}'
