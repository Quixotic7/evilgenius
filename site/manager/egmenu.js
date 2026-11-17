// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SETTINGS (ALT + S): the unit's three settings menus as one screen: RECORD (SHIFT + REC on the unit), SETTINGS
// (SHIFT + SEL) and the picked track's TRACK SETTINGS (SEL), each page as the unit draws it: a row a knob (its badge in
// the knob's colour, its name, its value big) and a moving picture of the value (the notes a LIVE take leaves off the
// grid and QUANTIZE pulls on, the take's capture mark, the page following the playhead, the clock's ticks, the track's
// scale on a keyboard, its voices sounding, its swing ..).
// The values are the unit's (the browser build's eg_web_menu, fz_port.c: view.c's fill_menu, what the unit's screen
// draws); a change is the unit's own knob turned (eg_web_knob: a slow detent each, so a detent is one step), with the
// menu opened on the unit first, so the unit shows what is changed here, and its own knobs move this screen.
//   Keys: R S T the menu (again: its next page); 1 .. 4 a row; LEFT / RIGHT or UP / DOWN turn it (SHIFT: far).
//   mountMenu({ $, unit(), names() }) -> { show(on), drive() }
import { notMine } from "./egkeys.js";
const C = { bg: "#000", dim: "#4a4a4a", line: "#2e2c9b", lb: "#706deb", ye: "#edf171", wh: "#fff", cy: "#75cec8", lg: "#a9ff9f", lr: "#c46c71", gr: "#7b7b7b", or: "#8e5029", pu: "#8e3c97" };
const KC = [C.lr, C.cy, C.lg, C.ye];                         // (the knobs' colours, ui.h UI_K)
export const MENUS = ["RECORD", "SETTINGS", "TRACK"];
const KIND = ["BASS", "KEYS", "PLUCK", "PAD", "LEAD", "DRUMS", "FX"];
const ON = ["OFF", "ON"];
// each menu's pages, each page's four rows: [name, the value's text, the choices (in the knob's order) or null, the
// value's index among them, the picture, not turned from here]
export const PAGES = [
  [ // RECORD
    [["MODE", (d) => (d.rec_step ? "STEP" : "LIVE"), ["LIVE", "STEP"], (d) => d.rec_step, "mode"],
      ["QUANTIZE", (d) => `${d.quant}%`, null, (d) => d.quant, "quant"],
      ["TAKE", (d) => ["CAPTURE", "OVERDUB", "REPLACE"][d.dub] || "REPLACE", ["OVERDUB", "REPLACE"], (d) => d.dub - 1, "take"],   // (the knob's two)
      ["EDIT KEYS", (d) => (d.ekeys ? "FULL" : "SCALE"), ["SCALE", "FULL"], (d) => d.ekeys, "ekeys"]],
    [["AUTOMATION", (d) => ON[d.rec_auto ? 1 : 0], ON, (d) => (d.rec_auto ? 1 : 0), "auto"], null, null, null],
  ],
  [ // SETTINGS
    [["PAGE FOLLOW", (d) => ON[d.follow ? 1 : 0], ON, (d) => (d.follow ? 1 : 0), "follow"],
      ["BOOST", (d) => (d.boost ? "+6 DB" : "OFF"), ["OFF", "+6 DB"], (d) => (d.boost ? 1 : 0), "boost"],
      ["CLOCK OUT", (d) => ON[d.clk_out ? 1 : 0], ON, (d) => (d.clk_out ? 1 : 0), "clock"],
      ["CC OUT", (d) => ON[d.cc_out ? 1 : 0], ON, (d) => (d.cc_out ? 1 : 0), "cc"]],
    [["HOME VIEW", (d) => ["STEPS", "EDIT", "GEEK OUT"][d.home_view] || "STEPS", ["STEPS", "EDIT", "GEEK OUT"], (d) => d.home_view, "home"],
      ["LOCK", (d) => ON[d.home_lock ? 1 : 0], ON, (d) => (d.home_lock ? 1 : 0), "lock"],
      ["VOICE", (d) => ["STOPPED", "ALWAYS", "OFF"][d.voice] || "OFF", ["STOPPED", "ALWAYS", "OFF"], (d) => d.voice, "voice"],
      ["VOICE LEVEL", (d) => `${d.voice_lvl}%`, null, (d) => d.voice_lvl, "level"]],
    [["BLUETOOTH", (d) => ON[d.ble_on ? 1 : 0], ON, (d) => (d.ble_on ? 1 : 0), "ble"],
      ["STATUS", (d) => ["OFF", "WAITING", "CONNECTED"][d.ble_on ? d.ble_st : 0] || "OFF", null, null, "blest"], null, null],
  ],
  [ // TRACK
    [["MODE", (d) => (d.follow_key ? "GLOBAL" : "LOCAL"), ["GLOBAL", "LOCAL"], (d) => (d.follow_key ? 0 : 1), "key"],   // (ctl_mix.c: left GLOBAL)
      ["SCALE", (d) => d.scale, null, null, "scale"],
      ["ROOT", (d) => d.root, ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], (d) => d.root_pc, "root"],
      ["MIDI CH", (d) => String(d.chan), null, (d) => d.chan, "chan"]],
    [["VOICES", (d) => String(d.limit), null, (d) => d.limit, "voices"],
      ["SWING", (d) => ON[d.swing ? 1 : 0], ON, (d) => (d.swing ? 1 : 0), "swing"],
      ["PAGE FOLLOW", (d) => ON[d.follow ? 1 : 0], ON, (d) => (d.follow ? 1 : 0), "follow"],
      ["MIDI FX", (d) => (d.mfx ? String(d.mfx) : "OFF"), ["OFF", "1", "2", "3", "4", "5"], (d) => d.mfx, "mfx"]],
    [["KIND", (d) => (d.tkind >= 0 ? KIND[d.tkind] : "NONE"), null, null, "kind"],
      ["NAME", (d) => d.tname || "", null, null, "name", true],   // (its knob opens the unit's name keyboard: not turned from here)
      ["ENGINE", (d) => (d.engine === 2 ? "MIDI" : d.engine ? "SID+MIDI" : "SID TONE"), ["SID TONE", "SID+MIDI", "MIDI"], (d) => d.engine, "engine"],
      ["MIDI OUT", (d) => (d.mout ? String(d.mout) : "OFF"), null, (d) => d.mout, "mout"]],
  ],
];
// a menu's pages on this unit (SETTINGS' third, BLUETOOTH, the Bluetooth package's only)
export const npages = (m, d) => (m === 1 && d && !d.ble ? 2 : PAGES[m].length);
// the menu and page the unit has open (its answer), or null
export function unitAt(d) {
  if (!d || d.open < 0) return null;
  return { menu: d.open, page: d.open === 0 ? d.rec_page : d.open === 1 ? d.set_page : d.trk_page };
}
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

