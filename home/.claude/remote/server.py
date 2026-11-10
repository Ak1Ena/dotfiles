"""Own Remote Control for live Claude Code sessions in tmux (any account).

Chat = the session's transcript JSONL. Input = tmux send-keys into the real session.
Live updates are pushed over Server-Sent Events (/api/stream), so the phone does not poll.
Auth: Tailscale peers (100.64.0.0/10) are trusted; otherwise a token (?t= once, then cookie).
The remote never starts sessions itself.
"""
import hashlib, hmac, json, os, re, subprocess, threading, time, urllib.error, urllib.request
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).parent
TOKEN = (HERE / "token").read_text().strip()
HOST = os.environ.get("RC_HOST", "127.0.0.1")
PORT = int(os.environ.get("RC_PORT", 8800))
ACCOUNTS = Path.home() / ".claude-accounts"
PROJECTS = Path.home() / ".claude" / "projects"
KEYS = {"enter": "Enter", "esc": "Escape", "up": "Up", "down": "Down", "tab": "Tab", "stab": "BTab",
        "ctrlc": "C-c", **{str(i): str(i) for i in range(1, 10)}}
EFFORTS = {"low", "medium", "high", "xhigh", "max"}
MODEL_OK = re.compile(r"^[A-Za-z0-9._\[\]-]{2,60}$")
PROMPT_OPT = re.compile(r"^\s*(?:❯\s*)?(\d)\.\s+(.+?)\s*$")
TYPED_OPT = re.compile(r"type something|type here|^other|custom answer", re.I)
MODE_RE = re.compile(r"(auto mode|manual mode|plan mode|accept edits|bypass permissions)", re.I)
MODEL_RE = re.compile(r"(Opus|Sonnet|Haiku|Fable) ([0-9.]+)(?: with (\w+) effort)?")
SPIN_RE = re.compile(r"^\s*[✻✽✶✳✢✺·*⠁-⣿]\s+\S[^\n]*…")
TOOL_RUN_RE = re.compile(r"^\s*⏺\s+.+·\s*\d+s\s*$")
SET_MODEL_RE = re.compile(r"Set model to (\S+(?: \S+)?)")

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout

# ---------- sessions (cached: process walking is the slow part) ----------
_cache = {"t": 0.0, "list": []}
_lock = threading.Lock()
overrides = {}  # name -> {"model":..., "effort":...} set from the phone

def _children(pid, table):
    out = [pid]
    for c in table.get(pid, []):
        out += _children(c, table)
    return out

def _scan():
    table, comms = {}, {}
    for line in sh("ps", "-axo", "pid=,ppid=,comm=").splitlines():
        parts = line.split(None, 2)
        if len(parts) >= 2:
            table.setdefault(int(parts[1]), []).append(int(parts[0]))
            comms[int(parts[0])] = parts[2] if len(parts) > 2 else ""
    reg = {}
    for acct in [*ACCOUNTS.iterdir(), Path.home() / ".claude"]:  # plain `claude` registers in ~/.claude/sessions
        for f in (acct / "sessions").glob("*.json"):
            try:
                reg[int(f.stem)] = (acct.name, json.loads(f.read_text()))
            except (ValueError, OSError):
                pass
    out, seen = [], set()
    for line in sh("tmux", "list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}\t#{pane_current_path}").splitlines():
        name, pid, path = line.split("\t")
        if name in seen:  # teammate panes share the lead's tmux session; they show as its agents
            continue
        pids = _children(int(pid), table)
        hit = next((reg[p] for p in pids if p in reg), None)
        if hit:
            seen.add(name)
            out.append({"name": name, "account": hit[0], "sid": hit[1].get("sessionId"), "cwd": hit[1].get("cwd", path)})
        elif any("claude" in comms.get(p, "") for p in pids):
            seen.add(name)
            out.append({"name": name, "account": "", "sid": None, "cwd": path})
    return out

def sessions(fresh=False):
    with _lock:
        if fresh or time.time() - _cache["t"] > 4:
            _cache["list"], _cache["t"] = _scan(), time.time()
        return list(_cache["list"])

def find(name):
    s = next((x for x in sessions() if x["name"] == name), None)
    return s or next((x for x in sessions(fresh=True) if x["name"] == name), None)

