// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// THE FM-1 ON THE PAGE: the unit drawn as it looks (the owner, 2026-11-16: "a little version of the FM-1 in the same
// hardware layout", then his picture of it): the dark body; MASTER, SELECT, PRESETS and ALGORITHM, round, their names
// over them, with F1 and F2 in their tray under them on the left; the screen in its black bezel; KN1..4 over the tray
// of two rows of six buttons on the right; the keybed's tray below, the eleven upper keys over the sixteen lower ones.
// Every control carries its name and, under it, what it does on the page the unit is on right now, in the firmware's
// own words (LABELS, core/app/view_labels.c), lights when the unit lights it, and is the control: press a button or a
// key (SHIFT + click: held down until clicked again), drag or scroll a knob. Each is the firmware's own input
// (egvirtual.js vu.buttons / vu.keys / vu.enc), so what is done here does what it does on the unit.
// Two of them, one drawing (Device):
//   THE DOCK: small, above the whole manager while a unit plays the page's FM-1 (REMOTE MODE): always there, in the
//     same place; its size is the player's (drag its corner, ALT + [ and ALT + ]; kept in this browser).
//   THE FM-1 (ALT + F): big, a screen of the manager: every page of the unit the manager has no screen of its own
//     for (EFFECTS, PATTERNS, the settings, the keyboard). While it is shown the computer's keys are the unit's
//     (KEYMAP, by place, so any layout works):
//       Q W E R T Y U I / A S D F G H J K   the sixteen white keys;  1 .. 0 and -   the eleven black keys
//       Z X C V B N   FX SEL ENV LFO EDIT GLO;  M , . /   HOME SAVE ARP SEQ;  P or SPACE   PLAY;  O   REC;  [ ]   OCT
//       UP / DOWN   SELECT;  LEFT / RIGHT   PRESETS;  PAGE UP / DOWN   ALGORITHM;  TAB to a knob: UP / DOWN turn it
//       SHIFT + a key: held down until pressed again;  ESC: back to the screen before
//   mountDock({ $, open() }) -> { unit(vu), show(on), size(px), labels(l), title(t) }
//   mountPanel({ $, tab(name), back(), go(where), pick(name) }) -> { open(on), show(on), unit(vu), isOpen(), labels(l), title(t) }
//   paint(img, fb): a frame to pixels;  Held: what is held down (the tests)
export const BTN = { FX: 0, SEL: 1, ENV: 2, LFO: 3, EDIT: 4, GLO: 5, HOME: 6, SAVE: 7, ARP: 8, SEQ: 9, PLAY: 10, REC: 11, "OCT-": 12, "OCT+": 13 };
export const ENC = { SELECT: 0, ALGORITHM: 1, PRESETS: 2, KNOB1: 3, KNOB2: 4, KNOB3: 5, KNOB4: 6 };
export const WHITE_K = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24, 26];
export const BLACK_K = [1, 3, 5, 8, 10, 13, 15, 17, 20, 22, 25];
const BLACK_AFTER = [0, 1, 2, 4, 5, 7, 8, 9, 11, 12, 14];   // (the white key each black key sits after)
const ROW1 = ["FX", "SEL", "ENV", "LFO", "EDIT", "GLO"], ROW2 = ["HOME", "SAVE", "ARP", "SEQ", "PLAY", "REC"];
const MIN_MS = 50;                                          // (the firmware reads its buttons every 16 ms)
// LABELS' places (egsysex.js parseLabels list): the knobs SELECT ALGORITHM PRESETS KNOB 1..4 MASTER, the 14 buttons in
// their bits' order, W1..W16, B1..B11
const LBL_KNOB = { SELECT: 0, ALGORITHM: 1, PRESETS: 2, KNOB1: 3, KNOB2: 4, KNOB3: 5, KNOB4: 6, MASTER: 7 };
// what EVILGENIUS prints on the buttons (its panel's labels, by bit): shown while the unit names no job for one
const PANEL = ["FX", "TRACKS", "MIX", "LATCH", "EDIT", "SHIFT", "HOME", "SOUNDS", "MIDI FX", "PATTERNS", "PLAY", "REC", "F1", "F2"];

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

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const now = () => performance.now();

