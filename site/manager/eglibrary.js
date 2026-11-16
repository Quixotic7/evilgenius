// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager's LIBRARY tab: the FM-1's sounds as its LIST gives them, MY PRESETS and the factory's, found by name and
// by tag: a list, the sound picked beside it on a card. Each: EDIT (its DUMP into SOUND), LOAD ON FM-1 (BROWSE: the
// unit's own sound browser opened on it, on the track picked: OCT- cancels on the unit, OCT+ loads), EXPORT (.egsnd);
// MY PRESETS' also RENAME, TAGS, USED BY, DELETE (one in use: its users said, then asked again) and UP / DOWN (SWAP
// with the place beside). Keys: UP / DOWN (PAGE, HOME, END) a sound, / find, A M F which, 1..7 a tag, K the track,
// R read again; ENTER edit, L load, E export, N rename, T tags, U used by, [ ] move, DELETE. Every change is the unit's own
// command, one undo level on the unit each. Written for EvilGenius (MPL-2.0); FIZZ's LIBRARY lent ideas only.
//   mountLibrary({ $, say, refuse, link(), busy(), job(fn), download, edit(sound, origin) }) -> { load(), clear(), render() }
//   filterRows(rows, {q, src, tags}) (no DOM: the tests)
import { parseDump, TAGS } from "./egsysex.js";
import { soundFromDump, blobNow } from "./egsound.js";
import { soundFile, soundName, cleanName } from "./egfiles.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "small", scale = 2, color = "white") => {
  const t = document.createElement("px-text");
  t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color);
  t.textContent = s;
  return t;
};
const tagList = (m) => TAGS.filter((_, k) => (m >> k) & 1);

export function filterRows(rows, { q = "", src = "all", tags = 0 } = {}) {
  const want = q.trim().toLowerCase();
  return rows.filter((r) => (src === "all" || r.source === src) && (!tags || (r.tags & tags) === tags) &&
    (!want || r.name.toLowerCase().includes(want)));
}

// USERS' reply in words: "in the pool of projects 1 (12 steps), 3; tracks 2, 5 play it" / "used nowhere"
export function usedText(u) {
  const tracks = [0, 1, 2, 3, 4, 5].filter((t) => (u.tracks >> t) & 1).map((t) => t + 1);
  const parts = [];
  if (u.projects.length) parts.push(`in the pool of project${u.projects.length > 1 ? "s" : ""} ${u.projects.map((p) => `${p.project}${p.steps ? ` (${p.steps} step${p.steps === 1 ? "" : "s"})` : ""}`).join(", ")}`);
  if (tracks.length) parts.push(`track${tracks.length > 1 ? "s" : ""} ${tracks.join(", ")} play${tracks.length > 1 ? "" : "s"} it`);
  return parts.length ? parts.join("; ") : "used nowhere";
}

