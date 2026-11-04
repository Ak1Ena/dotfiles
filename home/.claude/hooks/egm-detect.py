#!/usr/bin/env python3
"""UserPromptSubmit hook: spot big design work (new flow / feature in a big repo) and tell
Claude to run the Elephant-Goldfish (EGM) flow before writing code.

Fires at most once per session. Silent (exit 0, no output) when the prompt looks small.
Self-test: python3 egm-detect.py --test
"""
import json
import os
import re
import subprocess
import sys
import time

BIG_REPO_FILES = 500  # tracked files; your work repos are 500-2400, past what one session reads
STATE_DIR = os.path.expanduser("~/.claude/state/egm-nudge")

# Strong: clearly "design something new"; counts in any repo.
STRONG = [
    r"\bnew (\w+ )?(flow|feature|journey|service)s?\b",
    r"\b(add|build|create|implement|design) (a |an |the )?(new )?(\w+ )?(flow|journey|onboarding|checkout|wizard)\b",
    r"\bfigma\.com/", r"\bdesign doc\b", r"\bredesign\b", r"\bre-architect\b",
    r"โฟลว์ใหม่", r"ฟีเจอร์ใหม่",
]
# Weak: each alone is everyday work; two of them in a big repo means design work.
WEAK = [
    r"\bflows?\b", r"\bfeatures?\b", r"\bintegrat(e|ion)\b", r"\brefactor\b", r"\bscreens?\b",
    r"\bendpoints?\b", r"\bworkflow\b", r"\bmulti(ple)? (step|page|service)s?\b",
    r"\bmigrat(e|ion)\b", r"\barchitect(ure)?\b", r"\bend[- ]to[- ]end\b",
    r"ออกแบบ", r"โฟลว์", r"ฟีเจอร์",
]
# Small: vetoes weak signals only; a strong signal wins ("explain X then design a new flow").
SMALL = [
    r"\btypo\b", r"\brename\b", r"\bbump\b", r"\bone[- ]line\b", r"\bsmall (fix|change)\b",
    r"\bquick (fix|question)\b", r"\bwhat is\b", r"\bexplain\b", r"\bwhy (does|is)\b",
    r"\bfix(es|ing)?\b", r"\bbugs?\b", r"\bfail(s|ing|ed)?\b", r"\berrors?\b",
]


def hits(patterns, text):
    return [p for p in patterns if re.search(p, text, re.IGNORECASE)]


def repo_files(cwd):
    try:  # ":/" counts the whole repo even when the session starts in a subfolder
        out = subprocess.run(["git", "-C", cwd, "ls-files", ":/"], capture_output=True, timeout=3)
        return out.stdout.count(b"\n") if out.returncode == 0 else 0
    except Exception:
        return 0


def decide(prompt, files):
    """Return a list of reasons when EGM should be used, else []."""
    p = prompt.strip()
    if re.match(r"/[\w:-]+(\s|$)", p) or len(p) < 30:  # slash commands (incl. /egm:*) and one-liners
        return []
    big = files >= BIG_REPO_FILES
    if hits(STRONG, p):
        reasons = ["prompt asks for new design work"]
    elif big and len(hits(WEAK, p)) >= 2 and not hits(SMALL, p):
        reasons = ["prompt spans flows/features/services"]
    else:
        return []
    return reasons + ([f"big repo ({files} tracked files)"] if big else [])


def main():
    data = json.load(sys.stdin)
    prompt, cwd, sid = data.get("prompt") or "", data.get("cwd") or os.getcwd(), data.get("session_id") or ""
    if not sid:
        return  # no session id: cannot keep the once-per-session promise
    marker = os.path.join(STATE_DIR, re.sub(r"[^\w-]", "_", sid))
    if os.path.exists(marker):
        return
    reasons = decide(prompt, repo_files(cwd))
    if not reasons:
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    week_ago = time.time() - 7 * 86400
    for name in os.listdir(STATE_DIR):  # markers are only needed while a session lives
        path = os.path.join(STATE_DIR, name)
        if os.path.getmtime(path) < week_ago:
            os.remove(path)
    open(marker, "w").close()
    why = "; ".join(reasons)
    print(json.dumps({
        "systemMessage": f"EGM suggested: {why}",
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": (
                f"EGM CHECK ({why}). This looks like big design work where guessing names causes "
                "hallucination. Before writing any code: tell the user in one line that you are using "
                "the Elephant-Goldfish flow and why, then run /egm:egm-brainstorm (or /egm:egm-draft if "
                "requirements are already clear), then /egm:egm-review and /egm:egm-resolve. Code only "
                "from the reviewed spec. Skip EGM only if the user says so or the task is actually small."
            ),
        },
    }))


def test():
    big, small = 5000, 200
    cases = [
        # should fire
        ("add a new onboarding flow with KYC and face check, see figma.com/design/abc", big, True),
        ("implement the new checkout flow for the payment service", small, True),
        ("we need to add a flow for document upload across the api and the client", small, True),
        ("We need a new returns flow: customer requests return, warehouse approves", small, True),
        ("explain the code then design a new onboarding flow with kyc steps", big, True),
        ("refactor the payment flow and split it into separate endpoints for refunds", big, True),
        ("ช่วยออกแบบโฟลว์ใหม่สำหรับการยืนยันตัวตนผ่านแอปให้หน่อย", big, True),
        ("/Users/me/repo has no returns yet, add a new returns flow end to end", big, True),
        # should stay quiet
        ("update the upload flow so it also sends the document type to the api", big, False),
        ("fix typo in the login button label please, it says Lgoin", big, False),
        ("/egm:egm-brainstorm add webhook delivery to this project", big, False),
        ("why does the build fail on the feature branch after merge", big, False),
        ("run the tests", big, False),
        ("run the end-to-end tests and fix the failing login spec", big, False),
        ("add a migration that adds a nullable email column", big, False),
        ("architecture lint rule fails on my import statement", big, False),
        ("create a new page title component for the header", big, False),
        ("ช่วยออกแบบปุ่มให้สวยขึ้นหน่อยนะครับ ตอนนี้ดูแปลกๆ", big, False),
        ("fix the bug in the feature flag lookup for the integration", big, False),
        ("integrate the logger into the worker process", big, False),
    ]
    bad = [(p, f, want) for p, f, want in cases if bool(decide(p, f)) != want]
    for p, f, want in bad:
        print(f"FAIL want={want} files={f}: {p}")
    print(f"{len(cases) - len(bad)}/{len(cases)} passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if "--test" in sys.argv:
        test()
    try:
        main()
    except Exception:
        pass  # fail open: a broken nudge must never block or clutter the prompt