# ---------- screen parsing ----------
def screen(name, back=0):
    return sh("tmux", "capture-pane", "-p", "-t", name, *(["-S", f"-{back}"] if back else []))

def pending_prompt(lines):
    # live only while the prompt footer is on screen and the normal input box is not back
    bottom = [l for l in lines if l.strip()][-8:]
    if not any("Esc to cancel" in l or "Enter to select" in l or "to navigate" in l for l in bottom):
        return None
    if any(re.match(r"^\s*❯\s*$", l) for l in bottom):
        return None
    lines = lines[-25:]
    opts = [(m.group(1), m.group(2)) for m in map(PROMPT_OPT.match, lines) if m]
    if len(opts) < 2:
        return None
    first = next(i for i, l in enumerate(lines) if PROMPT_OPT.match(l))
    above = []
    for l in reversed(lines[:first]):
        t = l.strip()
        if not t or set(t) <= set("─│╭╮╰╯╌ "):
            if above: break
            continue
        above.insert(0, t)
        if len(above) == 3: break
    q = " ".join(above)
    return {"question": q, "options": [{"key": k, "label": v, "input": bool(TYPED_OPT.search(v))} for k, v in opts]}

PANEL_TOP = re.compile(r"^\s*▔{3,}")
def panel(lines):
    """Full-screen panels (/cost, /status, /config, /usage...): text between the ▔ rule and the input box."""
    top = max((i for i, l in enumerate(lines) if PANEL_TOP.match(l)), default=-1)
    if top < 0:
        return None
    body = [l.rstrip() for l in lines[top + 1:]]
    while body and not body[-1].strip():
        body.pop()
    if not body:
        return None
    tabs = body[0].split() if re.match(r"^\s*(Settings|Status|Config|Usage|Stats)\b", body[0]) else []
    text = "\n".join(body[1:] if tabs else body)
    return {"tabs": tabs, "text": re.sub(r"\n{3,}", "\n\n", text).strip("\n")}

def status(name):
    full = screen(name, 300)
    lines = full.splitlines()
    tail = "\n".join(lines[-30:])
    prompt = pending_prompt(screen(name).splitlines())
    pnl = panel(screen(name).splitlines())
    if pnl:
        prompt = None
    # live spinner ("✽ Choreographing… (5s · ↓ 89 tokens)") and running tool ("⏺ Sleeping … · 2s")
    box = max((i for i, l in enumerate(lines) if l.lstrip().startswith("❯")), default=len(lines))
    above = lines[max(0, box - 14):box]
    spin = next((l.strip() for l in reversed(above) if SPIN_RE.match(l)), "")
    tool = next((l.strip()[1:].strip() for l in reversed(above) if TOOL_RUN_RE.match(l)), "")
    st = "panel" if pnl else "needs_you" if prompt else "working" if spin or "esc to interrupt" in tail else "idle"
    act = re.sub(r"^\S\s+", "", spin)  # spinner status only, like Claude Code's own status line
    mode = (MODE_RE.findall(tail) or [""])[-1].lower()
    models = MODEL_RE.findall(full)
    model = f"{models[-1][0]} {models[-1][1]}" if models else ""
    effort = models[-1][2] if models and models[-1][2] else ""
    sm = SET_MODEL_RE.findall(full)
    if sm:
        model = sm[-1]
    o = overrides.get(name, {})
    return {"status": st, "mode": mode, "model": o.get("model") or model, "effort": o.get("effort") or effort,
            "prompt": prompt, "panel": pnl, "activity": act if st == "working" else ""}

# ---------- transcript (re-parsed only when the file changes) ----------
_tcache = {}
_meta = {}  # transcript path -> last {"model", "effort"} the session actually used

def pretty_model(m):
    m = re.sub(r"^claude-", "", m or "")
    p = re.match(r"(opus|sonnet|haiku|fable)-(\d+)-(\d+)", m)
    return f"{p.group(1).title()} {p.group(2)}.{p.group(3)}" if p else m

def transcript_path(sid, cwd):
    return PROJECTS / re.sub(r"[^A-Za-z0-9]", "-", cwd) / f"{sid}.jsonl" if sid and cwd else None

