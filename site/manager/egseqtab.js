// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager's SEQUENCE tab: the pattern open on the FM-1 as a piano roll (two pages, 32 steps, at a time; two octaves
// of pitch, scrolled), with lanes under it (velocity, any locked value, the sound lock, chance and condition) and an
// inspector of the steps picked: every field of a step and every lock (the sound's 119 values, the mix, the five
// rooms), the sound lock, the track's settings. Every change is the unit's own command at once (egseqedit.js); the page
// reads the unit again when its revision moves. Written for EvilGenius (MPL-2.0).
//   Mouse: click an empty cell to draw a note (a chord: another pitch on the same step); click a note to pick its step
//   (SHIFT adds steps); ALT-click (or right-click) a note to take it away; drag in the velocity or lock lane to set it
//   (ALT-click a lock: cleared). Keys (SEQUENCE shown, not typing): LEFT / RIGHT the step picked (SHIFT: add), DELETE
//   clear, [ ] length, - = velocity, PAGE UP / DOWN the pages shown, Z / X the octave, CMD + C / V copy / paste,
//   CMD + Z undo (SHIFT: redo) on the unit.
// STEPS (V switches): the track's eight pages as rows of sixteen big steps, as the unit's own pads. A click turns a step
// on or off (SHIFT + click picks it only); dragging sideways from a lit step, or its bar's end, sets its length (the
// unit's lengths, snapped); each row's [ and ] are the page's first and last steps, dragged; the row's number puts the
// page in the loop or out. Keys there: the arrows move the cursor (SHIFT picks along), ENTER turns the step on or off,
// [ ] its length, - = its velocity, , . the page's start / end at the cursor, L the page in the loop.
// Everywhere in SEQUENCE: 1..6 the track, V the view, P the patterns, R read again, M mute the track.
//   mountSeq({ $, log, say, refuse, link(), busy(), job(fn) }) -> { show(on), load(), poll(), render(), gone() }
import { SeqEditor } from "./egseqedit.js";
import { FIELD, TRIG_ON, TFIELD } from "./egsysex.js";
import { lockName, lockRange, lenName, condName, funcName, rateName, loopSteps, PM, NSTEP, PAGE, TRIG } from "./egseq.js";
import { LENS, CONDS, FUNCS, RATES, LOCKS } from "./egseqnames.js";
import { patternsOf, LAYOUT, SECTOR } from "./egstore.js";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const VIEW = 32, ROWS_MAX = 24, CW = 24, RH = 14;
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const opt = (sel, list, val) => { sel.textContent = ""; list.forEach(([v, t]) => { const o = el("option", "", t); o.value = String(v); sel.append(o); }); sel.value = String(val); };
const patName = (p) => `${"ABCD"[p >> 4]}${String((p & 15) + 1).padStart(2, "0")}`;

