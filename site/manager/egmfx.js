// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// MIDI FX (F9): the project's five groups of eight slots (core/seq/mfx.h), as the unit's MIDI FX screen has them and
// all at once: the tracks' groups, a group's chain, the picked slot's every value on every page, the ARP's two lanes.
// It is the unit's own state seen whole: every name, text, range and step comes from the firmware (the browser
// build's eg_web_mfx, fz_port.c: the unit's own tables), each change is written as the unit's knob writes it, and the
// slot picked here is the slot the unit's screen shows (and the other way). Asked three times a second while shown,
// drawn again only when something changed, so a knob turned on the unit moves the value here.
// The FM-1 in this browser only (the call is the browser build's): on a unit on USB, its own screen (THE FM-1).
//   A group: 1 .. 5 (0: the picked track's). A slot: LEFT / RIGHT (, . move it). Its effect: T / SHIFT + T. B bypass.
//   A value: drag or scroll it, or TAB to it and UP / DOWN (PAGE: far, HOME / END). G: the picked track's group.
//   mountMfx({ $, unit(), say }) -> { show(on) }
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const OP = { GET: 0, VALUE: 1, TYPE: 2, BYPASS: 3, LANE: 4, TRACK: 5, MOVE: 6, PICK: 7, OPEN: 8 };