def transcript(sid, cwd, limit=150):
    f = transcript_path(sid, cwd)
    if not f or not f.exists():
        return []
    st = f.stat()
    key = (st.st_size, st.st_mtime)
    if str(f) in _tcache and _tcache[str(f)][0] == key:
        return _tcache[str(f)][1]
    msgs, queue, meta = [], [], {}
    for line in f.read_text(errors="ignore").splitlines()[-900:]:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        role = d.get("type")
        mdl = d.get("model") or (d.get("message") or {}).get("model")
        if mdl and not str(mdl).startswith("<"):
            meta["model"] = mdl
        if d.get("effort"):
            meta["effort"] = d["effort"]
        if role == "custom-title" and d.get("customTitle"):
            meta["custom"] = d["customTitle"]
        if role == "ai-title" and d.get("aiTitle"):
            meta["title"] = d["aiTitle"]
        if role == "queue-operation":
            if d.get("operation") == "enqueue" and d.get("content") and not str(d["content"]).startswith("<"):
                queue.append((str(d["content"]), d.get("timestamp", "")))
            elif d.get("operation") == "remove" and d.get("content"):
                queue[:] = [q for q in queue if q[0] != str(d["content"])]  # match by content: system notices are removed too
            elif d.get("operation") in ("dequeue", "remove") and queue:
                queue.pop(0)
            continue
        if role == "attachment":
            a = d.get("attachment") or {}
            if a.get("type") == "queued_command" and (a.get("origin") or {}).get("kind") == "human" and not str(a.get("prompt", "")).startswith("<"):
                msgs.append({"role": "user", "text": str(a["prompt"])[:6000]})
            continue
        if role not in ("user", "assistant"):
            continue
        content = d.get("message", {}).get("content")
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]
        for c in content or []:
            t = c.get("type")
            if t == "text" and c["text"].strip():
                if role == "user" and c["text"].startswith("<"):
                    cm = re.search(r"<command-name>(.*?)</command-name>", c["text"], re.S)
                    out = re.search(r"<local-command-std(?:out|err)>(.*?)</local-command-std(?:out|err)>", c["text"], re.S)
                    if cm:
                        a = re.search(r"<command-args>(.*?)</command-args>", c["text"], re.S)
                        msgs.append({"role": "cmd", "text": (cm.group(1) + " " + (a.group(1) if a else "")).strip(), "result": ""})
                    elif out and msgs and msgs[-1]["role"] == "cmd":
                        msgs[-1]["result"] = re.sub(r"\x1b\[[0-9;]*m", "", out.group(1)).strip()[:2000]
                    continue  # other hook/system injections are not shown
                msgs.append({"role": role, "text": c["text"][:6000]})
            elif t == "thinking" and c.get("thinking", "").strip():
                msgs.append({"role": "think", "text": c["thinking"][:4000]})
            elif t == "tool_use":
                inp = c.get("input", {})
                brief = inp.get("command") or inp.get("description") or inp.get("file_path") or inp.get("pattern") or json.dumps(inp)[:200]
                title = inp.get("description") if inp.get("command") else ""
                msgs.append({"role": "tool", "id": c.get("id"), "name": c.get("name"), "title": str(title or "")[:200], "text": str(brief)[:500], "result": ""})
            elif t == "tool_result":
                r = c.get("content")
                r = "\n".join(x.get("text", "") for x in r if isinstance(x, dict)) if isinstance(r, list) else str(r or "")
                for m in reversed(msgs):
                    if m.get("id") == c.get("tool_use_id"):
                        m["result"], m["error"] = r[:3000], bool(c.get("is_error"))
                        break
    # a queued item is gone once the same text shows up later as a delivered message, or after 15 minutes
    delivered = {m["text"].strip() for m in msgs if m["role"] in ("user", "cmd")}
    cutoff = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 900))
    live = [q for q, ts in queue if q.strip() not in delivered and ts >= cutoff]
    msgs = msgs[-limit:] + [{"role": "queued", "text": q[:6000]} for q in live]
    _meta[str(f)] = meta
    _tcache[str(f)] = (key, msgs)
    return msgs

