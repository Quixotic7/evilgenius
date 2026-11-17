// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager page, the app: eight screens (egkeys.js SCREENS), each its module: HOME (eghome.js), LIBRARY
// (eglibrary.js), SOUND (egedit.js), SEQUENCE (egseqtab.js), MIX (egmix.js), POOL (egpool.js), PROJECTS
// (egprojects.js), CABINET (egcabinet.js: backups, import, MY PRESETS). The work is in eglink.js (the unit), egstore.js
// (the store image), egfiles.js (the files), egsysex.js / egsound.js (the unit's own SysEx, its sounds); this file is
// the page: connect, the status line, one job at a time, the screens.
//   ?sim   a simulated FM-1 (egsim.js) instead of Web MIDI: the page without a unit (the preview, headless checks)
// The page is an FM-1 itself: the firmware starts in it with the page (egvirtual.js), F9 shows its panel (egpanel.js),
// and sw.js keeps the page for use with no network. CONNECT brings an FM-1 on USB beside it: PROJECTS moves projects
// between the two, WORK ON FM-1 (ALT + W) puts the screens on the unit.
//
// The store is read (FZBI, FZBR) and written whole (FZSR: a restore) by the port; everything else is EvilGenius's own
// SysEx (core/app/fizz_sx.c), which reaches the core since 0.1.0: an import is a STORE6 a sound.
import { findUnit } from "./eglink.js";
import { LAYOUT } from "./egstore.js";
import { mountCabinet } from "./egcabinet.js";
import { mountPool } from "./egpool.js";
import { mountProjects } from "./egprojects.js";
import { mountTransport } from "./egtransport.js";
import { startVirtual } from "./egvirtual.js";
import { mountEdit } from "./egedit.js";
import { mountLibrary } from "./eglibrary.js";
import { mountSeq } from "./egseqtab.js";
import { mountHome } from "./eghome.js";
import { mountMix } from "./egmix.js";
import { mountKeys, SCREENS, HINTS } from "./egkeys.js";
import { runBoot } from "./egboot.js";
import { mountPanel, mountDock } from "./egpanel.js";
import { findRemote, RemoteSession, screenOf, GOTO, HMODE_OF_EDIT, VIEW_OF_SEQ } from "./egremote.js";
import { labelsRequest, parseLabels } from "./egsysex.js";
import { mountMfx } from "./egmfx.js";
import { mountTools } from "./egtools.js";
import { mountFx } from "./egfx.js";
import { mountPat } from "./egpat.js";
import { mountMenu } from "./egmenu.js";

const QUERY = new URLSearchParams(location.search);
const SIM = QUERY.has("sim");
const BROWSER = !SIM || QUERY.has("v");                   // the FM-1 in this page starts with it (not for ?sim alone: the checks)
let sim = null;

const $ = (id) => document.getElementById(id);
const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// link: the FM-1 every screen works on. It is the one in this page (vu.link: the firmware itself, egvirtual.js, started
// with the page) unless WORK ON FM-1 puts the screens on the one on USB (ulink), which is otherwise the place projects
// are sent to and taken from (PROJECTS).
let access = null, link = null, working = false, vu = null, ulink = null;
let remote = null, panelUnit = null;                      // (REMOTE MODE: an FM-1 as the panel of the one in this page, egremote.js: one
                                                          // running RemoteFM1, or EVILGENIUS in its REMOTE MODE: panelUnit, found at CONNECT)
