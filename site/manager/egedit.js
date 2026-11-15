// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager's EDIT tab: an EvilGenius sound on one panel, every SID TONE value a tile (its name, its value as the
// unit shows it, a bar), in the unit's pages (OSC, ENV, FILTER, AMP, VOX, LFO, MOD, VOICE) and the track's MIX.
//   - a tile: drag up / down (SHIFT finer), the wheel, the arrow keys (PAGE UP / DOWN a step of an eighth, HOME / END),
//     a double click or DELETE its default; a value with a list of names: a click opens the list;
//   - modulation: the strip's chips (LFO 1..3, the MOD slots' sources) dragged onto a tile, or tapped and then a tile
//     tapped, route the source there (an LFO's DEST; a MOD source the first free slot at +40); a destination with no
//     value of its own (PITCH, PAN ..) is a pad in the strip while a chip is armed; a tile a route moves carries the
//     route's chip, a click on it its card (its DEPTH, REMOVE);
//   - where the sound comes from: a track of the FM-1 (READ TRACK: its DUMP; followed while the unit changes it), MY
//     PRESETS or the factory's (from LIBRARY), a .egsnd file, INIT;
//   - LIVE (only with an FM-1): the track's sound changed as the panel changes, as a knob on the unit (PARAM, eglive.js);
//     a sound that is not the track's goes onto the track whole (AUDITION: nothing stored), PUT TRACK BACK undoes that;
//   - SAVE AS NEW (MY PRESETS' first free place), REPLACE (the MY preset it came from), REVERT, EXPORT (.egsnd);
//   - the computer's keys play the track on the FM-1 (A W S E D F T G Y H U J K O L P ;, Z / X the octave).
// Written for EvilGenius (MPL-2.0); FIZZ's editor (GPL-3.0) lent ideas only.
//   mountEdit({ $, log, say, refuse, link(), busy(), job(fn), download, onSaved() }) -> { open(sound, origin), poll(), shown(v), render(), state }
//   origin: { kind: "track", track: 0..5 | "selected" } | { kind: "mine", slot } | { kind: "factory", slot } | { kind: "file", name } | { kind: "new" }
import { SECTIONS, MIX, ID, NLFO, MOD_SOURCES, info, text, clampV, defaults, blobOf, valueOf, setValue, routes, soundFromDump,
  soundFromPreset, storeFrameOf, blobNow, lfo, mod, destName, DESTS } from "./egsound.js";
import { parseDump, trackFrame, TAGS } from "./egsysex.js";
import { Live, destOf, plan, unroute, PADS } from "./eglive.js";
import { help } from "./eghelp.js";
import { soundFile, soundName, readSounds, cleanName } from "./egfiles.js";

const LFO_COL = ["cyan", "yellow", "lightred"];          // (the unit's LFO 3 is violet: the page's purple is too dark on black)
const KEYS = "awsedftgyhujkolp;";                       // C C# D .. E of the next octave: the computer's two rows
const now = () => performance.now();
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const px = (s, font = "small", scale = 2, color = "white") => {
  const t = document.createElement("px-text");
  t.setAttribute("font", font); t.setAttribute("scale", String(scale)); t.setAttribute("color", color);
  t.textContent = s;
  return t;
};
const copy = (s) => s && { ...s, values: s.values ? s.values.slice() : null, blob: Uint8Array.from(s.blob) };
const srcName = (src) => (src.kind === "lfo" ? `LFO ${src.k + 1}` : MOD_SOURCES[src.src]);

