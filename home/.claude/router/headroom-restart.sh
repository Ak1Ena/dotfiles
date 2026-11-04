#!/bin/bash
# Safe headroom restart. Works around headroom's stop race ("runtime identity changed"):
# kill the runner, wait until it is really gone, then start it again and wait for readyz.
set -u
P=~/.headroom/deploy/init-user/runner.pid
pid=$(cat "$P" 2>/dev/null || lsof -t -nP -iTCP:8787 -sTCP:LISTEN)
[ -n "$pid" ] && kill "$pid" 2>/dev/null
for i in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
kill -0 "$pid" 2>/dev/null && { kill -9 "$pid"; sleep 0.5; }
rm -f "$P"
headroom install start --profile init-user >/dev/null 2>&1
for i in $(seq 60); do curl -sf -m 1 http://127.0.0.1:8787/readyz >/dev/null && { echo "headroom up (pid $(cat $P 2>/dev/null))"; exit 0; }; sleep 1; done
echo "headroom did not come back; run: headroom install start --profile init-user"; exit 1
