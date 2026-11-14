#!/usr/bin/env python3
# SPDX-License-Identifier: MPL-2.0
"""EvilGenius's site: the Try page (site/try/), from the browser emulator.

  python3 firmware/build.py --web      the emulator: firmware/app/build/emu/ (app.wasm, worklet.js, index.html)
  python3 tools/eg/make_try.py         site/try/: those files, the page in the site's look

The emulator's page is fm1-base's (its panel, its keyboard and screen reader support): this keeps all of it and
changes what it looks like: no web fonts, the C64's colours, the site's head with its links. site/try/ is committed
(the Pages workflow compiles nothing); site/try/build.json says which commit's code the wasm is.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
EMU = REPO / "firmware" / "app" / "build" / "emu"
OUT = REPO / "site" / "try"

STYLE = """
/* EvilGenius's look over fm1-base's page (tools/eg/make_try.py) */
:root, :root[data-theme="dark"], :root:not([data-theme="light"]) {
  --ground: #000000; --ink: #b2b2b2; --muted: #7b7b7b; --rule: #2e2c9b; --accent: #75cec8; --teal: #56ac4d;
  --card: #000000; --bad: #c46c71; --focus: #edf171; color-scheme: dark; }
html { background: #706deb; }
body { max-width: 1104px; margin: 0 auto; min-height: 100vh; box-sizing: border-box; padding: 24px 24px 48px;
       border-left: 16px solid #706deb; border-right: 16px solid #706deb;
       font: 15px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; }
@media (max-width: 640px) { body { border-width: 0 4px; padding: 16px 12px 40px; } }
h1, .help h2, .speak summary h2, .start button, .bar button, .speak button { font-family: inherit; }
.help h2 { color: #706deb; text-transform: uppercase; letter-spacing: .08em; }
strong, b { color: #ffffff; }
.start button { border-radius: 0; background: #56ac4d; color: #ffffff; border: 4px solid #a9ff9f; box-shadow: 4px 4px 0 #4a4a4a;
                text-transform: uppercase; letter-spacing: .1em; }
.bar button, .speak button, .speak, kbd { border-radius: 0; }
.bar button, .speak button { border: 2px solid #2e2c9b; }
.speak { border: 4px solid #2e2c9b; }
.eg-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin: 0 0 12px; }
.eg-head .where { margin-right: auto; }
.eg-nav { display: flex; gap: 12px; flex-wrap: wrap; margin: 0; }
.eg-nav a { text-decoration: none; padding: 4px 8px; border: 4px solid #2e2c9b; line-height: 0; }
.eg-nav a:hover, .eg-nav a[aria-current="page"] { border-color: #706deb; background: #2e2c9b; }
.eg-rule { height: 4px; border: 0; margin: 0 0 20px; background: repeating-linear-gradient(90deg, #2e2c9b 0 4px, transparent 4px 8px); }
px-text, px-sprite { display: inline-block; line-height: 0; vertical-align: middle; }
px-text canvas, px-sprite canvas { display: block; }
.px-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.eg-foot { max-width: 1040px; margin: 40px auto 0; font-size: 13px; color: #7b7b7b; }
"""

HEAD = """<header class="eg-head">
  <a href="../" aria-label="EVILGENIUS, home"><px-text font="big" scale="3" color="lightred" shadow="red">EVIL</px-text> <px-text font="big" scale="3" color="white" shadow="darkgrey">GENIUS</px-text></a>
  <h1 class="where" style="margin:0;line-height:0"><px-text font="small" scale="3" color="lightblue">TRY IT</px-text></h1>
  <nav class="eg-nav" aria-label="Pages">
    <a href="../"><px-text font="small" scale="2" color="white">HOME</px-text></a>
    <a href="./" aria-current="page"><px-text font="small" scale="2" color="white">TRY</px-text></a>
    <a href="../install/"><px-text font="small" scale="2" color="white">INSTALL</px-text></a>
    <a href="../manager/"><px-text font="small" scale="2" color="white">MANAGER</px-text></a>
  </nav>
</header>
<hr class="eg-rule">
<p style="max-width:1040px;margin:0 auto 16px">The code the FM-1 runs, in this page: press <strong>Switch on</strong>, then PLAY. What you save stays in this browser.</p>"""

FOOT = """<footer class="eg-foot">
<p>Like it? <a href="../install/">Put it on your FM-1</a>. How to play: <a href="https://github.com/Quixotic7/evilgenius/blob/main/PLAYING.md">PLAYING.md</a>.</p>
</footer>
<script type="module" src="../js/px.js"></script>
</body>"""


def main():
    src = EMU / "index.html"
    if not src.exists():
        sys.exit(f"{src}: build the emulator first (python3 firmware/build.py --web)")
    html = src.read_text()
    n = 0

    def sub(pat, rep, count=1, flags=0):
        nonlocal html, n
        html, k = re.subn(pat, lambda m: rep, html, count=count, flags=flags)
        if k < 1:
            sys.exit(f"make_try: the emulator's page has changed: no match for {pat!r}")
        n += k

    sub(r'<link rel="preconnect"[^>]*>\n', "", count=0)
    sub(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>\n', "")
    sub(r"</style>", STYLE + "</style>")
    sub(r"<header>\s*<h1>[^<]*</h1>\s*</header>", HEAD, flags=re.S)
    sub(r"</body>", FOOT)
    sub(r"'Barlow Semi Condensed', 'Arial Narrow', Arial, sans-serif", "ui-monospace, Menlo, Consolas, monospace", count=0)
    if "fonts.g" in html:
        sys.exit("make_try: the page still loads a web font")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(html)
    files = {}
    for f in sorted(EMU.iterdir()):
        if f.is_file() and f.name != "index.html":
            b = f.read_bytes()
            (OUT / f.name).write_bytes(b)
            files[f.name] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
    commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "core", "firmware/app", "firmware/build.py"],
                                cwd=REPO, capture_output=True, text=True).stdout.strip())
    (OUT / "build.json").write_text(json.dumps({"commit": commit, "dirty": dirty, "files": files}, indent=2) + "\n")
    print(f"site/try: index.html ({n} changes), {', '.join(files)}; {commit[:7]}{' +changes' if dirty else ''}")


if __name__ == "__main__":
    main()