export function mountSeq(ctx) {
  const { $, say, refuse } = ctx;
  const S = { ed: null, page0: 0, low: 48, rows: ROWS_MAX, sel: new Set(), shown: false, lockId: 31, clip: null, dragging: null, cur: 0,
    view: (() => { try { return sessionStorage.getItem("eg-seqview") || "steps"; } catch (_) { return "steps"; } })() };
  const root = $("tab-seq");
  root.innerHTML = `
    <div class="sqtop">
      <label>PATTERN <select id="sq-pat" aria-label="The pattern the FM-1 goes to"></select></label>
      <button id="sq-read" class="key plain" type="button">READ</button>
      <button id="sq-undo" class="key plain" type="button" title="CMD + Z">UNDO</button>
      <button id="sq-redo" class="key plain" type="button" title="SHIFT + CMD + Z">REDO</button>
      <span class="seg" role="group" aria-label="The view (V)"><button id="sq-vsteps" class="key plain" type="button">STEPS</button><button id="sq-vroll" class="key plain" type="button">PIANO ROLL</button></span>
      <span id="sq-pages" class="seg" role="group" aria-label="The pages shown"></span>
      <span id="sq-state" class="dim"></span>
      <button id="sq-pats" class="key plain" type="button" aria-expanded="false">PATTERNS</button>
    </div>
    <div id="sq-patgrid" class="sqpats" hidden role="group" aria-label="The project's 64 patterns: a click goes there"></div>
    <div id="sq-tracks" class="sqtracks" role="group" aria-label="Tracks"></div>
    <p id="sq-note" class="dim">Connect an FM-1 to see its pattern.</p>
    <div id="sq-body" class="sqbody" hidden>
      <div class="sqmain">
        <div id="sq-stepsv" class="sqsteps" role="grid" aria-label="The track's eight pages of steps"></div>
        <div id="sq-rollv">
        <div class="sqroll">
          <div class="sqkeys" id="sq-keys" aria-hidden="true"></div>
          <div class="sqgrid" id="sq-grid" role="grid" aria-label="Steps and notes"></div>
        </div>
        <div class="sqoct"><button id="sq-up" class="key plain" type="button" aria-label="An octave up">OCT +</button><button id="sq-down" class="key plain" type="button" aria-label="An octave down">OCT -</button><span class="dim" id="sq-range"></span></div>
        <div class="sqlane"><span class="sqll">VELOCITY</span><div id="sq-vel" class="sqlv"></div></div>
        <div class="sqlane"><span class="sqll"><select id="sq-lockid" aria-label="The lock this lane shows"></select></span><div id="sq-lock" class="sqlv"></div></div>
        <div class="sqlane sqtext"><span class="sqll">SOUND LOCK</span><div id="sq-snd" class="sqlv"></div></div>
        <div class="sqlane sqtext"><span class="sqll">CHANCE · COND</span><div id="sq-cond" class="sqlv"></div></div>
        </div>
      </div>
      <aside class="sqinsp" id="sq-insp" aria-label="The steps picked"></aside>
    </div>`;
  const patSel = $("sq-pat");
  opt(patSel, Array.from({ length: 64 }, (_, p) => [p, patName(p)]), 0);
  opt($("sq-lockid"), LOCKS.map(([n], id) => [id, `${id < 119 ? "" : "MIX "}${n}${dup(n, id)}`]), S.lockId);
  function dup(n, id) { const k = LOCKS.filter(([m], j) => m === n && j < id).length; return k ? ` ${k + 1}` : ""; }

  const ed = () => S.ed;
  const ready = () => !!S.ed && !!S.ed.pat;
  function make() {
    if (S.ed && S.ed.link === ctx.link()) return S.ed;
    S.ed = new SeqEditor({ link: ctx.link(), log: ctx.log, onChange: () => render(), onError: (m) => refuse(m) });
    return S.ed;
  }
  async function load() {
    if (!ctx.link()) return;
    say("Reading the pattern", "busy");
    try { await make().load(); }
    catch (e) { S.ed = null; S.failed = true; render(); $("sq-note").textContent = e.message; if (e.old) say(e.message); else throw e; return; }
    S.failed = false;
    if (S.want !== undefined) { ed().track = S.want; S.want = undefined; }
    say(`Pattern ${patName(ed().pat.pattern)}: six tracks read.`, "ok");
    render();
  }

  // ---- drawing
  function render() {
    const on = !!ctx.link() && ready();
    $("sq-body").hidden = !on;
    for (const id of ["sq-read", "sq-undo", "sq-redo", "sq-pat"]) $(id).disabled = !ctx.link();
    if (!on) {
      $("sq-note").hidden = false; $("sq-tracks").textContent = "";
      if (!ctx.link()) $("sq-note").textContent = "Connect an FM-1 to see its pattern.";
      else if (!S.failed) $("sq-note").textContent = "Reading the FM-1's pattern as soon as it is free (or press READ).";
      return;
    }
    $("sq-note").hidden = true;
    const E = ed(), P = E.pat, ts = P.tracks[E.track].set;
    if (document.activeElement !== patSel) patSel.value = String(P.pattern);
    $("sq-state").textContent = `${patName(P.pattern)} · ${P.bpm} BPM · ${P.nlock} LOCKS${E.pending ? " · SENDING" : ""}`;
    // tracks
    const tr = $("sq-tracks");
    tr.textContent = "";
    P.tracks.forEach((t, k) => {
      const b = el("button", `key plain${k === E.track ? " on" : ""}`, `${k + 1} ${t.name || "-"}${t.set.mute ? " (MUTED)" : ""}`);
      b.type = "button"; b.setAttribute("aria-pressed", String(k === E.track));
      b.addEventListener("click", () => { E.track = k; S.sel.clear(); render(); });
      tr.append(b);
    });
    // pages: the two shown, the loop's
    const pg = $("sq-pages");
    pg.textContent = "";
    for (let p = 0; p < 8; p++) {
      const b = el("button", "key plain", String(p + 1));
      b.type = "button";
      b.setAttribute("aria-pressed", String(p === S.page0 || p === S.page0 + 1));
      b.title = (ts.loop >> p) & 1 ? `Page ${p + 1}: in the loop (${ts.pstart[p] + 1}..${ts.pend[p] + 1})` : `Page ${p + 1}: not in the loop`;
      b.classList.toggle("inloop", !!((ts.loop >> p) & 1));
      b.addEventListener("click", () => { S.page0 = Math.min(p, 6); render(); });
      pg.append(b);
    }
    const steps = S.view === "steps";
    $("sq-stepsv").hidden = !steps; $("sq-rollv").hidden = steps; $("sq-pages").hidden = steps;
    $("sq-vsteps").setAttribute("aria-pressed", String(steps)); $("sq-vroll").setAttribute("aria-pressed", String(!steps));
    if (steps) renderSteps(E, ts);
    else {
      // (as many pitch rows as the window has room for: 12 .. 24, the lanes and the bars above kept)
      const v = $("view"), above = $("sq-body").getBoundingClientRect().top - v.getBoundingClientRect().top;
      S.rows = Math.max(12, Math.min(ROWS_MAX, Math.floor((v.clientHeight - above - 230) / RH)));
      S.low = Math.min(S.low, 127 - S.rows + 1);
      renderRoll(E, ts); renderLanes(E);
    }
    renderInsp(E, ts);
  }
  const cols = () => Array.from({ length: VIEW }, (_, k) => S.page0 * PAGE + k);
  function renderRoll(E, ts) {
    const keys = $("sq-keys"), grid = $("sq-grid");
    keys.textContent = ""; grid.textContent = "";
    $("sq-range").textContent = `${noteName(S.low)}..${noteName(S.low + S.rows - 1)}`;
    const loop = new Set(loopSteps(ts));
    for (let r = S.rows - 1; r >= 0; r--) {
      const n = S.low + r, black = NAMES[n % 12].includes("#");
      const k = el("div", `sqk${black ? " b" : ""}`, n % 12 === 0 ? noteName(n) : "");
      keys.append(k);
      const row = el("div", `sqrow${black ? " b" : ""}`);
      row.style.top = `${(S.rows - 1 - r) * RH}px`;
      grid.append(row);
    }
    cols().forEach((s, c) => {
      const col = el("div", `sqcol${s % 4 === 0 ? " beat" : ""}${s % PAGE === 0 ? " page" : ""}${loop.has(s) ? "" : " out"}${S.sel.has(s) ? " sel" : ""}`);
      col.style.left = `${c * CW}px`;
      grid.append(col);
      const st = E.steps()[s];
      if (!st.on) return;
      const p = E.played(s), len = Math.max(1, Math.min(VIEW - c, Math.round((LENS[p.len] === "INF" ? 16 : lenEighths(p.len)) / 8)));
      for (const n of p.notes) {
        if (n < S.low || n >= S.low + S.rows) continue;
        const b = el("button", `sqn v${Math.min(3, Math.floor(p.vel / 32))}${S.sel.has(s) ? " sel" : ""}${st.locked ? " lk" : ""}`);
        b.type = "button";
        b.style.left = `${c * CW + 1}px`; b.style.top = `${(S.low + S.rows - 1 - n) * RH + 1}px`; b.style.width = `${len * CW - 2}px`;
        b.dataset.step = s; b.dataset.pitch = n;
        b.setAttribute("aria-label", `Step ${s + 1}, ${noteName(n)}, velocity ${p.vel}${st.locked ? ", locks" : ""}${p.sound ? `, sound lock ${p.sound}` : ""}`);
        grid.append(b);
      }
    });
    grid.style.width = `${VIEW * CW}px`; grid.style.height = `${S.rows * RH}px`;
  }
  function lenEighths(k) { const n = LENS[k]; if (!n || n === "INF") return 128; const [a, b] = n.split("/"); return Math.round((b ? +a / +b : +a) * 8); }
  // the length index nearest to a length in steps (INF only past the longest)
  const lenOf = (steps) => { let best = 0; for (let k = 0; k < LENS.length - 1; k++) if (Math.abs(lenEighths(k) / 8 - steps) < Math.abs(lenEighths(best) / 8 - steps)) best = k; return best; };
  // ---- STEPS: the eight pages, sixteen big steps a row
  function renderSteps(E, ts) {
    const box = $("sq-stepsv");
    box.textContent = "";
    const head = el("div", "sqsrow sqshead");
    head.append(el("span", "sqsl", "PAGE"));
    const nums = el("div", "sqspads");
    for (let k = 0; k < PAGE; k++) nums.append(el("span", "sqsn", String(k + 1)));
    head.append(nums);
    box.append(head);
    for (let pg = 0; pg < 8; pg++) {
      const inLoop = !!((ts.loop >> pg) & 1), a = ts.pstart[pg], z = ts.pend[pg];
      const row = el("div", `sqsrow${inLoop ? " in" : ""}`);
      const lab = el("button", `key plain sqsl${inLoop ? " on" : ""}`, `${pg + 1}`);
      lab.type = "button"; lab.setAttribute("aria-pressed", String(inLoop));
      lab.title = `Page ${pg + 1}: ${inLoop ? `in the loop, steps ${a + 1}..${z + 1}` : "not in the loop"} (L)`;
      lab.addEventListener("click", () => { const m = ts.loop ^ (1 << pg); if (m) E.setTrack(TFIELD.LOOP, m); else refuse("one page at least stays in the loop"); });
      const pads = el("div", "sqspads");
      pads.dataset.page = pg;
      for (let k = 0; k < PAGE; k++) {
        const s = pg * PAGE + k, st = E.steps()[s], p = st.on ? E.played(s) : null;
        const b = el("button", `sqs${st.on ? " on" : ""}${k < a || k > z || !inLoop ? " out" : ""}${S.sel.has(s) ? " sel" : ""}${s === S.cur ? " cur" : ""}${st.locked ? " lk" : ""}${k % 4 === 0 ? " beat" : ""}`);
        b.type = "button"; b.dataset.step = s; b.tabIndex = -1;
        b.setAttribute("aria-label", `Step ${s + 1}${st.on ? `, on, velocity ${p.vel}, length ${LENS[p.len]}${st.locked ? ", locks" : ""}` : ", off"}`);
        if (p) { b.style.setProperty("--v", (p.vel / 127).toFixed(2)); b.append(el("span", "sqsv")); }
        pads.append(b);
      }
      // the lengths: a bar from each lit step, its end a handle
      for (let k = 0; k < PAGE; k++) {
        const s = pg * PAGE + k;
        if (!E.steps()[s].on) continue;
        const p = E.played(s), len = LENS[p.len] === "INF" ? PAGE - k : lenEighths(p.len) / 8;
        const bar = el("span", `sqslen${len > PAGE - k ? " more" : ""}`);
        bar.style.left = `calc(${(k / PAGE) * 100}% + 4px)`;
        bar.style.width = `calc(${(Math.min(len, PAGE - k) / PAGE) * 100}% - 8px)`;
        bar.dataset.step = s;
        bar.title = `Step ${s + 1}: length ${LENS[p.len]} (drag its end)`;
        const h = el("i", "sqslh"); h.dataset.step = s;
        bar.append(h);
        pads.append(bar);
      }
      // the page's first and last steps
      for (const [which, at] of [["start", a], ["end", z]]) {
        const m = el("span", `sqsm ${which}`, which === "start" ? "[" : "]");
        m.dataset.page = pg; m.dataset.which = which;
        m.style.left = which === "start" ? `${(at / PAGE) * 100}%` : `calc(${((at + 1) / PAGE) * 100}% - 12px)`;
        m.title = `Page ${pg + 1}'s ${which === "start" ? "first" : "last"} step: ${at + 1} (drag it; ${which === "start" ? "," : "."} at the cursor)`;
        pads.append(m);
      }
      row.append(lab, pads);
      box.append(row);
    }
  }
  // the pointer on STEPS: a step's column under it (0..15, fractional)
  const colAt = (pads, x) => { const r = pads.getBoundingClientRect(); return ((x - r.left) / r.width) * PAGE; };
  // (the drag is the container's: a change draws the rows again under the pointer)
  $("sq-stepsv").addEventListener("pointerdown", (e) => {
    if (!ready() || e.button !== 0) return;
    const E = ed(), ts = E.pat.tracks[E.track].set, box = $("sq-stepsv");
    const marker = e.target.closest(".sqsm"), handle = e.target.closest(".sqslh"), pad = e.target.closest(".sqs");
    const pads0 = e.target.closest(".sqspads");
    if (!pads0 || pads0.dataset.page === undefined) return;
    const pg = +pads0.dataset.page, padsNow = () => box.querySelector(`.sqspads[data-page="${pg}"]`) || pads0;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    const end = (fn) => { box.onpointerup = (ev) => { box.onpointermove = null; box.onpointerup = null; S.dragging = null; fn(ev); }; };
    if (marker) {                                   // a page's start / end, dragged
      const which = marker.dataset.which;
      S.dragging = "marker";
      box.onpointermove = (ev) => {
        const c = Math.max(0, Math.min(PAGE - 1, Math.floor(colAt(padsNow(), ev.clientX))));
        if (which === "start") { const a = Math.min(c, ts.pend[pg]); if (a !== ts.pstart[pg]) E.setTrack(TFIELD.PSTART, (pg << 4) | a); }
        else { const z = Math.max(c, ts.pstart[pg]); if (z !== ts.pend[pg]) E.setTrack(TFIELD.PEND, (pg << 4) | z); }
      };
      end(() => say(`Page ${pg + 1}: steps ${ts.pstart[pg] + 1}..${ts.pend[pg] + 1}.`));
      return;
    }
    const s = +(handle ? handle.dataset.step : pad ? pad.dataset.step : -1);
    if (s < 0) return;
    const k = s - pg * PAGE, x0 = e.clientX;
    let moved = !!handle;
    S.cur = s;
    const lengthTo = (ev) => {
      const steps = Math.max(1 / 8, colAt(padsNow(), ev.clientX) - k);
      const on = S.sel.has(s) && S.sel.size > 1 ? [...S.sel].filter((x) => E.steps()[x].on) : [s];
      const li = lenOf(steps);
      if (E.steps()[s].on && E.played(s).len !== li) E.setField(on, FIELD.LEN, li);
    };
    box.onpointermove = (ev) => {
      if (!moved && Math.abs(ev.clientX - x0) > 8 && E.steps()[s].on) moved = true;
      if (moved) { S.dragging = "length"; lengthTo(ev); }
    };
    end((ev) => {
      if (moved) { lengthTo(ev); say(`Step ${s + 1}: length ${LENS[E.played(s).len]}.`); render(); return; }
      if (ev.shiftKey) { if (S.sel.has(s)) S.sel.delete(s); else S.sel.add(s); render(); return; }
      S.sel.clear(); S.sel.add(s);
      toggle(s);
    });
  });
  function toggle(s) {
    const E = ed();
    if (E.steps()[s].on) E.clear([s]); else E.setField([s], FIELD.TRIG, TRIG_ON);
    render();
  }
  function renderLanes(E) {
    const vel = $("sq-vel"), lk = $("sq-lock"), snd = $("sq-snd"), cond = $("sq-cond");
    for (const x of [vel, lk, snd, cond]) { x.textContent = ""; x.style.width = `${VIEW * CW}px`; }
    const [lo, hi] = lockRange(S.lockId) || [0, 127];
    cols().forEach((s, c) => {
      const st = E.steps()[s];
      if (!st.on) return;
      const p = E.played(s), x = `${c * CW + 4}px`;
      const v = el("i", `sqbar${S.sel.has(s) ? " sel" : ""}`); v.style.left = x; v.style.height = `${Math.round(p.vel / 127 * 40)}px`; vel.append(v);
      const l = E.locksAt(s).find((y) => y.id === S.lockId);
      if (l) { const b = el("i", "sqbar lock"); b.style.left = x; b.style.height = `${Math.max(2, Math.round((l.value - lo) / Math.max(1, hi - lo) * 40))}px`; b.title = `${lockName(S.lockId)} ${l.value}`; lk.append(b); }
      if (p.sound) { const t = el("span", "sqtag snd", `P${p.sound}`); t.style.left = x; snd.append(t); }
      if (p.cond || p.chance < 100) { const t = el("span", "sqtag", `${p.chance < 100 ? `${p.chance}%` : ""}${p.cond ? ` ${condName(p.cond)}` : ""}`.trim()); t.style.left = x; cond.append(t); }
    });
  }
  // ---- the inspector: every field of the steps picked, their locks, the track
  function field(label, node) { const w = el("label", "sqf"); w.append(el("span", "", label), node); return w; }
  function numIn(v, lo, hi, on) { const i = el("input"); i.type = "number"; i.min = lo; i.max = hi; i.value = v; i.addEventListener("change", () => { const x = Math.max(lo, Math.min(hi, Math.round(+i.value))); i.value = x; on(x); }); return i; }
  function selIn(list, v, on) { const s = el("select"); opt(s, list, v); s.addEventListener("change", () => on(+s.value)); return s; }
  function renderInsp(E, ts) {
    const box = $("sq-insp");
    if (box.contains(document.activeElement) && document.activeElement.tagName !== "BUTTON") return;   // (typing: drawn after)
    box.textContent = "";
    const steps = [...S.sel].sort((a, b) => a - b), s0 = steps[0];
    if (steps.length && E.steps()[s0].on) {
      const p = E.played(s0), set = (f) => (v) => E.setField(steps, f, v);
      box.append(el("h3", "", `STEP${steps.length > 1 ? "S" : ""} ${steps.map((s) => s + 1).join(" · ")}`));
      box.append(el("p", "dim", `NOTES ${p.notes.map(noteName).join(" ")}`));
      const fg = el("div", "sqfgrid"); box.append(fg);
      fg.append(field("TRIG", selIn(TRIG.slice(1).map((t, k) => [k + 1, t]), p.type, set(FIELD.TRIG))),
        field("VELOCITY", numIn(p.vel, 1, 127, set(FIELD.VEL))),
        field("LENGTH", selIn(LENS.map((n, k) => [k, n]), p.len, set(FIELD.LEN))),
        field("MICRO /24", numIn(p.micro, -23, 23, set(FIELD.MICRO))),
        field("RATCHET", numIn(p.ratch, 1, 8, (v) => E.setField(steps, FIELD.RATCH, v | (p.ramp << 4)))),
        field("RAMP", selIn(["FLAT", "UP", "DOWN", "ACCENT"].map((n, k) => [k, n]), p.ramp, (v) => E.setField(steps, FIELD.RATCH, p.ratch | (v << 4)))),
        field("CHANCE %", numIn(p.chance, 0, 100, set(FIELD.CHANCE))),
        field("CONDITION", selIn(CONDS.map((n, k) => [k, n]), p.cond, set(FIELD.COND))),
        field("STRUM /24", numIn(p.strum, 0, 23, set(FIELD.STRUM))),
        field("FUNCTION", selIn(FUNCS.map((n, k) => [k, n]), p.func, set(FIELD.FUNC))),
        field("SOUND LOCK (POOL)", numIn(p.sound, 0, 128, set(FIELD.SOUND))));
      const reset = el("button", "key plain", "BACK TO THE TRACK'S"); reset.type = "button";
      reset.addEventListener("click", () => { for (const pm of [PM.VEL, PM.LEN, PM.MICRO, PM.RATCH, PM.CHANCE, PM.COND, PM.STRUM]) E.setField(steps, FIELD.RESET, pm); });
      const clr = el("button", "key warn", "CLEAR"); clr.type = "button"; clr.addEventListener("click", () => { E.clear(steps); S.sel.clear(); });
      const row = el("div", "keys"); row.append(reset, clr); box.append(row);
      // locks: the first step's, set on all picked
      box.append(el("h3", "", `LOCKS (${E.locksAt(s0).length})`));
      for (const l of E.locksAt(s0)) {
        const [lo, hi] = lockRange(l.id);
        const r = el("div", "sqlk");
        r.append(el("span", "", lockName(l.id)), numIn(l.value, lo, hi, (v) => E.setLock(steps, l.id, v)));
        const x = el("button", "key plain", "×"); x.type = "button"; x.setAttribute("aria-label", `Unlock ${lockName(l.id)}`);
        x.addEventListener("click", () => E.clearLock(steps, l.id));
        r.append(x); box.append(r);
      }
      const add = el("div", "sqlk");
      const which = el("select"); opt(which, LOCKS.map(([n], id) => [id, n + dup(n, id)]), S.lockId);
      const val = el("input"); val.type = "number"; val.value = LOCKS[S.lockId][1];
      which.addEventListener("change", () => { val.min = LOCKS[+which.value][1]; val.max = LOCKS[+which.value][2]; val.value = LOCKS[+which.value][1]; });
      const go = el("button", "key go", "LOCK"); go.type = "button";
      go.addEventListener("click", () => { const id = +which.value, [lo, hi] = lockRange(id); E.setLock(steps, id, Math.max(lo, Math.min(hi, Math.round(+val.value)))); });
      add.append(which, val, go); box.append(add);
      if (E.locksAt(s0).length) { const ca = el("button", "key plain", "UNLOCK ALL"); ca.type = "button"; ca.addEventListener("click", () => E.clearLocks(steps)); box.append(ca); }
    } else box.append(el("p", "dim", S.view === "steps" ? "Click a step to turn it on or off (SHIFT + click: pick it). Drag a lit step sideways for its length; drag a row's [ and ] for the page's first and last step; its number puts it in the loop."
      : "Click a note to pick its step (SHIFT: more). Click an empty cell to draw one."));
    // the track
    box.append(el("h3", "", `TRACK ${E.track + 1}`));
    const loops = el("div", "seg");
    for (let p = 0; p < 8; p++) {
      const b = el("button", "key plain", String(p + 1)); b.type = "button"; b.setAttribute("aria-pressed", String(!!((ts.loop >> p) & 1)));
      b.title = `Page ${p + 1} in the loop`;
      b.addEventListener("click", () => { const m = ts.loop ^ (1 << p); if (m) E.setTrack(TFIELD.LOOP, m); });
      loops.append(b);
    }
    box.append(field("LOOP PAGES", loops));
    const tg = el("div", "sqfgrid"); box.append(tg);
    tg.append(
      field("RATE", selIn(RATES.map((n, k) => [k, n]), ts.rate, (v) => E.setTrack(TFIELD.RATE, v))),
      field("TRANSPOSE", numIn(ts.transpose, -48, 48, (v) => E.setTrack(TFIELD.TRANSPOSE, v))),
      field(`PAGE ${S.page0 + 1} START`, numIn(ts.pstart[S.page0] + 1, 1, 16, (v) => E.setTrack(TFIELD.PSTART, (S.page0 << 4) | (v - 1)))),
      field(`PAGE ${S.page0 + 1} END`, numIn(ts.pend[S.page0] + 1, 1, 16, (v) => E.setTrack(TFIELD.PEND, (S.page0 << 4) | (v - 1)))));
    const mute = el("button", `key ${ts.mute ? "warn" : "plain"}`, ts.mute ? "MUTED" : "MUTE"); mute.type = "button";
    mute.addEventListener("click", () => E.setTrack(TFIELD.MUTE, ts.mute ? 0 : 1));
    box.append(mute);
  }

  // ---- phase 4's overview: the project's 64 patterns, which have content (the store's projects' sectors, read: no
  // command is new); a click sends the unit there (GO TO PATTERN), and the page edits it
  async function readPatterns() {
    const l = ctx.link(), st = await l.status();
    say("Reading the project's patterns", "busy");
    const bytes = await l.read(LAYOUT.prj.base, LAYOUT.prj.base + LAYOUT.prj.nsec * SECTOR, () => {});
    S.pats = { project: st.project, list: patternsOf(bytes, st.project) };
    say(`Project ${st.project}: ${S.pats.list.filter((p) => p.used).length} patterns with steps (as last saved).`, "ok");
    renderPats();
  }
  function renderPats() {
    const g = $("sq-patgrid");
    g.textContent = "";
    if (!S.pats) { g.append(el("p", "dim", "Reading ..")); return; }
    const cur = ready() ? ed().pat.pattern : -1;
    for (let k = 0; k < 64; k++) {
      const p = S.pats.list[k], b = el("button", `key plain${p.used ? " used" : ""}${k === cur ? " on" : ""}`, patName(k));
      b.type = "button";
      b.title = `${patName(k)}: ${p.used ? "has steps" : "empty"}${k === cur ? " (open)" : ""}`;
      b.addEventListener("click", () => ctx.job(async () => {
        const a = await make().gotoPattern(k);
        if (!a || a.status) refuse(`the FM-1 did not go to ${patName(k)}`);
        else say(a.b === 2 ? `The FM-1 goes to ${patName(k)} at the end of this one.` : `The FM-1 is on ${patName(k)}.`, "ok");
        renderPats();
      }));
      g.append(b);
    }
  }
  $("sq-pats").addEventListener("click", () => {
    const g = $("sq-patgrid"), open = g.hidden;
    g.hidden = !open;
    $("sq-pats").setAttribute("aria-expanded", String(open));
    if (open) { renderPats(); ctx.job(readPatterns); }
  });

  // ---- the mouse
  const at = (e, node) => { const r = node.getBoundingClientRect(); return { c: Math.floor((e.clientX - r.left) / CW), y: e.clientY - r.top }; };
  $("sq-grid").addEventListener("pointerdown", (e) => {
    if (!ready() || e.button > 2) return;
    const E = ed(), n = e.target.closest(".sqn");
    if (n) {
      const s = +n.dataset.step, pitch = +n.dataset.pitch;
      if (e.altKey || e.button === 2) { E.removeNote(s, pitch); S.sel.delete(s); return; }
      if (!e.shiftKey) S.sel.clear();
      S.sel.add(s);
      render();
      return;
    }
    if (e.button !== 0) return;
    const { c, y } = at(e, $("sq-grid")), s = S.page0 * PAGE + c, pitch = S.low + S.rows - 1 - Math.floor(y / RH);
    if (c < 0 || c >= VIEW || pitch < 0 || pitch > 127) return;
    E.addNote(s, pitch);
    if (!e.shiftKey) S.sel.clear();
    S.sel.add(s);
  });
  $("sq-grid").addEventListener("contextmenu", (e) => e.preventDefault());
  function laneDrag(node, value) {
    node.addEventListener("pointerdown", (e) => {
      if (!ready()) return;
      node.setPointerCapture(e.pointerId);
      const apply = (ev) => {
        const { c, y } = at(ev, node), s = S.page0 * PAGE + c;
        if (c < 0 || c >= VIEW || !ed().steps()[s].on) return;
        value(s, Math.max(0, Math.min(1, 1 - (y - 4) / 40)), ev);
      };
      apply(e);
      node.onpointermove = (ev) => { if (ev.buttons) apply(ev); };
      node.onpointerup = () => { node.onpointermove = null; };
    });
  }
  laneDrag($("sq-vel"), (s, f) => ed().setField([s], FIELD.VEL, Math.max(1, Math.round(f * 127))));
  laneDrag($("sq-lock"), (s, f, ev) => {
    const [lo, hi] = lockRange(S.lockId);
    if (ev.altKey) ed().clearLock([s], S.lockId); else ed().setLock([s], S.lockId, Math.round(lo + f * (hi - lo)));
  });
  $("sq-lockid").addEventListener("change", () => { S.lockId = +$("sq-lockid").value; render(); });
  $("sq-up").addEventListener("click", () => { S.low = Math.min(127 - S.rows + 1, S.low + 12); render(); });
  $("sq-down").addEventListener("click", () => { S.low = Math.max(0, S.low - 12); render(); });
  $("sq-read").addEventListener("click", () => ctx.job(load));
  const setView = (v) => { S.view = v; try { sessionStorage.setItem("eg-seqview", v); } catch (_) { /* (none) */ } render(); };
  $("sq-vsteps").addEventListener("click", () => setView("steps"));
  $("sq-vroll").addEventListener("click", () => setView("roll"));
  $("sq-undo").addEventListener("click", () => ctx.job(async () => { const a = await ed().undo(false); say(a && !a.status ? "Undone on the FM-1." : "Nothing to undo on the FM-1."); }));
  $("sq-redo").addEventListener("click", () => ctx.job(async () => { const a = await ed().undo(true); say(a && !a.status ? "Redone on the FM-1." : "Nothing to redo on the FM-1."); }));
  patSel.addEventListener("change", () => ctx.job(async () => {
    const p = +patSel.value, a = await make().gotoPattern(p);
    if (!a || a.status) refuse(`the FM-1 did not go to ${patName(p)} (${a ? a.statusName : "no answer"})`);
    else say(a.b === 2 ? `The FM-1 goes to ${patName(p)} at the end of this one.` : `The FM-1 is on ${patName(p)}.`, "ok");
  }));

  // ---- the keys
  const typing = (e) => e.target.closest && e.target.closest("input, select, textarea");
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !ready() || typing(e)) return;
    const E = ed(), steps = [...S.sel].sort((a, b) => a - b), cmd = e.metaKey || e.ctrlKey;
    const done = () => { e.preventDefault(); render(); };
    if (cmd && e.key.toLowerCase() === "z") { ctx.job(() => E.undo(e.shiftKey)); return done(); }
    if (cmd && e.key.toLowerCase() === "c" && steps.length) {
      const first = steps[0], last = steps[steps.length - 1];
      S.clip = { steps: E.steps().slice(first, last + 1).map((x) => ({ ...x, slots: x.slots.slice() })),
        locks: E.pat.tracks[E.track].locks.filter((l) => l.step >= first && l.step <= last).map((l) => ({ ...l, step: l.step - first })) };
      say(`Copied steps ${first + 1}..${last + 1}.`); return done();
    }
    if (cmd && e.key.toLowerCase() === "v" && S.clip && steps.length) { E.paste(steps[0], S.clip.steps, S.clip.locks); say(`Pasted at step ${steps[0] + 1}.`); return done(); }
    if (cmd || e.altKey) return;
    const k1 = e.key.toLowerCase(), ts = E.pat.tracks[E.track].set;
    if (/^[1-6]$/.test(e.key)) { E.track = +e.key - 1; S.sel.clear(); return done(); }
    if (k1 === "v") { setView(S.view === "steps" ? "roll" : "steps"); return done(); }
    if (k1 === "p") { $("sq-pats").click(); return done(); }
    if (k1 === "r") { ctx.job(load); return done(); }
    if (k1 === "m") { E.setTrack(TFIELD.MUTE, ts.mute ? 0 : 1); return done(); }
    if (S.view === "steps") {                       // the cursor's keys
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -PAGE, ArrowDown: PAGE }[e.key];
      if (d) {
        S.cur = Math.max(0, Math.min(NSTEP - 1, S.cur + d));
        if (!e.shiftKey) S.sel.clear();
        S.sel.add(S.cur);
        return done();
      }
      const pg = S.cur >> 4, c = S.cur & 15;
      if (e.key === "Enter") { toggle(S.cur); return done(); }
      if (e.key === ",") { E.setTrack(TFIELD.PSTART, (pg << 4) | Math.min(c, ts.pend[pg])); return done(); }
      if (e.key === ".") { E.setTrack(TFIELD.PEND, (pg << 4) | Math.max(c, ts.pstart[pg])); return done(); }
      if (k1 === "l") { const m = ts.loop ^ (1 << pg); if (m) E.setTrack(TFIELD.LOOP, m); return done(); }
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const d = e.key === "ArrowRight" ? 1 : -1, s = Math.max(0, Math.min(NSTEP - 1, (steps.length ? (d > 0 ? steps[steps.length - 1] : steps[0]) : S.page0 * PAGE - d) + d));
      if (!e.shiftKey) S.sel.clear();
      S.sel.add(s);
      if (s < S.page0 * PAGE || s >= S.page0 * PAGE + VIEW) S.page0 = Math.min(6, Math.floor(s / PAGE));
      return done();
    }
    if (e.key === "PageDown" || e.key === "PageUp") { S.page0 = Math.max(0, Math.min(6, S.page0 + (e.key === "PageDown" ? 2 : -2))); return done(); }
    if (S.view === "roll" && (e.key.toLowerCase() === "x" || e.key.toLowerCase() === "z")) { S.low = Math.max(0, Math.min(127 - S.rows + 1, S.low + (e.key.toLowerCase() === "x" ? 12 : -12))); return done(); }
    const on = steps.filter((s) => E.steps()[s].on);
    if (!on.length) return;
    const p = E.played(on[0]);
    if (e.key === "Delete" || e.key === "Backspace") { E.clear(on); S.sel.clear(); return done(); }
    if (e.key === "[" || e.key === "]") { E.setField(on, FIELD.LEN, Math.max(0, Math.min(LENS.length - 1, p.len + (e.key === "]" ? 1 : -1)))); return done(); }
    if (e.key === "-" || e.key === "=") { E.setField(on, FIELD.VEL, Math.max(1, Math.min(127, p.vel + (e.key === "=" ? 8 : -8)))); return done(); }
  });

  window.addEventListener("resize", () => { if (S.shown && ready()) render(); });
  return {
    load, render,
    show(v) { S.shown = v; if (v && ctx.link() && !ready()) ctx.job(load); },
    async poll() {
      if (!S.shown || !ctx.link() || ctx.busy()) return;
      if (!ready()) { if (!S.failed) await ctx.job(load); return; }      // (shown while the page was busy: read now)
      if (await ed().poll()) say("The FM-1's pattern changed: read again.");
    },
    gone() { S.ed = null; S.failed = false; S.sel.clear(); render(); },
    track(t) { S.want = t; if (ready()) { ed().track = t; S.sel.clear(); render(); } },
    state: S,
  };
}
