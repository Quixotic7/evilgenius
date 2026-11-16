// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// MIX (F5): the six tracks' mix as the unit's SENDS page draws it: a column a track, a bar each for PAN (from its
// middle), DELAY, REVERB and CHORUS, read from each track's DUMP and changed live as a knob on the unit (PARAM with the
// mix's ids, egsysex.js MIX_ID; one at a time, the latest of each: eglive.js). A bar: drag it, or the keys (1..6 the
// track, LEFT / RIGHT the value, UP / DOWN turn it, SHIFT a big step). LEVEL and the five rooms' sends are the unit's
// own pages for now (LEVEL is not in a track's DUMP; the rooms' ids are past PARAM's 7-bit reach).
// That is MIX on a unit on USB. On the FM-1 in this browser MIX is THE DESK (egdesk.js): the unit's own MIX page drawn
// whole and moving, with LEVEL, DRY, the rooms, mute and solo too; this file then only gives it the tracks' names.
//   mountMix({ $, link(), job(fn), say, refuse }) -> { show(on), load(), gone(), render() }
import { parseDump, MIX_ID } from "./egsysex.js";
import { Live } from "./eglive.js";
import { mountDesk } from "./egdesk.js";

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const PARTS = [{ key: "pan", name: "PAN", id: MIX_ID.PAN, min: -64, max: 63, col: "#c46c71" }, { key: "delay", name: "DELAY", id: MIX_ID.DELAY, min: 0, max: 127, col: "#a9ff9f" },
  { key: "reverb", name: "REVERB", id: MIX_ID.REVERB, min: 0, max: 127, col: "#ffffff" }, { key: "chorus", name: "CHORUS", id: MIX_ID.CHORUS, min: 0, max: 127, col: "#75cec8" }];

