// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// SEQUENCE's editing model (no DOM: the tests run it in Node against the simulated unit). It holds the pattern open on
// the unit (egseq.js's model, read with PATTERN INFO and STEPS), changes it at once on the page and sends each change
// as the unit's own command (STEP SET, LOCK SET, STEPS PUT, TRACK SET, UNDO, GO TO PATTERN: docs/SEQ-SYSEX-PLAN.md),
// one at a time with its ACK; a drag's run sends only what it ends on (the latest value of each step and field). A
// refusal, or a pattern the unit left, reads the unit again: the unit is the truth.
//
//   const ed = new SeqEditor({ link, log, onChange(), onError(msg) });
//   await ed.load() (PATTERN INFO, every track's steps and locks); ed.pat (egseq.js patternOf), ed.track (0..5)
//   ed.addNote(s, pitch) / ed.removeNote(s, pitch) / ed.setNotes(s, notes) / ed.setField(steps, FIELD.X, v) / ed.clear(steps)
//   (every change goes to the track picked when it was made: a command waiting in the queue keeps its pattern and track)
//   ed.setLock(steps, id, v) / ed.clearLock(steps, id) / ed.clearLocks(steps)
//   ed.paste(first, steps[]) / ed.setTrack(TFIELD.X, v) / await ed.undo(redo) / await ed.gotoPattern(p)
//   ed.played(s) (the step as it plays) / ed.locksAt(s) / await ed.idle() / ed.pending / await ed.poll() (re-read when
//   the unit's revision moved and nothing of ours is waiting)
import { FIELD, TRIG_ON, TFIELD } from "./egsysex.js";
import { patternOf, putSteps, putLocks, stepOf, stepWire, emptyStep, played, PM, NSTEP } from "./egseq.js";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const PM_OF = { [FIELD.VEL]: PM.VEL, [FIELD.LEN]: PM.LEN, [FIELD.MICRO]: PM.MICRO, [FIELD.RATCH]: PM.RATCH, [FIELD.COND]: PM.COND,
  [FIELD.CHANCE]: PM.CHANCE, [FIELD.SOUND]: PM.SOUND, [FIELD.STRUM]: PM.STRUM };
const KEY_OF = { [FIELD.VEL]: "vel", [FIELD.LEN]: "len", [FIELD.MICRO]: "micro", [FIELD.COND]: "cond", [FIELD.CHANCE]: "chance",
  [FIELD.SOUND]: "sound", [FIELD.STRUM]: "strum", [FIELD.FUNC]: "func", [FIELD.MFX]: "mfx" };

