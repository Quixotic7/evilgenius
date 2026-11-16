// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// THE DESK: MIX on the FM-1 in this browser, drawn as the unit draws its MIX page (six strips: the track's wave, its
// pan knob, its fader with the yellow cap) and whole: beside each fader the three sends (ECHO, ROOM, CHORUS), under it
// the five rooms (CRUSH ROBOT WARP GLITCH TV), M and S, and at the right the output's own meters. It moves: a track's
// wave runs and its light rises while it sounds (the voices the unit has on it: a light, not a level in dB), the output
// meters are the sound's real peaks. Drawn small in the C64's colours and shown big, as the unit's screens are.
// The values are the unit's (the browser build's eg_web_mix, fz_port.c: read ten times a second while shown, written
// as its MIX knobs write them), so its knobs move the desk and the desk moves its page.
//   Drag a fader, a send, a room's square (up and down), the pan knob (left and right); click M or S; scroll over any.
//   Keys: 1..6 a track; LEFT / RIGHT a value of it, UP / DOWN turn it (SHIFT: far); M mute, S solo, 0 neither anywhere.
//   mountDesk({ $, unit(), names() }, host) -> { show(on) }
const W = 384, H = 162, SW = 56, X0 = 4, FY0 = 38, FY1 = 118;
const C = { bg: "#000", dim: "#4a4a4a", line: "#2e2c9b", lb: "#706deb", ye: "#edf171", wh: "#fff", cy: "#75cec8", lg: "#a9ff9f", lr: "#c46c71", gr: "#7b7b7b", re: "#813338", pu: "#8e3c97", or: "#8e5029" };
const TRK = [C.lr, C.lb, C.wh, C.lg, C.cy, C.pu], ROOMS = ["CRUSH", "ROBOT", "WARP", "GLITCH", "TV"], ROOMC = [C.lr, C.cy, C.lg, C.ye, C.wh];
// the values of a track, in the order the unit takes them (eg_web_mix op 1's b)
export const PARTS = [["level", "LEVEL", 0, 127], ["pan", "PAN", -64, 63], ["echo", "ECHO", 0, 127], ["room", "ROOM", 0, 127], ["chorus", "CHORUS", 0, 127], ["dry", "DRY", 0, 127],
  ...ROOMS.map((n, k) => [`r${k}`, n, 0, 127])];
export const valueOf = (tr, w) => (w < 6 ? tr[PARTS[w][0]] : tr.rooms[w - 6]);
// what is under a point of the picture: { t, w } a value of track t, { t, mute } / { t, solo }, or just { t }; null: nothing
export function hit(x, y) {
  const t = Math.floor((x - X0) / SW);
  if (t < 0 || t > 5 || x < X0) return null;
  const lx = x - X0 - t * SW;
  if (y < 34) return lx < 24 ? { t, w: 1 } : { t };
  if (y < 122) return lx < 22 ? { t, w: 0 } : lx >= 29 && lx < 35 ? { t, w: 2 } : lx >= 35 && lx < 41 ? { t, w: 3 } : lx >= 41 && lx < 48 ? { t, w: 4 } : { t };
  if (y < 134) { const k = Math.floor((lx - 2) / 9); return k >= 0 && k < 5 ? { t, w: 6 + k } : { t }; }
  if (y < 148) return lx < 26 ? { t, mute: true } : { t, solo: true };
  return { t };
}
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

