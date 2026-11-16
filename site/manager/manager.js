// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager page, the app: eight screens (egkeys.js SCREENS), each its module: HOME (eghome.js), LIBRARY
// (eglibrary.js), SOUND (egedit.js), SEQUENCE (egseqtab.js), MIX (egmix.js), POOL (egpool.js), PROJECTS
// (egprojects.js), CABINET (egcabinet.js: backups, import, MY PRESETS). The work is in eglink.js (the unit), egstore.js
// (the store image), egfiles.js (the files), egsysex.js / egsound.js (the unit's own SysEx, its sounds); this file is
// the page: connect, the status line, one job at a time, the screens.
//   ?sim   a simulated FM-1 (egsim.js) instead of Web MIDI: the page without a unit (the preview, headless checks)
//
// The store is read (FZBI, FZBR) and written whole (FZSR: a restore) by the port; everything else is EvilGenius's own
// SysEx (core/app/fizz_sx.c), which reaches the core since 0.1.0: an import is a STORE6 a sound.
import { findUnit } from "./eglink.js";
import { LAYOUT } from "./egstore.js";
import { mountCabinet } from "./egcabinet.js";
import { mountPool } from "./egpool.js";
import { mountProjects } from "./egprojects.js";
import { mountTransport } from "./egtransport.js";
import { mountEdit } from "./egedit.js";
import { mountLibrary } from "./eglibrary.js";
import { mountSeq } from "./egseqtab.js";
import { mountHome } from "./eghome.js";
import { mountMix } from "./egmix.js";
import { mountKeys, SCREENS, HINTS } from "./egkeys.js";
import { runBoot } from "./egboot.js";

const SIM = new URLSearchParams(location.search).has("sim");
let sim = null;

const $ = (id) => document.getElementById(id);
const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

let access = null, link = null, working = false;
const log = (line) => console.log(`[manager] ${line}`);

// ---- the console: one line of what is happening, the bar, a refusal; the scene beside them
let run = null;
function scene(kind) {
  const actor = $("actor"), prop = $("prop");
  clearInterval(run); run = null;
  $("console").classList.toggle("bad", kind === "refused");
  $("console").classList.toggle("good", kind === "ok");
  $("console").classList.toggle("lit", kind !== "refused" && kind !== "ok");
  prop.setAttribute("name", kind === "ok" ? "DOC" : "CABINET");
  actor.setAttribute("name", kind === "refused" ? "SENTRY1" : kind === "busy" && !still ? "AGENT_RUN1" : "AGENT_STAND");
  if (kind === "busy" && !still) {
    let k = 0;
    run = setInterval(() => actor.setAttribute("name", `AGENT_RUN${1 + (++k % 3)}`), 140);
  }
}
function say(text, kind = "") {
  const s = $("status");
  s.textContent = text;
  if (home && kind !== "busy") home.says(text);
  s.className = `status ${kind === "busy" ? "busy" : kind === "ok" ? "ok" : ""}`.trim();
  $("alert").textContent = "";
  scene(kind);
}
// a refusal: the sentry, and why, in the alert region
function refuse(text) {
  $("status").className = "status";
  $("status").textContent = "Stopped.";
  // (a sentence's first letter; a file's name first stays as it is)
  $("alert").textContent = (/^[a-z]+(\s|$)/.test(text) ? text[0].toUpperCase() + text.slice(1) : text) + (/[.!?]$/.test(text) ? "" : ".");
  bar(0);
  scene("refused");
}
function bar(f) {
  const v = Math.max(0, Math.min(100, Math.round(f * 100)));
  $("barfill").style.width = v + "%";
  $("bar").setAttribute("aria-valuenow", String(v));
}

