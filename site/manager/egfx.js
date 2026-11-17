// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// EFFECTS (ALT + E): the unit's FX page, whole and moving. THE TOWER at the left, as the unit draws it: nine floors
// (B1 SENDS at the top .. B9 TV), the lift riding to the floor of the page shown, a floor lit while the picked track
// is heard through it. Beside it the page's picture, doing what the effect does: the echo's repeats going out and
// fading (from side to side in PING-PONG), the room's walls answering, the chorus's two voices drifting, the crush's
// steps, the robot's ring, the warp's comb sweeping, the glitch's slice repeating (when the unit's own glitch does),
// the TV's lines and hum. Under it the page's four values, as the unit's KNOB 1..4.
// Every name, text, range and value is the firmware's (the browser build's eg_web_fx, fz_port.c: QD_FX_PAGES,
// qd_fx_name, qd_fx_text); a value is written as the unit's knob writes it, a page picked here opens it on the unit
// (its lift rides, its floor is called), and the unit's own page and knobs move this screen. The picked track's sends
// and its DRY are the desk's (eg_web_mix).
//   Keys: 1 .. 9 a floor (again: its second page); LEFT / RIGHT a value; UP / DOWN turn it (SHIFT: far); drag or
//   scroll a value or the picture.
//   mountFx({ $, unit(), names() }) -> { show(on) }
import { notMine } from "./egkeys.js";
const W = 384, H = 176, SX = 4, SW = 64, FH = 18, PX = 74, PW = W - PX - 4;
const C = { bg: "#000", dim: "#4a4a4a", line: "#2e2c9b", lb: "#706deb", ye: "#edf171", wh: "#fff", cy: "#75cec8", lg: "#a9ff9f", lr: "#c46c71", gr: "#7b7b7b", re: "#813338", pu: "#8e3c97", or: "#8e5029", bl: "#2e2c9b", gn: "#56ac4d" };
// the floors (ctl_mix.c QD_FX_KEY: the black keys B1..B9) and each one's colour
export const FLOORS = ["SENDS", "CHORUS", "ECHO", "ROOM", "CRUSH", "ROBOT", "WARP", "GLITCH", "TV"];
const FLC = [C.wh, C.lr, C.cy, C.lg, C.lr, C.cy, C.lg, C.ye, C.wh];
// the desk's value for a track's own cell (eg_web_mix op 1's b): a send (0 ECHO, 1 ROOM, 2 CHORUS), a room, DRY
export const OWN_B = (cell) => (cell.own === "dry" ? 5 : cell.own === "room" ? 6 + cell.k : [2, 3, 4][cell.k]);
// the page a floor key takes the screen to: the floor's first page, or (already there) its next
export function floorPage(pages, cur, floor) {
  const of = pages.map((p, i) => [p, i]).filter(([p]) => p.floor === floor).map(([, i]) => i);
  if (!of.length) return cur;
  const at = of.indexOf(cur);
  return at < 0 ? of[0] : of[(at + 1) % of.length];
}
// the picked track's send into floor f's effect (the SEND cell of the floor's first page; SENDS: none)
export function sendOf(d, f) {
  for (const p of d.pages) if (p.floor === f) for (const c of p.cells) if (c && (c.own === "send" || c.own === "room")) return c;
  return null;
}
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const pct = (c) => (c.hi > c.lo ? (c.v - c.lo) / (c.hi - c.lo) : 0);
const valOf = (cells, name) => { const c = cells.find((x) => x && x.name === name); return c ? pct(c) : 0; };

