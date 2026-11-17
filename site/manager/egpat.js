// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// PATTERNS (ALT + T): the unit's PATTERNS page (SEQ's second), all four banks at once. Each pattern a card (A01 ..
// D16): holding steps it is filled in its bank's colour, the playing one white and beating with the tempo, the queued
// one blinking orange with the line above emptying to the change, F1's copy ringed green, F2's last cut orange. On top
// the playing pattern big (and the one coming), the launch mode (END BAR BEAT NOW: when a picked pattern starts).
// It is the unit's page: a pattern picked here is picked as its W key picks it (eg_web_pat, fz_port.c: the page opened
// first, so the unit shows it), the launch mode is its ALGORITHM, a copy is F1 held and two W keys, X is F2 and one,
// as on the unit (its undo takes them back): F2 cuts a pattern, or, right after a copy, pastes the copy onto it (the
// unit's rule: a copy loads the hand, the next F2 pastes). What plays now comes with each frame (eg_web_live).
//   Click a pattern: queued (SHIFT: at once). Drag it onto another: copied there. X or DELETE: F2 on the picked one.
//   Keys: ARROWS a pattern; ENTER queue it (SHIFT: at once); A B C D a bank; L the launch mode.
//   mountPat({ $, unit() }) -> { show(on), drive() }
import { notMine } from "./egkeys.js";
const W = 384, H = 156, CW = 22, CH = 22, X0 = 18, Y0 = 52;
const C = { bg: "#000", dim: "#4a4a4a", line: "#2e2c9b", lb: "#706deb", ye: "#edf171", wh: "#fff", cy: "#75cec8", lg: "#a9ff9f", lr: "#c46c71", gr: "#7b7b7b", or: "#e08a3c", pu: "#8e3c97" };
const BANKC = [C.lr, C.cy, C.lg, C.ye];
export const patName = (k) => `${"ABCD"[k >> 4]}${String((k & 15) + 1).padStart(2, "0")}`;
export const usedAt = (used, k) => ((used[k >> 4] >> (k & 15)) & 1) === 1;
// the card under a point of the picture (0..63), or -1
export function cardAt(x, y) {
  const c = Math.floor((x - X0) / CW), r = Math.floor((y - Y0) / CH);
  return c >= 0 && c < 16 && r >= 0 && r < 4 && x >= X0 ? r * 16 + c : -1;
}
export const launchAt = (x, y) => (y >= 30 && y < 44 && x >= 236 && x < 380 ? Math.floor((x - 236) / 36) : -1);
const B_F1 = 12, B_F2 = 13;                                 // (the buttons' bits: QD_B_OCTDN, QD_B_OCTUP: F1, F2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function mountPat(ctx) {
  const { $ } = ctx;
  const S = { shown: false, d: null, pick: 0, busy: false, live: null, drag: null, unsub: null, liveAt: 0, gen: 0 };
  const root = $("tab-pat");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="pt-title">PATTERNS</span><span class="dim">CLICK QUEUE (SHIFT: AT ONCE) · DRAG ONTO ANOTHER: COPY · X F2: CUT (AFTER A COPY: PASTE) · A B C D BANK · L LAUNCH</span></div>
    <canvas id="pt-pic" class="dkpic ptpic" width="${W}" height="${H}" role="img" aria-label="The 64 patterns in four banks: playing, queued, holding steps"></canvas>
    <p class="dim" id="pt-note"></p>`;
  const cv = $("pt-pic"), g = cv.getContext("2d");
  async function ask(op = 0, a = 0) {
    const u = ctx.unit();
    if (!u || (S.busy && !op)) return;
    S.busy = true;
    try {
      const r = await u.call("eg_web_pat", op, a, 0);
      if (r && r.used) { S.d = r; note(); }
    } finally { S.busy = false; }
  }
  function note() {
    const d = S.d;
    $("pt-title").textContent = `PATTERNS · ${patName(d.cur)}${d.queued >= 0 ? ` → ${patName(d.queued)}` : ""}`;
    $("pt-note").textContent = `${patName(S.pick)}${usedAt(d.used, S.pick) ? " holds steps" : " is empty"}. A picked pattern starts ${d.launches[d.launch] === "NOW" ? "at once" : `at the ${d.launches[d.launch]} of the one playing`}.${d.open ? " Open on the unit: its W keys pick, B1..B4 the bank." : ""}`;
  }
  // F1 or F2 held on the unit's panel while its W keys are pressed (the copy, the cut), then let go
  async function withButton(bit, fn) {
    const u = ctx.unit();
    if (!u) return;
    await ask(1);                                             // (the page open first: the layer is PATTERNS')
    u.buttons(1 << bit, "pat"); await sleep(70);
    try { await fn(); } finally { await sleep(40); u.buttons(0, "pat"); await sleep(70); ask(); }
  }
  const copy = (from, to) => withButton(B_F1, async () => { await ask(3, from); await sleep(40); await ask(3, to); });
  const f2 = (k) => withButton(B_F2, () => ask(3, k));      // (the unit's F2 + W: CUT, or PASTE the hand)
  const queue = (k, now) => { S.pick = k; ask(now ? 4 : 3, k); };
  // the state read after a change: a read already on its way is waited for, then read again (never the old one)
  async function fresh() {
    for (let k = 0; k < 60 && S.busy; k++) await sleep(10);
    return ask();
  }
  async function launch(i) {
    const u = ctx.unit();
    if (!u || !S.d) return;
    await ask(1);
    for (let t = 0; t < 3 && S.d.launch !== i; t++) { await u.knob(1, i - S.d.launch); await fresh(); }
  }

  function draw(now) {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    const d = S.d;
    if (!d) { g.fillStyle = C.gr; g.font = "8px monospace"; g.fillText(ctx.unit() ? "STARTING .." : "ON THE FM-1 IN THIS BROWSER (ALT + W). A UNIT ON USB: THE FM-1 SCREEN", 8, 20); return; }
    const L = S.live, playing = L ? L[0] : d.playing, bpm = L ? L[20] | (L[21] << 8) : d.bpm || 120;
    const beatf = L ? (L[23] / 255) : 0, pulse = playing ? 1 - beatf : 0, blink = Math.floor(now / 250) % 2 === 0;
    g.font = "16px monospace";
    g.fillStyle = playing ? C.wh : C.gr; g.fillText(patName(d.cur), 8, 22);
    if (d.queued >= 0) { g.fillStyle = blink ? C.or : C.gr; g.fillText(`→ ${patName(d.queued)}`, 54, 22); }
    g.font = "8px monospace";
    // the line emptying to the change
    g.fillStyle = "#101030"; g.fillRect(8, 30, 200, 4);
    if (d.queued >= 0 && playing) { g.fillStyle = C.or; g.fillRect(8, 30, Math.round(200 * d.left / 1000), 4); }
    g.fillStyle = C.gr; g.fillText(`${bpm} BPM${playing ? "" : " · STOPPED"}`, 8, 44);
    // the launch mode
    g.fillStyle = C.gr; g.fillText("LAUNCH", 236, 22);
    d.launches.forEach((n, i) => { g.fillStyle = i === d.launch ? C.wh : C.dim; g.fillText(n, 238 + i * 36, 40); if (i === d.launch) g.fillRect(238 + i * 36, 42, n.length * 5, 1); });
    // the banks
    for (let b = 0; b < 4; b++) {
      g.fillStyle = b === d.bank ? BANKC[b] : C.gr; g.fillText("ABCD"[b], 6, Y0 + b * CH + 14);
      if (b === d.bank) { g.strokeStyle = BANKC[b]; g.strokeRect(3.5, Y0 + b * CH + 4.5, 11, 13); }
      for (let i = 0; i < 16; i++) {
        const k = b * 16 + i, x = X0 + i * CW, y = Y0 + b * CH, used = usedAt(d.used, k);
        const isCur = k === d.cur, isQ = k === d.queued;
        g.fillStyle = used ? BANKC[b] : "#101030";
        g.globalAlpha = used ? 0.55 : 1;
        g.fillRect(x + 1, y + 1, CW - 3, CH - 3);
        g.globalAlpha = 1;
        if (isCur) {                                          // the playing one: white, beating
          const s = Math.round(pulse * 3);
          g.fillStyle = C.wh; g.fillRect(x + 1 - s, y + 1 - s, CW - 3 + 2 * s, CH - 3 + 2 * s);
        }
        if (isQ && blink) { g.strokeStyle = C.or; g.lineWidth = 2; g.strokeRect(x, y, CW - 1, CH - 1); g.lineWidth = 1; }
        if (k === d.src) { g.strokeStyle = C.lg; g.strokeRect(x - 0.5, y - 0.5, CW, CH); }
        if (k === d.last) { g.strokeStyle = d.act === 1 ? C.or : C.lg; g.strokeRect(x - 0.5, y - 0.5, CW, CH); }
        if (k === S.pick) { g.strokeStyle = C.ye; g.strokeRect(x + 0.5, y + 0.5, CW - 2, CH - 2); }
        g.fillStyle = isCur ? C.bg : used ? C.bg : C.dim; g.fillText(String(i + 1), x + (i < 9 ? 7 : 4), y + 14);
      }
    }
    if (S.drag && S.drag.over >= 0 && S.drag.over !== S.drag.from) {   // a copy on its way
      const x = X0 + (S.drag.over & 15) * CW, y = Y0 + (S.drag.over >> 4) * CH;
      g.strokeStyle = C.lg; g.setLineDash([2, 2]); g.strokeRect(x - 1.5, y - 1.5, CW + 2, CH + 2); g.setLineDash([]);
      g.fillStyle = C.lg; g.fillText(`COPY ${patName(S.drag.from)} → ${patName(S.drag.over)}`, 236, H - 6);
    }
  }
  const loop = (gen) => (t) => { if (S.shown && gen === S.gen) { draw(t); requestAnimationFrame(loop(gen)); } };   // (one loop at a time)
  const at = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  cv.addEventListener("pointerdown", (e) => {
    const [x, y] = at(e), k = cardAt(x, y), l = launchAt(x, y);
    if (l >= 0) { launch(l); return; }
    if (y >= Y0 && x < X0) { const b = Math.floor((y - Y0) / CH); if (b >= 0 && b < 4) ask(2, b); return; }
    if (k < 0) return;
    S.pick = k;
    S.drag = { from: k, over: k, shift: e.shiftKey };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => { if (S.drag) S.drag.over = cardAt(...at(e)); });
  cv.addEventListener("pointerup", () => {
    const dg = S.drag;
    S.drag = null;
    if (!dg) return;
    if (dg.over >= 0 && dg.over !== dg.from) copy(dg.from, dg.over);
    else queue(dg.from, dg.shift);
  });
  cv.addEventListener("pointercancel", () => { S.drag = null; });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.d || e.metaKey || e.ctrlKey || e.altKey || notMine(e) || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") S.pick = (S.pick + (e.key === "ArrowRight" ? 1 : 63)) % 64;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") S.pick = (S.pick + (e.key === "ArrowDown" ? 16 : 48)) % 64;
    else if (e.key === "Enter") queue(S.pick, e.shiftKey);
    else if ("abcd".includes(k) && k.length === 1) ask(2, "abcd".indexOf(k));
    else if (k === "l") launch((S.d.launch + 1) % S.d.launches.length);
    else if (k === "x" || e.key === "Delete") f2(S.pick);
    else return;
    if (S.d) note();
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  setInterval(() => { if (S.shown && !S.drag) ask(); }, 200);
  return {
    show(on) {
      if (on === S.shown) return;
      S.shown = on;
      if (S.unsub) { S.unsub(); S.unsub = null; }
      if (!on) return;
      const u = ctx.unit();
      if (u) S.unsub = u.onFrame((m) => { if (m.live) S.live = m.live; });
      else { S.d = null; $("pt-note").textContent = "PATTERNS runs on the FM-1 in this browser. On a unit on USB: SEQUENCE's PATTERNS, or its own page (THE FM-1)."; }
      ask();
      requestAnimationFrame(loop(++S.gen));
    },
    drive() { ask(1); },
  };
}
