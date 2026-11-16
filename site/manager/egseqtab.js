// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The manager's SEQUENCE screen: the pattern open on the FM-1 in three views (the design canvas's 09 STEPS, 10 PIANO
// ROLL, 11 TRACKS), every change the unit's own command at once (egseqedit.js), the unit read again when its revision
// moves. Written for EvilGenius (MPL-2.0).
//
// TRACKS: the six tracks a row each, lined up in time (a track's rate sets its steps' width), each track's loop and page
// ends drawn; scroll (and SHIFT + scroll) left and right, CMD / CTRL + scroll or - + to zoom, SHOW 1 2 4 8 PAGES, the
// whole pattern in a strip under it (a click goes there); M mutes a track.
// STEPS: the picked track's eight pages as rows of sixteen big steps; each row's red [ ] the page's first and last step
// (dragged), its number the page in the loop or out; a picked step's length a band through the steps it lasts into; a
// chromatic keyboard under them: the picked steps' notes lit, a key adds or takes away its note on them; nothing picked,
// the keys held become the next new step's notes.
// PIANO ROLL: notes in time and pitch; scroll: pitch, SHIFT + scroll: time, CMD / CTRL + scroll: zoom time, ALT + scroll
// or a drag on the keys: zoom pitch; a note's right end dragged: its length; three lanes under it, each any value.
//
// In every view (the canvas's rules): a click picks a step, CMD / CTRL + click adds or takes one away, SHIFT + click picks
// a run; a double-click (or ALT + click) makes a step or takes it away; the EDIT mode (NOTE VEL LEN MICRO RATCH CHANCE
// COND FUNC SOUND, three lock slots each any value) is what a drag up / down inside a step changes, on every step picked,
// and what every step shows (a fill and a number). Names: a step's note, or its chord's (C, Cm, G7 ..).
//   mountSeq({ $, log, say, refuse, link(), busy(), job(fn) }) -> { show(on), load(), poll(), render(), gone(), track(t) }
//   chordName(notes), nearestLen(steps), rateSixteenths(code) (no DOM: the tests)
import { SeqEditor } from "./egseqedit.js";
import { FIELD, TRIG_ON, TFIELD } from "./egsysex.js";
import { lockName, lockRange, condName, PM, NSTEP, PAGE, TRIG } from "./egseq.js";
import { LENS, CONDS, FUNCS, RATES, LOCKS } from "./egseqnames.js";
import { patternsOf, LAYOUT, SECTOR } from "./egstore.js";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PC = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = (n) => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const btn = (cls, txt, fn, title) => { const b = el("button", cls, txt); b.type = "button"; if (title) b.title = title; if (fn) b.addEventListener("click", fn); return b; };
const opt = (sel, list, val) => { sel.textContent = ""; list.forEach(([v, t]) => { const o = el("option", "", t); o.value = String(v); sel.append(o); }); sel.value = String(val); };
const patName = (p) => `${"ABCD"[p >> 4]}${String((p & 15) + 1).padStart(2, "0")}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const store = { get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* (none: this page only) */ } } };

// a step's notes as a name: one note its own, a chord its chord's when known (else "3 NOTES")
const CHORDS = { "0,7": "5", "0,4,7": "", "0,3,7": "m", "0,4,7,10": "7", "0,4,7,11": "MAJ7", "0,3,7,10": "m7", "0,2,7": "SUS2", "0,5,7": "SUS4",
  "0,3,6": "DIM", "0,4,8": "AUG", "0,3,6,9": "DIM7", "0,3,6,10": "m7b5", "0,4,7,9": "6", "0,3,7,9": "m6", "0,2,4,7": "ADD9", "0,2,4,7,10": "9" };
export function chordName(notes) {
  if (!notes.length) return "";
  if (notes.length === 1) return noteName(notes[0]);
  const s = notes.slice().sort((a, b) => a - b), root = s[0];
  const iv = [...new Set(s.map((m) => (m - root) % 12))].sort((a, b) => a - b).join(",");
  return CHORDS[iv] !== undefined ? PC[root % 12] + CHORDS[iv] : `${notes.length} NOTES`;
}
// a length index's steps (LENS: "1/8" .. "128", "INF"), and the index nearest a length in steps
const lenSteps = (k) => { const n = LENS[k]; if (!n || n === "INF") return NSTEP; const [a, b] = n.split("/"); return b ? +a / +b : +a; };
export function nearestLen(steps) { let best = 0; for (let k = 0; k < LENS.length - 1; k++) if (Math.abs(lenSteps(k) - steps) < Math.abs(lenSteps(best) - steps)) best = k; return best; }
// a rate's step in sixteenths (RATES: "1/16" one, "1/8" two, "." half again, "T" two thirds)
export function rateSixteenths(code) {
  const n = RATES[code] || "1/16", m = /^1\/(\d+)/.exec(n), base = m ? 16 / +m[1] : 1;
  return n.endsWith(".") ? base * 1.5 : n.endsWith("T") ? (base * 2) / 3 : base;
}

export function mountSeq(ctx) {
  const { $, say, refuse } = ctx;
  const S = { ed: null, sel: new Set(), anchor: -1, cur: 0, shown: false, clip: null, drag: null, failed: false, want: undefined, pats: null,
    view: store.get("eg-seqview2", "steps"), mode: store.get("eg-seqmode", 1), slots: store.get("eg-seqslots", [31, 32, 125]),
    lanes: store.get("eg-seqlanes", ["VEL", 31, "CHANCE"]), names: store.get("eg-seqnames", true), held: [], oct: 3, inspect: false,
    roll: { top: 72, rh: 14, cw: 26, x0: 0 }, trk: { cw: 0, x0: 0 }, keysDown: new Map() };
  const root = $("tab-seq");
  root.innerHTML = `
    <div class="sqtop">
      <label>PATTERN <select id="sq-pat" aria-label="The pattern the FM-1 goes to"></select></label>
      <span class="seg" id="sq-views" role="group" aria-label="The view (SHIFT + V)"></span>
      <span class="seg" id="sq-tracks" role="group" aria-label="Tracks (1..6)"></span>
      <label>RATE <select id="sq-rate" aria-label="The track's rate"></select></label>
      <button id="sq-names" class="key plain" type="button" title="SHIFT + N"></button>
      <span id="sq-state" class="dim"></span>
      <span class="sqright">
        <button id="sq-read" class="key plain" type="button" title="SHIFT + R">READ</button>
        <button id="sq-undo" class="key plain" type="button" title="CMD + Z">UNDO</button>
        <button id="sq-redo" class="key plain" type="button" title="SHIFT + CMD + Z">REDO</button>
        <button id="sq-pats" class="key plain" type="button" aria-expanded="false" title="SHIFT + P">PATTERNS</button>
        <button id="sq-inspb" class="key plain" type="button" aria-pressed="false" title="SHIFT + I">INSPECT</button>
      </span>
    </div>
    <div id="sq-patgrid" class="sqpats" hidden role="group" aria-label="The project's 64 patterns: a click goes there"></div>
    <div id="sq-modes" class="sqmodes" role="group" aria-label="What a drag in a step changes (TAB; SHIFT + 1 .. =)"></div>
    <p id="sq-note" class="dim">Connect an FM-1 to see its pattern.</p>
    <div id="sq-body" class="sqbody" hidden>
      <div class="sqmain" id="sq-main">
        <div id="sq-tracksv" class="sqtv" hidden></div>
        <div id="sq-stepsv" class="sqsteps" role="grid" aria-label="The track's eight pages of steps" hidden></div>
        <div id="sq-rollv" class="sqrv" hidden></div>
      </div>
      <aside class="sqinsp" id="sq-insp" aria-label="The steps picked" hidden></aside>
    </div>
    <div id="sq-sel" class="sqsel" hidden></div>
    <div id="sq-kb" class="sqkb" hidden></div>`;
  const patSel = $("sq-pat");
  opt(patSel, Array.from({ length: 64 }, (_, p) => [p, patName(p)]), 0);
  opt($("sq-rate"), RATES.map((n, k) => [k, n]), 9);
  for (const [v, t] of [["tracks", "TRACKS"], ["steps", "STEPS"], ["roll", "PIANO ROLL"]]) {
    const b = btn("key plain", t, () => setView(v)); b.dataset.v = v; $("sq-views").append(b);
  }

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
  const setView = (v) => { S.view = v; store.set("eg-seqview2", v); render(); };
  const pickTrack = (t) => { if (!ready() || ed().track === t) return; ed().track = t; S.sel.clear(); S.anchor = -1; render(); };

  // ---- the modes: what a drag changes and what each step shows
  function modes() {
    const list = [
      { name: "NOTE", note: true, min: 0, max: 127, px: 6, get: (p) => p.notes[0], text: (v, p) => chordName(p.notes), help: "TRANSPOSE ITS NOTES" },
      { name: "VEL", f: FIELD.VEL, min: 1, max: 127, px: 1.5, get: (p) => p.vel, text: (v) => String(v), help: "VELOCITY" },
      { name: "LEN", f: FIELD.LEN, min: 0, max: LENS.length - 1, px: 10, get: (p) => p.len, text: (v) => LENS[v], help: "LENGTH (THE BAND SHOWS IT)" },
      { name: "MICRO", f: FIELD.MICRO, min: -23, max: 23, px: 4, get: (p) => p.micro, text: (v) => (v > 0 ? "+" : "") + v, help: "MICRO TIMING, 24THS OF A STEP" },
      { name: "RATCH", f: FIELD.RATCH, min: 1, max: 8, px: 14, get: (p) => p.ratch, text: (v) => `x${v}`, enc: (v, p) => v | (p.ramp << 4), help: "RATCHETS" },
      { name: "CHANCE", f: FIELD.CHANCE, min: 0, max: 100, px: 2, get: (p) => p.chance, text: (v) => `${v}%`, help: "CHANCE" },
      { name: "COND", f: FIELD.COND, min: 0, max: CONDS.length - 1, px: 8, get: (p) => p.cond, text: (v) => condName(v), help: "CONDITION (FILL, PRE, 1:2 ..)" },
      { name: "FUNC", f: FIELD.FUNC, min: 0, max: FUNCS.length - 1, px: 8, get: (p) => p.func, text: (v) => (v ? FUNCS[v] : "-"), help: "THE STEP FUNCTION (RESTART, REVERSE, JUMP ..)" },
      { name: "SOUND", f: FIELD.SOUND, min: 0, max: 128, px: 6, get: (p) => p.sound, text: (v) => (v ? `P${String(v).padStart(2, "0")}` : "-"), help: "SOUND LOCK: A POOL SOUND ON THIS STEP (0 NONE)" },
    ];
    S.slots.forEach((id, i) => {
      const [lo, hi] = lockRange(id) || [0, 127];
      list.push({ name: lockName(id), lock: id, slot: i, min: lo, max: hi, px: clamp(150 / (hi - lo), 0.08, 14),
        get: (p, s, t) => { const l = ed().locksAt(s, t).find((x) => x.id === id); return l ? l.value : null; },
        text: (v) => (v == null ? "-" : String(v)), help: `LOCK ${i + 1}: ${lockName(id)} (ALT + DRAG UP: UNLOCK)` });
    });
    return list;
  }
  const KEYS = ["⇧1", "⇧2", "⇧3", "⇧4", "⇧5", "⇧6", "⇧7", "⇧8", "⇧9", "⇧0", "⇧-", "⇧="];
  // a mode's value of step s (track t), null when it has none (an off step, no such lock)
  function valueOf(m, s, t = ed().track) {
    const st = ed().steps(t)[s];
    if (!st.on) return null;
    return m.get(ed().played(s, t), s, t);
  }
  const fracOf = (m, v) => (v == null ? 0 : (v - m.min) / Math.max(1, m.max - m.min));
  // values to steps: each distinct value one command (the unit sets it on all its steps at once)
  function apply(m, changes) {
    const E = ed(), groups = new Map();
    for (const [s, v] of changes) {
      const enc = m.enc ? m.enc(v, E.played(s)) : v, k = `${enc}`;
      if (!groups.has(k)) groups.set(k, { v: enc, steps: [] });
      groups.get(k).steps.push(s);
    }
    for (const g of groups.values()) {
      if (m.lock !== undefined) E.setLock(g.steps, m.lock, g.v);
      else E.setField(g.steps, m.f, g.v);
    }
  }
  // a drag up / down from y0: every picked step's value moved by the same amount (NOTE: transposed)
  function startDrag(e, steps) {
    const m = modes()[S.mode], base = new Map(), E = ed();
    for (const s of steps) if (E.steps()[s].on) base.set(s, valueOf(m, s));
    S.drag = { kind: "value", y0: e.clientY, m, base, last: 0, unlock: e.altKey, notesOf: new Map([...base.keys()].map((k) => [k, E.played(k).notes.slice()])) };
  }
  function moveDrag(e) {
    const d = S.drag, dy = d.y0 - e.clientY;
    if (d.unlock && d.m.lock !== undefined && dy > 12) { ed().clearLock([...d.base.keys()], d.m.lock); d.base.clear(); return; }   // (ALT + up: unlocked)
    if (Math.abs(dy) < 4 && !d.moved) return;
    d.moved = true;
    const delta = Math.round(dy / d.m.px);
    if (delta === d.last) return;
    d.last = delta;
    if (d.m.note) { for (const [s] of d.base) ed().setNotes(s, d.notesOf.get(s).map((n) => clamp(n + delta, 0, 127))); return; }
    const changes = new Map();
    for (const [s, v0] of d.base) changes.set(s, clamp((v0 == null ? Math.round((d.m.min + d.m.max) / 2) : v0) + delta, d.m.min, d.m.max));
    apply(d.m, changes);
  }
  // a second press on the same place within 400 ms: a double-click (the views draw again between the clicks, so the
  // browser's own dblclick, which wants the same element twice, never comes)
  function twice(key) {
    const t = performance.now(), l = S.lastDown;
    S.lastDown = { key, t };
    if (l && l.key === key && t - l.t < 400) { S.lastDown = null; return true; }
    return false;
  }
  // picking: a click, CMD / CTRL + click, SHIFT + click (a run on the track)
  function pick(s, e) {
    if (e.metaKey || e.ctrlKey) { if (S.sel.has(s)) S.sel.delete(s); else S.sel.add(s); S.anchor = s; }
    else if (e.shiftKey && S.anchor >= 0) { const a = Math.min(S.anchor, s), z = Math.max(S.anchor, s); S.sel.clear(); for (let k = a; k <= z; k++) S.sel.add(k); }
    else if (!S.sel.has(s)) { S.sel.clear(); S.sel.add(s); S.anchor = s; }
    S.cur = s;
  }
  // a step made or taken away (a new one takes the held notes)
  function toggle(s) {
    const E = ed();
    if (E.steps()[s].on) { E.clear([s]); S.sel.delete(s); }
    else {
      E.setField([s], FIELD.TRIG, TRIG_ON);
      if (S.held.length) E.setNotes(s, S.held);
      S.sel.clear(); S.sel.add(s);
    }
    S.anchor = s; S.cur = s;
    render();
  }

  // ---- drawing
  function render() {
    const on = !!ctx.link() && ready();
    $("sq-body").hidden = !on; $("sq-sel").hidden = !on; $("sq-kb").hidden = !on || S.view !== "steps"; $("sq-modes").hidden = !on;
    for (const id of ["sq-read", "sq-undo", "sq-redo", "sq-pat", "sq-rate", "sq-pats"]) $(id).disabled = !ctx.link();
    for (const b of $("sq-views").children) b.setAttribute("aria-pressed", String(b.dataset.v === S.view));
    $("sq-names").textContent = S.names ? "NAMES ON" : "NAMES OFF";
    $("sq-names").setAttribute("aria-pressed", String(S.names));
    $("sq-inspb").setAttribute("aria-pressed", String(S.inspect));
    if (!on) {
      $("sq-note").hidden = false; $("sq-tracks").textContent = "";
      if (!ctx.link()) $("sq-note").textContent = "Connect an FM-1 to see its pattern.";
      else if (!S.failed) $("sq-note").textContent = "Reading the FM-1's pattern as soon as it is free (or press READ).";
      return;
    }
    $("sq-note").hidden = true;
    const E = ed(), P = E.pat, ts = P.tracks[E.track].set;
    if (document.activeElement !== patSel) patSel.value = String(P.pattern);
    if (document.activeElement !== $("sq-rate")) $("sq-rate").value = String(ts.rate);
    $("sq-state").textContent = `${patName(P.pattern)} · ${P.bpm} BPM${E.pending ? " · SENDING" : ""}`;
    const tr = $("sq-tracks");
    tr.textContent = "";
    P.tracks.forEach((t, k) => {
      const b = btn(`key plain${k === E.track ? " on" : ""}`, `${k + 1} ${t.name || "-"}${t.set.mute ? " M" : ""}`, () => pickTrack(k), `Track ${k + 1} (${k + 1})`);
      b.setAttribute("aria-pressed", String(k === E.track));
      tr.append(b);
    });
    renderModes();
    $("sq-stepsv").hidden = S.view !== "steps"; $("sq-rollv").hidden = S.view !== "roll"; $("sq-tracksv").hidden = S.view !== "tracks";
    $("sq-insp").hidden = !S.inspect;
    if (S.view === "steps") { renderSteps(E, ts); renderKeyboard(E); }
    else if (S.view === "roll") renderRoll(E, ts);
    else renderTracks(E);
    renderSel(E);
    if (S.inspect) renderInsp(E, ts);
  }
  function renderModes() {
    const box = $("sq-modes"), M = modes();
    if (box.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;   // (a lock being picked)
    box.textContent = "";
    box.append(el("span", "lab", "EDIT"));
    M.forEach((m, i) => {
      if (m.lock !== undefined && m.slot === 0) box.append(el("span", "lab sqlocks", "LOCKS"));
      const b = btn(`key plain${i === S.mode ? " on" : ""}${m.lock !== undefined ? " lk" : ""}`, "", () => { S.mode = i; store.set("eg-seqmode", i); render(); });
      b.append(el("kbd", "", KEYS[i]), document.createTextNode(m.lock !== undefined ? "" : m.name));
      b.setAttribute("aria-pressed", String(i === S.mode));
      b.title = m.help;
      box.append(b);
      if (m.lock !== undefined) {                  // (the slot's value: any of the 129)
        const sel = el("select", "sqlksel");
        sel.setAttribute("aria-label", `Lock ${m.slot + 1}: which value`);
        opt(sel, LOCK_OPTS, m.lock);
        sel.addEventListener("change", () => { S.slots[m.slot] = +sel.value; store.set("eg-seqslots", S.slots); S.mode = i; sel.blur(); render(); });
        b.append(sel);
      }
    });
  }
  // the strip under the views: what is picked, what a drag does
  function renderSel(E) {
    const box = $("sq-sel"), m = modes()[S.mode];
    box.textContent = "";
    const picked = [...S.sel].sort((a, b) => a - b);
    const title = picked.length ? (picked.length === 1 ? `TRACK ${E.track + 1} · STEP ${picked[0] + 1}` : `TRACK ${E.track + 1} · ${picked.length} STEPS`) : `TRACK ${E.track + 1} · NO STEP PICKED`;
    const txt = picked.length ? picked.slice(0, 4).map((s) => { const st = E.steps()[s], p = E.played(s);
      return `${s + 1} ${st.on ? `${chordName(p.notes)} (${p.notes.map(noteName).join(" ")}) LEN ${LENS[p.len]}` : "OFF"}`; }).join(" · ") + (picked.length > 4 ? " .." : "")
      : S.held.length ? `HELD ${S.held.map(noteName).join(" ")}: DOUBLE-CLICK A STEP TO PUT THEM THERE` : "CLICK A STEP; DOUBLE-CLICK ONE TO MAKE IT";
    box.append(el("span", "sqst", title), el("span", "sqsx", txt), el("span", "dim sqsh", `DRAG ↑↓ IN A STEP: ${m.help}`),
      btn("key plain", "ESC NONE", () => { S.sel.clear(); S.anchor = -1; render(); }));
    if (S.view === "steps") box.append(btn("key plain", "Z OCT -", () => { S.oct = Math.max(0, S.oct - 1); render(); }), btn("key plain", "X OCT +", () => { S.oct = Math.min(7, S.oct + 1); render(); }));
  }

  // ---- STEPS
  function renderSteps(E, ts) {
    const box = $("sq-stepsv"), m = modes()[S.mode], steps = E.steps();
    box.textContent = "";
    const band = {};                                // (each picked step's length: a band on through the steps it lasts into)
    for (const s of S.sel) {
      if (!steps[s].on) continue;
      const L = LENS[E.played(s).len] === "INF" ? NSTEP - s : lenSteps(E.played(s).len);
      for (let k = 0; k < Math.ceil(L) && s + k < NSTEP; k++) band[s + k] = Math.max(band[s + k] || 0, Math.min(1, L - k));
    }
    const head = el("div", "sqsrow sqshead");
    head.append(el("span", "sqsl", "LOOP"));
    const nums = el("div", "sqspads");
    for (let k = 0; k < PAGE; k++) nums.append(el("span", `sqsn${k % 4 === 0 ? " beat" : ""}`, String(k + 1)));
    head.append(nums);
    box.append(head);
    for (let pg = 0; pg < 8; pg++) {
      const inLoop = !!((ts.loop >> pg) & 1), a = ts.pstart[pg], z = ts.pend[pg];
      const row = el("div", `sqsrow${inLoop ? " in" : ""}`);
      const lab = btn(`key plain sqsl${inLoop ? " on" : ""}`, String(pg + 1), () => { const mk = ts.loop ^ (1 << pg); if (mk) E.setTrack(TFIELD.LOOP, mk); else refuse("one page at least stays in the loop"); },
        `Page ${pg + 1}: ${inLoop ? `in the loop, steps ${a + 1}..${z + 1}` : "not in the loop"} (SHIFT + L)`);
      lab.setAttribute("aria-pressed", String(inLoop));
      const pads = el("div", "sqspads");
      pads.dataset.page = pg;
      for (let k = 0; k < PAGE; k++) {
        const s = pg * PAGE + k, st = steps[s], p = st.on ? E.played(s) : null, v = p ? valueOf(m, s) : null;
        const b = el("button", `sqs${st.on ? " on" : ""}${k < a || k > z || !inLoop ? " out" : ""}${S.sel.has(s) ? " sel" : ""}${s === S.cur ? " cur" : ""}${st.locked ? " lk" : ""}${k % 4 === 0 ? " beat" : ""}`);
        b.type = "button"; b.dataset.step = s; b.tabIndex = -1; b.style.gridColumn = String(k + 1); b.style.gridRow = "1";
        b.setAttribute("aria-label", `Step ${s + 1}${st.on ? `, ${chordName(p.notes)}, ${m.name} ${m.text(v, p)}${st.locked ? ", locks" : ""}` : ", off"}${S.sel.has(s) ? ", picked" : ""}`);
        if (p) {
          const f = el("i", `sqsv${m.lock !== undefined ? " lkv" : ""}`); f.style.height = `${Math.round((m.note ? p.notes[0] / 127 : fracOf(m, v)) * 100)}%`; b.append(f);
          if (S.names) b.append(el("span", "sqsname", chordName(p.notes)));
          b.append(el("span", "sqsval", m.note ? "" : m.text(v, p)));
        }
        if (band[s]) { const t = el("i", "sqstail"); t.style.width = `${Math.round(band[s] * 100)}%`; b.append(t); }
        pads.append(b);
      }
      for (const [which, at] of [["start", a], ["end", z]]) {
        const mk = el("span", `sqsm ${which}`, which === "start" ? "[" : "]");
        mk.dataset.page = pg; mk.dataset.which = which;
        mk.style.gridColumn = String(at + 1); mk.style.gridRow = "1";
        mk.title = `Page ${pg + 1}'s ${which === "start" ? "first" : "last"} step: ${at + 1} (drag it; ${which === "start" ? "," : "."} at the cursor)`;
        pads.append(mk);
      }
      row.append(lab, pads);
      box.append(row);
    }
  }
  // the keyboard: three octaves; the picked steps' notes lit (or the notes held)
  function renderKeyboard(E) {
    const box = $("sq-kb");
    box.textContent = "";
    const on = [...S.sel].filter((s) => E.steps()[s].on);
    const lit = new Set(on.length ? on.flatMap((s) => E.played(s).notes) : S.held);
    const side = el("div", "sqkbside");
    side.append(el("p", `lab${on.length ? " picked" : " held"}`, on.length ? "NOTES OF THE STEPS PICKED" : "NOTES HELD"),
      el("p", "dim", on.length ? "A key adds or takes away its note on them." : "A key holds its note for the next new step."));
    const keys = el("div", "sqkbkeys");
    const lo = 12 * (S.oct + 1), WK = 100 / 21;
    let wi = 0;
    for (let n = lo; n < lo + 36; n++) {
      const black = [1, 3, 6, 8, 10].includes(n % 12), b = el("button", `${black ? "bk" : "wk"}${lit.has(n) ? (on.length ? " on" : " held") : ""}`);
      b.type = "button"; b.setAttribute("aria-label", noteName(n)); b.setAttribute("aria-pressed", String(lit.has(n)));
      if (black) { b.style.left = `${wi * WK - WK * 0.32}%`; b.style.width = `${WK * 0.64}%`; }
      else { b.style.left = `${wi * WK}%`; b.style.width = `${WK}%`; if (n % 12 === 0) b.append(el("span", "", noteName(n))); wi++; }
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); keyNote(n, true); });
      b.addEventListener("pointerup", () => keyNote(n, false));
      b.addEventListener("pointerleave", () => keyNote(n, false));
      keys.append(b);
    }
    box.append(side, keys);
  }
  // a key down: sounds on the FM-1 (the track's channel), and adds / takes away the note on the picked steps, or holds it
  function keyNote(n, down) {
    const l = ctx.link(), E = ed();
    if (!l || !E || !E.pat) return;
    const ch = E.pat.tracks[E.track].set.chan & 15;
    if (!down) { if (S.keysDown.has(n)) { S.keysDown.delete(n); l.note(ch, n, 0); } return; }
    if (S.keysDown.has(n)) return;
    S.keysDown.set(n, true);
    l.note(ch, n, 100);
    const on = [...S.sel].filter((s) => E.steps()[s].on);
    if (!on.length) { S.held = S.held.includes(n) ? S.held.filter((x) => x !== n) : S.held.concat(n).slice(-6); render(); return; }
    const adding = !on.every((s) => E.played(s).notes.includes(n));
    for (const s of on) {
      const ns = E.played(s).notes;
      if (adding) { if (!ns.includes(n) && ns.length < 6) E.setNotes(s, ns.concat(n)); }
      else if (ns.length > 1) E.setNotes(s, ns.filter((x) => x !== n));
    }
  }
  // STEPS' pointer: the container's (a change draws the rows again under it)
  const stepAt = (x, y) => { const n = document.elementFromPoint(x, y); const b = n && n.closest ? n.closest("[data-step]") : null; return b && b.closest("#sq-stepsv") ? +b.dataset.step : -1; };
  $("sq-stepsv").addEventListener("pointerdown", (e) => {
    if (!ready() || e.button !== 0) return;
    const E = ed(), box = $("sq-stepsv"), mk = e.target.closest(".sqsm");
    if (mk) {
      e.preventDefault(); box.setPointerCapture(e.pointerId);
      S.drag = { kind: "mark", which: mk.dataset.which, page: +mk.dataset.page };
      return;
    }
    const s = stepAt(e.clientX, e.clientY);
    if (s < 0) return;
    e.preventDefault();
    if (twice(`s${E.track}:${s}`) && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) { S.drag = null; toggle(s); return; }
    if (e.altKey && (!E.steps()[s].on || modes()[S.mode].lock === undefined)) { toggle(s); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey) { pick(s, e); render(); return; }
    pick(s, e);
    box.setPointerCapture(e.pointerId);
    startDrag(e, [...S.sel]);
    render();
  });
  $("sq-stepsv").addEventListener("pointermove", (e) => {
    if (!S.drag) return;
    if (S.drag.kind === "mark") {
      const s = stepAt(e.clientX, e.clientY), E = ed(), ts = E.pat.tracks[E.track].set, pg = S.drag.page;
      if (s < 0 || (s >> 4) !== pg) return;
      const k = s & 15;
      if (S.drag.which === "start") { const a = Math.min(k, ts.pend[pg]); if (a !== ts.pstart[pg]) E.setTrack(TFIELD.PSTART, (pg << 4) | a); }
      else { const z = Math.max(k, ts.pstart[pg]); if (z !== ts.pend[pg]) E.setTrack(TFIELD.PEND, (pg << 4) | z); }
      return;
    }
    if (S.drag.kind === "value") moveDrag(e);
  });
  function endDrag() {
    const d = S.drag;
    S.drag = null;
    if (!d || !ready()) return;
    if (d.kind === "mark") { const ts = ed().pat.tracks[ed().track].set; say(`Page ${d.page + 1}: steps ${ts.pstart[d.page] + 1}..${ts.pend[d.page] + 1}.`); }
    else if (d.kind === "value" && d.moved) say(`${d.m.name}: ${d.base.size} step${d.base.size === 1 ? "" : "s"} changed.`);
    else if (d.kind === "len") say(`Step ${d.s + 1}: length ${LENS[ed().played(d.s).len]}.`);
    else if (d.kind === "keys") return;
    render();
  }
  $("sq-stepsv").addEventListener("pointerup", endDrag);
  $("sq-stepsv").addEventListener("pointercancel", endDrag);

  // ---- PIANO ROLL
  const R = S.roll;
  function rollSize() {
    const v = $("view"), box = $("sq-rollv"), top = box.getBoundingClientRect().top - v.getBoundingClientRect().top;
    return { w: Math.max(320, box.clientWidth - 64), h: clamp(v.clientHeight - top - 3 * 42 - 30 - 64, 120, 640) };
  }
  const rollClamp = (z) => { R.cw = clamp(R.cw, 6, 120); R.rh = clamp(R.rh, 7, 32); R.x0 = clamp(R.x0, 0, Math.max(0, NSTEP - z.w / R.cw)); R.top = clamp(R.top, Math.ceil(z.h / R.rh) - 1, 127); };
  function renderRoll(E, ts) {
    const box = $("sq-rollv");
    box.textContent = "";
    const z = rollSize();
    rollClamp(z);
    const X = (s) => Math.round((s - R.x0) * R.cw), vis = z.w / R.cw, nrows = Math.ceil(z.h / R.rh);
    const steps = E.steps(), picked = new Set([...S.sel].filter((s) => steps[s].on).flatMap((s) => E.played(s).notes));
    // the ruler
    const top = el("div", "sqrr");
    top.append(el("span", "lab sqrz", `${Math.round(R.cw)} PX/STEP`));
    const ruler = el("div", "sqrruler"); ruler.style.width = `${z.w}px`;
    for (let s = Math.ceil(R.x0); s < R.x0 + vis; s++) {
      if (s % 16 === 0 || (s % 4 === 0 && R.cw >= 14)) { const t = el("span", s % 16 === 0 ? "pg" : "", s % 16 === 0 ? `PAGE ${s / 16 + 1}` : String((s % 16) + 1)); t.style.left = `${X(s)}px`; ruler.append(t); }
    }
    top.append(ruler);
    // the keys (drag: the rows' height) and the grid
    const body = el("div", "sqrbody");
    const keys = el("div", "sqrkeys"); keys.style.height = `${z.h}px`;
    keys.title = "Drag up / down: the rows' height (or ALT + scroll)";
    const grid = el("div", "sqrgrid"); grid.style.width = `${z.w}px`; grid.style.height = `${z.h}px`;
    for (let r = 0; r < nrows; r++) {
      const n = R.top - r, black = NAMES[((n % 12) + 12) % 12].includes("#");
      const k = el("div", `sqrk${black ? " b" : ""}${picked.has(n) ? " on" : ""}`, R.rh >= 10 && (n % 12 === 0 || picked.has(n)) ? noteName(n) : "");
      k.style.top = `${r * R.rh}px`; k.style.height = `${R.rh}px`; k.style.lineHeight = `${R.rh}px`;
      keys.append(k);
      const band = el("div", `sqrrow${black ? " b" : ""}`); band.style.top = `${r * R.rh}px`; band.style.height = `${R.rh}px`; grid.append(band);
    }
    for (let s = Math.floor(R.x0); s <= Math.ceil(R.x0 + vis); s++) {
      if (R.cw < 12 && s % 4) continue;
      const l = el("i", `sqrl${s % 16 === 0 ? " pg" : s % 4 === 0 ? " bt" : ""}`); l.style.left = `${X(s)}px`; grid.append(l);
    }
    // what plays: the loop's pages from their starts to their ends; the rest dimmed
    let last = 0;
    for (let p = 0; p < 8; p++) {
      if (!((ts.loop >> p) & 1)) continue;
      const a = p * PAGE + ts.pstart[p], e2 = p * PAGE + ts.pend[p] + 1;
      if (a > last) { const d = el("i", "sqrshade"); d.style.left = `${X(last)}px`; d.style.width = `${X(a) - X(last)}px`; grid.append(d); }
      for (const [x, w] of [[X(a), "start"], [X(e2) - 5, "end"]]) { const mk = el("i", `sqrmark ${w}`); mk.style.left = `${x}px`; grid.append(mk); }
      last = e2;
    }
    { const d = el("i", "sqrshade"); d.style.left = `${X(last)}px`; d.style.width = `${Math.max(0, X(NSTEP) - X(last))}px`; grid.append(d); }
    for (let s = 0; s < NSTEP; s++) {
      const st = steps[s];
      if (!st.on) continue;
      const p = E.played(s), L = LENS[p.len] === "INF" ? NSTEP - s : lenSteps(p.len);
      if (s + L < R.x0 || s > R.x0 + vis) continue;
      const sel = S.sel.has(s);
      for (const n of p.notes) {
        if (n > R.top || n <= R.top - nrows) continue;
        const b = el("button", `sqrn v${Math.min(3, Math.floor(p.vel / 32))}${sel ? " sel" : ""}${st.locked ? " lk" : ""}`);
        b.type = "button"; b.dataset.step = s; b.dataset.pitch = n;
        b.style.left = `${X(s) + 1}px`; b.style.top = `${(R.top - n) * R.rh + 1}px`; b.style.width = `${Math.max(6, Math.round(L * R.cw) - 2)}px`; b.style.height = `${R.rh - 2}px`;
        b.setAttribute("aria-label", `Step ${s + 1}, ${noteName(n)}, velocity ${p.vel}${sel ? ", picked" : ""}`);
        if (S.names && p.notes.length === 1 && R.cw * L >= 26 && R.rh >= 11) b.append(el("span", "", noteName(n)));
        b.append(el("i", "grip"));
        grid.append(b);
      }
      const hi = Math.max(...p.notes);
      if (S.names && p.notes.length > 1 && hi <= R.top && hi > R.top - nrows) { const c = el("span", `sqrchord${sel ? " sel" : ""}`, chordName(p.notes)); c.style.left = `${X(s) + 1}px`; c.style.top = `${Math.max(0, (R.top - hi) * R.rh - 14)}px`; grid.append(c); }
    }
    body.append(keys, grid);
    box.append(top, body);
    // three lanes, each any value
    S.lanes.forEach((ln, i) => {
      const lm = laneMode(ln), row = el("div", "sqrlane");
      const sel = el("select", "sqrlsel");
      sel.setAttribute("aria-label", `Lane ${i + 1}: which value`);
      opt(sel, [["VEL", "VEL"], ["LEN", "LEN"], ["MICRO", "MICRO"], ["RATCH", "RATCH"], ["CHANCE", "CHANCE"], ["COND", "COND"], ["SOUND", "SOUND"], ...LOCK_OPTS], ln);
      sel.addEventListener("change", () => { S.lanes[i] = /^\d+$/.test(sel.value) ? +sel.value : sel.value; store.set("eg-seqlanes", S.lanes); sel.blur(); render(); });
      const lane = el("div", "sqrlv"); lane.style.width = `${z.w}px`; lane.dataset.lane = i;
      for (let s = Math.max(0, Math.floor(R.x0)); s < Math.min(NSTEP, R.x0 + vis); s++) {
        const v = steps[s].on ? valueOf(lm, s) : null;
        if (v == null) continue;
        const b = el("i", `${S.sel.has(s) ? "sel" : ""}${lm.lock !== undefined ? " lk" : ""}`); b.style.left = `${X(s) + 2}px`; b.style.width = `${Math.max(3, Math.min(24, R.cw - 5))}px`;
        b.style.height = `${Math.max(2, Math.round(fracOf(lm, v) * 30))}px`; lane.append(b);
        if (R.cw >= 26) { const t = el("span", "", lm.text(v, E.played(s))); t.style.left = `${X(s) + 2}px`; lane.append(t); }
      }
      row.append(sel, lane);
      box.append(row);
    });
    // the whole pattern
    const mrow = el("div", "sqrmini"), mini = el("div", "sqmini"); mini.style.width = `${z.w}px`;
    for (let s = 0; s < NSTEP; s++) if (steps[s].on) { const t = el("i", S.sel.has(s) ? "sel" : ""); t.style.left = `${(s / NSTEP) * 100}%`; t.style.width = `${Math.max(0.4, (lenSteps(E.played(s).len) / NSTEP) * 100)}%`; mini.append(t); }
    const win = el("b"); win.style.left = `${(R.x0 / NSTEP) * 100}%`; win.style.width = `${(vis / NSTEP) * 100}%`; mini.append(win);
    mini.addEventListener("click", (e) => { const r = mini.getBoundingClientRect(); R.x0 = ((e.clientX - r.left) / r.width) * NSTEP - vis / 2; render(); });
    mrow.append(el("span", "lab", "ALL 128"), mini);
    box.append(mrow);
    wireRoll(grid, keys);
  }
  // a lane's value: one of the modes, or a lock id
  function laneMode(ln) {
    if (typeof ln === "number") { const [lo, hi] = lockRange(ln) || [0, 127]; return { name: lockName(ln), lock: ln, min: lo, max: hi, get: (p, s, t) => { const l = ed().locksAt(s, t).find((x) => x.id === ln); return l ? l.value : null; }, text: (v) => (v == null ? "-" : String(v)) }; }
    const M = modes();
    return M.find((m) => m.name === ln) || M[1];
  }
  function wireRoll(grid, keys) {
    const E = ed(), G = () => grid.getBoundingClientRect();
    grid.addEventListener("wheel", (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX, r = G();
      if (e.ctrlKey || e.metaKey) { const at = R.x0 + (e.clientX - r.left) / R.cw; R.cw = clamp(R.cw * (d < 0 ? 1.15 : 1 / 1.15), 6, 120); R.x0 = at - (e.clientX - r.left) / R.cw; }
      else if (e.altKey) R.rh += d < 0 ? 1 : -1;
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) R.x0 += d / R.cw;
      else R.top += (d < 0 ? 1 : -1) * Math.max(1, Math.round(Math.abs(d) / 40));
      render();
    }, { passive: false });
    keys.addEventListener("pointerdown", (e) => { e.preventDefault(); S.drag = { kind: "keys", y0: e.clientY, rh0: R.rh }; });
    const cell = (e) => { const r = G(); return { s: Math.floor(R.x0 + (e.clientX - r.left) / R.cw), n: R.top - Math.floor((e.clientY - r.top) / R.rh) }; };
    grid.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const nb = e.target.closest(".sqrn");
      if (!nb) {
        const c = cell(e);
        if (twice(`r${E.track}:${c.s}:${c.n}`) && c.s >= 0 && c.s < NSTEP && c.n >= 0 && c.n <= 127) { E.addNote(c.s, c.n); S.sel.clear(); S.sel.add(c.s); S.anchor = c.s; S.cur = c.s; render(); return; }
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) { S.sel.clear(); render(); }
        return;
      }
      e.preventDefault();
      const s = +nb.dataset.step, pitch = +nb.dataset.pitch;
      if (twice(`n${E.track}:${s}:${pitch}`)) { E.removeNote(s, pitch); S.sel.delete(s); render(); return; }
      if (e.altKey) { E.removeNote(s, pitch); S.sel.delete(s); return; }
      if (e.metaKey || e.ctrlKey || e.shiftKey) { pick(s, e); render(); return; }
      pick(s, e);
      const r = nb.getBoundingClientRect();
      if (e.clientX > r.right - 7) S.drag = { kind: "len", s, gx: G().left };
      else startDrag(e, [...S.sel]);
      render();
    });
    // (the drags: the roll's container, which outlives a redraw)
    const box = $("sq-rollv");
    if (!box.dataset.wired) {
      box.dataset.wired = "1";
      box.addEventListener("pointermove", (e) => {
        if (!S.drag || S.view !== "roll") return;
        if (S.drag.kind === "keys") { const rh = clamp(S.drag.rh0 + Math.round((S.drag.y0 - e.clientY) / 12), 7, 32); if (rh !== R.rh) { R.rh = rh; render(); } return; }
        if (S.drag.kind === "len") {
          const L = Math.max(1 / 8, R.x0 + (e.clientX - S.drag.gx) / R.cw - S.drag.s), li = nearestLen(L), E2 = ed();
          const on = S.sel.size > 1 && S.sel.has(S.drag.s) ? [...S.sel].filter((x) => E2.steps()[x].on) : [S.drag.s];
          if (E2.played(S.drag.s).len !== li) E2.setField(on, FIELD.LEN, li);
          return;
        }
        if (S.drag.kind === "value") moveDrag(e);
      });
      box.addEventListener("pointerup", () => { if (S.drag) endDrag(); });
    }
    // a lane: the value at the step under the pointer, from its height
    for (const lane of box.querySelectorAll(".sqrlv")) {
      lane.addEventListener("pointerdown", (e) => {
        lane.setPointerCapture(e.pointerId);
        const lm = laneMode(S.lanes[+lane.dataset.lane]);
        const at = (ev) => {
          const r = lane.getBoundingClientRect(), s = Math.floor(R.x0 + (ev.clientX - r.left) / R.cw);
          if (s < 0 || s >= NSTEP || !E.steps()[s].on) return;
          if (ev.altKey && lm.lock !== undefined) { E.clearLock([s], lm.lock); return; }
          const v = Math.round(lm.min + clamp(1 - (ev.clientY - r.top - 4) / 30, 0, 1) * (lm.max - lm.min));
          apply(lm, new Map([[s, v]]));
        };
        at(e);
        lane.onpointermove = (ev) => { if (ev.buttons) at(ev); };
        lane.onpointerup = () => { lane.onpointermove = null; };
      });
    }
  }

  // ---- TRACKS
  const T = S.trk;
  function renderTracks(E) {
    const box = $("sq-tracksv");
    box.textContent = "";
    const w = Math.max(320, box.clientWidth - 186), P = E.pat;
    if (!T.cw) T.cw = w / 32;
    T.cw = clamp(T.cw, w / NSTEP, w / 8);
    T.x0 = clamp(T.x0, 0, Math.max(0, NSTEP - w / T.cw));
    const vis = w / T.cw, X = (pos) => Math.round((pos - T.x0) * T.cw), m = modes()[S.mode];
    const v = $("view"), top = box.getBoundingClientRect().top - v.getBoundingClientRect().top;
    const rowH = clamp(Math.floor((v.clientHeight - top - 130) / 6) - 5, 36, 96);
    // the zoom
    const bar = el("div", "sqtbar");
    bar.append(el("span", "lab", "SHOW"));
    for (const n of [1, 2, 4, 8]) bar.append(btn(`key plain${Math.abs(vis - n * 16) < 0.5 ? " on" : ""}`, `${n} PAGE${n > 1 ? "S" : ""}`, () => { T.cw = w / (n * 16); render(); }));
    bar.append(btn("key plain", "−", () => { T.cw /= 1.25; render(); }, "Zoom out (CMD / CTRL + scroll)"), btn("key plain", "+", () => { T.cw *= 1.25; render(); }, "Zoom in (CMD / CTRL + scroll)"),
      el("span", "dim", `${Math.round(vis)} STEPS SHOWN · SCROLL: LEFT / RIGHT · DOUBLE-CLICK A NAME: ITS STEPS`));
    box.append(bar);
    const ruler = el("div", "sqtruler"); ruler.style.width = `${w}px`;
    for (let s = Math.ceil(T.x0); s < T.x0 + vis; s++) if (s % 16 === 0 || (s % 4 === 0 && T.cw >= 16)) { const t = el("span", s % 16 === 0 ? "pg" : "", s % 16 === 0 ? `PAGE ${s / 16 + 1}` : String((s % 16) + 1)); t.style.left = `${X(s)}px`; ruler.append(t); }
    box.append(ruler);
    const rows = el("div", "sqtrows");
    P.tracks.forEach((tr, t) => {
      const ts = tr.set, f = rateSixteenths(ts.rate), pages = [0, 1, 2, 3, 4, 5, 6, 7].filter((p) => (ts.loop >> p) & 1);
      const row = el("div", `sqtrow${t === E.track ? " on" : ""}${ts.mute ? " muted" : ""}`);
      const lab = el("div", "sqtlab");
      lab.style.height = `${rowH}px`;
      const nm = btn("sqtname", `${t + 1} ${tr.name || "-"}`, null, "Click: this track. Double-click: its STEPS");
      nm.addEventListener("pointerdown", () => { if (twice(`name${t}`)) { pickTrack(t); setView("steps"); } else pickTrack(t); });
      const mute = btn(`key plain sqtm${ts.mute ? " on" : ""}`, "M", () => { const k = E.track; E.track = t; E.setTrack(TFIELD.MUTE, ts.mute ? 0 : 1); E.track = k; render(); }, `Mute track ${t + 1}`);
      mute.setAttribute("aria-pressed", String(!!ts.mute));
      lab.append(nm, el("span", "sqtinfo", `${RATES[ts.rate]} · ${pages.length === 1 ? `PAGE ${pages[0] + 1}` : `PAGES ${pages[0] + 1}-${pages[pages.length - 1] + 1}`}`), mute);
      const lane = el("div", "sqtlane"); lane.style.width = `${w}px`; lane.style.height = `${rowH}px`; lane.dataset.track = t;
      for (let s = Math.floor(T.x0 / f); s * f <= T.x0 + vis && s < NSTEP; s++) {
        if (T.cw * f < 10 && s % 4) continue;
        const l = el("i", `sqrl${s % 16 === 0 ? " pg" : s % 4 === 0 ? " bt" : ""}`); l.style.left = `${X(s * f)}px`; lane.append(l);
      }
      let last = 0;
      for (const p of pages) {
        const a = p * PAGE + ts.pstart[p], e2 = p * PAGE + ts.pend[p] + 1;
        if (a > last) { const d = el("i", "sqrshade"); d.style.left = `${X(last * f)}px`; d.style.width = `${X(a * f) - X(last * f)}px`; lane.append(d); }
        for (const [x, which] of [[X(a * f), "start"], [X(e2 * f) - 4, "end"]]) { const mk = el("i", `sqrmark ${which}`); mk.style.left = `${x}px`; lane.append(mk); }
        last = e2;
      }
      { const d = el("i", "sqrshade"); d.style.left = `${X(last * f)}px`; d.style.width = `${Math.max(0, X(NSTEP * f) - X(last * f))}px`; lane.append(d); }
      tr.steps.forEach((st, s) => {
        if (!st.on || (s + 1) * f < T.x0 || s * f > T.x0 + vis) return;
        const p = E.played(s, t), sel = t === E.track && S.sel.has(s), wpx = Math.max(3, Math.round(T.cw * f) - 2), val = valueOf(m, s, t);
        const b = el("button", `sqts${sel ? " sel" : ""}${st.locked ? " lk" : ""}`);
        b.type = "button"; b.dataset.track = t; b.dataset.step = s; b.tabIndex = -1;
        b.style.left = `${X(s * f) + 1}px`; b.style.width = `${wpx}px`;
        b.setAttribute("aria-label", `Track ${t + 1}, step ${s + 1}, ${chordName(p.notes)}, ${m.name} ${m.text(val, p)}`);
        const fl = el("i"); fl.style.height = `${Math.round((m.note ? p.notes[0] / 127 : fracOf(m, val)) * 100)}%`; b.append(fl);
        if (S.names && wpx >= 34) b.append(el("span", "", chordName(p.notes)));
        lane.append(b);
        if (sel) { const L = LENS[p.len] === "INF" ? NSTEP - s : lenSteps(p.len); const bd = el("i", "sqtband"); bd.style.left = `${X(s * f) + 2}px`; bd.style.width = `${Math.max(4, Math.round(L * f * T.cw) - 4)}px`; lane.append(bd); }
      });
      row.append(lab, lane);
      rows.append(row);
    });
    box.append(rows);
    const mrow = el("div", "sqrmini"), mini = el("div", "sqmini tall"); mini.style.width = `${w}px`;
    P.tracks.forEach((tr, t) => { const f = rateSixteenths(tr.set.rate); tr.steps.forEach((st, s) => { if (st.on && s * f < NSTEP) { const i = el("i", t === E.track && S.sel.has(s) ? "sel" : tr.set.mute ? "mut" : ""); i.style.left = `${(s * f / NSTEP) * 100}%`; i.style.top = `${3 + t * 6}px`; i.style.width = `${Math.max(0.3, (f / NSTEP) * 100)}%`; mini.append(i); } }); });
    const win = el("b"); win.style.left = `${(T.x0 / NSTEP) * 100}%`; win.style.width = `${(vis / NSTEP) * 100}%`; mini.append(win);
    mini.addEventListener("click", (e) => { const r = mini.getBoundingClientRect(); T.x0 = ((e.clientX - r.left) / r.width) * NSTEP - vis / 2; render(); });
    mrow.append(el("span", "lab sqtml", "THE WHOLE PATTERN"), mini);
    box.append(mrow);
    wireTracks(rows, w);
  }
  function wireTracks(rows, w) {
    const E = ed();
    rows.addEventListener("wheel", (e) => {
      e.preventDefault();
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX, lane = rows.querySelector(".sqtlane"), r = lane.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) { const at = T.x0 + (e.clientX - r.left) / T.cw; T.cw = clamp(T.cw * (d < 0 ? 1.15 : 1 / 1.15), w / NSTEP, w / 8); T.x0 = at - (e.clientX - r.left) / T.cw; }
      else T.x0 += d / T.cw;
      render();
    }, { passive: false });
    const hit = (x, y) => { const n = document.elementFromPoint(x, y); const b = n && n.closest ? n.closest(".sqts") : null; return b ? [+b.dataset.track, +b.dataset.step] : null; };
    rows.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const h = hit(e.clientX, e.clientY);
      if (!h) {                                  // (an empty place: twice, a new step there)
        const lane = e.target.closest(".sqtlane");
        if (!lane) return;
        const t = +lane.dataset.track, f = rateSixteenths(E.pat.tracks[t].set.rate), r = lane.getBoundingClientRect();
        const s = Math.floor((T.x0 + (e.clientX - r.left) / T.cw) / f);
        if (s >= 0 && s < NSTEP && twice(`t${t}:${s}`)) { if (t !== E.track) { E.track = t; S.sel.clear(); } toggle(s); }
        return;
      }
      e.preventDefault();
      const [t, s] = h;
      if (t !== E.track) { E.track = t; S.sel.clear(); S.anchor = -1; }
      if (twice(`t${t}:${s}`) || e.altKey) { toggle(s); return; }
      if (e.metaKey || e.ctrlKey || e.shiftKey) { pick(s, e); render(); return; }
      pick(s, e);
      startDrag(e, [...S.sel]);
      render();
    });
    const box = $("sq-tracksv");
    if (!box.dataset.wired) {
      box.dataset.wired = "1";
      box.addEventListener("pointermove", (e) => { if (S.drag && S.drag.kind === "value" && S.view === "tracks") moveDrag(e); });
      box.addEventListener("pointerup", () => { if (S.drag) endDrag(); });
    }
  }

  // ---- the inspector (SHIFT + I): every field of the steps picked, their locks, the track
  function field(label, node) { const w = el("label", "sqf"); w.append(el("span", "", label), node); return w; }
  function numIn(v, lo, hi, on) { const i = el("input"); i.type = "number"; i.min = lo; i.max = hi; i.value = v; i.addEventListener("change", () => { const x = clamp(Math.round(+i.value), lo, hi); i.value = x; on(x); }); return i; }
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
        field("SOUND LOCK", numIn(p.sound, 0, 128, set(FIELD.SOUND))));
      const row = el("div", "keys");
      row.append(btn("key plain", "BACK TO THE TRACK'S", () => { for (const pm of [PM.VEL, PM.LEN, PM.MICRO, PM.RATCH, PM.CHANCE, PM.COND, PM.STRUM]) E.setField(steps, FIELD.RESET, pm); }),
        btn("key warn", "CLEAR", () => { E.clear(steps); S.sel.clear(); }));
      box.append(row);
      box.append(el("h3", "", `LOCKS (${E.locksAt(s0).length})`));
      for (const l of E.locksAt(s0)) {
        const [lo, hi] = lockRange(l.id), r = el("div", "sqlk");
        r.append(el("span", "", lockName(l.id)), numIn(l.value, lo, hi, (v) => E.setLock(steps, l.id, v)), btn("key plain", "×", () => E.clearLock(steps, l.id), `Unlock ${lockName(l.id)}`));
        box.append(r);
      }
    } else box.append(el("p", "dim", "Pick a step to see every field of it here."));
    box.append(el("h3", "", `TRACK ${E.track + 1}`));
    const tg = el("div", "sqfgrid"); box.append(tg);
    tg.append(field("TRANSPOSE", numIn(ts.transpose, -48, 48, (v) => E.setTrack(TFIELD.TRANSPOSE, v))),
      field("SWING", numIn(ts.swing, 0, 100, (v) => E.setTrack(TFIELD.SWING, v))));
  }

  // ---- phase 4's overview: the project's 64 patterns (the store's projects' sectors, read); a click goes there
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
      const p = S.pats.list[k], b = btn(`key plain${p.used ? " used" : ""}${k === cur ? " on" : ""}`, patName(k), () => ctx.job(async () => {
        const a = await make().gotoPattern(k);
        if (!a || a.status) refuse(`the FM-1 did not go to ${patName(k)}`);
        else say(a.b === 2 ? `The FM-1 goes to ${patName(k)} at the end of this one.` : `The FM-1 is on ${patName(k)}.`, "ok");
        renderPats();
      }), `${patName(k)}: ${p.used ? "has steps" : "empty"}${k === cur ? " (open)" : ""}`);
      g.append(b);
    }
  }
  const togglePats = () => {
    const g = $("sq-patgrid"), open = g.hidden;
    g.hidden = !open;
    $("sq-pats").setAttribute("aria-expanded", String(open));
    if (open) { renderPats(); ctx.job(readPatterns); }
  };
  $("sq-pats").addEventListener("click", togglePats);
  $("sq-read").addEventListener("click", () => ctx.job(load));
  $("sq-undo").addEventListener("click", () => ctx.job(async () => { const a = await ed().undo(false); say(a && !a.status ? "Undone on the FM-1." : "Nothing to undo on the FM-1."); }));
  $("sq-redo").addEventListener("click", () => ctx.job(async () => { const a = await ed().undo(true); say(a && !a.status ? "Redone on the FM-1." : "Nothing to redo on the FM-1."); }));
  $("sq-names").addEventListener("click", () => { S.names = !S.names; store.set("eg-seqnames", S.names); render(); });
  $("sq-inspb").addEventListener("click", () => { S.inspect = !S.inspect; render(); });
  $("sq-rate").addEventListener("change", () => { if (ready()) { ed().setTrack(TFIELD.RATE, +$("sq-rate").value); say(`Track ${ed().track + 1}: rate ${RATES[+$("sq-rate").value]}.`); $("sq-rate").blur(); } });
  patSel.addEventListener("change", () => ctx.job(async () => {
    const p = +patSel.value, a = await make().gotoPattern(p);
    if (!a || a.status) refuse(`the FM-1 did not go to ${patName(p)} (${a ? a.statusName : "no answer"})`);
    else say(a.b === 2 ? `The FM-1 goes to ${patName(p)} at the end of this one.` : `The FM-1 is on ${patName(p)}.`, "ok");
  }));

  // ---- the keys (SEQUENCE shown, not typing). The plain letters are the piano (as SOUND's); every other action is
  // SHIFT + its letter
  const PIANO = "awsedftgyhujkolp;";
  const typing = (e) => e.target.closest && e.target.closest("input, select, textarea");
  document.addEventListener("keyup", (e) => {
    if (!S.shown) return;
    const n = PIANO.indexOf(e.key.toLowerCase());
    if (n >= 0) keyNote(12 * (S.oct + 1) + n, false);
  });
  document.addEventListener("keydown", (e) => {
    if (!S.shown || !ready() || typing(e)) return;
    const E = ed(), steps = [...S.sel].sort((a, b) => a - b), cmd = e.metaKey || e.ctrlKey, ts = E.pat.tracks[E.track].set;
    const done = () => { e.preventDefault(); render(); };
    if (cmd && e.key.toLowerCase() === "z") { ctx.job(() => E.undo(e.shiftKey)); return done(); }
    if (cmd && e.key.toLowerCase() === "c" && steps.length) {
      const first = steps[0], last = steps[steps.length - 1];
      S.clip = { steps: E.steps().slice(first, last + 1).map((x) => ({ ...x, slots: x.slots.slice() })),
        locks: E.pat.tracks[E.track].locks.filter((l) => l.step >= first && l.step <= last).map((l) => ({ ...l, step: l.step - first })) };
      say(`Copied steps ${first + 1}..${last + 1}.`); return done();
    }
    if (cmd && e.key.toLowerCase() === "v" && S.clip) { const at = steps.length ? steps[0] : S.cur; E.paste(at, S.clip.steps, S.clip.locks); say(`Pasted at step ${at + 1}.`); return done(); }
    if (cmd || e.altKey) return;
    // the modes: TAB, SHIFT + 1 .. 9, 0, -, =
    if (e.key === "Tab") { const n = modes().length; S.mode = (S.mode + (e.shiftKey ? n - 1 : 1)) % n; store.set("eg-seqmode", S.mode); return done(); }
    const MK = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"];
    if (e.shiftKey && MK.includes(e.code)) { S.mode = MK.indexOf(e.code); store.set("eg-seqmode", S.mode); return done(); }
    if (e.shiftKey && /^Key[A-Z]$/.test(e.code)) {
      const k = e.code.slice(3).toLowerCase();
      if (k === "v") { setView({ tracks: "steps", steps: "roll", roll: "tracks" }[S.view]); return done(); }
      if (k === "p") { togglePats(); return done(); }
      if (k === "r") { ctx.job(load); return done(); }
      if (k === "m") { E.setTrack(TFIELD.MUTE, ts.mute ? 0 : 1); return done(); }
      if (k === "n") { S.names = !S.names; store.set("eg-seqnames", S.names); return done(); }
      if (k === "i") { S.inspect = !S.inspect; return done(); }
      if (k === "l") { const mk = ts.loop ^ (1 << (S.cur >> 4)); if (mk) E.setTrack(TFIELD.LOOP, mk); return done(); }
      return;
    }
    if (/^[1-6]$/.test(e.key)) { pickTrack(+e.key - 1); return done(); }
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: S.view === "steps" ? -PAGE : 0, ArrowDown: S.view === "steps" ? PAGE : 0 }[e.key];
    if (d) {
      S.cur = clamp(S.cur + d, 0, NSTEP - 1);
      if (!e.shiftKey) S.sel.clear();
      S.sel.add(S.cur); S.anchor = S.cur;
      if (S.view === "roll" && (S.cur < R.x0 || S.cur >= R.x0 + 24)) R.x0 = S.cur - 4;
      if (S.view === "tracks" && T.cw && (S.cur < T.x0 || S.cur > T.x0 + 60)) T.x0 = S.cur - 4;
      return done();
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && S.view === "tracks") { pickTrack(clamp(E.track + (e.key === "ArrowDown" ? 1 : -1), 0, 5)); return done(); }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && S.view === "roll") { R.top += e.key === "ArrowUp" ? 12 : -12; return done(); }
    if (e.key === "Escape") { S.sel.clear(); S.anchor = -1; return done(); }
    if (e.key === "Enter") { toggle(S.cur); return done(); }
    if (e.key === "," || e.key === ".") {
      const pg = S.cur >> 4, c = S.cur & 15;
      if (e.key === ",") E.setTrack(TFIELD.PSTART, (pg << 4) | Math.min(c, ts.pend[pg])); else E.setTrack(TFIELD.PEND, (pg << 4) | Math.max(c, ts.pstart[pg]));
      return done();
    }
    if (e.key === "z" || e.key === "x") { S.oct = clamp(S.oct + (e.key === "x" ? 1 : -1), 0, 7); return done(); }
    const n = PIANO.indexOf(e.key);
    if (n >= 0 && !e.repeat) { keyNote(12 * (S.oct + 1) + n, true); e.preventDefault(); return; }
    const on = steps.filter((s) => E.steps()[s].on);
    if (!on.length) return;
    const p = E.played(on[0]);
    if (e.key === "Delete" || e.key === "Backspace") { E.clear(on); S.sel.clear(); return done(); }
    if (e.key === "[" || e.key === "]") { E.setField(on, FIELD.LEN, clamp(p.len + (e.key === "]" ? 1 : -1), 0, LENS.length - 1)); return done(); }
    if (e.key === "-" || e.key === "=") { E.setField(on, FIELD.VEL, clamp(p.vel + (e.key === "=" ? 8 : -8), 1, 127)); return done(); }
  });
  window.addEventListener("resize", () => { if (S.shown && ready()) render(); });
  window.addEventListener("blur", () => { for (const n of [...S.keysDown.keys()]) keyNote(n, false); });

  return {
    load, render,
    show(v) { S.shown = v; if (v && ctx.link() && !ready()) ctx.job(load); else if (v) render(); },
    async poll() {
      if (!S.shown || !ctx.link() || ctx.busy() || S.drag) return;
      if (!ready()) { if (!S.failed) await ctx.job(load); return; }      // (shown while the page was busy: read now)
      const mine = performance.now() - ed().lastAt < 3000;   // (our own edits move the unit's revision too: read quietly)
      if (await ed().poll() && !mine) say("The FM-1's pattern changed: read again.");
    },
    gone() { S.ed = null; S.failed = false; S.sel.clear(); render(); },
    track(t) { S.want = t; if (ready() && ed().track !== t) { ed().track = t; S.sel.clear(); render(); } },
    view(v) { if (S.view !== v) setView(v); },            // (TRACKS / STEPS / PIANO ROLL from outside: the unit's page keys)
    state: S,
  };
}
// every lock id, named (a name twice: its number after it), for the lock slots and the lanes
const LOCK_OPTS = LOCKS.map(([n], id) => { const k = LOCKS.filter(([x], j) => x === n && j < id).length; return [id, `${id < 119 ? "" : "MIX "}${n}${k ? ` ${k + 1}` : ""}`]; });
