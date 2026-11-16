// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// THE FM-1 (ALT + F): the screen for every page of the unit the manager has no screen of its own for (EFFECTS,
// PATTERNS, the settings, the keyboard ..): the unit's page itself, with what each knob, button and key does there written on it
// (the firmware's own LABELS, core/app/view_labels.c), so nothing on the unit is without its place here.
// It is the virtual FM-1's own front (docs/BROWSER-FM1-PLAN.md phase 4): its screen at twice its size, the
// eight knobs, the fourteen buttons, the 27 keys, with their lights, over any screen of the manager. Each control is
// the firmware's own input (egvirtual.js vu.buttons / vu.keys / vu.enc: the masks and turns the unit's scanner gives),
// so what is pressed here does what it does on the unit. Only the virtual FM-1 has one: a real FM-1 has its own panel.
//   The computer's keyboard while it is open (KEYMAP, by place, so any layout works):
//     Q W E R T Y U I / A S D F G H J K   the sixteen white keys;  1 .. 0 and -   the eleven black keys
//     Z X C V B N   FX SEL ENV LFO EDIT GLO;  M , . /   HOME SAVE ARP SEQ;  P or SPACE   PLAY;  O   REC;  [ ]   OCT
//     UP / DOWN   SELECT;  LEFT / RIGHT   PRESETS;  PAGE UP / DOWN   ALGORITHM;  TAB to a knob: UP / DOWN turn it
//     SHIFT + a key or a click: held down until pressed again;  ESC: back to the screen before
//   mountPanel({ $, say, tab(name), back(), go(where) }) -> { open(on), show(on), unit(vu), isOpen(), labels(l), title(t) }
//   paint(img, fb): a frame to pixels
// THE DOCK: the FM-1's screen above the whole manager, centred over its frame, while a unit plays the page's FM-1
// (REMOTE MODE): always there, always in the same place. Its size is the player's: drag its
// corner, or ALT + [ and ALT + ] (120: EVILGENIUS's own 120 x 120 pixels one to one; kept in this browser). A click
// opens THE FM-1. Under it, the manager's first row, THE STRIP: where the unit is, and what its seven knobs, eleven black keys and fourteen
// buttons do there now (LABELS), each one a control: scroll or drag a knob, press a key or a button.
//   mountDock({ $, open() }) -> { unit(vu), show(on), size(px), labels(l), title(t) }
export const BTN = { FX: 0, SEL: 1, ENV: 2, LFO: 3, EDIT: 4, GLO: 5, HOME: 6, SAVE: 7, ARP: 8, SEQ: 9, PLAY: 10, REC: 11, "OCT-": 12, "OCT+": 13 };
export const ENC = { SELECT: 0, ALGORITHM: 1, PRESETS: 2, KNOB1: 3, KNOB2: 4, KNOB3: 5, KNOB4: 6 };
export const WHITE_K = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
export const BLACK_K = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25];
const BLACK_AFTER = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14];   // (the white key each black key sits after)
const ROW1 = ["FX", "SEL", "ENV", "LFO", "EDIT", "GLO"], ROW2 = ["HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC"];
const MIN_MS = 50;                                          // (the firmware reads its buttons every 16 ms)

// the computer's keys, by their place (KeyboardEvent.code): { key } a key of the unit, { btn } a button, { enc, n } a turn
export const KEYMAP = {};
"QWERTYUI".split("").forEach((c, i) => { KEYMAP[`Key${c}`] = { key: WHITE_K[i], cap: c }; });
"ASDFGHJK".split("").forEach((c, i) => { KEYMAP[`Key${c}`] = { key: WHITE_K[8 + i], cap: c }; });
"1234567890".split("").forEach((c, i) => { KEYMAP[`Digit${c}`] = { key: BLACK_K[i], cap: c }; });
KEYMAP.Minus = { key: BLACK_K[10], cap: "-" };
"ZXCVBN".split("").forEach((c, i) => { KEYMAP[`Key${c}`] = { btn: BTN[ROW1[i]], cap: c }; });
[["KeyM", "HOME", "M"], ["Comma", "SAVE", ","], ["Period", "ARP", "."], ["Slash", "SEQ", "/"], ["KeyP", "PLAY", "P"], ["Space", "PLAY", ""],
  ["KeyO", "REC", "O"], ["BracketLeft", "OCT-", "["], ["BracketRight", "OCT+", "]"]].forEach(([code, b, cap]) => { KEYMAP[code] = { btn: BTN[b], cap }; });
