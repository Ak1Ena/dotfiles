---
name: macos-zsh-command-pitfalls
description: Use when zsh on macOS: timeout missing, glob no matches.
category: maintenance
---

On macOS zsh, do not assume GNU or bash-only tools behave as on Linux. Check the tool exists, or use the zsh form.

- There is no `timeout` binary on macOS by default. Use `gtimeout` only if coreutils is installed, or set the Bash tool's own `timeout` parameter. Otherwise run the command in the background and poll it.
- `${PIPESTATUS[0]}` is empty in zsh and echoes a blank exit code. Use `${pipestatus[1]}`, or capture the command's status directly.
- zsh aborts a whole command when a glob matches nothing (`no matches found`). Quote the pattern, use `ls dir/*.x 2>/dev/null`, or run `setopt nullglob` first.
- Before trusting a multi-step line, confirm each tool exists with `command -v <tool>` in the same shell.
