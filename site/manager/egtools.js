// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// TOOLS (F10): the track tools (core/seq/tools.h; the unit's TOOLS page, core/app/ctl_tools.c): ROTATE, REVERSE,
// RANDOM, EUCLID, GRIDS, HUMANIZE, QUANTIZE, LENGTH, STRETCH, CLIP on the picked steps, the page, the track or the
// pattern. Nothing is worked out here: each key and each turn goes to the unit's own tool (the browser build's
// eg_web_tools, fz_port.c: its keys, its knobs, OCT+ and OCT-), which changes the pattern live as the unit does, and
// the screen shows what it answers: the tool, its values, the page's steps before and after. KEEP makes it an undo
// level; UNDO takes it back. The unit's TOOLS page is open while this screen is, on the same tool.
// The FM-1 in this browser only: on a unit on USB, its own screen (THE FM-1).
//   A tool: 1 .. 0 (LEFT / RIGHT). The scope: S (SHIFT + S back). A value: drag or scroll it; Q W E R turn KNOB 1 .. 4
//   up, A S.. no: SHIFT + Q W E R down. ENTER keeps, BACKSPACE undoes, SPACE is the transport's. X: the tool's key again.
//   mountTools({ $, unit(), say }) -> { show(on) };  toolText(state) -> [[name, text] x 4] (no DOM: the tests)
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
export const TOOLS = ["ROTATE", "REVERSE", "RANDOM", "EUCLID", "GRIDS", "HUMANIZE", "QUANTIZE", "LENGTH", "STRETCH", "CLIP"];
export const SCOPES = ["SELECTED", "PAGE", "TRACK", "PATTERN"];
const OP = { GET: 0, OPEN: 1, TOOL: 2, SCOPE: 3, KNOB: 4, KEEP: 5, UNDO: 6, AGAIN: 7 };
const RUNGS = ["/4", "/3", "/2", "/1.5", "/1.33", "/1.25", "x1", "x1.25", "x1.33", "x1.5", "x2", "x3", "x4"];
const AGAIN = ["BACK TO 0", "FLIP", "ROLL THE DIE", "", "NEXT PART", "", "", "", "", "DO IT"];
const pm = (n) => (n > 0 ? `+${n}` : String(n)), s8 = (b) => (b > 127 ? b - 256 : b);
// the four knobs' names and values for a tool's state (ctl_tools.c qd_tools_knob: what each turns), as the unit reads
export function toolText(d) {
  const v = d.v || [];
  switch (d.tool) {
    case 0: return [["OFFSET", pm(d.rot)], null, null, null];
    case 1: return [null, null, null, null];
    case 2: return [["DENSITY", `${v[0]}%`], ["NOTES", v[1] ? `+-${v[1]}` : "KEPT"], ["VELOCITY", v[2] ? `+-${v[2]}` : "KEPT"], ["CHANCE", v[3] ? `${v[3]}%` : "KEPT"]];
    case 3: return [["HITS", String(v[0])], ["LENGTH", String(v[1])], ["ROTATE", String(v[2])], ["LANDS", ["NEW", "ADD", "MASK"][v[3]] || "?"]];
    case 4: return [["X", String(v[0])], ["Y", String(v[1])], ["DENSITY", String(v[2])], ["CHAOS", String(v[3])]];
    case 5: return [["TIMING", v[0] ? `+-${v[0]}/24` : "KEPT"], ["VELOCITY", v[1] ? `+-${v[1]}` : "KEPT"], null, null];
    case 6: return [["TIMING", `${v[0]}%`], ["GRID", ["STEP", "1/2", "1/3", "1/4"][v[1]] || "?"], ["VELOCITY", `${v[2]}%`], null];
    case 7: return [["LENGTH", d.lpow > 0 ? `x${1 << d.lpow}` : d.lpow < 0 ? `/${1 << -d.lpow}` : "x1"], null, null, null];
    case 8: return [["FACTOR", v[0] ? "(FIT)" : RUNGS[s8(v[1]) + 6] || "x1"], ["FIT PAGES", v[0] ? String(v[0]) : "OFF"], null, null];
    case 9: return [["ACTION", ["COPY", "PASTE", "CLEAR"][v[0]] || "?"], null, null, null];
    default: return [null, null, null, null];
  }
}