Object.assign(KEYMAP, { ArrowUp: { enc: "SELECT", n: 1 }, ArrowDown: { enc: "SELECT", n: -1 }, ArrowRight: { enc: "PRESETS", n: 1 }, ArrowLeft: { enc: "PRESETS", n: -1 },
  PageUp: { enc: "ALGORITHM", n: 1 }, PageDown: { enc: "ALGORITHM", n: -1 } });
const capOf = (what, v) => { for (const m of Object.values(KEYMAP)) if (m[what] === v && m.cap) return m.cap; return ""; };

// a frame of the unit's screen (240 x 240, RGB565 as the LCD takes it: high byte first) into an ImageData
export function paint(img, fb) {
  const d = img.data;
  for (let i = 0; i < fb.length; i++) {
    const v = fb[i], p = ((v >> 8) | (v << 8)) & 0xFFFF, o = i * 4;
    d[o] = ((p >> 11) & 31) * 255 / 31; d[o + 1] = ((p >> 5) & 63) * 255 / 63; d[o + 2] = (p & 31) * 255 / 31; d[o + 3] = 255;
  }
  return img;
}

// what is held down: by a pointer or a key of the computer (id -> bit), or latched; the masks the firmware reads
export class Held {
  constructor(send) { this.send = send; this.by = new Map(); this.latched = 0; this.mask = 0; this.at = new Map(); }
  sync() {
    let m = this.latched;
    for (const b of this.by.values()) m |= 1 << b;
    m >>>= 0;
    if (m !== this.mask) { this.mask = m; this.send(m); }
    return m;
  }
  down(id, bit, now = 0) { this.by.set(id, bit); this.at.set(id, now); return this.sync(); }
  // let go: how long to wait first, so a quick tap does not fall between two reads (0: let go now, done)
  up(id, now = 0) {
    if (!this.by.has(id)) return -1;
    const wait = MIN_MS - (now - (this.at.get(id) || 0));
    if (wait > 0) return wait;
    this.by.delete(id); this.at.delete(id); this.sync();
    return 0;
  }
  latch(bit) { this.latched = (this.latched ^ (1 << bit)) >>> 0; return this.sync(); }
  // (a press of something latched lets it go)
  unlatch(bit) { if (!(this.latched & (1 << bit))) return false; this.latched = (this.latched & ~(1 << bit)) >>> 0; this.sync(); return true; }
  clear(only = () => true) { for (const id of [...this.by.keys()]) if (only(id)) { this.by.delete(id); this.at.delete(id); } this.sync(); }
}

