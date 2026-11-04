---
name: skill-usage-audit
description: Use when auditing unused or unnecessary skills and plugins.
category: maintenance
---

# Skill usage audit

Judge "unused" from counted transcript use, never from names or descriptions. Report candidates and remove nothing until the user names the groups to remove.

1. Read the enabled state: `enabledPlugins` in `~/.claude/settings.json`, `plugins/installed_plugins.json`, and the `skills/` folder. Symlinks into `~/.agents/skills` count as installed.
2. Count real use in one pass over `~/.claude/projects/**/*.jsonl` with `references/usage-count.py`. It counts Skill tool calls, slash-command tags, subagent types, and mcp tool prefixes. Do not loop grep per pattern over hundreds of transcripts. That hit the 120s Bash timeout and was moved to background.
3. Classify each item:
   - never used: removal candidate after confirmation
   - manual-only (`disable-model-invocation: true`): zero Skill calls is expected. Check the slash count. Removing it only tidies the folder, since it costs no context
   - injected every session (SessionStart hooks, skill listings, "must use" blocks): costs tokens even when unused, so count it as cost
   - created in the last two weeks: too new to judge, say so and leave it
4. Note what the local files cannot show: claude.ai-managed connectors and skills, and transcripts older than the first file found. Name the date range you counted.
5. Report grouped candidates with their counts, then stop. Uninstall plugins or delete folders only after the user names the groups.

Pitfall: `/plugin install` or other commands run during the audit change the plugin list. Re-read it before reporting.
