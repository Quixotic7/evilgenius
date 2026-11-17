// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// PROJECTS (F7): the FM-1's project slots (4 on the Bluetooth package, 8 on the USB one) as PROJECTS gives them: each its
// name, the one worked on, the store pages it takes. A slot: LOAD (the one worked on is saved first), NEW (an empty slot
// only: a blank project, worked on at once), RENAME, COPY TO (another slot, not the one worked on), MOVE TO (a copy,
// then the old one deleted; not the one worked on), DELETE (the one worked on: a blank project in its place). Each is
// the unit's own PROJECT / RENAME command, done with the FM-1 stopped; the unit's undo history starts again after a load
// or a new project, and a delete or a copy over a project cannot be undone: the page asks for its name typed first.
// Beside the slots: the picked project's 64 patterns as its store records hold them (the store's projects sectors read:
// what the unit last saved). Written for EvilGenius (MPL-2.0); FIZZ's PROJECTS tab lent ideas only.
// IN THIS BROWSER (docs/BROWSER-FM1-PLAN.md phase 5): the projects kept in this browser, as many as you like
// (egproject.js shelf). SAVE HERE takes the picked slot's project, with the MY PRESETS it uses, into a new entry
// (nothing kept is overwritten); SEND TO SLOT puts the picked entry into the picked slot, which it replaces: the FM-1's
// store is backed up first (CABINET keeps the backup), the project's presets found or added to MY PRESETS, and the store
// written back (RESTORE's path; the FM-1 starts again). EXPORT and IMPORT: the .egprj file (docs/PROJECT-FORMAT.md).
// THE OTHER FM-1: with an FM-1 on USB beside the one in this page (ctx.other()), its slots stand in a box of their own.
// GET takes its picked slot's project into the library (a new entry); SEND puts the library's picked project onto its
// picked slot, as SEND TO SLOT does (its store backed up first). So a project goes browser -> FM-1 and back without
// the screens leaving the FM-1 they are on.
//   mountProjects({ $, say, refuse, link(), other(), busy(), job(fn), changed() }) -> { show(on), load(), follow(), gone(), render() }
import { patternsOf, LAYOUT, SECTOR } from "./egstore.js";
import { cleanName, backupName } from "./egfiles.js";
import { extractProject, insertProject, readProject, projectFile, projectName, shelf } from "./egproject.js";
import { kept, keptSummary } from "./egcabinet.js";
import { readImage } from "./egstore.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "big", scale = 2, color = "white") => { const t = document.createElement("px-text"); t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color); t.textContent = s; return t; };
const patName = (k) => `${"ABCD"[k >> 4]}${String((k & 15) + 1).padStart(2, "0")}`;