export function mountDock(ctx) {
  const { $ } = ctx;
  const box = $("dock"), cv = $("dock-lcd"), g = cv.getContext("2d"), img = g.createImageData(240, 240);
  const strip = $("strip"), mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  let unsub = null, shown = false, px = 120, vu = null;
  // the strip's controls: [name, job] chips; a knob turns (role: EN_*), a key or a button is held while pressed
  const sb = new Held((m) => vu && vu.buttons(m, "strip")), sk = new Held((m) => vu && vu.keys(m, "strip"));
  const head = mk("div", "sthead"), ttl = mk("b", "", "THE FM-1"), rows = { k: mk("div", "strow k"), b: mk("div", "strow b"), n: mk("div", "strow n") };
  head.append(ttl);
  strip.append(head, rows.k, rows.b, rows.n);
  const chips = { k: [], b: [], n: [] };
  const chip = (row, name, title) => { const c = mk("button", "stc none"); c.type = "button"; c.tabIndex = -1; c.title = title; c.append(mk("i", "", name), mk("span", "", "")); rows[row].append(c); chips[row].push(c); return c; };
  ["SELECT", "ALGORITHM", "PRESETS", "KNOB 1", "KNOB 2", "KNOB 3", "KNOB 4"].forEach((name, role) => {
    const c = chip("k", name, `${name}: scroll or drag up and down to turn it`);
    let drag = null, wheel = 0;
    const turn = (n) => { if (n && vu) vu.enc(role, n); };
    c.addEventListener("pointerdown", (e) => { e.preventDefault(); c.setPointerCapture(e.pointerId); drag = { y: e.clientY, acc: 0 }; });
    c.addEventListener("pointermove", (e) => { if (!drag) return; drag.acc += drag.y - e.clientY; drag.y = e.clientY; const n = Math.trunc(drag.acc / 7); if (n) { drag.acc -= n * 7; turn(n); } });
    for (const t of ["pointerup", "pointercancel"]) c.addEventListener(t, () => { drag = null; });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(dy) >= 50) { turn(dy < 0 ? 1 : -1); wheel = 0; return; }
      wheel -= dy; const n = Math.trunc(wheel / 25); if (n) { wheel -= n * 25; turn(n); }
    }, { passive: false });
  });
  const press = (c, h, bit) => {
    c.addEventListener("pointerdown", (e) => { e.preventDefault(); c.setPointerCapture(e.pointerId); h.down(`p${e.pointerId}`, bit, performance.now()); c.classList.add("held"); });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) c.addEventListener(t, (e) => {
      const id = `p${e.pointerId}`, w = h.up(id, performance.now());
      if (w > 0) setTimeout(() => { h.by.delete(id); h.at.delete(id); h.sync(); }, w);
      c.classList.remove("held");
    });
  };
  BLACK_K.forEach((n, i) => press(chip("b", `B${i + 1}`, `Black key ${i + 1}`), sk, n));
  ["FX", "SEL", "ENV", "LFO", "EDIT", "GLO", "HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC", "OCT-", "OCT+"].forEach((name, i) => press(chip("n", name, `The ${name} button`), sb, i));
  const put = (c, job) => { c.lastChild.textContent = job || ""; c.classList.toggle("none", !job); };
  try { px = Number(localStorage.getItem("eg-dock")) || 120; } catch (_) { /* (no storage: 120) */ }
  const size = (v) => {
    px = Math.max(80, Math.min(480, Math.round(v / 20) * 20));
    box.style.setProperty("--dock", `${px}px`);
    try { localStorage.setItem("eg-dock", String(px)); } catch (_) { /* (none) */ }
    return px;
  };
  size(px);
  cv.addEventListener("click", () => ctx.open());
  let drag = null;
  const grip = $("dock-grip");
  grip.addEventListener("pointerdown", (e) => { e.preventDefault(); grip.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, px }; });
  grip.addEventListener("pointermove", (e) => { if (drag) size(drag.px + Math.max(e.clientX - drag.x, e.clientY - drag.y)); });
  for (const t of ["pointerup", "pointercancel"]) grip.addEventListener(t, () => { drag = null; });
  grip.addEventListener("dblclick", () => size(120));
  document.addEventListener("keydown", (e) => {
    if (!shown || !e.altKey || e.metaKey || e.ctrlKey || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    e.preventDefault(); size(px + (e.code === "BracketRight" ? 40 : -40));
  });
  let last = null;
  return {
    size,
    unit(v) {
      if (unsub) { unsub(); unsub = null; }
      last = null; vu = v;
      if (v) unsub = v.onFrame((m) => {
        if (m.fb) { last = m.fb; if (shown) g.putImageData(paint(img, m.fb), 0, 0); }
        if (!shown) return;
        chips.n.forEach((c, i) => c.classList.toggle("lit", !!(m.buttons & (1 << i))));
        chips.b.forEach((c, i) => c.classList.toggle("lit", !!(m.keys & (1 << BLACK_K[i]))));
      });
    },
    show(on) {
      shown = on; box.hidden = !on; strip.hidden = !on;
      box.parentElement.classList.toggle("docked", on); strip.parentElement.classList.toggle("docked", on);
      // (the status line and the top bar's keys ride in the strip's head while it is there, and go back after: the
      // band takes their rows, so the screens below keep their room)
      const con = $("console"), right = document.querySelector(".topbar .right, .sthead .right");
      if (on) head.append(con, right);
      else if (con.parentElement === head) { strip.parentElement.append(con); document.querySelector(".topbar").append(right); }
      if (!on) { sb.clear(); sk.clear(); }
      if (on && last) g.putImageData(paint(img, last), 0, 0);
    },
    // the unit's own words for what each control does now (egsysex.js parseLabels: list: 8 knobs, 14 buttons, 16 W, 11 B)
    labels(l) {
      if (!l) return;
      chips.k.forEach((c, i) => put(c, l.list[i]));
      chips.n.forEach((c, i) => put(c, l.list[8 + i]));
      chips.b.forEach((c, i) => put(c, l.list[8 + 14 + 16 + i]));
    },
    title(t) { ttl.textContent = t || "THE FM-1"; },
  };
}

