// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// A simulated FM-1 running EvilGenius behind a fake Web MIDI access: the manager's ?sim (the page without a unit: the
// preview, headless checks) and the Node tests. It answers what the page asks the way the unit does:
//   - fm1-base's update handshake (the identity FM-1_4500) and EvilGenius's IDENTITY;
//   - the port's bulk commands over a blank store of the unit's layout (FZBI, FZBR; FZSR refused: nothing restores here);
//   - (2026-11-15) the open pattern read: PATTERN INFO, STEPS with their locks (a demo pattern: sim.pat; sim.editPat(fn)
//     changes it and moves its revision, as the unit's undo would);
//   - EvilGenius's own SysEx (egsysex.js): STATUS, PROJECTS, LIST, DUMP (MY PRESETS, the factory's, a track's), STORE6
//     (into MY PRESETS, onto a track, an AUDITION), PARAM, TAGS, RENAME, DELETE, SWAP, BROWSE, USERS, FLUSH. Its
//     factory presets and tracks are the unit's own (egsimdata.js); MY PRESETS starts empty.
// No DOM. Each reply comes on a later turn (as a port's would).
//   const sim = new SimUnit({ log }); sim.access (requestMIDIAccess's shape); sim.turn(track, id, v) (a knob on the
//   unit); sim.select(t); sim.counts; sim.tracks[t] / sim.mine[k] {name, blob, tags, pan, chorus, delay, reverb, id ..}
import * as W from "./egwire.js";
import { LAYOUT } from "./egstore.js";
import { CMD, CMD1, ST, SOURCE_TRACK, FLAGS, MIX_ID, unpack7, pack7, parseDump } from "./egsysex.js";
import { valuesOf, blobOf, NP } from "./egsound.js";
import { SIM_FACTORY, SIM_TRACKS } from "./egsimdata.js";
import { emptyStep, stepWire, stepOf, tsetBytes, PM } from "./egseq.js";
import { LOCKS, FUNCS } from "./egseqnames.js";
const FUNCS_N = FUNCS.length;

const hex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
// each reply on a later turn: a MessageChannel's (not a timer's: a hidden tab throttles timers to a second; Node: setImmediate)
const later = typeof setImmediate === "function" ? setImmediate : (() => {
  const ch = new MessageChannel(), q = [];
  ch.port1.onmessage = () => { const fn = q.shift(); if (fn) fn(); };
  return (fn) => { q.push(fn); ch.port2.postMessage(0); };
})();
const MIX_KEY = { [MIX_ID.PAN]: "pan", [MIX_ID.DELAY]: "delay", [MIX_ID.REVERB]: "reverb", [MIX_ID.CHORUS]: "chorus" };
const u14 = (v) => [(v >> 7) & 127, v & 127];
const nm12 = (s) => Array.from({ length: 12 }, (_, i) => (i < s.length ? s.charCodeAt(i) & 127 : 32));
const soundOf = (d) => ({ name: d.name, blob: Uint8Array.from(d.blob), tags: d.tags, pan: d.pan, chorus: d.chorus, delay: d.delay,
  reverb: d.reverb, drive: d.drive });

