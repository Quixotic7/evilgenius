// SPDX-License-Identifier: MPL-2.0
// The site's own checks (Node, no browser; the Pages workflow runs them):
//   - every page is there and every local link, script, stylesheet and image it names exists;
//   - nothing is loaded from another site (no web fonts, no CDN): scripts, styles and images are the site's own;
//   - the pixel kit's art (js/pxart.js) has the fonts and every sprite a page asks for;
//   - try/: the emulator's files match try/build.json (tools/eg/make_try.py), the wasm is a wasm.
//   node site/tools/test_site.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const check = (ok, msg) => { console.log(`${msg.padEnd(76)} ${ok ? "ok" : "FAIL"}`); if (!ok) fails++; };

const PAGES = ["index.html", "try/index.html", "install/index.html", "manager/index.html"];
const { PXART } = await import(pathToFileURL(path.join(SITE, "js/pxart.js")));
check(PXART.pal.length === 16 && PXART.big && PXART.small, "pxart.js: sixteen colours, two fonts");

for (const page of PAGES) {
  const file = path.join(SITE, page);
  if (!fs.existsSync(file)) { check(false, `${page}: there`); continue; }
  const html = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);
  check(/<title>[^<]+<\/title>/.test(html) && /<meta name="viewport"/.test(html), `${page}: a title, a viewport`);
  const refs = [...html.matchAll(/<(?:script|link|img|a)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const local = refs.filter((r) => !/^(https?:|mailto:|#|data:)/.test(r));
  const missing = local.filter((r) => {
    const p = path.join(dir, r.split(/[?#]/)[0]);
    return !fs.existsSync(p) || (fs.statSync(p).isDirectory() && !fs.existsSync(path.join(p, "index.html")));
  });
  check(missing.length === 0, `${page}: ${local.length} local links${missing.length ? ": missing " + missing.join(", ") : ""}`);
  const loaded = [...html.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
  check(loaded.length === 0, `${page}: nothing loaded from another site${loaded.length ? ": " + loaded.join(", ") : ""}`);
  const sprites = [...html.matchAll(/<px-sprite\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
  const unknown = sprites.filter((s) => !PXART.spr[s]);
  check(unknown.length === 0, `${page}: ${sprites.length} sprites${unknown.length ? ": unknown " + unknown.join(", ") : ""}`);
}

// the manager's modules with no DOM load in Node, each import there (a published module that fails to load is a blank page)
for (const m of ["egwire.js", "egstore.js", "egfiles.js", "eglink.js", "egsysex.js", "egvalues.js", "egsound.js", "eglive.js", "eghelp.js",
  "egsim.js", "egsimdata.js", "egedit.js", "eglibrary.js", "egseq.js", "egseqnames.js", "egseqedit.js", "egseqtab.js", "egpics.js", "eghome.js", "egmix.js", "egkeys.js", "egboot.js"]) {
  let ok = true;
  try { await import(pathToFileURL(path.join(SITE, "manager", m))); } catch (e) { ok = false; console.log(`  ${e.message}`); }
  check(ok, `manager/${m}: loads`);
}

const build = JSON.parse(fs.readFileSync(path.join(SITE, "try/build.json"), "utf8"));
for (const [name, f] of Object.entries(build.files)) {
  const b = fs.readFileSync(path.join(SITE, "try", name));
  check(b.length === f.bytes && crypto.createHash("sha256").update(b).digest("hex") === f.sha256, `try/${name}: as build.json (${f.bytes} B)`);
}
const wasm = fs.readFileSync(path.join(SITE, "try/app.wasm"));
check(wasm.readUInt32LE(0) === 0x6d736100 && WebAssembly.validate(wasm), "try/app.wasm: a valid module");

console.log(fails ? `${fails} FAILED` : "site: all ok");
process.exit(fails ? 1 : 0);