const inPage = () => !!vu && link === vu.link;
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
  $("connect").classList.toggle("hide", !!ulink || !!remote);
  $("virtual").classList.toggle("hide", !BROWSER || !!vu);   // (only when the one in this page did not start)
  $("virtual").disabled = working;
  $("disconnect").classList.toggle("hide", !ulink && !remote);
  $("disconnect").disabled = working;
  $("workon").classList.toggle("hide", !(vu && ulink));
  $("workon").disabled = working;
  $("workon").textContent = inPage() ? "WORK ON FM-1" : "WORK IN BROWSER";
  $("aspanel").classList.toggle("hide", !(vu && panelUnit && ulink));
  $("aspanel").disabled = working;
  $("aspanel").textContent = remote ? "REMOTE OFF" : "REMOTE MODE";
  dockSync();
  $("unitpill").textContent = !link ? "NO FM-1" : inPage() ? `● IN THIS BROWSER${ulink ? ` · ${ulink.id} ${remote ? "ITS REMOTE" : "ON USB"}` : remote ? ` · ${remote.hello.name} ITS REMOTE` : ""}` : `● ${link.id} USB${SIM ? " (SIM)" : ""}`;
  $("unitpill").classList.toggle("on", !!link);
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
  if (e && e.code === "lost") { unitGone(); refuse("the FM-1 was unplugged"); return; }
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
// REMOTE MODE: THE UNIT AND THE MANAGER AS ONE. The FM-1's screen in a band at the very top with THE STRIP beside it
// (egpanel.js mountDock; HOME shows the brain again meanwhile). The manager's screens follow the unit (egremote.js
// screenOf): its sequencer views open SEQUENCE in the same view, MIX MIX, EDIT SOUND on the selected track and on the
// page its black keys picked, the browser LIBRARY, the projects PROJECTS, and a page with no screen of its own here
// (MIDI FX, TOOLS, EFFECTS, the settings) THE FM-1 (F9), named after it. And the other way (GOTO): a screen picked
// here takes the unit to its page. Only a change moves either, so nothing fights the hand.
let docked = false, followed = "", viewNow = -1, driving = false;
function dockSync() {
  const on = (!!remote || QUERY.has("dock")) && !!vu;   // (?dock: the looks with no unit, for the checks)
  if (on === docked || !dock || !home) return;
  docked = on;
  dock.show(on);
  followed = "";
  home.unit(inPage() && !on ? vu : null);
}
function follow(view) {
  viewNow = view;
  if (driving || !inPage()) return;                         // (the FM-1 in the page and the manager are one, docked or not)
  const s = screenOf(view), key = s ? `${s.tab} ${s.title} ${s.track} ${s.seqView || ""} ${s.value ?? ""} ${s.hmode ?? ""}` : "";
  if (!s || key === followed) return;
  const was = followed.split(" ");
  followed = key;
  dock.title(s.title); panel.title(s.title);
  if (!s.tab || working) return;
  const cur = TABS.find((t) => !$(`tab-${t}`).hidden);
  if (s.tab === "seq") { seq.track(s.track); if (s.seqView) seq.view(s.seqView); if (s.hmode !== undefined) seq.mode(HMODE_OF_EDIT.indexOf(s.hmode)); }
  if (s.tab !== cur) tab(s.tab);
  if (s.tab === "edit") {
    if (cur !== "edit" || Number(was[was.length - 4]) !== s.track) edit.readTrackOf(s.track);
    edit.showValue(s.value);
  }
}
// a screen picked here (a tab, a key of THE FM-1): the unit goes to its page (GOTO), its button tapped until it is there
async function drive(where) {
  const g = GOTO[where];
  if (!g || !vu || !inPage() || driving || viewNow < 0) return;
  driving = true;
  try {
    for (let k = 0; k < 3 && !g.there(viewNow); k++) {
      vu.buttons(1 << g.btn, "drive");
      await new Promise((r) => setTimeout(r, 90));
      vu.buttons(0, "drive");
      await new Promise((r) => setTimeout(r, 260));
    }
  } finally { driving = false; followed = ""; follow(viewNow); }
}
// the unit's own words for what each control does now (LABELS), for THE STRIP and THE FM-1: asked while either shows
let labelling = false, labelsWas = "";
setInterval(async () => {
  if (labelling || working || !vu || !inPage() || !(docked || panel.isOpen())) return;   // (only while a drawing of the unit shows)
  labelling = true;
  try {
    const l = await vu.link.turn(() => { vu.link.io.drain(); return vu.link.ask(labelsRequest(), (p) => parseLabels(p) ?? undefined, { timeout: 300, tries: 1 }); });
    if (l && l.list.join("|") !== labelsWas) { labelsWas = l.list.join("|"); dock.labels(l); panel.labels(l); }
  } catch (_) { /* (asked again next time) */ } finally { labelling = false; }
}, 300);

// ---- the unit
// the FM-1 on USB is gone: if the screens were on it, they go back to the one in this page
function unitGone() {
  const was = !!ulink && link === ulink;
  if (remote && panelUnit) { remote.stop(); remote = null; }
  panelUnit = null;
  if (ulink) ulink.close();
  ulink = null;
  if (was || !link) {
    link = null;
    for (const x of [edit, seq, home, mix, pool, projects, cabinet, transport]) if (x) x.gone();
    if (library) library.clear();
    if (vu) later(() => job(() => workOn(vu.link)));
  }
  keys();
}
// (inside a job: once it is over)
function later(fn) { if (working) afterJob = fn; else fn(); }
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

