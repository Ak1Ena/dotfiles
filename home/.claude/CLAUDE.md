# graphify

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
  When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# How to work

Workflow steps live in `~/.claude/workflow.md`, injected by the workflow-editor mod. Edit them with `/workflow-edit`.

# Subagents

- Pick an agent by its own `description`: `scout` (lookups, haiku), `researcher` (docs/web, sonnet), `builder` (normal edits and tests, sonnet), `reviewer` (diff review, sonnet), `guardrail` (verifies a builder change: goal proven + callers/impact checked, PASS|BLOCK, sonnet). After `builder` edits code, run `guardrail` before reporting done; on BLOCK send findings back to builder. If `gpt-*` or `gemini-*` agents are listed in the session, they are also valid picks for the same jobs.
- Hard work (design, multi-file refactors, hard debugging) stays in the main thread (Opus) when it needs this conversation's context. Quick test: if the prompt would restate more than ~10 lines of decisions, do it yourself.
- Don't spawn an agent for a lookup of 1-3 tool calls; do it inline.
- One complete prompt per agent: target path, the items it owns, rules (no commit/push unless asked, check command), report shape. No progress check-ins.
- Independent agents go in one message so they run in parallel. Agents that touch the same file never run in parallel.
- Keep the tool, model and browser the user named.

# Shared ledger (no re-reading)

Every session has a ledger at `~/.claude/work/<session_id>/ledger.md` (the path is injected at session start). Subagents get it injected automatically, read it before opening files, and append `path:line — fact` lines. Main thread: check it before re-investigating, and append decisions subagents need as `[main] ...` lines.

# Language

- Write code comments, commit messages, PR text and identifiers in English, even when the conversation is in another language.
