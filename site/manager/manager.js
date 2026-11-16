// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EvilGenius's manager page: connect, back up and restore the store, export and import MY PRESETS (CABINET), the
// unit's sounds (LIBRARY: eglibrary.js), a sound edited, live on a track if asked (EDIT: egedit.js). The work is in
// eglink.js (the unit), egstore.js (the store image), egfiles.js (the files), egsysex.js / egsound.js (the unit's
// own SysEx, its sounds); this file is the page.
//   ?sim   a simulated FM-1 (egsim.js) instead of Web MIDI: the page without a unit (the preview, headless checks)
//
// The store is read (FZBI, FZBR) and written whole (FZSR) by the port; the presets are read out of the store's image,
// and imported by writing the store back with them added (plan()'s text says so). EvilGenius's own SysEx (core/app/
// fizz_sx.c: STATUS, LIST, DUMP, STORE6, PARAM ..) reaches the core since 0.1.0 (app.c's gate): egsysex.js and
// eglink.js speak it, egsound.js reads and packs its sounds; the page's tabs that use it come next.
import { findUnit } from "./eglink.js";
import { LAYOUT, LIB_BYTES, readImage, readLibrary, addPresets, tagNames } from "./egstore.js";
import { backupName, soundName, soundsName, soundFile, soundsFile, readSounds } from "./egfiles.js";
import { mountEdit } from "./egedit.js";
import { mountLibrary } from "./eglibrary.js";
import { mountSeq } from "./egseqtab.js";
import { mountHome } from "./eghome.js";
import { mountMix } from "./egmix.js";
import { mountKeys, SCREENS } from "./egkeys.js";
import { runBoot } from "./egboot.js";

const SIM = new URLSearchParams(location.search).has("sim");
let sim = null;

const $ = (id) => document.getElementById(id);
const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

let access = null, link = null, lib = null, working = false;
let toRestore = null, toImport = null;                  // a backup read from a file; sounds read from files
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
  const on = !!link && !working;
  $("connect").disabled = working || (!navigator.requestMIDIAccess && !SIM);
  $("connect").classList.toggle("hide", !!link);
  $("disconnect").classList.toggle("hide", !link);
  $("disconnect").disabled = working;
  $("backup").disabled = !on;
  $("restore").disabled = !on;
  $("import").disabled = !on;
  $("exportall").disabled = !on || !lib || !lib.presets.length;
  for (const b of document.querySelectorAll("#presetrows button, #restorego, #importgo, #restoreno, #importno")) b.disabled = !on;
  if (edit) edit.render();
  if (library) library.render();
  if (seq) seq.render();
}
// one job at a time; while the unit's store is being written, leaving the page asks first
async function job(fn, { writes = false } = {}) {
  if (working) return false;
  working = true;
  keys();
  if (writes) window.onbeforeunload = (e) => { e.preventDefault(); return (e.returnValue = "The FM-1 is being written."); };
  try { await fn(); }
  catch (e) { fail(e); }
  finally { working = false; window.onbeforeunload = null; keys(); }
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
const pxText = (text, font = "small", scale = 2) => {
  const t = document.createElement("px-text");
  t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", "white");
  t.textContent = text;
  return t;
};
const li = (text) => { const x = document.createElement("li"); x.textContent = text; return x; };
const from = () => ({ firmware: link ? link.id : "", store: lib ? lib.magic : "", date: new Date().toISOString() });

// ---- the unit
function gone() {
  if (link) link.close();
  link = null; lib = null; toRestore = null; toImport = null;
  if (edit) edit.gone();
  if (seq) seq.gone();
  if (home) home.gone();
  if (mix) mix.gone();
  $("unitpill").textContent = "NO FM-1"; $("unitpill").classList.remove("on");
  if (library) library.clear();
  $("unit").textContent = "No FM-1 yet.";
  $("restoreplan").hidden = true; $("importplan").hidden = true;
  showPresets();
  keys();
}

function showPresets() {
  const rows = $("presetrows");
  rows.textContent = "";
  $("presets").hidden = !lib || !lib.presets.length;
  $("presetnote").textContent = !lib ? "Connect an FM-1 to see its presets."
    : lib.presets.length ? `${plural(lib.presets.length, "preset")} in MY PRESETS, ${plural(LAYOUT.nlib - lib.presets.length, "free place")}.`
    : `MY PRESETS is empty: ${LAYOUT.nlib} free places.`;
  if (!lib) return;
  for (const p of lib.presets) {
    const tr = document.createElement("tr");
    const place = document.createElement("td"), name = document.createElement("td"), tags = document.createElement("td"), act = document.createElement("td");
    place.textContent = String(p.slot);
    name.textContent = p.name; name.className = "name";
    tags.textContent = tagNames(p.tags).join(", ");
    const b = document.createElement("button");
    b.type = "button"; b.className = "key plain";
    b.setAttribute("aria-label", `Export ${p.name}`);
    b.append(pxText("EXPORT"));
    b.addEventListener("click", () => {
      download(soundName(p), soundFile(p, from()), "application/json");
      say(`Saved ${soundName(p)} to your downloads.`, "ok");
    });
    act.append(b);
    tr.append(place, name, tags, act);
    rows.append(tr);
  }
}

// MY PRESETS read from the unit (its first sectors: two seconds)
async function readPresets(text = "Reading MY PRESETS") {
  say(text, "busy");
  const r = await link.library((f) => bar(f));
  lib = readLibrary(r.bytes);
  showPresets();
  bar(0);
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
    await readPresets();
    $("unit").textContent = `${version || "EVILGENIUS"} on an FM-1 (${link.id}), MIDI port "${link.port}"${SIM ? " (SIMULATED)" : ""}. Store ${lib.magic || "empty"}.`;
    await library.load({ quiet: true }).catch((e) => log(`LIST: ${e.message}`));
    $("unitpill").textContent = `● ${link.id} USB${SIM ? " (SIM)" : ""}`; $("unitpill").classList.add("on");
    if (!$("tab-home").hidden) await home.load().catch((e) => log(`HOME: ${e.message}`));
    if (!$("tab-mix").hidden) await mix.load().catch((e) => log(`MIX: ${e.message}`));
    say(`Connected. ${plural(lib.presets.length, "preset")} in MY PRESETS.`, "ok");
  } catch (e) {
    const lost = e && e.code === "lost";
    gone();
    if (lost) refuse("the FM-1 was unplugged"); else throw e;
  }
}

