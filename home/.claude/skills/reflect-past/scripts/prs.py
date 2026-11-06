#!/usr/bin/env python3
"""Collect review feedback on the user's own PRs: review verdicts, inline comments,
conversation comments by anyone but the author, plus PRs closed without merge.

  python3 prs.py --days 30 --out DIR [--repo OWNER/NAME]

Writes DIR/prs.md. Needs an authenticated `gh`. Output holds work text: keep it in a scratch dir.
"""
import argparse, concurrent.futures as cf, datetime as dt, json, os, re, subprocess, sys


def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"gh {' '.join(args[:3])}: {r.stderr.strip()[:200]}")
    return json.loads(r.stdout or "null")


def clip(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def feedback(pr):
    repo, n, me = pr["repository"]["nameWithOwner"], pr["number"], pr["author"]["login"]
    out = []
    try:
        for rv in gh("api", "--paginate", f"repos/{repo}/pulls/{n}/reviews"):
            if rv["user"]["login"] != me and (rv.get("body") or rv["state"] == "CHANGES_REQUESTED"):
                out.append(f"  - review {rv['state']} by {rv['user']['login']}: {clip(rv.get('body'), 500)}")
        for c in gh("api", "--paginate", f"repos/{repo}/pulls/{n}/comments"):
            if c["user"]["login"] != me:
                out.append(f"  - inline by {c['user']['login']} at {c['path']}:{c.get('line') or c.get('original_line')}: {clip(c['body'], 500)}")
        for c in gh("api", "--paginate", f"repos/{repo}/issues/{n}/comments"):
            if c["user"]["login"] != me:
                out.append(f"  - comment by {c['user']['login']}: {clip(c['body'], 500)}")
    except RuntimeError as e:
        out.append(f"  - (fetch failed: {e})")
    return pr, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--out", default="reflect-out")
    ap.add_argument("--repo", help="limit to OWNER/NAME")
    ap.add_argument("--limit", type=int, default=200)
    a = ap.parse_args()
    since = (dt.date.today() - dt.timedelta(days=a.days)).isoformat()
    q = ["search", "prs", "--author", "@me", "--created", f">={since}", "--limit", str(a.limit),
         "--json", "repository,number,title,state,url,author"]
    if a.repo:
        q += ["--repo", a.repo]
    prs = gh(*q)
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(feedback, prs))
    closed = [p for p, _ in res if p["state"] == "closed"]
    lines = [f"# Review feedback on own PRs since {since}",
             f"{len(prs)} PRs, {sum(1 for _, f in res if f)} with feedback, {len(closed)} closed without merge", ""]
    for p, fb in sorted(res, key=lambda x: (x[0]["repository"]["nameWithOwner"], x[0]["number"])):
        if fb or p["state"] == "closed":
            lines.append(f"## {p['repository']['nameWithOwner']}#{p['number']} [{p['state']}] {p['title']}")
            lines += fb or ["  - (no comments; closed without merge)"]
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, "prs.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(prs)} PRs -> {a.out}/prs.md")


if __name__ == "__main__":
    sys.exit(main())
