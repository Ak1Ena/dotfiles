---
name: gh-pr-checks-wait
description: Use when polling GitHub PR checks from zsh on macOS.
category: git-workflow
---

# Waiting on PR checks from zsh

Poll GitHub check state with a bounded counter loop, and read check names from the PR rollup, not from workflow names.

- macOS has no `timeout` binary. `timeout 100 bash -c '...'` fails with `command not found: timeout`. Use `for i in $(seq 1 25); do ...; sleep 4; done` instead.
- Read state with `gh pr view N --json mergeStateStatus,statusCheckRollup --jq '...'`. Rollup entries are check names (`build`, `credentials-check`). `gh run list --workflow` takes the workflow file name, so a guessed name returns `could not find any workflows`.
- `UNKNOWN` right after a push means checks have not started. Keep polling. Do not report failure.
- zsh does not word-split an unquoted `$var`. `for d in "a b"; do set -- $d` leaves one argument, so `git -C` fails with `cannot change to`. Write each path and branch as its own explicit command.
- Get worktree paths from `git worktree list`, never by building them from branch names.
- Run one command per step and check each exit before the next. A long chained loop that mixes `git commit`, `git push` and `gh` breaks on zsh quoting and hides which step failed.