function keys() {
  $("connect").disabled = working || (!navigator.requestMIDIAccess && !SIM);
  $("connect").classList.toggle("hide", !!link);
  $("disconnect").classList.toggle("hide", !link);
  $("disconnect").disabled = working;
  for (const x of [edit, library, seq, pool, projects, cabinet, transport]) if (x) x.render();
}
// one job at a time; while the unit's store is being written, leaving the page asks first
async function job(fn, { writes = false } = {}) {
  if (working) return false;
  working = true;
  keys();
  if (writes) window.onbeforeunload = (e) => { e.preventDefault(); return (e.returnValue = "The FM-1 is being written."); };
  try { await fn(); }
  catch (e) { fail(e); }
  finally {
    working = false; window.onbeforeunload = null; keys();
    if (afterJob) { const f = afterJob; afterJob = null; f(); }
  }
  return true;
}
function fail(e) {
  log(`failed: ${e && e.code ? e.code + " " : ""}${e && e.message}`);
  if (e && e.code === "lost") { gone(); refuse("the FM-1 was unplugged"); return; }
  let text = (e && e.message) || "something went wrong";
  if (e && e.written) text += ". The FM-1's store was being written when this happened: restore your backup again before you use it";
  refuse(text);
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// ---- the unit
function gone() {
  if (link) link.close();
  link = null;
  for (const x of [edit, seq, home, mix, pool, projects, cabinet, transport]) if (x) x.gone();
  $("unitpill").textContent = "NO FM-1"; $("unitpill").classList.remove("on");
  if (library) library.clear();
  keys();
}
// a project loaded, made, deleted, a store restored, sounds sent: what the screens read is old (each reads again when shown)
// (inside a job: done once the job is over, as each read is a job of its own)
let afterJob = null;
function changed() {
  if (working) { afterJob = changed; return; }
  for (const x of [seq, pool, mix]) if (x) x.gone();
  if (home) home.stale();
  const cur = TABS.find((t) => !$(`tab-${t}`).hidden);
  job(async () => {
    await library.load({ quiet: true }).catch(() => {});
    if (cur === "home") await home.load();
    else if (cur === "pool") await pool.load();
    else if (cur === "mix") await mix.load();
  });
}

async function connect() {
  if (SIM) { sim = sim || new (await import("./egsim.js")).SimUnit({ log }); window.__sim = sim; access = sim.access; }
  if (!access && !navigator.requestMIDIAccess) { refuse("this browser has no Web MIDI. Open this page in Chrome or Edge on a computer"); return; }
  say("Asking the browser for MIDI", "busy");
  try { access = access || await navigator.requestMIDIAccess({ sysex: true }); }
  catch (_) { refuse("the browser did not allow MIDI. Allow MIDI devices for this page (the lock in the address bar), then press CONNECT again"); return; }
  access.onstatechange = () => { if (link && link.io.lost && !working) { gone(); refuse("the FM-1 was unplugged"); } };
  say("Looking for an FM-1", "busy");
  link = await findUnit(access, { log });
  link.log = log;
  if (SIM) link.gap = 0;                                  // (the simulated unit drops nothing: no spacing, no timers)
  try {
    const info = await link.info();
    if (!info) throw new Error(`${link.id} did not say where its store is. Start the FM-1 normally (not in safe mode) and try again`);
    if (info.lo !== LAYOUT.region || info.size !== LAYOUT.size)
      throw new Error(`this EVILGENIUS keeps its store somewhere this page does not know (0x${info.lo.toString(16)}, ${info.size} bytes). Reload the page; if it stays, the page is older than the firmware`);
    const version = await link.version();
    await cabinet.connected(`${version || "EVILGENIUS"}${SIM ? " (SIMULATED)" : ""}`);
    await library.load({ quiet: true }).catch((e) => log(`LIST: ${e.message}`));
    $("unitpill").textContent = `● ${link.id} USB${SIM ? " (SIM)" : ""}`; $("unitpill").classList.add("on");
    if (!$("tab-home").hidden) await home.load().catch((e) => log(`HOME: ${e.message}`));
    if (!$("tab-mix").hidden) await mix.load().catch((e) => log(`MIX: ${e.message}`));
    if (!$("tab-pool").hidden) await pool.load().catch((e) => log(`POOL: ${e.message}`));
    if (!$("tab-projects").hidden) await projects.load().catch((e) => log(`PROJECTS: ${e.message}`));
    say(`Connected. ${plural(cabinet.lib.presets.length, "preset")} in MY PRESETS.`, "ok");
  } catch (e) {
    const lost = e && e.code === "lost";
    gone();
    if (lost) refuse("the FM-1 was unplugged"); else throw e;
  }
}

// ---- the tabs
let edit = null, library = null, seq = null, home = null, mix = null, pool = null, projects = null, cabinet = null, transport = null;
const ctx = { $, log, say, refuse, bar, link: () => link, busy: () => working, job: (fn, o) => job(fn, o), download, changed: () => changed() };
library = mountLibrary({ ...ctx, edit: (snd, origin) => { edit.open(snd, origin); tab("edit"); } });
edit = mountEdit({ ...ctx, onSaved: () => { library.load({ quiet: true }).catch(() => {}); } });
seq = mountSeq(ctx);
home = mountHome({ ...ctx, toSound: (t) => { tab("edit"); edit.readTrackOf(t); }, toSeq: (t) => { seq.track(t); tab("seq"); } });
mix = mountMix(ctx);
pool = mountPool(ctx);
projects = mountProjects(ctx);
cabinet = mountCabinet(ctx);
transport = mountTransport(ctx);
const TABS = SCREENS;
function tab(name) {
  for (const t of TABS) {
    $(`t-${t}`).setAttribute("aria-selected", String(t === name));
    $(`tab-${t}`).hidden = t !== name;
  }
  edit.shown(name === "edit");
  seq.show(name === "seq");
  home.show(name === "home");
  mix.show(name === "mix");
  library.show(name === "library");
  pool.show(name === "pool");
  projects.show(name === "projects");
  cabinet.show(name === "cabinet");
  $("view").scrollTop = 0;
  $("hint").textContent = HINTS[name] || "";
  try { sessionStorage.setItem("eg-tab", name); } catch (_) { /* (no storage: the first tab) */ }
}
for (const t of TABS) $(`t-${t}`).addEventListener("click", () => tab(t));
mountKeys({ $, tab, current: () => TABS.find((t) => !$(`tab-${t}`).hidden) });
document.querySelector(".fkeys").addEventListener("keydown", (e) => {
  const k = TABS.indexOf(document.activeElement.id.slice(2));
  if (k < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  const n = TABS[(k + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
  tab(n); $(`t-${n}`).focus();
});
try { const t = sessionStorage.getItem("eg-tab"); tab(TABS.includes(t) ? t : "home"); } catch (_) { tab("home"); }
runBoot({ $, sim: SIM }).catch(() => {});
// EDIT's read-back: the track followed while the unit changes it (one request a second at most, never during a job)
let polling = false;
setInterval(async () => {
  if (polling || working || !link) return;
  polling = true;
  try { await edit.poll(); await seq.poll(); if (!working) await transport.poll(); } catch (e) { if (e.code === "lost") { gone(); refuse("the FM-1 was unplugged"); } else log(`read-back: ${e.message}`); }
  finally { polling = false; }
}, 1000);

// ---- the keys
if (!navigator.requestMIDIAccess && !SIM) {
  $("nomidi").hidden = false;
  say("This browser has no Web MIDI.");
}
$("connect").addEventListener("click", () => job(connect));
$("disconnect").addEventListener("click", () => { gone(); say("Not connected."); });
keys();