export function mountPanel(ctx) {
  const { $ } = ctx;
  const root = $("panel"), el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  let vu = null, unsub = null, master = 2800;
  const btns = new Held((m) => vu && vu.buttons(m)), keys = new Held((m) => vu && vu.keys(m));
  const B = {}, K = [], KN = {};                              // the buttons, the keys, the knobs: { el, .. }

  root.innerHTML = `<div class="pnl">
    <div class="pnhead"><h2 id="panel-h">THE FM-1</h2>
      <span class="pngo" id="panel-go" role="group" aria-label="Pages of the unit"></span>
      <span class="dim">EACH CONTROL: ITS JOB NOW, ITS KEY · SHIFT HOLDS IT DOWN</span>
      <button id="panel-close" class="key plain" type="button" aria-label="Back to the screen before (ESC)">ESC</button></div>
    <div class="pnbody">
      <canvas id="panel-lcd" class="pnlcd" width="480" height="480" aria-label="The virtual FM-1's screen"></canvas>
      <div class="pnctl">
        <div class="pnknobs" id="panel-knobs" role="group" aria-label="Knobs"></div>
        <div class="pnbtns" id="panel-btns" role="group" aria-label="Buttons"></div>
      </div>
    </div>
    <div class="pnbed" id="panel-bed" role="group" aria-label="Keys"></div></div>`;

  // ---- the controls
  function paintHeld() {
    for (const b of Object.values(B)) { b.el.classList.toggle("held", !!(btns.mask & (1 << b.bit))); b.el.classList.toggle("latched", !!(btns.latched & (1 << b.bit))); b.el.setAttribute("aria-pressed", String(!!(btns.mask & (1 << b.bit)))); }
    K.forEach((k, i) => { k.el.classList.toggle("held", !!(keys.mask & (1 << i))); k.el.classList.toggle("latched", !!(keys.latched & (1 << i))); k.el.setAttribute("aria-pressed", String(!!(keys.mask & (1 << i)))); });
  }
  const now = () => performance.now();
  function letGo(h, id) {
    const w = h.up(id, now());
    if (w > 0) { const at = h.at.get(id); setTimeout(() => { if (h.at.get(id) === at) { h.by.delete(id); h.at.delete(id); h.sync(); paintHeld(); } }, w); }
    paintHeld();
  }
  function control(h, bit, name, cap, cls) {
    const b = el("button", cls);
    b.type = "button"; b.tabIndex = -1; b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", cap ? `${name} (${cap})` : name);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    let pointerAt = -1e9;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); pointerAt = now();
      if (e.shiftKey || e.button === 2) h.latch(bit);
      else if (!h.unlatch(bit)) { b.setPointerCapture(e.pointerId); h.down(`p${e.pointerId}`, bit, now()); }
      paintHeld();
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(t, (e) => letGo(h, `p${e.pointerId}`));
    // (a screen reader's "activate": a click with no pointer before it: a short press)
    b.addEventListener("click", () => { if (now() - pointerAt < 2000 || h.unlatch(bit)) { paintHeld(); return; } h.down("t", bit, now()); paintHeld(); setTimeout(() => letGo(h, "t"), 80); });
    return b;
  }
  for (const row of [ROW1, ROW2, ["OCT-", "OCT+"]]) {
    const r = el("div", `pnrow${row.length === 2 ? " oct" : ""}`);
    for (const name of row) {
      const cap = capOf("btn", BTN[name]), b = control(btns, BTN[name], name, cap, "pnbtn");
      const job = el("span", "pnj");
      b.append(el("span", "pnn", name === "PLAY" ? "PLAY/STOP" : name), job, el("span", "pnk", cap));
      B[name] = { el: b, bit: BTN[name], job };
      r.append(b);
    }
    $("panel-btns").append(r);
  }
  const bed = $("panel-bed");
  WHITE_K.forEach((n, i) => {
    const cap = capOf("key", n), k = control(keys, n, `White key ${i + 1}`, cap, "pnkey white");
    k.style.left = `${i * 100 / 16}%`;
    const job = el("span", "pnj");
    k.append(job, el("span", "pnk", cap));
    K[n] = { el: k, job };
    // the strum plate: a finger that went down on a white key moves the held key as it slides
    k.addEventListener("pointermove", (e) => {
      const id = `p${e.pointerId}`;
      if (!keys.by.has(id)) return;
      const r = bed.getBoundingClientRect(), w = WHITE_K[Math.max(0, Math.min(15, Math.floor((e.clientX - r.left) * 16 / r.width)))];
      if (keys.by.get(id) !== w) { keys.by.set(id, w); keys.sync(); paintHeld(); }
    });
    bed.append(k);
  });
  BLACK_K.forEach((n, i) => {
    const cap = capOf("key", n), k = control(keys, n, `Black key ${i + 1}`, cap, "pnkey black");
    k.style.left = `${(BLACK_AFTER[i] + 1) * 100 / 16}%`;
    const job = el("span", "pnj");
    k.append(job, el("span", "pnk", cap));
    K[n] = { el: k, job };
    bed.append(k);
  });

  // ---- the knobs: endless encoders (a turn is a count of detents), and MASTER, the page's volume
  function turn(name, n) {
    const k = KN[name];
    if (!k) return;
    if (name === "MASTER") {
      master = Math.max(0, Math.min(4096, master + n * 64));
      k.angle = -135 + 270 * master / 4096;
      const pct = Math.round(master * 100 / 4096);
      k.el.setAttribute("aria-valuenow", String(pct)); k.el.setAttribute("aria-valuetext", `${pct} percent`);
      if (vu) vu.master(master);
    } else {
      if (!n) return;
      k.angle = (k.angle + n * 18) % 360;
      if (vu) vu.enc(ENC[name], n);
    }
    k.dial.style.transform = `rotate(${k.angle}deg)`;
  }
  const KNOBS = [["MASTER", "VOLUME"], ["SELECT", "UP / DOWN"], ["PRESETS", "LEFT / RIGHT"], ["ALGORITHM", "PAGE UP / DN"], ["KNOB1", ""], ["KNOB2", ""], ["KNOB3", ""], ["KNOB4", ""]];
  for (const [name, cap] of KNOBS) {
    const k = el("div", "pnknob"), dial = el("i", "pndial"), label = name.replace(/^KNOB(\d)$/, "KNOB $1");
    k.tabIndex = 0;
    k.setAttribute("role", name === "MASTER" ? "slider" : "button");
    k.setAttribute("aria-label", name === "MASTER" ? "MASTER, the volume" : `${label}: UP / DOWN turn it, PAGE UP / DOWN far`);
    if (name === "MASTER") { k.setAttribute("aria-valuemin", "0"); k.setAttribute("aria-valuemax", "100"); }
    const job = el("span", "pnj");
    k.append(el("span", "pnn", label), dial, job, el("span", "pnk", cap));
    KN[name] = { el: k, dial, angle: 0, job };
    let drag = null, wheel = 0;
    k.addEventListener("pointerdown", (e) => { e.preventDefault(); k.focus({ preventScroll: true }); k.setPointerCapture(e.pointerId); drag = { y: e.clientY, acc: 0 }; });
    k.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.acc += drag.y - e.clientY; drag.y = e.clientY;
      const step = name === "MASTER" ? 3 : 7, n = Math.trunc(drag.acc / step);
      if (n) { drag.acc -= n * step; turn(name, n); }
    });
    for (const t of ["pointerup", "pointercancel"]) k.addEventListener(t, () => { drag = null; });
    k.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(dy) >= 50) { turn(name, dy < 0 ? 1 : -1); wheel = 0; return; }   // a wheel's notch: one detent
      wheel -= dy;                                                                     // a trackpad: by distance
      const n = Math.trunc(wheel / 25);
      if (n) { wheel -= n * 25; turn(name, n); }
    }, { passive: false });
    $("panel-knobs").append(k);
  }
  turn("MASTER", 0);                                          // (its mark where the volume is)

  // ---- the screen and the lights
  const lcd = $("panel-lcd").getContext("2d"), small = document.createElement("canvas");
  small.width = small.height = 240;
  const sctx = small.getContext("2d"), img = sctx.createImageData(240, 240);
  function frame(m) {
    if (m.fb) { sctx.putImageData(paint(img, m.fb), 0, 0); lcd.imageSmoothingEnabled = false; lcd.drawImage(small, 0, 0, 480, 480); }
    for (const b of Object.values(B)) b.el.classList.toggle("lit", !!(m.buttons & (1 << b.bit)));
    K.forEach((k, i) => k.el.classList.toggle("lit", !!(m.keys & (1 << i))));
  }
  let last = null;                                            // (the last screen, so the panel opens with it drawn)
  function unit(v) {
    if (unsub) { unsub(); unsub = null; }
    btns.clear(); keys.clear(); btns.latched = keys.latched = 0;
    vu = v; last = null;
    if (!v) return;
    unsub = v.onFrame((m) => { if (m.fb) last = m.fb; if (!root.hidden) frame(m); });
  }
  // the unit's own words for each control's job now (parseLabels: list: 8 knobs, 14 buttons, 16 W keys, 11 B keys)
  function labels(l) {
    if (!l) return;
    ["SELECT", "ALGORITHM", "PRESETS", "KNOB1", "KNOB2", "KNOB3", "KNOB4", "MASTER"].forEach((n, i) => { KN[n].job.textContent = l.list[i] || ""; });
    for (const b of Object.values(B)) b.job.textContent = l.list[8 + b.bit] || "";
    WHITE_K.forEach((n, i) => { K[n].job.textContent = l.list[22 + i] || ""; });
    BLACK_K.forEach((n, i) => { K[n].job.textContent = l.list[38 + i] || ""; });
  }
  // the unit's pages with no screen of their own in the manager: a key each takes the unit there
  for (const [where, label] of [["mfx", "MIDI FX"], ["tools", "TOOLS"], ["fx", "EFFECTS"]]) {
    const b = el("button", "key plain", label); b.type = "button"; b.tabIndex = -1;
    b.addEventListener("click", () => (where === "fx" ? ctx.go(where) : ctx.pick(where)));
    $("panel-go").append(b);
  }

  // ---- open, close, the computer's keys
  // (it is a screen of the manager, F9: shown and hidden with its tab; open: go there, or back where it was)
  function open(on) { if (on) ctx.tab("fm1"); else ctx.back(); }
  function show(on) {
    if (on === !root.hidden) return;
    root.hidden = !on;
    if (on) { if (last) frame({ fb: last, buttons: 0, keys: 0 }); }
    else { btns.clear(); keys.clear(); btns.latched = keys.latched = 0; btns.sync(); keys.sync(); paintHeld(); }
  }
  root.hidden = true;
  $("panel-close").addEventListener("click", () => open(false));
  // (capture, on the window: while this screen is shown the computer's keys are the unit's)
  window.addEventListener("keydown", (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$("help").hidden || /^F\d+$/.test(e.key) || e.key === "?") return;   // (HELP, another screen: the key goes on)
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); open(false); return; }
    if (e.key === "Tab") return;                              // (the knobs, the ESC key)
    const knob = e.target.closest && e.target.closest(".pnknob"), m = KEYMAP[e.code];
    const far = { PageUp: 5, PageDown: -5 }[e.key], near = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (knob && (far || near)) { e.preventDefault(); turn(Object.keys(KN).find((n) => KN[n].el === knob), far || near); return; }
    if (!m) return;
    e.preventDefault();
    if (m.enc) { turn(m.enc, m.n); return; }
    if (e.repeat) return;
    const h = m.btn !== undefined ? btns : keys, bit = m.btn !== undefined ? m.btn : m.key;
    if (e.shiftKey) h.latch(bit);
    else if (!h.unlatch(bit)) h.down(`k${e.code}`, bit, now());
    paintHeld();
  }, true);
  window.addEventListener("keyup", (e) => { letGo(btns, `k${e.code}`); letGo(keys, `k${e.code}`); });
  window.addEventListener("blur", () => { const k = (id) => id[0] === "k"; btns.clear(k); keys.clear(k); paintHeld(); });
  return { open, show, unit, isOpen: () => !root.hidden, labels, title: (t) => { $("panel-h").textContent = t ? `THE FM-1 · ${t}` : "THE FM-1"; } };
}
