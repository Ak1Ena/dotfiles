"""Claude Code model router (mitmproxy addon). Two listeners:

:8788 forward proxy (Claude's HTTPS_PROXY). Claude still "talks to api.anthropic.com",
      so Remote Control stays allowed. /v1/messages* goes to headroom :8787.
      If headroom is down: route by model directly (same as :8790).
:8790 reverse proxy = headroom's upstream (ANTHROPIC_TARGET_API_URL).
      gpt-/gemini-/codex-/oss- models -> CLIProxyAPI :8317, everything else -> api.anthropic.com.
Everything else (Remote Control, OAuth, telemetry) passes to the real host untouched.
"""
import json, os, re, socket, time
from mitmproxy import http

LOG = os.environ.get("ROUTER_LOG", os.path.expanduser("~/.claude/router/routes.log"))

def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%H:%M:%S ") + msg + "\n")

FORWARD_PORT = int(os.environ.get("ROUTER_FORWARD_PORT", 8788))
UPSTREAM_PORT = int(os.environ.get("ROUTER_UPSTREAM_PORT", 8790))
CLIPROXY = ("127.0.0.1", 8317)
HEADROOM = ("127.0.0.1", int(os.environ.get("ROUTER_HEADROOM_PORT", 8787)))
ALIAS = "claude-via-"
NON_CLAUDE = re.compile(r"^(gpt-|gemini-|codex-|oss-)", re.I)

def _cliproxy_key():
    txt = open("/opt/homebrew/etc/cliproxyapi.conf").read()
    m = re.search(r"^access:.*?\"([0-9a-f]{32,})\"", txt, re.S | re.M)
    return m.group(1) if m else ""

KEY = _cliproxy_key()
_up = {"t": 0.0, "ok": False}

def headroom_up():
    if time.time() - _up["t"] > 10:
        try:
            socket.create_connection(HEADROOM, timeout=0.3).close(); _up["ok"] = True
        except OSError:
            _up["ok"] = False
        _up["t"] = time.time()
    return _up["ok"]

def _send(flow, hostport):
    flow.request.scheme = "http"
    flow.request.host, flow.request.port = hostport

def _route_by_model(flow):
    try:
        model = json.loads(flow.request.get_content() or b"{}").get("model", "")
    except ValueError:
        model = ""
    if model.startswith(ALIAS):
        # Claude Code only accepts claude-* names on first-party, so non-Claude models use an alias
        model = model[len(ALIAS):]
        data = json.loads(flow.request.get_content())
        data["model"] = model
        flow.request.set_content(json.dumps(data).encode())
    if NON_CLAUDE.match(model):
        _send(flow, CLIPROXY)
        flow.request.headers.pop("authorization", None)
        flow.request.headers["x-api-key"] = KEY
        return "cliproxy", model
    return "anthropic", model

def request(flow: http.HTTPFlow):
    if not flow.request.path.startswith("/v1/messages"):
        return
    port = flow.client_conn.sockname[1]
    if port == UPSTREAM_PORT:
        route, model = _route_by_model(flow)
        route = "headroom->" + route
    elif flow.request.pretty_host == "api.anthropic.com" and headroom_up():
        _send(flow, HEADROOM)
        route, model = "headroom", ""
    elif flow.request.pretty_host == "api.anthropic.com":
        route, model = _route_by_model(flow)
        route = "direct->" + route
    else:
        return
    log(f"{route} model={model} port={port} {flow.request.path}")

def responseheaders(flow: http.HTTPFlow):
    flow.response.stream = True  # keep SSE streaming live