export function mountMenu(ctx) {
  const { $ } = ctx;
  const S = { shown: false, d: null, menu: 0, page: 0, row: 0, busy: false, was: "", cvs: [], turning: false, gen: 0 };
  const root = $("tab-set");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="mn-title">SETTINGS</span><span class="dim">R S T A MENU (AGAIN: ITS NEXT PAGE) · 1..4 A ROW · ARROWS TURN IT · CLICK A CHOICE</span></div>
    <div class="mfbar"><span class="seg" id="mn-menus" role="group" aria-label="The menus"></span><span class="seg" id="mn-pages" role="group" aria-label="The menu's pages"></span></div>
    <div class="mnrows" id="mn-rows"></div>
    <p class="dim" id="mn-note"></p>`;
  async function ask(op = 0, a = 0, b = 0) {
    const u = ctx.unit();
    if (!u || (S.busy && !op)) return null;
    S.busy = true;
    try {
      const r = await u.call("eg_web_menu", op, a, b);
      if (!r || r.rec_page === undefined) return null;
      S.d = r;
      const at = unitAt(r);
      if (at && !S.turning) { S.menu = at.menu; S.page = Math.min(at.page, npages(at.menu, r) - 1); }
      const t = JSON.stringify(r) + S.menu + S.page + S.row;
      if (t !== S.was) { S.was = t; render(); }
      return r;
    } finally { S.busy = false; }
  }
  // the unit opens the menu and page shown here (a click here moves the unit)
  async function open() {
    const at = unitAt(S.d);
    if (!at || at.menu !== S.menu || at.page !== S.page) await ask(1, S.menu, S.page);
  }
  function go(menu, page) {
    S.menu = menu; S.page = page % npages(menu, S.d); S.row = 0; S.was = "";
    render(); ask(1, S.menu, S.page);
  }
  // a row turned n detents on the unit's knob (KNOB 1..4: roles 3..6)
  async function turn(k, n) {
    const u = ctx.unit(), r = PAGES[S.menu][S.page][k];
    if (!u || !n || !r || r[5]) return;
    S.turning = true;
    try { await open(); await u.knob(3 + k, n); } finally { S.turning = false; }
    S.was = ""; await fresh();
  }
  // the state read after a change: a read already on its way is waited for, then read again (never the old one)
  async function fresh() {
    for (let i = 0; i < 60 && S.busy; i++) await new Promise((r) => setTimeout(r, 10));
    return ask();
  }
  // a row set to choice i: turned there, looked at, turned again if the knob's order is not the list's (three tries)
  async function choose(k, i) {
    const r = PAGES[S.menu][S.page][k];
    if (!r || !r[3]) return;
    for (let tries = 0; tries < 3 && S.d && r[3](S.d) !== i; tries++) await turn(k, i - r[3](S.d));
  }
  function render() {
    const d = S.d;
    $("mn-title").textContent = `SETTINGS · ${MENUS[S.menu]}${S.menu === 2 && d ? ` · TRACK ${d.sel + 1}${d.tname ? ` ${d.tname}` : ""}` : ""}`;
    const ms = $("mn-menus"); ms.textContent = "";
    MENUS.forEach((n, m) => {
      const b = el("button", "key plain", `${"RST"[m]} ${n}`); b.type = "button"; b.setAttribute("aria-pressed", String(m === S.menu));
      b.addEventListener("click", () => go(m, m === S.menu ? S.page + 1 : 0));
      ms.append(b);
    });
    const ps = $("mn-pages"); ps.textContent = "";
    for (let p = 0; p < npages(S.menu, d); p++) {
      const b = el("button", "key plain", `PAGE ${p + 1}`); b.type = "button"; b.setAttribute("aria-pressed", String(p === S.page));
      b.addEventListener("click", () => go(S.menu, p));
      ps.append(b);
    }
    const rows = $("mn-rows"); rows.textContent = ""; S.cvs = [];
    if (!d) return;
    const at = unitAt(d), here = at && at.menu === S.menu && at.page === S.page;
    PAGES[S.menu][S.page].forEach((r, k) => {
      const row = el("div", `mnrow${k === S.row ? " cur" : ""}${r ? "" : " none"}${here && d.last === k ? " last" : ""}`);
      row.dataset.k = String(k);
      const badge = el("span", "mnbadge", String(k + 1)); badge.style.borderColor = KC[k]; badge.style.color = KC[k];
      row.append(badge);
      if (!r) { row.append(el("span", "dim", "-")); rows.append(row); S.cvs.push(null); return; }
      const nm = el("span", "mnname", r[0]), val = el("span", "mnval", r[1](d)); val.style.color = KC[k];
      const pic = el("canvas", "mnpic"); pic.width = 120; pic.height = 28; pic.setAttribute("aria-hidden", "true");
      const ch = el("span", "mnch");
      if (r[2] && r[3]) {
        r[2].forEach((c, i) => {
          const b = el("button", "key plain", c); b.type = "button"; b.setAttribute("aria-pressed", String(r[3](d) === i));
          b.addEventListener("click", (e) => { e.stopPropagation(); S.row = k; choose(k, i); });
          ch.append(b);
        });
      } else if (r[5]) {
        ch.append(el("span", "dim", "ON THE UNIT"));
      } else {
        for (const [t, n] of [["-", -1], ["+", 1]]) {
          const b = el("button", "key plain", t); b.type = "button"; b.setAttribute("aria-label", `${r[0]} ${t === "+" ? "up" : "down"}`);
          b.addEventListener("click", (e) => { e.stopPropagation(); S.row = k; turn(k, n); });
          ch.append(b);
        }
      }
      row.append(nm, val, pic, ch);
      row.addEventListener("click", () => { S.row = k; S.was = ""; render(); });
      rows.append(row);
      S.cvs.push(pic);
    });
    $("mn-note").textContent = here ? "Open on the unit: its KNOB 1..4 turn these rows." : "A change here opens this page on the unit first.";
  }

  // ---- the pictures (each row's, small in the C64's colours and shown big)
  function pic(k, kind, d, t) {
    const cv = S.cvs[k];
    if (!cv) return;
    const g = cv.getContext("2d"), w = cv.width, h = cv.height, col = KC[k];
    g.fillStyle = C.bg; g.fillRect(0, 0, w, h);
    const beat = (t * (d.bpm || 120) / 60) % 4, play = (x, c = C.ye) => { g.fillStyle = c; g.fillRect(x, 1, 1, h - 2); };
    if (kind === "mode") {                                    // LIVE: notes off the grid; STEP: the cells, the cursor's lit
      for (let i = 0; i < 8; i++) { g.fillStyle = C.line; g.fillRect(4 + i * 14, h - 4, 1, 3); }
      if (d.rec_step) for (let i = 0; i < 8; i++) { g.fillStyle = i === Math.floor(t * 2) % 8 ? col : C.dim; g.fillRect(4 + i * 14, 8, 11, 12); }
      else for (let i = 0; i < 6; i++) { g.fillStyle = col; g.fillRect(6 + i * 18 + Math.sin(i * 3.1) * 4, 6 + (i * 5) % 14, 8, 3); }
    } else if (kind === "quant") {                            // four notes pulled onto their lines by QUANTIZE
      const q = d.quant / 100, pull = Math.min(1, (t % 2) / 0.8);   // (each two seconds: played late or early, then pulled)
      for (let i = 0; i < 4; i++) {
        const grid = 10 + i * 28, off = [7, -6, 9, -8][i], x = grid + off * (1 - q * pull);
        g.fillStyle = C.line; g.fillRect(grid, 2, 1, h - 4);
        g.fillStyle = col; g.fillRect(Math.round(x), 10 + (i % 2) * 6, 10, 4);
      }
    } else if (kind === "take") {                             // CAPTURE: a cut mark; OVERDUB: the new joins; REPLACE: the old crossed
      for (let i = 0; i < 7; i++) { g.fillStyle = C.dim; g.fillRect(4 + i * 16, 16, 10, 4); }
      const x = 4 + (Math.floor(t * 3) % 7) * 16;
      if (d.dub === 0) { g.fillStyle = C.lr; g.fillRect(x + 12, 2, 2, h - 4); }
      else { g.fillStyle = col; g.fillRect(x, 8, 10, 4); if (d.dub === 2) { g.fillStyle = C.lr; g.fillRect(x - 1, 17, 12, 1); } }
    } else if (kind === "ekeys" || kind === "scale" || kind === "root") {   // a keyboard: the scale's keys lit, the root brighter
      const mask = kind === "ekeys" ? (d.ekeys ? 4095 : d.scale_mask) : d.scale_mask, root = d.root_pc || 0;
      for (let i = 0; i < 12; i++) {
        const black = [1, 3, 6, 8, 10].includes(i), on = (mask >> i) & 1;
        g.fillStyle = i === root && on && kind !== "ekeys" ? C.wh : on ? col : black ? "#111" : C.dim;
        g.fillRect(2 + i * 9.6, black ? 3 : 10, 8, black ? 12 : 16);
      }
    } else if (kind === "auto" || kind === "follow" || kind === "swing") {
      if (kind === "auto") {                                  // a knob's curve written into the steps
        for (let x = 0; x < w - 8; x++) { g.fillStyle = d.rec_auto ? col : C.dim; g.fillRect(4 + x, Math.round(h / 2 + Math.sin(x / 9 + (d.rec_auto ? t * 3 : 0)) * 9), 1, 2); }
      } else if (kind === "follow") {                         // the pages, the playhead, the screen going with it
        const pg = Math.floor(beat), on = d.follow;
        for (let p = 0; p < 4; p++) { g.strokeStyle = on && p === pg ? col : C.dim; g.strokeRect(4.5 + p * 29, 6.5, 25, 15); }
        play(4 + beat * 29);
        if (!on) { g.strokeStyle = C.lr; g.strokeRect(4.5, 6.5, 25, 15); }
      } else {                                                // SWING: the off-beats late
        for (let i = 0; i < 8; i++) { const x = 6 + i * 14 + (d.swing && i % 2 ? 5 : 0); g.fillStyle = Math.floor(beat * 2) === i ? C.wh : col; g.fillRect(x, 10, 6, 8); }
      }
    } else if (kind === "clock" || kind === "cc") {           // ticks going out, or CC numbers
      const on = kind === "clock" ? d.clk_out : d.cc_out;
      for (let i = 0; i < 12; i++) {
        const x = ((t * 40 + i * 10) % (w - 10)) + 4;
        g.fillStyle = on ? (kind === "clock" && i % 6 === 0 ? C.wh : col) : C.dim;
        g.fillRect(on ? x : 4 + i * 10, kind === "clock" ? 10 : 6 + (i % 3) * 6, kind === "clock" ? 2 : 4, kind === "clock" ? 8 : 3);
      }
    } else if (kind === "boost" || kind === "level") {        // a level bar
      const v = kind === "boost" ? (d.boost ? 1 : 0.55) : d.voice_lvl / 100, wob = 0.08 * Math.abs(Math.sin(t * 6));
      g.fillStyle = "#101030"; g.fillRect(4, 10, w - 8, 8);
      g.fillStyle = col; g.fillRect(4, 10, Math.round((w - 8) * Math.max(0, v - wob)), 8);
    } else if (kind === "voices") {                           // the track's voices: its limit, the ones sounding lit
      for (let i = 0; i < Math.min(16, d.limit); i++) { g.fillStyle = i < d.voices_now ? C.wh : col; g.fillRect(4 + i * 7, 9, 5, 10); }
    } else if (kind === "mfx") {                              // the group the track goes through: a chain
      for (let i = 0; i < 5; i++) { g.fillStyle = d.mfx === i + 1 ? col : C.dim; g.fillRect(6 + i * 22, 9, 16, 10); }
      if (d.mfx) { g.fillStyle = C.wh; g.fillRect(6 + (d.mfx - 1) * 22 + ((t * 30) % 16), 12, 2, 4); }
    } else {                                                  // the rest: the value, a light
      g.fillStyle = col; g.fillRect(4, 12, 4 + ((t * 20) % 4), 4);
    }
  }
  const loop = (gen) => (now) => {
    if (!S.shown || gen !== S.gen) return;                 // (one loop: a show before the last frame ran starts another)
    const t = now / 1000;
    if (S.d) PAGES[S.menu][S.page].forEach((r, k) => { if (r) pic(k, r[4], S.d, t); });
    requestAnimationFrame(loop(gen));
  };
  // drag or scroll a row: its knob turned
  const rows = $("mn-rows");
  let drag = null;
  rows.addEventListener("pointerdown", (e) => {
    const r = e.target.closest(".mnrow[data-k]");
    if (!r || e.target.closest("button")) return;
    drag = { k: Number(r.dataset.k), y: e.clientY, n: 0 };
  });
  rows.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const n = Math.trunc((drag.y - e.clientY) / 12);
    if (n !== drag.n) { const d = n - drag.n; drag.n = n; turn(drag.k, d); }
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) rows.addEventListener(ev, () => { drag = null; });
  rows.addEventListener("wheel", (e) => {
    const r = e.target.closest(".mnrow[data-k]");
    if (!r) return;
    e.preventDefault();
    turn(Number(r.dataset.k), e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || e.metaKey || e.ctrlKey || e.altKey || notMine(e) || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase(), m = "rst".indexOf(k);
    if (m >= 0) go(m, m === S.menu ? S.page + 1 : 0);
    else if (/^[1-4]$/.test(e.key)) { S.row = Number(e.key) - 1; S.was = ""; render(); }
    else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) turn(S.row, (e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1));
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  setInterval(() => { if (S.shown && !drag) ask(); }, 250);
  return {
    show(on) {
      if (on === S.shown) return;
      S.shown = on;
      if (!on) return;
      if (!ctx.unit()) { S.d = null; render(); $("mn-note").textContent = "SETTINGS runs on the FM-1 in this browser. On a unit on USB: its own pages (THE FM-1, ALT + F)."; }
      S.was = ""; ask();
      requestAnimationFrame(loop(++S.gen));
    },
    drive() { ask().then(() => ask(1, S.menu, S.page)); },
  };
}