// the screens on another FM-1 (the one in this page, the one on USB): each reads it when shown
async function settle() {
  const version = await link.version();
  await cabinet.connected(`${version || "EVILGENIUS"}${inPage() ? " (IN THIS BROWSER)" : SIM ? " (SIMULATED)" : ""}`);
  await library.load({ quiet: true }).catch((e) => log(`LIST: ${e.message}`));
  home.unit(inPage() && !docked ? vu : null);
  keys();
  if (!$("tab-home").hidden) await home.load().catch((e) => log(`HOME: ${e.message}`));
  if (!$("tab-mix").hidden) await mix.load().catch((e) => log(`MIX: ${e.message}`));
  if (!$("tab-pool").hidden) await pool.load().catch((e) => log(`POOL: ${e.message}`));
  if (!$("tab-projects").hidden) await projects.load().catch((e) => log(`PROJECTS: ${e.message}`));
}
async function workOn(l) {
  if (!l || link === l) return;
  link = l;
  for (const x of [edit, seq, mix, pool, projects, cabinet, transport]) x.gone();
  home.stale();
  library.clear();
  say(inPage() ? "Back on the FM-1 in this browser" : `Putting the screens on ${l.id}`, "busy");
  await settle();
  say(inPage() ? "Working in this browser. The FM-1 on USB takes and gives projects (PROJECTS)." : `Working on ${l.id} on USB: every screen is the unit's now. WORK IN BROWSER (ALT + W) comes back.`, "ok");
}

// the FM-1 in this page: the firmware itself (egvirtual.js), started with the page, its store kept in this browser
async function startBrowser() {
  say("Starting the FM-1 in this browser", "busy");
  vu = await startVirtual({ log, onWait: () => say("Press a key or click: the FM-1 in this browser starts.") });
  window.__vu = vu;                                         // (for the tests, as window.__sim)
  panel.unit(vu); dock.unit(vu);
  vu.onFrame((m) => follow(m.view));
  let knobsAt = 0;                                          // (SOUND marks the values the unit's knobs turn now)
  vu.onFrame((m) => { const t = performance.now(); if (m.live && inPage() && t - knobsAt > 100 && !$("tab-edit").hidden) { knobsAt = t; edit.knobs(m.live); } });
  if (link) { keys(); projects.load().catch(() => {}); return; }   // (the screens are on the one on USB already)
  link = vu.link;
  say("Starting the FM-1 in this browser", "busy");
  await settle();
  say(vu.savedAt ? `Ready. Your FM-1 in this browser is as you left it (${new Date(vu.savedAt).toLocaleString()}).` : "Ready. This is an FM-1 in your browser: what you make is kept here.", "ok");
}

