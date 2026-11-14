// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The install page's checks (Node, no browser; the Pages and release workflows run them), after FIZZ's, for
// EvilGenius's one package:
//   - site/firmware/releases.json and its files: the package's size, SHA-256 and identity (fm1-base's productOf),
//     its update loader, its two data blobs' sizes and SHA-256s; the newest first and "latest"; no release yet is
//     fine (the page says so);
//   - the release notes' Markdown (escaped, links to http(s) only);
//   - site/install/fm1lib.js is what fm1-base makes (firmware/tools/sync_installer.py --check), where the submodule
//     is checked out (not on the Pages runner).
//   node site/tools/test_install.mjs [FIRMWARE_DIR]   (default site/firmware; a dry run's: firmware/release.py --dry-run)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { productOf, logicalImage, ufwEntries } from "../install/fm1lib.js";
import { md } from "../install/notes.js";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(SITE, "..");
const FW = path.resolve(process.argv[2] || path.join(SITE, "firmware"));
let fails = 0;
const check = (ok, msg) => { console.log(`${msg.padEnd(76)} ${ok ? "ok" : "FAIL"}`); if (!ok) fails++; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const versionOfId = (id) => { const m = /^FM-1_45(\d\d)(\d\d)(\d\d)$/.exec(id); return m ? `${+m[1]}.${+m[2]}.${+m[3]}` : ""; };

const index = JSON.parse(fs.readFileSync(path.join(FW, "releases.json"), "utf8"));
const rels = index.releases || [];
check(Array.isArray(rels), `releases.json: ${rels.length} release(s)`);
check(rels.length ? index.latest === rels[0].version : !index.latest, "latest is the first listed (the page's default)");
check(new Set(rels.map((r) => r.version)).size === rels.length, "each version once");
const dated = rels.map((r) => r.date || "");
check(dated.every((d, i) => i === 0 || d <= dated[i - 1]), "the newest first");
for (const r of rels) {
  check(/^\d{1,2}\.\d{1,2}\.\d{1,2}(-beta\.\d{1,3})?(-[a-z0-9]+)?$/.test(r.version) && /^FM-1_45\d{6}$/.test(r.identity),
    `${r.version}: version and identity ${r.identity}`);
  check(versionOfId(r.identity) === r.version.split("-")[0], `${r.version}: identity says ${versionOfId(r.identity)}`);
  check(typeof r.notes === "string" && r.notes.trim().length > 0, `${r.version}: release notes`);
  const html = md(r.notes || "");
  check(!/<script|<img|href="javascript:/i.test(html), `${r.version}: the notes' HTML is plain`);
  const pk = r.packages || [];
  check(pk.length === 1, `${r.version}: one package`);
  for (const p of pk) {
    const f = p.fwsc, file = path.join(FW, f.path);
    if (!fs.existsSync(file)) { check(false, `${f.path}: there`); continue; }
    const raw = new Uint8Array(fs.readFileSync(file));
    check(raw.length === f.bytes && sha(raw) === f.sha256, `${f.path}: ${f.bytes} B, its sha256`);
    check(productOf(raw) === r.identity, `${f.path}: identity ${productOf(raw)}`);
    const ent = ufwEntries(logicalImage(raw));
    check(!!ent[0] && !!ent[100], `${f.path}: flash.bin and the update loader`);
    for (const k of ["data", "data2"]) {
      const d = p[k];
      if (!d) { check(false, `${r.version}: ${k}`); continue; }
      const dp = path.join(FW, d.path);
      const ok = fs.existsSync(dp) && (() => { const b = fs.readFileSync(dp); return b.length === d.bytes && sha(b) === d.sha256; })();
      check(ok, `${d.path}: ${d.bytes} B, its sha256`);
    }
  }
}

// the notes' Markdown: escaped, links to http(s) only
const m = md("**bold** <img src=x onerror=1> [a](javascript:alert(1)) [b](https://example.com/x)\n- one\n- two");
check(m.includes("<b>bold</b>") && !m.includes("<img") && !/href="javascript:/i.test(m) && m.includes('href="https://example.com/x"'),
  "notes.js: bold, lists, escaped HTML, http(s) links only");

// fm1lib.js against the submodule
if (fs.existsSync(path.join(ROOT, "firmware/fm1-base/web/fm1ota.js"))) {
  const r = spawnSync("python3", [path.join(ROOT, "firmware/tools/sync_installer.py"), "--check"], { encoding: "utf8" });
  check(r.status === 0, `fm1lib.js is fm1-base's (sync_installer.py --check)${r.status ? ": " + (r.stdout + r.stderr).trim().split("\n").pop() : ""}`);
} else {
  console.log("fm1lib.js: the submodule is not checked out here (not checked)");
}

console.log(fails ? `${fails} FAILED` : "install: all ok");
process.exit(fails ? 1 : 0);