export function mountLibrary(ctx) {
  const { $, say, refuse } = ctx;
  const S = { rows: null, q: "", src: "all", tags: 0, nlib: 128, sel: null, mode: "" };
  const root = $("tab-library");
  root.innerHTML = `
    <div class="libbar">
      <label>FIND <input id="lb-q" type="text" placeholder="a name (/)" spellcheck="false" autocomplete="off"></label>
      <span class="seg" id="lb-src" role="group" aria-label="Which sounds (A, M, F)"></span>
      <span class="seg" id="lb-tags" role="group" aria-label="Tags (1..7)"></span>
      <label>ON TRACK <select id="lb-track" aria-label="The track LOAD ON FM-1 opens the browser on (K)"><option value="selected">SELECTED</option>${[1, 2, 3, 4, 5, 6].map((t) => `<option value="${t - 1}">${t}</option>`).join("")}</select></label>
      <button id="lb-read" class="key plain" type="button" title="R"></button>
    </div>
    <div class="lbbody">
      <div class="lblist" id="lb-list" role="listbox" tabindex="0" aria-label="The FM-1's sounds (UP / DOWN)"></div>
      <aside class="box lbcard" id="lb-card" aria-live="polite"></aside>
    </div>`;
  $("lb-read").append(px("READ AGAIN", "big", 2));
  for (const [k, label] of [["all", "ALL"], ["mine", "MINE"], ["factory", "FACTORY"]]) {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.src = k; b.append(px(label));
    b.title = `${label} (${k === "all" ? "A" : k === "mine" ? "M" : "F"})`;
    b.addEventListener("click", () => { S.src = k; render(); });
    $("lb-src").append(b);
  }
  TAGS.forEach((t, k) => {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.k = k; b.append(px(t)); b.title = `${t} (${k + 1})`;
    b.addEventListener("click", () => { S.tags ^= 1 << k; render(); });
    $("lb-tags").append(b);
  });
  $("lb-q").addEventListener("input", () => { S.q = $("lb-q").value; render(); });
  $("lb-q").addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); $("lb-list").focus(); } });
  $("lb-read").addEventListener("click", () => ctx.job(() => load()));

  async function load({ quiet = false } = {}) {
    const l = ctx.link();
    if (!l) return;
    if (!quiet) say("Reading the FM-1's sounds", "busy");
    const st = await l.status();
    if (st && st.nlib) S.nlib = st.nlib;
    S.rows = await l.list({ factory: true });
    const mine = S.rows.filter((r) => r.source === "mine").length;
    if (!quiet) say(`${mine} in MY PRESETS, ${S.rows.length - mine} factory sounds.`, "ok");
    render();
  }
  const target = () => ($("lb-track").value === "selected" ? "selected" : Number($("lb-track").value));
  const shown = () => (S.rows ? filterRows(S.rows, S) : []);
  const key = (r) => r && `${r.source}:${r.slot}`;
  const picked = () => { const l = shown(); return l.find((r) => key(r) === S.sel) || l[0] || null; };

  function render() {
    for (const b of $("lb-src").children) b.setAttribute("aria-pressed", String(b.dataset.src === S.src));
    for (const b of $("lb-tags").children) b.setAttribute("aria-pressed", String(!!(S.tags & (1 << b.dataset.k))));
    $("lb-read").disabled = !ctx.link() || ctx.busy();
    const box = $("lb-list");
    box.textContent = "";
    if (!S.rows) { box.append(el("p", "dim", ctx.link() ? "Press READ AGAIN (R) to read the FM-1's sounds." : "Connect an FM-1 to see its sounds.")); renderCard(null); return; }
    const list = shown(), cur = picked();
    S.sel = key(cur);
    for (const r of list) {
      const row = el("div", `lbrow${key(r) === S.sel ? " on" : ""}`);
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(key(r) === S.sel));
      row.append(el("span", "dim", `${r.source === "mine" ? "M" : "F"}${r.slot}`), el("span", "name", r.name),
        el("span", "dim", tagList(r.tags).join(" ")), el("span", "dim", r.inPool ? "POOL" : ""));
      row.addEventListener("click", () => { S.sel = key(r); S.mode = ""; render(); });
      row.addEventListener("dblclick", () => ctx.job(() => editRow(r)));
      box.append(row);
    }
    const on = box.querySelector(".lbrow.on");
    if (on) on.scrollIntoView({ block: "nearest" });
    renderCard(cur, list.length);
  }
  // the card: the sound picked, its actions with their keys
  function renderCard(r, n = 0) {
    const c = $("lb-card");
    c.textContent = "";
    if (!r) { c.append(el("p", "dim", S.rows ? "No sound matches." : "")); return; }
    const mine = S.rows.filter((x) => x.source === "mine").length;
    c.append(el("p", "lab", `${n} OF ${S.rows.length} SHOWN · MY PRESETS ${mine} OF ${S.nlib}`));
    const h = el("h2", "lbname"); h.append(px(r.name, "big", 3, "yellow")); c.append(h);
    c.append(el("p", "", `${r.source === "mine" ? "MY PRESETS" : "FACTORY"} ${r.slot} · ${tagList(r.tags).join(" ") || "NO TAGS"}${r.inPool ? " · IN THE POOL" : ""}`));
    if (S.mode === "rename") {
      const inp = el("input"); inp.type = "text"; inp.maxLength = 12; inp.value = r.name; inp.setAttribute("aria-label", `A new name for ${r.name}`);
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") { S.mode = ""; render(); $("lb-list").focus(); }
        if (e.key === "Enter") { const nm = cleanName(inp.value); S.mode = ""; if (nm && nm !== r.name) ctx.job(async () => { if (await done(await ctx.link().rename("mine", r.slot, nm), "rename it")) { say(`${r.name} is ${nm} now.`, "ok"); r.name = nm; } render(); $("lb-list").focus(); }); else { render(); $("lb-list").focus(); } }
      });
      c.append(el("p", "dim", "ENTER keeps the name, ESC leaves it."), inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
      return;
    }
    if (S.mode === "tags") {
      const box = el("div", "seg");
      TAGS.forEach((t, k) => {
        const b = el("button", "key plain"); b.type = "button"; b.append(px(`${k + 1} ${t}`)); b.setAttribute("aria-pressed", String(!!(S.tagEdit & (1 << k))));
        b.addEventListener("click", () => { S.tagEdit ^= 1 << k; render(); });
        box.append(b);
      });
      c.append(el("p", "dim", "1..7 a tag, ENTER sets them, ESC leaves them."), box);
      return;
    }
    const acts = el("div", "lbacts");
    const off = !ctx.link() || ctx.busy();
    const act = (k, label, fn, cls = "key plain", dis = false) => {
      const b = el("button", cls); b.type = "button"; b.disabled = off || dis;
      b.append(el("kbd", "", k), px(label)); b.setAttribute("aria-label", `${label} (${k})`);
      b.addEventListener("click", fn);
      acts.append(b);
    };
    act("ENTER", "EDIT", () => ctx.job(() => editRow(r)));
    act("L", "LOAD ON FM-1", () => ctx.job(() => loadOn(r)));
    act("E", "EXPORT", () => ctx.job(() => exportRow(r)));
    if (r.source === "mine") {
      act("N", "RENAME", () => { S.mode = "rename"; render(); });
      act("T", "TAGS", () => { S.mode = "tags"; S.tagEdit = r.tags; render(); });
      act("U", "USED BY", () => ctx.job(() => usedBy(r)));
      act("[", "MOVE UP", () => ctx.job(() => move(r, -1)), "key plain", r.slot <= 1);
      act("]", "MOVE DOWN", () => ctx.job(() => move(r, 1)), "key plain", r.slot >= S.nlib);
      act("DEL", "DELETE", () => ctx.job(() => remove(r)), "key warn");
    }
    c.append(acts);
    c.append(el("p", "dim lbhelp", `LOAD ON FM-1 opens the unit's own browser on it, on track ${target() === "selected" ? "SELECTED" : target() + 1} (K): OCT+ there loads it, OCT- cancels. Renaming, tags, moves and deletes are the unit's own: SHIFT + F1 on it undoes each.`));
  }
  async function dumpOf(r) {
    const f = await ctx.link().dump(r.source, r.slot);
    const snd = f && soundFromDump(parseDump(f));
    if (!snd) throw new Error(`the FM-1 did not send ${r.name}`);
    snd.name = snd.name || r.name; snd.tags = snd.tags || r.tags;
    return snd;
  }
  async function editRow(r) {
    const snd = await dumpOf(r);
    ctx.edit(snd, { kind: r.source, slot: r.slot });
    say(`${r.name} is in SOUND.`, "ok");
  }
  async function exportRow(r) {
    const snd = await dumpOf(r);
    const p = { ...snd, blob: blobNow(snd), slot: r.slot };
    ctx.download(soundName(p), soundFile(p, { firmware: ctx.link().id, date: new Date().toISOString() }), "application/json");
    say(`Saved ${soundName(p)} to your downloads.`, "ok");
  }
  async function loadOn(r) {
    const a = await ctx.link().browse(target(), r.id);
    if (!a || a.old) { refuse("this EVILGENIUS cannot open its browser from here"); return; }
    if (a.status) { refuse(`the FM-1 did not open its browser (${a.statusName}${a.statusName === "BUSY" ? ": a name is being typed on it" : ""})`); return; }
    say(`The FM-1's browser is open on ${r.name} (track ${a.a}). On the unit: OCT+ loads it, OCT- cancels.`, "ok");
  }
  async function done(a, what) {
    if (!a || a.old) { refuse(`this EVILGENIUS cannot ${what} from here`); return false; }
    if (a.status) { refuse(`the FM-1 did not ${what} (${a.statusName}${a.statusName === "BUSY" ? ": stop it first" : ""})`); return false; }
    return true;
  }
  // USED BY: the projects whose pools hold it (this one's steps counted), the tracks of this project playing it
  async function usedBy(r) {
    const u = await ctx.link().users("mine", r.slot);
    if (!u || u.old) { refuse("this EVILGENIUS cannot say who uses it"); return; }
    if (u.status) { refuse(`the FM-1 did not say (${u.statusName})`); return; }
    say(`${r.name}: ${usedText(u)}.`, "ok");
  }
  async function move(r, d) {
    const to = r.slot + d;
    if (to < 1 || to > S.nlib) return;
    if (!(await done(await ctx.link().swap("mine", r.slot, to), "move it"))) return;
    await load({ quiet: true });
    S.sel = `mine:${to}`;
    render();
    say(`${r.name} is at MY PRESETS ${to} now.`, "ok");
  }
  async function remove(r) {
    if (!window.confirm(`Delete ${r.name} from MY PRESETS ${r.slot}? SHIFT + F1 on the FM-1 undoes it.`)) return;
    let a = await ctx.link().remove("mine", r.slot);
    if (a && a.statusName === "IN USE") {
      const u = await ctx.link().users("mine", r.slot);
      const where = u && u.projects && u.projects.length ? ` (projects ${u.projects.map((p) => p.project).join(", ")})` : "";
      if (!window.confirm(`${r.name} is in use${where}. The other projects keep their own copy of it; in this project its pool places are cleared and their steps go back to the track's sound. Delete it anyway?`)) { say("Nothing was deleted."); return; }
      a = await ctx.link().remove("mine", r.slot, { confirm: true });
    }
    if (!(await done(a, "delete it"))) return;
    S.rows = S.rows.filter((x) => x !== r);
    say(`Deleted ${r.name}.`, "ok");
    render();
  }
  // ---- the keys (LIBRARY shown; not while typing a name)
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.rows || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) return;
    const r = picked(), list = shown(), i = list.indexOf(r), k = e.key;
    const go = (j) => { const x = list[Math.max(0, Math.min(list.length - 1, j))]; if (x) { S.sel = key(x); S.mode = ""; render(); } };
    if (S.mode === "tags") {
      if (/^[1-7]$/.test(k)) { S.tagEdit ^= 1 << (+k - 1); render(); }
      else if (k === "Enter" && r) { const m = S.tagEdit; S.mode = ""; ctx.job(async () => { if (await done(await ctx.link().tags("mine", r.slot, m), "tag it")) { r.tags = m; say(`${r.name}: ${tagList(m).join(", ") || "no tags"}.`, "ok"); } render(); }); }
      else if (k === "Escape") { S.mode = ""; render(); }
      else return;
      e.preventDefault(); return;
    }
    if (k === "ArrowDown" || k === "ArrowUp") go(i + (k === "ArrowDown" ? 1 : -1));
    else if (k === "PageDown" || k === "PageUp") go(i + (k === "PageDown" ? 12 : -12));
    else if (k === "Home" || k === "End") go(k === "Home" ? 0 : list.length - 1);
    else if (k === "/") $("lb-q").focus();
    else if (/^[1-7]$/.test(k)) { S.tags ^= 1 << (+k - 1); render(); }
    else if (k === "a" || k === "m" || k === "f") { S.src = { a: "all", m: "mine", f: "factory" }[k]; render(); }
    else if (k === "k") { const s = $("lb-track"); s.selectedIndex = (s.selectedIndex + 1) % s.options.length; render(); say(`LOAD ON FM-1 opens on track ${s.options[s.selectedIndex].text}.`); }
    else if (k === "r" && ctx.link()) ctx.job(() => load());
    else if (!r || ctx.busy() || !ctx.link()) return;
    else if (k === "Enter") ctx.job(() => editRow(r));
    else if (k === "l") ctx.job(() => loadOn(r));
    else if (k === "e") ctx.job(() => exportRow(r));
    else if (r.source !== "mine") return;
    else if (k === "n") { S.mode = "rename"; render(); }
    else if (k === "t") { S.mode = "tags"; S.tagEdit = r.tags; render(); }
    else if (k === "u") ctx.job(() => usedBy(r));
    else if (k === "[" || k === "]") ctx.job(() => move(r, k === "]" ? 1 : -1));
    else if (k === "Delete" || k === "Backspace") ctx.job(() => remove(r));
    else return;
    e.preventDefault();
  });
  return { load, render, clear() { S.rows = null; render(); }, show(on) { S.shown = on; if (on) render(); }, state: S };
}
