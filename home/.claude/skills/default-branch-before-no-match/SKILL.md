---
name: default-branch-before-no-match
description: Use when a code search finds nothing on the current branch.
category: git-workflow
---

# Check the default branch before saying "not found"

A no-match on the checked-out feature branch does not prove the feature is absent. Merged work can sit on the default branch that the current branch was never rebased onto.

- Run `git fetch origin`, then search `origin/main` directly with `git grep -n` on the pattern, limited to the relevant paths, or check out main and pull.
- In the answer, name every ref and directory searched, and the commit searched. Never say "not configurable" on the strength of one branch.
- Only state a value or default after reading the code that sets it.
