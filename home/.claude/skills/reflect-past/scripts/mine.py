#!/usr/bin/env python3
"""Mine past Claude Code transcripts for friction: user corrections, interrupts,
rejected tool calls, tool errors, hook blocks, error loops, compactions.

  python3 mine.py --days 30 --out DIR [--project SUBSTR] [--exclude-session ID] [--include-tmp]
  python3 mine.py --self-test

Writes DIR/summary.md (counts, top error classes, hook blocks, per-project table)
and DIR/events.md (friction events with what Claude did just before), plus
DIR/events.jsonl. Output holds private chat text: keep it in a scratch dir.
"""
import argparse, collections, json, os, re, sys, tempfile, time

STRONG = re.compile(
    r"\b(wrong|incorrect|stop|i (said|told|asked|already)|why (did|didn'?t|do|does|are|is|not|you)|"
    r"again|still|revert|undo|forgot|mistake|not working|doesn'?t work|didn'?t work|broke|broken|"
    r"don'?t|do not|never|you (missed|skipped|ignored)|instead|wtf|ugh|annoying|frustrat\w*|"
    r"hallucinat\w*|lie|lying|fake|too (long|much|slow|many|complex))\b|"
    r"ไม่ใช่|ผิด|ทำไม|อย่า|หยุด|บอกแล้ว|ยังไม่", re.I)
WEAK = re.compile(r"\b(no|not|nope|wait|should|shouldn'?t|actually|fail\w*|bug|missing|error)\b|ไม่", re.I)
WRAPPERS = ("<local-command", "<command-", "<bash-", "<system-reminder", "<task-notification",
            "Caveat:", "This session is being continued", "<user-prompt-submit-hook")
REJECT = "The user doesn't want to proceed with this tool use"


def clip(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1] + "…"


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in content)
    return ""


def norm_error(s):
    s = clip(s.split("\n<")[0], 400)
    s = re.sub(r"(/[\w.@~+-]+){2,}", "PATH", s)
    s = re.sub(r"\b[0-9a-f]{7,}\b", "HEX", s)
    s = re.sub(r"\d+", "N", s)
    return s[:140]


def score(t):
    return 2 * len(STRONG.findall(t)) + len(WEAK.findall(t)) + (2 if re.fullmatch(r"\s*(no|nope|stop|wrong)\W*", t, re.I) else 0)


def mine_session(path):
    """Return (events, stats) for one main-session transcript."""
    ev, st = [], collections.Counter()
    tools = {}  # tool_use_id -> (name, input excerpt)
    last_said, last_tool = "", ""
    errs = []  # normalized error sequence, for loop detection
    pending = None  # interrupt event waiting for the next typed prompt
    with open(path, errors="replace") as f:
        for line in f:
            if '"user"' not in line and '"assistant"' not in line and "compact_boundary" not in line:
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("subtype") == "compact_boundary":
                st["compactions"] += 1
                continue
            if r.get("isSidechain"):
                continue
            ts = (r.get("timestamp") or "")[:16]
            c = (r.get("message") or {}).get("content")
            if r.get("type") == "assistant" and isinstance(c, list):
                for b in c:
                    if b.get("type") == "text" and b.get("text", "").strip():
                        last_said = b["text"]
                    elif b.get("type") == "tool_use":
                        last_tool = f"{b.get('name')}({clip(json.dumps(b.get('input'), ensure_ascii=False), 160)})"
                        tools[b.get("id")] = (b.get("name"), last_tool)
                continue
            if r.get("type") != "user":
                continue
            before = {"said": clip(last_said, 220), "tool": last_tool}
            if isinstance(c, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c):
                for b in c:
                    if not (isinstance(b, dict) and b.get("type") == "tool_result"):
                        continue
                    body = text_of(b.get("content"))
                    name, call = tools.get(b.get("tool_use_id"), ("?", "?"))
                    if REJECT in body:
                        st["rejections"] += 1
                        why = body.split("the user said:", 1)[1] if "the user said:" in body else ""
                        ev.append(dict(kind="rejected", ts=ts, user=clip(why, 400), tool=call, said=before["said"], score=4))
                    elif b.get("is_error"):
                        st["tool_errors"] += 1
                        k = norm_error(body)
                        errs.append(k)
                        st[f"err\t{name}\t{k}"] += 1
                        if body.startswith(("PreToolUse:", "PostToolUse:")):
                            st[f"hook\t{body.split(':', 1)[0]}\t{k}"] += 1
                continue
            t = text_of(c).strip()
            if not t:
                continue
            if t.startswith("Stop hook feedback"):
                st["stop_blocks"] += 1
                st[f"hook\tStop\t{norm_error(t[len('Stop hook feedback:'):])}"] += 1
                continue
            if r.get("isMeta") or r.get("isCompactSummary") or t.startswith(WRAPPERS):
                m = re.search(r"<command-name>/?([\w:-]+)</command-name>", t)
                if m:
                    st[f"slash\t{m.group(1)}"] += 1
                continue
            if t.startswith("[Request interrupted by user"):
                st["interrupts"] += 1
                pending = dict(kind="interrupt", ts=ts, user="", tool=before["tool"], said=before["said"], score=3)
                ev.append(pending)
                continue
            st["prompts"] += 1
            s = score(t[:400])  # score the opening only: long pastes would win on length alone
            if pending:  # the message typed right after an interrupt says what was wrong
                pending["user"], pending["score"], pending = clip(t, 500), 3 + s, None
            elif s >= 2:
                ev.append(dict(kind="correction", ts=ts, user=clip(t, 500), tool=before["tool"], said=before["said"], score=s))
    # loop: same error class 3+ times in a session
    for k, n in collections.Counter(errs).items():
        if n >= 3:
            st["error_loops"] += 1
            ev.append(dict(kind="error-loop", ts="", user=f"{n}x {k}", tool="", said="", score=n))
    return ev, st


