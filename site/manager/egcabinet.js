// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// CABINET (F8): what the FM-1 keeps, and the files. THIS FM-1: its firmware, its package, its projects and MY PRESETS,
// the store's pages in use (STATUS). BACKUPS: BACK UP saves the whole store to the downloads and keeps a copy in this
// browser (IndexedDB: a list of the backups made here, each restored, saved again or forgotten); RESTORE A FILE; PRESETS
// ONLY saves MY PRESETS as one .egsnds. IMPORT: .egsnd / .egsnds files read into rows (a name MY PRESETS has already is
// marked, and left out unless ticked), then sent sound by sound (STORE6: nothing else in the store is touched) into MY
// PRESETS, into the pool of the project worked on (a MY preset and a pool place), or onto a track (one sound). (Each
// preset's own EXPORT is LIBRARY's.) Written for EvilGenius (MPL-2.0); FIZZ's BACKUP and IMPORT tabs lent ideas only.
//   mountCabinet({ $, say, refuse, bar, link(), busy(), job(fn, {writes}), download, changed() }) ->
//     { connected(version), show(on), gone(), render(), lib, readPresets(text) }
//   importRows(sounds, mine) / meterOf(status) / keptSummary(s) (no DOM: the tests)
import { readImage, readLibrary, tagNames } from "./egstore.js";
import { backupName, soundsName, soundsFile, readSounds } from "./egfiles.js";
import { storeSound } from "./egsysex.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "big", scale = 2, color = "white") => { const t = document.createElement("px-text"); t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color); t.textContent = s; return t; };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP_MAX = 12;                                       // (backups kept in the browser: the oldest go first)

// the rows an import shows: each sound, whether MY PRESETS has its name already (left out unless ticked), and a second
// copy of a name in the files themselves
export function importRows(sounds, mine = []) {
  const have = new Set(mine.map((m) => m.name)), seen = new Set();
  return sounds.map((s) => {
    const dup = have.has(s.name), twice = seen.has(s.name);
    seen.add(s.name);
    return { ...s, dup, twice, on: !dup && !twice };
  });
}
// the store's meter: MY PRESETS' pages and the projects' of all there are (STATUS), as 32 lamps
export function meterOf(st, n = 32) {
  if (!st || !st.lib || !st.prj) return null;
  const all = st.lib[1] + st.prj[1];
  if (!all) return null;
  const lib = Math.round((st.lib[0] / all) * n), prj = Math.round((st.prj[0] / all) * n);
  return { lamps: Array.from({ length: n }, (_, k) => (k < lib ? "lib" : k < lib + prj ? "prj" : "")),
    used: (st.lib[0] + st.prj[0]) / all, kb: Math.round(((st.lib[0] + st.prj[0]) * 256) / 1024), of: Math.round((all * 256) / 1024) };
}
export const keptSummary = (s) => s.blank ? "an empty store"
  : `${plural(s.projects.length, "project")}${s.projects.length ? ` (${s.projects.map((p) => p.name || `PROJECT ${p.slot}`).join(", ")})` : ""} and ${plural(s.presets.length, "preset")}`;

// ---- the backups kept in this browser (IndexedDB "evilgenius-manager", store "backups"); none at all: the list is empty
const DB = "evilgenius-manager";
function db() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined") { rej(new Error("no IndexedDB")); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("backups", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error("IndexedDB"));
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("backups", mode), s = t.objectStore("backups");
    const out = fn(s);
    t.oncomplete = () => { d.close(); res(out && "result" in out ? out.result : undefined); };
    t.onerror = () => { d.close(); rej(t.error || new Error("IndexedDB")); };
  });
}
export const kept = {
  async list() { try { return ((await tx("readonly", (s) => s.getAll())) || []).sort((a, b) => b.date.localeCompare(a.date)); } catch (_) { return []; } },
  async add(rec) {
    try {
      await tx("readwrite", (s) => s.add(rec));
      const all = await kept.list();
      for (const old of all.slice(KEEP_MAX)) await kept.remove(old.id);
      return true;
    } catch (_) { return false; }
  },
  async remove(id) { try { await tx("readwrite", (s) => s.delete(id)); } catch (_) { /* (gone already) */ } },
};