// ---- backup
async function backup() {
  say("Searching the cabinet: reading the store", "busy");
  const r = await link.backup((f) => bar(f));
  const s = readImage(r.image);
  const name = backupName();
  download(name, r.image, "application/octet-stream");
  lib = { ...lib, ...s };
  showPresets();
  bar(1);
  say(`Saved ${name} to your downloads: ${describe(s)}.`, "ok");
}
const describe = (s) => s.blank ? "an empty store"
  : `${plural(s.projects.length, "project")}${s.projects.length ? ` (${s.projects.map((p) => p.name || `PROJECT ${p.slot}`).join(", ")})` : ""} and ${plural(s.presets.length, "preset")}`;

// ---- restore
async function pickRestore(file) {
  bar(0);
  $("restoreplan").hidden = true;
  toRestore = null;
  const image = new Uint8Array(await file.arrayBuffer());
  let s;
  try { s = readImage(image); } catch (e) { refuse(`${file.name}: ${e.message}`); return; }
  if (s.magic && lib && lib.magic && s.magic !== lib.magic) {
    refuse(`${file.name} is from another EVILGENIUS version (its store is ${s.magic}, this FM-1's is ${lib.magic}). This FM-1 would erase it`);
    return;
  }
  toRestore = { image, name: file.name };
  $("restoretext").textContent = `${file.name} holds ${describe(s)}.` + (s.blank ? " Restoring it erases the FM-1's store." : "");
  const list = $("restorelist");
  list.textContent = "";
  for (const p of s.projects) list.append(li(`Project ${p.slot}: ${p.name || "(no name)"}`));
  if (s.presets.length) list.append(li(`MY PRESETS: ${s.presets.slice(0, 12).map((p) => p.name).join(", ")}${s.presets.length > 12 ? `, and ${s.presets.length - 12} more` : ""}`));
  $("restoreplan").hidden = false;
  say(`${file.name} is an EVILGENIUS backup. Read what it holds, then choose.`);
}
const phase = (what) => (p) => say(p === "check" ? `${what}: the FM-1 checks the file` : `${what}: the FM-1 writes its store. Do not unplug it`, "busy");

async function restore() {
  const { image, name } = toRestore;
  $("restoreplan").hidden = true;
  toRestore = null;
  await link.restore(image, { onProgress: (f) => bar(f), onPhase: phase("Restoring") });
  bar(1);
  await sleep(1200);                                      // (the FM-1 starts again on the store)
  await readPresets("Restored. Reading MY PRESETS");
  say(`Restored ${name}. ${plural(lib.presets.length, "preset")} in MY PRESETS.`, "ok");
}

// ---- import
async function pickImport(files) {
  bar(0);
  $("importplan").hidden = true;
  toImport = null;
  const sounds = [], bad = [];
  for (const f of files) {
    try { sounds.push(...readSounds(new Uint8Array(await f.arrayBuffer()), f.name)); }
    catch (e) { bad.push(e.message); }
  }
  if (!sounds.length) { refuse(bad[0] || "no file was chosen"); return; }
  toImport = sounds;
  $("importtext").textContent = `${plural(sounds.length, "sound")} read from ${plural(files.length, "file")}.` +
    (bad.length ? ` ${plural(bad.length, "file")} left out.` : "");
  const list = $("importlist");
  list.textContent = "";
  for (const s of sounds.slice(0, 16)) list.append(li(s.name));
  if (sounds.length > 16) list.append(li(`and ${sounds.length - 16} more`));
  for (const b of bad) list.append(li(`Left out: ${b}`));
  $("importplan").hidden = false;
  say("Read what will be imported, then choose.");
}