export function mountMfx(ctx) {
  const { $ } = ctx;
  const S = { shown: false, group: 0, slot: 0, d: null, was: "", busy: false, drag: null, unitSlot: -1 };
  const root = $("tab-mfx");
  root.innerHTML = `
    <div class="hhead"><span class="lab" id="mf-title">MIDI FX</span><span class="dim">1..5 GROUP · LEFT / RIGHT SLOT · T EFFECT · B BYPASS · , . MOVE · G TRACK'S GROUP · DRAG A VALUE</span></div>
    <div class="mfbar"><span class="lab">GROUP</span><span class="seg" id="mf-groups" role="group" aria-label="The groups"></span>
      <span class="lab" id="mf-tracklab">TRACK</span><span class="seg" id="mf-track" role="group" aria-label="The picked track's group"></span></div>
    <canvas id="mf-pic" class="pxpic" width="320" height="72" aria-hidden="true"></canvas>
    <div class="mfchain" id="mf-chain" role="listbox" aria-label="The group's eight slots"></div>
    <div class="mfslot box" id="mf-slot"></div>
    <p class="dim" id="mf-note"></p>`;
  const call = async (...a) => { const u = ctx.unit(); return u ? u.call("eg_web_mfx", ...a) : null; };
  const g = () => (S.d ? S.d.group : 1);
  async function ask(op = OP.GET, b = 0, c = 0, d = 0, a = S.group) {
    if (S.busy && op === OP.GET) return;
    S.busy = true;
    try {
      const r = await call(op, a, b, c, d);
      if (!r || !r.slots) return;
      if (r.slot !== S.unitSlot) { S.unitSlot = r.slot; S.slot = r.slot; }   // (the unit picked a slot: this screen follows)
      const text = JSON.stringify(r) + S.slot;
      S.d = r;
      if (text !== S.was) { S.was = text; render(); }
    } finally { S.busy = false; }
  }
  const pick = (k) => { S.slot = Math.max(0, Math.min(7, k)); S.unitSlot = S.slot; ask(OP.PICK, S.slot, 0); };
  const slot = () => (S.d ? S.d.slots[S.slot] : null);

  function render() {
    const d = S.d;
    if (!d) return;
    $("mf-title").textContent = `MIDI FX · GROUP ${d.group}${S.group ? "" : " (THE TRACK'S)"}`;
    const gs = $("mf-groups"); gs.textContent = "";
    for (let k = 1; k <= 5; k++) {
      const users = d.tgroup.map((x, t) => (x === k ? t + 1 : 0)).filter(Boolean);
      const b = el("button", "key plain", `${k}${users.length ? ` · T${users.join(" T")}` : ""}`);
      b.type = "button"; b.setAttribute("aria-pressed", String(d.group === k));
      b.addEventListener("click", () => { S.group = k; ask(); });
      gs.append(b);
    }
    $("mf-tracklab").textContent = `TRACK ${d.sel + 1} GOES THROUGH`;
    const tr = $("mf-track"); tr.textContent = "";
    for (let k = 0; k <= 5; k++) {
      const b = el("button", "key plain", k ? String(k) : "OFF");
      b.type = "button"; b.setAttribute("aria-pressed", String(d.tgroup[d.sel] === k));
      b.addEventListener("click", () => { S.group = 0; ask(OP.TRACK, k, 0, 0, d.sel); });
      tr.append(b);
    }
    const ch = $("mf-chain"); ch.textContent = "";
    d.slots.forEach((s, k) => {
      const b = el("button", `mfcard${k === S.slot ? " on" : ""}${s.type ? "" : " none"}${s.bypass ? " byp" : ""}`);
      b.type = "button"; b.setAttribute("role", "option"); b.setAttribute("aria-selected", String(k === S.slot));
      b.append(el("span", "mfn", String(k + 1)), el("span", "mfname", s.type ? d.types[s.type] : "-"), el("span", "dim", s.bypass ? "BYPASSED" : s.type ? (s.pages[0] || []).filter(Boolean).slice(0, 2).map((p) => p.text || "").join(" ") : "EMPTY"));
      b.addEventListener("click", () => pick(k));
      ch.append(b);
    });
    const box = $("mf-slot"), s = slot();
    box.textContent = "";
    const head = el("div", "mfhead");
    head.append(el("span", "lab", `SLOT ${S.slot + 1}`));
    const sel = el("select"); sel.setAttribute("aria-label", "The slot's effect");
    d.types.forEach((n, k) => { const o = el("option", "", n); o.value = String(k); if (k === s.type) o.selected = true; sel.append(o); });
    sel.addEventListener("change", () => ask(OP.TYPE, S.slot, Number(sel.value)));
    const by = el("button", "key plain", s.bypass ? "BYPASSED" : "BYPASS"); by.type = "button"; by.setAttribute("aria-pressed", String(!!s.bypass));
    by.addEventListener("click", () => ask(OP.BYPASS, S.slot, s.bypass ? 0 : 1));
    const left = el("button", "key plain", "< MOVE"), right = el("button", "key plain", "MOVE >");
    left.type = right.type = "button";
    left.addEventListener("click", () => move(-1)); right.addEventListener("click", () => move(1));
    head.append(sel, by, left, right);
    box.append(head);
    if (!s.type) box.append(el("p", "dim", "An empty slot: notes pass it by. Pick an effect (T, or the list)."));
    s.pages.forEach((pg, pi) => {
      const row = el("div", "mfrow");
      row.append(el("span", "lab", `PAGE ${pi + 1}`));
      pg.forEach((p, k) => {
        if (!p) { row.append(el("span", "mftile none")); return; }
        if (p.lane !== undefined) { row.append(el("span", "mftile none", p.lane ? "TRANSPOSE LANE" : "MOD LANE")); return; }
        const t = el("button", "mftile");
        t.type = "button"; t.dataset.id = String(p.id);
        t.setAttribute("aria-label", `${p.name}: ${p.text}. KNOB ${k + 1} on the unit's page ${pi + 1}`);
        t.append(el("i", "", `K${k + 1} ${p.name}`), el("b", "", p.text));
        const bar = el("u"); bar.style.width = `${p.hi > p.lo ? Math.round((p.v - p.lo) * 100 / (p.hi - p.lo)) : 0}%`;
        t.append(bar);
        row.append(t);
      });
      box.append(row);
    });
    if (s.lanes) s.lanes.forEach((ln, li) => {
      const row = el("div", "mfrow lane");
      row.append(el("span", "lab", li ? "TRANSPOSE" : "MOD"));
      const len = (s.pages.flat().find((p) => p && p.name === (li ? "T LEN" : "M LEN")) || {}).v || 16;
      ln.forEach(([v, text], w) => {
        const c = el("button", `mfcell${w >= len ? " out" : ""}`, text || ".");
        c.type = "button"; c.dataset.lane = String(li * 16 + w); c.dataset.v = String(v);
        c.setAttribute("aria-label", `${li ? "Transpose" : "Mod"} lane step ${w + 1}: ${text}`);
        row.append(c);
      });
      box.append(row);
    });
    $("mf-note").textContent = d.toff[d.sel] ? `Track ${d.sel + 1}'s MIDI FX are switched off on the unit (ARP held): the group is kept and edited, the notes pass it by.`
      : "Every change here is the unit's own: its MIDI FX screen shows the same slot, and an undo on the unit takes it back.";
  }
  function move(dir) { const to = S.slot + dir; if (to < 0 || to > 7) return; S.slot = to; S.unitSlot = to; ask(OP.MOVE, S.slot - dir, to); }
  // a value: its tile dragged up and down, scrolled, or turned with the arrows; an ARP lane's step the same
  const par = (id) => { const s = slot(); return s ? s.pages.flat().find((p) => p && p.id === id) : null; };
  const turn = (id, n) => { const p = par(id); if (p && n) ask(OP.VALUE, S.slot, id, Math.max(p.lo, Math.min(p.hi, p.v + n * p.step))); };
  const laneTurn = (code, n) => { const s = slot(); if (!s || !s.lanes || !n) return; const v = s.lanes[code >> 4][code & 15][0]; ask(OP.LANE, S.slot, code, v + n); };
  const target = (e) => { const t = e.target.closest && e.target.closest(".mftile[data-id], .mfcell"); return t ? (t.dataset.id !== undefined ? { id: Number(t.dataset.id) } : { lane: Number(t.dataset.lane) }) : null; };
  const apply = (t, n) => (t.id !== undefined ? turn(t.id, n) : laneTurn(t.lane, n));
  root.addEventListener("pointerdown", (e) => { const t = target(e); if (!t) return; S.drag = { t, y: e.clientY, acc: 0, moved: false }; root.setPointerCapture(e.pointerId); });
  root.addEventListener("pointermove", (e) => {
    if (!S.drag) return;
    S.drag.acc += S.drag.y - e.clientY; S.drag.y = e.clientY;
    const n = Math.trunc(S.drag.acc / 6);
    if (n) { S.drag.acc -= n * 6; S.drag.moved = true; apply(S.drag.t, n); }
  });
  for (const ev of ["pointerup", "pointercancel"]) root.addEventListener(ev, (e) => {
    const dg = S.drag; S.drag = null;
    if (dg && !dg.moved && dg.t.lane !== undefined) apply(dg.t, e.shiftKey ? -1 : 1);    // (a lane's step clicked: its next value)
  });
  let wheel = 0;
  root.addEventListener("wheel", (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(dy) >= 50) { apply(t, dy < 0 ? 1 : -1); wheel = 0; return; }
    wheel -= dy; const n = Math.trunc(wheel / 25); if (n) { wheel -= n * 25; apply(t, n); }
  }, { passive: false });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !S.d || e.metaKey || e.ctrlKey || e.altKey || (e.target.closest && e.target.closest("input, select, textarea"))) return;
    const t = target(e), k = e.key.toLowerCase(), far = { PageUp: 8, PageDown: -8 }[e.key], near = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (t && (far || near)) { apply(t, far || near); e.preventDefault(); return; }
    if (t && t.id !== undefined && (e.key === "Home" || e.key === "End")) { const p = par(t.id); ask(OP.VALUE, S.slot, t.id, e.key === "Home" ? p.lo : p.hi); e.preventDefault(); return; }
    if (/^[0-5]$/.test(e.key)) { S.group = Number(e.key); ask(); }
    else if (e.key === "ArrowLeft") pick(S.slot - 1);
    else if (e.key === "ArrowRight") pick(S.slot + 1);
    else if (k === "t") { const s = slot(), n = S.d.types.length; ask(OP.TYPE, S.slot, (s.type + (e.shiftKey ? n - 1 : 1)) % n); }
    else if (k === "b") { const s = slot(); ask(OP.BYPASS, S.slot, s.bypass ? 0 : 1); }
    else if (e.key === ",") move(-1);
    else if (e.key === ".") move(1);
    else if (k === "g") { S.group = 0; ask(OP.TRACK, (S.d.tgroup[S.d.sel] + (e.shiftKey ? 5 : 1)) % 6, 0, 0, S.d.sel); }
    else return;
    e.preventDefault();
  });
  // the picture: notes going through the group's chain, left to right, each effect doing to them what it does: an
  // ARP hands them on one at a time in its pattern's order, CHANCE lets some fall, REPEAT sends each again, HARM and
  // CHORD stack more on, TRANSPOSE lifts or drops them, RANDOM scatters them, MONO keeps one; an empty or bypassed
  // slot is passed by. Not the sound's timing: what the chain is, at a glance, and that it is alive
  const C = { bg: "#000", dim: "#4a4a4a", box: "#2e2c9b", on: "#706deb", sel: "#edf171", note: "#a9ff9f", cy: "#75cec8", red: "#c46c71", white: "#fff" };
  const pg = $("mf-pic").getContext("2d");
  const P = { notes: [], next: 0, arp: 0 };
  function through(n, s, k, t) {                            // note n passes slot k (s): what becomes of it -> the notes after
    const v = (name) => { const p = s.pages.flat().find((q) => q && q.name === name); return p ? p.v : 0; };
    const chance = v("CHANCE");
    if (s.pages.length && chance < 100 && Math.random() * 100 >= chance) return [n];   // (a miss: the note as it came)
    switch (S.d.types[s.type]) {
      case "ARP": { const o = s.order && s.order.length ? s.order : [0]; P.arp = (P.arp + 1) % o.length; return [{ ...n, y: 46 - o[P.arp] * 8, c: C.cy }]; }
      case "CHANCE": return Math.random() * 100 < chance ? [n] : [{ ...n, dead: t }];
      case "REPEAT": return [n, { ...n, x: n.x - 7, c: C.on }, { ...n, x: n.x - 14, c: C.box }];
      case "HARM": return [n, { ...n, y: n.y - 8 }, { ...n, y: n.y - 16 }];
      case "CHORD": return [n, { ...n, y: n.y - 7 }, { ...n, y: n.y - 13 }, { ...n, y: n.y - 20 }].slice(0, Math.max(1, Math.min(4, v("NOTES") || 3)));
      case "TRANSPOSE": return [{ ...n, y: n.y - Math.sign(v("SEMI") + 12 * v("OCT")) * 10 }];
      case "RANDOM": return [{ ...n, y: n.y + Math.round((Math.random() - 0.5) * 24) }];
      case "MONO": return P.notes.some((m) => m !== n && !m.dead && m.k === k && Math.abs(m.x - n.x) < 3) ? [{ ...n, dead: t }] : [n];
      default: return [n];
    }
  }
  function picture(t) {
    const d = S.d;
    pg.fillStyle = C.bg; pg.fillRect(0, 0, 320, 72);
    if (!d) return;
    const X = (k) => 22 + k * 36;
    pg.fillStyle = C.dim; for (let x = 0; x < 320; x += 4) pg.fillRect(x, 46, 2, 1);
    d.slots.forEach((s, k) => {
      const live = s.type && !s.bypass;
      pg.strokeStyle = k === S.slot ? C.sel : live ? C.on : C.dim;
      pg.strokeRect(X(k) + 0.5, 14.5, 27, 50);
      if (live) { pg.fillStyle = C.box; pg.fillRect(X(k) + 2, 16, 24, 6); }
      pg.fillStyle = live ? C.white : C.dim; pg.font = "8px monospace"; pg.fillText(s.type ? d.types[s.type].slice(0, 5) : "-", X(k) + 2, 10);
    });
    if (t > P.next) { P.next = t + 520; P.notes.push({ x: 0, y: 46, k: -1, c: C.note }); }
    const out = [];
    for (const n of P.notes) {
      if (n.dead) { if (t - n.dead < 400) { n.y += 1; out.push(n); } continue; }
      n.x += 1.4;
      const k = Math.floor((n.x - 22 - 13) / 36);
      if (k > n.k && k >= 0 && k < 8 && n.x >= X(k) + 13) {
        n.k = k;
        const s = d.slots[k];
        if (s.type && !s.bypass) { out.push(...through(n, s, k, t)); continue; }
      }
      if (n.x < 324) out.push(n);
    }
    P.notes = out.slice(-80);
    for (const n of P.notes) { pg.fillStyle = n.dead ? C.red : n.c; pg.fillRect(Math.round(n.x), Math.max(24, Math.min(62, Math.round(n.y))) - 1, 3, 3); }
  }
  const loop = (t) => { if (S.shown) { picture(t); requestAnimationFrame(loop); } };
  setInterval(() => { if (S.shown && !S.drag) ask(S.d ? OP.GET : OP.OPEN); }, 320);   // (not yet answered: the unit was still starting)
  return {
    show(on) {
      S.shown = on;
      if (!on) return;
      requestAnimationFrame(loop);
      if (!ctx.unit()) { $("mf-note").textContent = "MIDI FX are edited on the FM-1 in this browser. On a unit on USB: its own screen (THE FM-1)."; return; }
      S.was = ""; ask(OP.OPEN);
    },
  };
}