def project_of(path, root):
    return os.path.relpath(path, root).split(os.sep)[0]


def run(a):
    root = os.path.expanduser(a.projects_dir)
    cutoff = time.time() - a.days * 86400
    total, by_proj, all_ev = collections.Counter(), collections.defaultdict(collections.Counter), []
    sess_of = collections.defaultdict(set)  # error/hook key -> sessions
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d != "subagents" and d != "memory"]
        for fn in fns:
            p = os.path.join(dp, fn)
            if not fn.endswith(".jsonl") or os.path.getmtime(p) < cutoff:
                continue
            proj = project_of(p, root)
            sid = fn[:-6]
            if (not a.include_tmp and proj.startswith("-private-")) or sid == a.exclude_session:
                continue
            if a.project and a.project not in proj:
                continue
            ev, st = mine_session(p)
            if not st["prompts"] and not ev:
                continue
            st["sessions"] = 1
            total.update(st)
            by_proj[proj].update(st)
            for k in st:
                if k.startswith(("err\t", "hook\t")):
                    sess_of[k].add(sid)
            for e in ev:
                e.update(project=proj, session=sid)
            all_ev.extend(ev)
    os.makedirs(a.out, exist_ok=True)
    keys = ["sessions", "prompts", "interrupts", "rejections", "tool_errors", "error_loops", "stop_blocks", "compactions"]
    out = [f"# Friction summary, last {a.days} days\n", " | ".join(f"{k}: {total[k]}" for k in keys), ""]
    out += ["## Per project (by friction)", "| project | " + " | ".join(keys) + " |", "|---" * (len(keys) + 1) + "|"]
    fr = lambda s: s["interrupts"] + 2 * s["rejections"] + s["error_loops"] + s["stop_blocks"]
    for p, s in sorted(by_proj.items(), key=lambda kv: -fr(kv[1]))[:25]:
        out.append(f"| {p} | " + " | ".join(str(s[k]) for k in keys) + " |")
    for title, pre in (("Top tool error classes", "err\t"), ("Hook blocks", "hook\t"), ("Slash commands used", "slash\t")):
        out += ["", f"## {title} (count, sessions)"]
        rows = sorted(((n, k) for k, n in total.items() if k.startswith(pre)), reverse=True)[: a.top]
        out += [f"- {n}x / {len(sess_of.get(k, ()))}s `{k[len(pre):]}`" for n, k in rows]
    with open(os.path.join(a.out, "summary.md"), "w") as f:
        f.write("\n".join(out) + "\n")
    all_ev.sort(key=lambda e: (e["project"], e["session"], e["ts"]))
    with open(os.path.join(a.out, "events.jsonl"), "w") as f:
        for e in all_ev:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    lines, cur = [], None
    for e in all_ev:
        if (e["project"], e["session"]) != cur:
            cur = (e["project"], e["session"])
            lines.append(f"\n## {e['project']} {e['session'][:8]}")
        ctx = " | ".join(x for x in (e["tool"] and f"tool: {e['tool']}", e["said"] and f"said: {e['said']}") if x)
        lines.append(f"- [{e['kind']} {e['score']}] {e['ts']} USER: {e['user']}" + (f"\n  BEFORE: {ctx}" if ctx else ""))
    with open(os.path.join(a.out, "events.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{total['sessions']} sessions, {len(all_ev)} events -> {a.out}/summary.md, events.md")


def self_test():
    rows = [
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "Done, all tests pass."},
                                                      {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "git push"}}]}},
        {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1",
                                                  "content": REJECT + ". the user said:\nask before push"}]}},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "timeout 5 x"}}]}},
    ] + [{"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t2", "is_error": True,
                                                  "content": "Exit code 127\n(eval):1: command not found: timeout"}]}}] * 3 + [
        {"type": "user", "message": {"content": "[Request interrupted by user]"}},
        {"type": "user", "message": {"content": "no, I said don't push. why did you do that again?"}},
        {"type": "user", "message": {"content": "add a dark mode toggle"}},
        {"type": "user", "isMeta": True, "message": {"content": "<command-name>/goal</command-name>"}},
        {"type": "user", "message": {"content": "Stop hook feedback:\nQC gate: run reviewer"}},
    ]
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        f.write("\n".join(json.dumps(r) for r in rows) + "\nnot json\n")
    ev, st = mine_session(f.name)
    os.unlink(f.name)
    kinds = [e["kind"] for e in ev]
    assert st["rejections"] == 1 and "ask before push" in ev[0]["user"], ev
    assert st["tool_errors"] == 3 and st["error_loops"] == 1, st
    assert st["interrupts"] == 1 and st["prompts"] == 2 and st["stop_blocks"] == 1, st
    assert kinds.count("correction") == 0 and st["slash\tgoal"] == 1, (kinds, st)
    assert "don't push" in next(e for e in ev if e["kind"] == "interrupt")["user"], ev
    print("self-test ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--out", default="reflect-out")
    ap.add_argument("--projects-dir", default="~/.claude/projects")
    ap.add_argument("--project", help="only project dirs containing this substring")
    ap.add_argument("--exclude-session", default="")
    ap.add_argument("--include-tmp", action="store_true", help="include -private-* sandbox/benchmark projects")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    sys.exit(self_test() if a.self_test else run(a))
