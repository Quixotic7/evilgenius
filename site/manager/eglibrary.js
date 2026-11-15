// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager's LIBRARY tab: the FM-1's sounds as its LIST gives them, MY PRESETS and the factory's, found by name and
// by tag. Each: EDIT (its DUMP into EDIT), LOAD ON FM-1 (BROWSE: the unit's own sound browser opened on it, on the
// track picked: OCT- cancels on the unit, OCT+ loads), EXPORT (.egsnd); MY PRESETS' also RENAME, TAGS, DELETE (one
// in use: its users said, then asked again) and UP / DOWN (SWAP with the place beside). Every change is the unit's own
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

export function mountLibrary(ctx) {
  const { $, say, refuse } = ctx;
  const S = { rows: null, q: "", src: "all", tags: 0, nlib: 128 };
  const root = $("tab-library");
  root.innerHTML = `
    <p>The FM-1's sounds: MY PRESETS and the factory's. <strong>EDIT</strong> opens one in EDIT; <strong>LOAD ON FM-1</strong> opens the FM-1's own sound browser on it (on the unit, OCT+ loads it onto the track, OCT- cancels). Renaming, tagging, deleting and moving MY PRESETS are the FM-1's own commands: SHIFT + F1 on the unit undoes each.</p>
    <div class="libbar">
      <label>FIND <input id="lb-q" type="text" placeholder="a name" spellcheck="false" autocomplete="off"></label>
      <span class="seg" id="lb-src" role="group" aria-label="Which sounds"></span>
      <span class="seg" id="lb-tags" role="group" aria-label="Tags"></span>
      <label>ON TRACK <select id="lb-track" aria-label="The track LOAD ON FM-1 opens the browser on"><option value="selected">SELECTED</option>${[1, 2, 3, 4, 5, 6].map((t) => `<option value="${t - 1}">${t}</option>`).join("")}</select></label>
      <button id="lb-read" class="key plain" type="button"></button>
    </div>
    <p id="lb-note" class="dim">Connect an FM-1 to see its sounds.</p>
    <table id="lb-table" hidden>
      <caption class="px-sr">The FM-1's sounds</caption>
      <thead><tr><th scope="col">Place</th><th scope="col">Name</th><th scope="col">Tags</th><th scope="col"><span class="px-sr">Actions</span></th></tr></thead>
      <tbody id="lb-rows"></tbody>
    </table>`;
  $("lb-read").append(px("READ AGAIN", "big", 2));
  for (const [k, label] of [["all", "ALL"], ["mine", "MY PRESETS"], ["factory", "FACTORY"]]) {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.src = k; b.append(px(label));
    b.addEventListener("click", () => { S.src = k; render(); });
    $("lb-src").append(b);
  }
  TAGS.forEach((t, k) => {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.k = k; b.append(px(t));
    b.addEventListener("click", () => { S.tags ^= 1 << k; render(); });
    $("lb-tags").append(b);
  });
  $("lb-q").addEventListener("input", () => { S.q = $("lb-q").value; render(); });
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
  const btn = (label, aria, fn, cls = "key plain") => {
    const b = el("button", cls); b.type = "button"; b.setAttribute("aria-label", aria); b.append(px(label));
    b.addEventListener("click", fn);
    b.disabled = !ctx.link() || ctx.busy();
    return b;
  };
  const target = () => ($("lb-track").value === "selected" ? "selected" : Number($("lb-track").value));

  function render() {
    for (const b of $("lb-src").children) b.setAttribute("aria-pressed", String(b.dataset.src === S.src));
    for (const b of $("lb-tags").children) b.setAttribute("aria-pressed", String(!!(S.tags & (1 << b.dataset.k))));
    $("lb-read").disabled = !ctx.link() || ctx.busy();
    const tb = $("lb-rows");
    tb.textContent = "";
    if (!S.rows) { $("lb-table").hidden = true; $("lb-note").textContent = ctx.link() ? "Press READ AGAIN to read the FM-1's sounds." : "Connect an FM-1 to see its sounds."; return; }
    const list = filterRows(S.rows, S);
    $("lb-table").hidden = !list.length;
    const mine = S.rows.filter((r) => r.source === "mine").length;
    $("lb-note").textContent = `${list.length} of ${S.rows.length} sounds shown. MY PRESETS: ${mine} of ${S.nlib} places used.`;
    for (const r of list) {
      const tr = el("tr");
      const place = el("td", "dim", `${r.source === "mine" ? "MINE" : "FACT"} ${r.slot}`);
      const name = el("td", "name", r.name);
      const tags = el("td", "", tagList(r.tags).join(", "));
      const act = el("td", "acts");
      act.append(btn("EDIT", `Edit ${r.name}`, () => ctx.job(() => editRow(r))));
      act.append(btn("LOAD ON FM-1", `Open the FM-1's browser on ${r.name}`, () => ctx.job(() => loadOn(r))));
      act.append(btn("EXPORT", `Export ${r.name}`, () => ctx.job(() => exportRow(r))));
      if (r.source === "mine") {
        act.append(btn("RENAME", `Rename ${r.name}`, () => rename(r, name)));
        act.append(btn("TAGS", `Tags of ${r.name}`, () => tagsOf(r, tags)));
        act.append(btn("UP", `Move ${r.name} up`, () => ctx.job(() => move(r, -1))));
        act.append(btn("DOWN", `Move ${r.name} down`, () => ctx.job(() => move(r, 1))));
        act.append(btn("DELETE", `Delete ${r.name}`, () => ctx.job(() => remove(r)), "key warn"));
      }
      tr.append(place, name, tags, act);
      tb.append(tr);
    }
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
    say(`${r.name} is in EDIT.`, "ok");
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
  function rename(r, cell) {
    const inp = el("input");
    inp.type = "text"; inp.maxLength = 12; inp.value = r.name; inp.setAttribute("aria-label", `A new name for ${r.name}`);
    cell.textContent = ""; cell.append(inp); inp.focus(); inp.select();
    let gone = false;
    const finish = (keep) => {
      if (gone) return; gone = true;
      const nm = cleanName(inp.value);
      if (!keep || !nm || nm === r.name) { render(); return; }
      ctx.job(async () => { if (await done(await ctx.link().rename("mine", r.slot, nm), "rename it")) { say(`${r.name} is ${nm} now.`, "ok"); r.name = nm; } render(); });
    };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
    inp.addEventListener("blur", () => finish(true));
  }
  function tagsOf(r, cell) {
    cell.textContent = "";
    const box = el("span", "seg");
    let m = r.tags;
    TAGS.forEach((t, k) => {
      const b = el("button", "key plain"); b.type = "button"; b.append(px(t)); b.setAttribute("aria-pressed", String(!!(m & (1 << k))));
      b.addEventListener("click", () => { m ^= 1 << k; b.setAttribute("aria-pressed", String(!!(m & (1 << k)))); });
      box.append(b);
    });
    const ok = el("button", "key go"); ok.type = "button"; ok.append(px("SET"));
    ok.addEventListener("click", () => ctx.job(async () => { if (await done(await ctx.link().tags("mine", r.slot, m), "tag it")) { r.tags = m; say(`${r.name}: ${tagList(m).join(", ") || "no tags"}.`, "ok"); } render(); }));
    cell.append(box, ok);
  }
  async function move(r, d) {
    const to = r.slot + d;
    if (to < 1 || to > S.nlib) return;
    if (!(await done(await ctx.link().swap("mine", r.slot, to), "move it"))) return;
    await load({ quiet: true });
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
  return { load, render, clear() { S.rows = null; render(); }, state: S };
}
