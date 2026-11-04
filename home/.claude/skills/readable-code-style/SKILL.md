---
name: readable-code-style
description: Use when code is smelly, hard to read, or too clever.
category: code-quality
---

Write code a reader grasps on the first pass. Clarity beats brevity: a longer diff with clear names and flat control flow wins over a clever one-liner.

- No nested ternaries, chained one-liners, or dense expressions that need decoding.
- Descriptive names; no single-letter names outside tiny loops.
- Early returns over deep nesting; one job per function.
- Match the surrounding file's naming, idiom, and comment density.
- On conflict, this overrides ponytail's "shortest diff wins" and "one line a reader gets at a glance" rules.
- Run the repo's existing formatter and linter before finishing when one exists.