def history(limit=50):
    out = []
    for f in sorted(PROJECTS.glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit]:
        cwd, title = "", ""
        with f.open(errors="ignore") as fh:
            for line in fh:
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                cwd = cwd or d.get("cwd", "")
                c = d.get("message", {}).get("content") if d.get("type") == "user" else None
                if not title and isinstance(c, str) and not c.startswith("<"):
                    title = c[:90]
                if cwd and title:
                    break
        if title:
            out.append({"sid": f.stem, "cwd": cwd, "title": title, "mtime": int(f.stat().st_mtime)})
    return out

def find_transcript_cwd(sid):
    for f in PROJECTS.glob(f"*/{sid}.jsonl"):
        with f.open(errors="ignore") as fh:
            for line in fh:
                try:
                    cwd = json.loads(line).get("cwd")
                except ValueError:
                    continue
                if cwd:
                    return cwd
    return None

BUILTIN = [("model","Switch model"),("effort","Set thinking effort"),("compact","Summarize to free context"),("clear","Start a fresh conversation"),
           ("cost","Show token use"),("context","Show context usage"),("usage","Show plan limits"),("status","Show session status"),
           ("resume","Resume an old chat"),("rewind","Go back to an earlier point"),("memory","Edit memory files"),("agents","Manage subagents"),
           ("mcp","Manage MCP servers"),("plugin","Manage plugins"),("permissions","Edit permission rules"),("config","Open settings"),
           ("review","Review a pull request"),("init","Create CLAUDE.md for this repo"),("doctor","Check the install"),("help","List commands")]

def commands():
    out = [{"name": n, "desc": d} for n, d in BUILTIN]
    for f in sorted(set((Path.home() / ".claude" / "skills").glob("*/SKILL.md"))):
        m = re.search(r"^description:\s*(.+)$", f.read_text(errors="ignore"), re.M)
        out.append({"name": f.parent.name, "desc": (m.group(1) if m else "Skill")[:90]})
    return out

def usage(account):
    """Exact usage saved by the status line for this account (rate_limits from the API)."""
    try:
        d = json.loads((ACCOUNTS / account / "usage" / "usage.json").read_text())
    except (OSError, ValueError):
        return None
    r = d.get("rate_limits", {})
    return {"session": r.get("five_hour"), "week": r.get("seven_day"), "saved_at": d.get("saved_at")}

def snapshot(s):
    msgs = transcript(s["sid"], s["cwd"])
    st = status(s["name"])
    meta = _meta.get(str(transcript_path(s["sid"], s["cwd"])), {})
    o = overrides.get(s["name"], {})
    if meta.get("model") and not (o.get("model") and time.time() - o.get("t", 0) < 30):
        st["model"] = pretty_model(meta["model"])
    if meta.get("effort") and not (o.get("effort") and time.time() - o.get("t", 0) < 30):
        st["effort"] = meta["effort"]
    ag = agents(s)
    busy = sum(a["running"] for a in ag)
    if busy and st["status"] == "idle":  # main thread waits while agents still work
        st["status"], st["activity"] = "working", f"{busy} agent{'s' * (busy > 1)} working"
    st["title"] = meta.get("custom") or meta.get("title") or ""
    return {**st, "agents": ag, "usage": usage(s["account"]) if s["account"] else None, "messages": msgs, "account": s["account"], "cwd": s["cwd"]}

AGENT_STALE = 1800  # unfinished subagent with no transcript write for 30 min = killed/orphaned

def agents(s):
    """Subagents (from <sid>/subagents/*.meta.json) and agent-team teammates of one session; running first."""
    out, now = [], time.time()
    f = transcript_path(s["sid"], s["cwd"])
    if f:
        for m in (f.parent / s["sid"] / "subagents").glob("agent-*.meta.json"):
            j = m.with_name(m.name.replace(".meta.json", ".jsonl"))
            try:
                d, mt = json.loads(m.read_text()), j.stat().st_mtime
            except (OSError, ValueError):
                continue
            running = d.get("finished") is not True and now - mt < AGENT_STALE
            if running or now - mt < 3600:
                out.append({"kind": "subagent", "name": d.get("agentType") or "agent", "desc": str(d.get("description") or "")[:120],
                            "running": running, "t": mt})
    if s["sid"]:
        for root in [*ACCOUNTS.glob("*/teams"), Path.home() / ".claude" / "teams"]:
            try:
                d = json.loads((root / f"session-{s['sid'][:8]}" / "config.json").read_text())
            except (OSError, ValueError):
                continue
            if d.get("leadSessionId", s["sid"]) != s["sid"]:
                continue
            for mb in d.get("members", []):
                if mb.get("agentType") != "team-lead":
                    out.append({"kind": "teammate", "name": mb.get("name") or "teammate", "desc": mb.get("agentType") or "",
                                "running": mb.get("isActive") is True, "t": now})
            break
    out.sort(key=lambda a: (not a["running"], -a["t"]))
    return [{k: v for k, v in a.items() if k != "t"} for a in out[:12]]

