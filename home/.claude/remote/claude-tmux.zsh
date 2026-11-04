# Claude Remote: put the tmux shim first in PATH (works in zsh and bash). Opt out: CLAUDE_NO_TMUX=1 claude
case ":$PATH:" in *":$HOME/.claude/remote/bin:"*) ;; *) export PATH="$HOME/.claude/remote/bin:$PATH";; esac
[ -n "$ZSH_VERSION" ] && unfunction claude 2>/dev/null; true
