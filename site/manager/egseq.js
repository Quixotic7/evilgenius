// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// The sequencer's model in the browser (docs/SEQ-SYSEX-PLAN.md phase 1): a pattern's steps, locks and track settings
// decoded from the bytes the unit sends (PATTERN INFO, STEPS: egsysex.js), which are the store's own layouts
// (core/seq/pattern.c qd_step_wire, core/seq/pattern.h qd_tset_t), so the same code reads a store image's pattern
// records later. No DOM: the tests run it in Node.
//
//   stepOf(wire20) -> {on, locked, type, ovr, slots[6], vel, len, micro, ratch, ramp, chance, cond, sound, strum, func, mfx}
//   stepWire(step) -> the 20 bytes back (the simulated unit; round trips)
//   tsetOf(bytes44) -> {def: {slots, vel, len, micro, ratch, ramp, chance, cond, type, strum}, chan, limit, reserve, rbase,
//                        swing, transpose, mute, loop, pstart[8], pend[8], scale, root, keyGlobal, rtype, mfx, mout, rate}
//   tsetBytes(tset) -> the 44 bytes back
//   played(step, tset) -> the step as it plays: each value the step's own (its override bit) or the track's default
//   loopSteps(tset) -> the steps the track's loop walks, in order
//   lockName(id), lenName(len), condName(cond), funcName(f), rateName(code)
import { LENS, CONDS, FUNCS, RATES, LOCKS } from "./egseqnames.js";

export const NSTEP = 128, PAGE = 16, NPAGE = 8, NNOTE = 6, TRACKS = 6;
export const PM = { NOTE: 0, VEL: 1, LEN: 2, MICRO: 3, RATCH: 4, CHANCE: 5, COND: 6, TRIG: 7, SOUND: 8, STRUM: 9 };   // QD_PM_*
export const TRIG = ["NONE", "NOTE", "LOCK", "TIE"];                                    // QD_TRIG_*
export const RAMP = ["FLAT", "UP", "DOWN", "ACCENT"];                                   // QD_RAMP_*
export const TSET_SIZE = 44;
const s8 = (v) => (v << 24) >> 24;

export function stepOf(w) {
  const ovr = w[0] | (w[1] << 8);
  return { ovr, on: !!(w[2] & 1), locked: !!(w[2] & 0x80), type: w[3], slots: Array.from(w.slice(4, 10)), vel: w[10],
    len: w[11], micro: s8(w[12]), ratch: (w[13] & 7) + 1, ramp: (w[13] >> 4) & 3, chance: w[14], cond: w[15], sound: w[16],
    strum: w[17], func: w[18], mfx: w[19] };
}
export function stepWire(st) {
  const w = new Uint8Array(20);
  w[0] = st.ovr & 0xff; w[1] = (st.ovr >> 8) & 0xff;
  w[2] = (st.on ? 1 : 0) | (st.locked ? 0x80 : 0);
  w[3] = st.type;
  st.slots.forEach((n, k) => { w[4 + k] = n; });
  w[10] = st.vel; w[11] = st.len; w[12] = st.micro & 0xff; w[13] = ((st.ratch - 1) & 7) | ((st.ramp & 3) << 4);
  w[14] = st.chance; w[15] = st.cond; w[16] = st.sound; w[17] = st.strum; w[18] = st.func; w[19] = st.mfx;
  return w;
}
export const emptyStep = () => ({ ovr: 0, on: false, locked: false, type: 0, slots: [0, 0, 0, 0, 0, 0], vel: 100, len: 4, micro: 0,
  ratch: 1, ramp: 0, chance: 100, cond: 0, sound: 0, strum: 0, func: 0, mfx: 0 });

