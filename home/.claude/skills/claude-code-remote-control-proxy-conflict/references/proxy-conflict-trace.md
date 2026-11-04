# Episode trace: /rc missing after headroom

- User: "why icant use rc?" Assistant guessed causes (auth, plan, version, traffic flag, trust) before checking env.
- Command result: `Unknown command: /rc. Did you mean /qa?`; later `Unknown command: /remote-control`.
- User: "it happen after i run headroom". Check showed `ANTHROPIC_BASE_URL=http://127.0.0.1:8787` in the settings env block, plus headroom's `init hook ensure` command in the hooks.
- User: "i want headroom as well can we". Options offered: separate config-dir profile (preferred), MCP-only headroom tools, or a toggle alias. Nothing edited.
