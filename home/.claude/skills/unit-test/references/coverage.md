# Coverage

Coverage measures which code was **executed** by the suite. It never measures whether the behavior was **verified** — a test with no asserts produces perfect coverage.

| Metric | Question it answers |
|---|---|
| Line | Was each line run? |
| Branch | Were both sides of each `if`/`else`/ternary taken? |
| Function | Was each function called at least once? |
| Path | Were the combinations of branches through the unit exercised? |
| Condition | Was each boolean sub-expression evaluated both true and false? |

**Branch and condition coverage carry the signal.** Line coverage flatters a suite: one call through a function with five branches lights up nearly every line while testing one path.

## Using it well

- Read the **uncovered** report, not the percentage. Ask of each gap: is a break hiding here?
- Untested branches in money, auth, permissions, and data-loss paths are the ones to close first.
- A target above ~80% starts paying in test-maintenance cost for getters, generated code, and unreachable defensive branches.
- Coverage that only rises is a ratchet, not a goal. Guard against regression on critical modules; leave the global number alone.
- Mutation testing answers the question coverage cannot — it breaks the code and checks whether a test notices. A cheap manual version: flip one comparison in the source and confirm something goes red.