export function mountMix(ctx) {
  const { $ } = ctx;
  const S = { tracks: null, sel: 0, part: 0, shown: false, lives: [], setAt: 0 };
  const root = $("tab-mix");
  root.innerHTML = `<div class="hhead"><span class="lab">THE SENDS · THE TRACKS' MIX, LIVE ON THE FM-1</span><span class="dim">1..6 TRACK · LEFT / RIGHT VALUE · UP / DOWN TURN</span></div>
    <div id="mx-desk" class="mxdesk"></div>
    <div id="mx-cols" class="mxcols" role="group" aria-label="The six tracks' mix"></div>
    <p class="dim" id="mx-oldnote">LEVEL and the five rooms' sends (CRUSH, ROBOT, WARP, GLITCH, TV) stay on the unit's own MIX pages for now. Every change here is a knob on the unit: SHIFT + F1 there does not undo it.</p>`;
  const head = root.querySelector(".hhead");
  const desk = mountDesk({ $, unit: () => (ctx.unit ? ctx.unit() : null), names: () => (S.tracks || []).map((t) => (t ? t.name : "")) }, $("mx-desk"));
  const onDesk = () => !!(ctx.unit && ctx.unit());
  async function read(l) {
    const tracks = [];
    for (let t = 1; t <= 6; t++) {
      const f = await l.dumpTrack(t), d = f && parseDump(f);
      tracks.push(d ? { name: d.name, pan: d.pan, delay: d.delay, reverb: d.reverb, chorus: d.chorus } : null);
    }
    return tracks;
  }
  // the FM-1 in this page, followed: what its own knobs changed, unless a value here was turned just now
  async function follow() {
    const l = ctx.link();
    if (!S.shown || !l || !S.tracks || performance.now() - S.setAt < 1500) return;
    if (onDesk() && performance.now() - (S.namesAt || 0) < 4000) return;   // (the desk reads the mix itself: only the names, now and then)
    S.namesAt = performance.now();
    const tracks = await read(l);
    if (performance.now() - S.setAt < 1500 || JSON.stringify(tracks) === JSON.stringify(S.tracks)) return;
    S.tracks = tracks;
    render();
  }
  async function load() {
    const l = ctx.link();
    if (!l) return;
    const tracks = await read(l);
    S.tracks = tracks;
    S.lives = tracks.map((_, t) => new Live({ link: l, track: t, onError: (a) => ctx.refuse(`the FM-1 did not take it (${a.statusName})`) }));
    render();
  }
  function set(t, p, v) {
    const part = PARTS[p], tr = S.tracks[t];
    v = Math.max(part.min, Math.min(part.max, Math.round(v)));
    if (!tr || tr[part.key] === v) return;
    tr[part.key] = v;
    S.setAt = performance.now();
    S.lives[t].set(part.id, v);
    render();
  }
  function render() {
    const dk = onDesk();
    desk.show(S.shown && dk);
    $("mx-cols").hidden = $("mx-oldnote").hidden = dk;
    head.firstChild.textContent = dk ? "THE DESK · THE SIX TRACKS' MIX" : "THE SENDS · THE TRACKS' MIX, LIVE ON THE FM-1";
    head.lastChild.textContent = dk ? "1..6 TRACK · LEFT / RIGHT VALUE · UP / DOWN TURN · M MUTE · S SOLO · 0 NEITHER · DRAG ANYTHING" : "1..6 TRACK · LEFT / RIGHT VALUE · UP / DOWN TURN";
    if (dk) return;
    const cols = $("mx-cols");
    cols.textContent = "";
    if (!S.tracks) { cols.append(el("p", "dim", ctx.link() ? "Reading the tracks' mix .." : "Connect an FM-1 to see its mix.")); return; }
    S.tracks.forEach((tr, t) => {
      const col = el("div", `mxcol${t === S.sel ? " on" : ""}`);
      const bars = el("div", "mxbars");
      PARTS.forEach((part, p) => {
        const v = tr ? tr[part.key] : 0, f = (v - part.min) / (part.max - part.min);
        const b = el("div", `mxbar${t === S.sel && p === S.part ? " cur" : ""}`);
        b.tabIndex = 0;
        b.setAttribute("role", "slider"); b.setAttribute("aria-label", `Track ${t + 1} ${part.name}`);
        b.setAttribute("aria-valuemin", part.min); b.setAttribute("aria-valuemax", part.max); b.setAttribute("aria-valuenow", v);
        const fill = el("i");
        fill.style.background = part.col;
        if (part.key === "pan") { fill.style.bottom = `${Math.min(f, 0.5) * 100}%`; fill.style.height = `${Math.abs(f - 0.5) * 100}%`; }
        else fill.style.height = `${f * 100}%`;
        b.append(fill);
        b.addEventListener("pointerdown", (e) => {
          S.sel = t; S.part = p;
          b.setPointerCapture(e.pointerId);
          const at = (ev) => { const r = b.getBoundingClientRect(); set(t, p, part.min + (1 - (ev.clientY - r.top) / r.height) * (part.max - part.min)); };
          at(e);
          b.onpointermove = (ev) => { if (ev.buttons) at(ev); };
        });
        bars.append(b);
      });
      col.append(bars, el("p", "mxnames", PARTS.map((x) => x.name[0]).join(" ")),
        el("p", "mxtrack", `${t + 1} ${tr ? tr.name : "-"}`), el("p", "dim", tr ? `PAN ${tr.pan} · D ${tr.delay} · R ${tr.reverb} · C ${tr.chorus}` : ""));
      cols.append(col);
    });
  }
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.tracks || onDesk() || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const step = e.shiftKey ? 16 : 1, tr = S.tracks[S.sel], part = PARTS[S.part];
    if (/^[1-6]$/.test(e.key)) S.sel = Number(e.key) - 1;
    else if (e.key === "ArrowLeft") S.part = (S.part + 3) % 4;
    else if (e.key === "ArrowRight") S.part = (S.part + 1) % 4;
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && tr) set(S.sel, S.part, tr[part.key] + (e.key === "ArrowUp" ? step : -step));
    else return;
    e.preventDefault();
    render();
  });
  return {
    load, render,
    follow,
    show(on) { S.shown = on; if (on && ctx.link() && !S.tracks) ctx.job(load); render(); },
    gone() { S.tracks = null; S.lives = []; render(); },
    get desk() { return onDesk(); },
  };
}
