# graphify

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
  When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# How to work (like a senior engineer, not a script)

1. **Understand first.** Restate the goal in one line. Read only what the task touches. Ask the user only for decisions that are truly theirs; otherwise pick the sensible default and say so.
2. **Plan small, verifiable steps.** For multi-step work, list the steps (TaskCreate/todo). Each step ends in something you can check.
3. **Do, then prove.** Run the real test, build, or app. "Should work" is not done. Report failures with the shortest decisive output line.
4. **QC before done.** Workflow is flexible (inline for small work, `/goal` or pstack for big), but QC is not: after code changes (10+ lines, docs excluded), spawn `reviewer` and `guardrail` in one message, fix confirmed findings, re-run `guardrail` until `VERDICT: PASS`, then report. The Stop hook `hooks/qc-gate.sh` enforces this and blocks finishing until it is done.
5. **Report like a human.** What changed, how it was verified, what was skipped, and any risk. No narration.

Process skills from plugins (superpowers, pstack, postman) are tools, not mandates: use one when the task is multi-step, unclear, or is a bug with an unknown cause. Skip them for questions, single-file changes, and lookups.

# Subagents

- Pick an agent by its own `description`: `scout` (lookups, haiku), `researcher` (docs/web, sonnet), `builder` (normal edits and tests, sonnet), `reviewer` (diff review, sonnet), `guardrail` (verifies a builder change: goal proven + callers/impact checked, PASS|BLOCK, sonnet). After `builder` edits code, run `guardrail` before reporting done; on BLOCK send findings back to builder. If `gpt-*` or `gemini-*` agents are listed in the session, they are also valid picks for the same jobs.
- Hard work (design, multi-file refactors, hard debugging) stays in the main thread (Opus) when it needs this conversation's context. Quick test: if the prompt would restate more than ~10 lines of decisions, do it yourself.
- Don't spawn an agent for a lookup of 1-3 tool calls; do it inline.
- One complete prompt per agent: target path, the items it owns, rules (no commit/push unless asked, check command), report shape. No progress check-ins.
- Independent agents go in one message so they run in parallel. Agents that touch the same file never run in parallel.
- Never use `agy-researcher` or `mcp__agy-bridge__*` tools.

# Shared ledger (no re-reading)

Every session has a ledger at `~/.claude/work/<session_id>/ledger.md` (the path is injected at session start). Subagents get it injected automatically, read it before opening files, and append `path:line — fact` lines. Main thread: check it before re-investigating, and append decisions subagents need as `[main] ...` lines.