// the unit, drawn in its own layout into root. who: this drawing's hand on the unit (vu.buttons(mask, who)); big: the
// computer's key on each control too
class Device {
  constructor(root, { who, big = false, onScreen = () => {} }) {
    Object.assign(this, { root, who, big, vu: null, shown: false, master: 2800, B: [], K: [], KN: {}, last: null, lights: [0, 0] });
    this.btns = new Held((m) => this.vu && this.vu.buttons(m, who));
    this.keys = new Held((m) => this.vu && this.vu.keys(m, who));
    const dv = el("div", `dv${big ? " big" : ""}`), head = el("div", "dvhead"), top = el("div", "dvtop"), left = el("div", "dvleft"), right = el("div", "dvright");
    this.ttl = el("b", "", "ASLEEP");
    head.append(el("span", "", "EVILGENIUS FM-1"), this.ttl);
    const lk = el("div", "dvknobs"), ft = el("div", "dvtray f2");
    for (const n of ["MASTER", "SELECT", "PRESETS", "ALGORITHM"]) lk.append(this.knob(n));
    ft.append(this.button("OCT-"), this.button("OCT+"));
    left.append(lk, ft);
    this.cv = el("canvas", "dvlcd"); this.cv.width = this.cv.height = 240;
    this.cv.setAttribute("aria-label", "The FM-1's screen");
    this.cv.addEventListener("click", onScreen);
    this.g = this.cv.getContext("2d"); this.img = this.g.createImageData(240, 240);
    const k4 = el("div", "dvknobs k4"), tray = el("div", "dvtray b12"), bezel = el("div", "dvbezel");
    for (let i = 1; i <= 4; i++) k4.append(this.knob(`KNOB${i}`));
    for (const n of [...ROW1, ...ROW2]) tray.append(this.button(n));
    right.append(k4, tray);
    bezel.append(this.cv);
    top.append(left, bezel, right);
    const bed = el("div", "dvbed");
    BLACK_K.forEach((n, i) => { const k = this.key(n, `B${i + 1}`, "bk"); k.style.gridColumn = `${2 * BLACK_AFTER[i] + 2} / span 2`; bed.append(k); });
    WHITE_K.forEach((n, i) => {
      const k = this.key(n, `W${i + 1}`, "wk"); k.style.gridColumn = `${2 * i + 1} / span 2`;
      // the strum plate: a finger that went down on a white key moves the held key as it slides
      k.addEventListener("pointermove", (e) => {
        const id = `p${e.pointerId}`;
        if (!this.keys.by.has(id)) return;
        const r = bed.getBoundingClientRect(), w = WHITE_K[Math.max(0, Math.min(15, Math.floor((e.clientX - r.left) * 16 / r.width)))];
        if (this.keys.by.get(id) !== w) { this.keys.by.set(id, w); this.keys.sync(); this.paintHeld(); }
      });
      bed.append(k);
    });
    dv.append(head, top, bed);
    root.append(dv);
    this.turn("MASTER", 0);
  }
  control(h, bit, name, cap, cls) {
    const b = el("button", `dc ${cls}`), job = el("span", "dj");
    b.type = "button"; b.tabIndex = -1; b.setAttribute("aria-pressed", "false");
    b.append(el("span", "dn", name), job);
    if (this.big && cap) b.append(el("span", "dk", cap));
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    let pointerAt = -1e9;
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); pointerAt = now();
      if (e.shiftKey || e.button === 2) h.latch(bit);
      else if (!h.unlatch(bit)) { b.setPointerCapture(e.pointerId); h.down(`p${e.pointerId}`, bit, now()); }
      this.paintHeld();
    });
    for (const t of ["pointerup", "pointercancel", "lostpointercapture"]) b.addEventListener(t, (e) => this.letGo(h, `p${e.pointerId}`));
    // (a screen reader's "activate": a click with no pointer before it: a short press)
    b.addEventListener("click", () => { if (now() - pointerAt < 2000 || h.unlatch(bit)) { this.paintHeld(); return; } h.down("t", bit, now()); this.paintHeld(); setTimeout(() => this.letGo(h, "t"), 80); });
    return { el: b, job, bit, name };
  }
  button(name) { const c = this.control(this.btns, BTN[name], name, capOf("btn", BTN[name]), "bt"); c.job.textContent = PANEL[c.bit]; this.B.push(c); return c.el; }
  key(n, name, cls) { const c = this.control(this.keys, n, name, capOf("key", n), cls); this.K[n] = c; return c.el; }
  knob(name) {
    const k = el("div", "dc knob"), dial = el("i", "dd"), job = el("span", "dj"), label = name.replace(/^KNOB(\d)$/, "KN$1");
    k.tabIndex = this.big ? 0 : -1;
    k.setAttribute("role", name === "MASTER" ? "slider" : "button");
    k.setAttribute("aria-label", name === "MASTER" ? "MASTER, the volume" : `${label}: drag or scroll to turn it`);
    if (name === "MASTER") { k.setAttribute("aria-valuemin", "0"); k.setAttribute("aria-valuemax", "100"); }
    k.append(el("span", "dn", label), dial, job);
    this.KN[name] = { el: k, dial, angle: 0, job };
    let drag = null, wheel = 0;
    k.addEventListener("pointerdown", (e) => { e.preventDefault(); if (this.big) k.focus({ preventScroll: true }); k.setPointerCapture(e.pointerId); drag = { y: e.clientY, acc: 0 }; });
    k.addEventListener("pointermove", (e) => {
      if (!drag) return;
      drag.acc += drag.y - e.clientY; drag.y = e.clientY;
      const step = name === "MASTER" ? 3 : 7, n = Math.trunc(drag.acc / step);
      if (n) { drag.acc -= n * step; this.turn(name, n); }
    });
    for (const t of ["pointerup", "pointercancel"]) k.addEventListener(t, () => { drag = null; });
    k.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(dy) >= 50) { this.turn(name, dy < 0 ? 1 : -1); wheel = 0; return; }   // a wheel's notch: one detent
      wheel -= dy;                                                                          // a trackpad: by distance
      const n = Math.trunc(wheel / 25);
      if (n) { wheel -= n * 25; this.turn(name, n); }
    }, { passive: false });
    return k;
  }
  // the knobs: endless encoders (a turn is a count of detents), and MASTER, the page's volume
  turn(name, n) {
    const k = this.KN[name];
    if (!k) return;
    if (name === "MASTER") {
      this.master = Math.max(0, Math.min(4096, this.master + n * 64));
      k.angle = -135 + 270 * this.master / 4096;
      const pct = Math.round(this.master * 100 / 4096);
      k.el.setAttribute("aria-valuenow", String(pct)); k.el.setAttribute("aria-valuetext", `${pct} percent`);
      if (this.vu && n) this.vu.master(this.master);
    } else {
      if (!n) return;
      k.angle = (k.angle + n * 18) % 360;
      if (this.vu) this.vu.enc(ENC[name], n);
    }
    k.dial.style.transform = `rotate(${k.angle}deg)`;
  }
  paintHeld() {
    for (const c of this.B) { const on = !!(this.btns.mask & (1 << c.bit)); c.el.classList.toggle("held", on); c.el.classList.toggle("latched", !!(this.btns.latched & (1 << c.bit))); c.el.setAttribute("aria-pressed", String(on)); }
    this.K.forEach((c, i) => { const on = !!(this.keys.mask & (1 << i)); c.el.classList.toggle("held", on); c.el.classList.toggle("latched", !!(this.keys.latched & (1 << i))); c.el.setAttribute("aria-pressed", String(on)); });
  }
  letGo(h, id) {
    const w = h.up(id, now());
    if (w > 0) { const at = h.at.get(id); setTimeout(() => { if (h.at.get(id) === at) { h.by.delete(id); h.at.delete(id); h.sync(); this.paintHeld(); } }, w); }
    this.paintHeld();
  }
  release() { this.btns.clear(); this.keys.clear(); this.btns.latched = this.keys.latched = 0; this.btns.sync(); this.keys.sync(); this.paintHeld(); }
  // a frame of the unit: its screen (when it changed) and its lights
  frame(m) {
    if (m.fb) this.last = m.fb;
    if (!this.shown) return;
    if (m.fb) this.g.putImageData(paint(this.img, m.fb), 0, 0);
    if (m.buttons === this.lights[0] && m.keys === this.lights[1]) return;
    this.lights = [m.buttons, m.keys];
    for (const c of this.B) c.el.classList.toggle("lit", !!(m.buttons & (1 << c.bit)));
    this.K.forEach((c, i) => c.el.classList.toggle("lit", !!(m.keys & (1 << i))));
  }
  show(on) {
    this.shown = on;
    if (on && this.last) this.g.putImageData(paint(this.img, this.last), 0, 0);
    if (!on) this.release();
  }
  // the unit's own words for each control's job now (parseLabels: list)
  labels(l) {
    if (!l) return;
    for (const [n, i] of Object.entries(LBL_KNOB)) this.KN[n].job.textContent = l.list[i] || "";
    for (const c of this.B) c.job.textContent = l.list[8 + c.bit] || PANEL[c.bit];
    WHITE_K.forEach((n, i) => { this.K[n].job.textContent = l.list[22 + i] || ""; });
    BLACK_K.forEach((n, i) => { this.K[n].job.textContent = l.list[38 + i] || ""; });
  }
  title(t) { this.ttl.textContent = t || ""; }
}

