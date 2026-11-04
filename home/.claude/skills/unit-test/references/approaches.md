# Structuring approaches

## A.A.A — Arrange, Act, Assert

The default for unit tests. Three visible blocks, in order, one Act.

```js
// Arrange
const cart = new Cart([{ price: 10, qty: 2 }]);

// Act
const total = cart.total();

// Assert
expect(total).toBe(20);
```

Blank lines are enough separation once the shape is habitual; comment the blocks in unfamiliar or teaching codebases.

## G.W.T — Given, When, Then

Same three beats in plain language, aimed at readers who do not read code. Use for behavior specs, acceptance criteria, and anything a product owner reviews.

```js
Given('the user is on the login page', () => { ... });
When('they enter valid credentials',   () => { ... });
Then('they see the dashboard',         () => { ... });
```

G.W.T maps one-to-one onto A.A.A — pick by audience, not by taste.

## T.D.D — Test-Driven Development

1. **RED** — write a failing test for the next behavior. Run it. See it fail for the *stated* reason, not a typo.
2. **GREEN** — write the minimum code that passes. Ugly is allowed here.
3. **REFACTOR** — clean up with the test as a net. No new behavior in this step.

Loop per behavior, not per class. The payoff is the red step: a test that has never failed has never been verified.

## B.D.D — Behavior-Driven Development

TDD's collaborative cousin. Same cycle, but the unit of work is a described behavior rather than a function, and the spec is written in shared language with non-developers. Tests double as living documentation.

Choose BDD when the risk is *building the wrong thing*; TDD when the risk is *building the thing wrong*.