export function mountCabinet(ctx) {
  const { $, say, refuse, bar } = ctx;
  const S = { lib: null, st: null, version: "", toRestore: null, rows: null, dest: "mine", track: 0, keptList: [] };
  const root = $("tab-cabinet");
  root.innerHTML = `
    <div class="cabgrid">
      <section class="box cabunit" aria-labelledby="cb-h1">
        <p class="lab" id="cb-h1">THIS FM-1</p>
        <p id="unit" class="cbver">No FM-1 yet.</p>
        <div class="cbstats"><div><span class="cbn" id="cb-prj">-</span><span class="dim">PROJECTS</span></div>
          <div><span class="cbn" id="cb-pre">-</span><span class="dim">MY PRESETS</span></div>
          <div><span class="cbn" id="cb-pool">-</span><span class="dim">IN THE POOL</span></div>
          <div><span class="cbn" id="cb-use">-</span><span class="dim">STORE USED</span></div></div>
        <div class="cbmeter" id="cb-meter" role="img" aria-label="The store"></div>
        <p class="dim cblegend"><i class="lib"></i>MY PRESETS <i class="prj"></i>PROJECTS <span id="cb-kb"></span></p>
        <p class="dim">Plug the FM-1 in with a USB <strong>data</strong> cable, close other apps that use MIDI, press CONNECT and allow MIDI devices. Nothing is installed, and nothing leaves this computer.</p>
      </section>
      <section class="box" aria-labelledby="cb-h2">
        <p class="lab" id="cb-h2">BACKUPS</p>
        <p>A backup is the FM-1's whole store in one <code>.egbak</code> file: every project and all of MY PRESETS. It goes to your downloads, and a copy stays in this browser (the last ${KEEP_MAX}). Restoring one <strong>replaces everything</strong> on the FM-1. Stop the FM-1 first.</p>
        <div class="keys">
          <button id="backup" class="key" type="button" disabled><px-sprite name="ICON_DISK" scale="2"></px-sprite><px-text font="big" scale="2" color="white">BACK UP</px-text></button>
          <button id="presetsonly" class="key plain" type="button" disabled><px-text font="big" scale="2" color="white">PRESETS ONLY</px-text></button>
          <button id="restore" class="key plain" type="button" disabled><px-text font="big" scale="2" color="white">RESTORE A FILE</px-text></button>
          <input id="restorefile" class="hide" type="file" accept=".egbak,.bin" aria-label="A backup file to restore" tabindex="-1">
        </div>
        <div id="restoreplan" class="box bad plan" hidden>
          <h3><px-text font="big" scale="2" color="lightred">RESTORE THIS?</px-text></h3>
          <p id="restoretext"></p>
          <ul id="restorelist"></ul>
          <p>Everything on the FM-1 now is replaced: its projects and MY PRESETS. It takes up to a minute. <strong>Do not unplug the FM-1 while it writes.</strong> Type <strong>RESTORE</strong> to go on.</p>
          <label>TYPE IT <input id="restoretype" type="text" autocomplete="off" spellcheck="false" aria-label="Type RESTORE to go on"></label>
          <div class="keys">
            <button id="restorego" class="key warn" type="button" disabled><px-text font="big" scale="2" color="white">RESTORE NOW</px-text></button>
            <button id="restoreno" class="key plain" type="button"><px-text font="big" scale="2" color="white">CANCEL</px-text></button>
          </div>
        </div>
        <p class="lab" style="margin-top:12px">KEPT IN THIS BROWSER</p>
        <div id="cb-kept" class="cbkept"></div>
      </section>
      <section class="box cbimport" aria-labelledby="cb-h3">
        <p class="lab" id="cb-h3">IMPORT</p>
        <label class="cbdrop" id="cb-drop"><input id="importfile" class="hide" type="file" accept=".egsnd,.egsnds,.json" multiple aria-label="Sound files to import">
          <px-text font="big" scale="2" color="cyan">+ SOUNDS</px-text><span class="dim">.egsnd · .egsnds: click or drop them here</span></label>
        <div class="cbdest"><span class="dim">TO</span><span class="seg" id="cb-dest" role="group" aria-label="Where they go"></span>
          <select id="cb-track" aria-label="The track" hidden>${[1, 2, 3, 4, 5, 6].map((t) => `<option value="${t - 1}">TRACK ${t}</option>`).join("")}</select></div>
        <div id="cb-rows" class="cbrows"></div>
        <div class="keys"><button id="importgo" class="key go" type="button" disabled><px-text font="big" scale="2" color="white" id="cb-sendt">SEND TO FM-1</px-text></button>
          <button id="importno" class="key plain" type="button" hidden><px-text font="big" scale="2" color="white">CLEAR</px-text></button></div>
      </section>
    </div>
    <p class="foot">A backup is the file <code>firmware/tools/fizz_xdata.py backup</code> writes, so either tool reads the other's. The link is adapted from FIZZ's manager and <a href="https://github.com/charlesvestal/fm1-base">fm1-base</a>'s installer (MPL-2.0). EVILGENIUS is <a href="https://github.com/Quixotic7/evilgenius">open source</a>, MPL-2.0. Not affiliated with M-VAVE.</p>`;
  for (const [k, label] of [["mine", "MY PRESETS"], ["pool", "THE POOL"], ["track", "A TRACK"]]) {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.d = k; b.append(px(label, "small"));
    b.addEventListener("click", () => { S.dest = k; render(); });
    $("cb-dest").append(b);
  }
  const from = () => ({ firmware: ctx.link() ? ctx.link().id : "", store: S.lib ? S.lib.magic : "", date: new Date().toISOString() });

  // ---- the unit
  async function readPresets(text = "Reading MY PRESETS") {
    say(text, "busy");
    const r = await ctx.link().library((f) => bar(f));
    S.lib = readLibrary(r.bytes);
    bar(0);
    S.st = await ctx.link().status().catch(() => null);
    render();
  }
  async function connected(version) {
    S.version = version || "EVILGENIUS";
    await readPresets();
    S.keptList = await kept.list();
    render();
  }

  // ---- backups
  async function backup() {
    say("Searching the cabinet: reading the store", "busy");
    const r = await ctx.link().backup((f) => bar(f));
    const s = readImage(r.image), name = backupName();
    ctx.download(name, r.image, "application/octet-stream");
    const keptOk = await kept.add({ date: new Date().toISOString(), name, unit: ctx.link().id, size: r.image.length, crc: r.crc >>> 0,
      summary: keptSummary(s), image: r.image });
    S.keptList = await kept.list();
    S.lib = { ...S.lib, ...s };
    bar(1);
    render();
    say(`Saved ${name} to your downloads${keptOk ? " and kept a copy here" : ""}: ${keptSummary(s)}.`, "ok");
  }
  function presetsOnly() {
    if (!S.lib || !S.lib.presets.length) { refuse("MY PRESETS is empty: nothing to save"); return; }
    const name = soundsName();
    ctx.download(name, soundsFile(S.lib.presets, from()), "application/json");
    say(`Saved ${name} to your downloads: ${plural(S.lib.presets.length, "preset")}.`, "ok");
  }
  function planRestore(image, name) {
    bar(0);
    S.toRestore = null;
    $("restoreplan").hidden = true;
    let s;
    try { s = readImage(image); } catch (e) { refuse(`${name}: ${e.message}`); return; }
    if (s.magic && S.lib && S.lib.magic && s.magic !== S.lib.magic) {
      refuse(`${name} is from another EVILGENIUS version (its store is ${s.magic}, this FM-1's is ${S.lib.magic}). This FM-1 would erase it`);
      return;
    }
    S.toRestore = { image, name };
    $("restoretext").textContent = `${name} holds ${keptSummary(s)}.` + (s.blank ? " Restoring it erases the FM-1's store." : "");
    const list = $("restorelist");
    list.textContent = "";
    for (const p of s.projects) list.append(el("li", "", `Project ${p.slot}: ${p.name || "(no name)"}`));
    if (s.presets.length) list.append(el("li", "", `MY PRESETS: ${s.presets.slice(0, 12).map((p) => p.name).join(", ")}${s.presets.length > 12 ? `, and ${s.presets.length - 12} more` : ""}`));
    $("restoretype").value = "";
    $("restoreplan").hidden = false;
    render();
    $("restoretype").focus();
    say(`${name} is an EVILGENIUS backup. Read what it holds, then choose.`);
  }
  const phase = (what) => (p) => say(p === "check" ? `${what}: the FM-1 checks the file` : `${what}: the FM-1 writes its store. Do not unplug it`, "busy");
  async function restore() {
    const { image, name } = S.toRestore;
    $("restoreplan").hidden = true;
    S.toRestore = null;
    await ctx.link().restore(image, { onProgress: (f) => bar(f), onPhase: phase("Restoring") });
    bar(1);
    await sleep(1200);                                    // (the FM-1 starts again on the store)
    await readPresets("Restored. Reading MY PRESETS");
    ctx.changed();
    say(`Restored ${name}. ${plural(S.lib.presets.length, "preset")} in MY PRESETS.`, "ok");
  }
  function renderKept() {
    const box = $("cb-kept");
    box.textContent = "";
    if (!S.keptList.length) { box.append(el("p", "dim", "None yet: BACK UP keeps one here.")); return; }
    const off = !ctx.link() || ctx.busy();
    for (const k of S.keptList) {
      const row = el("div", "cbk");
      const d = new Date(k.date);
      row.append(el("span", "name", `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`),
        el("span", "dim", `${k.unit} · ${k.summary}`));
      const acts = el("span", "keys");
      const b = (label, fn, cls = "key plain", dis = false) => { const x = el("button", cls); x.type = "button"; x.append(px(label, "small")); x.disabled = dis; x.addEventListener("click", fn); acts.append(x); };
      b("RESTORE", () => planRestore(new Uint8Array(k.image), k.name), "key plain", off);
      b("SAVE", () => { ctx.download(k.name, new Uint8Array(k.image), "application/octet-stream"); say(`Saved ${k.name} to your downloads.`, "ok"); });
      b("FORGET", async () => { if (!window.confirm(`Forget the backup of ${d.toLocaleString()} kept in this browser? The FM-1 and your downloads keep theirs.`)) return; await kept.remove(k.id); S.keptList = await kept.list(); render(); });
      row.append(acts);
      box.append(row);
    }
  }

  // ---- import: files to rows, rows to the unit (STORE6 each)
  async function pick(files) {
    const sounds = [], bad = [];
    for (const f of files) {
      try { sounds.push(...readSounds(new Uint8Array(await f.arrayBuffer()), f.name)); }
      catch (e) { bad.push(e.message); }
    }
    if (!sounds.length) { refuse(bad[0] || "no file was chosen"); return; }
    const old = S.rows || [], all = importRows([...old, ...sounds], S.lib ? S.lib.presets : []);
    old.forEach((r, i) => { all[i].on = r.on; });
    S.rows = all;
    render();
    const dup = S.rows.filter((r) => r.dup).length, twice = S.rows.filter((r) => r.twice && !r.dup).length;
    say(`${plural(sounds.length, "sound")} read${bad.length ? `, ${plural(bad.length, "file")} left out (${bad[0]})` : ""}.` +
      `${dup ? ` ${plural(dup, "name")} MY PRESETS has already` : ""}${dup && twice ? "," : ""}${twice ? ` ${plural(twice, "name")} twice in the files` : ""}${dup || twice ? ": left out unless ticked." : ""}`);
  }
  async function send() {
    const rows = S.rows.filter((r) => r.on);
    if (!rows.length) return;
    if (S.dest === "track" && rows.length !== 1) { refuse("tick one sound to put on a track"); return; }
    const where = S.dest === "mine" ? "MY PRESETS" : S.dest === "pool" ? "the pool (and MY PRESETS)" : `track ${S.track + 1} (and MY PRESETS)`;
    const sent = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      say(`Sending ${r.name} to ${where}: ${i + 1} of ${rows.length}`, "busy");
      bar((i + 1) / rows.length);
      const f = storeSound({ name: r.name, blob: r.blob, tags: r.tags, pan: r.pan, chorus: r.chorus, delay: r.delay, reverb: r.reverb,
        pool: S.dest === "pool", track: S.dest === "track" ? S.track : -1, batch: i > 0 });
      const a = await ctx.link().store(f);
      if (!a || a.kind !== "store" || a.status) {
        const why = a ? a.statusName : "no answer";
        refuse(`the FM-1 did not take ${r.name} (${why}${why === "FULL" ? `: ${S.dest === "pool" ? "the pool or " : ""}MY PRESETS is full` : ""}). ${sent.length ? `${plural(sent.length, "sound")} went in before it.` : "Nothing went in."}`);
        S.rows = S.rows.filter((x) => !sent.includes(x));
        await readPresets("Reading MY PRESETS").catch(() => {});
        return;
      }
      r.place = a.slot;
      sent.push(r);
    }
    S.rows = S.rows.filter((x) => !sent.includes(x));
    if (!S.rows.length) S.rows = null;
    await readPresets("Sent. Reading MY PRESETS");
    ctx.changed();
    say(`Sent ${plural(sent.length, "sound")} to ${where}: ${sent.slice(0, 6).map((r) => `${r.name}${r.place ? ` (${S.dest === "pool" ? "pool" : "place"} ${r.place})` : ""}`).join(", ")}${sent.length > 6 ? ", .." : ""}. SHIFT + F1 on the FM-1 undoes them.`, "ok");
  }
  function renderRows() {
    const box = $("cb-rows");
    box.textContent = "";
    for (const b of $("cb-dest").children) b.setAttribute("aria-pressed", String(b.dataset.d === S.dest));
    $("cb-track").hidden = S.dest !== "track";
    $("importno").hidden = !S.rows;
    const on = S.rows ? S.rows.filter((r) => r.on).length : 0;
    $("cb-sendt").textContent = on ? `SEND ${on} TO FM-1` : "SEND TO FM-1";
    $("importgo").disabled = !ctx.link() || ctx.busy() || !on || (S.dest === "track" && on !== 1);
    if (!S.rows) { box.append(el("p", "dim", "No sounds read yet.")); return; }
    for (const r of S.rows) {
      const row = el("label", `cbrow${r.dup || r.twice ? " dup" : ""}`);
      const c = el("input"); c.type = "checkbox"; c.checked = r.on;
      c.addEventListener("change", () => { r.on = c.checked; renderRows(); });
      row.append(c, el("span", "name", r.name), el("span", "dim", tagNames(r.tags).join(" ")),
        el("span", "dim", r.dup ? "MY PRESETS HAS THIS NAME" : r.twice ? "TWICE IN THE FILES" : ""));
      box.append(row);
    }
  }

  // ---- the page
  function render() {
    const l = ctx.link(), on = !!l && !ctx.busy();
    $("backup").disabled = !on;
    $("restore").disabled = !on;
    $("presetsonly").disabled = !on || !S.lib || !S.lib.presets.length;
    $("restorego").disabled = !on || !S.toRestore || $("restoretype").value.trim().toUpperCase() !== "RESTORE";
    $("restoreno").disabled = ctx.busy();
    const st = S.st;
    $("unit").textContent = l ? `${S.version} · ${l.id} · ${st && st.package === "ble" ? "BLUETOOTH PACKAGE" : "USB PACKAGE"} · STORE ${S.lib && S.lib.magic ? S.lib.magic : "EMPTY"}` : "No FM-1 yet.";
    $("cb-prj").textContent = st ? `${st.projects}/${st.nproj}` : "-";
    $("cb-pre").textContent = st ? `${st.mine}/${st.nlib}` : "-";
    $("cb-pool").textContent = st ? `${st.pool}/128` : "-";
    const m = meterOf(st);
    $("cb-use").textContent = m ? `${Math.round(m.used * 100)}%` : "-";
    $("cb-kb").textContent = m ? `${m.kb} OF ${m.of} KB` : "";
    const meter = $("cb-meter");
    meter.textContent = "";
    for (const k of (m ? m.lamps : new Array(32).fill(""))) meter.append(el("i", k));
    renderKept();
    renderRows();
  }
  $("backup").addEventListener("click", () => ctx.job(backup));
  $("presetsonly").addEventListener("click", presetsOnly);
  $("restore").addEventListener("click", () => $("restorefile").click());
  $("restorefile").addEventListener("change", async (ev) => { const f = ev.target.files[0]; ev.target.value = ""; if (f) planRestore(new Uint8Array(await f.arrayBuffer()), f.name); });
  $("restoretype").addEventListener("input", render);
  $("restoretype").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !$("restorego").disabled) $("restorego").click(); });
  $("restorego").addEventListener("click", () => { if (S.toRestore) ctx.job(restore, { writes: true }); });
  $("restoreno").addEventListener("click", () => { S.toRestore = null; $("restoreplan").hidden = true; say("Nothing was changed."); render(); $("restore").focus(); });
  $("importfile").addEventListener("change", (ev) => { const fs = [...ev.target.files]; ev.target.value = ""; if (fs.length) pick(fs); });
  const drop = $("cb-drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); const fs = [...e.dataTransfer.files]; if (fs.length) pick(fs); });
  $("cb-track").addEventListener("change", () => { S.track = Number($("cb-track").value); });
  $("importgo").addEventListener("click", () => ctx.job(send));
  $("importno").addEventListener("click", () => { S.rows = null; render(); say("Nothing was sent."); });
  // the keys (CABINET shown, not typing): B back up, P presets only, R restore a file, K the kept backups, I import
  // files, D where they go, T the track, S send, C clear
  document.addEventListener("keydown", (e) => {
    if (!S.shown || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase(), click = (id) => { if (!$(id).disabled && !$(id).hidden) $(id).click(); };
    if (k === "b") click("backup");
    else if (k === "p") click("presetsonly");
    else if (k === "r") click("restore");
    else if (k === "i") $("importfile").click();
    else if (k === "k") { const b = $("cb-kept").querySelector("button"); if (b) b.focus(); }
    else if (k === "d") { const ds = ["mine", "pool", "track"]; S.dest = ds[(ds.indexOf(S.dest) + 1) % 3]; render(); say(`IMPORT sends to ${S.dest === "mine" ? "MY PRESETS" : S.dest === "pool" ? "the pool" : `track ${S.track + 1}`}.`); }
    else if (k === "t" && S.dest === "track") { S.track = (S.track + 1) % 6; $("cb-track").value = String(S.track); say(`IMPORT sends to track ${S.track + 1}.`); }
    else if (k === "s") click("importgo");
    else if (k === "c") click("importno");
    else return;
    e.preventDefault();
  });
  kept.list().then((k) => { S.keptList = k; render(); });
  return {
    connected, readPresets, render,
    show(on) { S.shown = on; if (on && ctx.link() && !ctx.busy()) ctx.job(async () => { S.st = await ctx.link().status().catch(() => S.st); S.keptList = await kept.list(); render(); }); },
    get lib() { return S.lib; },
    gone() { S.lib = null; S.st = null; S.toRestore = null; $("restoreplan").hidden = true; render(); },
  };
}