export function mountDesk(ctx, host) {
  const S = { shown: false, d: null, sel: 0, part: 0, busy: false, drag: null, act: [0, 0, 0, 0, 0, 0], peak: [0, 0], hold: [0, 0], unsub: null };
  const cv = el("canvas", "dkpic"); cv.width = W; cv.height = H;
  cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "The six tracks' strips: fader, pan, sends, rooms, mute and solo; the output's meters");
  const row = el("div", "dkrow"), note = el("p", "dim", "");
  host.append(cv, row, note);
  const g = cv.getContext("2d");
  async function ask(op = 0, a = 0, b = 0, c = 0) {
    const u = ctx.unit();
    if (!u || (S.busy && !op)) return;
    S.busy = true;
    try {
      const r = await u.call("eg_web_mix", op, a, b, c);
      if (r && r.tracks) { const was = S.d; S.d = r; if (!was || r.sel !== S.sel || JSON.stringify(r.tracks[r.sel]) !== JSON.stringify(was.tracks[was.sel])) { S.sel = r.sel; tiles(); } }
    } finally { S.busy = false; }
  }
  const set = (t, w, v) => { const [, , lo, hi] = PARTS[w]; ask(1, t, w, Math.max(lo, Math.min(hi, Math.round(v)))); };
  const pick = (t) => { const u = ctx.unit(); if (u && S.d && t !== S.d.sel) { u.nav(0, t); S.sel = t; } };
  // the picked track's eleven values, each a tile (its number; drag, scroll or the arrows)
  function tiles() {
    row.textContent = "";
    const tr = S.d && S.d.tracks[S.sel];
    if (!tr) return;
    row.append(el("span", "lab", `TRACK ${S.sel + 1}`));
    PARTS.forEach(([, name], w) => {
      const b = el("button", `mftile${w === S.part ? " cur" : ""}`); b.type = "button"; b.dataset.w = String(w);
      const v = valueOf(tr, w), [, , lo, hi] = PARTS[w];
      b.append(el("i", "", name), el("b", "", w === 1 ? (v > 0 ? `R${v}` : v < 0 ? `L${-v}` : "C") : String(v)));
      const bar = el("u"); bar.style.width = `${Math.round((v - lo) * 100 / (hi - lo))}%`; b.append(bar);
      row.append(b);
    });
    note.textContent = tr.mute ? `Track ${S.sel + 1} is muted.` : !tr.heard ? `Track ${S.sel + 1} is not heard: another track is soloed.` : "The desk is the unit's MIX: its knobs move it, and it moves the unit's page.";
  }
  function draw(now) {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const d = S.d;
    if (!d) { g.fillStyle = C.gr; g.font = "8px monospace"; g.fillText("STARTING ..", 8, 20); return; }
    const names = ctx.names();
    d.tracks.forEach((tr, t) => {
      const x = X0 + t * SW, on = t === S.sel, col = TRK[t], live = tr.voices > 0 && tr.heard;
      S.act[t] += ((live ? (tr.gate ? 1 : 0.6) * tr.level / 127 : 0) - S.act[t]) * (live ? 0.5 : 0.12);
      g.strokeStyle = on ? C.lb : "#1a1846"; g.strokeRect(x + 0.5, 1.5, SW - 3, H - 3);
      // its wave: running while it sounds
      g.fillStyle = live ? col : C.dim;
      for (let i = 0; i < 44; i++) {
        const ph = ((i + (live ? now / 40 : 0)) / 11 + t * 0.3) % 1;
        const y = [ph < 0.5 ? 0 : 1, ph, ph < 0.5 ? ph * 2 : 2 - ph * 2, ph < 0.25 ? 0 : 1, 1 - ph, ph < 0.5 ? 1 : 0][t % 6];
        g.fillRect(x + 4 + i, 5 + Math.round(y * 8), 1, 2);
      }
      // the pan knob
      const kx = x + 11, ky = 26, a = (tr.pan / 64) * 2.3 - Math.PI / 2;
      g.strokeStyle = on ? C.ye : C.gr; g.beginPath(); g.arc(kx + 0.5, ky + 0.5, 5, 0, Math.PI * 2); g.stroke();
      g.fillStyle = C.wh; g.fillRect(Math.round(kx + Math.cos(a) * 4), Math.round(ky + Math.sin(a) * 4), 2, 2);
      g.fillStyle = C.gr; g.font = "8px monospace"; g.fillText(tr.pan > 0 ? `R${tr.pan}` : tr.pan < 0 ? `L${-tr.pan}` : "C", x + 22, 29);
      // the fader, its cap
      g.fillStyle = C.line; g.fillRect(x + 10, FY0, 2, FY1 - FY0);
      for (let k = 0; k <= 4; k++) { g.fillStyle = C.dim; g.fillRect(x + 5, FY0 + k * 20, 3, 1); }
      const fy = FY1 - Math.round(tr.level / 127 * (FY1 - FY0));
      g.fillStyle = on ? C.lb : C.ye; g.fillRect(x + 3, fy - 2, 16, 5);
      g.fillStyle = C.bg; g.fillRect(x + 5, fy, 12, 1);
      // its light: the voices it sounds
      const ah = Math.round(S.act[t] * (FY1 - FY0));
      g.fillStyle = "#101030"; g.fillRect(x + 23, FY0, 3, FY1 - FY0);
      g.fillStyle = C.lg; g.fillRect(x + 23, FY1 - ah, 3, ah);
      if (ah > 60) { g.fillStyle = C.ye; g.fillRect(x + 23, FY1 - ah, 3, ah - 60); }
      // the sends: ECHO, ROOM, CHORUS
      [[tr.echo, C.cy], [tr.room, C.lg], [tr.chorus, C.lr]].forEach(([v, c], k) => {
        const sx = x + 30 + k * 6, h = Math.round(v / 127 * (FY1 - FY0));
        g.fillStyle = "#101030"; g.fillRect(sx, FY0, 4, FY1 - FY0);
        g.fillStyle = c; g.fillRect(sx, FY1 - h, 4, h);
        if (live && h > 2) { g.fillStyle = C.wh; g.fillRect(sx, FY1 - Math.round(((now / 6 + k * 23) % 100) / 100 * h), 4, 1); }   // (what goes into it, going up)
      });
      // the five rooms
      tr.rooms.forEach((v, k) => {
        g.strokeStyle = C.dim; g.strokeRect(x + 3.5 + k * 9, 124.5, 6, 6);
        if (v) { g.globalAlpha = 0.25 + 0.75 * v / 127; g.fillStyle = ROOMC[k]; g.fillRect(x + 4 + k * 9, 125, 5, 5); g.globalAlpha = 1; }
      });
      // M, S
      g.fillStyle = tr.mute ? C.lr : "#1a1846"; g.fillRect(x + 4, 136, 20, 10);
      g.fillStyle = tr.solo ? C.ye : "#1a1846"; g.fillRect(x + 28, 136, 20, 10);
      g.fillStyle = tr.mute ? C.bg : C.gr; g.fillText("M", x + 11, 144);
      g.fillStyle = tr.solo ? C.bg : C.gr; g.fillText("S", x + 35, 144);
      g.fillStyle = on ? C.ye : tr.heard ? C.wh : C.dim; g.fillText(`${t + 1} ${(names[t] || "").slice(0, 8)}`, x + 3, 157);
      if (!tr.heard) { g.fillStyle = "rgba(0,0,0,0.5)"; g.fillRect(x + 1, 2, SW - 4, 132); }
    });
    // the output: its peaks, held a moment
    [0, 1].forEach((c) => {
      const p = Math.min(1, S.peak[c] * 1.2);
      S.hold[c] = Math.max(p, S.hold[c] - 0.012);
      const mx = 346 + c * 14, h = Math.round(Math.sqrt(S.hold[c]) * (FY1 - FY0));
      g.fillStyle = "#101030"; g.fillRect(mx, FY0, 10, FY1 - FY0);
      g.fillStyle = C.lg; g.fillRect(mx, FY1 - h, 10, h);
      if (h > 56) { g.fillStyle = C.ye; g.fillRect(mx, FY1 - h, 10, h - 56); }
      if (h > 74) { g.fillStyle = C.lr; g.fillRect(mx, FY1 - h, 10, h - 74); }
      g.fillStyle = C.gr; g.fillText("LR"[c], mx + 2, 128);
    });
    g.fillStyle = C.gr; g.fillText("OUT", 348, 29);
    g.fillStyle = d.playing ? C.lg : C.dim; g.fillRect(350, 136, 16, 10);
  }
  const loop = (t) => { if (S.shown) { draw(t); requestAnimationFrame(loop); } };
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  cv.addEventListener("pointerdown", (e) => {
    const h = S.d && hit(...at(e));
    if (!h) return;
    e.preventDefault(); pick(h.t);
    if (h.mute) { ask(2, h.t); return; }
    if (h.solo) { ask(3, h.t); return; }
    if (h.w === undefined) return;
    S.part = h.w;
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    S.drag = { t: h.t, w: h.w, x: e.clientX, y: e.clientY, v: valueOf(S.d.tracks[h.t], h.w), per: h.w === 1 ? 1.2 : 127 / ((FY1 - FY0) * r.height / H) };
  });
  cv.addEventListener("pointermove", (e) => {
    const dg = S.drag;
    if (dg) set(dg.t, dg.w, dg.v + (dg.w === 1 ? (e.clientX - dg.x) : (dg.y - e.clientY)) * dg.per);
  });
  for (const ev of ["pointerup", "pointercancel"]) cv.addEventListener(ev, () => { S.drag = null; });
  cv.addEventListener("wheel", (e) => {
    const h = S.d && hit(...at(e));
    if (!h || h.w === undefined) return;
    e.preventDefault();
    set(h.t, h.w, valueOf(S.d.tracks[h.t], h.w) + (e.deltaY < 0 ? 2 : -2));
  }, { passive: false });
  // the tiles: dragged, scrolled
  let tdrag = null;
  row.addEventListener("pointerdown", (e) => { const b = e.target.closest(".mftile[data-w]"); if (!b || !S.d) return; S.part = Number(b.dataset.w); tdrag = { w: S.part, y: e.clientY, v: valueOf(S.d.tracks[S.sel], S.part) }; row.setPointerCapture(e.pointerId); });
  row.addEventListener("pointermove", (e) => { if (tdrag) set(S.sel, tdrag.w, tdrag.v + (tdrag.y - e.clientY) * 0.6); });
  for (const ev of ["pointerup", "pointercancel"]) row.addEventListener(ev, () => { tdrag = null; });
  row.addEventListener("wheel", (e) => { const b = e.target.closest(".mftile[data-w]"); if (!b || !S.d) return; e.preventDefault(); const w = Number(b.dataset.w); set(S.sel, w, valueOf(S.d.tracks[S.sel], w) + (e.deltaY < 0 ? 2 : -2)); }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.d || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase(), tr = S.d.tracks[S.sel];
    if (/^[1-6]$/.test(e.key)) pick(Number(e.key) - 1);
    else if (e.key === "0") ask(4, 0);
    else if (e.key === "ArrowLeft") { S.part = (S.part + PARTS.length - 1) % PARTS.length; tiles(); }
    else if (e.key === "ArrowRight") { S.part = (S.part + 1) % PARTS.length; tiles(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") set(S.sel, S.part, valueOf(tr, S.part) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 16 : 1));
    else if (k === "m") ask(2, S.sel);
    else if (k === "s") ask(3, S.sel);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  setInterval(() => { if (S.shown && !S.drag && !tdrag) ask(); }, 110);
  return {
    show(on) {
      if (on === S.shown) return;
      S.shown = on;
      cv.hidden = row.hidden = note.hidden = !on;
      if (S.unsub) { S.unsub(); S.unsub = null; }
      const u = ctx.unit();
      if (!on || !u) return;
      S.unsub = u.onFrame((m) => { if (m.peak) { S.peak[0] = Math.max(S.peak[0] * 0.6, m.peak[0]); S.peak[1] = Math.max(S.peak[1] * 0.6, m.peak[1]); } });
      ask();
      requestAnimationFrame(loop);
    },
  };
}