export function mountDock(ctx) {
  const { $ } = ctx;
  const box = $("dock"), dev = new Device(box, { who: "dock", onScreen: () => ctx.open() }), grip = el("i", "dvgrip");
  grip.title = "Drag: its size (ALT + [ and ]). Double-click: 120";
  box.append(grip);
  let unsub = null, shown = false, px = 120;
  try { px = Number(localStorage.getItem("eg-dock")) || 120; } catch (_) { /* (no storage: 120) */ }
  const size = (v) => {
    px = Math.max(80, Math.min(360, Math.round(v / 20) * 20));
    box.style.setProperty("--dock", `${px}px`);
    try { localStorage.setItem("eg-dock", String(px)); } catch (_) { /* (none) */ }
    return px;
  };
  size(px);
  let drag = null;
  grip.addEventListener("pointerdown", (e) => { e.preventDefault(); grip.setPointerCapture(e.pointerId); drag = { y: e.clientY, px }; });
  grip.addEventListener("pointermove", (e) => { if (drag) size(drag.px + (e.clientY - drag.y)); });
  for (const t of ["pointerup", "pointercancel"]) grip.addEventListener(t, () => { drag = null; });
  grip.addEventListener("dblclick", () => size(120));
  document.addEventListener("keydown", (e) => {
    if (!shown || !e.altKey || e.metaKey || e.ctrlKey || (e.code !== "BracketLeft" && e.code !== "BracketRight")) return;
    e.preventDefault(); size(px + (e.code === "BracketRight" ? 20 : -20));
  });
  return {
    size,
    unit(v) { if (unsub) { unsub(); unsub = null; } dev.release(); dev.vu = v; dev.last = null; if (v) unsub = v.onFrame((m) => dev.frame(m)); },
    show(on) {
      shown = on; box.hidden = !on;
      box.parentElement.classList.toggle("docked", on);
      dev.show(on);
    },
    labels: (l) => dev.labels(l),
    title: (t) => dev.title(t),
  };
}