export class SeqEditor {
  constructor({ link, log = () => {}, onChange = () => {}, onError = () => {} }) {
    Object.assign(this, { link, log, onChange, onError, pat: null, track: 0, q: [], running: false, lastAt: 0, waiters: [], rev: -1 });
  }
  get pending() { return this.running || this.q.length > 0; }
  // ---- reading
  async load() {
    const info = await this.link.patternInfo();
    if (!info || info.old) throw Object.assign(new Error(info && info.old ? "this EVILGENIUS cannot send its patterns: install a newer one" : "the FM-1 did not send its pattern"), { old: !!(info && info.old) });
    const pat = patternOf(info);
    for (let t = 0; t < pat.tracks.length; t++) await this.readTrack(t, pat);
    this.pat = pat;
    this.rev = info.rev;
    this.onChange();
    return pat;
  }
  async readTrack(t, pat = this.pat) {
    const r = await this.link.steps(t, { locks: true });
    if (!r || r.old || r.steps.some((w) => !w)) throw new Error(`the FM-1 did not send track ${t + 1}'s steps`);
    putSteps(pat, t, 0, r.steps);
    pat.tracks[t].locks = [];
    putLocks(pat, t, r.locks);
  }
  // the unit's revision moved (its own edits, an undo, a pattern change) and nothing of ours waits: read it again
  async poll() {
    if (!this.pat || this.pending || now() - this.lastAt < 800) return false;
    const st = await this.link.status();
    if (!st) return false;
    if (st.rev === undefined || (st.rev === this.rev && st.pattern === this.pat.pattern)) return false;
    await this.load();
    return true;
  }
  // ---- the page's view of a step
  steps(t = this.track) { return this.pat.tracks[t].steps; }
  locksAt(s, t = this.track) { return this.pat.tracks[t].locks.filter((l) => l.step === s); }
  played(s, t = this.track) { return played(this.steps(t)[s], this.pat.tracks[t].set); }
  // ---- changes: the model now, the unit as soon as it is free
  send(key, run) {
    const i = this.q.findIndex((x) => x.key === key && key);
    if (i >= 0) this.q[i].run = run; else this.q.push({ key, run });
    this.lastAt = now();
    this.onChange();
    this.pump();
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.q.length) {
        const { run } = this.q.shift();
        const a = await run();
        this.lastAt = now();
        if (!a || a.status) await this.refused(a);
      }
    } catch (e) {
      this.q.length = 0;
      this.onError(e.message || String(e));
    } finally {
      this.running = false;
      const w = this.waiters; this.waiters = [];
      w.forEach((r) => r());
      this.onChange();
    }
  }
  async refused(a) {
    this.q.length = 0;
    this.onError(!a ? "the FM-1 did not answer" : a.old ? "this EVILGENIUS cannot edit its patterns from here: install a newer one"
      : a.statusName === "BAD PATTERN" ? `the FM-1 is on pattern ${a.b} now: read again` : `the FM-1 refused it (${a.statusName})`);
    await this.load().catch(() => {});
  }
  idle() { return this.pending ? new Promise((r) => this.waiters.push(r)) : Promise.resolve(); }
  head() { return { pattern: this.pat.pattern, track: this.track }; }
  // a queue key of this track's (the latest change of each key is the one sent)
  key(k) { return k === null ? null : `${this.track}:${k}`; }
  // a step changed on the page as the unit's setters change it (pattern.c own(): a value makes a trig)
  own(st, pm) {
    const d = this.pat.tracks[this.track].set.def;
    st.on = true;
    if (!(st.ovr & (1 << pm))) {
      if (pm === PM.NOTE) st.slots = d.slots.slice();
      else if (pm === PM.VEL) st.vel = d.vel;
    }
    st.ovr |= 1 << pm;
  }
  addNote(s, pitch) {
    const st = this.steps()[s], p = this.played(s);
    const notes = st.on ? p.notes.filter((n) => n !== pitch).concat(pitch).slice(-6) : [pitch];
    this.own(st, PM.NOTE);
    st.slots = [...notes, 0, 0, 0, 0, 0, 0].slice(0, 6);
    const h = this.head();
    this.send(this.key(`notes:${s}`), () => this.link.stepSet({ ...h, steps: [s], fields: [[FIELD.TRIG, TRIG_ON], [FIELD.NOTES, notes]] }));
  }
  // a step's notes, all at once (1..6; the step on if it was not)
  setNotes(s, notes) {
    notes = [...new Set(notes)].filter((n) => n >= 0 && n <= 127).sort((a, b) => a - b).slice(0, 6);
    if (!notes.length) return;
    const st = this.steps()[s];
    this.own(st, PM.NOTE);
    st.slots = [...notes, 0, 0, 0, 0, 0, 0].slice(0, 6);
    const h = this.head();
    this.send(this.key(`notes:${s}`), () => this.link.stepSet({ ...h, steps: [s], fields: [[FIELD.TRIG, TRIG_ON], [FIELD.NOTES, notes]] }));
  }
  removeNote(s, pitch) {
    const st = this.steps()[s], notes = this.played(s).notes.filter((n) => n !== pitch);
    if (!st.on) return;
    if (!notes.length || (notes.length === this.played(s).notes.length && notes.length <= 1)) { this.clear([s]); return; }
    this.own(st, PM.NOTE);
    st.slots = [...notes, 0, 0, 0, 0, 0, 0].slice(0, 6);
    const h = this.head();
    this.send(this.key(`notes:${s}`), () => this.link.stepSet({ ...h, steps: [s], fields: [[FIELD.NOTES, notes]] }));
  }
  setField(steps, f, v) {
    for (const s of steps) {
      const st = this.steps()[s];
      if (f === FIELD.TRIG) { if (v === 0) { this.steps()[s] = emptyStep(); this.dropLocks([s]); } else { st.on = true; if (v !== TRIG_ON) { st.type = v; st.ovr |= 1 << PM.TRIG; } } continue; }
      if (f === FIELD.RESET) { st.ovr &= ~(1 << v); continue; }
      if (f === FIELD.RATCH) { this.own(st, PM.RATCH); st.ratch = v & 15; st.ramp = (v >> 4) & 3; continue; }
      if (f === FIELD.SOUND && !v) { st.ovr &= ~(1 << PM.SOUND); st.sound = 0; continue; }
      if (PM_OF[f] !== undefined) this.own(st, PM_OF[f]); else st.on = true;
      st[KEY_OF[f]] = v;
    }
    const h = this.head();
    this.send(this.key(`f${f}:${steps.join(",")}`), () => this.link.stepSet({ ...h, steps, fields: [[f, v]] }));
  }
  clear(steps) {
    for (const s of steps) this.steps()[s] = emptyStep();
    this.dropLocks(steps);
    const h = this.head();
    this.send(null, () => this.link.stepSet({ ...h, steps, fields: [[FIELD.CLEAR, 0]] }));
  }
  dropLocks(steps, id = null) {
    const tr = this.pat.tracks[this.track];
    tr.locks = tr.locks.filter((l) => !(steps.includes(l.step) && (id === null || l.id === id)));
    for (const s of steps) tr.steps[s].locked = tr.locks.some((l) => l.step === s);
  }
  setLock(steps, id, value) {
    const tr = this.pat.tracks[this.track];
    this.dropLocks(steps, id);
    for (const s of steps) { tr.locks.push({ step: s, id, value }); tr.steps[s].locked = true; }
    tr.locks.sort((a, b) => a.step - b.step || a.id - b.id);
    const h = this.head();
    this.send(this.key(`l${id}:${steps.join(",")}`), () => this.link.lockSet({ ...h, steps, entries: [{ op: "set", id, value }] }));
  }
  clearLock(steps, id) {
    this.dropLocks(steps, id);
    const h = this.head();
    this.send(null, () => this.link.lockSet({ ...h, steps, entries: [{ op: "clear", id }] }));
  }
  clearLocks(steps) {
    this.dropLocks(steps);
    const h = this.head();
    this.send(null, () => this.link.lockSet({ ...h, steps, entries: [{ op: "clearAll" }] }));
  }
  // a paste: steps (egseq.js shape) from first on, their locks after (LOCK SET each)
  paste(first, steps, locks = []) {
    const n = Math.min(steps.length, NSTEP - first);
    const tr = this.pat.tracks[this.track], at = Array.from({ length: n }, (_, k) => first + k);
    for (let k = 0; k < n; k++) tr.steps[first + k] = { ...steps[k], locked: false, slots: steps[k].slots.slice() };
    this.dropLocks(at);
    for (let k = 0; k < n; k += 24) {
      const wires = steps.slice(k, Math.min(n, k + 24)).map(stepWire), f = first + k, h = this.head();
      this.send(null, () => this.link.stepsPut({ ...h, first: f, wires }));
    }
    for (const l of locks) if (l.step < n) this.setLock([first + l.step], l.id, l.value);
  }
  setTrack(f, v) {
    const ts = this.pat.tracks[this.track].set;
    if (f === TFIELD.LOOP) ts.loop = v;
    else if (f === TFIELD.PSTART) ts.pstart[(v >> 4) & 7] = v & 15;
    else if (f === TFIELD.PEND) ts.pend[(v >> 4) & 7] = v & 15;
    else if (f === TFIELD.RATE) { ts.rbase = Math.floor(v / 3); ts.rtype = v % 3; ts.rate = v; }
    else if (f === TFIELD.TRANSPOSE) ts.transpose = v;
    else if (f === TFIELD.MUTE) ts.mute = v;
    else if (f === TFIELD.SWING) ts.swing = v;
    const h = this.head();
    this.send(this.key(`t${f}:${f === TFIELD.PSTART || f === TFIELD.PEND ? v >> 4 : ""}`), () => this.link.trackSet({ ...h, fields: [[f, v]] }));
  }
  async undo(redo = false) {
    await this.idle();
    const a = await this.link.undo(redo);
    await this.load();
    return a;
  }
  async gotoPattern(p) {
    await this.idle();
    const a = await this.link.gotoPattern(p);
    if (a && !a.status) { await new Promise((r) => setTimeout(r, 150)); await this.load(); }
    return a;
  }
}
export { stepOf };
