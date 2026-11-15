// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not
// distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// A simulated FM-1 running EvilGenius behind a fake Web MIDI access: the manager's ?sim (the page without a unit: the
// preview, headless checks) and the Node tests. It answers what the page asks the way the unit does:
//   - fm1-base's update handshake (the identity FM-1_4500) and EvilGenius's IDENTITY;
//   - the port's bulk commands over a blank store of the unit's layout (FZBI, FZBR; FZSR refused: nothing restores here);
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

const hex = (s) => Uint8Array.from(s.match(/../g).map((x) => parseInt(x, 16)));
const later = (fn) => setTimeout(fn, 1);
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
    this.projects = [{ name: "", there: true }, { name: "", there: true }, { there: false }, { there: false }];
    this.input = { name, state: "connected", onmidimessage: null, open: async () => {}, close: async () => {} };
    this.output = { name, state: "connected", open: async () => {}, close: async () => {}, send: (b) => this.take(Array.from(b)) };
    this.access = { inputs: new Map([[name, this.input]]), outputs: new Map([[name, this.output]]), onstatechange: null, sysexEnabled: true };
  }
  out(bytes) { later(() => { if (this.input.onmidimessage && this.input.state === "connected") this.input.onmidimessage({ data: Uint8Array.from(bytes) }); }); }
  unplug() { this.input.state = this.output.state = "disconnected"; if (this.access.onstatechange) this.access.onstatechange({}); }
  // the unit's own hands: a knob turned on a track (the editor follows it), SELECT
  turn(t, id, v) { this.setValue(this.tracks[t], id, v); this.tracks[t].edited = true; }
  select(t) { this.sel = t; }

  take(p) {
    if (p[0] !== 0xF0) {                                              // a note, a controller
      if ((p[0] & 0xF0) === 0x90) this.counts.notes++;
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
    return W.egFrame(0x42, [1, 6, (this.playing ? 1 : 0), this.project - 1, 0, this.projects.filter((p) => p.there).length, ...u14(used), ...u14(0),
      0, 0, 0, ...u14(used * 2), ...u14(165), ...u14(48), ...u14(570), 0, this.sel, 1, LAYOUT.nproj, ...u14(LAYOUT.nlib)]);
  }
  rows(factory) {
    const out = [];
    this.mine.forEach((s, k) => { if (s) out.push([0, k + 1, s.id, s.name, s.tags, s.imported ? 1 : 0]); });
    if (factory) for (const f of this.factory) out.push([1, f.slot, f.id, f.name, f.tags, 0]);
    return out;
  }
  find(id) { return this.factory.find((f) => f.id === id) || this.mine.find((m) => m && m.id === id) || null; }

  semantic(cmd, b) {
    const t0 = (t) => (t === 127 ? this.sel : t);
    switch (cmd) {
      case 0x01: this.out(W.egFrame(0x41, [1, ...[..."EVILGENIUS SIM"].map((c) => c.charCodeAt(0))])); return;
      case CMD1.STATUS: this.out(this.status()); return;
      case CMD1.FLUSH: this.out(this.status()); return;
      case CMD1.PROJECTS: {
        const body = [this.project - 1, this.projects.length];
        this.projects.forEach((p, k) => body.push((p.there ? 1 : 0) | (k + 1 === this.project ? 2 : 0), ...nm12(p.name || ""), 0, 4));
        this.out(W.egFrame(0x63, body));
        return;
      }
      case CMD.LIST: {
        const rows = this.rows(b[0] & 1), parts = Math.max(1, Math.ceil(rows.length / 16));
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
        let k = slot ? slot - 1 : this.mine.findIndex((m) => !m);
        if (k < 0 || k >= this.mine.length) { this.out(W.egFrame(0x50, [ST.FULL, 0, 0, 0])); return; }
        const id = this.mine[k] ? this.mine[k].id : this.nextId++;
        this.mine[k] = { ...s, id, imported: !(fl & FLAGS.OWN) };
        if (fl & FLAGS.LOAD) this.tracks[b[16]] = { ...this.tracks[b[16]], ...s, id, edited: false };
        this.out(W.egFrame(0x50, [0, 0, ...u14(k + 1)]));
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
        const s = src === 0 ? this.mine[slot - 1] : null;
        if (!s) { this.ack(cmd, src === 0 ? ST.NOT_FOUND : ST.BAD_SLOT); return; }
        if (cmd === CMD1.TAGS) s.tags = b[3];
        else if (cmd === CMD1.RENAME) s.name = String.fromCharCode(...b.slice(3, 15)).trimEnd();
        else {
          const used = this.tracks.filter((t) => t.id === s.id).length;
          if (used && !(b[3] & 1)) { this.ack(cmd, ST.IN_USE, slot, used); return; }
          this.mine[slot - 1] = null;
        }
        this.ack(cmd, 0, slot);
        return;
      }
      case CMD1.SWAP: {
        const a = (b[1] << 7) | b[2], c = (b[3] << 7) | b[4];
        if (b[0] !== 0 || !a || !c || a > this.mine.length || c > this.mine.length) { this.ack(cmd, ST.BAD_SLOT); return; }
        [this.mine[a - 1], this.mine[c - 1]] = [this.mine[c - 1], this.mine[a - 1]];
        this.ack(cmd, 0, a, c);
        return;
      }
      case CMD1.USERS: {
        const slot = (b[1] << 7) | b[2], s = b[0] === 0 ? this.mine[slot - 1] : null;
        const n = s ? this.tracks.filter((t) => t.id === s.id).length : 0;
        this.out(W.egFrame(0x57, [b[0], ...u14(slot), n ? 1 : 0, ...(n ? [this.project - 1, ...u14(0)] : []), n]));
        return;
      }
      default: this.error(cmd, ST.BAD_COMMAND);
    }
  }
}
