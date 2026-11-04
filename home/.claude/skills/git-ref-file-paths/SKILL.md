---
name: git-ref-file-paths
description: Use when git show REF:path says "exists, but not".
category: git-workflow
---

Paths in `git show REF:path` are relative to the repo root. Pathspecs in `git grep REF -- path` are relative to the cwd. From a subdirectory, prefix the path with `./` (`git show origin/main:./src/file.ts`) or use the full root-relative path. Run `git rev-parse --show-prefix` when unsure which base applies.