export class SimUnit {
  constructor({ name = "FM-1", id = "FM-1_4500", log = () => {} } = {}) {
    Object.assign(this, { name, id, log, playing: false, sel: 0, project: 1, counts: { cmds: {}, notes: 0, params: 0 } });
    this.image = new Uint8Array(LAYOUT.size).fill(0xFF);
    this.factory = SIM_FACTORY.map(([slot, pid, nm, tags, f]) => ({ slot, id: pid, ...soundOf(parseDump(hex(f))), name: nm, tags }));
    this.tracks = SIM_TRACKS.map((f) => { const d = parseDump(hex(f)); return { ...soundOf(d), id: d.extras.id, edited: false, chan: d.extras.chan }; });
    this.mine = new Array(LAYOUT.nlib).fill(null);
    this.nextId = 0x100;
    this.projects = [{ name: "PROJECT 1", there: true, pool: new Array(128).fill(0) }, { name: "LIVE SET", there: true, pool: new Array(128).fill(0) },
      { there: false, pool: new Array(128).fill(0) }, { there: false, pool: new Array(128).fill(0) }];
    // (the pool: the project's 128 places, each a preset's id or 0; the demo project starts with a few factory sounds)
    this.factory.slice(0, 9).forEach((f, k) => { this.projects[0].pool[k] = f.id; });
    this.input = { name, state: "connected", onmidimessage: null, open: async () => {}, close: async () => {} };
    this.output = { name, state: "connected", open: async () => {}, close: async () => {}, send: (b) => this.take(Array.from(b)) };
    this.pat = demoPattern(this.tracks.map((t) => t.name));
    this.access = { inputs: new Map([[name, this.input]]), outputs: new Map([[name, this.output]]), onstatechange: null, sysexEnabled: true };
  }
  out(bytes) { later(() => { if (this.input.onmidimessage && this.input.state === "connected") this.input.onmidimessage({ data: Uint8Array.from(bytes) }); }); }
  unplug() { this.input.state = this.output.state = "disconnected"; if (this.access.onstatechange) this.access.onstatechange({}); }
  editPat(fn) { fn(this.pat); this.pat.rev = (this.pat.rev + 1) & 0x3FFF; }
  // the unit's undo, as the sim keeps it: a level a gesture (writes within QUIET_MS of each other), a paste or a clear its
  // own; each level the tracks before and after
  gesture(own = false) {
    const now = Date.now(), snap = () => JSON.stringify(this.pat.tracks.map((t) => ({ steps: t.steps, locks: t.locks })));
    if (!this.hist) this.hist = { levels: [], pos: 0, open: null, last: 0 };
    const h = this.hist;
    if (h.open && (own || now - h.last > 500)) this.closeGesture();
    if (!h.open) h.open = { before: snap() };
    h.last = now;
  }
  closeGesture() {
    const h = this.hist;
    if (!h || !h.open) return;
    const after = JSON.stringify(this.pat.tracks.map((t) => ({ steps: t.steps, locks: t.locks })));
    if (after !== h.open.before) { h.levels.length = h.pos; h.levels.push({ before: h.open.before, after, kind: h.open.kind || 0 }); h.pos++; this.pat.rev = (this.pat.rev + 1) & 0x3FFF; }
    h.open = null;
  }
  restore(json) { JSON.parse(json).forEach((t, k) => { this.pat.tracks[k].steps = t.steps; this.pat.tracks[k].locks = t.locks; }); this.pat.rev = (this.pat.rev + 1) & 0x3FFF; }
  // the remote's PLAY and REC as the panel takes them (ctl.c b_play, b_rec): PLAY tapped plays / stops at its release;
  // REC held 400 ms arms (stopped) or latches (playing) the recording, tapped while it records stops it
  remote(b, down) {
    const t = Date.now();
    if (!this.btn) this.btn = {};
    if (down) { this.btn[b] = t; return; }
    const held = t - (this.btn[b] || t);
    if (b === 10 && held < 400) { this.playing = !this.playing; if (!this.playing && this.rec === 2) this.rec = 0; if (this.playing && this.rec === 1) this.rec = 2; }
    else if (b === 11) { if (this.rec) this.rec = 0; else if (held >= 400) this.rec = this.playing ? 2 : 1; }
  }
  // the unit's own hands: a knob turned on a track (the editor follows it), SELECT
  turn(t, id, v) { this.setValue(this.tracks[t], id, v); this.tracks[t].edited = true; }
  select(t) { this.sel = t; }

  take(p) {
    if (p[0] !== 0xF0) {                                              // a note, a controller
      if ((p[0] & 0xF0) === 0x90) this.counts.notes++;
      if (p[0] === 0xBF && (p[1] === 30 || p[1] === 31)) this.remote(p[1] - 20, p[2] >= 64);   // (the remote's PLAY, REC)
      return;
    }
    if (p.length === W.HS_QUERY.length && p.every((x, i) => x === W.HS_QUERY[i])) { this.out(W.identityFrame(this.id)); return; }
    const e = W.parseEg(p);
    if (e) { this.counts.cmds[e.cmd] = (this.counts.cmds[e.cmd] || 0) + 1; this.semantic(e.cmd, e.body); return; }
    const b = W.parseBulk(p);
    if (!b) return;
    if (b.tag === "FZBI") this.out(W.bulkFrame("FZBI", [LAYOUT.region, this.image.length, W.crc32(this.image)]));
    else if (b.tag === "FZBR") {
      const off = W.rd32(b.data, 0), n = W.rd32(b.data, 4);
      if (n > 256 || off + n > this.image.length) this.out(W.bulkFrame("FZER", [11]));
      else this.out(W.bulkFrame("FZBD", [off], Array.from(this.image.subarray(off, off + n))));
    } else if (b.tag === "FZSR") this.out(W.bulkFrame("FZER", [12]));
  }

