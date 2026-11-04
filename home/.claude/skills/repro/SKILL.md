---
name: repro
description: Reproduce a user-reported issue exactly, enumerate every code path that can produce the reported result, prove which one fires and why, and write a senior-engineer root-cause report. Use when the user types /repro, pastes a bug report / ticket / support message / screenshot and asks to reproduce it, asks "why does this happen", "what caused this", "can you reproduce", or wants an RCA for an observed result.
---

# /repro

Turn a user report into a **proven** explanation: what happened, how to make it happen again on demand, why it happens, and every other way the same result could have been produced.

The bar is a senior engineer's investigation: no claim without evidence, no "probably", no stopping at the first plausible path. A path is only the cause once it reproduces the user's **exact** result and a counterfactual makes it go away.

Fixing is out of scope unless the user asks. The deliverable is the repro + the report.

## Usage

```
/repro <paste of the report, ticket URL, or screenshot>
/repro                 # use the report already in the conversation
```

## Ground rules

- **Evidence or it didn't happen.** Every claim in the report cites one of: `file:line`, a command and its output, a commit SHA, a log line, or a data row. Anything else is labelled `ASSUMPTION`.
- **Match the user's result, not a nearby one.** A different error on the same screen is a different bug.
- **Never mutate production or shared data.** Read-only against prod/staging DBs, queues and third-party APIs. Reproduce writes on local or a disposable fixture. If a repro genuinely needs a shared environment, stop and ask.
- **Tag every debug log** `[REPRO-<4 hex>]` so cleanup is one grep.
- **Subagents** (follow the user's routing rule, state model + reason when spawning): `haiku` for fingerprint grep sweeps across repos, `sonnet` for tracing one candidate path end-to-end in parallel. Keep the reproduction itself in the main thread.

## Step 1 — Symptom spec

Rewrite the report as a spec. Quote observed values **verbatim** — exact error text, status code, number, UI copy, timestamp, ID.

```
Observed:    <verbatim result the user saw>
Expected:    <what they thought should happen>
Where:       <env / app / page / endpoint / job>
Who:         <account, role, tenant, plan, locale, device, browser>
When:        <timestamp + timezone, first seen, frequency: always / sometimes / once>
Version:     <build, commit, release, app version — or MISSING>
Steps:       <user's steps, numbered>
Artifacts:   <logs, request IDs, HAR, screenshots, payloads>
```

Mark every field `KNOWN`, `ASSUMED`, or `MISSING`. Ask the user only for `MISSING` fields that would change which path you investigate — max 3 questions, in one message. Do not block on the rest; carry them as assumptions.

Pin the version: find the commit actually deployed in the user's environment at the reported time (deploy logs, release tags, `git log --until`). Investigating `main` when the user ran last week's build is the most common way to reproduce the wrong thing.

**Done when:** every field is marked and the investigated commit is named.

## Step 2 — Fingerprint and producer map

Extract grep-able fingerprints from the observed result: exact error strings (and their i18n keys), error codes, HTTP statuses, log messages, UI labels, distinctive field values, enum names.

Find **every** place that can produce each fingerprint — across all repos involved (frontend, backend, workers, shared libs, vendored deps, DB constraints/triggers, gateway/proxy config). Translated strings: search the key, not just the English copy. Generic messages ("Something went wrong") usually come from a catch-all — find the catch-all and every throw that can reach it.

Record a producer map:

```
#  Producer (file:line)          Emits                    Reached when
1  api/orders/service.ts:142     409 "ORDER_LOCKED"      order.status = 'processing' AND retry within 30s
2  web/src/api/client.ts:88      toast "Try again later" any 409/423/429 from /orders/*
...
```

**Done when:** every fingerprint has been searched in every involved repo and every hit is in the map or explicitly excluded with a reason (dead code, test-only, unreachable from this surface).

## Step 3 — Candidate matrix

For each producer, trace backwards to the conditions that reach it: input shape, persisted state, config/env vars, feature flags, permissions, timing/ordering, cache state, version skew between services, locale/timezone, browser/device, third-party responses.

Then add the non-code causes that commonly produce the same symptom: bad data rows, stale cache/CDN, partial deploy, expired credentials/certs, rate limits, clock skew, DST/timezone boundaries, race between two requests, retries/idempotency gaps, background job ordering.

```
#  Path                         Required conditions               Fits report?          Status
A  producer 1 via double-submit  2 POSTs < 30s, same order id     yes — user said "clicked twice"   OPEN
B  producer 1 via worker lag     worker holds lock > 30s          unknown — need job logs           OPEN
C  producer 2 via 429            rate limit 20/min                 no — single request in HAR        RULED OUT (HAR line 14)
```

Prune a candidate **only** when it contradicts a `KNOWN` fact, and cite that fact. Gut feel is not a reason. Rank the survivors by fit with the report.

Show the ranked matrix to the user before Step 4 — they often re-rank instantly ("we deployed X that morning"). Don't wait if they're AFK.

**Done when:** every producer has at least one row, and every row is `OPEN` or `RULED OUT` with evidence.

## Step 4 — Reproduce

Work the open candidates top-down. For each, pick the cheapest harness that still runs the real code path:

1. Failing unit/integration test at the seam
2. `curl` / HTTP script against local server, with the user's payload
3. Script/REPL calling the service function with a fixture built from the user's data shape
4. Browser drive (claude-in-chrome / chrome-profiles) for UI-only symptoms
5. Replay a captured artifact (HAR, request log, event payload)
6. Load/concurrency loop for races — raise the hit rate, don't wait for luck

Run it on the **pinned commit** from Step 1 (use a worktree if the current branch differs).

Grade every attempt against the symptom spec, field by field:

- **EXACT** — every observable field matches (text, code, value, UI state).
- **PARTIAL** — same area, some fields differ. List the diffs; they are clues, not success.
- **NO REPRO** — record what you tried so it isn't re-tried.

Once a path is EXACT, prove causation with a **counterfactual**: remove the one triggering condition and show the result goes away. No counterfactual, no root cause.

Keep going after the first EXACT match. If more than one path reproduces the same result, the report must say so and say which one the user's evidence points to.

**Done when:** one path is EXACT + counterfactual-confirmed, and every other open row is reproduced, ruled out with evidence, or marked `UNVERIFIABLE` with the reason (needs prod access, needs data you don't have). If nothing reaches EXACT after the matrix is exhausted, stop and ask for the specific artifact that would separate the remaining candidates — don't invent a cause.

## Step 5 — Root cause

Answer each, with evidence:

- **Mechanism** — the causal chain from user action to observed result, one line per hop, each with `file:line`.
- **Defect** — the exact wrong line/assumption, and what the code assumes vs what is true.
- **Why now** — the commit/deploy/data change/config change that introduced or exposed it (`git log -S`, `git blame`, `git bisect run <repro>`). Give SHA, date, author/PR.
- **Blast radius** — who else hits it: other callers of the defect, other surfaces showing the same fingerprint, and (read-only) a count from logs/DB if available.
- **Why it wasn't caught** — missing test, test with wrong seam, mocked-away dependency, env difference.

## Step 6 — Report

Write the report using [report-template.md](report-template.md). Save it as `repro-<short-slug>.md` in the scratchpad directory, print the TL;DR in chat, and offer once to publish it as a shareable page.

Before finishing:

- [ ] Every claim in the report has a citation or an `ASSUMPTION` label
- [ ] Repro command is copy-pasteable and was run in this session (output pasted)
- [ ] Counterfactual result is shown
- [ ] All `[REPRO-` logs removed (`grep -r "\[REPRO-"` returns nothing) and throwaway files deleted or listed
- [ ] Any worktree created for the pinned commit is removed

If the user then asks for the fix: turn the repro into a failing regression test first, fix, watch it pass, re-run the original repro.