VOICE_MODEL = "gemini-3.8-live"

def gemini_key():
    """GEMINI_LIVE_APIKEY from the environment, else from ~/.env (launchd does not load it)."""
    if os.environ.get("GEMINI_LIVE_APIKEY"):
        return os.environ["GEMINI_LIVE_APIKEY"]
    try:
        m = re.search(r"^\s*(?:export\s+)?GEMINI_LIVE_APIKEY\s*=\s*(.+?)\s*$", (Path.home() / ".env").read_text(), re.M)
    except OSError:
        return None
    if not m:
        return None
    v = m.group(1)
    return v[1:-1] if v[:1] in "'\"" and v[-1:] == v[:1] else v.split(" #")[0].strip()

def voice_token():
    """One-use ephemeral Gemini Live token, so the real API key never reaches the phone."""
    key = gemini_key()
    if not key:
        return 500, {"error": "GEMINI_LIVE_APIKEY is missing from ~/.env."}
    at = lambda sec: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + sec))
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
                                 data=json.dumps({"uses": 1, "expireTime": at(1800), "newSessionExpireTime": at(120)}).encode(),
                                 headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return 200, {"token": json.load(r)["name"], "model": VOICE_MODEL}
    except urllib.error.HTTPError as e:
        print("voice-token:", e.code, e.read()[:500], flush=True)
        return 502, {"error": f"Gemini refused the call token (HTTP {e.code})."}
    except (OSError, ValueError, KeyError) as e:
        return 502, {"error": f"Could not start a Gemini call: {e}"}

