# Repro report template

Write for a reader who was not in the session: a tech lead deciding priority, or the engineer who will fix it. Lead with the conclusion. Cite everything. Drop a section only if it is genuinely empty, and say so in one line.

```markdown
# <One-line title: symptom + cause, e.g. "409 ORDER_LOCKED on double-submit — lock check runs before idempotency key">

**Status:** Reproduced (EXACT) | Partially reproduced | Not reproduced
**Confidence:** High | Medium | Low — <one-line reason>
**Investigated at:** <commit SHA> (<what was deployed in user's env at the time>)

## TL;DR
<2–3 sentences: what the user saw, the mechanism, who is affected, and the recommended fix.>

## Reported vs reproduced

| Field | User reported | Reproduced |
|---|---|---|
| Result | <verbatim> | <verbatim> |
| Status / code | | |
| Env / version | | |
| Frequency | | <repro rate, e.g. 10/10> |

## How to reproduce
Preconditions: <data, flags, account state>

```bash
<exact command(s) or numbered UI steps — copy-pasteable>
```

Output:
```
<actual output from this session>
```

Counterfactual: <the one change that makes it go away> → <output showing it gone>

## Root cause
Causal chain:
1. <user action> — `<file:line>`
2. <hop> — `<file:line>`
3. <observed result> — `<file:line>`

Defect: `<file:line>` assumes <X>; actually <Y>.

## Why now
<Commit SHA / PR / date / author, or data/config change, with how it was found (bisect, blame, log -S).>

## Every path to this result

| Path | Conditions | Status | Evidence |
|---|---|---|---|
| A | | CONFIRMED | |
| B | | RULED OUT | |
| C | | UNVERIFIABLE | <what access/data would settle it> |

<If more than one path reproduces, say which one the user's evidence points to and why.>

## Blast radius
<Other callers, other surfaces, affected users/records count (with the read-only query used).>

## Why it wasn't caught
<Missing test / wrong seam / mocked dependency / env difference.>

## Fix options
1. **Recommended:** <change> — risk: <...>, effort: <...>
2. <alternative> — trade-off: <...>
Regression test: <where it should live and what it asserts>

## Assumptions and open questions
- ASSUMPTION: <...>
- OPEN: <question> — <who can answer>
```
