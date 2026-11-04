---
name: review-diff
description: Open the current branch's diff against its base branch in a local GitHub-style review website (difit) so the user can review it and leave line comments, then read those comments back and act on them. Use when the user types /review-diff, or asks to "send the diff to the review site", "let me review the diff in the browser", or "open review website".
---

# /review-diff [base]

Shows everything this branch changed since it left the base branch (commits + uncommitted edits) at http://localhost:4966. User comments on lines there; you read the comments back with one command.

Tool: `difit` (npm), pinned `npx -y difit@5.0.12`. It warns about Node >=21 on Node 20; it works, ignore the warning.

## 1. Pick base

1. Argument if given (`/review-diff develop`).
2. Else the remote default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` (e.g. `origin/main`).
3. Else `main`, then `master`, whichever exists.

## 2. Reuse or start the server

One server per repo. If you started one earlier this session for this repo and its pid is still alive (`kill -0 <pid>`), reuse it: do not start another; the page watches the working tree and offers reload.

Otherwise run from the repo root:

```bash
npx -y difit@5.0.12 . <base> --merge-base --background --include-untracked
```

- `. <base> --merge-base` = working tree vs the point the branch left base (same as a PR "Files changed", plus uncommitted work).
- `--background` prints `{"port":4966,"url":"http://localhost:4966","pid":123}` and does not open a browser. Run `open <url>` once, then give the user the URL.
- Committed-only review instead: replace `.` with `@`.

## 3. Optional: send your own notes to the page

To show the user explanations or findings on specific lines, add them before or after launch:

```bash
# at launch (repeatable)
--comment '{"type":"thread","filePath":"src/a.ts","position":{"side":"new","line":10},"body":"why this changed"}'
# into a running server
npx -y difit@5.0.12 comment add --port <port> '<same json, or a JSON array>'
```

- `side: "new"` for added/kept lines, `"old"` for deleted lines. Range: `"line":{"start":36,"end":39}`.
- Write bodies in the user's language. Never copy secrets/tokens from the diff into comments.

## 4. Read the user's review

When the user says they are done (or asks you to check):

```bash
npx -y difit@5.0.12 comment get --port <port> --format json
```

Address each thread. After fixing one, resolve it:

```bash
npx -y difit@5.0.12 comment resolve <threadId...> --port <port>
```

No threads = no review comments; say so and stop.

## 5. Stop

When review is finished: `kill <pid>`.
