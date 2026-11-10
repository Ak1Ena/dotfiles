#!/usr/bin/env python3
"""UserPromptSubmit hook: when the user's prompt reads like a correction, tell Claude to say
what it did wrong and what it should have done, then fold a lasting lesson into ~/.claude/CLAUDE.md.

Scoring reuses the reflect-past miner (one keyword list for live hook and retro).
Silent (exit 0, no output) for normal prompts. Self-test: python3 correction-reflect.py --test
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the synced skill dir
sys.path.insert(0, os.path.expanduser("~/.claude/skills/reflect-past/scripts"))
try:
    from mine import STRONG, WRAPPERS, score  # noqa: E402
except ImportError:  # miner moved: stay silent instead of erroring on every prompt
    sys.exit(0)

THRESHOLD = 3  # one strong word plus one weak, or a bare "no"; Claude drops false hits via the last sentence
# correction-shaped first word; Thai has no word breaks, so no \b there
OPENER = re.compile(r"\W*(?:(no(?!\s+(?:problem|worries|need))|nope|stop|wrong|revert|undo|wait(?!\s+(?:for|until|till))|i mean)\b|(ไม่ใช่|หยุด|อย่า))", re.I)
NOT_USER = WRAPPERS + ("Another Claude session", "[SYSTEM NOTIFICATION")
SLASH_CMD = re.compile(r"/[\w:-]+(\s|$)")  # "/reflect-past ..." skips; "/Users/x is wrong" does not

CONTEXT = (
    "CORRECTION CHECK (matched: {why}). The user may be correcting you. If so: "
    "(1) Open your reply with one line: `Reflect: I did <what you did>; should have <what the user wanted>.` "
    "(2) Fix it. "
    "(3) If the lesson would recur in other repos, update ~/.claude/workflow.md (workflow steps; edit via /workflow-edit) or ~/.claude/CLAUDE.md (other sections): sharpen the existing line that "
    "covers it, otherwise add one short imperative line to the matching section. Never add a second copy of a rule. "
    "No employer names, people, hosts or ticket ids there (it syncs to a public repo); run ~/dotfiles/sync.sh after. "
    "Repo-specific lessons go to that repo's CLAUDE.md or memory instead. Say in one line what you changed, or that "
    "nothing needed to change. If the message is not a correction, ignore this check."
)


def decide(prompt):
    """Return matched words if the prompt opening looks like a correction, else None."""
    head = (prompt if isinstance(prompt, str) else "").strip()[:400]  # score the opening only: long pastes would win on length alone
    if not head or head.startswith(NOT_USER) or SLASH_CMD.match(head):
        return None
    if score(head) < THRESHOLD and not OPENER.match(head):
        return None
    words = sorted({m.group(0).lower() for m in STRONG.finditer(head)})
    opener = OPENER.match(head)
    return ", ".join(words) or ((opener.group(1) or opener.group(2)).lower() if opener else "several soft words")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return
    if not isinstance(data, dict):
        return
    why = decide(data.get("prompt"))
    if not why:
        return
    print(json.dumps({
        "systemMessage": f"correction-reflect: {why}",
        "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": CONTEXT.format(why=why)},
    }))


def test():
    cases = [
        ("why did you push? I said dont push yet", True),
        ("wrong, I mean the client repo not lib", True),
        ("no", True),
        ("why is the build failing", True),  # shortcut: questions about code also fire; the check text says to ignore them
        ("stop", True),
        ("revert your work talk to me", True),
        ("ทำไมไม่ใช้ askAI ผิดแล้ว", True),
        ("why not we use askAI instead of askGemini directly", True),
        ("run the tests", False),
        ("add a button to the header", False),
        ("what is better for claude.md?", False),
        ("Another Claude session sent a message: why did you stop? wrong again", False),
        ("/reflect-past why did it fail again", False),
        ("<task-notification> wrong stop </task-notification>", False),
        ("wait talk to me first", True),
        ("undo that", True),
        ("nothing else, thanks", False),
        ("actually it is not a bug, the api should fail", True),  # weak words only, no opener
        ("no problem, go ahead", False),
        ("wait for the build then run tests", False),
        ("หยุดก่อน", True),
        ("อย่าทำแบบนี้", True),
        ("/Users/x/foo.py is wrong, why did you edit it", True),
        ("", False),
        (None, False),
        (123, False),
    ]
    bad = [(p, want) for p, want in cases if bool(decide(p)) != want]
    assert not bad, bad
    import subprocess
    run = lambda raw: subprocess.run([sys.executable, "-I", __file__], input=raw, capture_output=True, text=True)
    out = run('{"session_id":"x","prompt":"wrong, revert it"}')
    hso = json.loads(out.stdout)["hookSpecificOutput"]
    assert out.returncode == 0 and hso["hookEventName"] == "UserPromptSubmit" and "Reflect:" in hso["additionalContext"]
    for raw in ("[]", '"str"', '{"prompt":["a"]}', "not json", "", '{"prompt":"run tests"}'):
        r = run(raw)
        assert r.returncode == 0 and not r.stdout and not r.stderr, (raw, r)
    print(f"ok {len(cases)} cases + main()")


if __name__ == "__main__":
    test() if "--test" in sys.argv else main()