def type_line(name, text):
    subprocess.run(["tmux", "send-keys", "-t", name, "-l", text])
    time.sleep(0.12)
    subprocess.run(["tmux", "send-keys", "-t", name, "Enter"])

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def authed(self):
        ip = self.client_address[0]
        a = [int(x) for x in ip.split(".")] if ip.count(".") == 3 else [0, 0]
        if a[0] == 100 and 64 <= a[1] <= 127:
            return True
        q = parse_qs(urlparse(self.path).query).get("t", [""])[0]
        c = next((p.split("=", 1)[1] for p in self.headers.get("Cookie", "").split("; ") if p.startswith("rc=")), "")
        return hmac.compare_digest(q, TOKEN) or hmac.compare_digest(c, TOKEN)

    def send(self, code, body, ctype="application/json", extra=None):
        body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def stream(self, s):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        last, beat = "", time.time()
        try:
            while True:
                s = find(s["name"])  # re-read: /clear and /resume switch the session id under the same tmux pane
                if not s:
                    self.wfile.write(b"event: gone\ndata: {}\n\n"); self.wfile.flush(); return
                data = json.dumps(snapshot(s))
                h = hashlib.md5(data.encode()).hexdigest()
                if h != last:
                    self.wfile.write(f"data: {data}\n\n".encode()); self.wfile.flush(); last = h; beat = time.time()
                elif time.time() - beat > 15:
                    self.wfile.write(b": ping\n\n"); self.wfile.flush(); beat = time.time()
                time.sleep(0.25)
        except (BrokenPipeError, ConnectionResetError):
            return

    def do_GET(self):
        if not self.authed():
            return self.send(401, b"unauthorized", "text/plain")
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/":
            return self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8",
                             {"Set-Cookie": f"rc={TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000"})
        if u.path == "/api/sessions":
            rows = [(s, snapshot(s)) for s in sessions(fresh=True)]
            return self.send(200, {"sessions": [{**s, **{k: v for k, v in sn.items() if k not in ("prompt", "messages", "panel", "usage", "agents")},
                                                 "busy_agents": sum(a["running"] for a in sn["agents"])} for s, sn in rows]})
        if u.path == "/api/file":
            f = Path(q.get("p", [""])[0]).resolve()
            if f.parent != (HERE / "uploads").resolve() or not f.is_file():
                return self.send(404, {})
            ct = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}.get(f.suffix[1:].lower(), "application/octet-stream")
            return self.send(200, f.read_bytes(), ct, {"Cache-Control": "max-age=86400"})
        if u.path == "/api/commands":
            return self.send(200, {"commands": commands()})
        if u.path == "/api/history":
            return self.send(200, {"history": history()})
        if u.path == "/api/old":
            sid = q.get("sid", [""])[0]
            cwd = find_transcript_cwd(sid) if re.fullmatch(r"[0-9a-f-]{36}", sid) else None
            return self.send(200, {"messages": transcript(sid, cwd, 300) if cwd else []})
        if u.path == "/api/voice-token":
            return self.send(*voice_token())
        s = find(q.get("s", [""])[0])
        if not s:
            return self.send(404, {"error": "This session has ended."})
        if u.path == "/api/stream":
            return self.stream(s)
        if u.path == "/api/chat":
            return self.send(200, snapshot(s))
        if u.path == "/api/screen":
            return self.send(200, {"screen": screen(s["name"])})
        self.send(404, {})

    def do_POST(self):
        if not self.authed():
            return self.send(401, b"unauthorized", "text/plain")
        path = urlparse(self.path).path
        n = int(self.headers.get("Content-Length", 0))
        if path == "/api/upload":
            ext = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic"}.get(self.headers.get("Content-Type", ""))
            if not ext or not 0 < n <= 20_000_000:
                self.rfile.read(n)
                return self.send(400, {"error": "Only PNG, JPEG, GIF, WebP or HEIC images up to 20 MB."})
            d = HERE / "uploads"; d.mkdir(exist_ok=True)
            f = d / f"{time.strftime('%Y%m%d-%H%M%S')}-{os.urandom(3).hex()}.{ext}"
            f.write_bytes(self.rfile.read(n))
            if ext == "heic":  # Claude can't read HEIC; convert with macOS sips
                jpg = f.with_suffix(".jpg")
                subprocess.run(["sips", "-s", "format", "jpeg", str(f), "--out", str(jpg)], capture_output=True)
                f.unlink(missing_ok=True); f = jpg
            return self.send(200, {"path": str(f)})
        body = json.loads(self.rfile.read(n) or b"{}")
        s = find(body.get("s", ""))
        if not s:
            return self.send(404, {"error": "This session has ended."})
        name = s["name"]
        if path == "/api/send" and body.get("text"):
            type_line(name, body["text"])
            return self.send(200, {})
        if path == "/api/answer" and body.get("key") in KEYS and body.get("text"):
            subprocess.run(["tmux", "send-keys", "-t", name, KEYS[body["key"]]])
            time.sleep(0.35)
            type_line(name, body["text"])
            return self.send(200, {})
        if path == "/api/key" and body.get("key") in KEYS:
            subprocess.run(["tmux", "send-keys", "-t", name, KEYS[body["key"]]])
            return self.send(200, {})
        if path == "/api/model" and MODEL_OK.match(body.get("model", "")):
            type_line(name, f"/model {body['model']}")
            overrides.setdefault(name, {}).update(model=body["model"], t=time.time())
            return self.send(200, {})
        if path == "/api/effort" and body.get("effort") in EFFORTS:
            type_line(name, f"/effort {body['effort']}")
            overrides.setdefault(name, {}).update(effort=body["effort"], t=time.time())
            return self.send(200, {})
        self.send(400, {"error": "Unsupported request."})

def clean_uploads():
    """Delete uploaded images older than 7 days, hourly."""
    while True:
        for f in (HERE / "uploads").glob("*"):
            if time.time() - f.stat().st_mtime > 7 * 86400:
                f.unlink(missing_ok=True)
        time.sleep(3600)

if __name__ == "__main__":
    threading.Thread(target=clean_uploads, daemon=True).start()
    print(f"remote on http://{HOST}:{PORT}/", flush=True)
    ThreadingHTTPServer.daemon_threads = True
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