export function mountPanel(ctx) {
  const { $ } = ctx;
  const root = $("panel");
  const head = el("div", "pnhead"), h2 = el("h2", "", "THE FM-1"), go = el("span", "pngo"), close = el("button", "key plain", "ESC");
  h2.id = "panel-h"; close.type = "button"; close.setAttribute("aria-label", "Back to the screen before (ESC)");
  // the unit's pages: a key each takes the unit there (and the manager to its screen for it)
  for (const [where, label] of [["mfx", "MIDI FX"], ["tools", "TOOLS"], ["fx", "EFFECTS"]]) {
    const b = el("button", "key plain", label); b.type = "button"; b.tabIndex = -1;
    b.addEventListener("click", () => (where === "fx" ? ctx.go(where) : ctx.pick(where)));
    go.append(b);
  }
  head.append(h2, go, el("span", "dim", "THE COMPUTER'S KEYS ARE THE UNIT'S HERE (THE YELLOW LETTERS) · SHIFT HOLDS ONE DOWN"), close);
  root.append(head);
  const dev = new Device(root, { who: "page", big: true });
  let unsub = null;
  function unit(v) { if (unsub) { unsub(); unsub = null; } dev.release(); dev.vu = v; dev.last = null; if (v) unsub = v.onFrame((m) => dev.frame(m)); }
  // (it is a screen of the manager: shown and hidden with its tab; open: go there, or back where it was)
  function open(on) { if (on) ctx.tab("fm1"); else ctx.back(); }
  function show(on) { if (on === !root.hidden) return; root.hidden = !on; dev.show(on); }
  root.hidden = true;
  close.addEventListener("click", () => open(false));
  // (capture, on the window: while this screen is shown the computer's keys are the unit's)
  window.addEventListener("keydown", (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$("help").hidden || /^F\d+$/.test(e.key) || e.key === "?") return;   // (HELP, another screen: the key goes on)
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); open(false); return; }
    if (e.key === "Tab") return;                              // (the knobs, the ESC key)
    const knob = e.target.closest && e.target.closest(".dc.knob"), m = KEYMAP[e.code];
    const far = { PageUp: 5, PageDown: -5 }[e.key], near = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (knob && (far || near)) { e.preventDefault(); dev.turn(Object.keys(dev.KN).find((n) => dev.KN[n].el === knob), far || near); return; }
    if (!m) return;
    e.preventDefault();
    if (m.enc) { dev.turn(m.enc, m.n); return; }
    if (e.repeat) return;
    const h = m.btn !== undefined ? dev.btns : dev.keys, bit = m.btn !== undefined ? m.btn : m.key;
    if (e.shiftKey) h.latch(bit);
    else if (!h.unlatch(bit)) h.down(`k${e.code}`, bit, now());
    dev.paintHeld();
  }, true);
  window.addEventListener("keyup", (e) => { dev.letGo(dev.btns, `k${e.code}`); dev.letGo(dev.keys, `k${e.code}`); });
  window.addEventListener("blur", () => { const k = (id) => id[0] === "k"; dev.btns.clear(k); dev.keys.clear(k); dev.paintHeld(); });
  return { open, show, unit, isOpen: () => !root.hidden, labels: (l) => dev.labels(l), title: (t) => { dev.title(t); h2.textContent = t ? `THE FM-1 · ${t}` : "THE FM-1"; } };
}