  ack(cmd, st, a = 0, b = 0) { this.out(W.egFrame(0x52, [cmd, st, ...u14(a), ...u14(b)])); }
  error(cmd, st) { this.out(W.egFrame(0x7F, [st, cmd])); }
  setValue(s, id, v) {
    if (MIX_KEY[id]) { s[MIX_KEY[id]] = v; return true; }
    if (id >= NP) return false;
    const vals = valuesOf(s.blob);
    if (!vals) return false;
    vals[id] = v;
    s.blob = blobOf(vals);
    return true;
  }
  // a STORE6 frame of a sound (a DUMP's reply: flags DUMP, and a track's LOAD and its extras)
  frame(s, { flags = FLAGS.DUMP, slot = 0, track = 0, extras = null } = {}) {
    return W.egFrame(CMD.STORE6, [flags, ...u14(slot), ...nm12(s.name), s.drive & 127, track, (s.pan + 64) & 127, s.chorus & 127,
      s.delay & 127, s.reverb & 127, 15, ...pack7(Array.from(s.blob)), s.tags & 127, ...(extras || [])]);
  }
  status() {
    const used = this.mine.filter(Boolean).length;
    return W.egFrame(0x42, [1, 6, (this.playing ? 1 : 0) | (this.rec ? 32 : 0), this.project - 1, this.pat.pattern & 127, this.projects.filter((p) => p.there).length, ...u14(used), ...u14(this.pool.filter(Boolean).length),
      0, 0, 0, ...u14(used * 2), ...u14(165), ...u14(48), ...u14(570), 0, this.sel, 1, LAYOUT.nproj, ...u14(LAYOUT.nlib), ...u14(this.pat.rev)]);
  }
  rows(factory, pool = false) {
    const out = [];
    this.mine.forEach((s, k) => { if (s) out.push([0, k + 1, s.id, s.name, s.tags, (s.imported ? 1 : 0) | (this.inPool(s.id) ? 2 : 0)]); });
    if (factory) for (const f of this.factory) out.push([1, f.slot, f.id, f.name, f.tags, this.inPool(f.id) ? 2 : 0]);
    if (pool) this.pool.forEach((id, k) => { const f = id && this.find(id); if (id) out.push([2, k + 1, id, f ? f.name : "?", f ? f.tags : 0, 0]); });
    return out;
  }
  find(id) { return this.factory.find((f) => f.id === id) || this.mine.find((m) => m && m.id === id) || null; }
  get pool() { return this.projects[this.project - 1].pool; }
  inPool(id) { return !!id && this.pool.includes(id); }
  // the steps of the open pattern locking pool place k (1..128): the sim's one pattern
  poolUsers(k) { let n = 0; for (const t of this.pat.tracks) for (const st of t.steps) if (st.on && st.ovr & (1 << PM.SOUND) && st.sound === k) n++; return n; }