export function mountEdit(ctx) {
  const { $, log, say, refuse } = ctx;
  const S = { snd: null, base: null, baseFrame: null, origin: null, live: null, liveOn: false, armed: null, lastEdit: 0,
    chan: 0, target: 0, kept: null, oct: 4, held: new Map(), shown: false, tiles: new Map(), auditioned: false };
  const root = $("tab-edit");

  // ---- the frame of the tab (built once)
  root.innerHTML = `
    <div class="edtop">
      <div class="edwho"><span id="ed-origin" class="dim">No sound yet: read a track, pick one in LIBRARY, open a file, or start from INIT.</span></div>
      <div class="keys edsrc">
        <label class="edtrk">TRACK <select id="ed-track" aria-label="The FM-1's track">
          <option value="selected">SELECTED</option>${[1, 2, 3, 4, 5, 6].map((t) => `<option value="${t - 1}">${t}</option>`).join("")}</select></label>
        <button id="ed-read" class="key plain" type="button"></button>
        <button id="ed-open" class="key plain" type="button"></button>
        <button id="ed-init" class="key plain" type="button"></button>
        <input id="ed-file" class="hide" type="file" accept=".egsnd,.egsnds,.json" aria-label="A sound file to edit" tabindex="-1">
        <button id="ed-live" class="key plain edlive" type="button" aria-pressed="false"></button>
      </div>
    </div>
    <div id="ed-body" hidden>
      <div class="edname">
        <label>NAME <input id="ed-name" type="text" maxlength="12" spellcheck="false" autocomplete="off"></label>
        <span class="edtags" id="ed-tags" role="group" aria-label="Tags"></span>
      </div>
      <div class="keys edacts">
        <button id="ed-save" class="key go" type="button"></button>
        <button id="ed-replace" class="key" type="button"></button>
        <button id="ed-send" class="key plain" type="button"></button>
        <button id="ed-back" class="key plain" type="button"></button>
        <button id="ed-revert" class="key plain" type="button"></button>
        <button id="ed-export" class="key plain" type="button"></button>
      </div>
      <div class="edroute" id="ed-route" role="toolbar" aria-label="Modulation sources: drag one onto a value"></div>
      <nav class="edjump" id="ed-jump" aria-label="Pages"></nav>
      <div class="edpanel" id="ed-panel"></div>
      <p class="edhelp" id="ed-help" aria-live="polite"></p>
      <p class="dim edkeys">The computer's keys play the track on the FM-1: <kbd>A</kbd> <kbd>W</kbd> <kbd>S</kbd> .. <kbd>;</kbd>, <kbd>Z</kbd> / <kbd>X</kbd> the octave (<span id="ed-oct">C4</span>).</p>
    </div>
    <div class="edpick" id="ed-pick" role="dialog" aria-label="Choose" hidden></div>`;
  for (const [id, label] of [["ed-read", "READ TRACK"], ["ed-open", "OPEN FILE"], ["ed-init", "INIT"], ["ed-save", "SAVE AS NEW"],
    ["ed-replace", "REPLACE"], ["ed-send", "SEND TO TRACK"], ["ed-back", "PUT TRACK BACK"], ["ed-revert", "REVERT"], ["ed-export", "EXPORT"]])
    $(id).append(px(label, "big", 2));
  $("ed-live").append(px("LIVE OFF", "big", 2));
  TAGS.forEach((t, k) => {
    const b = el("button", "key plain tag");
    b.type = "button"; b.dataset.k = k; b.setAttribute("aria-pressed", "false"); b.append(px(t));
    b.addEventListener("click", () => { if (!S.snd) return; S.snd.tags ^= 1 << k; renderHead(); });
    $("ed-tags").append(b);
  });

  // ---- the panel: its pages and tiles
  function tile(id) {
    const i = info(id);
    const t = el("div", "tile");
    t.tabIndex = 0;
    t.setAttribute("role", "slider");
    t.dataset.id = id;
    t.setAttribute("aria-valuemin", i.min); t.setAttribute("aria-valuemax", i.max);
    t.append(px(i.name, "small", 2, "lightblue"), el("span", "tv"), el("i", "tb"), el("span", "rt"));
    t.querySelector(".tv").append(px("", "big", 2, "white"));
    if (!i.lockable && id < MIX[0].id) t.title = "Not lockable on a step";
    wire(t, id);
    S.tiles.set(id, t);
    return t;
  }
  function build() {
    const panel = $("ed-panel"), jump = $("ed-jump");
    panel.textContent = ""; jump.textContent = ""; S.tiles.clear();
    const secs = [...SECTIONS, { key: "mix", title: "MIX", rows: [MIX.map((m) => m.id)], labels: ["THE TRACK'S MIX (kept with the preset)"] }];
    for (const sec of secs) {
      const box = el("section", "box edsec");
      box.id = `ed-sec-${sec.key}`;
      const h = el("h3"); h.append(px(sec.title, "big", 2, "yellow")); box.append(h);
      sec.rows.forEach((row, r) => {
        if (sec.labels[r]) { const l = el("div", "rowl"); l.append(px(sec.labels[r], "small", 2, "grey")); box.append(l); }
        const g = el("div", "tiles");
        for (const id of row) g.append(tile(id));
        box.append(g);
      });
      panel.append(box);
      const a = el("a"); a.href = `#ed-sec-${sec.key}`; a.append(px(sec.title, "small", 2, "white"));
      jump.append(a);
    }
    buildRoute();
  }
  function buildRoute() {
    const r = $("ed-route");
    r.textContent = "";
    r.append(px("MODULATE:", "small", 2, "grey"));
    const chip = (src, label, col) => {
      const b = el("button", "chip");
      b.type = "button"; b.draggable = true; b.dataset.src = JSON.stringify(src);
      b.style.setProperty("--c", `var(--${col})`);
      b.setAttribute("aria-pressed", "false");
      b.title = `${label}: drag onto a value, or tap then tap a value`;
      b.append(px(label, "small", 2, col));
      b.addEventListener("click", () => arm(S.armed && JSON.stringify(S.armed) === b.dataset.src ? null : src));
      b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/eg-src", b.dataset.src); e.dataTransfer.effectAllowed = "link"; arm(src); });
      b.addEventListener("dragend", () => setTimeout(() => arm(null), 0));
      r.append(b);
    };
    for (let k = 0; k < NLFO; k++) chip({ kind: "lfo", k }, `LFO ${k + 1}`, LFO_COL[k]);
    MOD_SOURCES.forEach((name, s) => { if (s) chip({ kind: "mod", src: s }, name, "lightgreen"); });
    const pads = el("span", "pads hide");
    pads.id = "ed-pads";
    for (const d of PADS) {
      const b = el("button", "chip pad");
      b.type = "button"; b.dataset.dest = d; b.append(px(DESTS[d], "small", 2, "white"));
      b.addEventListener("click", () => { if (S.armed) route(S.armed, d); });
      b.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/eg-src")) e.preventDefault(); });
      b.addEventListener("drop", (e) => { e.preventDefault(); route(JSON.parse(e.dataTransfer.getData("text/eg-src")), d); });
      pads.append(b);
    }
    r.append(pads);
  }
  function arm(src) {
    S.armed = src;
    for (const b of $("ed-route").querySelectorAll(".chip[data-src]")) b.setAttribute("aria-pressed", String(!!src && b.dataset.src === JSON.stringify(src)));
    if ($("ed-pads")) $("ed-pads").classList.toggle("hide", !src);
    for (const [id, t] of S.tiles) t.classList.toggle("can", !!src && destOf(id) > 0);
    if (src) $("ed-help").textContent = `${srcName(src)}: tap a lit value (or a pad) to route it there. Escape lets go.`;
  }
  function route(src, dest) {
    arm(null);
    if (!S.snd || S.snd.midi) return;
    const p = plan(S.snd.values, src, dest);
    if (p.full) { refuse("all eight MOD slots are in use. Set one's SOURCE to OFF first"); return; }
    if (p.existing) { card(p.existing); return; }
    if (p.none) return;
    for (const [id, v] of p.changes) change(id, v, { quiet: true });
    renderTiles();
    say(`${srcName(src)} now moves ${destName(dest)}.`, "ok");
    const r = p.route, depth = r.kind === "lfo" ? lfo(r.k, "DEPTH") : mod(r.k, 2);
    S.tiles.get(depth)?.focus();
  }
  // a route's card: where it goes, its depth (the tile's own), REMOVE
  function card(r) {
    const depthId = r.kind === "lfo" ? lfo(r.k, "DEPTH") : mod(r.k, 2);
    const who = r.kind === "lfo" ? `LFO ${r.k + 1}` : `MOD ${r.k + 1} (${MOD_SOURCES[S.snd.values[mod(r.k, 0)]]})`;
    const at = [...S.tiles.keys()].find((id) => destOf(id) === r.dest);
    pick(S.tiles.get(at ?? depthId), `${who} → ${destName(r.dest)}, DEPTH ${text(depthId, S.snd.values[depthId])}`, [
      { label: "GO TO DEPTH", go: () => { S.tiles.get(depthId).scrollIntoView({ block: "center" }); S.tiles.get(depthId).focus(); } },
      { label: "REMOVE", go: () => { for (const [id, v] of unroute(r)) change(id, v, { quiet: true }); renderTiles(); say(`${who} no longer moves ${destName(r.dest)}.`, "ok"); } },
    ]);
  }

  // ---- a tile's hands
  function wire(t, id) {
    let drag = null;
    const i = info(id), range = i.max - i.min;
    const ppu = (shift) => Math.max(0.12, Math.min(10, 250 / range)) * (shift ? 4 : 1);
    t.addEventListener("pointerdown", (e) => {
      if (!S.snd || e.button !== 0 || e.target.closest(".rt")) return;
      if (S.armed) { e.preventDefault(); if (destOf(id) > 0) route(S.armed, destOf(id)); else refuse(`${i.name} cannot be modulated`); return; }
      drag = { y: e.clientY, v: valueOf(S.snd, id), moved: false };
      t.setPointerCapture(e.pointerId);
      t.focus();
    });
    t.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dy = drag.y - e.clientY;
      if (Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved) change(id, drag.v + Math.round(dy / ppu(e.shiftKey)));
    });
    const end = () => {
      if (!drag) return;
      const was = drag; drag = null;
      if (!was.moved && i.texts && i.texts.length <= 64) list(t, id);
    };
    t.addEventListener("pointerup", end);
    t.addEventListener("pointercancel", () => { drag = null; });
    t.addEventListener("dblclick", () => { if (S.snd) change(id, i.def); });
    t.addEventListener("wheel", (e) => {
      if (!S.snd) return;
      e.preventDefault();
      const step = range > 255 ? Math.max(1, Math.round(range / 128)) : 1;
      change(id, valueOf(S.snd, id) + (e.deltaY < 0 ? 1 : -1) * step * (e.shiftKey && range > 255 ? 1 / step : 1));
    }, { passive: false });
    t.addEventListener("keydown", (e) => {
      if (!S.snd) return;
      const v = valueOf(S.snd, id), big = Math.max(1, Math.round(range / 8)), fine = range > 255 && !e.shiftKey ? Math.max(1, Math.round(range / 128)) : 1;
      const k = { ArrowUp: v + fine, ArrowRight: v + fine, ArrowDown: v - fine, ArrowLeft: v - fine, PageUp: v + big, PageDown: v - big,
        Home: i.min, End: i.max, Delete: i.def, Backspace: i.def }[e.key];
      if (k !== undefined) { e.preventDefault(); e.stopPropagation(); change(id, k); return; }
      if (e.key === "Enter" && i.texts) { e.preventDefault(); list(t, id); }
    });
    t.addEventListener("focus", () => { $("ed-help").textContent = help(id) || i.name; });
    t.addEventListener("mouseenter", () => { if (!S.armed) $("ed-help").textContent = help(id) || i.name; });
    t.addEventListener("dragover", (e) => { if (destOf(id) > 0 && e.dataTransfer.types.includes("text/eg-src")) { e.preventDefault(); t.classList.add("over"); } });
    t.addEventListener("dragleave", () => t.classList.remove("over"));
    t.addEventListener("drop", (e) => { e.preventDefault(); t.classList.remove("over"); route(JSON.parse(e.dataTransfer.getData("text/eg-src")), destOf(id)); });
    t.querySelector(".rt").addEventListener("click", (e) => {
      const c = e.target.closest("[data-route]");
      if (c) card(JSON.parse(c.dataset.route));
    });
  }
  // the list of a value's names, under its tile
  function list(t, id) {
    const i = info(id);
    pick(t, i.name, i.texts.map((name, k) => ({ label: name, on: valueOf(S.snd, id) === i.min + k, go: () => change(id, i.min + k) })));
  }
  function pick(anchor, title, items) {
    const p = $("ed-pick");
    p.textContent = "";
    p.append(px(title, "small", 2, "yellow"));
    const ul = el("div", "pl");
    for (const it of items) {
      const b = el("button", `key plain${it.on ? " on" : ""}`);
      b.type = "button"; b.append(px(it.label));
      b.setAttribute("aria-label", it.label);
      b.addEventListener("click", () => { closePick(); it.go(); anchor && anchor.focus(); });
      ul.append(b);
    }
    p.append(ul);
    p.hidden = false;
    const r = anchor ? anchor.getBoundingClientRect() : { left: 20, bottom: 100 };
    p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left + window.scrollX)) + "px";
    p.style.top = r.bottom + window.scrollY + 6 + "px";
    (p.querySelector(".on") || p.querySelector("button")).focus();
  }
  const closePick = () => { $("ed-pick").hidden = true; };
  document.addEventListener("pointerdown", (e) => { if (!$("ed-pick").hidden && !e.target.closest("#ed-pick")) closePick(); });

  // ---- a change: the model, the tile, the unit
  function change(id, v, { quiet = false } = {}) {
    if (!S.snd || S.snd.midi) return;
    const was = valueOf(S.snd, id);
    v = setValue(S.snd, id, clampV(id, v));
    if (v === was) return;
    S.lastEdit = now();
    if (!quiet) renderTile(id);
    if (id >= ID.LFO0 && id < ID.VMODE) renderRoutes();
    renderHead();
    sendLive(id, v);
  }
  function sendLive(id, v) {
    if (!S.liveOn || !ctx.link()) return;
    if (S.origin.kind === "track") liveOf().set(id, v);
    else if (S.auditioned) liveOf().sound(storeFrameOf(S.snd, { track: S.target, audition: true }));
  }
  function liveOf() {
    const track = S.origin.kind === "track" ? S.origin.track : S.target;
    if (!S.live || S.live.link !== ctx.link() || S.live.track !== track)
      S.live = new Live({ link: ctx.link(), track, log, onError: (a) => refuse(`the FM-1 did not take ${a.id !== undefined ? info(a.id).name : "the sound"} (${a.statusName})`) });
    return S.live;
  }

  // ---- drawing
  function renderTile(id) {
    const t = S.tiles.get(id), i = info(id);
    if (!t || !S.snd) return;
    const v = valueOf(S.snd, id), txt = text(id, v);
    t.querySelector(".tv px-text").text = txt;
    t.querySelector(".tb").style.width = `${Math.round(((v - i.min) / Math.max(1, i.max - i.min)) * 100)}%`;
    t.setAttribute("aria-valuenow", v); t.setAttribute("aria-valuetext", txt); t.setAttribute("aria-label", `${i.name} ${txt}`);
    t.classList.toggle("moved", v !== i.def);
  }
  function renderRoutes() {
    const rs = S.snd ? routes(S.snd.values) : [];
    for (const [id, t] of S.tiles) {
      const box = t.querySelector(".rt");
      box.textContent = "";
      const d = destOf(id);
      if (d <= 0) continue;
      for (const r of rs.filter((x) => x.dest === d)) {
        const c = el("button", "rchip");
        c.type = "button";
        c.dataset.route = JSON.stringify(r);
        const label = r.kind === "lfo" ? `L${r.k + 1}` : MOD_SOURCES[r.src];
        c.title = `${r.kind === "lfo" ? `LFO ${r.k + 1}` : `MOD ${r.k + 1} ${MOD_SOURCES[r.src]}`} moves ${info(id).name}`;
        c.append(px(label, "small", 1, r.kind === "lfo" ? LFO_COL[r.k] : "lightgreen"));
        box.append(c);
      }
    }
  }
  function renderTiles() { for (const id of S.tiles.keys()) renderTile(id); renderRoutes(); }
  const describe = (o) => !o ? "" : o.kind === "track" ? `TRACK ${o.track === "selected" ? `${S.target + 1} (SELECTED)` : o.track + 1} OF THE FM-1`
    : o.kind === "mine" ? `MY PRESETS ${o.slot}` : o.kind === "factory" ? `FACTORY ${o.slot}` : o.kind === "file" ? `FILE ${o.name}` : "NEW (INIT)";
  const mineSlot = () => (S.origin && S.origin.kind === "mine" ? S.origin.slot : S.saved || 0);
  const dirty = () => !!S.snd && !!S.base && (S.snd.name !== S.base.name || S.snd.tags !== S.base.tags ||
    MIX.some((m) => S.snd[m.key] !== S.base[m.key]) || blobNow(S.snd).some((x, i) => x !== blobNow(S.base)[i]));
  function renderHead() {
    const on = !!ctx.link() && !ctx.busy(), has = !!S.snd;
    $("ed-body").hidden = !has;
    $("ed-origin").textContent = has ? `${S.snd.name || "(NO NAME)"}: ${describe(S.origin)}${dirty() ? ", CHANGED" : ""}${S.snd.midi ? ". A MIDI track's sound: its CC slots are kept, not edited here" : ""}`
      : "No sound yet: read a track, pick one in LIBRARY, open a file, or start from INIT.";
    $("ed-read").disabled = !on;
    $("ed-track").disabled = !ctx.link();
    $("ed-live").disabled = !ctx.link();
    $("ed-live").setAttribute("aria-pressed", String(S.liveOn));
    $("ed-live").classList.toggle("go", S.liveOn);
    $("ed-live").querySelector("px-text").text = S.liveOn ? "LIVE ON" : "LIVE OFF";
    $("ed-live").title = S.liveOn ? "Every change goes to the FM-1's track now" : "The FM-1 is not changed until you send or save";
    if (!has) return;
    if (document.activeElement !== $("ed-name")) $("ed-name").value = S.snd.name;
    for (const b of $("ed-tags").children) b.setAttribute("aria-pressed", String(!!(S.snd.tags & (1 << b.dataset.k))));
    $("ed-save").disabled = !on;
    $("ed-replace").disabled = !on || !mineSlot();
    $("ed-replace").querySelector("px-text").text = mineSlot() ? `REPLACE ${mineSlot()}` : "REPLACE";
    $("ed-send").disabled = !on || S.origin.kind === "track";
    $("ed-back").disabled = !on || !S.kept;
    $("ed-revert").disabled = !dirty();
  }
  function render() { renderHead(); if (S.snd) renderTiles(); }

  // ---- where a sound comes from
  function open(snd, origin, { frame = null, chan } = {}) {
    if (!snd || !snd.values) { refuse("that is not a SID TONE sound"); return; }
    if (!S.tiles.size) build();
    closePick(); arm(null);
    S.snd = copy(snd); S.base = copy(snd); S.baseFrame = frame; S.origin = origin; S.lastEdit = 0; S.auditioned = false; S.saved = 0;
    if (chan !== undefined) S.chan = chan;
    render();
  }
  async function readTrack(quietly = false) {
    const l = ctx.link();
    if (!l) return;
    const sel = $("ed-track").value, slot = sel === "selected" ? 0 : Number(sel) + 1;
    const f = await l.dumpTrack(slot);
    if (!f) { if (!quietly) refuse("the FM-1 did not send the track's sound"); return; }
    const d = parseDump(f), snd = soundFromDump(d);
    if (!snd) { if (!quietly) refuse("the track's sound is not SID TONE's"); return; }
    S.target = d.track;
    const ch = d.extras ? d.extras.chan : d.track;
    if (quietly && S.snd && S.origin.kind === "track") {        // (the read-back: only what changed is drawn again)
      const same = blobNow(snd).every((x, i) => x === blobNow(S.snd)[i]) && MIX.every((m) => snd[m.key] === S.snd[m.key]) && snd.name === S.snd.name;
      if (same) return;
      if (S.snd.name !== snd.name) S.saved = 0;                    // (another sound on the track now)
      S.snd = copy(snd); S.base = copy(snd); S.baseFrame = f; S.chan = ch;
      render();
      return;
    }
    open(snd, { kind: "track", track: sel === "selected" ? "selected" : Number(sel) }, { frame: f, chan: ch });
    if (!quietly) say(`Read track ${d.track + 1}: ${snd.name || "(no name)"}.`, "ok");
  }
  // the read-back (the manager calls it while EDIT is shown): the track followed as the unit changes it, unless the
  // panel holds changes not sent (LIVE off) or a drag is going on
  async function poll() {
    if (!S.shown || !ctx.link() || ctx.busy() || !S.snd || S.origin.kind !== "track") return;
    if (now() - S.lastEdit < 800 || (S.live && S.live.quietFor() < 700)) return;
    if (!S.liveOn && dirty()) return;
    await readTrack(true);
  }

  // ---- the keys
  $("ed-read").addEventListener("click", () => ctx.job(() => readTrack()));
  $("ed-track").addEventListener("change", () => { if (ctx.link()) ctx.job(() => readTrack()); });
  $("ed-init").addEventListener("click", () => {
    open({ name: "INIT", tags: 0, pan: 0, chorus: 0, delay: 0, reverb: 0, drive: 0, blob: blobOf(defaults()), values: defaults(), midi: false }, { kind: "new" });
    say("A new sound from INIT.");
  });
  $("ed-open").addEventListener("click", () => $("ed-file").click());
  $("ed-file").addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; ev.target.value = "";
    if (!f) return;
    try {
      const sounds = readSounds(new Uint8Array(await f.arrayBuffer()), f.name);
      open(soundFromPreset(sounds[0]), { kind: "file", name: f.name });
      say(`Opened ${sounds[0].name} from ${f.name}${sounds.length > 1 ? ` (the first of ${sounds.length})` : ""}.`);
    } catch (e) { refuse(e.message); }
  });
  $("ed-live").addEventListener("click", () => {
    if (!ctx.link()) return;
    S.liveOn = !S.liveOn;
    renderHead();
    say(S.liveOn ? (S.origin && S.origin.kind !== "track" ? "LIVE: SEND TO TRACK puts this sound on the track; changes follow it there." : "LIVE: every change goes to the FM-1's track now.")
      : "LIVE off: the FM-1 is not changed.");
  });
  $("ed-name").addEventListener("input", () => { if (S.snd) { S.snd.name = cleanName($("ed-name").value); renderHead(); } });
  $("ed-name").addEventListener("change", async () => {
    if (!S.snd) return;
    S.snd.name = cleanName($("ed-name").value);
    $("ed-name").value = S.snd.name;
    if (S.liveOn && ctx.link() && S.origin.kind === "track") liveOf().sound(storeFrameOf(S.snd, { track: S.target, audition: true, extras: extrasOf() }));
    renderHead();
  });
  const extrasOf = () => { const d = S.baseFrame && parseDump(S.baseFrame); return d && d.extras ? { id: d.extras.id, sound: d.extras.sound, edited: true } : null; };
  $("ed-save").addEventListener("click", () => ctx.job(async () => {
    const r = await ctx.link().store(storeFrameOf(S.snd, { slot: 0, own: true }));
    if (!r || r.kind !== "store" || r.status) { refuse(`the FM-1 did not keep it (${r ? r.statusName : "no answer"})`); return; }
    if (S.origin.kind === "track") S.saved = r.slot;              // (still the track's: LIVE goes on; REPLACE that place)
    else S.origin = { kind: "mine", slot: r.slot };
    S.base = copy(S.snd);
    say(`Saved ${S.snd.name} to MY PRESETS ${r.slot}.`, "ok");
    renderHead(); ctx.onSaved && ctx.onSaved();
  }));
  $("ed-replace").addEventListener("click", () => ctx.job(async () => {
    const slot = mineSlot();
    const r = await ctx.link().store(storeFrameOf(S.snd, { slot, own: true }));
    if (!r || r.kind !== "store" || r.status) { refuse(`the FM-1 did not replace MY PRESETS ${slot} (${r ? r.statusName : "no answer"}${r && r.statusName === "BUSY" ? ": stop it first" : ""})`); return; }
    S.base = copy(S.snd);
    say(`Replaced MY PRESETS ${slot} with ${S.snd.name}.`, "ok");
    renderHead(); ctx.onSaved && ctx.onSaved();
  }));
  // the sound onto the track, nothing stored (AUDITION); the track as it was kept for PUT TRACK BACK
  async function sendToTrack() {
    const l = ctx.link(), sel = $("ed-track").value;
    if (!S.kept) {
      const f = await l.dumpTrack(sel === "selected" ? 0 : Number(sel) + 1);
      if (!f) { refuse("the FM-1 did not send the track's sound, so nothing was sent to it"); return; }
      S.kept = f; S.target = parseDump(f).track; S.chan = parseDump(f).extras?.chan ?? S.target;
    }
    const r = await l.store(storeFrameOf(S.snd, { track: S.target, audition: true }));
    if (!r || r.status) { refuse(`the FM-1 did not take it (${r ? r.statusName : "no answer"})`); return; }
    S.auditioned = true;
    say(`${S.snd.name} is on track ${S.target + 1} (nothing stored). PUT TRACK BACK puts the track's own sound back.`, "ok");
    renderHead();
  }
  $("ed-send").addEventListener("click", () => ctx.job(sendToTrack));
  $("ed-back").addEventListener("click", () => ctx.job(async () => {
    const r = await ctx.link().store(trackFrame(S.kept));
    if (!r || r.status) { refuse(`the FM-1 did not take the track back (${r ? r.statusName : "no answer"})`); return; }
    say(`Track ${S.target + 1} has its own sound again.`, "ok");
    S.kept = null; S.auditioned = false;
    renderHead();
  }));
  $("ed-revert").addEventListener("click", () => ctx.job(async () => {
    const back = copy(S.base);
    if (S.liveOn && ctx.link() && S.origin.kind === "track" && S.baseFrame) {
      await liveOf().idle();
      const r = await ctx.link().store(trackFrame(S.baseFrame));
      if (!r || r.status) { refuse(`the FM-1 did not take the track back (${r ? r.statusName : "no answer"})`); return; }
    }
    S.snd = back;
    render();
    say("Back to the sound as it was read.", "ok");
  }));
  $("ed-export").addEventListener("click", () => {
    const p = { ...S.snd, blob: blobNow(S.snd), slot: S.origin.slot };
    ctx.download(soundName(p), soundFile(p, { firmware: ctx.link() ? ctx.link().id : "", date: new Date().toISOString() }), "application/json");
    say(`Saved ${soundName(p)} to your downloads.`, "ok");
  });

  // the computer's keys: notes on the track's channel (the FM-1 plays them on its track)
  const typing = (e) => e.target.closest && e.target.closest("input, select, textarea, #ed-pick");
  document.addEventListener("keydown", (e) => {
    if (!S.shown) return;
    if (e.key === "Escape") { closePick(); arm(null); return; }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === "z" || k === "x") { S.oct = Math.max(0, Math.min(8, S.oct + (k === "x" ? 1 : -1))); $("ed-oct").textContent = `C${S.oct}`; return; }
    const n = KEYS.indexOf(k);
    if (n < 0 || !ctx.link() || S.held.has(k)) return;
    const note = Math.min(127, (S.oct + 1) * 12 + n);
    S.held.set(k, note);
    ctx.link().note(S.chan, note, 100);
  });
  document.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase(), note = S.held.get(k);
    if (note === undefined) return;
    S.held.delete(k);
    if (ctx.link()) ctx.link().note(S.chan, note, 0);
  });
  const allOff = () => { for (const note of S.held.values()) if (ctx.link()) ctx.link().note(S.chan, note, 0); S.held.clear(); };
  window.addEventListener("blur", allOff);

  return {
    open, poll, render, state: S, readTrack,
    shown(v) { S.shown = v; if (!v) { allOff(); closePick(); arm(null); } },
    gone() { S.live = null; S.kept = null; S.auditioned = false; S.liveOn = false; if (S.origin && S.origin.kind === "track") S.origin = { kind: "file", name: "the FM-1's track (unplugged)" }; render(); },
  };
}
