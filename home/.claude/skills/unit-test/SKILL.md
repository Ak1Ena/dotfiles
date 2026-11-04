---
name: unit-test
description: "Write, review, or repair unit tests under F.I.R.S.T principles with A.A.A structure and disciplined test doubles. Use when the user types /unit-test, asks for unit tests or test coverage for code, asks to review or fix flaky/slow/brittle tests, or wants TDD/BDD guidance."
---

# /unit-test

Turn a unit of code into tests that make failure obvious. A test suite is not proof the code works — it is an alarm that fires the moment it stops working.

## Usage

```
/unit-test                       # test the current diff / most recent change
/unit-test <path>                # test a file, function, class, or directory
/unit-test <path> --review       # audit existing tests, no new tests written
/unit-test <path> --tdd          # red-green-refactor: failing test first
/unit-test <path> --bdd          # Given-When-Then behavior specs
```

## The alarm

Every test earns its place by answering: **what break does this catch?** A test that passes no matter what the code does is dead weight that still costs a run, a read, and a merge conflict. Name that break before writing the assert; if you cannot, drop the test.

## Steps

### 1. Read the unit and the house style

Read the target code. Then find one existing test file nearby and read it too — runner, assertion library, file naming, directory layout, factory/fixture helpers, mocking idiom. New tests match the house style; a suite with two dialects is a suite nobody maintains.

If no test exists, detect the runner from the project manifest (`package.json`, `pyproject.toml`, `go.mod`, `pom.xml`, `Cargo.toml`, `*.csproj`) and confirm the command that runs a single file.

**Done when:** you can state the runner, the single-file run command, and the naming convention you will follow.

### 2. Enumerate the breaks

List behaviors before writing code. Cover, per unit:

- **Happy path** — the contract, stated plainly.
- **Boundaries** — 0, 1, n, empty, max, off-by-one on every range.
- **Error paths** — bad input, missing dependency, thrown/rejected dependency.
- **Branches** — every `if`/`else`, every `switch` arm, every short-circuit, both sides of every boolean.
- **Type traps** — the failure the article opens with: `add(2,3)` returning `"23"`. Assert value **and** type where the language lets coercion through.

**Done when:** every branch in the unit maps to at least one listed behavior, and every listed behavior names its break.

### 3. Write each test A.A.A

```js
test('add returns the numeric sum', () => {
  // Arrange
  const a = 5;
  const b = 7;

  // Act
  const result = add(a, b);

  // Assert
  expect(result).toBe(12);
});
```

Rules that hold in every language:

- **One behavior per test.** Multiple asserts are fine when they describe one behavior; a second Act means a second test.
- **Name the test after the break**, not the function: `throws when quantity is negative`, not `test quantity`.
- **No logic in tests** — no loops around asserts, no `if`, no computing the expected value with the same formula the code uses. Hardcode the expectation.
- **Arrange in the test.** Shared setup that hides what a test depends on trades readability for a few saved lines; keep fixtures visible or build them from an obvious factory.
- **Test the contract, not the internals.** Assert on returned values and observable effects; private helpers get covered through the public surface.

For `--bdd`, use G.W.T instead — see [references/approaches.md](references/approaches.md).

**Done when:** every behavior from step 2 has a test whose name reads as a sentence about the break.

### 4. Draw the seam

Real collaborators by default. Reach for a double only when the dependency is **slow, non-deterministic, or has side effects you refuse to trigger** — network, database, clock, randomness, filesystem, email, payment.

| Double | Use it to | Assert on it? |
|---|---|---|
| Spy | watch a real function's calls | calls/arguments |
| Stub | feed a canned response | no — assert the outcome |
| Mock | replace *and* verify the interaction | calls + arguments |

Over-mocking is the top cause of tests that pass while production burns: a suite of mocks tests your mocks. Full idioms and Jest examples: [references/test-doubles.md](references/test-doubles.md).

**Done when:** every double in the file traces to a slow/non-deterministic/side-effecting dependency, and every double is restored after the test.

### 5. Run them, and make them fail

Run the suite. Green on the first run is not evidence — prove each test can fail: for `--tdd`, write the test before the code and watch it go **red**, then write the minimum code for **green**, then **refactor**. Otherwise mutate the source (flip a comparison, return a constant) and confirm the test catches it, then revert.

**Done when:** the suite passes, and you have seen at least the critical-path tests fail against broken code.

### 6. Audit against F.I.R.S.T

| | Check |
|---|---|
| **Fast** | Milliseconds per test. Slow tests are tests nobody runs — no sleeps, no real I/O, no waiting on timers you can fake. |
| **Isolated** | No shared mutable state, no ordering dependency. Each test passes alone and in any order. |
| **Repeatable** | Same result on any machine, any day, offline. Freeze the clock, seed the randomness. |
| **Self-validating** | Pass/fail, no console output to eyeball, no commented-out expectations. |
| **Timely** | Written with the code, not bolted on after the bug. |

Then the coverage question: coverage tells you what was **executed**, never what was **verified**. Chase the uncovered branch that hides a break; ignore the last few percent of getters. Metric definitions: [references/coverage.md](references/coverage.md).

**Done when:** every row above holds for every test you wrote, and you report which behaviors you deliberately left untested and why.

## Reviewing existing tests (`--review`)

Same F.I.R.S.T audit, plus hunt these smells, worst first:

1. **Assertion-free test** — calls code, asserts nothing (or only `not.toThrow()`).
2. **Mock theatre** — asserts that a mock was called, and nothing about the outcome.
3. **Tautology** — expected value computed by the code under test, or by copying its formula.
4. **Shared-state coupling** — passes in the suite, fails alone (or vice versa).
5. **Flake** — real clock, real network, real random, `sleep`, ordering on an unordered collection.
6. **Test of the framework** — asserts that the library or language works.
7. **Snapshot sprawl** — a giant snapshot nobody reads, regenerated whenever it fails.

Report as `path:line: smell — the break it fails to catch — the fix`. Fix only what the user asked you to fix.