// qd_tset_t, byte for byte (pattern.h: the def's 14 bytes, then the track's own; the record's layout)
export function tsetOf(b) {
  const def = { slots: Array.from(b.slice(0, 6)), vel: b[6], len: b[7], micro: s8(b[8]), ratch: (b[9] & 7) + 1, ramp: (b[9] >> 4) & 3,
    chance: b[10], cond: b[11], type: b[12], strum: b[13] };
  const t = { def, chan: b[14], limit: b[15], reserve: b[16], rbase: b[17], swing: b[18], transpose: s8(b[19]), mute: b[20],
    loop: b[21] || 1, pstart: Array.from(b.slice(22, 30)), pend: Array.from(b.slice(30, 38)), scale: b[38], root: b[39],
    keyGlobal: b[40], rtype: b[41], mfx: b.length > 42 ? b[42] : 0, mout: b.length > 43 ? b[43] : 0 };
  t.rate = t.rbase * 3 + t.rtype;
  return t;
}
export function tsetBytes(t) {
  const b = new Uint8Array(TSET_SIZE), d = t.def;
  d.slots.forEach((n, k) => { b[k] = n; });
  b[6] = d.vel; b[7] = d.len; b[8] = d.micro & 0xff; b[9] = ((d.ratch - 1) & 7) | ((d.ramp & 3) << 4); b[10] = d.chance;
  b[11] = d.cond; b[12] = d.type; b[13] = d.strum;
  b[14] = t.chan; b[15] = t.limit; b[16] = t.reserve; b[17] = t.rbase; b[18] = t.swing; b[19] = t.transpose & 0xff; b[20] = t.mute;
  b[21] = t.loop; t.pstart.forEach((v, k) => { b[22 + k] = v; }); t.pend.forEach((v, k) => { b[30 + k] = v; });
  b[38] = t.scale; b[39] = t.root; b[40] = t.keyGlobal; b[41] = t.rtype; b[42] = t.mfx; b[43] = t.mout;
  return b;
}

// the step as it plays (pattern.c qd_step_resolve_def: the step's value where its override bit is set, else the track's
// default; no notes at all: C4; a trig's type NOTE when it holds none; the track's TRANSPOSE comes later, at play)
export function played(st, ts) {
  const has = (pm) => !!(st.ovr & (1 << pm)), d = ts.def;
  const slots = has(PM.NOTE) ? st.slots : d.slots;
  let notes = slots.filter((n) => n > 0).sort((a, b) => a - b);
  if (!notes.length) notes = [60];
  let type = st.on ? (has(PM.TRIG) ? st.type : d.type) : 0;
  if (st.on && (type < 1 || type > 3)) type = 1;
  return { on: st.on, type, notes,
    vel: Math.max(1, Math.min(127, has(PM.VEL) ? st.vel : d.vel)), len: has(PM.LEN) ? st.len : d.len, micro: has(PM.MICRO) ? st.micro : d.micro,
    ratch: has(PM.RATCH) ? st.ratch : d.ratch, ramp: has(PM.RATCH) ? st.ramp : d.ramp, chance: has(PM.CHANCE) ? st.chance : d.chance,
    cond: has(PM.COND) ? st.cond : d.cond, sound: has(PM.SOUND) ? st.sound : 0, strum: has(PM.STRUM) ? st.strum : d.strum,
    func: st.func };
}
// the loop: the pages whose bit is set, each from its start to its end, in page order (qd_track_len)
export function loopSteps(ts) {
  const out = [];
  for (let p = 0; p < NPAGE; p++)
    if ((ts.loop >> p) & 1) for (let s = ts.pstart[p]; s <= ts.pend[p]; s++) out.push(p * PAGE + s);
  return out;
}
export const lockName = (id) => (LOCKS[id] ? LOCKS[id][0] : `#${id}`);
export const lockRange = (id) => (LOCKS[id] ? [LOCKS[id][1], LOCKS[id][2]] : null);
export const lenName = (k) => LENS[k] ?? "?";
export const condName = (k) => CONDS[k] ?? "?";
export const funcName = (k) => FUNCS[k] ?? "?";
export const rateName = (k) => RATES[k] ?? "?";

// a pattern read from the unit: PATTERN INFO, then each track's STEPS and LOCKS
export function patternOf(info) {
  return { pattern: info.pattern, rev: info.rev, bpm: info.bpm, swing: info.swing, master: info.master, nlock: info.nlock,
    tracks: info.tracks.map((t) => ({ name: t.name, set: tsetOf(t.tset), steps: null, locks: null })) };
}
export function putSteps(pat, track, first, wires) {
  const tr = pat.tracks[track];
  if (!tr.steps) tr.steps = Array.from({ length: NSTEP }, emptyStep);
  wires.forEach((w, k) => { tr.steps[first + k] = stepOf(w); });
}
export function putLocks(pat, track, locks, { from = 0, to = NSTEP } = {}) {
  const tr = pat.tracks[track];
  tr.locks = (tr.locks || []).filter((l) => l.step < from || l.step >= to).concat(locks).sort((a, b) => a.step - b.step || a.id - b.id);
}
