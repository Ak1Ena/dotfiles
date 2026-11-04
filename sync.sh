#!/bin/sh
# Mirror the live setup from $HOME into home/ (run before each commit). This repo is public:
# work data is excluded (excludes.txt) or redacted below.
set -e
cd "$(dirname "$0")"
PATH="/opt/homebrew/bin:$PATH"
command -v gitleaks >/dev/null || { echo "sync: gitleaks not installed (brew install gitleaks)" >&2; exit 1; }
rm -rf home  # rebuild so files deleted or newly excluded in $HOME also leave the repo
# exit 23 = a listed path does not exist on this machine; copy the rest
rsync -a -r --files-from=paths.txt --exclude-from=excludes.txt "$HOME/" home/ || [ $? -eq 23 ]
# autoMode holds employer environment notes; it stays machine-local (install.sh keeps yours)
s=home/.claude/settings.json
jq 'del(.autoMode)' "$s" > "$s.tmp" && mv "$s.tmp" "$s"
# Tailscale address becomes a placeholder; install.sh fills it from `tailscale ip -4`
grep -rlE '\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+\b' home | while read -r f; do
  # BSD sed lacks \b; 100.64.0.0 is the Tailscale range server.py checks against, not an address
  perl -pi -e 's/\b(?!100\.64\.0\.0\b)100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d+\.\d+\b/TAILSCALE_IP/g' "$f"
done
if ! gitleaks dir home --redact --no-banner >/dev/null 2>&1; then
  echo "sync: secret found in home/ (run: gitleaks dir home --redact). Do not commit until it is moved out." >&2
  exit 1
fi
git status --short
