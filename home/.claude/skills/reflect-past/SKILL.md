---
name: reflect-past
description: Use when the user asks to learn from past sessions or PRs, "reflect on our past", "what keeps going wrong", a retro, or /reflect-past. Mines all recent transcripts plus review comments on the user's own PRs, finds recurring failures, and turns each into a rule, hook, or skill edit.
---
# Reflect on the past

Cross-session retro. `pstack:reflect` covers only the current chat; this covers the last N days of every project plus PR review feedback.

## 1. Mine (scripts, not by hand)

```bash
S=<session scratchpad>/reflect          # private chat text: never write it into a repo
D=~/.claude/skills/reflect-past/scripts
python3 $D/mine.py --days 30 --out $S --exclude-session <this session id>
python3 $D/prs.py  --days 30 --out $S   # needs `gh` auth; skip if offline
```

- `summary.md`: counts, per-project friction, top tool-error classes, hook blocks, slash commands.
- `events.md` / `events.jsonl`: interrupts (with what the user typed next), rejected tool calls (with reason), keyword-flagged corrections, error loops, each with what Claude did just before. Corrections are a noisy keyword match: keep `kind!="correction" or score>=4`.
- `prs.md`: reviews, inline and conversation comments by others on the user's PRs, and PRs closed without merge.
- `--project SUBSTR` narrows to one repo. `--include-tmp` adds `-private-*` sandbox runs (benchmarks, not real users).

## 2. Read in parallel

Filtered events run to hundreds of KB. Split by project (`jq` on `events.jsonl`) and spawn `researcher` agents in one message: one per events partition, one for `prs.md` + `summary.md`. Give each the file path, the current `~/.claude/CLAUDE.md`, and this ask: up to 10 recurring patterns about Claude's behavior (not app bugs), each with count, 2-3 quotes with session id or repo#PR, root cause, a one-line imperative rule, and the best enforcement. Ask them to flag patterns that happen despite an existing rule.

## 3. Decide

- Keep a pattern only with 3+ occurrences, or 1 that cost data, money, or a push.
- A pattern that happens despite an existing rule means the rule is weak: sharpen it or enforce it, do not add a second copy.
- Pick the strongest place that works: hook or script (cannot be skipped) > existing skill edit > new skill > CLAUDE.md line > memory. A tool-error class that keeps repeating is a hook or a tool-description fix, not prose.
- Repo- or employer-specific lessons go to that repo's CLAUDE.md or to private memory. `~/.claude/CLAUDE.md` and `~/.claude/skills` sync to a public dotfiles repo: no employer names, people, hosts, or ticket ids there.

## 4. Apply and report

- Edit `~/.claude/CLAUDE.md`: merge into existing sections, keep it short, delete rules the data shows are dead or wrong.
- Hooks and skills changes follow the QC rule in CLAUDE.md.
- Run `~/dotfiles/sync.sh` after config changes; commit or push only when asked.
- Report: top patterns with counts, what changed where, what was dropped and why, the numbers to beat next run (interrupts, rejections, error loops per session).