// the FM-1 on USB: beside the one in this page it is where projects go to and come from (PROJECTS), and WORK ON FM-1
// puts the screens on it; with no FM-1 in the page (?sim) the screens are on it at once
async function connect() {
  if (SIM) { sim = sim || new (await import("./egsim.js")).SimUnit({ log }); window.__sim = sim; access = sim.access; }
  if (!access && !navigator.requestMIDIAccess) { refuse("this browser has no Web MIDI. Open this page in Chrome or Edge on a computer"); return; }
  say("Asking the browser for MIDI", "busy");
  try { access = access || await navigator.requestMIDIAccess({ sysex: true }); }
  catch (_) { refuse("the browser did not allow MIDI. Allow MIDI devices for this page (the lock in the address bar), then press CONNECT again"); return; }
  access.onstatechange = () => { if (ulink && ulink.io.lost && !working) { unitGone(); refuse("the FM-1 was unplugged"); } };
  say("Looking for an FM-1", "busy");
  // an FM-1 running RemoteFM1: it becomes the panel of the FM-1 in this page (its keys, knobs, lights and screen)
  if (vu && !remote) {
    const r = await findRemote(access, { log });
    panelUnit = r && /^EVILGENIUS/.test(r.hello.name) ? r : null;   // (EVILGENIUS with REMOTE MODE: ALT + P, once it is linked)
    if (r && !panelUnit) {
      remote = new RemoteSession(r, vu, { log, onLost: () => { remote = null; keys(); refuse("the FM-1 in REMOTE MODE is gone"); } });
      await remote.start();
      keys();
      say(`REMOTE MODE: ${remote.id} plays the FM-1 in this browser${remote.screen ? ", and its screen shows it" : " (over Bluetooth: the lights, no screen)"}.`, "ok");
      return;
    }
  }
  ulink = await findUnit(access, { log });
  ulink.log = log;
  if (SIM) ulink.gap = 0;                                 // (the simulated unit drops nothing: no spacing, no timers)
  try {
    const info = await ulink.info();
    if (!info) throw new Error(`${ulink.id} did not say where its store is. Start the FM-1 normally (not in safe mode) and try again`);
    if (info.lo !== LAYOUT.region || info.size !== LAYOUT.size)
      throw new Error(`this EVILGENIUS keeps its store somewhere this page does not know (0x${info.lo.toString(16)}, ${info.size} bytes). Reload the page; if it stays, the page is older than the firmware`);
    if (vu) {
      keys();
      await projects.load().catch((e) => log(`PROJECTS: ${e.message}`));
      say(`${ulink.id} is connected: PROJECTS moves projects to it and from it. ALT + W works on it.${panelUnit ? " ALT + P: REMOTE MODE." : ""}`, "ok");
      return;
    }
    link = ulink;
    await settle();
    say(`Connected. ${plural(cabinet.lib.presets.length, "preset")} in MY PRESETS.`, "ok");
  } catch (e) {
    const lost = e && e.code === "lost";
    unitGone();
    if (lost) refuse("the FM-1 was unplugged"); else throw e;
  }
}

// ---- the tabs
let edit = null, library = null, seq = null, home = null, mix = null, pool = null, projects = null, cabinet = null, transport = null, panel = null, dock = null;
let mfx = null, tools = null, fx = null, pat = null, menu = null;
// (other: the FM-1 the screens are not on, when there are two: PROJECTS sends to it and takes from it)
let tabBefore = "home";
const ctx = { $, log, say, refuse, bar, link: () => link, busy: () => working, job: (fn, o) => job(fn, o), download, changed: () => changed(),
  tab: (name) => tab(name), back: () => tab(tabBefore === "fm1" ? "home" : tabBefore), go: (where) => drive(where), pick: (name) => pick(name),
  unit: () => (inPage() ? vu : null),
  // what was picked by hand in a screen (SEQUENCE's track, EDIT mode and view; SOUND's page): the unit goes there too
  onNav: (kind, v) => {
    if (!vu || !inPage() || driving) return;
    if (kind === "track") vu.nav(0, v);
    else if (kind === "mode" && HMODE_OF_EDIT[v] >= 0) vu.nav(1, HMODE_OF_EDIT[v]);
    else if (kind === "view" && VIEW_OF_SEQ[v] !== undefined) vu.nav(2, VIEW_OF_SEQ[v]);
    else if (kind === "page") vu.nav(3, v);
  },                     // (the FM-1 in this page, while the screens are on it: its own calls)
  other: () => (vu && ulink ? (inPage() ? ulink : vu.link) : null) };
