#!/bin/sh
# Copy home/ onto this machine. Replaced files go to ~/.dotfiles-backup/<timestamp>/.
set -e
cd "$(dirname "$0")"
backup="$HOME/.dotfiles-backup/$(date +%Y%m%d%H%M%S)"
s="$HOME/.claude/settings.json"
automode=$( [ -f "$s" ] && jq -c '.autoMode // empty' "$s" || true )
# exit 23 = a listed path is not in the repo (e.g. .zshrc until its secret is moved); copy the rest
rsync -a -r --files-from=paths.txt --backup --backup-dir="$backup" home/ "$HOME/" || [ $? -eq 23 ]
# Put back this machine's autoMode, which the public repo does not carry.
if [ -n "$automode" ]; then
  jq --argjson a "$automode" '.autoMode = $a' "$s" > "$s.tmp" && mv "$s.tmp" "$s"
fi
# Fill the Tailscale placeholder with this machine's address.
ip=$(tailscale ip -4 2>/dev/null | head -1 || true)
if [ -n "$ip" ]; then
  grep -rl TAILSCALE_IP "$HOME/.claude/hooks" "$HOME/.claude/remote" 2>/dev/null |
    while read -r f; do sed -i '' "s/TAILSCALE_IP/$ip/g" "$f"; done
else
  echo "warning: tailscale not found; replace TAILSCALE_IP in ~/.claude/hooks and ~/.claude/remote by hand" >&2
fi
# Plugins live in caches, not git: reinstall every enabled one from settings.json.
jq -r '.extraKnownMarketplaces[].source.repo // empty' home/.claude/settings.json |
  while read -r repo; do claude plugin marketplace add "$repo" </dev/null || true; done
jq -r '.enabledPlugins | to_entries[] | select(.value == true) | .key' home/.claude/settings.json |
  while read -r p; do claude plugin install "$p" </dev/null || true; done
echo "Done. Backups: $backup"
echo "Not restored: logins/tokens (run /login), ~/.claude/remote/token, ~/.zshrc.secrets."
