---
name: playwright-capture-verify
description: Use when Playwright shots, design-board match, or GIF caps.
category: media
---

# Verify every capture and every visual claim

Open each screenshot, GIF frame or element crop yourself and confirm it shows the state its filename claims before reporting it. "Matches the design" and "no overflow" are claimed only after each element is checked on its own.

- Capture mechanics, flow hygiene, run folders, GIF caps and PR media: `references/capture-hygiene.md`.
- Matching a page to a board element by element, montage method, data gaps: `references/design-board-checklist.md`.
- Mobile overflow, table clipping and restyled HTML checks: `references/mobile-overflow-checks.md`.

## Rules that apply every time
- A blocking modal, timeout or empty cart in a shot is a failed capture, not evidence. Dismiss dialogs by button text, and take selectors from the live DOM.
- Capture once from the merged tip: every changed page, at each viewport and locale. Never reuse part-level shots. A fix pushed after a run makes that run stale.
- A new capture round goes to a new empty `run-NN` folder. Never delete or overwrite an earlier run.
- Never fake populated rows or data in a shot. A route intercept that returns populated rows is mock data, even when labelled. Show the real empty state and list the populated state under "not checked".
- Report only what you looked at. Name the variants, widths and frames checked; list the rest as "not checked" or "not viewed in browser".
- Shrink a GIF by fps, palette or width, never by slowing playback.
- Run every screenshot, GIF or probe script in the background, and wait on its output with a bounded loop, not a long foreground sleep.
- Playwright wipes its `--output` folder on every run. When several specs keep videos, give each its own output folder, or only the last run's video survives.
- A command-line `--reporter` replaces the config reporters. Passing `--reporter=line` drops the JSON report that downstream video or summary tools read. Keep the config reporters.
- Delegate a capture run to a haiku subagent with a brief that names an empty run folder. Use a bigger model only for writing or debugging a flow that will not run.
- Media goes in the PR body, not in comments, and every image URL must return 200 after the edit.
