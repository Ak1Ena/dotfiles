---
name: ponytail-caveman-levels
description: Use when ponytail or caveman level or default changes.
category: maintenance
---

Ponytail and caveman levels are set per session by slash command. Ponytail's `default` and caveman's `defaultMode` persist (caveman: see Caveman below). Neither level controls code readability, so pair ponytail with readable-code-style.

## Ponytail
- `/ponytail lite|full|ultra` changes the level for the current session only.
- `/ponytail default lite` persists the default for new sessions. The user must type it; the hook reacts to prompt commands only.
- Default is full. Full applies "shortest diff wins" and "one line a reader gets at a glance", which produces dense code. Prefer lite when readability matters.
- lite builds what was asked and names a smaller option in one line. ultra questions the request before building.

## Caveman
- `/caveman lite|full|ultra` sets reply compression only. Code and commits stay normal at every level.
- lite keeps articles and full sentences. ultra drops conjunctions and answers in fragments.
- A UserPromptSubmit hook re-injects the caveman level on each prompt. A session command may not stick if the hook config still forces another level; check the injected hook output before saying the level changed.
- Persistent default: `~/.config/caveman/config.json` with `{"defaultMode": "<level>"}`. Every new session in every account starts there.
- Running level is also a flag file per config dir: `~/.claude/.caveman-active` and `~/.claude-accounts/*/.caveman-active`, each holding one level word. To change open accounts now, write the level to the config and to each flag file.
- When the user asks why a level will not change, read `defaultMode` and the flag files before answering. The stored default overrides the session.
- The user set the caveman default to `ultra` on 2026-10-22 (earlier they preferred `lite`, finding ultra fragments hard to read). Do not change it back unless asked.
