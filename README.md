# dotfiles

My macOS dev setup: zsh/bash profile, git, tmux, and a Claude Code setup (settings, global CLAUDE.md, hooks, agents, skills, plus a small remote-control server and model router).

Highlights:
- `home/.claude/hooks/egm-detect.py` nudges Claude to use the [Elephant-Goldfish](https://github.com/google/elephant-goldfish-model) design flow when a prompt looks like big design work in a big repo. Self-test: `python3 -I home/.claude/hooks/egm-detect.py --test`.
- `home/.claude/hooks/qc-gate.sh` is a QC gate. Claude cannot end a turn after 10+ changed code lines until the `reviewer` agent has run and `guardrail` returns `VERDICT: PASS` on the current change. Self-test: `bash home/.claude/hooks/qc-gate.test.sh`. The workflow and a design for showing it inside Claude Code are in `docs/claude-workflow.html` (open it in a browser).
- `home/.claude/dev-mods/workflow-rail/` is a Claude Code plugin that shows the workflow live: a `Plan · Build · Prove · QC · Report` band above the prompt, a `QC:` status line, the task title, a QC pane via `/workflow`, and teammate dots in the tmux status bar (`@wf_team`) in c-team. It reads `qc-gate.sh status`. settings.json enables it from a local directory marketplace; on a new machine run `claude plugin install workflow-rail@workflow-rail-local` if it does not load. Tests: `cd home/.claude/dev-mods/workflow-rail && claude plugin test`. Band style options: `docs/workflow-band-styles.html`.
- `home/.claude/settings.json` caps context growth (auto-compact window, Bash/MCP output limits).

## Claude Code mods (pick what you want)

This repo is also a plugin marketplace. Add it once, then install only the mods you want:

```sh
claude plugin marketplace add Ak1Ena/dotfiles
claude plugin install thai-translate@ak1ena-mods   # any name below
```

Or run `/plugin` inside Claude Code and choose from the `ak1ena-mods` list.

| Mod | What it does |
|-----|--------------|
| `thai-translate` | `/thai` toggles: Thai prompts reach Claude in English, replies show in Thai (Google Translate, haiku fallback). Text goes to Google while on. |
| `prompt-enhancer` | Start a prompt with `++ ` and haiku writes a brief for Claude. |
| `final-message` | Claude keeps mid-turn text to one line and puts results in the final message. |
| `agent-tracker` | Live pane of what the main thread, subagents and teammates are doing. `/tracker`. |
| `workflow-editor` | Edit workflow rules in `~/.claude/workflow.md` from a `/workflow-edit` pane; injected into the system prompt. |
| `workflow-rail` | Plan > Build > Prove > QC > Report band. Needs `home/.claude/hooks/qc-gate.sh`. |

Update later with `claude plugin marketplace update ak1ena-mods`.

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
