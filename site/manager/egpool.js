// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// POOL (F6): the open project's pool, its 128 places, as the unit's SOUNDS page numbers them (a step's sound lock and a
// track's source name a place). A place holds a preset (one of MY PRESETS or the factory's) by its id. Pick a place,
// then a sound on the right: POOL REF puts it there. CLEAR empties a place (the steps that locked it go back to their
// track's sound), MOVE swaps two places (every step and track that names either follows: the unit's own SWAP), SORT BY
// TAG packs the places in tag order, CLEAR UNUSED empties the places no step or track uses (USERS asked of each), USED BY
// says who uses one. Each is the unit's own command, an undo level on the unit (SHIFT + F1). The pool is the open
// project's: another project's is shown after PROJECTS loads it. Written for EvilGenius (MPL-2.0); FIZZ's POOL tab lent
// ideas only. On the FM-1 in this browser the places the tracks play light up while they sound (each frame's
// eg_web_live: each track's place, the tracks gated), in the track's colour, with the track's number.
//   mountPool({ $, say, refuse, link(), busy(), job(fn) }) -> { show(on), load(), gone(), render() }
//   sortPlan(places) -> [[a, b], ..] the swaps that pack the used places in tag order (no DOM: the tests)
import { TAGS } from "./egsysex.js";
import { filterRows } from "./eglibrary.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "small", scale = 2, color = "white") => { const t = document.createElement("px-text"); t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color); t.textContent = s; return t; };
const NPOOL = 128, COLS = 16;
const tagKey = (m) => { for (let k = 0; k < TAGS.length; k++) if ((m >> k) & 1) return k; return TAGS.length; };
const COLOR = ["#c46c71", "#706deb", "#75cec8", "#a9ff9f", "#edf171", "#ffffff", "#8e3c97", "#4a4a4a"];   // (a tag's colour: BASS .. FX, none)

// places: [{slot 1..128, id, name, tags} | null] x 128. The swaps (a, b) that leave the used places 1..n in tag order, then
// name (as the unit's browser sorts them), each place moved once at most
export function sortPlan(places) {
  const cur = places.map((p) => (p ? p.slot : 0));          // cur[i]: which original place now sits at i + 1
  const want = places.filter(Boolean).sort((a, b) => tagKey(a.tags) - tagKey(b.tags) || a.name.localeCompare(b.name) || a.slot - b.slot)
    .map((p) => p.slot);
  const out = [];
  for (let i = 0; i < want.length; i++) {
    if (cur[i] === want[i]) continue;
    const j = cur.indexOf(want[i]);
    out.push([i + 1, j + 1]);
    [cur[i], cur[j]] = [cur[j], cur[i]];
  }
  return out;
}

