# Spies, stubs, and mocks

Test doubles exist for dependencies that are slow, non-deterministic, or have side effects you refuse to trigger. Everything else uses the real thing.

## Spy — watch, do not replace

Records calls and arguments; the real implementation still runs.

```js
const spy = jest.spyOn(api, 'fetchData');

myFunction();

expect(spy).toHaveBeenCalledWith('user123');
spy.mockRestore();
```

Use when you need to know *that* something was called but the real behavior is harmless and fast.

## Stub — canned answer

Replaces the implementation with a fixed response so the test is fast and deterministic.

```js
/** api.js */
export function fetchData() {
  return fetch('https://api.example.com/data').then(res => res.json());
}

/** test.js */
import * as api from './api';

test('processData uses API data', async () => {
  jest.spyOn(api, 'fetchData').mockResolvedValue({ name: 'Test User' });

  const result = await processData();

  expect(result).toContain('Test User');   // assert the outcome, not the call
});
```

A stub feeds input. Assert on what the unit *did with it*, never on the stub itself.

## Mock — replace and verify

Replaces the implementation *and* asserts the interaction. Use when the interaction **is** the behavior under test — an email sent, a payment charged, an event published.

```js
/** emailService.js */
export function sendEmail(to, subject) { /* really sends */ }

/** test.js */
import * as emailService from './emailService';

test('notifyUser sends the welcome email', () => {
  const mockFn = jest.spyOn(emailService, 'sendEmail').mockImplementation(() => true);

  notifyUser('test@example.com');

  expect(mockFn).toHaveBeenCalledTimes(1);
  expect(mockFn).toHaveBeenCalledWith('test@example.com', 'Welcome!');

  mockFn.mockRestore();
});
```

## Hygiene

- **Restore every double** (`mockRestore`, `restoreAllMocks`, `resetModules`, teardown hook). A leaked double poisons later tests and breaks Isolated.
- **Double the boundary, not the neighbor.** Stub the HTTP client, not the three internal functions between it and your unit.
- **Fake the clock and the seed** rather than mocking every consumer of `now()` or `random()`.
- **Prefer injection over module patching.** A dependency passed in needs no framework magic to replace.
- **Count your mocks.** Many mocks in one test usually means the unit has too many collaborators — the test is reporting a design problem.