export function mountProjects(ctx) {
  const { $, say, refuse } = ctx;
  const S = { list: null, current: 0, sel: 0, pats: null, shown: false, reading: false, shelf: [], ssel: null, olist: null, ocur: 0, osel: 1 };
  const root = $("tab-projects");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="pj-title">THE PROJECTS</span><span class="dim">UP / DOWN A SLOT · ENTER LOAD · N NEW · R RENAME · C COPY · M MOVE (THEN 1..8) · DELETE · P PATTERNS</span></div>
    <div class="pjbody">
      <div class="pjside">
        <div id="pj-slots" class="pjslots" role="listbox" aria-label="The project slots"></div>
        <div class="keys pjacts">
          <button id="pj-load" class="key go" type="button"></button>
          <button id="pj-new" class="key plain" type="button"></button>
          <button id="pj-rename" class="key plain" type="button"></button>
          <button id="pj-copy" class="key plain" type="button"></button>
          <button id="pj-move" class="key plain" type="button"></button>
          <button id="pj-delete" class="key warn" type="button"></button>
        </div>
        <div id="pj-to" class="box pjto" hidden><p id="pj-totext"></p><div class="seg" id="pj-toslots"></div>
          <div class="keys"><button id="pj-tono" class="key plain" type="button"></button></div></div>
        <div class="pjother box" id="pj-other" hidden>
          <div class="hhead"><span class="lab" id="pj-otitle">THE FM-1 ON USB</span><span class="dim">[ ] SLOT · G GET · T SEND</span></div>
          <div id="pj-oslots" class="pjoslots" role="listbox" aria-label="The other FM-1's project slots"></div>
          <div class="keys pjacts">
            <button id="pj-oget" class="key go" type="button"></button>
            <button id="pj-osend" class="key plain" type="button"></button>
          </div>
        </div>
        <p class="dim pjnote">The FM-1 must be stopped. A load saves the project worked on first. A delete, and a copy over a project, cannot be undone: back up first (CABINET).</p>
      </div>
      <div class="pjright">
        <div class="pjmain box">
          <div class="hhead"><span class="lab" id="pj-pname">PATTERNS</span><button id="pj-pats" class="key plain" type="button"></button></div>
          <div id="pj-grid" class="sqpats pjgrid" aria-label="The project's patterns"></div>
          <p class="dim" id="pj-patnote">The patterns as the FM-1 last saved them. A lit one has steps.</p>
        </div>
        <div class="pjshelf box">
          <div class="hhead"><span class="lab" id="pj-shtitle">THE LIBRARY</span><span class="dim">B SAVE HERE · U SEND TO SLOT · E EXPORT · I IMPORT · SHIFT + UP / DOWN PICK</span></div>
          <div id="pj-shelf" class="pjshlist" role="listbox" aria-label="The projects kept in this browser"></div>
          <div class="keys pjacts">
            <button id="pj-tolib" class="key go" type="button"></button>
            <button id="pj-tounit" class="key plain" type="button"></button>
            <button id="pj-export" class="key plain" type="button"></button>
            <button id="pj-import" class="key plain" type="button"></button>
            <button id="pj-shrename" class="key plain" type="button"></button>
            <button id="pj-forget" class="key warn" type="button"></button>
          </div>
          <input id="pj-file" class="hide" type="file" accept=".egprj,application/json" multiple tabindex="-1" aria-label="Project files to import">
        </div>
      </div>
    </div>`;
  for (const [id, label] of [["pj-load", "LOAD"], ["pj-new", "NEW"], ["pj-rename", "RENAME"], ["pj-copy", "COPY TO"], ["pj-move", "MOVE TO"], ["pj-delete", "DELETE"], ["pj-tono", "CANCEL"], ["pj-pats", "READ PATTERNS"],
    ["pj-export", "EXPORT"], ["pj-import", "IMPORT"], ["pj-shrename", "RENAME"], ["pj-forget", "FORGET"]])
    $(id).append(px(label));
  const slot = (p) => (S.list ? S.list[p - 1] : null);
  const label = (p) => { const s = slot(p); return `PROJECT ${p}${s && s.there && s.name && s.name !== `PROJECT ${p}` ? ` (${s.name})` : ""}`; };

  async function load() {
    const l = ctx.link();
    if (!l) return;
    const r = await l.projects();
    if (!r) { refuse("this EVILGENIUS does not list its projects"); return; }
    S.list = r.list; S.current = r.current;
    if (!S.sel || !S.list[S.sel - 1]) S.sel = S.current;
    S.snap = JSON.stringify(r);
    await loadOther();
    render();
  }
  async function loadOther() {
    const o = ctx.other();
    const r = o ? await o.projects().catch(() => null) : null;
    S.olist = r ? r.list : null; S.ocur = r ? r.current : 0;
    if (!S.olist || !S.olist[S.osel - 1]) S.osel = 1;
  }
  // the FM-1 in this page, followed: its projects as its own panel changed them
  async function follow() {
    const l = ctx.link();
    if (!S.shown || !l || !S.list || ctx.busy()) return;
    const r = await l.projects();
    if (!r || JSON.stringify(r) === S.snap || root.querySelector(".pjslot input")) return;
    S.snap = JSON.stringify(r);
    S.list = r.list; S.current = r.current; S.pats = null;
    render();
  }
  const who = (l) => (l.virtual ? "the FM-1 in this browser" : `the FM-1 on USB`);
  const nameIn = (list, p) => { const s = list && list[p - 1]; return `PROJECT ${p}${s && s.there && s.name && s.name !== `PROJECT ${p}` ? ` (${s.name})` : ""}`; };
  async function readPatterns() {
    const l = ctx.link();
    if (!l || !S.list) return;
    say("Reading the projects' patterns from the store", "busy");
    const bytes = await l.read(LAYOUT.prj.base, LAYOUT.prj.base + LAYOUT.prj.nsec * SECTOR, () => {});
    S.pats = { bytes, of: {} };
    render();
    say("Read the projects' patterns.", "ok");
  }
  const patsOf = (p) => {
    if (!S.pats) return null;
    if (!S.pats.of[p]) S.pats.of[p] = patternsOf(S.pats.bytes, p);
    return S.pats.of[p];
  };
  const stopped = async () => {
    const st = await ctx.link().status();
    if (st && st.playing) { refuse("stop the FM-1 first: projects change only while it is stopped"); return false; }
    return true;
  };
  const done = (a, what) => {
    if (!a || a.old) { refuse(`this EVILGENIUS cannot ${what} from here`); return false; }
    if (a.status) { refuse(`the FM-1 did not ${what} (${a.statusName})`); return false; }
    return true;
  };
  // a step the page cannot take back: the project's name (or number) typed
  const typed = (s, p, what) => {
    const want = (s && s.name) || String(p);
    const got = window.prompt(`${what}\n\nThis cannot be undone. Type ${s && s.name ? `the project's name (${want})` : `its number (${p})`} to go on.`);
    return got != null && got.trim().toUpperCase() === want.toUpperCase();
  };
  async function after(text) {
    S.pats = null;
    await load();
    ctx.changed();
    say(text, "ok");
  }
  async function loadP() {
    const p = S.sel;
    if (!slot(p) || !slot(p).there || p === S.current) return;
    if (!(await stopped())) return;
    say(`Loading ${label(p)}: the FM-1 saves ${label(S.current)} first`, "busy");
    if (!done(await ctx.link().project("load", p), "load it")) return;
    await after(`${label(p)} is the one worked on now.`);
  }
  async function newP() {
    const p = S.sel;
    if (!slot(p) || slot(p).there) return;
    if (!window.confirm(`Start a new, empty project in slot ${p}? The FM-1 saves ${label(S.current)} first and works on the new one.`)) return;
    if (!(await stopped())) return;
    if (!done(await ctx.link().project("new", p), "make it")) return;
    await after(`PROJECT ${p} is new and worked on now.`);
  }
  function rename() {
    const p = S.sel, s = slot(p);
    if (!s || !s.there) return;
    const row = $("pj-slots").querySelector(`[data-p="${p}"] .pjname`);
    const inp = el("input");
    inp.type = "text"; inp.maxLength = 12; inp.value = s.name; inp.setAttribute("aria-label", `A new name for project ${p}`);
    row.textContent = ""; row.append(inp); inp.focus(); inp.select();
    let gone = false;
    const finish = (keep) => {
      if (gone) return; gone = true;
      const nm = cleanName(inp.value);
      if (!keep || !nm || nm === s.name) { render(); return; }
      ctx.job(async () => { if (done(await ctx.link().rename("project", p, nm), "rename it")) await after(`Project ${p} is ${nm} now.`); else render(); });
    };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  // COPY TO / MOVE TO: the slots it can go to (not itself, not the one worked on)
  function pickTo(move) {
    const p = S.sel;
    if (!slot(p) || !slot(p).there || (move && p === S.current)) return;
    const box = $("pj-toslots");
    box.textContent = "";
    $("pj-totext").textContent = `${move ? "MOVE" : "COPY"} ${label(p)} TO:`;
    S.list.forEach((s, k) => {
      const q = k + 1;
      if (q === p || q === S.current) return;
      const b = el("button", "key plain"); b.type = "button";
      b.append(px(`${q}${s.there ? ` ${s.name || ""}` : " EMPTY"}`, "small", 2));
      b.addEventListener("click", () => ctx.job(() => copyTo(p, q, move)));
      box.append(b);
    });
    $("pj-to").hidden = false;
    const first = box.querySelector("button");
    if (first) first.focus();
  }
  async function copyTo(p, q, move) {
    $("pj-to").hidden = true;
    const over = slot(q) && slot(q).there;
    if (over && !typed(slot(q), q, `${label(q)} is replaced by a copy of ${label(p)}.`)) { say("Nothing was changed."); return; }
    if (!over && !window.confirm(`${move ? "Move" : "Copy"} ${label(p)} to slot ${q}?`)) return;
    if (!(await stopped())) return;
    say(`${move ? "Moving" : "Copying"} ${label(p)} to slot ${q}`, "busy");
    if (!done(await ctx.link().project("copy", p, q), "copy it")) return;
    if (move) {
      const r = await ctx.link().projects();
      const there = r && r.list[q - 1] && r.list[q - 1].there;
      if (!there) { await load(); refuse(`the copy did not show up in slot ${q}: ${label(p)} was kept`); return; }
      if (!done(await ctx.link().project("delete", p), "delete the old one")) { await load(); return; }
    }
    S.sel = q;
    await after(`${move ? "Moved" : "Copied"} to slot ${q}.`);
  }
  async function del() {
    const p = S.sel, s = slot(p);
    if (!s || !s.there) return;
    if (!typed(s, p, p === S.current ? `${label(p)} is the one worked on: it is replaced by a blank project.` : `${label(p)} is deleted from the FM-1.`)) { say("Nothing was deleted."); return; }
    if (!(await stopped())) return;
    if (!done(await ctx.link().project("delete", p), "delete it")) return;
    await after(`${p === S.current ? "Project " + p + " is blank now" : "Deleted project " + p}.`);
  }

  // ---- IN THIS BROWSER
  const entry = () => S.shelf.find((x) => x.id === S.ssel) || null;
  async function readShelf(pick) {
    S.shelf = await shelf.list();
    if (pick != null) S.ssel = pick;
    if (!entry()) S.ssel = S.shelf.length ? S.shelf[0].id : null;
    render();
  }
  async function storeImage(l, what) {                    // an FM-1's store now: the project worked on saved first
    await l.flush().catch(() => null);
    say(`${what}: reading the store of ${who(l)}`, "busy");
    const r = await l.backup((f) => ctx.bar(f));
    ctx.bar(0);
    return r;
  }
  // a slot's project into the library: a new entry, nothing kept is overwritten
  async function keepFrom(l, list, p) {
    const s = list && list[p - 1];
    if (!l || !s || !s.there) return;
    const r = await storeImage(l, `Saving ${nameIn(list, p)} to the library`);
    const j = extractProject(r.image, p, { unit: l.id, date: new Date().toISOString() });
    const id = await shelf.add(j);
    await readShelf(id);
    say(`${j.name} is in the library, from ${who(l)}${j.presets.length ? `, with ${j.presets.length} of MY PRESETS` : ""}.`, "ok");
  }
  // the library's picked project onto a slot, which it replaces (mine: the FM-1 the screens are on)
  async function sendTo(l, list, p, mine) {
    const e = entry(), s = list && list[p - 1];
    if (!l || !e || !s) return;
    const over = s.there, unit = who(l);
    if (over && !typed(s, p, `${nameIn(list, p)} on ${unit} is replaced by ${e.name} from the library. Its store is backed up first (CABINET keeps it).`)) { say("Nothing was changed."); return; }
    if (!over && !window.confirm(`Send ${e.name} to slot ${p} of ${unit}? Its store is backed up first, and it starts again.`)) return;
    const st = await l.status();
    if (st && st.playing) { refuse(`stop ${unit} first: projects change only while it is stopped`); return; }
    const r = await storeImage(l, `Sending ${e.name}`);
    let put;
    try { put = insertProject(r.image, p, e.project); } catch (x) { refuse(`${e.name} cannot go to slot ${p}: ${x.message}`); return; }
    const before = readImage(r.image);
    await kept.add({ date: new Date().toISOString(), name: backupName(), unit: l.id, size: r.image.length, crc: r.crc >>> 0,
      summary: `before ${e.name} went to slot ${p}: ${keptSummary(before)}`, image: r.image });
    await l.restore(put.image, { onProgress: (f) => ctx.bar(f),
      onPhase: (ph) => say(ph === "check" ? `Sending ${e.name}: ${unit} checks the store` : `Sending ${e.name}: ${unit} writes its store.${l.virtual ? "" : " Do not unplug it"}`, "busy") });
    ctx.bar(1);
    await new Promise((res) => setTimeout(res, l.virtual ? 200 : 1200));     // (the FM-1 starts again on the store)
    const presets = put.added.length ? ` ${put.added.length} sound${put.added.length === 1 ? "" : "s"} added to MY PRESETS (${put.added.map((x) => x.name).join(", ")}).` : "";
    const text = `${e.name} is in slot ${p} of ${unit}${put.replaced ? ` (it replaced ${put.replaced})` : ""}.${presets} The store before it is kept in CABINET.`;
    if (mine) { S.sel = p; await after(text); } else { S.osel = p; await loadOther(); render(); say(text, "ok"); }
  }
  const toLib = () => keepFrom(ctx.link(), S.list, S.sel);
  const toUnit = () => sendTo(ctx.link(), S.list, S.sel, true);
  const oGet = () => keepFrom(ctx.other(), S.olist, S.osel);
  const oSend = () => sendTo(ctx.other(), S.olist, S.osel, false);
  function exportP() {
    const e = entry();
    if (!e) return;
    ctx.download(projectName(e.project), projectFile(e.project), "application/json");
    say(`Saved ${projectName(e.project)} to your downloads.`, "ok");
  }
  async function importP(files) {
    let last = null, n = 0;
    const bad = [];
    for (const f of files) {
      try {
        const j = readProject(new Uint8Array(await f.arrayBuffer()), f.name);
        last = await shelf.add({ ...j, from: { ...(j.from || {}), file: f.name } });
        n++;
      } catch (x) { bad.push(x.message); }
    }
    await readShelf(last);
    if (!n) { refuse(bad[0] || "no file was chosen"); return; }
    say(`${n} project${n === 1 ? "" : "s"} kept in this browser${bad.length ? `; ${bad.length} left out (${bad[0]})` : ""}.`, "ok");
  }
  async function renameShelf() {
    const e = entry();
    if (!e) return;
    const nm = cleanName(window.prompt("A new name (twelve characters):", e.name) || "");
    if (!nm || nm === e.name) return;
    await shelf.rename(e.id, nm);
    await readShelf(e.id);
    say(`It is ${nm} now.`, "ok");
  }
  async function forget() {
    const e = entry();
    if (!e || !window.confirm(`Forget ${e.name} (kept ${new Date(e.saved).toLocaleString()}) in this browser? EXPORT it first to keep a file.`)) return;
    await shelf.remove(e.id);
    await readShelf();
    say(`Forgot ${e.name}.`, "ok");
  }
  const setLabel = (id, text) => { const b = $(id); b.textContent = ""; b.append(px(text)); };
  const fromText = (f = {}) => f.file ? `FROM ${f.file}` : f.unit ? `FROM ${f.unit}${f.slot ? ` SLOT ${f.slot}` : ""}` : "";
  function renderShelf(off) {
    const box = $("pj-shelf");
    box.textContent = "";
    $("pj-shtitle").textContent = `THE LIBRARY · ${S.shelf.length} PROJECT${S.shelf.length === 1 ? "" : "S"} KEPT IN THIS BROWSER`;
    if (!S.shelf.length) box.append(el("p", "dim", "None yet. SAVE HERE keeps the picked slot's project in the library; IMPORT reads .egprj files."));
    for (const x of S.shelf) {
      const j = x.project, d = new Date(x.saved);
      const b = el("button", `pjslot there${x.id === S.ssel ? " on" : ""}`);
      b.type = "button"; b.dataset.id = x.id; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(x.id === S.ssel));
      const pats = (j.summary && j.summary.patterns) || [];
      b.append(el("span", "pjname", x.name),
        el("span", "dim", `${pats.length} PATTERN${pats.length === 1 ? "" : "S"} · ${j.presets.length} PRESET${j.presets.length === 1 ? "" : "S"}`),
        el("span", "dim", `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${fromText(x.from)}`));
      b.addEventListener("click", () => { S.ssel = x.id; render(); });
      box.append(b);
    }
    const s = slot(S.sel), e = entry();
    setLabel("pj-tolib", `SAVE ${S.sel || ""} HERE`.replace("  ", " "));
    setLabel("pj-tounit", `SEND TO SLOT ${S.sel || ""}`.trim());
    $("pj-tolib").disabled = off || !s || !s.there;
    $("pj-tounit").disabled = off || !s || !e;
    for (const id of ["pj-export", "pj-shrename", "pj-forget"]) $(id).disabled = ctx.busy() || !e;
    $("pj-import").disabled = ctx.busy();
    const on = box.querySelector(".on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    // the other FM-1
    const o = ctx.other(), ob = $("pj-oslots");
    $("pj-other").hidden = !o;
    root.classList.toggle("two", !!o);
    ob.textContent = "";
    if (!o) return;
    $("pj-otitle").textContent = o.virtual ? "THE FM-1 IN THIS BROWSER" : `THE FM-1 ON USB · ${o.id}`;
    if (!S.olist) ob.append(el("p", "dim", "Reading its projects .."));
    else S.olist.forEach((x, k) => {
      const q = k + 1, c = el("button", `pjslot${q === S.osel ? " on" : ""}${x.there ? " there" : ""}${q === S.ocur ? " cur" : ""}`);
      c.type = "button"; c.setAttribute("role", "option"); c.setAttribute("aria-selected", String(q === S.osel));
      c.append(el("span", "pjn", String(q)), el("span", "pjname", x.there ? x.name || `PROJECT ${q}` : "EMPTY"));
      c.addEventListener("click", () => { S.osel = q; render(); });
      ob.append(c);
    });
    const os = S.olist && S.olist[S.osel - 1];
    setLabel("pj-oget", `GET ${S.osel}`);
    setLabel("pj-osend", `SEND TO ${S.osel}`);
    $("pj-oget").disabled = ctx.busy() || !os || !os.there;
    $("pj-osend").disabled = ctx.busy() || !os || !e;
  }

  function render() {
    const l = ctx.link(), off = !l || ctx.busy();
    renderShelf(off);
    const box = $("pj-slots");
    box.textContent = "";
    const where = !l ? "THE PROJECTS" : l.virtual ? "THE FM-1 IN THIS BROWSER" : "THE FM-1 ON USB";
    $("pj-title").textContent = S.list ? `${where} · ${S.list.filter((s) => s.there).length} OF ${S.list.length} SLOTS` : where;
    if (!S.list) box.append(el("p", "dim", l ? "Reading the projects .." : "No FM-1 yet."));
    else S.list.forEach((s, k) => {
      const p = k + 1, b = el("button", `pjslot${p === S.sel ? " on" : ""}${s.there ? " there" : ""}${p === S.current ? " cur" : ""}`);
      b.type = "button"; b.dataset.p = p; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(p === S.sel));
      b.append(el("span", "pjn", String(p)), el("span", "pjname", s.there ? s.name || `PROJECT ${p}` : "EMPTY"),
        el("span", "dim", p === S.current ? "WORKED ON" : s.there ? `${s.pages} PAGES` : ""));
      b.addEventListener("click", () => { S.sel = p; render(); });
      b.addEventListener("dblclick", () => { S.sel = p; ctx.job(loadP); });
      box.append(b);
    });
    const s = slot(S.sel);
    $("pj-load").disabled = off || !s || !s.there || S.sel === S.current;
    $("pj-new").disabled = off || !s || s.there;
    $("pj-rename").disabled = off || !s || !s.there;
    $("pj-copy").disabled = off || !s || !s.there || S.list.length < 3;
    $("pj-move").disabled = off || !s || !s.there || S.sel === S.current;
    $("pj-delete").disabled = off || !s || !s.there;
    $("pj-pats").disabled = off || !S.list;
    $("pj-pname").textContent = s ? `PATTERNS · ${label(S.sel)}` : "PATTERNS";
    const g = $("pj-grid");
    g.textContent = "";
    const pats = s && s.there ? patsOf(S.sel) : null;
    $("pj-patnote").textContent = !s || !s.there ? "An empty slot." : !pats ? "Press READ PATTERNS to see which patterns hold steps (the store, read: a few seconds)."
      : `${pats.filter((x) => x.used).length} of 64 patterns hold steps, as the FM-1 last saved them.`;
    if (pats) for (const x of pats) {
      const c = el("span", `key${x.used ? " used" : ""}`, patName(x.k));
      c.title = `${patName(x.k)}${x.used ? ": steps" : x.there ? ": no steps" : ": never written"}`;
      g.append(c);
    }
  }
  $("pj-load").addEventListener("click", () => ctx.job(loadP));
  $("pj-new").addEventListener("click", () => ctx.job(newP));
  $("pj-rename").addEventListener("click", rename);
  $("pj-copy").addEventListener("click", () => pickTo(false));
  $("pj-move").addEventListener("click", () => pickTo(true));
  $("pj-delete").addEventListener("click", () => ctx.job(del));
  $("pj-tono").addEventListener("click", () => { $("pj-to").hidden = true; say("Nothing was changed."); });
  $("pj-pats").addEventListener("click", () => ctx.job(readPatterns));
  $("pj-tolib").addEventListener("click", () => ctx.job(toLib));
  $("pj-tounit").addEventListener("click", () => ctx.job(toUnit));
  $("pj-oget").addEventListener("click", () => ctx.job(oGet));
  $("pj-osend").addEventListener("click", () => ctx.job(oSend, { writes: true }));
  $("pj-export").addEventListener("click", exportP);
  $("pj-import").addEventListener("click", () => $("pj-file").click());
  $("pj-file").addEventListener("change", (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) ctx.job(() => importP(f)); });
  $("pj-shrename").addEventListener("click", () => ctx.job(renameShelf));
  $("pj-forget").addEventListener("click", () => ctx.job(forget));
  document.addEventListener("keydown", (e) => {
    if (!S.shown || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const i = S.shelf.findIndex((x) => x.id === S.ssel), n = Math.max(0, Math.min(S.shelf.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)));
      if (S.shelf[n]) { S.ssel = S.shelf[n].id; render(); }
      e.preventDefault(); return;
    }
    if (ctx.other() && S.olist && (k === "g" || k === "t" || e.key === "[" || e.key === "]")) {
      if (k === "g") ctx.job(oGet); else if (k === "t") ctx.job(oSend, { writes: true });
      else { S.osel = Math.max(1, Math.min(S.olist.length, S.osel + (e.key === "[" ? -1 : 1))); render(); }
      e.preventDefault(); return;
    }
    if (k === "e" || k === "i" || (k === "b" && S.list) || (k === "u" && S.list)) {
      if (k === "e") exportP(); else if (k === "i") $("pj-file").click(); else ctx.job(k === "b" ? toLib : toUnit);
      e.preventDefault(); return;
    }
    if (!S.list) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") { S.sel = Math.max(1, Math.min(S.list.length, S.sel + (e.key === "ArrowUp" ? -1 : 1))); render(); }
    else if (e.key === "Enter") ctx.job(loadP);
    else if (e.key.toLowerCase() === "n") ctx.job(newP);
    else if (e.key.toLowerCase() === "r") rename();
    else if (e.key.toLowerCase() === "c") pickTo(false);
    else if (e.key.toLowerCase() === "m") pickTo(true);
    else if (/^[1-8]$/.test(e.key) && !$("pj-to").hidden) { const b = [...$("pj-toslots").querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(e.key)); if (b) b.click(); }
    else if (e.key === "Delete" || e.key === "Backspace") ctx.job(del);
    else if (e.key === "Escape" && !$("pj-to").hidden) { $("pj-to").hidden = true; }
    else if (e.key.toLowerCase() === "p") ctx.job(readPatterns);
    else return;
    e.preventDefault();
  });
  readShelf();
  // what plays now (the FM-1 in this page's frames): the slot worked on beats while it plays and says which pattern;
  // its patterns' grid lights the playing one and the one queued (drawn over what render() made)
  let liveOff = null, liveAt = 0;
  function tick(L) {
    if (!S.list || !L) return;
    const cur = $("pj-slots").querySelector(`.pjslot[data-p="${S.current}"]`);
    if (cur) {
      const play = !!L[0] && L[30] === S.current, info = cur.lastElementChild;
      cur.classList.toggle("playing", play);
      cur.classList.toggle("beat", play && L[23] < 90);
      if (info) info.textContent = play ? `PLAYING ${patName(L[1])}${L[2] ? ` → ${patName(L[2] - 1)}` : ""}` : "WORKED ON";
    }
    const g = $("pj-grid"), mine = S.sel === S.current && L[30] === S.current;
    [...g.children].forEach((c, k) => { c.classList.toggle("ph", mine && !!L[0] && k === L[1]); c.classList.toggle("q", mine && L[2] - 1 === k); });
  }
  function live(on) {
    if (liveOff) { liveOff(); liveOff = null; }
    const u = on && ctx.unit ? ctx.unit() : null;
    if (u) liveOff = u.onFrame((m) => {
      if (!ctx.unit()) { live(false); render(); return; }          // (the screens went to a unit on USB: let go)
      const t = performance.now(); if (m.live && t - liveAt > 60) { liveAt = t; tick(m.live); }
    });
  }
  return {
    load, render,
    async follow() { if (S.shown && !liveOff) live(true); await follow(); },
    show(on) { S.shown = on; live(on); if (on && ctx.link() && (!S.list || (ctx.other() && !S.olist))) ctx.job(load); if (on) readShelf(); else render(); },
    gone() { S.list = null; S.olist = null; S.pats = null; $("pj-to").hidden = true; render(); },
  };
}