  semantic(cmd, b) {
    const t0 = (t) => (t === 127 ? this.sel : t);
    switch (cmd) {
      case 0x01: this.out(W.egFrame(0x41, [1, ...[..."EVILGENIUS SIM"].map((c) => c.charCodeAt(0))])); return;
      case CMD1.STATUS: this.out(this.status()); return;
      case CMD1.FLUSH: this.out(this.status()); return;
      case CMD1.PROJECTS: {
        const body = [this.project - 1, this.projects.length];
        this.projects.forEach((p, k) => body.push((p.there ? 1 : 0) | (k + 1 === this.project ? 2 : 0), ...nm12(p.there ? p.name || "" : ""), ...u14(p.there ? 4 + 3 * k : 0)));
        this.out(W.egFrame(0x63, body));
        return;
      }
      case CMD.LIST: {
        const rows = this.rows(b[0] & 1, !!(b[0] & 2)), parts = Math.max(1, Math.ceil(rows.length / 16));
        for (let k = 0; k < parts; k++) {
          const part = rows.slice(k * 16, k * 16 + 16);
          this.out(W.egFrame(0x61, [k, k === parts - 1 ? 1 : 0, ...u14(rows.length), part.length,
            ...part.flatMap(([src, slot, pid, nm, tags, fl]) => [src, ...u14(slot), (pid >> 14) & 127, (pid >> 7) & 127, pid & 127, ...nm12(nm), tags & 127, fl])]));
        }
        return;
      }
      case CMD.DUMP: {
        const src = b[0], slot = (b[1] << 7) | b[2];
        if (src === SOURCE_TRACK) {
          const t = slot ? slot - 1 : this.sel, s = this.tracks[t];
          if (!s) { this.error(cmd, ST.BAD_SLOT); return; }
          const ex = [(s.id >> 14) & 127, (s.id >> 7) & 127, s.id & 127, 0, 0, (s.edited ? 1 : 0) | (t === this.sel ? 2 : 0), s.chan & 15, this.sel];
          this.out(this.frame(s, { flags: FLAGS.DUMP | FLAGS.LOAD, track: t, extras: ex }));
        } else if (src === 1) {
          const list = slot ? this.factory.filter((f) => f.slot === slot) : this.factory;
          if (!list.length) { this.error(cmd, ST.BAD_SLOT); return; }
          for (const f of list) this.out(this.frame(f, { slot: 0 }));
        } else if (src === 0) {
          const list = slot ? [[slot, this.mine[slot - 1]]] : this.mine.map((s, k) => [k + 1, s]);
          const there = list.filter(([, s]) => s);
          if (!there.length) { this.error(cmd, ST.BAD_SLOT); return; }
          for (const [k, s] of there) this.out(this.frame(s, { slot: k }));
        } else this.error(cmd, ST.BAD_SLOT);
        return;
      }
      case CMD.STORE6: {
        const fl = b[0], slot = (b[1] << 7) | b[2], tm = b.length > 22 + 147 ? b[22 + 147] : 0;
        const s = { name: String.fromCharCode(...b.slice(3, 15)).trimEnd(), drive: b[15], pan: b[17] - 64, chorus: b[18], delay: b[19],
          reverb: b[20], blob: unpack7(b.slice(22, 22 + 147)), tags: tm };
        if (s.blob[0] !== 0x53 || !valuesOf(s.blob)) { this.out(W.egFrame(0x50, [ST.BAD_PATCH ?? 4, 0, 0, 0])); return; }
        if (fl & FLAGS.LOAD && fl & FLAGS.AUDITION) {
          const t = b[16];
          const x = b.length >= 22 + 147 + 1 + 8 ? b.slice(22 + 147 + 1) : null;
          this.tracks[t] = { ...this.tracks[t], ...s, id: x ? (x[0] << 14) | (x[1] << 7) | x[2] : this.tracks[t].id, edited: x ? !!(x[5] & 1) : true };
          this.out(W.egFrame(0x50, [0, 0, 0, 0]));
          return;
        }
        if (fl & FLAGS.POOL) {                                        // (a MY preset, referenced at a pool place: slot the place, 0 the first free)
          const k = this.mine.findIndex((m) => !m), at = slot || this.pool.indexOf(0) + 1;
          if (k < 0 || !at || at > 128) { this.out(W.egFrame(0x50, [ST.FULL, 1, 0, 0])); return; }
          const id = this.nextId++;
          this.mine[k] = { ...s, id, imported: !(fl & FLAGS.OWN) };
          this.pool[at - 1] = id;
          this.out(W.egFrame(0x50, [0, 1, ...u14(at)]));
          return;
        }
        let k = slot ? slot - 1 : this.mine.findIndex((m) => !m);
        if (k < 0 || k >= this.mine.length) { this.out(W.egFrame(0x50, [ST.FULL, 0, 0, 0])); return; }
        const id = this.mine[k] ? this.mine[k].id : this.nextId++;
        this.mine[k] = { ...s, id, imported: !(fl & FLAGS.OWN) };
        if (fl & FLAGS.LOAD) this.tracks[b[16]] = { ...this.tracks[b[16]], ...s, id, edited: false };
        this.out(W.egFrame(0x50, [0, 0, ...u14(k + 1)]));
        return;
      }
      case 0x32: {                                                    // PATTERN INFO
        const P = this.pat, m = P.master;
        const body = [P.pattern, ...u14(P.rev), ...u14(P.bpm), P.swing, (m >> 14) & 127, ...u14(m), ...u14(P.nlock()), 1, 6, 20, 44];
        P.tracks.forEach((t) => body.push(...pack7(Array.from(tsetBytes(t.set))), ...nm12(t.name)));
        this.out(W.egFrame(0x72, body));
        return;
      }
      case 0x33: {                                                    // STEPS
        const t = b[0] === 127 ? this.sel : b[0], first = b[1], end = b[2] ? first + b[2] : 128;
        if (b.length < 4) { this.error(cmd, ST.BAD_LENGTH); return; }
        if (t > 5) { this.error(cmd, ST.BAD_TRACK); return; }
        if (end > 128) { this.error(cmd, ST.BAD_SLOT); return; }
        const P = this.pat, tr = P.tracks[t];
        for (let s = first; s < end; s += 32) {
          const n = Math.min(32, end - s), body = [P.pattern, t, s, n, ...u14(P.rev)];
          for (let k = 0; k < n; k++) body.push(...pack7(Array.from(stepWire(tr.steps[s + k]))));
          this.out(W.egFrame(0x73, body));
        }
        if (b[3] & 1) {
          const lk = tr.locks.filter((l) => l.step >= first && l.step < end);
          let part = 0;
          for (let i = 0; i === 0 || i < lk.length; i += 127, part++) {
            const chunk = lk.slice(i, i + 127), last = i + 127 >= lk.length;
            this.out(W.egFrame(0x74, [P.pattern, t, part, last ? 1 : 0, chunk.length,
              ...chunk.flatMap((l) => { const v = l.value + (1 << 20); return [l.step, ...u14(l.id), (v >> 14) & 127, ...u14(v)]; })]));
            if (last) break;
          }
        }
        return;
      }
      case 0x34: case 0x35: case 0x36: {                              // STEP SET, LOCK SET, STEPS PUT
        const P = this.pat, t = b[1] === 127 ? this.sel : b[1];
        if (b[0] !== P.pattern) { this.ack(cmd, 12, t + 1, P.pattern + 1); return; }
        if (t > 5) { this.ack(cmd, ST.BAD_TRACK, t + 1, 0); return; }
        const tr = P.tracks[t], inMask = (s) => (b[2 + Math.floor(s / 7)] >> (s % 7)) & 1;
        const s21 = (o) => ((b[o] << 14) | (b[o + 1] << 7) | b[o + 2]) - (1 << 20);
        if (cmd === 0x36) {
          const first = b[2], n = b[3];
          if (b.length !== 4 + n * 23 || n > 24) { this.ack(cmd, ST.BAD_LENGTH, 0, 0); return; }
          if (first + n > 128) { this.ack(cmd, ST.BAD_SLOT, t + 1, 0); return; }
          this.gesture(true);
          for (let k = 0; k < n; k++) {
            const st = stepOf(unpack7(b.slice(4 + k * 23, 4 + k * 23 + 23)));
            st.locked = false;
            tr.steps[first + k] = st;
            tr.locks = tr.locks.filter((l) => l.step !== first + k);
          }
          this.ack(cmd, 0, t + 1, n);
          return;
        }
        let bad = 0, count = 0;
        if (cmd === 0x34) {
          this.gesture(false);
          for (let k = 0, o = 22; k < b[21]; k++) {
            const f = b[o];
            const notes = f === 1 ? Array.from(b.slice(o + 2, o + 2 + b[o + 1])) : null, v = f === 1 ? 0 : s21(o + 1);
            for (let s = 0; s < 128; s++) {
              if (!inMask(s)) continue;
              const ok = simField(tr, s, f, v, notes);
              if (!ok) bad = bad || 13; else if (k === 0) count++;
            }
            o += f === 1 ? 2 + b[o + 1] : 4;
          }
        } else {
          this.gesture(false);
          for (let k = 0; k < b[21]; k++) {
            const o = 22 + k * 6, op = b[o], id = (b[o + 1] << 7) | b[o + 2], v = s21(o + 3), r = LOCKS[id];
            if (op > 2 || (op < 2 && !r) || (op === 0 && (v < r[1] || v > r[2]))) { bad = bad || 13; continue; }
            for (let s = 0; s < 128; s++) {
              if (!inMask(s)) continue;
              if (op === 0) {
                if (!tr.locks.some((l) => l.step === s && l.id === id) && P.nlock() >= 1024) { bad = 1; break; }
                tr.locks = tr.locks.filter((l) => !(l.step === s && l.id === id)).concat([{ step: s, id, value: v }]);
              } else tr.locks = tr.locks.filter((l) => !(l.step === s && (op === 2 || l.id === id)));
              tr.steps[s].locked = tr.locks.some((l) => l.step === s);
              count++;
            }
            if (bad === 1) break;
          }
          tr.locks.sort((x, y) => x.step - y.step || x.id - y.id);
        }
        this.ack(cmd, bad, t + 1, count);
        return;
      }
      case 0x37: {                                                    // TRACK SET
        const P = this.pat, t = b[1] === 127 ? this.sel : b[1];
        if (b[0] !== P.pattern) { this.ack(cmd, 12, t + 1, P.pattern + 1); return; }
        if (t > 5) { this.ack(cmd, ST.BAD_TRACK, t + 1, 0); return; }
        if (b.length !== 3 + 4 * b[2]) { this.ack(cmd, ST.BAD_LENGTH, 0, 0); return; }
        this.gesture(false);
        const ts = P.tracks[t].set;
        let bad = 0, done = 0;
        for (let k = 0; k < b[2]; k++) {
          const f = b[3 + 4 * k], o = 4 + 4 * k, v = ((b[o] << 14) | (b[o + 1] << 7) | b[o + 2]) - (1 << 20), pg = (v >> 4) & 7, st = v & 15;
          const ok = f === 0 ? v >= 1 && v <= 255 && ((ts.loop = v), true)
            : f === 1 ? v >= 0 && v < 128 && st <= ts.pend[pg] && ((ts.pstart[pg] = st), true)
            : f === 2 ? v >= 0 && v < 128 && st >= ts.pstart[pg] && ((ts.pend[pg] = st), true)
            : f === 3 ? v >= 0 && v < 21 && ((ts.rbase = Math.floor(v / 3)), (ts.rtype = v % 3), true)
            : f === 4 ? (v === 0 || v === 1) && ((ts.swing = v), true)
            : f === 5 ? v >= -48 && v <= 48 && ((ts.transpose = v), true)
            : f === 6 ? (v === 0 || v === 1) && ((ts.mute = v), true)
            : f === 7 ? simDef(ts.def, v >> 8, v & 255)
            : f === 8 ? (v >> 8) < 6 && (v & 255) <= 127 && ((ts.def.slots[v >> 8] = v & 255), true) : false;
          if (ok) done++; else bad = bad || 13;
        }
        this.ack(cmd, bad, t + 1, done);
        return;
      }
      case 0x38: {                                                    // GO TO PATTERN (the sim has one pattern's content)
        if (b[0] > 63) { this.ack(cmd, 12, 0, this.pat.pattern + 1); return; }
        this.closeGesture && this.hist && this.closeGesture();
        if (b[0] !== this.pat.pattern) { const keep = this.pat; this.pats = this.pats || {}; this.pats[keep.pattern] = keep;
          this.pat = this.pats[b[0]] || emptyPattern(keep, b[0]); }
        this.ack(cmd, 0, b[0] + 1, 1);
        return;
      }
      case 0x39: {                                                    // UNDO / REDO
        this.closeGesture();
        const h = this.hist || { levels: [], pos: 0 };
        if (b[0] ? h.pos >= h.levels.length : h.pos <= 0) { this.ack(cmd, ST.NOT_FOUND, b[0] ? 1 : 0, 0); return; }
        const l = b[0] ? h.levels[h.pos++] : h.levels[--h.pos];
        this.restore(b[0] ? l.after : l.before);
        this.ack(cmd, 0, b[0] ? 1 : 0, l.kind + 1);
        return;
      }
      case CMD.PARAM: {
        const t = t0(b[0]), id = b[1], v = ((b[2] << 14) | (b[3] << 7) | b[4]) - (1 << 20);
        this.counts.params++;
        if (t > 5) { this.ack(cmd, ST.BAD_TRACK, t + 1, id); return; }
        if (!this.setValue(this.tracks[t], id, v)) { this.ack(cmd, ST.BAD_SLOT, t + 1, id); return; }
        this.tracks[t].edited = true;
        if (b[5] & 1) this.ack(cmd, 0, t + 1, id);
        return;
      }
      case CMD.BROWSE: {
        const t = t0(b[0]), id = (b[1] << 14) | (b[2] << 7) | b[3], f = this.find(id);
        if (t > 5) { this.ack(cmd, ST.BAD_TRACK, t + 1, 0); return; }
        if (!f) { this.ack(cmd, ST.NOT_FOUND, t + 1, 0); return; }
        this.tracks[t] = { ...this.tracks[t], ...soundOf(f), id, edited: false };   // (as if OCT+ took it at once)
        this.ack(cmd, 0, t + 1, 1);
        return;
      }
      case CMD1.TAGS: case CMD1.RENAME: case CMD1.DELETE: {
        const src = b[0], slot = (b[1] << 7) | b[2];
        if (cmd === CMD1.RENAME && src === 3) {
          if (!this.projects[slot - 1] || !this.projects[slot - 1].there) { this.ack(cmd, ST.BAD_SLOT); return; }
          this.projects[slot - 1].name = String.fromCharCode(...b.slice(3, 15)).trimEnd();
          this.ack(cmd, 0, slot); return;
        }
        if (cmd === CMD1.DELETE && src === 2) { this.semantic(CMD1.POOLREF, [...u14(slot), 0, 0, 0]); return; }
        const s = src === 0 ? this.mine[slot - 1] : null;
        if (!s) { this.ack(cmd, src === 0 ? ST.NOT_FOUND : ST.BAD_SLOT); return; }
        if (cmd === CMD1.TAGS) s.tags = b[3];
        else if (cmd === CMD1.RENAME) s.name = String.fromCharCode(...b.slice(3, 15)).trimEnd();
        else {
          const used = this.tracks.filter((t) => t.id === s.id).length + this.pool.filter((id) => id === s.id).length;
          if (used && !(b[3] & 1)) { this.ack(cmd, ST.IN_USE, slot, used); return; }
          this.mine[slot - 1] = null;
          this.pool.forEach((id, k) => { if (id === s.id) this.pool[k] = 0; });   // (this project's places cleared; the others keep their copy)
        }
        this.ack(cmd, 0, slot);
        return;
      }
      case CMD1.SWAP: {
        const a = (b[1] << 7) | b[2], c = (b[3] << 7) | b[4];
        if (b[0] === 2) {                                             // the pool's: a job, stopped only (the steps follow)
          if (!a || !c || a > 128 || c > 128 || a === c) { this.ack(cmd, ST.BAD_SLOT); return; }
          if (this.playing) return;                                   // (the unit's job waits: no reply while it plays)
          const P = this.pool;
          [P[a - 1], P[c - 1]] = [P[c - 1], P[a - 1]];
          for (const t of this.pat.tracks) for (const st of t.steps) if (st.ovr & (1 << PM.SOUND)) st.sound = st.sound === a ? c : st.sound === c ? a : st.sound;
          this.ack(cmd, 0, a, c);
          return;
        }
        if (b[0] !== 0 || !a || !c || a > this.mine.length || c > this.mine.length) { this.ack(cmd, ST.BAD_SLOT); return; }
        [this.mine[a - 1], this.mine[c - 1]] = [this.mine[c - 1], this.mine[a - 1]];
        this.ack(cmd, 0, a, c);
        return;
      }
      case CMD1.USERS: {
        const slot = (b[1] << 7) | b[2], s = b[0] === 0 ? this.mine[slot - 1] : null;
        if (b[0] === 2) {
          if (!slot || slot > 128 || !this.pool[slot - 1]) { this.ack(cmd, ST.NOT_FOUND); return; }
          const n = this.poolUsers(slot);
          this.out(W.egFrame(0x57, [2, ...u14(slot), 1, this.project - 1, ...u14(n), 0]));
          return;
        }
        const n = s ? this.tracks.filter((t) => t.id === s.id).length : 0;
        this.out(W.egFrame(0x57, [b[0], ...u14(slot), n ? 1 : 0, ...(n ? [this.project - 1, ...u14(0)] : []), n]));
        return;
      }
      case CMD1.POOLREF: {
        const slot = (b[0] << 7) | b[1], id = (b[2] << 14) | (b[3] << 7) | b[4], P = this.pool;
        if (slot > 128) { this.ack(cmd, ST.BAD_SLOT); return; }
        if (!id) {
          if (!slot || !P[slot - 1]) { this.ack(cmd, ST.NOT_FOUND); return; }
          P[slot - 1] = 0;
          for (const t of this.pat.tracks) for (const st of t.steps) if (st.ovr & (1 << PM.SOUND) && st.sound === slot) { st.ovr &= ~(1 << PM.SOUND); st.sound = 0; }
          this.ack(cmd, 0, slot, 0);
          return;
        }
        if (!this.find(id)) { this.ack(cmd, ST.NOT_FOUND); return; }
        const k = slot || P.indexOf(0) + 1;
        if (!k) { this.ack(cmd, ST.FULL); return; }
        P[k - 1] = id;
        this.ack(cmd, 0, k, id & 0x3FFF);
        return;
      }
      case CMD1.PROJECT: {                                            // LOAD, NEW, COPY p onto q, DELETE (1..4): a job, stopped only
        const op = b[0], p = b[1], q = b[2], P = this.projects, there = (x) => P[x - 1] && P[x - 1].there;
        if (op < 1 || op > 4 || !P[p - 1] || (op === 3 && (!P[q - 1] || q === p || q === this.project))) { this.ack(cmd, ST.BAD_SLOT, p, q); return; }
        if ((op === 3 || op === 4 || op === 1) && !there(p)) { this.ack(cmd, ST.NOT_FOUND, p, q); return; }
        if (this.playing) return;
        const blank = (x) => { P[x - 1] = { there: true, name: `PROJECT ${x}`, pool: new Array(128).fill(0) }; };
        if (op === 1) this.project = p;
        else if (op === 2) { blank(p); this.project = p; }
        else if (op === 3) P[q - 1] = { there: true, name: P[p - 1].name, pool: [...P[p - 1].pool] };
        else if (p === this.project) blank(p);
        else P[p - 1] = { there: false, pool: new Array(128).fill(0) };
        this.ack(cmd, 0, p, q);
        return;
      }
      default: this.error(cmd, ST.BAD_COMMAND);
    }
  }
}

