---
name: goal
description: Run a task end-to-end with a clarity gate and model-tiered delegation — Sonnet subagents research and analyze, Opus subagents code and test. Use when the user types /goal, or asks to "do the task", "handle this goal", "run this end to end", "figure out what I want and build it".
---

# Goal

Take a task from a rough sentence to finished, verified work. Two things make this different from just doing the task inline:

1. **A clarity gate up front** — ask only when a wrong guess would produce materially different work, then never ask again mid-flight.
2. **Model-tiered delegation** — reading, searching, and analysis run on Sonnet; writing code and tests runs on Opus. Cheap work goes to the cheap model, hard work goes to the strong one.

The task is whatever follows `/goal`. If nothing follows, the task is the user's most recent request.

## 1. Read the task

Before deciding anything, establish what already exists. Do this yourself, fast — a couple of Glob/Grep/Read calls, or one Sonnet scout if the codebase is unfamiliar. You cannot judge whether a request is ambiguous until you know what's in the repo.

Then write down, for yourself:

- **Outcome** — what is true when this is done, in one sentence.
- **Surface** — which files/systems change.
- **Proof** — what command or observation shows it works.

## 2. Clarity gate

Decide once: proceed, or ask.

**Proceed without asking** when the task has one reasonable reading, or when the readings differ only in ways you can fix later cheaply. Conventional defaults count as clear — a naming choice, a file location, a library the repo already uses. Say the assumption in one line and move.

**Ask** — via `AskUserQuestion`, at most 2 questions, before any code is written — only when:

- Two readings lead to genuinely different work, and the wrong one wastes the effort (rewrite vs. patch, new service vs. new function).
- The proof of success is unknowable to you (which behavior is "correct" is a product call, not a code call).
- The task touches something irreversible or outward-facing and the blast radius is unclear.

Never ask about things the repo answers. Never ask "should I proceed?" — if you got this far without a blocking ambiguity, proceed.

State the plan in 2-4 lines, then go. No approval wait.

## 3. Route the work

Split the goal into phases and dispatch each to the right tier. Use the `Agent` tool with an explicit `model`.

| Phase | Model | Agent | What it does |
|---|---|---|---|
| Research | `sonnet` | `Explore` | Locate code, map call sites, list conventions. Read-only. |
| Analysis | `sonnet` | `general-purpose` | Compare approaches, trace a bug to its cause, summarize an API or doc. Returns findings, not edits. |
| Code | `opus` | `general-purpose` | Write the change. |
| Test | `opus` | `general-purpose` | Write and run tests, fix failures until green. |
| QC | `sonnet` | `reviewer` + `guardrail` (one message, parallel) | Bugs/test gaps in the diff + real tests/callers, PASS or BLOCK. Re-run `guardrail` after fixes until PASS. The Stop hook gate enforces this. |

Rules for dispatch:

- **Fan out research and analysis in parallel** — multiple `Agent` calls in one message. They don't depend on each other.
- **Serialize code after research.** Coders get the research findings pasted into their prompt; never make an Opus agent re-discover what a Sonnet agent already found.
- **Small edits stay inline.** A one-file, obvious change is not worth an agent round-trip — just do it. Delegate when the phase is big enough that the context cost of the findings is less than the context cost of the raw files.
- **Never delegate the final judgment.** Subagent reports are input, not verdicts. If a coder says "done," you still check.

Give every subagent: the outcome sentence, the exact files it may touch, and what it must return. Ask for findings and file:line references, not narration.

## 4. Verify

Run the proof from step 1 — the test command, the build, the actual app. Not "the agent said it passed."

If it fails, fix it. Failures loop back to step 3 with a tighter scope, not back to the user.

## 5. Report

Short. What changed (file paths), what proved it (the command and its result), what you assumed, and anything you deliberately left out and why.

If a test fails and you could not fix it, say so with the failing line. Do not report done on partial work.

## Notes

- Model IDs for `Agent`'s `model` param: `sonnet`, `opus`, `haiku`. Bare names, not full IDs.
- If a phase is ambiguous in tier — "analyze then fix" — split it: Sonnet analyzes, Opus fixes.
- Anything destructive (deleting files, force-push, dropping tables, hitting production) stops for explicit confirmation regardless of how clear the task is.
