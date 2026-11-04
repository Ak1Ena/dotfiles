---
name: claude-code-remote-control-proxy-conflict
description: Use when /rc or Remote Control breaks after headroom.
category: maintenance
---

# Remote Control missing: check ANTHROPIC_BASE_URL before guessing

When `/rc` or `/remote-control` returns "Unknown command", check the `env` block of `~/.claude/settings.json` for `ANTHROPIC_BASE_URL` before blaming login, plan or version. A local proxy URL (for example `http://127.0.0.1:8787`, added by headroom's init) sends API traffic through the proxy, and that can gate Remote Control off.

1. Find the cause: `grep ANTHROPIC_BASE_URL ~/.claude/settings.json` and `env | grep ANTHROPIC_BASE_URL`. Check `claude --version`. Rule out a stray `ANTHROPIC_API_KEY` or Bedrock/Vertex env var.
2. Test before changing anything: remove the line, restart Claude Code, and see if `/remote-control` appears. Put the line back if it does not. The proxy cause stays unconfirmed until this test passes.
3. Do not edit the user's global settings without an explicit OK. Propose the change and wait.
4. Headroom's init hook (`headroom init hook ensure`) may re-add the line at session start. Disable that hook or the plugin, or the removal will not stick.
5. To keep headroom and Remote Control both: run Remote Control from a second profile with its own config dir and no proxy line, for example `CLAUDE_CONFIG_DIR=~/.claude-rc claude`, logged in once. Not yet verified in this setup.

Episode details are in `references/proxy-conflict-trace.md`.