// the simulated unit's open pattern: track 1 a four-on-the-floor, track 2 a bass line with a chord and locks, track 3 an
// arpeggio over two pages; the others empty (QD_TSET: 1/16, a page of 16 looped, C4 at velocity 100)
function demoPattern(names) {
  const tset = () => ({ def: { slots: [60, 0, 0, 0, 0, 0], vel: 100, len: 4, micro: 0, ratch: 1, ramp: 0, chance: 100, cond: 0, type: 1, strum: 0 },
    chan: 0, limit: 8, reserve: 0, rbase: 4, swing: 0, transpose: 0, mute: 0, loop: 1, pstart: [0, 0, 0, 0, 0, 0, 0, 0],
    pend: [15, 15, 15, 15, 15, 15, 15, 15], scale: 0, root: 0, keyGlobal: 1, rtype: 0, mfx: 0, mout: 0 });
  const tracks = names.map((name, k) => ({ name, set: { ...tset(), chan: k }, steps: Array.from({ length: 128 }, emptyStep), locks: [] }));
  const note = (t, s, slots, vel = 100, more = {}) => {
    const st = tracks[t].steps[s];
    Object.assign(st, { on: true, type: 1, slots: [...slots, 0, 0, 0, 0, 0, 0].slice(0, 6), vel, ...more });
    st.ovr |= (1 << PM.NOTE) | (1 << PM.VEL) | (more.len !== undefined ? 1 << PM.LEN : 0) | (more.cond !== undefined ? 1 << PM.COND : 0) |
      (more.chance !== undefined ? 1 << PM.CHANCE : 0) | (more.sound !== undefined ? 1 << PM.SOUND : 0) | (more.micro !== undefined ? 1 << PM.MICRO : 0);
  };
  for (let s = 0; s < 16; s += 4) note(0, s, [36], 120);
  [[0, [36], 110], [2, [48], 70], [4, [36, 40, 43], 100, { chance: 75, cond: 9, micro: 3, sound: 7 }], [7, [48], 60], [8, [39], 120],
    [10, [51], 70], [12, [41], 105, { len: 6 }], [15, [48], 60]].forEach(([s, n, v, m]) => note(1, s, n, v, m));
  tracks[1].locks.push({ step: 4, id: 31, value: 1600 }, { step: 4, id: 32, value: 9 }, { step: 4, id: 125, value: 80 },
    { step: 8, id: 31, value: 700 }, { step: 12, id: 31, value: 1900 }, { step: 12, id: 119, value: -20 });
  tracks[1].locks.forEach((l) => { tracks[1].steps[l.step].locked = true; });
  for (let s = 0; s < 32; s += 2) note(2, s, [60 + [0, 3, 7, 10, 12, 10, 7, 3][(s / 2) % 8]], 90);
  tracks[2].set.loop = 3;
  return { pattern: 0, rev: 1, bpm: 120, swing: 50, master: 0, tracks, nlock() { return this.tracks.reduce((n, t) => n + t.locks.length, 0); } };
}

