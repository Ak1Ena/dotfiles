# dotfiles

My macOS dev setup: zsh/bash profile, git, tmux, and a Claude Code setup (settings, global CLAUDE.md, hooks, agents, skills, plus a small remote-control server and model router).

Highlights:
- `home/.claude/hooks/egm-detect.py` nudges Claude to use the [Elephant-Goldfish](https://github.com/google/elephant-goldfish-model) design flow when a prompt looks like big design work in a big repo. Self-test: `python3 -I home/.claude/hooks/egm-detect.py --test`.
- `home/.claude/settings.json` caps context growth (auto-compact window, Bash/MCP output limits).

## Use

- `./sync.sh` mirrors the live setup into `home/`. Run it, then commit.
- `./install.sh` copies `home/` onto a machine, backs up replaced files to `~/.dotfiles-backup/<timestamp>/`, and reinstalls Claude Code plugins.
- `paths.txt` lists what is tracked. `excludes.txt` lists what never is.

## Privacy

This repo is public, so:
- Secrets are never committed. Keep them in untracked files such as `~/.zshrc.secrets`. `sync.sh` and the pre-commit hook (`git config core.hooksPath .githooks`) run [gitleaks](https://github.com/gitleaks/gitleaks) and stop if one slips in.
- Work-specific skills, memory notes, proxy configs and the `autoMode` block of `settings.json` stay local.
- The Tailscale address is stored as `TAILSCALE_IP`. `install.sh` fills it in from `tailscale ip -4`.

Skills under `home/.agents/skills` come from their own upstream projects and keep their licenses.