async function importNow() {
  const sounds = toImport;
  $("importplan").hidden = true;
  toImport = null;
  let made = null, before = null;
  for (let attempt = 1; !made; attempt++) {
    say("Reading the FM-1's store", "busy");
    before = await link.backup((f) => bar(f * 0.4));
    const r = addPresets(before.image, sounds, { magic: lib ? lib.magic : "" });
    if (!r.added.length) { bar(0); say(`Nothing to import: ${r.skipped.length === 1 ? "that sound is" : `all ${r.skipped.length} sounds are`} already in MY PRESETS.`, "ok"); return; }
    // the new image read again as the unit would: the new presets there, the projects' sectors as they were
    const after = readImage(r.image);
    const there = r.added.every((a) => after.presets.some((p) => p.slot === a.slot && p.name === a.name && p.id === a.id));
    const same = r.image.subarray(LIB_BYTES).every((x, i) => x === before.image[LIB_BYTES + i]);
    if (!there || !same || after.presets.length !== readImage(before.image).presets.length + r.added.length)
      throw new Error("the new store did not read back right. Nothing was written to the FM-1");
    const now = await link.info();
    if (now && now.crc === before.crc) made = r;
    else if (attempt >= 3) throw new Error("the FM-1 keeps changing its store. Stop it, leave it alone, and try again. Nothing was written");
  }
  const safety = backupName().replace(/\.egbak$/, " before import.egbak");
  download(safety, before.image, "application/octet-stream");
  await link.restore(made.image, { onProgress: (f) => bar(0.4 + f * 0.6), onPhase: phase("Importing") });
  bar(1);
  await sleep(1200);
  await readPresets("Written. Reading MY PRESETS");
  const missing = made.added.filter((a) => !lib.presets.some((p) => p.slot === a.slot && p.name === a.name));
  if (missing.length) throw new Error(`the FM-1 took the store but ${missing.map((m) => m.name).join(", ")} did not show up in MY PRESETS. The store from before is in your downloads: ${safety}`);
  say(`Imported ${plural(made.added.length, "preset")}: ${made.added.slice(0, 6).map((a) => `${a.name} (place ${a.slot})`).join(", ")}${made.added.length > 6 ? ", .." : ""}.` +
    (made.skipped.length ? ` ${plural(made.skipped.length, "sound")} already there.` : "") + ` The store from before is in your downloads: ${safety}.`, "ok");
}

// ---- the tabs
let edit = null, library = null, seq = null, home = null, mix = null;
const ctx = { $, log, say, refuse, link: () => link, busy: () => working, job: (fn) => job(fn), download };
library = mountLibrary({ ...ctx, edit: (snd, origin) => { edit.open(snd, origin); tab("edit"); } });
edit = mountEdit({ ...ctx, onSaved: () => { library.load({ quiet: true }).catch(() => {}); } });
seq = mountSeq(ctx);
home = mountHome({ ...ctx, toSound: (t) => { tab("edit"); edit.readTrackOf(t); }, toSeq: (t) => { seq.track(t); tab("seq"); } });
mix = mountMix(ctx);
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
  $("view").scrollTop = 0;
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
  try { await edit.poll(); await seq.poll(); } catch (e) { if (e.code === "lost") { gone(); refuse("the FM-1 was unplugged"); } else log(`read-back: ${e.message}`); }
  finally { polling = false; }
}, 1000);

// ---- the keys
if (!navigator.requestMIDIAccess && !SIM) {
  $("nomidi").hidden = false;
  say("This browser has no Web MIDI.");
}
$("connect").addEventListener("click", () => job(connect));
$("disconnect").addEventListener("click", () => { gone(); say("Not connected."); });
$("backup").addEventListener("click", () => job(backup));
$("restore").addEventListener("click", () => $("restorefile").click());
$("restorefile").addEventListener("change", (ev) => { const f = ev.target.files[0]; ev.target.value = ""; if (f) job(() => pickRestore(f)).then(() => { if (toRestore) $("restorego").focus(); }); });
$("restorego").addEventListener("click", () => { if (toRestore) job(restore, { writes: true }); });
$("restoreno").addEventListener("click", () => { toRestore = null; $("restoreplan").hidden = true; say("Nothing was changed."); $("restore").focus(); });
$("exportall").addEventListener("click", () => {
  if (!lib || !lib.presets.length) return;
  const name = soundsName();
  download(name, soundsFile(lib.presets, from()), "application/json");
  say(`Saved ${name} to your downloads: ${plural(lib.presets.length, "preset")}.`, "ok");
});
$("import").addEventListener("click", () => $("importfile").click());
$("importfile").addEventListener("change", (ev) => { const fs = [...ev.target.files]; ev.target.value = ""; if (fs.length) job(() => pickImport(fs)).then(() => { if (toImport) $("importgo").focus(); }); });
$("importgo").addEventListener("click", () => { if (toImport) job(importNow, { writes: true }); });
$("importno").addEventListener("click", () => { toImport = null; $("importplan").hidden = true; say("Nothing was changed."); $("import").focus(); });
keys();