export function mountTools(ctx) {
  const { $ } = ctx;
  const S = { shown: false, d: null, was: "", busy: false, drag: null };
  const root = $("tab-tools");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="tl-title">TOOLS</span><span class="dim">1..0 TOOL · S SCOPE · Q W E R KNOB 1..4 (SHIFT: DOWN) · ENTER KEEP · BACKSPACE UNDO · X AGAIN</span></div>
    <div class="mfbar"><span class="seg" id="tl-tools" role="group" aria-label="The tools"></span></div>
    <div class="mfbar"><span class="lab">ON</span><span class="seg" id="tl-scopes" role="group" aria-label="The scope"></span><span class="dim" id="tl-where"></span></div>
    <div class="mfslot box">
      <canvas id="tl-pic" class="pxpic" width="320" height="96" aria-hidden="true"></canvas>
      <div class="mfrow" id="tl-knobs"></div>
      <div class="tlsteps" id="tl-steps" aria-label="The page's steps: before, and after"></div>
      <div class="keys tlacts"><button id="tl-keep" class="key go" type="button">KEEP (ENTER)</button><button id="tl-undo" class="key plain" type="button">UNDO (BACKSPACE)</button>
        <button id="tl-again" class="key plain" type="button"></button><span class="dim" id="tl-state"></span></div>
    </div>
    <p class="dim" id="tl-note">The change is live in the pattern as you turn, as on the unit. KEEP makes it one undo level; UNDO puts the steps back.</p>`;
  async function ask(op = OP.GET, a = 0, b = 0) {
    const u = ctx.unit();
    if (!u || (S.busy && op === OP.GET)) return;
    S.busy = true;
    try {
      const r = await u.call("eg_web_tools", op, a, b);
      if (!r || r.tool === undefined) return;
      S.d = r;
      const text = JSON.stringify(r);
      if (text !== S.was) { S.was = text; render(); }
    } finally { S.busy = false; }
  }
  function render() {
    const d = S.d;
    $("tl-title").textContent = `TOOLS · ${TOOLS[d.tool]} · ${SCOPES[d.scope]}`;
    const tb = $("tl-tools"); tb.textContent = "";
    TOOLS.forEach((n, k) => {
      const b = el("button", "key plain", `${(k + 1) % 10} ${n}`); b.type = "button"; b.setAttribute("aria-pressed", String(k === d.tool));
      b.addEventListener("click", () => ask(OP.TOOL, k));
      tb.append(b);
    });
    const sb = $("tl-scopes"); sb.textContent = "";
    SCOPES.forEach((n, k) => {
      const b = el("button", "key plain", k ? n : "SELECTED STEPS"); b.type = "button"; b.setAttribute("aria-pressed", String(k === d.scope));
      b.addEventListener("click", () => ask(OP.SCOPE, k));
      sb.append(b);
    });
    $("tl-where").textContent = `TRACK ${d.sel + 1} · PAGE ${d.page + 1}${d.len ? ` · ${d.len} STEPS AFTER` : ""}`;
    const kb = $("tl-knobs"); kb.textContent = "";
    toolText(d).forEach((p, k) => {
      if (!p) { kb.append(el("span", "mftile none")); return; }
      const t = el("button", "mftile"); t.type = "button"; t.dataset.k = String(k);
      t.setAttribute("aria-label", `KNOB ${k + 1}, ${p[0]}: ${p[1]}`);
      t.append(el("i", "", `K${k + 1} ${p[0]}`), el("b", "", p[1]));
      kb.append(t);
    });
    if (d.tool === 4) kb.append(el("span", "dim", `PART ${["LOW", "MID", "HIGH"][d.v[4]] || ""} (X: THE NEXT)`));
    if (d.tool === 1) kb.append(el("span", "dim", d.flags & 4 ? "REVERSED, FLIPPED" : "REVERSED (X: FLIP)"));
    const st = $("tl-steps"); st.textContent = "";
    (d.steps || []).forEach(([on, was], w) => {
      const c = el("span", `tlstep${on ? " on" : ""}${was ? " was" : ""}${on !== was ? " ch" : ""}${(d.inr >> w) & 1 ? "" : " out"}`, String(w + 1));
      c.title = `Step ${w + 1}: ${was ? "a trig" : "empty"} before, ${on ? "a trig" : "empty"} after`;
      st.append(c);
    });
    $("tl-again").textContent = AGAIN[d.tool] ? `${AGAIN[d.tool]} (X)` : "";
    $("tl-again").hidden = !AGAIN[d.tool];
    $("tl-state").textContent = d.pending ? (d.flags & 2 ? "A CHANGE SHOWN, NOT YET IN THE PATTERN: KEEP WRITES IT (NO UNDO)" : "A CHANGE PENDING: KEEP OR UNDO") : "NOTHING PENDING";
    $("tl-keep").disabled = $("tl-undo").disabled = !d.pending && d.tool !== 9;
  }
  $("tl-keep").addEventListener("click", () => ask(OP.KEEP));
  $("tl-undo").addEventListener("click", () => ask(OP.UNDO));
  $("tl-again").addEventListener("click", () => ask(OP.AGAIN));
  // a value: its tile dragged up and down or scrolled: the unit's knob turned, a detent at a time
  const knobOf = (e) => { const t = e.target.closest && e.target.closest(".mftile[data-k]"); return t ? Number(t.dataset.k) : -1; };
  root.addEventListener("pointerdown", (e) => { const k = knobOf(e); if (k < 0) return; S.drag = { k, y: e.clientY, acc: 0 }; root.setPointerCapture(e.pointerId); });
  root.addEventListener("pointermove", (e) => {
    if (!S.drag) return;
    S.drag.acc += S.drag.y - e.clientY; S.drag.y = e.clientY;
    const n = Math.trunc(S.drag.acc / 7);
    if (n) { S.drag.acc -= n * 7; ask(OP.KNOB, S.drag.k, n); }
  });
  for (const ev of ["pointerup", "pointercancel"]) root.addEventListener(ev, () => { S.drag = null; });
  let wheel = 0;
  root.addEventListener("wheel", (e) => {
    const k = knobOf(e);
    if (k < 0) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(dy) >= 50) { ask(OP.KNOB, k, dy < 0 ? 1 : -1); wheel = 0; return; }
    wheel -= dy; const n = Math.trunc(wheel / 25); if (n) { wheel -= n * 25; ask(OP.KNOB, k, n); }
  }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.d || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const k = e.key.toLowerCase(), kn = "qwer".indexOf(k), focus = knobOf(e), near = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (focus >= 0 && near) ask(OP.KNOB, focus, near);
    else if (/^[0-9]$/.test(e.key)) ask(OP.TOOL, (Number(e.key) + 9) % 10);
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") ask(OP.TOOL, (S.d.tool + (e.key === "ArrowRight" ? 1 : TOOLS.length - 1)) % TOOLS.length);
    else if (k === "s") ask(OP.SCOPE, (S.d.scope + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length);
    else if (kn >= 0 && k.length === 1) ask(OP.KNOB, kn, e.shiftKey ? -1 : 1);
    else if (e.key === "Enter") ask(OP.KEEP);
    else if (e.key === "Backspace" || e.key === "Delete") ask(OP.UNDO);
    else if (k === "x") ask(OP.AGAIN);
    else return;
    e.preventDefault();
  });
  // the picture: the page's sixteen steps round a wheel, before (inside) and after (outside), a hand going round with
  // the pattern (the playing step while the unit plays); and the tool's own: EUCLID's polygon, GRIDS' map, the
  // timing's ticks pulled about (HUMANIZE) or into line (QUANTIZE), the rows moved (ROTATE, REVERSE)
  const C = { bg: "#000", dim: "#4a4a4a", was: "#7b7b7b", on: "#706deb", ch: "#edf171", hand: "#fff", cy: "#75cec8", red: "#c46c71", gr: "#a9ff9f" };
  const pg = $("tl-pic").getContext("2d");
  function picture(t) {
    const d = S.d;
    pg.fillStyle = C.bg; pg.fillRect(0, 0, 320, 96);
    if (!d || !d.steps) return;
    const cx = 48, cy = 48, at = (i, r) => [Math.round(cx + Math.cos(i / 16 * 2 * Math.PI - Math.PI / 2) * r), Math.round(cy + Math.sin(i / 16 * 2 * Math.PI - Math.PI / 2) * r)];
    const sq = (x, y, n, c) => { pg.fillStyle = c; pg.fillRect(x - (n >> 1), y - (n >> 1), n, n); };
    const pos = d.playing && d.pos >= 0 ? d.pos % 16 : (t / 180) % 16;
    if (d.tool === 3) {                                     // EUCLID: its hits joined
      const hits = d.steps.map(([on], i) => (on ? i : -1)).filter((i) => i >= 0);
      pg.strokeStyle = C.cy; pg.lineWidth = 1; pg.beginPath();
      hits.forEach((i, k) => { const [x, y] = at(i, 38); if (k) pg.lineTo(x + 0.5, y + 0.5); else pg.moveTo(x + 0.5, y + 0.5); });
      if (hits.length > 2) pg.closePath();
      pg.stroke();
    }
    d.steps.forEach(([on, was], i) => {
      const [xi, yi] = at(i, 24), [xo, yo] = at(i, 38), now = Math.floor(pos) === i;
      sq(xi, yi, 3, was ? C.was : C.dim);
      sq(xo, yo, now ? 7 : 5, on ? (on !== was ? C.ch : C.on) : C.dim);
      if (now && on) sq(xo, yo, 3, C.hand);
    });
    const [hx, hy] = at(pos, 16);
    pg.strokeStyle = C.hand; pg.beginPath(); pg.moveTo(cx + 0.5, cy + 0.5); pg.lineTo(hx + 0.5, hy + 0.5); pg.stroke();
    // the two rows: before, after
    const X = 104, W = 12;
    for (let i = 0; i < 16; i++) {
      const [on, was] = d.steps[i], out = !((d.inr >> i) & 1);
      pg.fillStyle = was ? C.was : C.dim; pg.fillRect(X + i * W, 12, W - 2, was ? 10 : 2);
      pg.fillStyle = out ? C.dim : on ? (on !== was ? C.ch : C.on) : C.dim; pg.fillRect(X + i * W, 40, W - 2, on ? 14 : 2);
      if (Math.floor(pos) === i) { pg.fillStyle = C.hand; pg.fillRect(X + i * W, 58, W - 2, 2); }
    }
    const v = d.v || [];
    if (d.tool === 0 && d.rot) {                            // ROTATE: which way, how far
      const n = Math.min(8, Math.abs(d.rot)), dir = d.rot > 0 ? 1 : -1, ph = Math.floor(t / 120) % 4;
      for (let k = 0; k < n; k++) sq(X + 96 + dir * (k * 8 + ph * 2), 30, 3, C.cy);
    }
    if (d.tool === 4) {                                     // GRIDS: the map, where X and Y stand, chaos shaking it
      const gx = 240, gy = 66, jit = (v[3] / 255) * 3;
      pg.strokeStyle = C.on; pg.strokeRect(gx + 0.5, gy - 0.5, 72, 26);
      for (let k = 1; k < 4; k++) { pg.fillStyle = C.dim; pg.fillRect(gx + k * 18, gy, 1, 26); }
      sq(Math.round(gx + 2 + v[0] / 255 * 68 + Math.sin(t / 90) * jit), Math.round(gy + 2 + (1 - v[1] / 255) * 22 + Math.cos(t / 70) * jit), 3 + Math.round(v[2] / 64), C.ch);
    }
    if (d.tool === 5 || d.tool === 6) {                     // the timing: each trig's tick off its line, or going back to it
      for (let i = 0; i < 16; i++) {
        if (!d.steps[i][0]) continue;
        const seed = Math.sin(i * 12.9898) * 43758.5453, r = seed - Math.floor(seed) - 0.5;
        const off = d.tool === 5 ? r * (v[0] / 12) * 5 * (0.6 + 0.4 * Math.sin(t / 300 + i)) : r * 5 * (1 - v[0] / 100) * (0.5 + 0.5 * Math.abs(Math.sin(t / 500)));
        pg.fillStyle = C.dim; pg.fillRect(X + i * W + 4, 66, 1, 22);
        pg.fillStyle = C.gr; pg.fillRect(Math.round(X + i * W + 4 + off), 70, 2, 14);
      }
    }
    if (d.pending) { pg.fillStyle = Math.floor(t / 400) % 2 ? C.ch : C.red; pg.fillRect(306, 6, 8, 8); }   // (a change pending: the unit's orange dot)
  }
  const loop = (t) => { if (S.shown) { picture(t); requestAnimationFrame(loop); } };
  setInterval(() => { if (S.shown && !S.drag) ask(S.d ? OP.GET : OP.OPEN); }, 320);   // (not yet answered: the unit was still starting)
  return {
    show(on) {
      S.shown = on;
      if (!on) return;
      requestAnimationFrame(loop);
      if (!ctx.unit()) { $("tl-note").textContent = "The tools run on the FM-1 in this browser. On a unit on USB: its own screen (THE FM-1)."; return; }
      S.was = ""; ask(OP.OPEN);
    },
  };
}