// one STEP SET field on one step of the simulated pattern, as the core's setters (pattern.c: own() makes a trig)
function simField(tr, s, f, v, notes) {
  const st = tr.steps[s];
  const own = (pm) => { st.on = true; st.ovr |= 1 << pm; };
  const inr = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
  switch (f) {
    case 0:
      if (v === 4) { st.on = true; return true; }
      if (v === 0) { tr.steps[s] = emptyStep(); tr.locks = tr.locks.filter((l) => l.step !== s); return true; }
      if (!inr(v, 1, 3)) return false;
      st.on = true; st.type = v; st.ovr |= 1 << PM.TRIG; return true;
    case 1:
      if (!notes.length) { st.ovr &= ~(1 << PM.NOTE); return true; }
      if (notes.some((n) => !inr(n, 1, 127)) || new Set(notes).size !== notes.length) return false;
      own(PM.NOTE); st.slots = [...notes, 0, 0, 0, 0, 0, 0].slice(0, 6); return true;
    case 2: if (!inr(v, 1, 127)) return false; own(PM.VEL); st.vel = v; return true;
    case 3: if (!inr(v, 0, 19)) return false; own(PM.LEN); st.len = v; return true;
    case 4: if (!inr(v, -23, 23)) return false; own(PM.MICRO); st.micro = v; return true;
    case 5: if (!inr(v & 15, 1, 8)) return false; own(PM.RATCH); st.ratch = v & 15; st.ramp = (v >> 4) & 3; return true;
    case 6: if (!inr(v, 0, 43)) return false; own(PM.COND); st.cond = v; return true;
    case 7: if (!inr(v, 0, 100)) return false; own(PM.CHANCE); st.chance = v; return true;
    case 8: if (!inr(v, 0, 128)) return false; if (v) own(PM.SOUND); else st.ovr &= ~(1 << PM.SOUND); st.sound = v; return true;
    case 9: if (!inr(v, 0, 23)) return false; own(PM.STRUM); st.strum = v; return true;
    case 10: if (!inr(v, 0, FUNCS_N - 1)) return false; st.on = true; st.func = v; return true;
    case 11: if (!inr(v, 0, 6)) return false; st.on = true; st.mfx = v; return true;
    case 12: if (!inr(v, 0, 9)) return false; st.ovr &= ~(1 << v); return true;
    case 13: tr.steps[s] = emptyStep(); tr.locks = tr.locks.filter((l) => l.step !== s); return true;
    default: return false;
  }
}

function simDef(d, pm, v) {
  const r = { 1: ["vel", 1, 127], 2: ["len", 0, 19], 3: ["micro", -23, 23], 5: ["chance", 0, 100], 6: ["cond", 0, 43], 9: ["strum", 0, 23] }[pm];
  if (!r || v < r[1] || v > r[2]) return false;
  d[r[0]] = v;
  return true;
}
function emptyPattern(like, n) {
  return { ...like, pattern: n, rev: like.rev + 1, tracks: like.tracks.map((t) => ({ name: t.name, set: JSON.parse(JSON.stringify(t.set)),
    steps: Array.from({ length: 128 }, emptyStep), locks: [] })) };
}