library = mountLibrary({ ...ctx, edit: (snd, origin) => { edit.open(snd, origin); tab("edit"); } });
edit = mountEdit({ ...ctx, onSaved: () => { library.load({ quiet: true }).catch(() => {}); } });
seq = mountSeq(ctx);
home = mountHome({ ...ctx, toSound: (t) => { tab("edit"); edit.readTrackOf(t); }, toSeq: (t) => { seq.track(t); tab("seq"); }, panel: () => panel.open(true) });
mix = mountMix(ctx);
pool = mountPool(ctx);
projects = mountProjects(ctx);
cabinet = mountCabinet(ctx);
transport = mountTransport(ctx);
panel = mountPanel(ctx);
mfx = mountMfx(ctx);
tools = mountTools(ctx);
fx = mountFx(ctx);
pat = mountPat(ctx);
menu = mountMenu(ctx);
dock = mountDock({ $, open: () => panel.open(true) });
const TABS = SCREENS;
function tab(name) {
  const cur = TABS.find((t) => !$(`tab-${t}`).hidden);
  if (cur && cur !== name) tabBefore = cur;
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
  panel.show(name === "fm1");
  mfx.show(name === "mfx");
  tools.show(name === "tools");
  fx.show(name === "fx");
  pat.show(name === "pat");
  menu.show(name === "set");
  $("view").scrollTop = 0;
  $("hint").textContent = HINTS[name] || "";
  try { sessionStorage.setItem("eg-tab", name); } catch (_) { /* (no storage: the first tab) */ }
}
// (a screen picked by hand: in REMOTE MODE the unit goes to its page too)
// (EFFECTS, PATTERNS, SETTINGS: the screen opens its own page on the unit, the one it shows)
const OWN_DRIVE = { fx: () => fx, pat: () => pat, set: () => menu };
function pick(t) { tab(t); if (OWN_DRIVE[t] && vu && inPage()) OWN_DRIVE[t]().drive(); else drive(t); }
for (const t of TABS) $(`t-${t}`).addEventListener("click", () => pick(t));
mountKeys({ $, tab: pick, current: () => TABS.find((t) => !$(`tab-${t}`).hidden) });
document.querySelector(".fkeys").addEventListener("keydown", (e) => {
  const k = TABS.indexOf(document.activeElement.id.slice(2));
  if (k < 0 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  const n = TABS[(k + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
  tab(n); $(`t-${n}`).focus();
});
try { const t = sessionStorage.getItem("eg-tab"); tab(TABS.includes(t) ? t : "home"); } catch (_) { tab("home"); }
runBoot({ $, sim: SIM }).catch(() => {}).then(() => { if (BROWSER) job(startBrowser); });
// EDIT's read-back: the track followed while the unit changes it (one request a second at most, never during a job)
let polling = false;
setInterval(async () => {
  if (polling || working || !link) return;
  polling = true;
  try {
    await edit.poll(); await seq.poll(); if (!working) await transport.poll();
    // the FM-1 in this page is followed, not read: what its own panel changed shows on the screen looked at
    if (link && link.virtual) for (const x of [home, mix, pool, projects]) if (!working && link && link.virtual) await x.follow();
  } catch (e) { if (e.code === "lost") { unitGone(); refuse("the FM-1 was unplugged"); } else log(`read-back: ${e.message}`); }
  finally { polling = false; }
}, 1000);

// ---- the keys
if (!navigator.requestMIDIAccess && !SIM && !BROWSER) {
  $("nomidi").hidden = false;
  say("This browser has no Web MIDI.");
}
// offline: the page, its modules and the virtual FM-1's firmware kept by sw.js (not for ?sim: the headless checks;
// not for ?nosw: a preview whose worker cannot reach the network answers from what it kept, the page before an edit)
if ("serviceWorker" in navigator && !SIM && !QUERY.has("nosw")) navigator.serviceWorker.register("./sw.js").then(() => log("offline: kept by sw.js"), (e) => log(`offline: no service worker (${e.message})`));
$("connect").addEventListener("click", () => job(connect));
$("virtual").addEventListener("click", () => job(startBrowser));
$("disconnect").addEventListener("click", () => { if (remote) { remote.stop(); remote = null; } unitGone(); say(vu ? "The FM-1 on USB is let go. The one in this browser plays on." : "Not connected."); });
$("workon").addEventListener("click", () => job(() => workOn(ctx.other())));
// REMOTE MODE: EVILGENIUS as the panel of the FM-1 in this page: its keys, knobs and lights; it is silent meanwhile
async function asPanel() {
  if (!vu || !panelUnit || !ulink) return;
  if (remote) { remote.stop(); remote = null; keys(); say(`${ulink.id} is itself again.`, "ok"); return; }
  remote = new RemoteSession(panelUnit, vu, { log, onLost: () => { remote = null; keys(); say(`${ulink ? ulink.id : "The FM-1"} left REMOTE MODE.`); } });
  await remote.start();
  keys();
  say(`REMOTE MODE: ${ulink.id} plays the FM-1 in this browser, and its page keys open the screens here. ALT + P ends it.`, "ok");
}
$("aspanel").addEventListener("click", () => job(asPanel));
document.addEventListener("keydown", (e) => { if (e.altKey && e.code === "KeyP" && !e.metaKey && !e.ctrlKey && panelUnit && ulink) { e.preventDefault(); job(asPanel); } });
document.addEventListener("keydown", (e) => { if (e.altKey && e.code === "KeyW" && !e.metaKey && !e.ctrlKey && ctx.other()) { e.preventDefault(); job(() => workOn(ctx.other())); } });
keys();
