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
//   mountProjects({ $, say, refuse, link(), busy(), job(fn), changed() }) -> { show(on), load(), gone(), render() }
import { patternsOf, LAYOUT, SECTOR } from "./egstore.js";
import { cleanName } from "./egfiles.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "big", scale = 2, color = "white") => { const t = document.createElement("px-text"); t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color); t.textContent = s; return t; };
const patName = (k) => `${"ABCD"[k >> 4]}${String((k & 15) + 1).padStart(2, "0")}`;

export function mountProjects(ctx) {
  const { $, say, refuse } = ctx;
  const S = { list: null, current: 0, sel: 0, pats: null, shown: false, reading: false };
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
        <p class="dim">The FM-1 must be stopped. A load saves the project worked on first. A delete, and a copy over a project, cannot be undone: back up first (CABINET).</p>
      </div>
      <div class="pjmain box">
        <div class="hhead"><span class="lab" id="pj-pname">PATTERNS</span><button id="pj-pats" class="key plain" type="button"></button></div>
        <div id="pj-grid" class="sqpats pjgrid" aria-label="The project's patterns"></div>
        <p class="dim" id="pj-patnote">The patterns as the FM-1 last saved them. A lit one has steps.</p>
      </div>
    </div>`;
  for (const [id, label] of [["pj-load", "LOAD"], ["pj-new", "NEW"], ["pj-rename", "RENAME"], ["pj-copy", "COPY TO"], ["pj-move", "MOVE TO"], ["pj-delete", "DELETE"], ["pj-tono", "CANCEL"], ["pj-pats", "READ PATTERNS"]])
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
    render();
  }
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
  const typed = (p, what) => {
    const s = slot(p), want = (s && s.name) || String(p);
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
    if (over && !typed(q, `${label(q)} is replaced by a copy of ${label(p)}.`)) { say("Nothing was changed."); return; }
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
    if (!typed(p, p === S.current ? `${label(p)} is the one worked on: it is replaced by a blank project.` : `${label(p)} is deleted from the FM-1.`)) { say("Nothing was deleted."); return; }
    if (!(await stopped())) return;
    if (!done(await ctx.link().project("delete", p), "delete it")) return;
    await after(`${p === S.current ? "Project " + p + " is blank now" : "Deleted project " + p}.`);
  }

  function render() {
    const l = ctx.link(), off = !l || ctx.busy();
    const box = $("pj-slots");
    box.textContent = "";
    $("pj-title").textContent = S.list ? `THE PROJECTS · ${S.list.filter((s) => s.there).length} OF ${S.list.length} SLOTS` : "THE PROJECTS";
    if (!S.list) box.append(el("p", "dim", l ? "Reading the projects .." : "Connect an FM-1 to see its projects."));
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
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.list || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
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
  return {
    load, render,
    show(on) { S.shown = on; if (on && ctx.link() && !S.list) ctx.job(load); render(); },
    gone() { S.list = null; S.pats = null; $("pj-to").hidden = true; render(); },
  };
}
