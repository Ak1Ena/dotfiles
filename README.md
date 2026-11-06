# dotfiles

My macOS dev setup: zsh/bash profile, git, tmux, and a Claude Code setup (settings, global CLAUDE.md, hooks, agents, skills, plus a small remote-control server and model router).

Highlights:
- `home/.claude/hooks/egm-detect.py` nudges Claude to use the [Elephant-Goldfish](https://github.com/google/elephant-goldfish-model) design flow when a prompt looks like big design work in a big repo. Self-test: `python3 -I home/.claude/hooks/egm-detect.py --test`.
- `home/.claude/hooks/qc-gate.sh` is a QC gate. Claude cannot end a turn after 10+ changed code lines until the `reviewer` agent has run and `guardrail` returns `VERDICT: PASS` on the current change. Self-test: `bash home/.claude/hooks/qc-gate.test.sh`. The workflow and a design for showing it inside Claude Code are in `docs/claude-workflow.html` (open it in a browser).
- `home/.claude/dev-mods/workflow-rail/` is a Claude Code plugin that shows the workflow live: a `Plan · Build · Prove · QC · Report` band above the prompt, a `QC:` status line, a QC pane that opens when the gate blocks (or `/workflow`), and teammate rows plus a tmux `@wf_team` option in c-team. It reads `qc-gate.sh status`. settings.json enables it from a local directory marketplace; on a new machine run `claude plugin install workflow-rail@workflow-rail-local` if it does not load. Tests: `cd home/.claude/dev-mods/workflow-rail && claude plugin test`. Band style options: `docs/workflow-band-styles.html`.
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
