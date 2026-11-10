---
name: create-mod
description: Use when the user asks to create, make, or scaffold a new personal Claude Code mod (pane, slash command, prompt rule, hook on tool calls, status line) in ~/.claude/dev-mods, or to install/publish/apply one locally.
---

# Create a mod

Mod engine work (`register`, `on(...)`, `$` API, `claude-code/testing`) is owned by the built-in `plugin-authoring` skill. Invoke it for the code. This skill adds the user's local layout, install and backup steps.

## Layout

One folder per mod, each its own marketplace:

```
~/.claude/dev-mods/<name>/
  .claude-plugin/plugin.json       {"name":"<name>","version":"0.1.0","description":"<one sentence>"}
  .claude-plugin/marketplace.json  {"name":"<name>-local","owner":{"name":"local"},"plugins":[{"name":"<name>","source":"./"}]}
  hooks/hooks.json                 {"modules":["./register.ts"]}
  hooks/register.ts                export const register: Register = (on) => { ... }
  hooks/register.test.ts           import { expect, test } from 'claude-code/testing'
  tsconfig.json                    {"extends":"./.claude-plugin/types/tsconfig.json"}
```

Reference mod: `~/.claude/dev-mods/final-message` (smallest; `prompt.compose` rule + test). Read it before scaffolding. Check `ls ~/.claude/dev-mods` first: extend an existing mod if it already covers the area.

## Steps

1. Restate goal in one line. Name the mod (kebab-case).
2. Invoke `plugin-authoring` skill; write code + one test per behaviour.
3. Check (from mod folder):
   ```
   claude plugin validate .
   claude plugin test .
   ```
   Both must pass. Quote pass/fail counts.
4. Install, user scope ("publish"/"apply" means this, not GitHub):
   ```
   claude plugin marketplace add ~/.claude/dev-mods/<name>
   claude plugin install <name>@<name>-local --scope user
   ```
   Later edits: change folder, user runs `/reload-plugins`. No reinstall.
5. Backup: append `.claude/dev-mods/<name>` to `~/dotfiles/paths.txt` if absent. Commit/push dotfiles only when user asks.
6. Prove in real session: tell user to `/reload-plugins`, then the exact action to see it (command, pane, prompt). Don't claim done on tests alone.
7. Update memory `claude-code-mods.md` with one line: name, version, what it does, trigger.

## Rules

- Behaviour belongs in a mod, not CLAUDE.md, when user asks for a mod.
- Never launch an interactive `claude` from Bash to test.
- Card/pane UI over typed commands when the user picks or confirms something.