export function mountPool(ctx) {
  const { $, say, refuse } = ctx;
  const S = { places: null, sounds: null, sel: 0, moving: 0, q: "", tags: 0, src: "all", shown: false, project: 0, pname: "" };
  const root = $("tab-pool");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="pl-title">THE POOL</span><span class="dim">ARROWS A PLACE · ENTER PUT THE SOUND · DELETE CLEAR · M MOVE · U USED BY · / FIND</span></div>
    <div class="plbody">
      <div class="plmain">
        <div id="pl-grid" class="plgrid" role="grid" aria-label="The pool's 128 places"></div>
        <div class="plbar">
          <p id="pl-sel" class="plsel"></p>
          <span class="keys">
            <button id="pl-clear" class="key warn" type="button"></button>
            <button id="pl-move" class="key plain" type="button"></button>
            <button id="pl-users" class="key plain" type="button"></button>
            <button id="pl-sort" class="key plain" type="button"></button>
            <button id="pl-unused" class="key plain" type="button"></button>
            <button id="pl-read" class="key plain" type="button"></button>
          </span>
        </div>
      </div>
      <aside class="plside box" aria-label="Sounds to put in the pool">
        <p class="lab">SOUNDS</p>
        <label>FIND <input id="pl-q" type="text" placeholder="a name" spellcheck="false" autocomplete="off"></label>
        <div class="seg" id="pl-src" role="group" aria-label="Which sounds"></div>
        <div class="seg" id="pl-tags" role="group" aria-label="Tags"></div>
        <div id="pl-list" class="pllist" role="listbox" aria-label="Sounds"></div>
      </aside>
    </div>`;
  for (const [id, label] of [["pl-clear", "CLEAR"], ["pl-move", "MOVE"], ["pl-users", "USED BY"], ["pl-sort", "SORT BY TAG"], ["pl-unused", "CLEAR UNUSED"], ["pl-read", "READ AGAIN"]])
    $(id).append(px(label, "big", 2));
  for (const [k, label] of [["all", "ALL"], ["mine", "MINE"], ["factory", "FACTORY"]]) {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.src = k; b.append(px(label));
    b.addEventListener("click", () => { S.src = k; renderList(); });
    $("pl-src").append(b);
  }
  TAGS.forEach((t, k) => {
    const b = el("button", "key plain"); b.type = "button"; b.dataset.k = k; b.append(px(t));
    b.addEventListener("click", () => { S.tags ^= 1 << k; renderList(); });
    $("pl-tags").append(b);
  });
  $("pl-q").addEventListener("input", () => { S.q = $("pl-q").value; renderList(); });
  $("pl-q").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); const b = $("pl-list").querySelector("button"); if (b) b.focus(); } });
  $("pl-list").addEventListener("keydown", (e) => {               // (the sounds: UP / DOWN, ENTER puts one in, ESC back)
    const bs = [...$("pl-list").querySelectorAll("button")], at = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); (bs[at + (e.key === "ArrowDown" ? 1 : -1)] || bs[at]).focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); document.activeElement.blur(); }
  });
  $("pl-clear").addEventListener("click", () => ctx.job(clear));
  $("pl-move").addEventListener("click", () => startMove());
  $("pl-users").addEventListener("click", () => ctx.job(usedBy));
  $("pl-sort").addEventListener("click", () => ctx.job(sort));
  $("pl-unused").addEventListener("click", () => ctx.job(clearUnused));
  $("pl-read").addEventListener("click", () => ctx.job(load));

  // the FM-1 in this page, followed: the pool as its own panel changed it
  async function follow() {
    const l = ctx.link();
    if (!S.shown || !l || !S.places || S.moving) return;
    const snap = JSON.stringify(await l.list({ factory: true, pool: true }));
    if (snap !== S.snap && !S.moving && !ctx.busy()) await ctx.job(load);
  }
  async function load() {
    const l = ctx.link();
    if (!l) return;
    const [rows, pj] = [await l.list({ factory: true, pool: true }), await l.projects()];
    S.snap = JSON.stringify(rows);
    S.places = new Array(NPOOL).fill(null);
    for (const r of rows) if (r.source === "pool" && r.slot >= 1 && r.slot <= NPOOL) S.places[r.slot - 1] = r;
    S.sounds = rows.filter((r) => r.source !== "pool");
    S.project = pj ? pj.current : 0;
    S.pname = pj && pj.list[pj.current - 1] ? pj.list[pj.current - 1].name : "";
    if (!S.sel) S.sel = 1;
    render();
  }
  const stopped = async () => {
    const st = await ctx.link().status();
    if (st && st.playing) { refuse("stop the FM-1 first: the pool's places move only while it is stopped"); return false; }
    return true;
  };
  const done = (a, what) => {
    if (!a || a.old) { refuse(`this EVILGENIUS cannot ${what} from here`); return false; }
    if (a.status) { refuse(`the FM-1 did not ${what} (${a.statusName})`); return false; }
    return true;
  };
  const place = (k) => (S.places ? S.places[k - 1] : null);
  async function put(snd) {
    const k = S.sel;
    if (!k || !snd) return;
    const was = place(k);
    if (was && was.id === snd.id) return;
    if (was && !window.confirm(`Place ${k} holds ${was.name}. Put ${snd.name} there instead? The steps and tracks that use place ${k} play ${snd.name} then.`)) return;
    if (!done(await ctx.link().poolRef(k, snd.id), "put it in the pool")) return;
    await load();
    say(`${snd.name} is in the pool at place ${k}.`, "ok");
  }
  async function clear() {
    const k = S.sel, p = place(k);
    if (!p) return;
    if (!window.confirm(`Clear place ${k} (${p.name})? The steps that lock it go back to their track's sound. SHIFT + F1 on the FM-1 undoes it.`)) return;
    if (!done(await ctx.link().poolRef(k, 0), "clear it")) return;
    await load();
    say(`Place ${k} is empty.`, "ok");
  }
  function startMove() {
    if (!place(S.sel)) return;
    S.moving = S.moving ? 0 : S.sel;
    render();
    if (S.moving) say(`Moving ${place(S.moving).name}: pick the place it goes to (ENTER or a click), ESC to stop.`);
  }
  async function moveTo(k) {
    const a = S.moving;
    S.moving = 0;
    if (!a || a === k) { render(); return; }
    if (!(await stopped())) { render(); return; }
    say(`Moving place ${a} to ${k}: the steps that use them follow`, "busy");
    if (!done(await ctx.link().swap("pool", a, k), "move it")) return;
    S.sel = k;
    await load();
    say(`Place ${k} holds ${place(k) ? place(k).name : "nothing"} now${place(a) ? `, place ${a} ${place(a).name}` : ""}.`, "ok");
  }
  async function usedBy() {
    const k = S.sel, p = place(k);
    if (!p) return;
    const u = await ctx.link().users("pool", k);
    if (!u || u.old) { refuse("this EVILGENIUS cannot say who uses it"); return; }
    if (u.status) { refuse(`the FM-1 did not say (${u.statusName})`); return; }
    const steps = u.projects.reduce((n, x) => n + x.steps, 0), tracks = [0, 1, 2, 3, 4, 5].filter((t) => (u.tracks >> t) & 1).map((t) => t + 1);
    say(`Place ${k} (${p.name}): ${steps ? `${steps} step${steps === 1 ? "" : "s"} lock it` : "no step locks it"}${tracks.length ? `, track${tracks.length > 1 ? "s" : ""} ${tracks.join(", ")} play it` : ""}.`, "ok");
  }
  async function sort() {
    if (!S.places) return;
    const plan = sortPlan(S.places);
    if (!plan.length) { say("The pool is in tag order already.", "ok"); return; }
    if (!window.confirm(`Sort the pool by tag? ${plan.length} move${plan.length === 1 ? "" : "s"} on the FM-1; every step and track follows its sound. Each is an undo level on the unit.`)) return;
    if (!(await stopped())) return;
    for (let i = 0; i < plan.length; i++) {
      say(`Sorting the pool: ${i + 1} of ${plan.length}`, "busy");
      if (!done(await ctx.link().swap("pool", plan[i][0], plan[i][1]), "move a place")) { await load(); return; }
    }
    await load();
    say(`The pool is sorted by tag: ${S.places.filter(Boolean).length} sounds in places 1..${S.places.filter(Boolean).length}.`, "ok");
  }
  async function clearUnused() {
    if (!S.places) return;
    const used = S.places.filter(Boolean), idle = [];
    for (let i = 0; i < used.length; i++) {
      say(`Asking who uses each place: ${i + 1} of ${used.length}`, "busy");
      const u = await ctx.link().users("pool", used[i].slot);
      if (!u || u.old || u.status) { refuse("the FM-1 did not say who uses its pool"); return; }
      if (!u.tracks && !u.projects.some((x) => x.steps)) idle.push(used[i]);
    }
    if (!idle.length) { say("Every sound in the pool is used.", "ok"); return; }
    if (!window.confirm(`Clear ${idle.length} unused place${idle.length === 1 ? "" : "s"}: ${idle.slice(0, 12).map((p) => `${p.slot} ${p.name}`).join(", ")}${idle.length > 12 ? ", .." : ""}?`)) { say("Nothing was cleared."); return; }
    for (let i = 0; i < idle.length; i++) {
      say(`Clearing ${i + 1} of ${idle.length}`, "busy");
      if (!done(await ctx.link().poolRef(idle[i].slot, 0), "clear it")) { await load(); return; }
    }
    await load();
    say(`Cleared ${idle.length} unused place${idle.length === 1 ? "" : "s"}.`, "ok");
  }

  function render() {
    const l = ctx.link(), off = !l || ctx.busy();
    const used = S.places ? S.places.filter(Boolean).length : 0;
    $("pl-title").textContent = S.places ? `THE POOL · PROJECT ${S.project}${S.pname && S.pname !== `PROJECT ${S.project}` ? ` ${S.pname}` : ""} · ${used} OF ${NPOOL} PLACES` : "THE POOL";
    const g = $("pl-grid");
    g.textContent = "";
    if (!S.places) { g.append(el("p", "dim", l ? "Reading the pool .." : "Connect an FM-1 to see its pool.")); }
    else for (let k = 1; k <= NPOOL; k++) {
      const p = place(k), b = el("button", `plc${p ? " used" : ""}${k === S.sel ? " on" : ""}${k === S.moving ? " mv" : ""}`);
      b.type = "button"; b.setAttribute("role", "gridcell"); b.setAttribute("aria-selected", String(k === S.sel));
      b.setAttribute("aria-label", `Place ${k}: ${p ? p.name : "empty"}`);
      b.append(el("span", "pln", String(k)), el("span", "plnm", p ? p.name : "·"));
      if (p) b.style.setProperty("--c", COLOR[tagKey(p.tags)]);
      b.addEventListener("click", () => { if (S.moving) ctx.job(() => moveTo(k)); else { S.sel = k; render(); } });
      b.addEventListener("dblclick", () => { S.sel = k; ctx.job(usedBy); });
      g.append(b);
    }
    const p = place(S.sel);
    $("pl-sel").textContent = !S.places ? "" : S.moving ? `MOVING ${place(S.moving).name} (PLACE ${S.moving}): PICK WHERE IT GOES`
      : `PLACE ${S.sel}: ${p ? `${p.name}${p.tags ? ` · ${TAGS.filter((_, k) => (p.tags >> k) & 1).join(" ")}` : ""}` : "EMPTY: PICK A SOUND ON THE RIGHT"}`;
    $("pl-clear").disabled = off || !p;
    $("pl-move").disabled = off || !p;
    $("pl-users").disabled = off || !p;
    $("pl-sort").disabled = off || !used;
    $("pl-unused").disabled = off || !used;
    $("pl-read").disabled = off;
    renderList();
  }
  function renderList() {
    for (const b of $("pl-src").children) b.setAttribute("aria-pressed", String(b.dataset.src === S.src));
    for (const b of $("pl-tags").children) b.setAttribute("aria-pressed", String(!!(S.tags & (1 << b.dataset.k))));
    const box = $("pl-list");
    box.textContent = "";
    if (!S.sounds) return;
    const off = !ctx.link() || ctx.busy();
    for (const r of filterRows(S.sounds, S)) {
      const b = el("button", `plsnd${r.inPool ? " in" : ""}`);
      b.type = "button"; b.setAttribute("role", "option"); b.disabled = off;
      b.setAttribute("aria-label", `Put ${r.name} at place ${S.sel}`);
      b.append(el("span", "dim", r.source === "mine" ? `M${r.slot}` : `F${r.slot}`), el("span", "", r.name), el("span", "dim", r.inPool ? "IN POOL" : ""));
      b.style.setProperty("--c", COLOR[tagKey(r.tags)]);
      b.addEventListener("click", () => ctx.job(() => put(r)));
      box.append(b);
    }
  }
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.places || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest("input, select, textarea")) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.target.closest && e.target.closest("#pl-list")) return;
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key];
    if (d) { S.sel = Math.max(1, Math.min(NPOOL, S.sel + d)); render(); e.preventDefault(); return; }
    if (e.key === "Enter") { if (S.moving) ctx.job(() => moveTo(S.sel)); else { const first = $("pl-list").querySelector("button"); if (first) first.focus(); } }
    else if (e.key === "Delete" || e.key === "Backspace") ctx.job(clear);
    else if (e.key.toLowerCase() === "m") startMove();
    else if (e.key.toLowerCase() === "u") ctx.job(usedBy);
    else if (e.key.toLowerCase() === "r") ctx.job(load);
    else if (e.key === "/") $("pl-q").focus();
    else if (e.key === "Escape" && S.moving) { S.moving = 0; render(); say("Nothing was moved."); }
    else return;
    e.preventDefault();
  });
  // what plays now: the places the tracks play, lit while each sounds (drawn over the grid, nothing drawn again)
  const TRK = ["#c46c71", "#706deb", "#ffffff", "#a9ff9f", "#75cec8", "#8e3c97"];
  let liveOff = null, liveAt = 0, lit = new Map();
  function tick(L) {
    const g = $("pl-grid"), want = new Map();
    if (L && S.places && (!S.project || L[30] === S.project)) for (let t = 0; t < 6; t++) if (L[32 + t] && ((L[16] >> t) & 1)) want.set(L[32 + t], t);
    for (const [k] of lit) if (!want.has(k)) { const b = g.children[k - 1]; if (b) { b.classList.remove("snd"); delete b.dataset.t; } }
    for (const [k, t] of want) { const b = g.children[k - 1]; if (b) { b.classList.add("snd"); b.dataset.t = String(t + 1); b.style.setProperty("--tc", TRK[t]); } }
    lit = want;
  }
  function live(on) {
    if (liveOff) { liveOff(); liveOff = null; }
    const u = on && ctx.unit ? ctx.unit() : null;
    if (u) liveOff = u.onFrame((m) => {
      if (!ctx.unit()) { live(false); tick(null); return; }        // (the screens went to a unit on USB: let go)
      const t = performance.now(); if (m.live && t - liveAt > 60) { liveAt = t; tick(m.live); }
    });
  }
  return {
    load, render,
    async follow() { if (S.shown && !liveOff) live(true); await follow(); },
    show(on) { S.shown = on; live(on); lit = new Map(); if (on && ctx.link() && !S.places) ctx.job(load); render(); },
    gone() { S.places = null; S.sounds = null; S.moving = 0; render(); },
    stale() { S.places = null; },
  };
}