export function mountFx(ctx) {
  const { $ } = ctx;
  const S = { shown: false, d: null, page: 0, cell: 0, busy: false, was: "", drag: null, lift: 0, liftFrom: 0, liftAt: 0, gen: 0 };
  const root = $("tab-fx");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="fx-title">EFFECTS</span><span class="dim">1..9 FLOOR (AGAIN: ITS SECOND PAGE) · LEFT / RIGHT A VALUE · UP / DOWN TURN IT · DRAG</span></div>
    <canvas id="fx-pic" class="dkpic fxpic" width="${W}" height="${H}" role="img" aria-label="The FX tower: the floors, the lift, the page's picture"></canvas>
    <div class="fxrow" id="fx-cells"></div>
    <p class="dim" id="fx-note"></p>`;
  const cv = $("fx-pic"), g = cv.getContext("2d");
  const page = () => (S.d ? S.d.pages[S.page] : null);
  async function ask(op = 0, a = 0, b = 0) {
    const u = ctx.unit();
    if (!u || (S.busy && !op)) return;
    S.busy = true;
    try {
      const r = await u.call("eg_web_fx", op, a, b);
      if (!r || !r.pages) return;
      if (r.open && r.page !== S.page) setPage(r.page);         // (the unit's page: this screen follows it)
      S.d = r;
      const t = JSON.stringify(r.pages[S.page]) + S.cell + r.sel;
      if (t !== S.was) { S.was = t; tiles(); }
    } finally { S.busy = false; }
  }
  function setPage(p) {
    const f0 = S.d ? S.d.pages[S.page].floor : 0;
    S.page = p;
    const f1 = S.d ? S.d.pages[p].floor : 0;
    if (f0 !== f1) { S.liftFrom = S.lift; S.liftAt = performance.now(); }
  }
  function pick(p) {
    if (!S.d || p < 0 || p >= S.d.pages.length) return;
    setPage(p);
    S.cell = Math.min(S.cell, 3);
    S.was = "";
    ask(1, p);
  }
  async function set(k, v) {
    const pg = page(), c = pg && pg.cells[k], u = ctx.unit();
    if (!c || !u) return;
    v = Math.max(c.lo, Math.min(c.hi, Math.round(v)));
    if (v === c.v) return;
    c.v = v;                                                    // (shown at once; the answer corrects it)
    if (c.own) await u.call("eg_web_mix", 1, S.d.sel, OWN_B(c), v);
    else await ask(2, c.id, v);
    S.was = ""; ask();
  }
  // the four values, each a tile (the unit's KNOB 1..4)
  function tiles() {
    const row = $("fx-cells"), pg = page();
    row.textContent = "";
    if (!pg) return;
    $("fx-title").textContent = `EFFECTS · ${pg.name}`;
    pg.cells.forEach((c, k) => {
      const b = el("button", `mftile${k === S.cell ? " cur" : ""}${c ? "" : " none"}`);
      b.type = "button"; b.dataset.k = String(k);
      if (!c) { b.textContent = `KNOB ${k + 1}: -`; row.append(b); return; }
      const own = c.own ? ` · TRACK ${S.d.sel + 1}` : "";
      b.append(el("i", "", `KNOB ${k + 1} · ${c.name}${own}`), el("b", "", c.text != null ? c.text : `${Math.round(pct(c) * 100)}%`));
      const bar = el("u"); bar.style.width = `${Math.round(pct(c) * 100)}%`; b.append(bar);
      row.append(b);
    });
    const names = ctx.names ? ctx.names() : [];
    $("fx-note").textContent = `The effects are the project's, for every track; a SEND is TRACK ${S.d.sel + 1}${names[S.d.sel] ? ` (${names[S.d.sel]})` : ""}'s. The unit's knobs move this screen, and a floor picked here takes the unit there.`;
  }

  // ---- the picture
  function tower(now) {
    const d = S.d, pg = page();
    const tf = pg.floor, ride = Math.min(1, (now - S.liftAt) / 450), e = ride < 1 ? 1 - (1 - ride) * (1 - ride) : 1;
    S.lift = S.liftAt ? S.liftFrom + (tf - S.liftFrom) * e : tf;
    g.fillStyle = "#0b0a2a"; g.fillRect(SX, 4, SW, FLOORS.length * FH + 2);
    FLOORS.forEach((n, f) => {
      const y = 5 + f * FH, s = sendOf(d, f);
      const heard = f === 0 || (s && s.v > 0);
      g.strokeStyle = f === tf ? C.ye : C.line; g.strokeRect(SX + 0.5, y + 0.5, SW - 1, FH - 2);
      g.fillStyle = heard ? FLC[f] : C.dim; g.font = "8px monospace"; g.fillText(`${f + 1} ${n}`, SX + 4, y + 11);
      if (heard && f) { g.fillStyle = FLC[f]; g.fillRect(SX + SW - 6, y + 6, 3, 3); }
    });
    // the shaft and the car
    const cy = 5 + S.lift * FH;
    g.fillStyle = C.gr; g.fillRect(SX + SW + 1, 4, 1, FLOORS.length * FH);
    g.strokeStyle = C.ye; g.strokeRect(SX - 0.5, cy - 0.5, SW + 1, FH);
    g.fillStyle = C.ye; g.fillRect(SX + SW, cy + 2, 3, FH - 6);
    g.fillStyle = C.gr; g.fillText(`TRACK ${d.sel + 1}`, SX + 4, H - 4);
  }
  function frame(x, y, w, h, col) { g.strokeStyle = col; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
  function picture(now) {
    const d = S.d, pg = page(), cells = pg.cells, t = now / 1000, x0 = PX, y0 = 4, h = H - 8, w = PW;
    frame(x0, y0, w, h, C.line);
    g.font = "8px monospace";
    const play = d.playing, mid = y0 + h / 2;
    const n = pg.name;
    if (n === "SENDS" || n === "FX MIX") {                     // the track's sends: bars, what goes in rising
      const bars = cells.filter(Boolean);
      const bw = Math.floor((w - 20) / bars.length);
      bars.forEach((c, k) => {
        const bx = x0 + 10 + k * bw, bh = Math.round(pct(c) * (h - 40)), col = n === "SENDS" ? [C.lr, C.cy, C.lg, C.wh][k] : [C.lr, C.cy, C.lg, C.ye][k];
        g.fillStyle = "#101030"; g.fillRect(bx, y0 + 14, bw - 10, h - 40);
        g.fillStyle = col; g.fillRect(bx, y0 + 14 + (h - 40) - bh, bw - 10, bh);
        if (play && bh > 4) for (let i = 0; i < 3; i++) { g.fillStyle = C.wh; g.fillRect(bx + 2 + i * ((bw - 14) / 3), y0 + 14 + (h - 40) - (((t * 40 + i * 17 + k * 9) % bh) | 0), 2, 2); }
        g.fillStyle = C.gr; g.fillText(c.name === "SEND" ? FLOORS[4 + (c.k || 0)] : c.name, bx, y0 + h - 14);
        g.fillStyle = C.wh; g.fillText(`${Math.round(pct(c) * 100)}%`, bx, y0 + h - 4);
      });
      g.fillStyle = C.gr; g.fillText(n === "SENDS" ? "TRACK INTO THE SENDS, AND DRY" : "TRACK INTO THE ROOMS", x0 + 8, y0 + 10);
    } else if (n === "CHORUS") {                               // two voices drifting apart and back, at its rate
      const rate = (d.chorus_hz100 || 50) / 100, depth = valOf(cells, "DEPTH"), width = valOf(cells, "WIDTH");
      for (let v = 0; v < 2; v++) {
        g.fillStyle = v ? C.lr : C.cy;
        const off = (v ? 1 : -1) * Math.sin(t * Math.PI * 2 * rate) * (2 + depth * 10);
        for (let i = 0; i < w - 16; i++) {
          const y = mid + (v ? 1 : -1) * width * 14 + Math.sin((i + off) / 9) * 22;
          g.fillRect(x0 + 8 + i, Math.round(y), 1, 2);
        }
      }
      g.fillStyle = C.gr; g.fillText(`RATE ${rate.toFixed(2)} HZ`, x0 + 8, y0 + 12);
    } else if (n === "ECHO" || n === "ECHO 2") {               // a note, its repeats going out and fading
      const ms = d.echo_ms || 300, fb = valOf(cells, "FDBK") || ((d.pages[3].cells[2] || { v: 64 }).v / 127);
      const ping = d.pages[4].cells[1] && d.pages[4].cells[1].v, tone = d.pages[4].cells[2] ? pct(d.pages[4].cells[2]) : 0.5;
      const wow = d.pages[4].cells[3] ? pct(d.pages[4].cells[3]) : 0;
      const span = 2400, per = (w - 30) / span, cyc = (now % span);
      for (let r = 0, a = 1; r < 24 && a > 0.04; r++, a *= Math.max(0.05, fb)) {
        const at = r * ms, x = x0 + 14 + at * per + Math.sin(t * 3 + r) * wow * 4;
        if (x > x0 + w - 8) break;
        const side = ping ? (r % 2 ? 1 : -1) : 0, y = mid + side * 28;
        const lit = cyc >= at && cyc < at + 120;
        g.globalAlpha = Math.max(0.15, a);
        g.fillStyle = r ? (tone < 0.5 ? C.lb : C.cy) : C.wh;
        const s = r ? Math.max(4, Math.round(22 * a)) : 26;
        g.fillRect(Math.round(x), Math.round(y - s / 2), lit ? 8 : 6, s);
        g.globalAlpha = 1;
      }
      g.fillStyle = C.ye; g.fillRect(x0 + 14 + cyc * per, y0 + 18, 1, h - 30);
      g.fillStyle = C.gr; g.fillText(`${ms} MS${ping ? " · PING-PONG" : ""}`, x0 + 8, y0 + 12);
      if (ping) { g.fillText("L", x0 + 4, mid - 26); g.fillText("R", x0 + 4, mid + 32); }
    } else if (n === "ROOM" || n === "ROOM 2") {               // the room: a sound in it, its walls answering
      const size = (d.pages[5].cells[0] ? pct(d.pages[5].cells[0]) : 0.5), damp = d.pages[5].cells[1] ? pct(d.pages[5].cells[1]) : 0.3;
      const tail = d.room_ms < 0 ? 99999 : d.room_ms || 1000, pre = d.pages[6].cells[0] ? pct(d.pages[6].cells[0]) : 0;
      const rw = 40 + size * (w - 70), rh = 30 + size * (h - 50), rx = x0 + (w - rw) / 2, ry = y0 + (h - rh) / 2 + 4;
      frame(rx, ry, rw, rh, C.lg);
      const sx = rx + rw * 0.3, sy = ry + rh * 0.6, per = Math.min(4000, tail + 600), ph = (now % per);
      g.fillStyle = C.wh; g.fillRect(sx - 2, sy - 2, 4, 4);
      for (let k = 0; k < 6; k++) {
        const at = pre * 150 + k * 90, r = (ph - at) / 6;
        if (r <= 0) continue;
        const a = Math.max(0, 1 - (ph - at) / tail);
        g.globalAlpha = a * (0.9 - k * 0.12);
        g.strokeStyle = damp > 0.5 ? C.lb : C.lg;
        g.beginPath(); g.ellipse(sx, sy, Math.min(r, rw), Math.min(r * 0.7, rh), 0, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = C.gr; g.fillText(d.room_ms < 0 ? "HELD" : `TAIL ${(tail / 1000).toFixed(1)} S`, x0 + 8, y0 + 12);
    } else if (n === "CRUSH") {                                // a sine as stairs: fewer bits, wider steps
      const bits = cells[0] ? cells[0].v : 16, rate = cells[1] ? pct(cells[1]) : 0, jit = cells[2] ? pct(cells[2]) : 0;
      const lv = Math.pow(2, Math.max(1, Math.min(6, bits / 2.6))), stepw = 1 + Math.round((1 - rate) * 10);
      g.fillStyle = C.dim;
      for (let i = 0; i < w - 16; i++) g.fillRect(x0 + 8 + i, Math.round(mid + Math.sin(i / 14 + t * 2) * 40), 1, 1);
      g.fillStyle = C.lr;
      for (let i = 0; i < w - 16; i += stepw) {
        const j = jit ? (Math.sin(i * 12.9 + t * 30) * jit * 2) | 0 : 0;
        const y = Math.round(Math.round(Math.sin((i + j) / 14 + t * 2) * lv) / lv * 40);
        g.fillRect(x0 + 8 + i, mid + y, stepw, 2);
      }
      g.fillStyle = C.gr; g.fillText(`${cells[0] ? cells[0].text : ""} BITS`, x0 + 8, y0 + 12);
    } else if (n === "ROBOT") {                                // the ring: the voice times the carrier
      const f = cells[0] ? 2 + pct(cells[0]) * 24 : 8, lfo = cells[2] ? pct(cells[2]) : 0;
      for (let i = 0; i < w - 16; i++) {
        const v = Math.sin(i / 16 + t * 3), c = Math.sin(i / (30 / f) + t * 8 * (1 + lfo * Math.sin(t * 2)));
        g.fillStyle = C.dim; g.fillRect(x0 + 8 + i, Math.round(y0 + 26 + v * 10), 1, 1);
        g.fillStyle = C.cy; g.fillRect(x0 + 8 + i, Math.round(mid + 14 + v * c * 34), 1, 2);
      }
      g.fillStyle = C.gr; g.fillText(`CARRIER ${cells[0] ? cells[0].text : ""}`, x0 + 8, y0 + 12);
    } else if (n === "WARP") {                                 // the comb: teeth sweeping
      const time = cells[0] ? pct(cells[0]) : 0.5, fbk = cells[1] ? (cells[1].v - (cells[1].lo + cells[1].hi) / 2) / ((cells[1].hi - cells[1].lo) / 2 || 1) : 0, rate = cells[2] ? pct(cells[2]) : 0.2;
      const gap = 6 + (1 - time) * 20 + Math.sin(t * (0.5 + rate * 4)) * 4;
      for (let x = 0; x < w - 16; x++) {
        const ph = (x % gap) / gap, tooth = fbk >= 0 ? Math.pow(Math.cos(ph * Math.PI), 8) : Math.pow(Math.sin(ph * Math.PI), 8);
        const hh = 8 + tooth * (20 + Math.abs(fbk) * 50);
        g.fillStyle = C.lg; g.fillRect(x0 + 8 + x, y0 + h - 12 - hh, 1, 1);
        g.fillStyle = "#1c3a1c"; g.fillRect(x0 + 8 + x, y0 + h - 11 - hh, 1, hh);
      }
      g.fillStyle = C.gr; g.fillText(`SWEEP ${cells[2] ? cells[2].text : ""}`, x0 + 8, y0 + 12);
    } else if (n === "GLITCH") {                               // the beat in slices, one repeating
      const len = cells[0] ? cells[0].v : 4, ch = cells[1] ? pct(cells[1]) : 0;
      const ns = 16, sw = (w - 20) / ns, beat = Math.floor((now / 125) % ns);
      for (let k = 0; k < ns; k++) {
        const on = d.glitch && k === beat;
        g.fillStyle = on ? C.ye : k === beat ? C.wh : (k * 7 + len) % 5 < ch * 5 ? C.or : C.line;
        g.fillRect(x0 + 10 + k * sw, mid - 14, sw - 2, 28);
      }
      if (d.glitch) {
        const gx = x0 + 10 + (d.gpos / 1000) * (w - 20);
        g.fillStyle = C.ye; g.fillRect(gx, mid - 24, 2, 48);
        g.fillText("REPEATING", x0 + 8, y0 + h - 6);
      }
      g.fillStyle = C.gr; g.fillText(`SLICE ${cells[0] ? cells[0].text : ""} · CHANCE ${cells[1] ? cells[1].text : ""}`, x0 + 8, y0 + 12);
    } else if (n === "TV") {                                   // a small set, its lines and its hum
      const tone = cells[0] ? pct(cells[0]) : 0.5, hum = cells[1] ? pct(cells[1]) : 0, drv = cells[2] ? pct(cells[2]) : 0;
      const tw = 70 + tone * 80, th = tw * 0.7, tx = x0 + (w - tw) / 2, ty = y0 + (h - th) / 2 + 4;
      g.fillStyle = "#222"; g.fillRect(tx - 6, ty - 6, tw + 12, th + 12);
      g.fillStyle = "#0a1a2a"; g.fillRect(tx, ty, tw, th);
      for (let y = 0; y < th; y += 2) {
        const wob = Math.sin(y / 6 + t * 50 * hum) * hum * 4, b = 0.25 + 0.5 * Math.abs(Math.sin(y / 9 + t * (2 + drv * 10)));
        g.globalAlpha = b; g.fillStyle = C.cy; g.fillRect(tx + 2 + wob, ty + y, tw - 4, 1);
      }
      g.globalAlpha = 1;
      if (hum) { g.fillStyle = C.ye; g.fillRect(tx, ty + ((t * 60) % th), tw, 1); }
      g.fillStyle = C.gr; g.fillText(`HUM ${cells[1] ? cells[1].text : ""}`, x0 + 8, y0 + 12);
    }
  }
  function draw(now) {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    if (!S.d) { g.fillStyle = C.gr; g.font = "8px monospace"; g.fillText(ctx.unit() ? "STARTING .." : "ON THE FM-1 IN THIS BROWSER (ALT + W). A UNIT ON USB: THE FM-1 SCREEN", 8, 20); return; }
    tower(now);
    picture(now);
  }
  const loop = (gen) => (t) => { if (S.shown && gen === S.gen) { draw(t); requestAnimationFrame(loop(gen)); } };   // (one loop at a time)

  // ---- the hands
  const row = $("fx-cells");
  let tdrag = null;
  row.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".mftile[data-k]"), pg = page();
    if (!b || !pg || !pg.cells[Number(b.dataset.k)]) return;
    S.cell = Number(b.dataset.k); S.was = ""; tiles();
    const c = pg.cells[S.cell];
    tdrag = { k: S.cell, y: e.clientY, v: c.v, per: (c.hi - c.lo) / 160 };
    row.setPointerCapture(e.pointerId);
  });
  row.addEventListener("pointermove", (e) => { if (tdrag) set(tdrag.k, tdrag.v + (tdrag.y - e.clientY) * Math.max(tdrag.per, 0.05)); });
  for (const ev of ["pointerup", "pointercancel"]) row.addEventListener(ev, () => { tdrag = null; });
  row.addEventListener("wheel", (e) => {
    const b = e.target.closest(".mftile[data-k]"), pg = page();
    if (!b || !pg) return;
    const c = pg.cells[Number(b.dataset.k)];
    if (!c) return;
    e.preventDefault();
    set(Number(b.dataset.k), c.v + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round((c.hi - c.lo) / 64)));
  }, { passive: false });
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  cv.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e);
    if (!S.d) return;
    if (x < SX + SW + 4) {                                      // a floor of the tower
      const f = Math.floor((y - 5) / FH);
      if (f >= 0 && f < FLOORS.length) pick(floorPage(S.d.pages, S.page, f));
      return;
    }
    const pg = page(), c = pg && pg.cells[S.cell];              // the picture: drag the value picked
    if (!c) return;
    cv.setPointerCapture(e.pointerId);
    S.drag = { y: e.clientY, v: c.v, per: (c.hi - c.lo) / 160 };
  });
  cv.addEventListener("pointermove", (e) => { if (S.drag) set(S.cell, S.drag.v + (S.drag.y - e.clientY) * Math.max(S.drag.per, 0.05)); });
  for (const ev of ["pointerup", "pointercancel"]) cv.addEventListener(ev, () => { S.drag = null; });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.d || e.metaKey || e.ctrlKey || e.altKey || notMine(e) || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const pg = page();
    if (/^[1-9]$/.test(e.key)) pick(floorPage(S.d.pages, S.page, Number(e.key) - 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { S.cell = (S.cell + (e.key === "ArrowRight" ? 1 : 3)) % 4; S.was = ""; tiles(); }
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && pg.cells[S.cell]) {
      const c = pg.cells[S.cell], st = Math.max(1, Math.round((c.hi - c.lo) / 127));
      set(S.cell, c.v + (e.key === "ArrowUp" ? 1 : -1) * st * (e.shiftKey ? 8 : 1));
    } else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  setInterval(() => { if (S.shown && !S.drag && !tdrag) ask(); }, 140);
  return {
    show(on) {
      if (on === S.shown) return;
      S.shown = on;
      if (!on) return;
      if (!ctx.unit()) { S.d = null; $("fx-cells").textContent = ""; $("fx-note").textContent = "EFFECTS runs on the FM-1 in this browser. On a unit on USB: its own page (THE FM-1, ALT + F)."; }
      S.was = ""; ask();
      requestAnimationFrame(loop(++S.gen));
    },
    // a screen picked by hand: the unit opens EFFECTS on the page shown here
    drive() { if (S.d) ask(1, S.page); else ask().then(() => ask(1, S.page)); },
  };
}
