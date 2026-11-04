#!/bin/bash
# Compile style.src.css with Tailwind and inline it into index.html (no CDN at runtime).
# First run installs the pinned Tailwind CLI into .tw/ next to this script.
set -e; cd "$(dirname "$0")"
[ -x .tw/node_modules/.bin/tailwindcss ] || npm i --silent --prefix .tw @tailwindcss/cli@4.1.11 tailwindcss@4.1.11
sed 's|@source "./index.html"|@source "../index.html"|' style.src.css > .tw/in.css  # resolve imports from .tw/node_modules
.tw/node_modules/.bin/tailwindcss -i .tw/in.css -o .tw/out.css --minify 2>&1 | grep -v '^≈\|^Done in\|^$' || true
python3 - <<'PY'
import re, pathlib
p = pathlib.Path("index.html"); css = pathlib.Path(".tw/out.css").read_text()
s, n = re.subn(r'<style id="tw">.*?</style>', lambda m: '<style id="tw">' + css + '</style>', p.read_text(), flags=re.S)
assert n == 1, "index.html has no <style id=tw> block"
p.write_text(s); print(f"inlined {len(css)} bytes of CSS")
PY
